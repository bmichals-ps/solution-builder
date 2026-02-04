/**
 * Live Edit Page
 * 
 * Split-screen interface for live bot editing:
 * - Left panel (40%): Editor chatbot with context display
 * - Right panel (60%): Widget preview iframe with controls
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, RefreshCw, Maximize2, Settings, AlertCircle, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PreviewPanel } from '../components/LiveEdit/PreviewPanel';
import { EditorChatbot } from '../components/LiveEdit/EditorChatbot';
import { SessionMonitor } from '../services/session-monitor';
import { hotReload } from '../services/hot-reload';
import { getSolution } from '../services/solutions-api';
import type { 
  ConversationContext, 
  EditResult, 
  LiveEditSession,
  CustomScript 
} from '../types';

// Extract solution ID from URL path: /live-edit/:solutionId
function getSolutionIdFromPath(): string | undefined {
  const pathParts = window.location.pathname.split('/');
  return pathParts[2] || undefined;
}

// Navigate using browser history (no React Router)
function navigateTo(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function LiveEditPage() {
  const solutionId = getSolutionIdFromPath();
  const { savedSolutions, credentials, instantBuildResult, solutionsLoaded, activeSolutionId } = useStore();
  
  // Session state
  const [session, setSession] = useState<LiveEditSession | null>(null);
  const [sessionMonitor, setSessionMonitor] = useState<SessionMonitor | null>(null);
  const [context, setContext] = useState<ConversationContext>({
    messages: [],
    sessionActive: false
  });
  
  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRedeploying, setIsRedeploying] = useState(false);
  const [lastDeployStatus, setLastDeployStatus] = useState<'success' | 'error' | null>(null);
  const [splitPosition, setSplitPosition] = useState(40); // Left panel percentage
  
  // Initialize session from solution or instantBuildResult
  // FIXED: Check solutionsLoaded and fetch from API if needed to prevent race condition
  useEffect(() => {
    const initSession = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // First try instantBuildResult (just deployed, not saved yet)
        // Accept instantBuildResult if it has botId and csv - widgetId is optional for editing
        if (instantBuildResult?.botId && instantBuildResult?.csv) {
          setSession({
            solutionId: solutionId || 'current',
            botId: instantBuildResult.botId,
            widgetId: instantBuildResult.widgetId || '',
            widgetUrl: instantBuildResult.widgetUrl || '',
            csv: instantBuildResult.csv || '',
            scripts: instantBuildResult.scripts || [],
            versionId: instantBuildResult.versionId,
            editHistory: []
          });
          return;
        }
        
        // Use solutionId from URL, or fall back to activeSolutionId from store
        const effectiveSolutionId = solutionId || activeSolutionId;
        
        // If no solutionId provided and no instantBuildResult, error
        if (!effectiveSolutionId) {
          setError('No solution specified. Please deploy a bot first.');
          return;
        }
        
        // Try to find in already-loaded solutions
        let solutionData = savedSolutions.find(s => s.id === effectiveSolutionId);
        
        // If not found AND solutions haven't loaded yet, wait (effect will re-run when solutionsLoaded changes)
        if (!solutionData && !solutionsLoaded) {
          // Keep loading state - solutions are still being fetched
          return;
        }
        
        // If still not found after solutions loaded, try fetching directly from Supabase
        if (!solutionData) {
          console.log('[LiveEdit] Solution not in cache, fetching from Supabase:', effectiveSolutionId);
          const fetchedSolution = await getSolution(effectiveSolutionId);
          if (fetchedSolution) {
            solutionData = fetchedSolution;
          }
        }
        
        if (solutionData) {
          setSession({
            solutionId: solutionData.id,
            botId: solutionData.botId || '',
            widgetId: solutionData.widgetId || '',
            widgetUrl: solutionData.widgetUrl || '',
            csv: solutionData.csv || '',
            scripts: [],
            editHistory: []
          });
        } else {
          setError('Solution not found. Please deploy a bot first.');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to initialize session');
      } finally {
        setIsLoading(false);
      }
    };
    
    initSession();
  }, [solutionId, savedSolutions, solutionsLoaded, instantBuildResult, activeSolutionId]);
  
  // Initialize session monitor when we have a widget
  useEffect(() => {
    if (!session?.widgetId) return;
    
    const monitor = new SessionMonitor();
    
    const setupMonitor = async () => {
      try {
        await monitor.createSession(session.widgetId);
        monitor.startPolling((messages) => {
          setContext(prev => ({
            ...prev,
            messages,
            lastBotMessage: messages.filter(m => m.fromSide === 'bot').pop(),
            lastUserMessage: messages.filter(m => m.fromSide === 'user').pop(),
            sessionActive: true
          }));
        });
        setSessionMonitor(monitor);
      } catch (err) {
        console.warn('[LiveEdit] Session monitor failed to initialize:', err);
      }
    };
    
    setupMonitor();
    
    return () => {
      monitor.stopPolling();
    };
  }, [session?.widgetId]);
  
  // Handle edit completion and redeploy
  const handleEditComplete = useCallback(async (result: EditResult) => {
    if (!session || !credentials.pypestreamApiKey) return;
    
    setIsRedeploying(true);
    setLastDeployStatus(null);
    
    try {
      // Update session with new CSV/scripts
      const updatedSession: LiveEditSession = {
        ...session,
        csv: result.modifiedCsv,
        scripts: result.modifiedScripts || session.scripts,
        editHistory: [...session.editHistory, result]
      };
      
      // Hot reload the bot
      const deployResult = await hotReload(
        session.botId,
        result.modifiedCsv,
        result.modifiedScripts || session.scripts,
        credentials.pypestreamApiKey
      );
      
      if (deployResult.success) {
        updatedSession.versionId = deployResult.versionId;
        setSession(updatedSession);
        setLastDeployStatus('success');
        
        // Refresh preview iframe
        setRefreshKey(prev => prev + 1);
        
        // Reset session monitor to start fresh conversation
        if (sessionMonitor) {
          sessionMonitor.stopPolling();
          await sessionMonitor.createSession(session.widgetId);
          sessionMonitor.startPolling((messages) => {
            setContext(prev => ({
              ...prev,
              messages,
              lastBotMessage: messages.filter(m => m.fromSide === 'bot').pop(),
              lastUserMessage: messages.filter(m => m.fromSide === 'user').pop(),
              sessionActive: true
            }));
          });
        }
      } else {
        setLastDeployStatus('error');
        setError('Deployment failed. Changes were not applied.');
      }
    } catch (err: any) {
      setLastDeployStatus('error');
      setError(err.message || 'Failed to deploy changes');
    } finally {
      setIsRedeploying(false);
    }
  }, [session, credentials.pypestreamApiKey, sessionMonitor]);
  
  // Refresh preview
  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
    if (sessionMonitor && session?.widgetId) {
      sessionMonitor.stopPolling();
      sessionMonitor.createSession(session.widgetId).then(() => {
        sessionMonitor.startPolling((messages) => {
          setContext(prev => ({
            ...prev,
            messages,
            sessionActive: true
          }));
        });
      });
    }
  }, [sessionMonitor, session?.widgetId]);
  
  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading Live Edit session...</p>
        </div>
      </div>
    );
  }
  
  // Render error state
  if (error && !session) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Cannot Start Live Edit</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => navigateTo('/dashboard')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Live Edit</h1>
            <p className="text-sm text-gray-500">
              {session?.botId || 'No bot loaded'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Deploy status indicator */}
          {isRedeploying && (
            <div className="flex items-center gap-2 text-blue-600">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Deploying...</span>
            </div>
          )}
          {lastDeployStatus === 'success' && (
            <div className="flex items-center gap-2 text-green-600">
              <Check className="w-4 h-4" />
              <span className="text-sm">Deployed</span>
            </div>
          )}
          {lastDeployStatus === 'error' && (
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">Deploy failed</span>
            </div>
          )}
          
          <button
            onClick={handleRefresh}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Restart chat"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          
          <button
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>
      
      {/* Main content - split panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Editor Chatbot */}
        <div 
          className="bg-white border-r border-gray-200 flex flex-col"
          style={{ width: `${splitPosition}%` }}
        >
          <EditorChatbot
            session={session}
            context={context}
            onEditComplete={handleEditComplete}
            isRedeploying={isRedeploying}
          />
        </div>
        
        {/* Resizer */}
        <div
          className="w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = splitPosition;
            
            const onMouseMove = (moveEvent: MouseEvent) => {
              const delta = moveEvent.clientX - startX;
              const containerWidth = window.innerWidth;
              const newPosition = startWidth + (delta / containerWidth) * 100;
              setSplitPosition(Math.max(25, Math.min(60, newPosition)));
            };
            
            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          }}
        />
        
        {/* Right panel - Preview */}
        <div 
          className="flex-1 flex flex-col bg-gray-50"
          style={{ width: `${100 - splitPosition}%` }}
        >
          <PreviewPanel
            widgetUrl={session?.widgetUrl || ''}
            widgetId={session?.widgetId || ''}
            refreshKey={refreshKey}
            onRefresh={handleRefresh}
            context={context}
          />
        </div>
      </div>
    </div>
  );
}

export default LiveEditPage;
