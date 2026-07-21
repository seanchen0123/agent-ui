import type { ToolCall, TimelineStep } from '@/types/os'
import { parseThinkSegments } from '@/lib/utils'

export interface TimelineItem {
  type: 'think' | 'tool_call' | 'text' | 'member_run'
  content?: string
  tool?: ToolCall
  index: number
  source?: 'reasoning' | 'inline'
  durationMs?: number
  // member_run 专用字段
  memberStep?: Extract<TimelineStep, { type: 'member_run' }>
}

/**
 * 两种互斥的推理来源，分别处理（团队委派场景下，每一层——团队自己、
 * 每个成员 agent 自己——都可能各自独立走这两种模式中的一种）：
 *
 * 1. reasoning_content 模式：timeline 里有 'reasoning' 类型条目，直接按真实顺序渲染。
 * 2. inline <think> 标签模式：推理内容写在 content 字符串里，需要解析并按
 *    "每个 think 段落配一个工具调用"的顺序一一还原。
 *
 * member_run 条目（Team 委派给某个成员 agent 的执行块）在两种模式下都是
 * 直接透传，不参与 think/tool_call 的顺序推断。
 */
export const buildTimelineItems = (
  content: string,
  timeline: TimelineStep[] | undefined,
  toolCallsFallback: ToolCall[] | undefined
): TimelineItem[] => {
  const items: TimelineItem[] = []
  const hasReasoningRounds = timeline?.some((step) => step.type === 'reasoning')

  if (timeline && timeline.length > 0 && hasReasoningRounds) {
    let thinkIndex = 0
    let toolIndex = 0

    timeline.forEach((step) => {
      if (step.type === 'reasoning') {
        if (!step.content.trim()) return
        items.push({
          type: 'think',
          content: step.content || '',
          index: thinkIndex++,
          source: 'reasoning',
          durationMs: step.durationMs
        })
      } else if (step.type === 'tool_call' && step.tool) {
        items.push({
          type: 'tool_call',
          tool: step.tool,
          index: toolIndex++
        })
      } else if (step.type === 'member_run') {
        items.push({
          type: 'member_run',
          index: items.length,
          memberStep: step
        })
      }
    })

    const segments = parseThinkSegments(content)
    for (const segment of segments) {
      if (segment.type === 'text' && segment.content.trim()) {
        items.push({
          type: 'text',
          content: segment.content,
          index: items.length
        })
      }
    }
  } else if (timeline && timeline.some((step) => step.type === 'member_run')) {
    // 没有 reasoning 轮次，但是有 member_run（比如团队自己走 <think> 内联模式，
    // 只委派了成员 agent，没有自己的 reasoning_content）：
    // 按 timeline 真实顺序渲染 tool_call / member_run，think 段落再从 content 里解析补上。
    // 这里没有精确的 content offset，只能沿用「一个 think 段落后接一个动作」的
    // 兼容策略；流式模式会在 useAIStreamHandler 里把 inline think 写成 reasoning
    // timeline，因此会走上面的精确顺序分支。
    let toolIndex = 0
    let thinkIndex = 0

    const segments = parseThinkSegments(content)
    const timelineActions = timeline.filter(
      (step) => step.type === 'tool_call' || step.type === 'member_run'
    )
    const fallbackActions =
      timelineActions.length > 0
        ? timelineActions
        : (toolCallsFallback ?? []).map(
            (tool): TimelineStep => ({
              id: `tool-${tool.tool_call_id}`,
              type: 'tool_call',
              tool
            })
          )
    let actionCursor = 0

    const pushTimelineAction = (step: TimelineStep) => {
      if (step.type === 'tool_call' && step.tool) {
        items.push({
          type: 'tool_call',
          tool: step.tool,
          index: toolIndex++
        })
      } else if (step.type === 'member_run') {
        items.push({
          type: 'member_run',
          index: items.length,
          memberStep: step
        })
      }
    }

    for (const segment of segments) {
      if (segment.type === 'think') {
        if (!segment.content.trim()) continue
        items.push({
          type: 'think',
          content: segment.content,
          index: thinkIndex++,
          source: 'inline'
        })
        if (actionCursor < fallbackActions.length) {
          pushTimelineAction(fallbackActions[actionCursor])
          actionCursor++
        }
      } else if (segment.content.trim()) {
        items.push({
          type: 'text',
          content: segment.content,
          index: items.length
        })
      }
    }

    while (actionCursor < fallbackActions.length) {
      pushTimelineAction(fallbackActions[actionCursor])
      actionCursor++
    }
  } else {
    // 完全走老的 <think> 内联模式，没有任何 timeline 数据
    const toolCallsInOrder = toolCallsFallback ?? []
    const segments = parseThinkSegments(content)
    let thinkIndex = 0
    let toolIndex = 0

    for (const segment of segments) {
      if (segment.type === 'think') {
        if (!segment.content.trim()) continue
        items.push({
          type: 'think',
          content: segment.content,
          index: thinkIndex++,
          source: 'inline'
        })
        if (toolIndex < toolCallsInOrder.length) {
          items.push({
            type: 'tool_call',
            tool: toolCallsInOrder[toolIndex],
            index: toolIndex++
          })
        }
      } else if (segment.content.trim()) {
        items.push({
          type: 'text',
          content: segment.content,
          index: items.length
        })
      }
    }
  }

  return items
}
