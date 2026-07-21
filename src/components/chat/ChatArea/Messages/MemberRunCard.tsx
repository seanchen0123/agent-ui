'use client'

import { useState } from 'react'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { TimelineStep } from '@/types/os'
import { buildTimelineItems } from '@/lib/timelineUtils'
import ThinkBlock from './ThinkBlock'
import ToolCallCard from './ToolCallCard'

interface MemberRunCardProps {
  memberStep: Extract<TimelineStep, { type: 'member_run' }>
  index: number
  isLast?: boolean
}

/**
 * 展示 Team 委派给某个成员 agent 的一次完整执行过程。
 * 默认折叠、用户可以自由展开/收起，内部再递归渲染这个成员 agent 自己的
 * 思考轮次 / 工具调用（复用和顶层消息完全一样的 buildTimelineItems 逻辑）。
 */
const MemberRunCard = ({ memberStep, index, isLast }: MemberRunCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = () => setIsExpanded(!isExpanded)

  const status = memberStep.status ?? 'running'
  const items = buildTimelineItems(
    memberStep.content || '',
    memberStep.timeline,
    undefined
  )

  return (
    <div
      className={cn(
        // 时间线连接线：用 before/after 伪元素在卡片上下方的 gap 里各补一段竖线，
        'relative',
        "before:bg-border/40 before:absolute before:-top-2 before:left-[24px] before:h-2 before:w-px before:content-[''] first:before:hidden",
        "after:bg-border/40 after:absolute after:-bottom-2 after:left-[24px] after:h-2 after:w-px after:content-['']",
        isLast && 'after:hidden'
      )}
    >
      <div
        className={cn(
          'border-border/50 bg-primary/5 rounded-lg border transition-all duration-200',
          isExpanded ? 'shadow-md' : 'shadow-sm'
        )}
      >
        <button
          onClick={toggleExpand}
          className={cn(
            'hover:bg-primary/10 flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
            isExpanded ? 'border-border/30 border-b' : ''
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Icon
              type={isExpanded ? 'chevron-up' : 'chevron-down'}
              size="xs"
              className="text-secondary flex-shrink-0"
            />
            <Icon
              type="agent"
              size="xs"
              className="hidden sm:block text-primary/80 flex-shrink-0"
            />
            <span className="text-secondary text-xs font-semibold uppercase">
              Agent
            </span>
            <span className="font-dmmono text-primary/80 truncate text-xs">
              {memberStep.agentName || memberStep.agentId || 'member'}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {status === 'running' && (
              <>
                <span className="bg-primary inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
                <span className="text-secondary/60 text-xs">Working...</span>
              </>
            )}
            {status === 'completed' && (
              <>
                <Icon type="check" size="xs" className="text-green-500" />
                <span className="text-xs text-green-500">Done</span>
              </>
            )}
            {status === 'error' && (
              <>
                <Icon type="x" size="xs" className="text-destructive" />
                <span className="text-destructive text-xs">Error</span>
              </>
            )}
          </div>
        </button>
        <div
          className={cn(
            'grid transition-all duration-300',
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-4 px-4 pb-4 pt-3">
            {memberStep.task && (
              <div>
                <p className="text-secondary mb-2 text-xs font-semibold uppercase">
                  Task
                </p>
                <div className="bg-background rounded-md p-3 text-sm">
                  <MarkdownRenderer>{memberStep.task}</MarkdownRenderer>
                </div>
              </div>
            )}

            {items.length > 0 && (
              <div className="flex flex-col gap-4">
                {(() => {
                  const lastCardIndex = items
                    .map((item, index) => (item.type === 'think' || item.type === 'tool_call' || item.type === 'member_run') ? index : -1)
                    .filter(index => index !== -1)
                    .pop()

                  return items.map((item, position) => {
                    const isCard = item.type === 'think' || item.type === 'tool_call' || item.type === 'member_run'
                    const isLastCard = isCard && position === lastCardIndex

                    switch (item.type) {
                      case 'think':
                        return (
                          <ThinkBlock
                            key={`think-${item.index}-${item.source ?? 'inline'}`}
                            content={item.content || ''}
                            index={item.index}
                            isStreaming={
                              status === 'running' && position === items.length - 1
                            }
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
                  })
                })()}
              </div>
            )}

            {items.length === 0 && memberStep.content && (
              <MarkdownRenderer>{memberStep.content}</MarkdownRenderer>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MemberRunCard
