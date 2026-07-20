import Icon from '@/components/ui/icon'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { useStore } from '@/store'
import type { ChatMessage, ToolCall } from '@/types/os'
import Videos from './Multimedia/Videos'
import Images from './Multimedia/Images'
import Audios from './Multimedia/Audios'
import { memo } from 'react'
import AgentThinkingLoader from './AgentThinkingLoader'
import ThinkBlock from './ThinkBlock'
import ToolCallCard from './ToolCallCard'
import { parseThinkSegments } from '@/lib/utils'

interface MessageProps {
  message: ChatMessage
}

interface TimelineItem {
  type: 'think' | 'tool_call' | 'text'
  content?: string
  tool?: ToolCall
  index: number
  source?: 'reasoning' | 'inline'
}

/**
 * 两种互斥的场景，分别处理：
 *
 * 1. reasoning_content 模式：后端把推理内容和正文分开下发，
 *    message.timeline 是流式过程中按真实事件顺序搭建起来的 (reasoning / tool_call 交替)，
 *    直接按它的顺序渲染即可，content 里不会再有 <think> 标签，只需要把纯文本部分接到最后。
 *
 * 2. inline <think> 标签模式：推理内容直接写在 content 字符串里，
 *    需要用 parseThinkSegments 从 content 里抠出来，
 *    并按"每遇到一个 think 段落，配一个工具调用"的顺序一一还原
 *    （工具调用的真实顺序仍然来自 message.timeline，如果没有则退回 message.tool_calls）。
 *
 * 用 message.timeline 里是否存在 'reasoning' 类型的条目来判断走哪种模式。
 */
const parseTimeline = (message: ChatMessage): TimelineItem[] => {
  const timeline: TimelineItem[] = []
  const hasReasoningRounds = message.timeline?.some(
    (step) => step.type === 'reasoning'
  )

  if (hasReasoningRounds) {
    let thinkIndex = 0
    let toolIndex = 0

    message.timeline?.forEach((step) => {
      if (step.type === 'reasoning') {
        timeline.push({
          type: 'think',
          content: step.content || '',
          index: thinkIndex++,
          source: 'reasoning'
        })
      } else if (step.type === 'tool_call' && step.tool) {
        timeline.push({
          type: 'tool_call',
          tool: step.tool,
          index: toolIndex++
        })
      }
    })

    const segments = parseThinkSegments(message.content)
    for (const segment of segments) {
      if (segment.type === 'text' && segment.content.trim()) {
        timeline.push({
          type: 'text',
          content: segment.content,
          index: timeline.length
        })
      }
    }
  } else {
    const toolCallsInOrder =
      message.timeline
        ?.filter((step) => step.type === 'tool_call' && step.tool)
        .map((step) => step.tool!) ??
      message.tool_calls ??
      []

    const segments = parseThinkSegments(message.content)
    let thinkIndex = 0
    let toolIndex = 0

    for (const segment of segments) {
      if (segment.type === 'think') {
        timeline.push({
          type: 'think',
          content: segment.content,
          index: thinkIndex++,
          source: 'inline'
        })
        if (toolIndex < toolCallsInOrder.length) {
          timeline.push({
            type: 'tool_call',
            tool: toolCallsInOrder[toolIndex],
            index: toolIndex++
          })
        }
      } else if (segment.content.trim()) {
        timeline.push({
          type: 'text',
          content: segment.content,
          index: timeline.length
        })
      }
    }
  }

  return timeline
}

const AgentMessage = ({ message }: MessageProps) => {
  const { streamingErrorMessage, isStreaming } = useStore()
  let messageContent

  const errorNotice = (
    <p className="text-destructive">
      Oops! Something went wrong while streaming.{' '}
      {streamingErrorMessage ? (
        <>{streamingErrorMessage}</>
      ) : (
        'Please try refreshing the page or try again later.'
      )}
    </p>
  )

  const hasContent =
    message.content || (message.timeline && message.timeline.length > 0)

  if (!hasContent && message.streamingError) {
    // 出错前完全没攒下任何内容（思考/工具调用都还没开始），只能展示纯错误提示
    messageContent = errorNotice
  } else if (hasContent) {
    const timeline = parseTimeline(message)

    const renderTimelineItem = (item: TimelineItem, position: number) => {
      switch (item.type) {
        case 'think':
          return (
            <ThinkBlock
              key={`think-${item.index}-${item.source ?? 'inline'}`}
              content={item.content || ''}
              index={item.index}
              // 只有 timeline 里最后一项才可能"正在进行中"，
              // 之前已经被工具调用打断、结束的轮次不应该再显示"思考中"动画
              isStreaming={isStreaming && position === timeline.length - 1}
            />
          )
        case 'tool_call':
          return (
            <ToolCallCard
              key={`tool-${item.index}`}
              tool={item.tool!}
              index={item.index}
            />
          )
        case 'text':
          return (
            <MarkdownRenderer key={`text-${item.index}`}>
              {item.content || ''}
            </MarkdownRenderer>
          )
        default:
          return null
      }
    }

    messageContent = (
      <div className="flex w-full flex-col gap-4">
        {timeline.length > 0 ? (
          <div className="flex flex-col gap-4">
            {timeline.map((item, position) =>
              renderTimelineItem(item, position)
            )}
          </div>
        ) : (
          <MarkdownRenderer>{message.content}</MarkdownRenderer>
        )}
        {/* 出错时不再把已经攒下的思考/工具调用链路整个丢掉，
            而是把错误提示追加展示在它下面 */}
        {message.streamingError && errorNotice}
        {message.videos && message.videos.length > 0 && (
          <Videos videos={message.videos} />
        )}
        {message.images && message.images.length > 0 && (
          <Images images={message.images} />
        )}
        {message.audio && message.audio.length > 0 && (
          <Audios audio={message.audio} />
        )}
      </div>
    )
  } else if (message.response_audio) {
    if (!message.response_audio.transcript) {
      messageContent = (
        <div className="mt-2 flex items-start">
          <AgentThinkingLoader />
        </div>
      )
    } else {
      messageContent = (
        <div className="flex w-full flex-col gap-4">
          <MarkdownRenderer>
            {message.response_audio.transcript}
          </MarkdownRenderer>
          {message.response_audio.content && message.response_audio && (
            <Audios audio={[message.response_audio]} />
          )}
        </div>
      )
    }
  } else {
    messageContent = (
      <div className="mt-2">
        <AgentThinkingLoader />
      </div>
    )
  }

  return (
    <div className="font-geist flex flex-row items-start gap-4">
      <div className="flex-shrink-0">
        <Icon type="agent" size="sm" />
      </div>
      {messageContent}
    </div>
  )
}

const UserMessage = memo(({ message }: MessageProps) => {
  return (
    <div className="flex items-start gap-4 pt-4 text-start max-md:break-words">
      <div className="flex-shrink-0">
        <Icon type="user" size="sm" />
      </div>
      <div className="text-md font-geist text-secondary rounded-lg">
        {message.content}
      </div>
    </div>
  )
})

AgentMessage.displayName = 'AgentMessage'
UserMessage.displayName = 'UserMessage'
export { AgentMessage, UserMessage }
