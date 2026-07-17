import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const truncateText = (text: string, limit: number) => {
  if (text) {
    return text.length > limit ? `${text.slice(0, limit)}..` : text
  }
  return ''
}

export const isValidUrl = (url: string): boolean => {
  try {
    const pattern = new RegExp(
      '^https?:\\/\\/' +
        '((([a-zA-Z\\d]([a-zA-Z\\d-]*[a-zA-Z\\d])*)\\.)+[a-zA-Z]{2,}|' +
        'localhost|' +
        '\\d{1,3}(\\.\\d{1,3}){3})' +
        '(\\:\\d+)?' +
        '(\\/[-a-zA-Z\\d%@_.~+&:]*)*' +
        '(\\?[;&a-zA-Z\\d%@_.,~+&:=-]*)?' +
        '(\\#[-a-zA-Z\\d_]*)?$',
      'i'
    )

    return pattern.test(url.trim())
  } catch {
    return false
  }
}

export const getJsonMarkdown = (content: object = {}) => {
  let jsonBlock = ''
  try {
    jsonBlock = `\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``
  } catch {
    jsonBlock = `\`\`\`\n${String(content)}\n\`\`\``
  }

  return jsonBlock
}

export interface ThinkSegment {
  type: 'think' | 'text'
  content: string
}

export const parseThinkSegments = (content: string): ThinkSegment[] => {
  const segments: ThinkSegment[] = []
  const thinkStartTag = '<think>'
  const thinkEndTag = '</think>'

  let currentIndex = 0

  while (currentIndex < content.length) {
    const startTagIndex = content.indexOf(thinkStartTag, currentIndex)

    if (startTagIndex === -1) {
      if (currentIndex < content.length) {
        segments.push({
          type: 'text',
          content: content.slice(currentIndex)
        })
      }
      break
    }

    if (startTagIndex > currentIndex) {
      segments.push({
        type: 'text',
        content: content.slice(currentIndex, startTagIndex)
      })
    }

    const endTagIndex = content.indexOf(
      thinkEndTag,
      startTagIndex + thinkStartTag.length
    )

    if (endTagIndex === -1) {
      segments.push({
        type: 'think',
        content: content.slice(startTagIndex + thinkStartTag.length)
      })
      break
    }

    segments.push({
      type: 'think',
      content: content.slice(startTagIndex + thinkStartTag.length, endTagIndex)
    })

    currentIndex = endTagIndex + thinkEndTag.length
  }

  return segments
}
