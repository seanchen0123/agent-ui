'use client'
import { Button } from '@/components/ui/button'
import { ModeSelector } from '@/components/chat/Sidebar/ModeSelector'
import { EntitySelector } from '@/components/chat/Sidebar/EntitySelector'
import useChatActions from '@/hooks/useChatActions'
import { useStore } from '@/store'
import { motion } from 'framer-motion'
import { useState, useEffect } from 'react'
import Icon from '@/components/ui/icon'
import { getProviderIcon } from '@/lib/modelProvider'
import Sessions from './Sessions'
import AuthToken from './AuthToken'
import { isValidUrl } from '@/lib/utils'
import { toast } from 'sonner'
import { useQueryState } from 'nuqs'
import { truncateText } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsDesktop } from '@/hooks/useMediaQuery'

const ENDPOINT_PLACEHOLDER = 'NO ENDPOINT ADDED'
const SidebarHeader = () => (
  <div className="flex items-center gap-2">
    <Icon type="agno" size="xs" />
    <span className="text-xs font-medium uppercase">Agent UI</span>
  </div>
)

const NewChatButton = ({
  disabled,
  onClick
}: {
  disabled: boolean
  onClick: () => void
}) => (
  <Button
    onClick={onClick}
    disabled={disabled}
    size="lg"
    className="h-9 w-full rounded-xl bg-primary text-xs font-medium text-background hover:bg-primary/80"
  >
    <Icon type="plus-icon" size="xs" className="text-background" />
    <span className="uppercase">New Chat</span>
  </Button>
)

const ModelDisplay = ({ model }: { model: string }) => (
  <div className="flex h-9 w-full items-center gap-3 rounded-xl border border-primary/15 bg-accent p-3 text-xs font-medium uppercase text-muted">
    {(() => {
      const icon = getProviderIcon(model)
      return icon ? <Icon type={icon} className="shrink-0" size="xs" /> : null
    })()}
    {model}
  </div>
)

