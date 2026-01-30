import React, { useState, useEffect } from 'react'
import { X, Loader2, Check, ExternalLink, FileSpreadsheet, Search, Link2, AlertCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'

interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  source: 'figma' | 'sheets' | null
  onImport: (data: { source: string; file: ImportFile }) => void
}

interface ImportFile {
  id: string
  name: string
  type: string
  lastModified?: string
  thumbnail?: string
}

// Service icons
function FigmaLogo({ className }: { className?: string }) {
  return (
    <img 
      src="https://cdn.sanity.io/images/599r6htc/localized/46a76c802176eb17b04e12108de7e7e0f3736dc6-1024x1024.png" 
      alt="Figma"
      className={className}
    />
  )
}

function SheetsLogo({ className }: { className?: string }) {
  return (
    <img 
      src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png" 
      alt="Google Sheets"
      className={className}
    />
  )
}

// Figma URL Input screen - for importing Figma designs via URL
function FigmaUrlInput({ 
  onImport, 
  onClose,
  isLoading 
}: { 
  onImport: (fileKey: string, fileName: string) => void
  onClose: () => void
  isLoading: boolean
}) {
  const { credentials, setCredentials } = useStore()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [tokenInput, setTokenInput] = useState(credentials.figmaToken || '')
  
  // Parse Figma URL to extract file key
  const parseFigmaUrl = (inputUrl: string): { fileKey: string; fileName: string } | null => {
    try {
      // Handle various Figma URL formats:
      // https://www.figma.com/file/{fileKey}/{fileName}
      // https://www.figma.com/design/{fileKey}/{fileName}
      // https://www.figma.com/board/{fileKey}/{fileName} (FigJam)
      // https://figma.com/file/{fileKey}/{fileName}?node-id=...
      const patterns = [
        /figma\.com\/(?:file|design|board)\/([a-zA-Z0-9]+)\/([^?\/]+)/,
        /figma\.com\/(?:file|design|board)\/([a-zA-Z0-9]+)/,
      ]
      
      for (const pattern of patterns) {
        const match = inputUrl.match(pattern)
        if (match) {
          const fileKey = match[1]
          const fileName = match[2] ? decodeURIComponent(match[2].replace(/-/g, ' ')) : 'Figma Design'
          return { fileKey, fileName }
        }
      }
      return null
    } catch {
      return null
    }
  }
  
  const handleSubmit = () => {
    setError(null)
    
    if (!url.trim()) {
      setError('Please enter a Figma URL')
      return
    }
    
    const parsed = parseFigmaUrl(url.trim())
    if (!parsed) {
      setError('Invalid Figma URL. Please paste a link like: figma.com/design/abc123/My-Design or figma.com/board/abc123/My-Board')
      return
    }
    
    // Save the token if provided
    if (tokenInput.trim()) {
      setCredentials({ figmaToken: tokenInput.trim() })
    }
    
    onImport(parsed.fileKey, parsed.fileName)
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }
  
  return (
    <div className="flex flex-col p-6">
      {/* Icon */}
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#F24E1E] to-[#A259FF] p-0.5">
          <div className="w-full h-full rounded-2xl bg-[#0f0f12] flex items-center justify-center">
            <Link2 className="w-8 h-8 text-white" />
          </div>
        </div>
      </div>
      
      {/* Title */}
      <h3 className="text-xl font-semibold text-white text-center mb-2">Import from Figma</h3>
      <p className="text-sm text-[#6a6a75] text-center mb-6">
        Paste a Figma file URL to import the design as a bot flow
      </p>
      
      {/* URL Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-[#a0a0a5] mb-2">Figma URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://figma.com/design/... or /board/..."
          className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-[#5a5a65] focus:outline-none focus:border-[#6366f1]/50 focus:ring-1 focus:ring-[#6366f1]/25 transition-all"
          disabled={isLoading}
        />
      </div>
      
      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      
      {/* Enhanced Analysis Toggle */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowTokenInput(!showTokenInput)}
          className="flex items-center gap-2 text-sm text-[#6a6a75] hover:text-[#a5b4fc] transition-colors"
        >
          <div className={`w-4 h-4 rounded border transition-colors ${showTokenInput ? 'bg-[#6366f1] border-[#6366f1]' : 'border-[#4a4a55]'}`}>
            {showTokenInput && <Check className="w-4 h-4 text-white" />}
          </div>
          <span>Enable enhanced analysis (optional)</span>
        </button>
        
        {showTokenInput && (
          <div className="mt-3 p-4 bg-white/[0.02] border border-white/5 rounded-xl">
            <label className="block text-xs font-medium text-[#a0a0a5] mb-2">Figma Personal Access Token</label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="figd_..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-[#5a5a65] focus:outline-none focus:border-[#6366f1]/50 transition-all"
            />
            <p className="text-xs text-[#5a5a65] mt-2">
              With a token, we can extract sections, nodes, and connections directly from your Figma file.
              <a 
                href="https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#a5b4fc] hover:underline ml-1"
              >
                Get a token →
              </a>
            </p>
            {credentials.figmaToken && (
              <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <Check className="w-3 h-3" /> Token saved from previous import
              </p>
            )}
          </div>
        )}
      </div>
      
      {/* How to get URL */}
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 mb-6">
        <p className="text-xs font-medium text-[#a0a0a5] mb-2">How to get the URL:</p>
        <ol className="text-xs text-[#6a6a75] space-y-1.5">
          <li>1. Open your design in Figma</li>
          <li>2. Click "Share" in the top right</li>
          <li>3. Click "Copy link" and paste it here</li>
        </ol>
      </div>
      
      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl font-medium bg-white/5 hover:bg-white/10 text-white transition-all duration-200"
          disabled={isLoading}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!url.trim() || isLoading}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-all duration-200 ${
            url.trim() && !isLoading
              ? 'bg-[#6366f1] hover:bg-[#7c7ff2] text-white' 
              : 'bg-white/5 text-[#5a5a65] cursor-not-allowed'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Importing...</span>
            </>
          ) : (
            <span>Import Design</span>
          )}
        </button>
      </div>
    </div>
  )
}

