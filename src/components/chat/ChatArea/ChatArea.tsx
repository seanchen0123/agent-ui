'use client'

import ChatInput from './ChatInput'
import MessageArea from './MessageArea'
import Icon from '@/components/ui/icon'
import ThemeToggle from '@/components/ui/ThemeToggle'

const ChatArea = ({ onMobileMenuClick }: { onMobileMenuClick?: () => void }) => {
  return (
    <main className="relative m-1.5 flex flex-grow flex-col rounded-xl bg-background border-box">
      <div className="flex items-center justify-between md:px-4 pb-1 border-b border-accent/50">
        <button
          onClick={onMobileMenuClick}
          className="md:hidden p-2 hover:bg-accent rounded-lg transition-colors"
          aria-label="Open menu"
        >
          <Icon type="menu" size="sm" />
        </button>
        <div className="flex-1" />
        <ThemeToggle />
      </div>
      <MessageArea />
      <div className="sticky bottom-0 ml-9 md:ml-9 px-4 pb-2">
        <ChatInput />
      </div>
    </main>
  )
}

export default ChatArea