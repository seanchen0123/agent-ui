import { useCallback } from 'react'
import { getSessionAPI, getAllSessionsAPI } from '@/api/os'
import { useStore } from '../store'
import { toast } from 'sonner'
import {
  ChatMessage,
  ToolCall,
  ReasoningMessage,
  ChatEntry,
  TimelineStep
} from '@/types/os'
import { getJsonMarkdown, parseThinkSegments } from '@/lib/utils'

interface SessionResponse {
  session_id: string
  agent_id: string
  user_id: string | null
  runs?: ChatEntry[]
  memory: {
    runs?: ChatEntry[]
    chats?: ChatEntry[]
  }
  agent_data: Record<string, unknown>
}

interface LoaderArgs {
  entityType: 'agent' | 'team' | null
  agentId?: string | null
  teamId?: string | null
  dbId: string | null
}

// run.messages 里的原始 LLM 消息结构（只声明我们用得到的字段，宽松处理，
// 避免因为 ChatEntry 类型里暂时没声明 messages 字段而报错）
interface RunToolCallRef {
  id: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface RunMessage {
  id?: string
  role: string
  content?: unknown
  reasoning_content?: string
  tool_calls?: RunToolCallRef[]
  created_at?: number
}

// ChatEntry 类型目前没有声明 tools / messages / parent_run_id / run_id / agent_name 字段
// （后端实际返回了，只是类型没跟上），统一用这个扩展类型做断言
type RunEntry = ChatEntry & {
  run_id?: string
  parent_run_id?: string
  agent_id?: string
  agent_name?: string
  content?: string | object
  status?: string
  tools?: ToolCall[]
  messages?: RunMessage[]
}

const safeParseToolArgs = (args: unknown): Record<string, unknown> => {
  if (!args) return {}
  if (typeof args === 'object') return args as Record<string, unknown>
  if (typeof args === 'string') {
    try {
      return JSON.parse(args)
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * 从 run.messages（原始 LLM 消息记录）重建出真实顺序的 timeline。
 *
 * 之所以不能直接用 run.reasoning_content：那是所有轮次合并后的一整块字符串，
 * round 边界信息已经丢失了。但 run.messages 里每一条 assistant 消息都带着
 * "这一轮"自己的 reasoning_content，紧跟着这一轮的 tool_calls，顺序天然正确，
 * 这才是能还原 timeline 的数据源。
 *
 * Team 模式下，委派工具与对应的 member_run 都要保留：工具卡片固定在发起
 * 委派的真实位置，紧随其后的 member_run 递归展示子 agent 的完整执行过程。
 */
const buildTimelineFromRun = (
  run: RunEntry,
  runsById: Map<string, RunEntry>,
  childRunsByParentId: Map<string, RunEntry[]>,
  usedMemberRunIds = new Set<string>()
): TimelineStep[] => {
  const timeline: TimelineStep[] = []

  const r = run
  const rawMessages = r.messages ?? []
  const toolCallsFlat: ToolCall[] = r.tools ?? []
  const toolCallById = new Map(
    toolCallsFlat
      .filter((tc) => tc.tool_call_id)
      .map((tc) => [String(tc.tool_call_id), tc])
  )
  const usedToolCallIds = new Set<string>()
  // 按出现顺序兜底的游标：如果 tool_call_id 精确匹配失败（格式细微差异等），
  // 就按 run.tools 数组里出现的顺序对应下一条，避免 result / tool_call_error 数据丢失
  let toolCallCursor = 0

  const addReasoning = (content: string, id: string) => {
    if (!content.trim()) return
    timeline.push({ id: `reasoning-${id}`, type: 'reasoning', content })
  }

  const findChildRun = (
    rawToolCall: RunToolCallRef,
    fullTool: ToolCall | undefined
  ) => {
    const toolArgs =
      fullTool?.tool_args ?? safeParseToolArgs(rawToolCall.function?.arguments)
    const memberId =
      typeof toolArgs.member_id === 'string' ? toolArgs.member_id : undefined
    const children = r.run_id ? (childRunsByParentId.get(r.run_id) ?? []) : []
    const childRunId = fullTool?.child_run_id
      ? String(fullTool.child_run_id)
      : undefined
    const childFromTool = childRunId ? runsById.get(childRunId) : undefined
    const isDelegation =
      (fullTool?.tool_name ?? rawToolCall.function?.name) ===
      'delegate_task_to_member'

    // 部分历史记录的 child_run_id 会被后续委派覆盖。member_id 与
    // parent_run_id 一起才能稳定确定真正的子 agent run。
    if (
      childFromTool &&
      childFromTool.parent_run_id === r.run_id &&
      !usedMemberRunIds.has(childFromTool.run_id ?? '') &&
      (!memberId || childFromTool.agent_id === memberId)
    ) {
      return childFromTool
    }

    if (!isDelegation) return undefined

    return children.find(
      (child) =>
        !usedMemberRunIds.has(child.run_id ?? '') &&
        (!memberId || child.agent_id === memberId)
    )
  }

  const addToolAndMember = (
    rawToolCall: RunToolCallRef,
    fullTool: ToolCall | undefined,
    fallbackId: string,
    createdAt?: number
  ) => {
    const toolCallId = rawToolCall.id ? String(rawToolCall.id) : undefined
    const tool =
      fullTool ??
      ({
        tool_call_id: toolCallId ?? '',
        tool_name: rawToolCall.function?.name ?? '',
        tool_args: safeParseToolArgs(rawToolCall.function?.arguments),
        created_at: createdAt
      } as ToolCall)

    timeline.push({
      id: `tool-${toolCallId ?? fallbackId}`,
      type: 'tool_call',
      tool
    })

    const childRun = findChildRun(rawToolCall, fullTool)
    if (!childRun?.run_id) return

    usedMemberRunIds.add(childRun.run_id)
    timeline.push({
      id: `member-${childRun.run_id}`,
      type: 'member_run',
      agentId: childRun.agent_id,
      agentName: childRun.agent_name,
      runId: childRun.run_id,
      task: (tool.tool_args?.task as string | undefined) ?? undefined,
      content: typeof childRun.content === 'string' ? childRun.content : '',
      timeline: buildTimelineFromRun(childRun, runsById, childRunsByParentId),
      status: childRun.status === 'ERROR' ? 'error' : 'completed'
    })
  }

  rawMessages.forEach((msg, msgIndex) => {
    if (msg.role !== 'assistant') return

    if (msg.reasoning_content?.trim()) {
      addReasoning(msg.reasoning_content, msg.id ?? String(msgIndex))
    } else if (typeof msg.content === 'string') {
      parseThinkSegments(msg.content).forEach((segment, segmentIndex) => {
        if (segment.type === 'think') {
          addReasoning(segment.content, `${msg.id ?? msgIndex}-${segmentIndex}`)
        }
      })
    }

    if (Array.isArray(msg.tool_calls)) {
      msg.tool_calls.forEach((rawToolCall, tcIndex) => {
        const toolCallId = rawToolCall.id ? String(rawToolCall.id) : undefined
        let fullTool = toolCallId ? toolCallById.get(toolCallId) : undefined

        if (!fullTool && toolCallCursor < toolCallsFlat.length) {
          fullTool = toolCallsFlat[toolCallCursor]
        }
        toolCallCursor++

        if (fullTool?.tool_call_id) {
          usedToolCallIds.add(String(fullTool.tool_call_id))
        } else if (toolCallId) {
          usedToolCallIds.add(toolCallId)
        }

        addToolAndMember(
          rawToolCall,
          fullTool,
          `${msgIndex}-${tcIndex}`,
          msg.created_at
        )
      })
    }
  })

  // 兜底：如果某个工具调用因为数据异常没能在 messages 里配对上，
  // 追加在末尾，至少不丢信息（不影响正常情况下的顺序）
  toolCallsFlat.forEach((tc) => {
    if (tc.tool_call_id && !usedToolCallIds.has(String(tc.tool_call_id))) {
      addToolAndMember(
        {
          id: tc.tool_call_id,
          function: {
            name: tc.tool_name,
            arguments: JSON.stringify(tc.tool_args)
          }
        },
        tc,
        tc.tool_call_id,
        tc.created_at
      )
    }
  })

  return timeline
}

const useSessionLoader = () => {
  const setMessages = useStore((state) => state.setMessages)
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const setIsSessionsLoading = useStore((state) => state.setIsSessionsLoading)
  const setSessionsData = useStore((state) => state.setSessionsData)

  const getSessions = useCallback(
    async ({ entityType, agentId, teamId, dbId }: LoaderArgs) => {
      const selectedId = entityType === 'agent' ? agentId : teamId
      if (!selectedEndpoint || !entityType || !selectedId || !dbId) return

      try {
        setIsSessionsLoading(true)

        const sessions = await getAllSessionsAPI(
          selectedEndpoint,
          entityType,
          selectedId,
          dbId,
          authToken
        )
        if (sessions && Array.isArray(sessions.data)) {
          setSessionsData(sessions.data)
        }
      } catch {
        toast.error('Error loading sessions')
      } finally {
        setIsSessionsLoading(false)
      }
    },
    [selectedEndpoint, authToken, setSessionsData, setIsSessionsLoading]
  )

  const getSession = useCallback(
    async (
      { entityType, agentId, teamId, dbId }: LoaderArgs,
      sessionId: string
    ) => {
      const selectedId = entityType === 'agent' ? agentId : teamId
      if (
        !selectedEndpoint ||
        !sessionId ||
        !entityType ||
        !selectedId ||
        !dbId
      )
        return

      try {
        const response: SessionResponse = await getSessionAPI(
          selectedEndpoint,
          entityType,
          sessionId,
          dbId,
          authToken
        )
        if (response) {
          if (Array.isArray(response)) {
            // 建立 run_id 索引与 parent_run_id 分组。child_run_id 在历史数据中
            // 可能被覆盖，回填时需要两者交叉校验才能找对成员运行记录。
            const runsById = new Map<string, RunEntry>()
            const childRunsByParentId = new Map<string, RunEntry[]>()
            response.forEach((run) => {
              const r = run as RunEntry
              if (r?.run_id) runsById.set(r.run_id, r)
              if (r?.run_id && r.parent_run_id) {
                const children = childRunsByParentId.get(r.parent_run_id) ?? []
                children.push(r)
                childRunsByParentId.set(r.parent_run_id, children)
              }
            })

            const messagesFor = response.flatMap((run) => {
              const filteredMessages: ChatMessage[] = []
              const r = run as RunEntry

              // *** 关键修复：带 parent_run_id 的 run 是 Team 委派出去的成员 agent
              // 自己的 run，不应该单独渲染成一条对话消息（否则会出现重复的
              // user 气泡）。它会在其父 run 的 timeline 里被折叠成一个
              // member_run 节点，这里直接跳过。 ***
              if (r?.parent_run_id) {
                return filteredMessages
              }

              if (run) {
                filteredMessages.push({
                  role: 'user',
                  content: run.run_input ?? '',
                  created_at: run.created_at
                })
              }

              if (run) {
                const toolCalls = [
                  ...(r.tools ?? []),
                  ...(run.extra_data?.reasoning_messages ?? []).reduce(
                    (acc: ToolCall[], msg: ReasoningMessage) => {
                      if (msg.role === 'tool') {
                        acc.push({
                          role: msg.role,
                          content: msg.content,
                          tool_call_id: msg.tool_call_id ?? '',
                          tool_name: msg.tool_name ?? '',
                          tool_args: msg.tool_args ?? {},
                          tool_call_error: msg.tool_call_error ?? false,
                          metrics: msg.metrics ?? { time: 0 },
                          created_at:
                            msg.created_at ?? Math.floor(Date.now() / 1000)
                        })
                      }
                      return acc
                    },
                    []
                  )
                ]

                // 从 run.messages 重建 timeline：
                // - reasoning_content 模式靠它还原思考轮次+工具调用的真实顺序；
                // - <think> 内联模式同样会逐段转成 reasoning timeline；
                // - Team 模式下，委派工具会保留，并在其后插入对应的 member_run 节点。
                const timeline = buildTimelineFromRun(
                  r,
                  runsById,
                  childRunsByParentId
                )

                filteredMessages.push({
                  role: 'agent',
                  content: (run.content as string) ?? '',
                  reasoning_content:
                    (run.reasoning_content as string) ?? undefined,
                  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                  timeline: timeline.length > 0 ? timeline : undefined,
                  extra_data: run.extra_data,
                  images: run.images,
                  videos: run.videos,
                  audio: run.audio,
                  response_audio: run.response_audio,
                  created_at: run.created_at
                })
              }
              return filteredMessages
            })

            const processedMessages = messagesFor.map(
              (message: ChatMessage) => {
                if (Array.isArray(message.content)) {
                  const textContent = message.content
                    .filter((item: { type: string }) => item.type === 'text')
                    .map((item) => item.text)
                    .join(' ')

                  return {
                    ...message,
                    content: textContent
                  }
                }
                if (typeof message.content !== 'string') {
                  return {
                    ...message,
                    content: getJsonMarkdown(message.content)
                  }
                }
                return message
              }
            )

            setMessages(processedMessages)
            return processedMessages
          }
        }
      } catch {
        return null
      }
    },
    [selectedEndpoint, authToken, setMessages]
  )

  return { getSession, getSessions }
}

export default useSessionLoader