// Authentication screen
function AuthScreen({ 
  source, 
  onConnect, 
  isConnecting,
  error
}: { 
  source: 'figma' | 'sheets'
  onConnect: () => void
  isConnecting: boolean
  error?: string | null 
}) {
  const config = {
    figma: {
      name: 'Figma',
      logo: <FigmaLogo className="w-16 h-16" />,
      color: 'from-[#F24E1E] to-[#A259FF]',
      buttonColor: 'bg-[#0d0d0d] hover:bg-[#1a1a1a] border border-white/10 text-white',
      description: 'Connect your Figma account to import bot flow designs directly into Solution Designer.',
      features: [
        'Import flow diagrams as bot nodes',
        'Sync design updates automatically',
        'Access your recent projects',
      ]
    },
    sheets: {
      name: 'Google Sheets',
      logo: <SheetsLogo className="w-16 h-16" />,
      color: 'from-[#34A853] to-[#4285F4]',
      buttonColor: 'bg-white hover:bg-gray-100 text-gray-800',
      description: 'Connect Google Sheets to import existing bot CSVs or export your solutions.',
      features: [
        'Import existing bot CSV files',
        'Export solutions to Sheets',
        'Real-time collaboration support',
      ]
    }
  }
  
  const { name, logo, color, buttonColor, description, features } = config[source]
  
  return (
    <div className="flex flex-col items-center py-8 px-6">
      {/* Logo */}
      <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${color} p-0.5 mb-6`}>
        <div className="w-full h-full rounded-2xl bg-[#0f0f12] flex items-center justify-center">
          {logo}
        </div>
      </div>
      
      {/* Title */}
      <h3 className="text-xl font-semibold text-white mb-2">Connect to {name}</h3>
      <p className="text-sm text-[#6a6a75] text-center max-w-sm mb-6">{description}</p>
      
      {/* Features */}
      <div className="w-full max-w-sm mb-8">
        {features.map((feature, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-400" />
            </div>
            <span className="text-sm text-[#a0a0a5]">{feature}</span>
          </div>
        ))}
      </div>
      
      {/* Error message */}
      {error && (
        <div className="w-full max-w-sm mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400 text-center">{error}</p>
        </div>
      )}
      
      {/* Connect button */}
      <button
        onClick={onConnect}
        disabled={isConnecting}
        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all duration-200 ${buttonColor} ${isConnecting ? 'opacity-70 cursor-not-allowed' : ''}`}
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Connecting...</span>
          </>
        ) : (
          <>
            <span>Connect with {name}</span>
            <ExternalLink className="w-4 h-4" />
          </>
        )}
      </button>
      
      {/* Privacy note */}
      <p className="text-xs text-[#5a5a65] mt-4 text-center">
        {source === 'sheets' 
          ? 'We request read and write access to import and export solutions.'
          : 'We only request read access to import your designs.'
        }
      </p>
    </div>
  )
}

