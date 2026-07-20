'use client'

import { useState } from 'react'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface ThinkBlockProps {
  content: string
  index: number
  isStreaming?: boolean
}

const ThinkBlock = ({ content, index, isStreaming }: ThinkBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  return (
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
          <span className="text-secondary text-xs font-semibold uppercase">
            Thinking {index + 1}
          </span>
        </div>
        {isStreaming && (
          <div className="flex items-center gap-1">
            <span className="bg-primary inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
            <span className="text-secondary/60 text-xs">Thinking...</span>
          </div>
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
  )
}

export default ThinkBlock
