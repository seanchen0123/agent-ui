import { useCallback } from 'react'

import { APIRoutes } from '@/api/routes'

import useChatActions from '@/hooks/useChatActions'
import { useStore } from '../store'
import {
  RunEvent,
  RunResponseContent,
  type RunResponse,
  type TimelineStep,
  type ToolCall,
  type ChatMessage
} from '@/types/os'
import { constructEndpointUrl } from '@/lib/constructEndpointUrl'
import useAIResponseStream from './useAIResponseStream'
import { useQueryState } from 'nuqs'
import { getJsonMarkdown } from '@/lib/utils'

type MemberRunStep = Extract<TimelineStep, { type: 'member_run' }>
type InlineThinkState = {
  inThink: boolean
  pendingTag: string
}

/**
 * 在 timeline 树里（顶层 + 递归嵌套的 member_run）按 runId 找到对应的 member_run 节点。
 * Team 模式下每个成员 agent 自己的事件都带着自己的 run_id，需要靠这个函数
 * 才能知道该往哪个节点的 timeline 里写数据。
 */
const findMemberStep = (
  timeline: TimelineStep[] | undefined,
  runId: string
): MemberRunStep | null => {
  if (!timeline) return null
  for (const step of timeline) {
    if (step.type === 'member_run') {
      if (step.runId === runId) return step
      const found = findMemberStep(step.timeline, runId)
      if (found) return found
    }
  }
  return null
}

/**
 * 根据事件所属的 run_id，解析出真正应该写入的 timeline 数组：
 * - 如果就是顶层 run（team 或单 agent 自己），直接返回 message.timeline
 * - 如果是某个 member_run 自己的事件，返回那个节点自己的 timeline 数组
 */
const resolveTargetTimeline = (
  message: ChatMessage,
  runId: string | undefined,
  topRunId: string | null
): TimelineStep[] => {
  message.timeline = message.timeline ?? []
  if (!runId || !topRunId || runId === topRunId) return message.timeline
  const member = findMemberStep(message.timeline, runId)
  return member ? member.timeline : message.timeline
}

