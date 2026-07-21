'use client'

import { useState } from 'react'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/types/os'

interface ToolCallCardProps {
  tool: ToolCall
  index: number
  isLast?: boolean
}

type ToolStatusChecker = (tool: ToolCall) => 'success' | 'error' | null

const toolStatusCheckers: Record<string, ToolStatusChecker> = {
  run_sql_query: (tool) => {
    if (tool.result === undefined || tool.result === null) return null
    const resultString = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result)
    return resultString.includes('Error running') ? 'error' : 'success'
  }
}

const ToolCallCard = ({ tool, index, isLast }: ToolCallCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  const formatArgs = () => {
    if (!tool.tool_args) return '{}'
    return JSON.stringify(tool.tool_args, null, 2)
  }

  const formatResult = () => {
    if (tool.result === undefined || tool.result === null) return 'No result'
    if (typeof tool.result === 'string') {
      try {
        const parsed = JSON.parse(tool.result)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return tool.result
      }
    }
    return JSON.stringify(tool.result, null, 2)
  }

  const duration = tool.metrics?.time
    ? ` (${tool.metrics.time.toFixed(2)}s)`
    : ''

  const getStatus = () => {
    const statusChecker = toolStatusCheckers[tool.tool_name]
    if (statusChecker) {
      const customStatus = statusChecker(tool)
      if (customStatus !== null) return customStatus
    }

    if (tool.tool_call_error === true) return 'error'
    if (tool.tool_call_error === false) return 'success'
    if (tool.result === undefined || tool.result === null) return 'loading'
    return 'success'
  }

  const status = getStatus()

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
          'border-border/50 bg-accent/20 rounded-lg border transition-all duration-200',
          isExpanded ? 'shadow-md' : 'shadow-sm',
          status === 'error' && 'border-destructive/50'
        )}
      >
        <button
          onClick={toggleExpand}
          className={cn(
            'hover:bg-accent/30 flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
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
              type="hammer"
              size="xs"
              className="hidden sm:block text-primary/80 flex-shrink-0"
            />
            <div className='flex flex-col sm:flex-row sm:gap-3 flex-1 min-w-0'>
              <span className="text-secondary text-xs font-semibold uppercase">
                Tool Call
              </span>
              <span className="font-dmmono text-primary/80 text-xs truncate">
                {tool.tool_name}
                {duration}
              </span>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {status === 'loading' && (
              <>
                <span className="bg-primary inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
                <span className="text-secondary/60 text-xs">Calling...</span>
              </>
            )}
            {status === 'success' && (
              <>
                <Icon type="check" size="xs" className="text-green-500" />
                <span className="text-xs text-green-500">Success</span>
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
            <div className="max-h-[400px] overflow-y-auto space-y-4 px-4 pb-4 pt-2">
              <div>
                <p className="text-secondary mb-2 text-xs font-semibold uppercase">
                  Arguments
                </p>
                <pre className="font-dmmono bg-background overflow-x-auto rounded-md p-3 text-xs">
                  {formatArgs()}
                </pre>
              </div>
              <div>
                <p className="text-secondary mb-2 text-xs font-semibold uppercase">
                  Result
                </p>
                <pre className="font-dmmono bg-background overflow-x-auto rounded-md p-3 text-xs">
                  {formatResult()}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ToolCallCard
