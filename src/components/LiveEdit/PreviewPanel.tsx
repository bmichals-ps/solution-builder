/**
 * Preview Panel Component
 * 
 * Displays the deployed widget in an iframe with controls for:
 * - Refreshing the chat session
 * - Opening in full screen
 * - Showing current context/state
 */

import { useState } from 'react';
import { RefreshCw, Maximize2, ExternalLink, MessageSquare, Bot } from 'lucide-react';
import type { ConversationContext } from '../../types';

interface PreviewPanelProps {
  widgetUrl: string;
  widgetId: string;
  refreshKey: number;
  onRefresh: () => void;
  context: ConversationContext;
}

export function PreviewPanel({
  widgetUrl,
  widgetId,
  refreshKey,
  onRefresh,
  context
}: PreviewPanelProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showContext, setShowContext] = useState(false);
  
  // Construct preview URL
  const previewUrl = widgetUrl || (widgetId 
    ? `https://web-sandbox.pypestream.com/preview.html?id=${widgetId}`
    : '');
  
  if (!previewUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-100">
        <div className="text-center text-gray-500">
          <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No widget available</p>
          <p className="text-sm mt-1">Deploy a bot to see the preview</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Preview Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Bot Preview</span>
          {context.sessionActive && (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
              Live
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Context toggle */}
          <button
            onClick={() => setShowContext(!showContext)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              showContext 
                ? 'bg-blue-100 text-blue-700' 
                : 'hover:bg-gray-100 text-gray-600'
            }`}
          >
            Context
          </button>
          
          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Restart chat session"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          {/* Full screen */}
          <button
            onClick={() => setIsFullScreen(true)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Full screen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          
          {/* Open in new tab */}
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
      
      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Iframe preview */}
        <div className={`${showContext ? 'w-2/3' : 'w-full'} h-full bg-gray-200 flex items-center justify-center p-4 transition-all`}>
          <div className="w-full max-w-md h-full max-h-[700px] bg-white rounded-2xl shadow-2xl overflow-hidden">
            <iframe
              key={refreshKey}
              src={previewUrl}
              className="w-full h-full border-0"
              title="Bot Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </div>
        
        {/* Context panel */}
        {showContext && (
          <div className="w-1/3 bg-white border-l border-gray-200 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Conversation Context
              </h3>
              
              {/* Session status */}
              <div className="mb-4">
                <label className="text-xs text-gray-500 uppercase tracking-wide">
                  Status
                </label>
                <p className={`text-sm font-medium ${
                  context.sessionActive ? 'text-green-600' : 'text-gray-400'
                }`}>
                  {context.sessionActive ? 'Active' : 'Waiting for interaction'}
                </p>
              </div>
              
              {/* Message count */}
              <div className="mb-4">
                <label className="text-xs text-gray-500 uppercase tracking-wide">
                  Messages
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {context.messages.length} total
                </p>
              </div>
              
              {/* Last bot message */}
              {context.lastBotMessage && (
                <div className="mb-4">
                  <label className="text-xs text-gray-500 uppercase tracking-wide">
                    Last Bot Message
                  </label>
                  <div className="mt-1 p-2 bg-gray-50 rounded-lg text-sm text-gray-700">
                    {context.lastBotMessage.text?.substring(0, 150)}
                    {(context.lastBotMessage.text?.length || 0) > 150 && '...'}
                  </div>
                  {context.lastBotMessage.richAssetType && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                      {context.lastBotMessage.richAssetType}
                    </span>
                  )}
                </div>
              )}
              
              {/* Last user message */}
              {context.lastUserMessage && (
                <div className="mb-4">
                  <label className="text-xs text-gray-500 uppercase tracking-wide">
                    Last User Input
                  </label>
                  <div className="mt-1 p-2 bg-blue-50 rounded-lg text-sm text-gray-700">
                    {context.lastUserMessage.text}
                  </div>
                </div>
              )}
              
              {/* Recent messages */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
                  Recent Messages
                </label>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {context.messages.slice(-10).map((msg, i) => (
                    <div 
                      key={msg.id || i}
                      className={`p-2 rounded-lg text-xs ${
                        msg.fromSide === 'bot' 
                          ? 'bg-gray-100 text-gray-700' 
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      <span className="font-medium">
                        {msg.fromSide === 'bot' ? 'Bot' : 'User'}:
                      </span>{' '}
                      {msg.text?.substring(0, 80)}
                      {(msg.text?.length || 0) > 80 && '...'}
                    </div>
                  ))}
                  {context.messages.length === 0 && (
                    <p className="text-gray-400 text-xs italic">
                      No messages yet. Interact with the bot to see context.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Full screen modal */}
      {isFullScreen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8">
          <div className="relative w-full max-w-lg h-full max-h-[800px]">
            <button
              onClick={() => setIsFullScreen(false)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
            >
              Close
            </button>
            <div className="w-full h-full bg-white rounded-2xl overflow-hidden shadow-2xl">
              <iframe
                key={`fullscreen-${refreshKey}`}
                src={previewUrl}
                className="w-full h-full border-0"
                title="Bot Preview (Full Screen)"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PreviewPanel;