// File selection screen
function FileSelector({ 
  source, 
  files, 
  onSelect,
  onClose,
  isLoading 
}: { 
  source: 'figma' | 'sheets'
  files: ImportFile[]
  onSelect: (file: ImportFile) => void
  onClose: () => void
  isLoading: boolean
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  
  const config = {
    figma: { name: 'Figma', icon: <FigmaLogo className="w-5 h-5" /> },
    sheets: { name: 'Google Sheets', icon: <SheetsLogo className="w-5 h-5" /> },
  }
  
  // Filter files by search query
  const filteredFiles = files.filter(file => 
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  // Sort files by last modified (newest first)
  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (!a.lastModified || a.lastModified === 'Unknown') return 1
    if (!b.lastModified || b.lastModified === 'Unknown') return -1
    return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
  })
  
  const handleImport = () => {
    const file = files.find(f => f.id === selectedFile)
    if (file) {
      onSelect(file)
    }
  }
  
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[300px]">
        <Loader2 className="w-8 h-8 text-[#6366f1] animate-spin mb-4" />
        <p className="text-sm text-[#6a6a75]">Loading your files...</p>
      </div>
    )
  }
  
  // Empty state - no files found or API not implemented yet
  if (files.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Empty state - no files found */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="w-16 h-16 rounded-full bg-[#6366f1]/10 flex items-center justify-center mb-4">
            <FileSpreadsheet className="w-8 h-8 text-[#a5b4fc]" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No Files Found</h3>
          <p className="text-sm text-[#6a6a75] text-center max-w-sm mb-6">
            We couldn't find any {source === 'sheets' ? 'spreadsheets' : 'design files'} in your {config[source].name} account. Create some files first, then try again.
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-medium bg-[#6366f1] hover:bg-[#7c7ff2] text-white transition-all duration-200"
          >
            Close
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col" style={{ height: '400px' }}>
      {/* Header with file count */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          {config[source].icon}
          <span className="text-sm font-medium text-white">Select from {config[source].name}</span>
        </div>
        <span className="ml-auto text-xs text-[#5a5a65]">{files.length} files</span>
      </div>
      
      {/* Search */}
      <div className="px-4 py-3 border-b border-white/5 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a5a65]" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-[#5a5a65] focus:outline-none focus:border-[#6366f1]/50 transition-colors"
          />
        </div>
      </div>
      
      {/* File list - scrollable area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-3 space-y-1.5">
          {sortedFiles.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-[#6a6a75]">
                {searchQuery ? 'No files match your search' : 'No files found'}
              </p>
            </div>
          ) : (
            sortedFiles.map((file) => (
              <button
                key={file.id}
                onClick={() => setSelectedFile(file.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 ${
                  selectedFile === file.id 
                    ? 'bg-[#6366f1]/10 border-[#6366f1]/30' 
                    : 'bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10'
                }`}
              >
                {/* Thumbnail or icon */}
                {file.thumbnail ? (
                  <img src={file.thumbnail} alt="" className="w-12 h-9 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className={`w-12 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    source === 'sheets' ? 'bg-emerald-500/10' : 'bg-purple-500/10'
                  }`}>
                    {source === 'sheets' ? (
                      <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <FigmaLogo className="w-5 h-5" />
                    )}
                  </div>
                )}
                
                {/* File info */}
                <div className="flex-1 text-left min-w-0">
                  <p className={`text-sm font-medium truncate ${selectedFile === file.id ? 'text-white' : 'text-[#e0e0e5]'}`}>
                    {file.name}
                  </p>
                  <p className="text-xs text-[#5a5a65] truncate">
                    {file.lastModified && file.lastModified !== 'Unknown' 
                      ? new Date(file.lastModified).toLocaleDateString(undefined, { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })
                      : 'Unknown date'
                    }
                  </p>
                </div>
                
                {/* Selection indicator */}
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  selectedFile === file.id 
                    ? 'bg-[#6366f1] border-[#6366f1]' 
                    : 'border-[#4a4a55]'
                }`}>
                  {selectedFile === file.id && (
                    <Check className="w-3 h-3 text-white" />
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      
      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/5 bg-white/[0.02] shrink-0">
        <button
          onClick={handleImport}
          disabled={!selectedFile}
          className={`w-full py-2.5 rounded-xl font-medium transition-all duration-200 ${
            selectedFile 
              ? 'bg-[#6366f1] hover:bg-[#7c7ff2] text-white' 
              : 'bg-white/5 text-[#5a5a65] cursor-not-allowed'
          }`}
        >
          Import Selected
        </button>
      </div>
    </div>
  )
}

export function ImportModal({ isOpen, onClose, source, onImport }: ImportModalProps) {
  const integrations = useStore((state) => state.integrations)
  const connectIntegration = useStore((state) => state.connectIntegration)
  
  const [isConnecting, setIsConnecting] = useState(false)
  const [files, setFiles] = useState<ImportFile[]>([])
  const [showFileSelector, setShowFileSelector] = useState(false)
  const [isImportingFigma, setIsImportingFigma] = useState(false)
  
  // Check if already connected to the service (only for sheets)
  const integrationId = source === 'figma' ? 'figma' : 'google-sheets'
  const existingConnection = integrations.find(i => i.id === integrationId)
  const isAlreadyConnected = existingConnection?.connected ?? false
  
  // Fetch files from connected account (only for Google Sheets)
  const fetchFiles = async () => {
    setIsLoadingFiles(true)
    try {
      const user = useStore.getState().user
      const response = await fetch('/api/composio/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrationId: 'google-sheets',
          userId: user.email || `user_${Date.now()}`
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        setFiles(data.files || [])
      } else {
        console.error('Failed to fetch files')
        setFiles([])
      }
    } catch (error) {
      console.error('Error fetching files:', error)
      setFiles([])
    }
    setIsLoadingFiles(false)
  }
  
  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && source) {
      // For Figma, we use URL input - no OAuth needed
      if (source === 'figma') {
        setShowFileSelector(false)
        setFiles([])
      } else if (source === 'sheets') {
        // For Sheets, check if already connected
        if (isAlreadyConnected) {
          setShowFileSelector(true)
          fetchFiles()
        } else {
          setShowFileSelector(false)
          setFiles([])
        }
      }
    }
  }, [isOpen, source, isAlreadyConnected])
  
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  
  // Handle connect - goes through real OAuth flow (for Sheets only)
  const handleConnect = async () => {
    if (!source || source !== 'sheets') return
    
    setIsConnecting(true)
    setAuthError(null)
    
    const success = await connectIntegration('google-sheets')
    
    if (success) {
      // OAuth completed successfully - now fetch real files
      setShowFileSelector(true)
      await fetchFiles()
    } else {
      setAuthError('Authentication failed or was cancelled. Please try again.')
    }
    
    setIsConnecting(false)
  }
  
  // Handle file selection (for Sheets)
  const handleFileSelect = (file: ImportFile) => {
    if (source) {
      onImport({ source, file })
      onClose()
    }
  }
  
  // Handle Figma URL import
  const handleFigmaImport = (fileKey: string, fileName: string) => {
    setIsImportingFigma(true)
    
    // Create a file object from the Figma URL
    const file: ImportFile = {
      id: fileKey,
      name: fileName,
      type: 'figma',
      lastModified: new Date().toISOString(),
    }
    
    onImport({ source: 'figma', file })
    setIsImportingFigma(false)
    onClose()
  }
  
  if (!isOpen || !source) return null
  
  const config = {
    figma: { name: 'Figma', color: 'from-[#F24E1E] to-[#A259FF]' },
    sheets: { name: 'Google Sheets', color: 'from-[#34A853] to-[#4285F4]' },
  }
  
  // Figma uses URL input directly (no OAuth in this app - handled by MCP)
  if (source === 'figma') {
    return (
      <>
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] animate-fade-in"
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
          <div className="bg-[#0f0f12] border border-white/10 rounded-2xl shadow-2xl overflow-hidden w-full max-w-md pointer-events-auto animate-scale-in">
            <FigmaUrlInput
              onImport={handleFigmaImport}
              onClose={onClose}
              isLoading={isImportingFigma}
            />
          </div>
        </div>
      </>
    )
  }
  
  // Google Sheets uses OAuth flow
  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] animate-fade-in"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-[#0f0f12] border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] w-full max-w-md flex flex-col pointer-events-auto animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${config[source].color} flex items-center justify-center`}>
                <SheetsLogo className="w-5 h-5" />
              </div>
              <h2 className="text-base font-semibold text-white">
                Import from {config[source].name}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[#6a6a75] hover:text-white hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {showFileSelector ? (
              <FileSelector
                source={source}
                files={files}
                onSelect={handleFileSelect}
                onClose={onClose}
                isLoading={isLoadingFiles}
              />
            ) : (
              <AuthScreen
                source={source}
                onConnect={handleConnect}
                isConnecting={isConnecting}
                error={authError}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
