import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  X, Plus, ChevronRight, FileText, Clock, 
  CheckCircle2, Archive, Rocket, LayoutDashboard,
  Menu, LogOut, User, Settings, Sparkles
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useAuth } from '../../contexts/AuthContext'
import { AISettingsModal } from './ai-settings-modal'
import type { SavedSolution } from '../../types'

// Format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return `${Math.floor(diffDays / 30)} months ago`
}

// Status badge component
function StatusBadge({ status }: { status: SavedSolution['status'] }) {
  const config = {
    draft: { icon: FileText, label: 'Draft', className: 'text-amber-400 bg-amber-400/10' },
    deployed: { icon: Rocket, label: 'Deployed', className: 'text-emerald-400 bg-emerald-400/10' },
    archived: { icon: Archive, label: 'Archived', className: 'text-gray-400 bg-gray-400/10' },
  }
  
  const { icon: Icon, label, className } = config[status]
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// Solution item in the sidebar
function SolutionItem({ solution, isActive, onClick }: { 
  solution: SavedSolution
  isActive: boolean
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl transition-all duration-200 group ${
        isActive 
          ? 'bg-[#6366f1]/20 border border-[#6366f1]/30' 
          : 'hover:bg-white/5 border border-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium truncate ${isActive ? 'text-white' : 'text-[#e0e0e5]'}`}>
            {solution.name}
          </h4>
          <p className="text-xs text-[#6a6a75] truncate mt-0.5">{solution.clientName}</p>
        </div>
        <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-transform ${
          isActive ? 'text-[#a5b4fc]' : 'text-[#4a4a55] group-hover:text-[#6a6a75]'
        }`} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <StatusBadge status={solution.status} />
        <span className="text-xs text-[#5a5a65]">{formatRelativeTime(solution.updatedAt)}</span>
      </div>
    </button>
  )
}

// Hamburger menu button
export function NavMenuButton() {
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  
  return (
    <button
      onClick={toggleSidebar}
      className="p-2 rounded-lg text-[#8a8a95] hover:text-white hover:bg-white/5 transition-colors"
      aria-label="Open navigation menu"
    >
      <Menu className="w-5 h-5" />
    </button>
  )
}

// Main navigation drawer
export function NavDrawer() {
  const navigate = useNavigate()
  const sidebarOpen = useStore((state) => state.sidebarOpen)
  const setSidebarOpen = useStore((state) => state.setSidebarOpen)
  const savedSolutions = useStore((state) => state.savedSolutions)
  const activeSolutionId = useStore((state) => state.activeSolutionId)
  const setActiveSolution = useStore((state) => state.setActiveSolution)
  const setStep = useStore((state) => state.setStep)
  const startNewSolution = useStore((state) => state.startNewSolution)
  const user = useStore((state) => state.user)
  const credentials = useStore((state) => state.credentials)
  const { signOut } = useAuth()
  
  // Handle closing animation
  const [isVisible, setIsVisible] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [showAISettings, setShowAISettings] = useState(false)
  
  // Check if AI API key is configured
  const hasAIKey = !!(credentials.anthropicApiKey || credentials.googleAiApiKey)
  
  useEffect(() => {
    if (sidebarOpen) {
      setIsVisible(true)
      setIsClosing(false)
    }
  }, [sidebarOpen])
  
  const handleClose = useCallback(() => {
    setIsClosing(true)
    // Wait for animation to complete before hiding
    setTimeout(() => {
      setSidebarOpen(false)
      setIsVisible(false)
      setIsClosing(false)
    }, 280)
  }, [setSidebarOpen])
  
  // Close immediately and navigate (no animation wait for navigation)
  const closeAndNavigate = useCallback((navigate: () => void) => {
    setSidebarOpen(false)
    setIsClosing(true)
    // Small delay for visual feedback, then navigate
    setTimeout(() => {
      setIsVisible(false)
      setIsClosing(false)
      navigate()
    }, 150)
  }, [setSidebarOpen])
  
  const handleNewSolution = () => {
    closeAndNavigate(() => {
      startNewSolution()
      navigate('/')
    })
  }
  
  const handleOpenDashboard = () => {
    closeAndNavigate(() => navigate('/dashboard'))
  }
  
  const handleSelectSolution = (solutionId: string) => {
    closeAndNavigate(() => {
      setActiveSolution(solutionId)
      navigate(`/solutions/${solutionId}`)
    })
  }
  
  // Sort solutions: deployed first, then by updated date
  const sortedSolutions = [...savedSolutions].sort((a, b) => {
    if (a.status === 'deployed' && b.status !== 'deployed') return -1
    if (a.status !== 'deployed' && b.status === 'deployed') return 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
  
  const recentSolutions = sortedSolutions.slice(0, 5)
  
  // Don't render if sidebar is closed and not in closing animation
  if (!sidebarOpen && !isVisible) return null
  
  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/60 z-40 drawer-backdrop ${isClosing ? 'closing' : ''}`}
        onClick={handleClose}
      />
      
      {/* Drawer */}
      <div className={`fixed left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-[#0f0f12] border-r border-white/10 z-50 flex flex-col drawer-panel ${isClosing ? 'closing' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <img 
              src="/pypestream-logo.png" 
              alt="Pypestream" 
              className="w-8 h-8"
            />
            <span className="text-sm font-semibold text-white">Solution Builder</span>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg text-[#6a6a75] hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* New Solution Button */}
        <div className="p-4">
          <button
            onClick={handleNewSolution}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] hover:from-[#7c7ff2] hover:to-[#9d7af7] text-white text-sm font-medium transition-all duration-200 shadow-lg shadow-[#6366f1]/20"
          >
            <Plus className="w-4 h-4" />
            New Solution
          </button>
        </div>
        
        {/* Dashboard Link */}
        <div className="px-4 pb-2">
          <button
            onClick={handleOpenDashboard}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[#a0a0a5] hover:bg-white/5 hover:text-white transition-all duration-150"
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-sm font-medium">View All Solutions</span>
            <span className="ml-auto text-xs text-[#5a5a65] bg-white/5 px-2 py-0.5 rounded-full">
              {savedSolutions.length}
            </span>
          </button>
        </div>
        
        {/* Recent Solutions */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[#5a5a65]" />
            <span className="text-xs font-medium text-[#6a6a75] uppercase tracking-wider">Recent</span>
          </div>
          
          <div className="space-y-2">
            {recentSolutions.map((solution) => (
              <SolutionItem
                key={solution.id}
                solution={solution}
                isActive={activeSolutionId === solution.id}
                onClick={() => handleSelectSolution(solution.id)}
              />
            ))}
            
            {recentSolutions.length === 0 && (
              <div className="text-center py-8">
                <FileText className="w-10 h-10 text-[#3a3a45] mx-auto mb-3" />
                <p className="text-sm text-[#6a6a75]">No solutions yet</p>
                <p className="text-xs text-[#5a5a65] mt-1">Create your first solution to get started</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Settings & User */}
        <div className="px-4 py-4 border-t border-white/5 bg-white/[0.01] space-y-2">
          {/* AI Settings Button */}
          <button
            onClick={() => setShowAISettings(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#a0a0a5] hover:text-white hover:bg-white/5 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            <span>AI Settings</span>
            {hasAIKey ? (
              <span className="ml-auto text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                Configured
              </span>
            ) : (
              <span className="ml-auto text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                Add Key
              </span>
            )}
          </button>
          
          {user.email && (
            <div className="flex items-center gap-3 pt-2">
              <div className="w-8 h-8 rounded-full bg-[rgba(99,102,241,0.15)] border border-[rgba(99,102,241,0.2)] flex items-center justify-center">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full" />
                ) : (
                  <User className="w-4 h-4 text-[#a5b4fc]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {user.name || 'User'}
                </div>
                <div className="text-xs text-[#5a5a65] truncate">
                  {user.email}
                </div>
              </div>
            </div>
          )}
          <button
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-[#8a8a95] hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
      
      {/* AI Settings Modal */}
      <AISettingsModal 
        isOpen={showAISettings} 
        onClose={() => setShowAISettings(false)} 
      />
    </>
  )
}
