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
import { parseThinkSegments, ThinkSegment } from '@/lib/utils'

interface MessageProps {
  message: ChatMessage
}

interface TimelineItem {
  type: 'think' | 'tool_call' | 'text'
  content?: string
  tool?: ToolCall
  index: number,
  source?: 'reasoning' | 'inline'
}

const parseTimeline = (message: ChatMessage): TimelineItem[] => {
  const timeline: TimelineItem[] = []

  // 优先用状态层已经按真实事件顺序记录好的 timeline
  message.timeline?.forEach((step, i) => {
    if (step.type === 'reasoning') {
      timeline.push({ type: 'think', content: step.content || '', index: i })
    } else if (step.type === 'tool_call' && step.tool) {
      timeline.push({ type: 'tool_call', tool: step.tool, index: i })
    }
  })

  // 兼容老格式：content 里内联 <think> 标签的情况仍然解析，追加在后面
  const segments = parseThinkSegments(message.content)
  for (const segment of segments) {
    if (segment.type === 'think' && segment.content.trim()) {
      timeline.push({ type: 'think', content: segment.content, index: timeline.length })
    } else if (segment.type === 'text' && segment.content.trim()) {
      timeline.push({ type: 'text', content: segment.content, index: timeline.length })
    }
  }

  return timeline
}

const AgentMessage = ({ message }: MessageProps) => {
  const { streamingErrorMessage, isStreaming } = useStore()
  let messageContent
  if (message.streamingError) {
    messageContent = (
      <p className="text-destructive">
        Oops! Something went wrong while streaming.{' '}
        {streamingErrorMessage ? (
          <>{streamingErrorMessage}</>
        ) : (
          'Please try refreshing the page or try again later.'
        )}
      </p>
    )
  } else if (message.content) {
    const timeline = parseTimeline(
      message
    )

    const renderTimelineItem = (item: TimelineItem, i: number) => {
      switch (item.type) {
        case 'think': {
          return (
            <ThinkBlock
              key={`think-${item.index}-${item.source ?? 'inline'}`}
              content={item.content || ''}
              index={item.index}
              isStreaming={isStreaming && i === timeline.length - 1}
            />
          )
        }
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
            {timeline.map((item, index) => renderTimelineItem(item, index))}
          </div>
        ) : (
          <MarkdownRenderer>{message.content}</MarkdownRenderer>
        )}
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
