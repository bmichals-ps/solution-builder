import React, { useState, useEffect, useCallback } from 'react'
import { X, Save, Copy, Check, AlertCircle, Code2, Play, RotateCcw } from 'lucide-react'

interface ScriptEditorModalProps {
  isOpen: boolean
  onClose: () => void
  script: { name: string; content: string } | null
  onSave: (name: string, content: string) => void
  readOnly?: boolean
}

// Pypestream script template
const SCRIPT_TEMPLATE = `# -*- coding: utf-8 -*-
r'''
    ______  ______  _____________________  _________    __  ___
   / __ \\ \\/ / __ \\/ ____/ ___/_  __/ __ \\/ ____/   |  /  |/  /
  / /_/ /\\  / /_/ / __/  \\__ \\ / / / /_/ / __/ / /| | / /|_/ /
 / ____/ / / ____/ /___ ___/ // / / _, _/ /___/ ___ |/ /  / /
/_/     /_/_/   /_____//____//_/ /_/ |_/_____/_/  |_/_/  /_/
action node script
'''
import json

class {{SCRIPT_NAME}}:
    def execute(self, log, payload=None, context=None):
        try:
            log('{{SCRIPT_NAME}} starting execution')
            
            # payload = Parameter Input from CSV (dict)
            # context = {'user_data': {...}, 'chat_id': '...', 'events': [...]}
            
            # Access payload parameters
            # param_value = payload.get('param_name', 'default')
            
            # Access context data
            # user_data = context.get('user_data', {})
            # chat_id = context.get('chat_id', '')
            
            # YOUR LOGIC HERE
            result = 'success'
            
            # Return JSON - 'success' MUST be first key!
            # Output variables MUST be UPPERCASE
            return {
                'success': 'true',
                'RESULT': result
            }
            
        except Exception as err:
            log(f'{{SCRIPT_NAME}} error: {err}')
            return {'success': 'error'}
`

