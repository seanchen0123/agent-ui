import Icon from '@/components/ui/icon'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { useStore } from '@/store'
import type { ChatMessage } from '@/types/os'
import Videos from './Multimedia/Videos'
import Images from './Multimedia/Images'
import Audios from './Multimedia/Audios'
import { memo } from 'react'
import AgentThinkingLoader from './AgentThinkingLoader'
import ThinkBlock from './ThinkBlock'
import ToolCallCard from './ToolCallCard'
import MemberRunCard from './MemberRunCard'
import { buildTimelineItems } from '@/lib/timelineUtils'

interface MessageProps {
  message: ChatMessage
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
    const timeline = buildTimelineItems(
      message.content,
      message.timeline,
      message.tool_calls
    )

    const lastCardIndex = timeline
      .map((item, index) => (item.type === 'think' || item.type === 'tool_call' || item.type === 'member_run') ? index : -1)
      .filter(index => index !== -1)
      .pop()

    const renderTimelineItem = (
      item: ReturnType<typeof buildTimelineItems>[number],
      position: number
    ) => {
      const isCard = item.type === 'think' || item.type === 'tool_call' || item.type === 'member_run'
      const isLastCard = isCard && position === lastCardIndex

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
              durationMs={item.durationMs}
              isLast={isLastCard}
            />
          )
        case 'tool_call':
          return (
            <ToolCallCard
              key={`tool-${item.index}`}
              tool={item.tool!}
              index={item.index}
              isLast={isLastCard}
            />
          )
        case 'member_run':
          return (
            <MemberRunCard
              key={`member-${item.memberStep!.runId}`}
              memberStep={item.memberStep!}
              index={item.index}
              isLast={isLastCard}
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
      <div className="flex w-full flex-col gap-4 min-w-0">
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
        <div className="flex w-full flex-col gap-4 min-w-0">
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