const useAIChatStreamHandler = () => {
  const setMessages = useStore((state) => state.setMessages)
  const { addMessage, focusChatInput } = useChatActions()
  const [agentId] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [sessionId, setSessionId] = useQueryState('session')
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const mode = useStore((state) => state.mode)
  const setStreamingErrorMessage = useStore(
    (state) => state.setStreamingErrorMessage
  )
  const setIsStreaming = useStore((state) => state.setIsStreaming)
  const setSessionsData = useStore((state) => state.setSessionsData)
  const { streamResponse } = useAIResponseStream()

  /**
   * 把一段 reasoning_content 增量追加到指定 timeline 数组里。
   * 判断规则：如果数组最后一项已经是「进行中的推理轮」（type === 'reasoning'），
   * 就直接往它上面追加；否则说明上一轮已经被工具调用（或子 agent 执行）打断了，
   * 开一个新的推理轮。
   */
  const appendReasoningToTimeline = useCallback(
    (targetTimeline: TimelineStep[], delta: string) => {
      const last = targetTimeline[targetTimeline.length - 1]
      // 某些模型会单独流出 "\n"。它既不能构成一轮新的思考，
      // 也不该在工具调用之后生成一个空的 THINKING 块。
      if (!delta.trim() && (!last || last.type !== 'reasoning')) return

      if (!last || last.type !== 'reasoning') {
        targetTimeline.push({
          id: `reasoning-${targetTimeline.length}-${Date.now()}`,
          type: 'reasoning',
          content: delta
        })
      } else {
        last.content = (last.content || '') + delta
      }
    },
    []
  )

  /**
   * 部分模型把思考过程流在 content 的 <think></think> 标签里，而不是
   * reasoning_content 字段里。这里按 run 维护一个小状态机，把标签内部的
   * 增量也写入 timeline，保证后续 tool_call / member_run 可以按真实流式顺序插入。
   */
  const appendInlineThinkToTimeline = useCallback(
    (
      targetTimeline: TimelineStep[],
      delta: string,
      state: InlineThinkState
    ) => {
      const thinkStartTag = '<think>'
      const thinkEndTag = '</think>'
      let text = state.pendingTag + delta
      state.pendingTag = ''

      while (text.length > 0) {
        if (state.inThink) {
          const endTagIndex = text.indexOf(thinkEndTag)
          if (endTagIndex >= 0) {
            const reasoningDelta = text.slice(0, endTagIndex)
            if (reasoningDelta) {
              appendReasoningToTimeline(targetTimeline, reasoningDelta)
            }
            state.inThink = false
            text = text.slice(endTagIndex + thinkEndTag.length)
            continue
          }

          const possibleTagStart = text.lastIndexOf('<')
          if (
            possibleTagStart >= 0 &&
            thinkEndTag.startsWith(text.slice(possibleTagStart))
          ) {
            const reasoningDelta = text.slice(0, possibleTagStart)
            if (reasoningDelta) {
              appendReasoningToTimeline(targetTimeline, reasoningDelta)
            }
            state.pendingTag = text.slice(possibleTagStart)
          } else {
            appendReasoningToTimeline(targetTimeline, text)
          }
          break
        }

        const startTagIndex = text.indexOf(thinkStartTag)
        if (startTagIndex >= 0) {
          state.inThink = true
          text = text.slice(startTagIndex + thinkStartTag.length)
          continue
        }

        const possibleTagStart = text.lastIndexOf('<')
        if (
          possibleTagStart >= 0 &&
          thinkStartTag.startsWith(text.slice(possibleTagStart))
        ) {
          state.pendingTag = text.slice(possibleTagStart)
        }
        break
      }
    },
    [appendReasoningToTimeline]
  )

  /**
   * 把一次工具调用写入/更新到指定 timeline 数组里（按 tool_call_id 去重合并）。
   */
  const upsertToolCallInTimeline = useCallback(
    (targetTimeline: TimelineStep[], toolCall: ToolCall) => {
      const toolCallId =
        toolCall.tool_call_id || `${toolCall.tool_name}-${toolCall.created_at}`
      const idx = targetTimeline.findIndex(
        (step) =>
          step.type === 'tool_call' &&
          ((step.tool?.tool_call_id &&
            step.tool.tool_call_id === toolCall.tool_call_id) ||
            (!step.tool?.tool_call_id &&
              `${step.tool?.tool_name}-${step.tool?.created_at}` ===
                toolCallId))
      )
      if (idx >= 0) {
        const existingStep = targetTimeline[idx]
        if (existingStep.type !== 'tool_call') return
        targetTimeline[idx] = {
          ...existingStep,
          tool: { ...existingStep.tool, ...toolCall }
        } as TimelineStep
      } else {
        targetTimeline.push({
          id: `tool-${toolCallId}`,
          type: 'tool_call',
          tool: toolCall
        })
      }
    },
    []
  )

  const updateMessagesWithErrorState = useCallback(() => {
    setMessages((prevMessages) => {
      const newMessages = [...prevMessages]
      const lastMessage = newMessages[newMessages.length - 1]
      if (lastMessage && lastMessage.role === 'agent') {
        lastMessage.streamingError = true
      }
      return newMessages
    })
  }, [setMessages])

  const processToolCall = useCallback(
    (toolCall: ToolCall, prevToolCalls: ToolCall[] = []) => {
      const toolCallId =
        toolCall.tool_call_id || `${toolCall.tool_name}-${toolCall.created_at}`

      const existingToolCallIndex = prevToolCalls.findIndex(
        (tc) =>
          (tc.tool_call_id && tc.tool_call_id === toolCall.tool_call_id) ||
          (!tc.tool_call_id &&
            toolCall.tool_name &&
            toolCall.created_at &&
            `${tc.tool_name}-${tc.created_at}` === toolCallId)
      )
      if (existingToolCallIndex >= 0) {
        const updatedToolCalls = [...prevToolCalls]
        updatedToolCalls[existingToolCallIndex] = {
          ...updatedToolCalls[existingToolCallIndex],
          ...toolCall
        }
        return updatedToolCalls
      } else {
        return [...prevToolCalls, toolCall]
      }
    },
    []
  )

  const processChunkToolCalls = useCallback(
    (
      chunk: RunResponseContent | RunResponse,
      existingToolCalls: ToolCall[] = []
    ) => {
      let updatedToolCalls = [...existingToolCalls]
      if (chunk.tool) {
        updatedToolCalls = processToolCall(chunk.tool, updatedToolCalls)
      }
      if (chunk.tools && chunk.tools.length > 0) {
        for (const toolCall of chunk.tools) {
          updatedToolCalls = processToolCall(toolCall, updatedToolCalls)
        }
      }

      return updatedToolCalls
    },
    [processToolCall]
  )

  const handleStreamResponse = useCallback(
    async (input: string | FormData) => {
      setIsStreaming(true)

      const formData = input instanceof FormData ? input : new FormData()
      if (typeof input === 'string') {
        formData.append('message', input)
      }

      setMessages((prevMessages) => {
        if (prevMessages.length >= 2) {
          const lastMessage = prevMessages[prevMessages.length - 1]
          const secondLastMessage = prevMessages[prevMessages.length - 2]
          if (
            lastMessage.role === 'agent' &&
            lastMessage.streamingError &&
            secondLastMessage.role === 'user'
          ) {
            return prevMessages.slice(0, -2)
          }
        }
        return prevMessages
      })

      addMessage({
        role: 'user',
        content: formData.get('message') as string,
        created_at: Math.floor(Date.now() / 1000)
      })

      addMessage({
        role: 'agent',
        content: '',
        tool_calls: [],
        timeline: [],
        streamingError: false,
        created_at: Math.floor(Date.now() / 1000) + 1
      })

      // --- 以下这些变量的生命周期跟这一次请求绑定，每次调用 handleStreamResponse 都会重新初始化 ---
      let lastContent = ''
      let newSessionId = sessionId
      // 顶层 run 的 run_id（team 自己的 run，或单 agent 模式下唯一的 run）。
      // 用它来判断某个事件是"顶层自己的"还是"某个 member agent 自己的"。
      let topRunId: string | null = null
      // 每个 member agent 自己的正文内容做增量去重时，需要各自独立的"上一次收到的完整字符串"
      const memberLastContent = new Map<string, string>()
      // <think> 内联模式的解析状态也需要按 run_id 隔离，否则 Team 和成员
      // agent 的标签流会互相污染，导致工具卡片延后或插入到错误位置。
      const inlineThinkStates = new Map<string, InlineThinkState>()
      // 团队委派工具调用会在其后紧跟嵌套 RunStarted。保留这条记录只为把
      // task 传给 member_run；委派工具卡片本身必须留在原始流式位置。
      let pendingDelegate: {
        toolCallId?: string
        parentRunId: string
        task?: string
      } | null = null

      try {
        const endpointUrl = constructEndpointUrl(selectedEndpoint)

        let RunUrl: string | null = null

        if (mode === 'team' && teamId) {
          RunUrl = APIRoutes.TeamRun(endpointUrl, teamId)
        } else if (mode === 'agent' && agentId) {
          RunUrl = APIRoutes.AgentRun(endpointUrl).replace(
            '{agent_id}',
            agentId
          )
        }

        if (!RunUrl) {
          updateMessagesWithErrorState()
          setStreamingErrorMessage('Please select an agent or team first.')
          setIsStreaming(false)
          return
        }

        formData.append('stream', 'true')
        formData.append('session_id', sessionId ?? '')

        const headers: Record<string, string> = {}
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`
        }

        await streamResponse({
          apiUrl: RunUrl,
          headers,
          requestBody: formData,
          onChunk: (chunk: RunResponse) => {
            const chunkRunId = chunk.run_id as string | undefined
            const chunkParentRunId = chunk.parent_run_id as string | undefined

            if (
              chunk.event === RunEvent.RunStarted ||
              chunk.event === RunEvent.TeamRunStarted ||
              chunk.event === RunEvent.ReasoningStarted ||
              chunk.event === RunEvent.TeamReasoningStarted
            ) {
              newSessionId = chunk.session_id as string
              setSessionId(chunk.session_id as string)
              if (
                (!sessionId || sessionId !== chunk.session_id) &&
                chunk.session_id
              ) {
                const sessionData = {
                  session_id: chunk.session_id as string,
                  session_name: formData.get('message') as string,
                  created_at: chunk.created_at
                }
                setSessionsData((prevSessionsData) => {
                  const sessionExists = prevSessionsData?.some(
                    (session) => session.session_id === chunk.session_id
                  )
                  if (sessionExists) {
                    return prevSessionsData
                  }
                  return [sessionData, ...(prevSessionsData ?? [])]
                })
              }

              // 只有真正代表"一个 run 开始了"的事件才处理 topRunId / 嵌套 member_run 创建。
              // 关键修复：Team 模式下顶层事件是 TeamRunStarted，不是 RunStarted——
              // 之前这里漏掉了 TeamRunStarted，导致 topRunId 在 Team 模式下永远是 null，
              // resolveTargetTimeline 因此把所有事件（不管属于团队自己还是子 agent）
              // 全部错误地路由回顶层 timeline，这是造成 timeline 混乱的根本原因。
              if (
                (chunk.event === RunEvent.RunStarted ||
                  chunk.event === RunEvent.TeamRunStarted) &&
                chunkRunId
              ) {
                if (!chunkParentRunId) {
                  // 顶层 run（team 自己，或单 agent 模式）第一次开始
                  if (!topRunId) topRunId = chunkRunId
                } else {
                  // *** Team 委派场景：某个成员 agent 自己的 run 开始了 ***
                  // 在它的父 run 对应的 timeline 里插入一个 member_run 节点，
                  // 后续这个子 run 自己的所有事件都会路由到这个节点自己的 timeline 里。
                  setMessages((prevMessages) => {
                    const newMessages = [...prevMessages]
                    const lastMessage = newMessages[newMessages.length - 1]
                    if (!lastMessage || lastMessage.role !== 'agent') {
                      return newMessages
                    }

                    lastMessage.timeline = lastMessage.timeline ?? []
                    const parentTimeline = resolveTargetTimeline(
                      lastMessage,
                      chunkParentRunId,
                      topRunId
                    )

                    let task: string | undefined
                    if (
                      pendingDelegate &&
                      pendingDelegate.parentRunId === chunkParentRunId
                    ) {
                      task = pendingDelegate.task
                      pendingDelegate = null
                    }

                    const memberStep: MemberRunStep = {
                      id: `member-${chunkRunId}`,
                      type: 'member_run',
                      agentId: chunk.agent_id as string | undefined,
                      agentName: (chunk as { agent_name?: string }).agent_name,
                      runId: chunkRunId,
                      task,
                      content: '',
                      timeline: [],
                      status: 'running'
                    }
                    parentTimeline.push(memberStep)

                    return newMessages
                  })
                }
              }
            } else if (
              chunk.event === RunEvent.ToolCallStarted ||
              chunk.event === RunEvent.TeamToolCallStarted ||
              chunk.event === RunEvent.ToolCallCompleted ||
              chunk.event === RunEvent.TeamToolCallCompleted ||
              chunk.event === RunEvent.ToolCallError
            ) {
              setMessages((prevMessages) => {
                const newMessages = [...prevMessages]
                const lastMessage = newMessages[newMessages.length - 1]
                if (!lastMessage || lastMessage.role !== 'agent') {
                  return newMessages
                }

                lastMessage.timeline = lastMessage.timeline ?? []
                lastMessage.tool_calls = processChunkToolCalls(
                  chunk,
                  lastMessage.tool_calls
                )

                if (chunk.tool) {
                  const targetTimeline = resolveTargetTimeline(
                    lastMessage,
                    chunkRunId,
                    topRunId
                  )
                  // Started 和 Completed 都按相同的 tool_call_id 合并：
                  // 这样 delegate_task_to_member 会一直停留在启动时的位置，
                  // 子 agent 完成后只更新为成功/失败状态，不会在末尾补插卡片。
                  upsertToolCallInTimeline(targetTimeline, chunk.tool)

                  if (
                    (chunk.event === RunEvent.ToolCallStarted ||
                      chunk.event === RunEvent.TeamToolCallStarted) &&
                    chunk.tool.tool_name === 'delegate_task_to_member'
                  ) {
                    pendingDelegate = {
                      toolCallId: chunk.tool.tool_call_id,
                      parentRunId: chunkRunId ?? '',
                      task: (chunk.tool.tool_args?.task as string) ?? undefined
                    }
                  }
                }

                return newMessages
              })
            } else if (
              chunk.event === RunEvent.RunContent ||
              chunk.event === RunEvent.TeamRunContent
            ) {
              setMessages((prevMessages) => {
                const newMessages = [...prevMessages]
                const lastMessage = newMessages[newMessages.length - 1]

                if (!lastMessage || lastMessage.role !== 'agent') {
                  return newMessages
                }

                lastMessage.timeline = lastMessage.timeline ?? []
                const runId = chunkRunId ?? topRunId ?? undefined
                const runStateKey = runId ?? '__top__'
                const isTopLevel = !topRunId || runId === topRunId
                const targetTimeline = resolveTargetTimeline(
                  lastMessage,
                  runId,
                  topRunId
                )
                const inlineThinkState = inlineThinkStates.get(runStateKey) ?? {
                  inThink: false,
                  pendingTag: ''
                }

                if (isTopLevel) {
                  // --- 顶层正文：走原来的 content/lastContent 累加逻辑 ---
                  if (typeof chunk.content === 'string') {
                    const uniqueContent = chunk.content.replace(lastContent, '')
                    lastMessage.content += uniqueContent
                    lastContent = chunk.content
                    appendInlineThinkToTimeline(
                      targetTimeline,
                      uniqueContent,
                      inlineThinkState
                    )
                  } else if (chunk.content != null) {
                    const jsonBlock = getJsonMarkdown(chunk.content)
                    lastMessage.content += jsonBlock
                    lastContent = jsonBlock
                  }
                } else if (runId) {
                  // --- 某个 member agent 自己的正文，累加到它自己的 member_run 节点上 ---
                  const member = findMemberStep(lastMessage.timeline, runId)
                  if (member && typeof chunk.content === 'string') {
                    const prevMemberContent = memberLastContent.get(runId) ?? ''
                    const uniqueContent = chunk.content.replace(
                      prevMemberContent,
                      ''
                    )
                    member.content = (member.content || '') + uniqueContent
                    memberLastContent.set(runId, chunk.content)
                    appendInlineThinkToTimeline(
                      targetTimeline,
                      uniqueContent,
                      inlineThinkState
                    )
                  }
                }
                inlineThinkStates.set(runStateKey, inlineThinkState)

                if (chunk.reasoning_content) {
                  if (isTopLevel) {
                    lastMessage.reasoning_content =
                      (lastMessage.reasoning_content || '') +
                      chunk.reasoning_content
                  }
                  appendReasoningToTimeline(
                    targetTimeline,
                    chunk.reasoning_content
                  )
                }

                if (isTopLevel) {
                  lastMessage.tool_calls = processChunkToolCalls(
                    chunk,
                    lastMessage.tool_calls
                  )
                }
                if (chunk.tool) {
                  upsertToolCallInTimeline(targetTimeline, chunk.tool)
                }

                if (isTopLevel) {
                  if (chunk.extra_data?.reasoning_steps) {
                    lastMessage.extra_data = {
                      ...lastMessage.extra_data,
                      reasoning_steps: chunk.extra_data.reasoning_steps
                    }
                  }
                  if (chunk.extra_data?.references) {
                    lastMessage.extra_data = {
                      ...lastMessage.extra_data,
                      references: chunk.extra_data.references
                    }
                  }

                  if (chunk.images) lastMessage.images = chunk.images
                  if (chunk.videos) lastMessage.videos = chunk.videos
                  if (chunk.audio) lastMessage.audio = chunk.audio

                  if (
                    chunk.response_audio?.transcript &&
                    typeof chunk.response_audio?.transcript === 'string'
                  ) {
                    const transcript = chunk.response_audio.transcript
                    lastMessage.response_audio = {
                      ...lastMessage.response_audio,
                      transcript:
                        (lastMessage.response_audio?.transcript || '') +
                        transcript
                    }
                  }
                }

                return newMessages
              })
            } else if (
              chunk.event === RunEvent.ReasoningStep ||
              chunk.event === RunEvent.TeamReasoningStep
            ) {
              // 只有顶层自己的 ReasoningStep 才更新 extra_data.reasoning_steps
              // （成员 agent 自己的推理步骤已经通过 reasoning_content/timeline 展示了）
              if (!chunkParentRunId) {
                setMessages((prevMessages) => {
                  const newMessages = [...prevMessages]
                  const lastMessage = newMessages[newMessages.length - 1]
                  if (lastMessage && lastMessage.role === 'agent') {
                    const existingSteps =
                      lastMessage.extra_data?.reasoning_steps ?? []
                    const incomingSteps =
                      chunk.extra_data?.reasoning_steps ?? []
                    lastMessage.extra_data = {
                      ...lastMessage.extra_data,
                      reasoning_steps: [...existingSteps, ...incomingSteps]
                    }
                  }
                  return newMessages
                })
              }
            } else if (
              chunk.event === RunEvent.ReasoningCompleted ||
              chunk.event === RunEvent.TeamReasoningCompleted
            ) {
              if (!chunkParentRunId) {
                setMessages((prevMessages) => {
                  const newMessages = [...prevMessages]
                  const lastMessage = newMessages[newMessages.length - 1]
                  if (lastMessage && lastMessage.role === 'agent') {
                    if (chunk.extra_data?.reasoning_steps) {
                      lastMessage.extra_data = {
                        ...lastMessage.extra_data,
                        reasoning_steps: chunk.extra_data.reasoning_steps
                      }
                    }
                  }
                  return newMessages
                })
              }
            } else if (
              chunk.event === RunEvent.RunError ||
              chunk.event === RunEvent.TeamRunError ||
              chunk.event === RunEvent.TeamRunCancelled
            ) {
              updateMessagesWithErrorState()
              const errorContent =
                (chunk.content as string) ||
                (chunk.event === RunEvent.TeamRunCancelled
                  ? 'Run cancelled'
                  : 'Error during run')
              setStreamingErrorMessage(errorContent)
            } else if (
              chunk.event === RunEvent.UpdatingMemory ||
              chunk.event === RunEvent.TeamMemoryUpdateStarted ||
              chunk.event === RunEvent.TeamMemoryUpdateCompleted
            ) {
              // No-op for now
            } else if (
              chunk.event === RunEvent.RunCompleted ||
              chunk.event === RunEvent.TeamRunCompleted
            ) {
              const isTopLevelCompletion =
                chunk.event === RunEvent.TeamRunCompleted ||
                !chunkParentRunId ||
                chunkRunId === topRunId

              if (!isTopLevelCompletion) {
                // *** 某个 member agent 自己的 run 完成了，
                // 只更新它自己对应的 member_run 节点，不动最外层消息 ***
                setMessages((prevMessages) => {
                  const newMessages = [...prevMessages]
                  const lastMessage = newMessages[newMessages.length - 1]
                  if (
                    lastMessage &&
                    lastMessage.role === 'agent' &&
                    chunkRunId
                  ) {
                    const member = findMemberStep(
                      lastMessage.timeline,
                      chunkRunId
                    )
                    if (member) {
                      if (typeof chunk.content === 'string') {
                        member.content = chunk.content
                      }
                      member.status = 'completed'
                    }
                  }
                  return newMessages
                })
              } else {
                setMessages((prevMessages) => {
                  const newMessages = prevMessages.map((message, index) => {
                    if (
                      index === prevMessages.length - 1 &&
                      message.role === 'agent'
                    ) {
                      let updatedContent: string
                      if (typeof chunk.content === 'string') {
                        updatedContent = chunk.content
                      } else {
                        try {
                          updatedContent = JSON.stringify(chunk.content)
                        } catch {
                          updatedContent = 'Error parsing response'
                        }
                      }
                      return {
                        ...message,
                        content: updatedContent,
                        reasoning_content:
                          chunk.reasoning_content ?? message.reasoning_content,
                        // timeline 是流式过程中逐步搭建起来的真实顺序记录，
                        // RunCompleted 时不应该用某个汇总字段覆盖掉它，保留原样即可。
                        timeline: message.timeline,
                        tool_calls: processChunkToolCalls(
                          chunk,
                          message.tool_calls
                        ),
                        images: chunk.images ?? message.images,
                        videos: chunk.videos ?? message.videos,
                        response_audio: chunk.response_audio,
                        created_at: chunk.created_at ?? message.created_at,
                        extra_data: {
                          reasoning_steps:
                            chunk.extra_data?.reasoning_steps ??
                            message.extra_data?.reasoning_steps,
                          references:
                            chunk.extra_data?.references ??
                            message.extra_data?.references
                        }
                      }
                    }
                    return message
                  })
                  return newMessages
                })
              }
            }
          },
          onError: (error) => {
            updateMessagesWithErrorState()
            setStreamingErrorMessage(error.message)
          },
          onComplete: () => {}
        })
      } catch (error) {
        updateMessagesWithErrorState()
        setStreamingErrorMessage(
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        focusChatInput()
        setIsStreaming(false)
      }
    },
    [
      setMessages,
      addMessage,
      updateMessagesWithErrorState,
      selectedEndpoint,
      authToken,
      streamResponse,
      agentId,
      teamId,
      mode,
      setStreamingErrorMessage,
      setIsStreaming,
      focusChatInput,
      setSessionsData,
      sessionId,
      setSessionId,
      processChunkToolCalls,
      appendReasoningToTimeline,
      upsertToolCallInTimeline
    ]
  )

  return { handleStreamResponse }
}

export default useAIChatStreamHandler