// Simple syntax highlighting for Python
function highlightPython(code: string): React.ReactNode[] {
  const lines = code.split('\n')
  
  const keywords = ['class', 'def', 'try', 'except', 'return', 'import', 'from', 'if', 'else', 'elif', 'for', 'while', 'in', 'not', 'and', 'or', 'True', 'False', 'None', 'self', 'as', 'with', 'raise', 'pass', 'break', 'continue', 'lambda', 'global', 'nonlocal', 'assert', 'yield', 'del', 'finally']
  const builtins = ['log', 'print', 'str', 'int', 'float', 'dict', 'list', 'tuple', 'set', 'len', 'range', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'open', 'json', 'requests', 'Exception', 'f']
  
  return lines.map((line, i) => {
    let highlighted = line
    
    // Escape HTML
    highlighted = highlighted.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    
    // Comments
    if (highlighted.trim().startsWith('#') || highlighted.includes("'''") || highlighted.includes('r\'\'\'')) {
      return <div key={i} className="text-[#6a9955]">{line}</div>
    }
    
    // Strings (simple matching)
    highlighted = highlighted.replace(/(["'])(.*?)\1/g, '<span class="text-[#ce9178]">$1$2$1</span>')
    highlighted = highlighted.replace(/(f["'])/g, '<span class="text-[#ce9178]">$1</span>')
    
    // Keywords
    keywords.forEach(kw => {
      const regex = new RegExp(`\\b(${kw})\\b`, 'g')
      highlighted = highlighted.replace(regex, '<span class="text-[#c586c0]">$1</span>')
    })
    
    // Builtins
    builtins.forEach(fn => {
      const regex = new RegExp(`\\b(${fn})\\b`, 'g')
      highlighted = highlighted.replace(regex, '<span class="text-[#dcdcaa]">$1</span>')
    })
    
    // Numbers
    highlighted = highlighted.replace(/\b(\d+)\b/g, '<span class="text-[#b5cea8]">$1</span>')
    
    return <div key={i} dangerouslySetInnerHTML={{ __html: highlighted || '&nbsp;' }} />
  })
}

// Validate script structure
function validateScript(content: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Check for class definition
  if (!content.includes('class ')) {
    errors.push('Missing class definition. Script must contain a class.')
  }
  
  // Check for execute method
  if (!content.includes('def execute(')) {
    errors.push('Missing execute method. Script must have: def execute(self, log, payload=None, context=None)')
  }
  
  // Check for return statement
  if (!content.includes('return {') && !content.includes('return{')) {
    errors.push('Missing return statement. Script must return a JSON dict with "success" key.')
  }
  
  // Check for success in return
  if (!content.includes("'success'") && !content.includes('"success"')) {
    errors.push('Return dict must include "success" key with value "true", "false", or "error".')
  }
  
  // Check for try/except
  if (!content.includes('try:') || !content.includes('except')) {
    errors.push('Script should have try/except error handling.')
  }
  
  return { valid: errors.length === 0, errors }
}

export function ScriptEditorModal({ isOpen, onClose, script, onSave, readOnly = false }: ScriptEditorModalProps) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] }>({ valid: true, errors: [] })
  
  // Initialize from script prop
  useEffect(() => {
    if (script) {
      setName(script.name)
      setContent(script.content)
      setHasChanges(false)
      setValidation(validateScript(script.content))
    } else {
      // New script
      setName('NewScript')
      setContent(SCRIPT_TEMPLATE.replace(/\{\{SCRIPT_NAME\}\}/g, 'NewScript'))
      setHasChanges(false)
      setValidation({ valid: true, errors: [] })
    }
  }, [script, isOpen])
  
  // Validate on content change
  useEffect(() => {
    if (content) {
      setValidation(validateScript(content))
    }
  }, [content])
  
  const handleNameChange = useCallback((newName: string) => {
    // Convert to CamelCase and remove invalid chars
    const cleaned = newName.replace(/[^a-zA-Z0-9]/g, '')
    const camelCase = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    setName(camelCase)
    setHasChanges(true)
    
    // Update class name in content
    setContent(prev => {
      return prev.replace(/class\s+\w+:/g, `class ${camelCase}:`)
    })
  }, [])
  
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
    setHasChanges(true)
  }, [])
  
  const handleSave = useCallback(() => {
    if (name && content) {
      onSave(name, content)
      setHasChanges(false)
    }
  }, [name, content, onSave])
  
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])
  
  const handleReset = useCallback(() => {
    if (script) {
      setContent(script.content)
      setName(script.name)
    } else {
      setContent(SCRIPT_TEMPLATE.replace(/\{\{SCRIPT_NAME\}\}/g, name || 'NewScript'))
    }
    setHasChanges(false)
  }, [script, name])
  
  if (!isOpen) return null
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0f0f14] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center gap-3">
            <Code2 className="w-5 h-5 text-emerald-400" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#8585a3]">Script:</span>
              {readOnly ? (
                <span className="text-white font-medium">{name}.py</span>
              ) : (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="bg-[#1a1a24] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-white font-medium text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="ScriptName"
                />
              )}
              <span className="text-[#8585a3]">.py</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!readOnly && hasChanges && (
              <span className="text-xs text-amber-400 mr-2">Unsaved changes</span>
            )}
            
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] text-[#8585a3] hover:text-white transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            
            {!readOnly && (
              <button
                onClick={handleReset}
                className="p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] text-[#8585a3] hover:text-white transition-colors"
                title="Reset to original"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] text-[#8585a3] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Validation Errors */}
        {!validation.valid && (
          <div className="px-5 py-3 bg-[rgba(239,68,68,0.1)] border-b border-[rgba(239,68,68,0.2)]">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-red-400 font-medium mb-1">Script validation warnings:</p>
                <ul className="text-xs text-red-300 space-y-0.5">
                  {validation.errors.map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
        
        {/* Editor Area */}
        <div className="flex-1 overflow-hidden flex">
          {/* Line Numbers */}
          <div className="w-12 bg-[#0a0a0f] border-r border-[rgba(255,255,255,0.05)] py-3 text-right pr-3 select-none overflow-hidden">
            {content.split('\n').map((_, i) => (
              <div key={i} className="text-xs text-[#505060] leading-6 font-mono">
                {i + 1}
              </div>
            ))}
          </div>
          
          {/* Code Editor */}
          <div className="flex-1 relative overflow-auto">
            {readOnly ? (
              <pre className="font-mono text-sm leading-6 p-3 text-[#d4d4d4] whitespace-pre overflow-x-auto">
                {highlightPython(content)}
              </pre>
            ) : (
              <textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                className="absolute inset-0 w-full h-full bg-transparent font-mono text-sm leading-6 p-3 text-[#d4d4d4] resize-none focus:outline-none overflow-auto"
                spellCheck={false}
                style={{ 
                  caretColor: '#fff',
                  tabSize: 4
                }}
              />
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[rgba(255,255,255,0.08)] bg-[#0a0a0f]">
          <div className="text-xs text-[#8585a3]">
            {content.split('\n').length} lines • {content.length} characters
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[#8585a3] hover:text-white transition-colors"
            >
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            
            {!readOnly && (
              <button
                onClick={handleSave}
                disabled={!name || !content || !validation.valid}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Save className="w-4 h-4" />
                Save Script
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScriptEditorModal
