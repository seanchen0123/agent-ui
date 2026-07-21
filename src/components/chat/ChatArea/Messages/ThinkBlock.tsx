'use client'

import { useState } from 'react'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface ThinkBlockProps {
  content: string
  index: number
  isStreaming?: boolean
  durationMs?: number
  isLast?: boolean
}

const formatDuration = (ms?: number) => {
  if (ms === undefined || ms === null) return null
  const seconds = Math.max(1, Math.round(ms / 1000))
  return `Thought for ${seconds}s`
}

const ThinkBlock = ({
  content,
  index,
  isStreaming,
  durationMs,
  isLast
}: ThinkBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  const durationLabel = formatDuration(durationMs)

  return (
    <div
      className={cn(
        // 时间线连接线：用 before/after 伪元素在卡片上下方的 gap 里各补一段竖线，
        // first:before:hidden 隐藏第一个卡片的顶部连接线，isLast 控制隐藏底部连接线。
        'relative',
        "before:bg-border/40 before:absolute before:-top-2 before:left-[24px] before:h-2 before:w-px before:content-[''] first:before:hidden",
        "after:bg-border/40 after:absolute after:-bottom-2 after:left-[24px] after:h-2 after:w-px after:content-['']",
        isLast && 'after:hidden'
      )}
    >
      <div
        className={cn(
          'border-border/50 bg-background-secondary/50 rounded-lg border transition-all duration-200',
          isExpanded ? 'shadow-md' : 'shadow-sm'
        )}
      >
        <button
          onClick={toggleExpand}
          className={cn(
            'hover:bg-background-secondary/30 flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
            isExpanded ? 'border-border/30 border-b' : ''
          )}
        >
          <div className="flex items-center gap-3">
            <Icon
              type={isExpanded ? 'chevron-up' : 'chevron-down'}
              size="xs"
              className="text-secondary flex-shrink-0"
            />
            <Icon
              type="sparkles"
              size="xs"
              className="text-primary/80 hidden flex-shrink-0 sm:block"
            />
            <span className="text-secondary text-xs font-semibold uppercase">
              Think
            </span>
          </div>
          {isStreaming ? (
            <div className="flex items-center gap-1">
              <span className="bg-primary inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
              <span className="text-secondary/60 text-xs">Thinking...</span>
            </div>
          ) : (
            durationLabel ? (
              <span className="text-secondary/60 text-xs">{durationLabel}</span>
            ) : (
              <div className="flex items-center gap-1">  
                <Icon type="check" size="xs" className="text-green-500" />
                <span className="text-xs text-green-500">Done</span>
              </div>
            )
          )}
        </button>
        <div
          className={cn(
            'grid transition-all duration-300',
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto px-4 pb-4 pt-2">
              <MarkdownRenderer>{content}</MarkdownRenderer>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ThinkBlock
