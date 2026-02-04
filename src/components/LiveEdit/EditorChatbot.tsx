/**
 * Editor Chatbot Component
 * 
 * AI-powered chatbot for editing the bot through natural language.
 * Shows conversation history, context, and edit results.
 */

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, AlertCircle, Check, Loader2, History, Code } from 'lucide-react';
import { processEditRequest } from '../../services/edit-engine';
import type { 
  ConversationContext, 
  EditResult, 
  EditorMessage, 
  LiveEditSession 
} from '../../types';

interface EditorChatbotProps {
  session: LiveEditSession | null;
  context: ConversationContext;
  onEditComplete: (result: EditResult) => Promise<void>;
  isRedeploying: boolean;
}

export function EditorChatbot({
  session,
  context,
  onEditComplete,
  isRedeploying
}: EditorChatbotProps) {
  const [messages, setMessages] = useState<EditorMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm your bot editor assistant. Tell me what changes you'd like to make, and I'll update the bot for you.\n\nExamples:\n• \"Change the welcome message to 'Hello! How can I help?'\"\n• \"Add a new button called 'Contact Us'\"\n• \"Fix the email validation\"\n• \"Add an order tracking flow\"",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Handle sending an edit request
  const handleSend = async () => {
    if (!input.trim() || !session || isProcessing || isRedeploying) return;
    
    const userMessage: EditorMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);
    
    // Add loading message
    const loadingMessage: EditorMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: 'Analyzing your request...',
      timestamp: new Date(),
      isLoading: true
    };
    setMessages(prev => [...prev, loadingMessage]);
    
    try {
      // Process the edit request
      const result = await processEditRequest({
        instruction: userMessage.content,
        context,
        currentCsv: session.csv,
        currentScripts: session.scripts
      });
      
      // Remove loading message
      setMessages(prev => prev.filter(m => m.id !== loadingMessage.id));
      
      if (result.success) {
        // Add success message
        const successMessage: EditorMessage = {
          id: `success-${Date.now()}`,
          role: 'assistant',
          content: `✓ ${result.changesSummary}\n\nAffected nodes: ${result.affectedNodes.join(', ') || 'none'}\n\nDeploying changes...`,
          timestamp: new Date(),
          editResult: result
        };
        setMessages(prev => [...prev, successMessage]);
        
        // Apply the changes
        await onEditComplete(result);
        
        // Update message after deployment
        setMessages(prev => prev.map(m => 
          m.id === successMessage.id 
            ? { ...m, content: `✓ ${result.changesSummary}\n\nAffected nodes: ${result.affectedNodes.join(', ') || 'none'}\n\n✓ Changes deployed! The preview has been refreshed.` }
            : m
        ));
      } else {
        // Add error message
        const errorMessage: EditorMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `I couldn't apply that change: ${result.error || 'Unknown error'}\n\nCould you try rephrasing your request or being more specific?`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
      
    } catch (error: any) {
      // Remove loading message
      setMessages(prev => prev.filter(m => m.id !== loadingMessage.id));
      
      // Add error message
      const errorMessage: EditorMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Sorry, something went wrong: ${error.message}\n\nPlease try again.`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Handle keyboard submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600" />
          <span className="font-medium text-gray-900">Edit Assistant</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-2 rounded-lg transition-colors ${
              showHistory ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200'
            }`}
            title="Edit history"
          >
            <History className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Context bar */}
      {context.sessionActive && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-xs text-blue-700">
          <span className="font-medium">Live Context:</span>{' '}
          {context.messages.length} messages
          {context.lastBotMessage && (
            <> • Last bot: "{context.lastBotMessage.text?.substring(0, 50)}..."</>
          )}
        </div>
      )}
      
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {showHistory ? (
          // Edit history view
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Edit History</h3>
            {session?.editHistory.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No edits yet</p>
            ) : (
              <div className="space-y-2">
                {session?.editHistory.map((edit, i) => (
                  <div 
                    key={i}
                    className="p-3 bg-gray-50 rounded-lg text-sm"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {edit.success ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      )}
                      <span className="font-medium">{edit.changesSummary}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Nodes: {edit.affectedNodes.join(', ') || 'none'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Chat messages view
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'flex-row-reverse' : ''
              }`}
            >
              {/* Avatar */}
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                message.role === 'user' 
                  ? 'bg-blue-600' 
                  : 'bg-gray-200'
              }`}>
                {message.role === 'user' ? (
                  <User className="w-4 h-4 text-white" />
                ) : (
                  <Bot className="w-4 h-4 text-gray-600" />
                )}
              </div>
              
              {/* Message bubble */}
              <div className={`max-w-[80%] ${
                message.role === 'user' ? 'text-right' : ''
              }`}>
                <div className={`inline-block px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}>
                  {message.isLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{message.content}</span>
                    </div>
                  ) : (
                    message.content
                  )}
                </div>
                
                {/* Show affected nodes for successful edits */}
                {message.editResult?.success && message.editResult.affectedNodes.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                    <Code className="w-3 h-3" />
                    <span>Modified nodes: {message.editResult.affectedNodes.join(', ')}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input area */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to change..."
              className="w-full px-4 py-3 border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={2}
              disabled={isProcessing || isRedeploying || !session}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing || isRedeploying || !session}
            className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing || isRedeploying ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        
        {/* Quick actions */}
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            'Change welcome message',
            'Add a button',
            'Fix validation error',
          ].map((action) => (
            <button
              key={action}
              onClick={() => setInput(action)}
              disabled={isProcessing || isRedeploying}
              className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default EditorChatbot;
