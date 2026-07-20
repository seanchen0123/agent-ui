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
import { getJsonMarkdown } from '@/lib/utils'

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

// ChatEntry 类型目前没有声明 tools / messages 字段（后端实际返回了，只是类型没跟上），
// 统一用这个扩展类型做断言，避免到处写 `as unknown as {...}`
type RunEntry = ChatEntry & {
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
 * 工具调用的完整信息（result / tool_call_error / metrics）优先从 run.tools
 * 里按 tool_call_id 取，因为 messages 里的 tool_calls 只是原始请求参数，
 * 没有执行结果。
 */
const buildTimelineFromRun = (run: ChatEntry): TimelineStep[] => {
  const timeline: TimelineStep[] = []

  const r = run as RunEntry
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

  rawMessages.forEach((msg, msgIndex) => {
    if (msg.role !== 'assistant') return

    if (msg.reasoning_content) {
      timeline.push({
        id: `reasoning-${msg.id ?? msgIndex}`,
        type: 'reasoning',
        content: msg.reasoning_content
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

        timeline.push({
          id: `tool-${toolCallId ?? `${msgIndex}-${tcIndex}`}`,
          type: 'tool_call',
          tool:
            fullTool ??
            ({
              tool_call_id: toolCallId ?? '',
              tool_name: rawToolCall.function?.name ?? '',
              tool_args: safeParseToolArgs(rawToolCall.function?.arguments),
              created_at: msg.created_at
            } as ToolCall)
        })
      })
    }
  })

  // 兜底：如果某个工具调用因为数据异常没能在 messages 里配对上，
  // 追加在末尾，至少不丢信息（不影响正常情况下的顺序）
  toolCallsFlat.forEach((tc) => {
    if (tc.tool_call_id && !usedToolCallIds.has(String(tc.tool_call_id))) {
      timeline.push({
        id: `tool-${tc.tool_call_id}`,
        type: 'tool_call',
        tool: tc
      })
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
            const messagesFor = response.flatMap((run) => {
              const filteredMessages: ChatMessage[] = []

              if (run) {
                filteredMessages.push({
                  role: 'user',
                  content: run.run_input ?? '',
                  created_at: run.created_at
                })
              }

              if (run) {
                const r = run as RunEntry
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

                // 关键新增：从 run.messages 重建 timeline，
                // reasoning_content 模式靠它还原思考轮次+工具调用的真实顺序；
                // <think> 内联模式下这里会构建出"零个 reasoning 条目"，
                // MessageItem.tsx 会据此自动回退到老的内联解析逻辑，互不影响。
                const timeline = buildTimelineFromRun(run)

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
