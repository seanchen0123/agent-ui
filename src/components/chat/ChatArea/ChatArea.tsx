'use client'

import ChatInput from './ChatInput'
import MessageArea from './MessageArea'
import Icon from '@/components/ui/icon'

const ChatArea = ({ onMobileMenuClick }: { onMobileMenuClick?: () => void }) => {
  return (
    <main className="relative m-1.5 flex flex-grow flex-col rounded-xl bg-background border-box">
      <div className="md:hidden flex items-center justify-between px-4 py-2 border-b border-accent/50">
        <button
          onClick={onMobileMenuClick}
          className="p-2 hover:bg-accent rounded-lg transition-colors"
          aria-label="Open menu"
        >
          <Icon type="menu" size="sm" />
        </button>
      </div>
      <MessageArea />
      <div className="sticky bottom-0 ml-9 md:ml-9 px-4 pb-2">
        <ChatInput />
      </div>
    </main>
  )
}

export default ChatArea