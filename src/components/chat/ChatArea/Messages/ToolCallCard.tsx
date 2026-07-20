'use client'

import { useState } from 'react'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/types/os'

interface ToolCallCardProps {
  tool: ToolCall
  index: number
}

const ToolCallCard = ({ tool, index }: ToolCallCardProps) => {
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
    // tool_call_error 是明确的布尔值时，直接采信它，不再用 result 是否为空去猜：
    // 历史数据里 result 本身也可能是空字符串/falsy 值，不代表调用还没完成。
    if (tool.tool_call_error === true) return 'error'
    if (tool.tool_call_error === false) return 'success'
    // tool_call_error 是 undefined/null，说明这是真正的直播流式调用，
    // 结果还没回来，才应该显示 loading。
    if (tool.result === undefined || tool.result === null) return 'loading'
    return 'success'
  }

  const status = getStatus()

  return (
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
              Tool Call {index + 1}
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
          'overflow-hidden transition-all duration-300',
          isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
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
  )
}

export default ToolCallCard
