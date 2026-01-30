import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Key, Check, AlertCircle, Sparkles, ExternalLink } from 'lucide-react'
import { useStore } from '../../store/useStore'

interface AISettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AISettingsModal({ isOpen, onClose }: AISettingsModalProps) {
  const { credentials, setCredentials } = useStore()
  
  const [anthropicKey, setAnthropicKey] = useState(credentials.anthropicApiKey || '')
  const [googleKey, setGoogleKey] = useState(credentials.googleAiApiKey || '')
  const [selectedProvider, setSelectedProvider] = useState<'anthropic' | 'google'>(
    credentials.aiProvider || 'anthropic'
  )
  const [saved, setSaved] = useState(false)
  
  // Sync with store on open
  useEffect(() => {
    if (isOpen) {
      setAnthropicKey(credentials.anthropicApiKey || '')
      setGoogleKey(credentials.googleAiApiKey || '')
      setSelectedProvider(credentials.aiProvider || 'anthropic')
      setSaved(false)
    }
  }, [isOpen, credentials])
  
  const handleSave = () => {
    setCredentials({
      anthropicApiKey: anthropicKey.trim() || undefined,
      googleAiApiKey: googleKey.trim() || undefined,
      aiProvider: selectedProvider,
    })
    setSaved(true)
    setTimeout(() => {
      onClose()
    }, 800)
  }
  
  const hasAnthropicKey = !!anthropicKey.trim()
  const hasGoogleKey = !!googleKey.trim()
  const hasAnyKey = hasAnthropicKey || hasGoogleKey
  
  // Check if selected provider has a key
  const selectedProviderHasKey = 
    (selectedProvider === 'anthropic' && hasAnthropicKey) ||
    (selectedProvider === 'google' && hasGoogleKey)
  
  if (!isOpen) return null
  
  return createPortal(
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-[#1a1a1f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden w-full max-w-lg pointer-events-auto animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#a5b4fc]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">AI Settings</h2>
                <p className="text-sm text-[#6a6a75]">Configure your AI API keys</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[#6a6a75] hover:text-white hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Info Banner */}
            <div className="p-4 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20">
              <p className="text-sm text-[#a5b4fc]">
                Add your own API key to power the AI generation. Your keys are stored locally and never sent to our servers.
              </p>
            </div>
            
            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium text-[#a0a0a5] mb-3">
                AI Provider
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedProvider('anthropic')}
                  className={`p-4 rounded-xl border transition-all ${
                    selectedProvider === 'anthropic'
                      ? 'border-[#6366f1] bg-[#6366f1]/10'
                      : 'border-white/10 hover:border-white/20 bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#CC785C]/20 flex items-center justify-center">
                      <span className="text-lg font-bold text-[#CC785C]">A</span>
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-medium text-white">Anthropic</div>
                      <div className="text-xs text-[#6a6a75]">Claude Sonnet</div>
                    </div>
                  </div>
                  {selectedProvider === 'anthropic' && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-[#a5b4fc]">
                      <Check className="w-3 h-3" />
                      Selected
                    </div>
                  )}
                </button>
                
                <button
                  type="button"
                  onClick={() => setSelectedProvider('google')}
                  className={`p-4 rounded-xl border transition-all ${
                    selectedProvider === 'google'
                      ? 'border-[#6366f1] bg-[#6366f1]/10'
                      : 'border-white/10 hover:border-white/20 bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#4285F4]/20 flex items-center justify-center">
                      <span className="text-lg font-bold text-[#4285F4]">G</span>
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-medium text-white">Google AI</div>
                      <div className="text-xs text-[#6a6a75]">Gemini Pro</div>
                    </div>
                  </div>
                  {selectedProvider === 'google' && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-[#a5b4fc]">
                      <Check className="w-3 h-3" />
                      Selected
                    </div>
                  )}
                </button>
              </div>
            </div>
            
            {/* Anthropic API Key */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-[#a0a0a5]">
                  Anthropic API Key
                </label>
                <a
                  href="https://console.anthropic.com/account/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#6366f1] hover:text-[#818cf8] flex items-center gap-1"
                >
                  Get API Key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a5a65]" />
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full pl-10 pr-4 py-3 bg-[#0f0f12] border border-white/10 rounded-xl text-white text-sm placeholder:text-[#4a4a55] focus:outline-none focus:border-[#6366f1] transition-colors"
                />
                {hasAnthropicKey && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
                )}
              </div>
            </div>
            
            {/* Google API Key */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-[#a0a0a5]">
                  Google AI API Key
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#6366f1] hover:text-[#818cf8] flex items-center gap-1"
                >
                  Get API Key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a5a65]" />
                <input
                  type="password"
                  value={googleKey}
                  onChange={(e) => setGoogleKey(e.target.value)}
                  placeholder="AIza..."
                  className="w-full pl-10 pr-4 py-3 bg-[#0f0f12] border border-white/10 rounded-xl text-white text-sm placeholder:text-[#4a4a55] focus:outline-none focus:border-[#6366f1] transition-colors"
                />
                {hasGoogleKey && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
                )}
              </div>
            </div>
            
            {/* Warning if no key for selected provider */}
            {!selectedProviderHasKey && hasAnyKey && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200">
                  You selected {selectedProvider === 'anthropic' ? 'Anthropic' : 'Google'} but haven't added a key for it. Add a key or switch providers.
                </p>
              </div>
            )}
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5 bg-white/[0.02]">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[#8a8a95] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saved}
              className={`px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                saved
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-[#6366f1] hover:bg-[#5558e3] text-white'
              }`}
            >
              {saved ? (
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Saved
                </span>
              ) : (
                'Save Settings'
              )}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
