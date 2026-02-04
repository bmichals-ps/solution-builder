import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { 
  Plus, Paperclip, FileText, FileSpreadsheet,
  SendHorizontal, Zap, User, ChevronDown, Link2, X, Check, ExternalLink, Menu
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { NavDrawer } from './nav-drawer'

// FIGMA ICON - using official logo
function FigmaIcon({ className }: { className?: string }) {
  return (
    <img 
      src="https://cdn.sanity.io/images/599r6htc/localized/46a76c802176eb17b04e12108de7e7e0f3736dc6-1024x1024.png" 
      alt="Figma"
      className={className}
    />
  )
}

// GOOGLE DRIVE ICON - using official logo
function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <img 
      src="https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" 
      alt="Google Drive"
      className={className}
    />
  )
}

// CONNECTIONS MODAL
interface ConnectionsModalProps {
  isOpen: boolean
  onClose: () => void
}

function ConnectionsModal({ isOpen, onClose }: ConnectionsModalProps) {
  const integrations = useStore((state) => state.integrations)
  const connectIntegration = useStore((state) => state.connectIntegration)
  const setIntegrationConnected = useStore((state) => state.setIntegrationConnected)
  const [connecting, setConnecting] = useState<string | null>(null)

  const handleConnect = async (serviceId: string) => {
    setConnecting(serviceId)
    const success = await connectIntegration(serviceId)
    setConnecting(null)
  }

  const handleDisconnect = (serviceId: string) => {
    setIntegrationConnected(serviceId, false)
  }

  if (!isOpen) return null

  const services = [
    {
      id: 'google-sheets',
      name: 'Google Sheets',
      description: 'Import and export bot CSVs',
      icon: <SheetsIcon className="w-5 h-5" />,
      color: 'from-[#34A853] to-[#4285F4]'
    },
    {
      id: 'figma',
      name: 'Figma',
      description: 'Import flows from Figma designs',
      icon: <FigmaIcon className="w-5 h-5" />,
      color: 'from-[#F24E1E] to-[#A259FF]'
    },
    {
      id: 'pypestream-api',
      name: 'Pypestream Bot Manager API',
      description: 'Deploy bots directly to Pypestream',
      icon: <img src="/pypestream-logo.png" alt="Pypestream" className="w-6 h-6 rounded" />,
      color: 'from-[#6366f1] to-[#8b5cf6]'
    }
  ]

  // Use portal to render outside of any transformed ancestors
  return createPortal(
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-[#1a1a1f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden w-full max-w-md pointer-events-auto animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 flex items-center justify-center">
                <Link2 className="w-5 h-5 text-[#a5b4fc]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Connections</h2>
                <p className="text-sm text-[#6a6a75]">Connect your accounts</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[#6a6a75] hover:text-white hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Services */}
          <div className="p-4 space-y-3">
            {services.map((service) => {
              const integration = integrations.find(i => i.id === service.id)
              const isConnected = integration?.connected ?? false
              const isConnectingThis = connecting === service.id
              
              return (
                <div
                  key={service.id}
                  className={`p-4 rounded-xl border transition-all duration-200 ${
                    isConnected 
                      ? 'bg-[#22c55e]/5 border-[#22c55e]/20' 
                      : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${service.color} p-[1px]`}>
                        <div className="w-full h-full rounded-xl bg-[#1a1a1f] flex items-center justify-center text-white">
                          {service.icon}
                        </div>
                      </div>
                      <div>
                        <h3 className="text-[15px] font-medium text-white">{service.name}</h3>
                        <p className="text-[13px] text-[#6a6a75]">{service.description}</p>
                      </div>
                    </div>
                    
                    {isConnected ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 text-[13px] text-[#22c55e] font-medium">
                          <Check className="w-4 h-4" />
                          Connected
                        </span>
                        <button
                          onClick={() => handleDisconnect(service.id)}
                          className="text-[12px] text-[#6a6a75] hover:text-[#f87171] transition-colors"
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleConnect(service.id)}
                        disabled={isConnectingThis}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {isConnectingThis ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <ExternalLink className="w-4 h-4" />
                            Connect
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          
          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/5 bg-white/[0.01]">
            <p className="text-[12px] text-[#5a5a65] text-center">
              Connections are secured with OAuth 2.0
            </p>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

// ACCOUNT SETTINGS MODAL
interface AccountSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

function AccountSettingsModal({ isOpen, onClose }: AccountSettingsModalProps) {
  const user = useStore((state) => state.user)
  const setUser = useStore((state) => state.setUser)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  
  // Reset form when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setName(user.name)
      setEmail(user.email)
    }
  }, [isOpen, user.name, user.email])
  
  const handleSave = () => {
    setUser({ name, email })
    onClose()
  }

  if (!isOpen) return null

  // Use portal to render outside of any transformed ancestors
  return createPortal(
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-[#1a1a1f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden w-full max-w-md pointer-events-auto animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 flex items-center justify-center">
                <User className="w-5 h-5 text-[#a5b4fc]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Account Settings</h2>
                <p className="text-sm text-[#6a6a75]">Manage your profile</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[#6a6a75] hover:text-white hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Profile Picture */}
          <div className="px-6 py-5 border-b border-white/5">
            <div className="flex items-center gap-4">
              <img 
                src={user.avatar} 
                alt={user.name}
                className="w-16 h-16 rounded-xl object-cover"
              />
              <div>
                <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium text-white transition-colors">
                  Change Photo
                </button>
                <p className="text-xs text-[#5a5a65] mt-1.5">JPG, PNG or GIF. Max 2MB.</p>
              </div>
            </div>
          </div>
          
          {/* Form */}
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#a0a0a5] mb-1.5">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-[#5a5a65] focus:outline-none focus:border-[#6366f1]/50 focus:ring-1 focus:ring-[#6366f1]/25 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#a0a0a5] mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-[#5a5a65] focus:outline-none focus:border-[#6366f1]/50 focus:ring-1 focus:ring-[#6366f1]/25 transition-all"
              />
            </div>
          </div>
          
          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/5 bg-white/[0.01] flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[#a0a0a5] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#7c7ff2] text-sm font-medium text-white transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

// ACCOUNT DROPDOWN
function AccountDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [showConnections, setShowConnections] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  
  // Get user from global store
  const user = useStore((state) => state.user)

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all duration-200"
        >
          <img 
            src={user.avatar} 
            alt={user.name}
            className="w-8 h-8 rounded-lg object-cover"
          />
          <span className="text-sm font-medium text-[#e8e8f0] hidden sm:block">{user.name}</span>
          <ChevronDown className={`w-4 h-4 text-[#8a8a95] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <div className="absolute right-0 top-full mt-2 z-50 min-w-[220px] bg-[#1a1a1f]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              {/* User info header */}
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <img 
                    src={user.avatar} 
                    alt={user.name}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{user.name}</p>
                    <p className="text-xs text-[#6a6a75] truncate">{user.email}</p>
                  </div>
                </div>
              </div>
              
              {/* Menu items */}
              <div className="p-1.5">
                <button
                  onClick={() => {
                    setIsOpen(false)
                    setShowConnections(true)
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#a0a0a5] hover:bg-white/5 hover:text-white transition-all duration-150"
                >
                  <Link2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Connections</span>
                </button>
                <button
                  onClick={() => {
                    setIsOpen(false)
                    setShowSettings(true)
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#a0a0a5] hover:bg-white/5 hover:text-white transition-all duration-150"
                >
                  <User className="w-4 h-4" />
                  <span className="text-sm font-medium">Account Settings</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      
      <ConnectionsModal 
        isOpen={showConnections} 
        onClose={() => setShowConnections(false)} 
      />
      
      <AccountSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  )
}

// GOOGLE SHEETS ICON - using official logo
function SheetsIcon({ className }: { className?: string }) {
  return (
    <img 
      src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png" 
      alt="Google Sheets"
      className={className}
    />
  )
}

// ANIMATED EXAMPLES
const examplePrompts = [
  "Build a claims bot for Travelers Insurance that collects policy info and incident details...",
  "Create a customer support bot that helps users troubleshoot account issues...",
  "Design an FAQ bot for a healthcare company with appointment scheduling...",
  "Build a lead qualification bot for a real estate agency...",
  "Create a survey bot to collect customer feedback after purchases...",
]

function useAnimatedPlaceholder(examples: string[], typingSpeed = 50, pauseDuration = 2000) {
  const [displayText, setDisplayText] = useState('')
  const [exampleIndex, setExampleIndex] = useState(0)
  const [isTyping, setIsTyping] = useState(true)
  const [charIndex, setCharIndex] = useState(0)

  useEffect(() => {
    const currentExample = examples[exampleIndex]
    
    if (isTyping) {
      if (charIndex < currentExample.length) {
        const timeout = setTimeout(() => {
          setDisplayText(currentExample.slice(0, charIndex + 1))
          setCharIndex(charIndex + 1)
        }, typingSpeed)
        return () => clearTimeout(timeout)
      } else {
        // Finished typing, pause then start deleting
        const timeout = setTimeout(() => {
          setIsTyping(false)
        }, pauseDuration)
        return () => clearTimeout(timeout)
      }
    } else {
      if (charIndex > 0) {
        const timeout = setTimeout(() => {
          setDisplayText(currentExample.slice(0, charIndex - 1))
          setCharIndex(charIndex - 1)
        }, typingSpeed / 2)
        return () => clearTimeout(timeout)
      } else {
        // Finished deleting, move to next example
        setExampleIndex((exampleIndex + 1) % examples.length)
        setIsTyping(true)
      }
    }
  }, [charIndex, isTyping, exampleIndex, examples, typingSpeed, pauseDuration])

  return displayText
}

// CHAT INPUT
function ChatInput({ onSend, isProcessing = false }: {
  onSend?: (message: string) => void
  isProcessing?: boolean
}) {
  const [message, setMessage] = useState('')
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const animatedPlaceholder = useAnimatedPlaceholder(examplePrompts)

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [message])

  const handleSubmit = () => {
    if (message.trim() && !isProcessing) {
      onSend?.(message)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="relative w-full max-w-[680px] mx-auto">
      {/* Gradient border effect */}
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-white/[0.12] to-transparent pointer-events-none" />
      
      {/* Main container */}
      <div className="relative rounded-2xl bg-[#18181f] ring-1 ring-white/[0.08] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_4px_32px_rgba(0,0,0,0.5)]">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={isFocused ? "Describe your bot..." : animatedPlaceholder}
            disabled={isProcessing}
            className="w-full resize-none bg-transparent text-[15px] text-white placeholder-[#4a4a55] px-5 pt-5 pb-3 focus:outline-none min-h-[120px] max-h-[200px] disabled:opacity-50"
            style={{ height: '120px' }}
          />
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-1">
            {/* Attach button */}
            <div className="relative">
              <button
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                disabled={isProcessing}
                className="flex items-center justify-center size-8 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-[#7a7a85] hover:text-white transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                <Plus className={`size-4 transition-transform duration-200 ${showAttachMenu ? 'rotate-45' : ''}`} />
              </button>

              {showAttachMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAttachMenu(false)} />
                  <div className="absolute bottom-full left-0 mb-2 z-50 bg-[#1a1a1f]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="p-1.5 min-w-[180px]">
                      {[
                        { icon: <Paperclip className="size-4" />, label: 'Upload file' },
                        { icon: <FileText className="size-4" />, label: 'Add document' },
                        { icon: <FileSpreadsheet className="size-4" />, label: 'Import CSV' }
                      ].map((item, i) => (
                        <button key={i} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[#9a9aa5] hover:bg-white/5 hover:text-white transition-all duration-150">
                          {item.icon}
                          <span className="text-sm">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

          </div>

          <div className="flex-1" />

          {/* Character count */}
          {message.length > 0 && (
            <span className="text-[11px] text-[#4a4a55] mr-3">
              {message.length} chars
            </span>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={!message.trim() || isProcessing}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-[#6366f1] hover:bg-[#7c7ff2] text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-[0_0_24px_rgba(99,102,241,0.35)]"
          >
            {isProcessing ? (
              <>
                <span className="hidden sm:inline">Analyzing...</span>
                <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Continue</span>
                <SendHorizontal className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// RAY BACKGROUND - Pypestream branded
function RayBackground() {
  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none">
      {/* Base dark background */}
      <div className="absolute inset-0 bg-[#0a0a0f]" />
      
      {/* Main glow */}
      <div 
        className="absolute left-1/2 -translate-x-1/2 w-[4000px] h-[1800px] sm:w-[6000px]"
        style={{
          background: `radial-gradient(circle at center 800px, rgba(99, 102, 241, 0.6) 0%, rgba(99, 102, 241, 0.25) 14%, rgba(99, 102, 241, 0.12) 18%, rgba(99, 102, 241, 0.05) 22%, rgba(10, 10, 15, 0.2) 25%)`
        }}
      />
      
      {/* Concentric rings */}
      <div 
        className="absolute top-[175px] left-1/2 w-[1600px] h-[1600px] sm:top-1/2 sm:w-[3043px] sm:h-[2865px]"
        style={{ transform: 'translate(-50%) rotate(180deg)' }}
      >
        <div className="absolute w-full h-full rounded-full -mt-[13px]" style={{ background: 'radial-gradient(43.89% 25.74% at 50.02% 97.24%, #0f0f14 0%, #0a0a0f 100%)', border: '16px solid white', transform: 'rotate(180deg)', zIndex: 5 }} />
        <div className="absolute w-full h-full rounded-full bg-[#0a0a0f] -mt-[11px]" style={{ border: '23px solid #c7d2fe', transform: 'rotate(180deg)', zIndex: 4 }} />
        <div className="absolute w-full h-full rounded-full bg-[#0a0a0f] -mt-[8px]" style={{ border: '23px solid #a5b4fc', transform: 'rotate(180deg)', zIndex: 3 }} />
        <div className="absolute w-full h-full rounded-full bg-[#0a0a0f] -mt-[4px]" style={{ border: '23px solid #818cf8', transform: 'rotate(180deg)', zIndex: 2 }} />
        <div className="absolute w-full h-full rounded-full bg-[#0a0a0f]" style={{ border: '20px solid #6366f1', boxShadow: '0 -15px 24.8px rgba(99, 102, 241, 0.6)', transform: 'rotate(180deg)', zIndex: 1 }} />
      </div>
    </div>
  )
}

// ANNOUNCEMENT BADGE
function AnnouncementBadge({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div 
      className="relative inline-flex items-center gap-2 px-4 py-2 min-h-[36px] rounded-full text-sm overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
        backdropFilter: 'blur(20px) saturate(140%)',
        boxShadow: 'inset 0 1px rgba(255,255,255,0.15), inset 0 -1px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.06)'
      }}
    >
      {/* Top highlight */}
      <span className="absolute top-0 left-0 right-0 h-1/2 pointer-events-none opacity-60 mix-blend-overlay" style={{ background: 'radial-gradient(ellipse at center top, rgba(255, 255, 255, 0.1) 0%, transparent 70%)' }} />
      
      {/* Top gradient line */}
      <span className="absolute -top-px left-1/2 -translate-x-1/2 h-[2px] w-[80px] opacity-50" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(99, 102, 241, 0.8) 20%, rgba(139, 92, 246, 0.8) 50%, rgba(99, 102, 241, 0.8) 80%, transparent 100%)', filter: 'blur(0.5px)' }} />
      
      {icon || <Zap className="size-3.5 text-[#a5b4fc]" />}
      <span className="text-[#e8e8f0] font-medium text-[13px]">{text}</span>
    </div>
  )
}

// IMPORT BUTTONS
function ImportButtons({ onImport }: { onImport?: (source: string) => void }) {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 justify-center">
      <span className="text-sm text-[#5a5a65]">or import from</span>
      <div className="flex gap-2">
        {[
          { id: 'figma', name: 'Figma', icon: <FigmaIcon className="size-4" /> },
          { id: 'sheets', name: 'Google Sheets', icon: <SheetsIcon className="size-4" /> }
        ].map((option) => (
          <button
            key={option.id}
            onClick={() => onImport?.(option.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/8 bg-[#0f0f14] hover:bg-[#1a1a20] text-[#8a8a95] hover:text-white transition-all duration-200 active:scale-95"
          >
            {option.icon}
            <span>{option.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}


// BOT TYPE OPTIONS
const BOT_TYPES = [
  { id: 'claims', label: 'Claims & FNOL', description: 'First notice of loss, claim filing' },
  { id: 'support', label: 'Customer Support', description: 'FAQ, troubleshooting, account help' },
  { id: 'sales', label: 'Sales & Lead Gen', description: 'Qualification, scheduling, quotes' },
  { id: 'onboarding', label: 'Onboarding', description: 'New customer setup, welcome flows' },
  { id: 'billing', label: 'Billing & Payments', description: 'Payment processing, invoices' },
  { id: 'appointments', label: 'Scheduling', description: 'Appointment booking, reminders' },
  { id: 'feedback', label: 'Feedback & Surveys', description: 'NPS, CSAT, reviews' },
  { id: 'custom', label: 'Custom', description: 'Build from scratch' },
]

// BOT TYPE DROPDOWN
function BotTypeDropdown({ 
  value, 
  onChange 
}: { 
  value: string
  onChange: (type: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const selectedType = BOT_TYPES.find(t => t.id === value)
  const displayLabel = value === 'custom' ? 'Select type...' : selectedType?.label || 'Select type...'
  
  const handleOpen = () => {
    if (buttonRef.current) {
      setButtonRect(buttonRef.current.getBoundingClientRect())
    }
    setIsOpen(!isOpen)
  }
  
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] hover:ring-white/[0.1] transition-all text-left"
      >
        <span className={`text-[15px] truncate ${value === 'custom' ? 'text-[#6a6a75]' : 'text-white'}`}>{displayLabel}</span>
        <ChevronDown className={`w-4 h-4 text-[#6a6a75] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && buttonRect && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setIsOpen(false)} />
          <div 
            className="fixed z-[201] bg-[#1a1a1f] border border-white/10 rounded-xl shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 max-h-[320px] overflow-y-auto"
            style={{
              top: buttonRect.bottom + 8,
              left: buttonRect.left,
              width: buttonRect.width,
            }}
          >
            <div className="p-1.5">
              {BOT_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    onChange(type.id)
                    setIsOpen(false)
                  }}
                  className={`w-full flex flex-col gap-0.5 px-3 py-2.5 rounded-lg transition-all duration-150 text-left ${
                    value === type.id 
                      ? 'bg-[#6366f1]/20 text-white' 
                      : 'text-[#a0a0a5] hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="text-sm font-medium">{type.label}</span>
                  <span className="text-xs text-[#5a5a65]">{type.description}</span>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// SOLUTION BUILDER FORM - matches original chat input style
function SolutionBuilderForm({
  companyUrl,
  onCompanyUrlChange,
  botType,
  onBotTypeChange,
  additionalInfo,
  onAdditionalInfoChange,
  brandInfo,
  isProcessing,
  onSubmit
}: {
  companyUrl: string
  onCompanyUrlChange: (url: string) => void
  botType: string
  onBotTypeChange: (type: string) => void
  additionalInfo: string
  onAdditionalInfoChange: (info: string) => void
  brandInfo: { name: string; logo: string; color: string } | null
  isProcessing: boolean
  onSubmit: () => void
}) {
  const [isFocused, setIsFocused] = useState(false)
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isProcessing) {
      e.preventDefault()
      onSubmit()
    }
  }
  
  return (
    <div className="relative w-full max-w-[680px] mx-auto">
      {/* Gradient border effect - same as original */}
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-white/[0.12] to-transparent pointer-events-none" />
      
      {/* Main container - same style as original ChatInput */}
      <div className="relative rounded-2xl bg-[#18181f] ring-1 ring-white/[0.08] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_4px_32px_rgba(0,0,0,0.5)]">
        
        {/* Top row: Company URL + Bot Type */}
        <div className="flex flex-col sm:flex-row gap-3 p-4 pb-3">
          {/* Company URL input */}
          <div className="flex-1 relative">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-4 py-2.5 ring-1 ring-white/[0.06] hover:ring-white/[0.1] transition-all">
              <span className="text-[#5a5a65] text-sm shrink-0">https://</span>
              <input
                type="text"
                value={companyUrl}
                onChange={(e) => onCompanyUrlChange(e.target.value)}
                placeholder="company.com"
                className="flex-1 bg-transparent text-[15px] text-white placeholder-[#4a4a55] focus:outline-none min-w-0"
              />
              {brandInfo && (
                <div className="flex items-center gap-2 shrink-0">
                  <img 
                    src={brandInfo.logo} 
                    alt={brandInfo.name}
                    className="w-5 h-5 rounded object-contain"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                  <Check className="w-4 h-4 text-[#22c55e]" />
                </div>
              )}
              {!brandInfo && companyUrl && companyUrl.includes('.') && (
                <div className="w-4 h-4 border-2 border-[#6366f1]/30 border-t-[#6366f1] rounded-full animate-spin shrink-0" />
              )}
            </div>
          </div>
          
          {/* Bot Type dropdown */}
          <div className="sm:w-[200px]">
            <BotTypeDropdown value={botType} onChange={onBotTypeChange} />
          </div>
        </div>
        
        {/* Brand indicator */}
        {brandInfo && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: brandInfo.color }} />
            <span className="text-xs text-[#6a6a75]">
              <span className="text-[#22c55e] font-medium">✓</span> {brandInfo.name} branding detected
            </span>
          </div>
        )}
        
        {/* Additional details textarea */}
        <div className="relative px-4">
          <textarea
            value={additionalInfo}
            onChange={(e) => onAdditionalInfoChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Add any specific requirements, integrations, or features... (optional)"
            disabled={isProcessing}
            className="w-full resize-none bg-transparent text-[15px] text-white placeholder-[#4a4a55] py-3 focus:outline-none min-h-[80px] max-h-[150px] disabled:opacity-50"
          />
        </div>

        {/* Bottom bar - same layout as original */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#5a5a65]">
              <Zap className="w-3.5 h-3.5 text-[#6366f1]" />
              <span>AI-powered</span>
            </div>
          </div>

          <div className="flex-1" />

          {/* Submit button - same style as original */}
          <button
            onClick={onSubmit}
            disabled={!companyUrl.trim() || isProcessing}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-[#6366f1] hover:bg-[#7c7ff2] text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-[0_0_24px_rgba(99,102,241,0.35)]"
          >
            {isProcessing ? (
              <>
                <span className="hidden sm:inline">Building...</span>
                <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Build Solution</span>
                <SendHorizontal className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// MAIN HERO CHAT COMPONENT
interface HeroChatProps {
  title?: string
  highlightedWord?: string
  subtitle?: string
  announcementText?: string
  isProcessing?: boolean
  onSend?: (message: string, companyUrl?: string, botType?: string) => void
  onImport?: (source: string) => void
  onCompanyUrlChange?: (url: string) => void
  companyUrl?: string
  brandInfo?: { name: string; logo: string; color: string } | null
}

export function HeroChat({
  title = "What will you",
  highlightedWord = "build",
  subtitle = "Enter your company website, select a solution type, and add details.",
  announcementText = "AI-Powered Bot Design",
  isProcessing = false,
  onSend,
  onImport,
  onCompanyUrlChange,
  companyUrl = '',
  brandInfo = null
}: HeroChatProps) {
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  const [localCompanyUrl, setLocalCompanyUrl] = useState(companyUrl)
  const [botType, setBotType] = useState('custom')
  const [additionalInfo, setAdditionalInfo] = useState('')
  
  const handleUrlChange = useCallback((url: string) => {
    setLocalCompanyUrl(url)
    onCompanyUrlChange?.(url)
  }, [onCompanyUrlChange])
  
  const handleSubmit = useCallback(() => {
    // Build a description from the bot type and additional info
    const selectedType = BOT_TYPES.find(t => t.id === botType)
    const description = additionalInfo.trim() 
      ? `${selectedType?.label} bot: ${additionalInfo.trim()}`
      : `${selectedType?.label} bot for customer service`
    onSend?.(description, localCompanyUrl, botType)
  }, [onSend, localCompanyUrl, botType, additionalInfo])
  
  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen w-full overflow-hidden">
      <RayBackground />
      <NavDrawer />
      
      {/* Header / Logo */}
      <div className="absolute top-0 left-0 right-0 z-20 px-8 py-6 animate-element">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-4">
            {/* Menu button */}
            <button
              onClick={toggleSidebar}
              className="p-2 -ml-2 rounded-xl text-[#8a8a95] hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu className="w-6 h-6" />
            </button>
            
            <img 
              src="/pypestream-logo.png" 
              alt="Pypestream" 
              className="w-12 h-12 rounded-xl shadow-lg"
            />
            <div className="flex flex-col">
              <span className="text-white font-bold text-xl tracking-[-0.02em]">Ben's Solution Builder</span>
              <span className="text-[#6a6a75] text-sm font-medium">DEMO for Pypestream</span>
            </div>
          </div>
          
          {/* Account dropdown */}
          <AccountDropdown />
        </div>
      </div>
      
      {/* Content container */}
      <div className="relative z-10 flex flex-col items-center justify-center w-full px-4 -mt-8">
        {/* Title section */}
        <div className="text-center mb-8 animate-hero animate-hero-delay-1">
          <h1 className="text-[2rem] sm:text-[2.5rem] md:text-[2.75rem] font-bold text-white tracking-[-0.02em] mb-3 flex items-baseline justify-center gap-[0.3em]">
            <span>{title}</span>
            <span className="text-[#a5b4fc] italic overflow-visible pr-[0.15em]">
              {highlightedWord}
            </span>
            <span>today?</span>
          </h1>
          <p className="text-sm sm:text-base font-medium text-[#7a7a85] whitespace-nowrap">{subtitle}</p>
        </div>

        {/* Solution Builder Form */}
        <div className="w-full max-w-[700px] mb-8 animate-hero animate-hero-delay-2">
          <SolutionBuilderForm
            companyUrl={localCompanyUrl}
            onCompanyUrlChange={handleUrlChange}
            botType={botType}
            onBotTypeChange={setBotType}
            additionalInfo={additionalInfo}
            onAdditionalInfoChange={setAdditionalInfo}
            brandInfo={brandInfo}
            isProcessing={isProcessing}
            onSubmit={handleSubmit}
          />
        </div>

        {/* Import buttons */}
        <div className="animate-hero animate-hero-delay-3">
          <ImportButtons onImport={onImport} />
        </div>
      </div>
    </div>
  )
}

export default HeroChat