const Endpoint = () => {
  const {
    selectedEndpoint,
    isEndpointActive,
    setSelectedEndpoint,
    setAgents,
    setSessionsData,
    setMessages
  } = useStore()
  const { initialize } = useChatActions()
  const [isEditing, setIsEditing] = useState(false)
  const [endpointValue, setEndpointValue] = useState('')
  const [isMounted, setIsMounted] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [, setAgentId] = useQueryState('agent')
  const [, setSessionId] = useQueryState('session')

  useEffect(() => {
    setEndpointValue(selectedEndpoint)
    setIsMounted(true)
  }, [selectedEndpoint])

  const getStatusColor = (isActive: boolean) =>
    isActive ? 'bg-positive' : 'bg-destructive'

  const handleSave = async () => {
    if (!isValidUrl(endpointValue)) {
      toast.error('Please enter a valid URL')
      return
    }
    const cleanEndpoint = endpointValue.replace(/\/$/, '').trim()
    setSelectedEndpoint(cleanEndpoint)
    setAgentId(null)
    setSessionId(null)
    setIsEditing(false)
    setIsHovering(false)
    setAgents([])
    setSessionsData([])
    setMessages([])
  }

  const handleCancel = () => {
    setEndpointValue(selectedEndpoint)
    setIsEditing(false)
    setIsHovering(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  const handleRefresh = async () => {
    setIsRotating(true)
    await initialize()
    setTimeout(() => setIsRotating(false), 500)
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="text-xs font-medium uppercase text-primary">AgentOS</div>
      {isEditing ? (
        <div className="flex w-full items-center gap-1">
          <input
            type="text"
            value={endpointValue}
            onChange={(e) => setEndpointValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex h-9 w-full items-center text-ellipsis rounded-xl border border-primary/15 bg-accent p-3 text-xs font-medium text-muted"
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSave}
            className="hover:cursor-pointer hover:bg-transparent"
          >
            <Icon type="save" size="xs" />
          </Button>
        </div>
      ) : (
        <div className="flex w-full items-center gap-1">
          <motion.div
            className="relative flex h-9 w-full cursor-pointer items-center justify-between rounded-xl border border-primary/15 bg-accent p-3 uppercase"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onClick={() => setIsEditing(true)}
            transition={{ type: 'spring', stiffness: 400, damping: 10 }}
          >
            {isHovering ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-primary">
                  <Icon type="edit" size="xxs" /> EDIT AGENTOS
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-between px-3">
                <p className="text-xs font-medium text-muted">
                  {isMounted
                    ? truncateText(selectedEndpoint, 21) ||
                      ENDPOINT_PLACEHOLDER
                    : 'http://localhost:7777'}
                </p>
                <div
                  className={`size-2 shrink-0 rounded-full ${getStatusColor(isEndpointActive)}`}
                />
              </div>
            )}
          </motion.div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            className="hover:cursor-pointer hover:bg-transparent"
          >
            <motion.div
              key={isRotating ? 'rotating' : 'idle'}
              animate={{ rotate: isRotating ? 360 : 0 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
            >
              <Icon type="refresh" size="xs" />
            </motion.div>
          </Button>
        </div>
      )}
    </div>
  )
}

const SidebarContent = ({
  isCollapsed,
  hasEnvToken,
  envToken,
  onCloseMobileSidebar
}: {
  isCollapsed: boolean
  hasEnvToken?: boolean
  envToken?: string
  onCloseMobileSidebar?: () => void
}) => {
  const { clearChat, focusChatInput, initialize } = useChatActions()
  const {
    messages,
    selectedEndpoint,
    isEndpointActive,
    selectedModel,
    hydrated,
    isEndpointLoading,
    mode
  } = useStore()
  const [isMounted, setIsMounted] = useState(false)
  const [isConfigExpanded, setIsConfigExpanded] = useState(true)
  const [agentId] = useQueryState('agent')
  const [teamId] = useQueryState('team')

  useEffect(() => {
    setIsMounted(true)
    if (hydrated) initialize()
  }, [selectedEndpoint, initialize, hydrated, mode])

  const handleNewChat = () => {
    clearChat()
    focusChatInput()
    onCloseMobileSidebar?.()
  }

  return (
    <motion.div
      className="flex flex-col h-full w-60"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: isCollapsed ? 0 : 1, x: isCollapsed ? -20 : 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      style={{
        pointerEvents: isCollapsed ? 'none' : 'auto'
      }}
    >
      <div className="space-y-5">
        <SidebarHeader />
        <NewChatButton
          disabled={messages.length === 0}
          onClick={handleNewChat}
        />
        {isMounted && (
          <>
            <motion.div
              className="overflow-hidden"
              initial={{ height: 'auto' }}
              animate={{
                height: isConfigExpanded ? 'auto' : '32px'
              }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              <button
                onClick={() => setIsConfigExpanded(!isConfigExpanded)}
                className="flex w-full items-center justify-between py-2 text-left"
              >
                <span className="text-xs font-medium uppercase text-primary">
                  Config
                </span>
                <motion.div
                  animate={{ rotate: isConfigExpanded ? 180 : 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
                  <Icon type="chevron-up" size="xs" className="text-secondary" />
                </motion.div>
              </button>
              <div className="space-y-5 pl-3">
                <Endpoint />
                <AuthToken hasEnvToken={hasEnvToken} envToken={envToken} />
                {isEndpointActive && (
                  <motion.div
                    className="flex w-full flex-col items-start gap-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                  >
                    <div className="text-xs font-medium uppercase text-primary">
                      Mode
                    </div>
                    {isEndpointLoading ? (
                      <div className="flex w-full flex-col gap-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <Skeleton
                            key={index}
                            className="h-9 w-full rounded-xl"
                          />
                        ))}
                      </div>
                    ) : (
                      <>
                        <ModeSelector />
                        <EntitySelector />
                        {selectedModel && (agentId || teamId) && (
                          <ModelDisplay model={selectedModel} />
                        )}
                      </>
                    )}
                  </motion.div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </div>
      <div className="flex-1 overflow-hidden min-h-0 mt-4">
        {isMounted && isEndpointActive && (
          <Sessions onSessionSelect={onCloseMobileSidebar} />
        )}
      </div>
    </motion.div>
  )
}

const DesktopSidebar = ({
  hasEnvToken,
  envToken
}: {
  hasEnvToken?: boolean
  envToken?: string
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <motion.aside
      className="relative flex h-screen shrink-0 grow-0 flex-col overflow-hidden px-2 py-3 font-dmmono dark:bg-zinc-900 bg-slate-50"
      initial={{ width: '16rem' }}
      animate={{ width: isCollapsed ? '2.5rem' : '16rem' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <motion.button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute right-2 top-2 z-10 p-1"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        type="button"
        whileTap={{ scale: 0.95 }}
      >
        <Icon
          type="sheet"
          size="xs"
          className={`transform ${isCollapsed ? 'rotate-180' : 'rotate-0'}`}
        />
      </motion.button>
      <SidebarContent
        isCollapsed={isCollapsed}
        hasEnvToken={hasEnvToken}
        envToken={envToken}
      />
    </motion.aside>
  )
}

const MobileSidebar = ({
  isOpen,
  onClose,
  hasEnvToken,
  envToken
}: {
  isOpen: boolean
  onClose: () => void
  hasEnvToken?: boolean
  envToken?: string
}) => (
  <motion.aside
    className="fixed left-0 top-0 z-50 h-screen w-72 flex flex-col overflow-hidden px-2 py-3 font-dmmono bg-background/95 backdrop-blur-sm"
    initial={{ x: '-100%' }}
    animate={{ x: isOpen ? 0 : '-100%' }}
    transition={{ type: 'tween', duration: 0.3, ease: 'easeInOut' }}
  >
    <motion.button
      onClick={onClose}
      className="absolute right-2 top-2 z-10 p-1"
      aria-label="Close sidebar"
      type="button"
      whileTap={{ scale: 0.95 }}
    >
      <Icon type="x" size="sm" />
    </motion.button>
    <SidebarContent
      isCollapsed={false}
      hasEnvToken={hasEnvToken}
      envToken={envToken}
      onCloseMobileSidebar={onClose}
    />
  </motion.aside>
)

const Sidebar = ({
  hasEnvToken,
  envToken,
  isMobileSidebarOpen,
  setIsMobileSidebarOpen
}: {
  hasEnvToken?: boolean
  envToken?: string
  isMobileSidebarOpen?: boolean
  setIsMobileSidebarOpen?: (open: boolean) => void
}) => {
  const isDesktop = useIsDesktop()

  const handleCloseMobileSidebar = () => {
    setIsMobileSidebarOpen?.(false)
  }

  if (isDesktop) {
    return <DesktopSidebar hasEnvToken={hasEnvToken} envToken={envToken} />
  }

  return (
    <MobileSidebar
      isOpen={isMobileSidebarOpen ?? false}
      onClose={handleCloseMobileSidebar}
      hasEnvToken={hasEnvToken}
      envToken={envToken}
    />
  )
}

export default Sidebar