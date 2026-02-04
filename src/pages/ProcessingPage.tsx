import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { instantBuild, InstantBuildProgress } from '../services/instant-build';
import { Loader2, Check, AlertCircle, Sparkles, Database, Shield, Rocket, FileSpreadsheet, Key, Copy, CheckCircle2, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { FlowchartProgress } from '../components/FlowchartProgress';
import type { InstantBuildResult } from '../types';

// Typical ranges based on observed builds (conservative estimates)
const STEP_DESCRIPTIONS: Record<string, string> = {
  generating: 'AI generation (typically longest)',
  validating: 'Validation and refinement',
  deploying: 'Deployment and widget creation',
  exporting: 'Google Sheets export',
};

const TOTAL_RANGE = { min: 30, max: 90 }; // Total pipeline typical range in seconds

// localStorage key for build timing history
const BUILD_TIMINGS_KEY = 'solution_builder_timings';

interface BuildTiming {
  date: number;
  totalMs: number;
}

/**
 * Save a successful build timing to localStorage
 */
export function saveBuildTiming(totalMs: number): void {
  try {
    const history: BuildTiming[] = JSON.parse(localStorage.getItem(BUILD_TIMINGS_KEY) || '[]');
    history.push({ date: Date.now(), totalMs });
    // Keep last 10 builds
    localStorage.setItem(BUILD_TIMINGS_KEY, JSON.stringify(history.slice(-10)));
    console.log(`[Timing] Saved build timing: ${(totalMs / 1000).toFixed(1)}s`);
  } catch (e) {
    console.warn('[Timing] Failed to save build timing:', e);
  }
}

/**
 * Get the user's average build time based on history
 * Returns null if not enough data (less than 3 builds)
 */
function getAverageFromHistory(): number | null {
  try {
    const history: BuildTiming[] = JSON.parse(localStorage.getItem(BUILD_TIMINGS_KEY) || '[]');
    if (history.length < 3) return null; // Not enough data for reliable estimate
    
    const totals = history.map(h => h.totalMs);
    const avgMs = totals.reduce((a, b) => a + b, 0) / totals.length;
    return Math.round(avgMs / 1000);
  } catch (e) {
    return null;
  }
}

/**
 * TimeEstimate - Shows elapsed time and typical completion range
 * Uses elapsed time (a fact) rather than countdown (speculation) to avoid misleading users
 */
function TimeEstimate({ 
  step, 
  pipelineStartedAt 
}: { 
  step: string; 
  pipelineStartedAt?: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [historicalAvg, setHistoricalAvg] = useState<number | null>(null);
  
  useEffect(() => {
    // Load historical average on mount
    setHistoricalAvg(getAverageFromHistory());
  }, []);
  
  useEffect(() => {
    if (!pipelineStartedAt) return;
    
    // Update elapsed time every second
    const interval = setInterval(() => {
      setElapsed(Math.floor((performance.now() - pipelineStartedAt) / 1000));
    }, 1000);
    
    // Calculate initial elapsed time
    setElapsed(Math.floor((performance.now() - pipelineStartedAt) / 1000));
    
    return () => clearInterval(interval);
  }, [pipelineStartedAt]);
  
  // Don't show if no timing data or step is done/error
  if (!pipelineStartedAt || step === 'done' || step === 'error') {
    return null;
  }
  
  const stepDescription = STEP_DESCRIPTIONS[step] || step;
  
  // Format elapsed time
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };
  
  return (
    <div className="mt-6 text-center">
      <div className="flex items-center justify-center gap-2 text-[#a5b4fc]">
        <Clock className="w-4 h-4" />
        <span className="text-sm font-medium">Elapsed: {formatTime(elapsed)}</span>
      </div>
      {historicalAvg ? (
        <p className="text-xs text-[#6a6a75] mt-2">
          Your builds usually take about {historicalAvg} seconds
        </p>
      ) : (
        <p className="text-xs text-[#6a6a75] mt-2">
          Solutions typically complete in {TOTAL_RANGE.min}-{TOTAL_RANGE.max} seconds
        </p>
      )}
      <p className="text-xs text-[#4a4a55] mt-1">
        Current: {stepDescription}
      </p>
    </div>
  );
}

/**
 * ProcessingPage - Shows progress during instant build pipeline
 * 
 * Displays animated steps as the system:
 * 1. Generates bot CSV
 * 2. Validates with Bot Manager
 * 3. Deploys to sandbox
 * 4. Exports to Google Sheets
 */
export function ProcessingPage() {
  const { 
    extractedDetails, 
    projectConfig,
    credentials,
    setCredentials,
    user,
    setInstantStep,
    setInstantBuildResult,
    setError,
    addSavedSolution,
    updateSavedSolution,
    activeSolutionId,
    setActiveSolution
  } = useStore();
  
  const [progress, setProgress] = useState<InstantBuildProgress>({
    step: 'generating',
    message: 'Initializing...',
    progress: 0,
  });
  
  const [error, setLocalError] = useState<string | null>(null);
  const [failedResult, setFailedResult] = useState<InstantBuildResult | null>(null);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [buildTrigger, setBuildTrigger] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showFailedRows, setShowFailedRows] = useState(false);
  const buildStarted = useRef(false);
  const cachedGenerationRef = useRef<any>(null);
  
  // Pipeline steps for visual display
  const steps = [
    { id: 'generating', label: 'Generating Solution', icon: Sparkles },
    { id: 'validating', label: 'Validating', icon: Shield },
    { id: 'deploying', label: 'Deploying to Sandbox', icon: Rocket },
    { id: 'exporting', label: 'Exporting to Sheets', icon: FileSpreadsheet },
  ];
  
  const currentStepIndex = steps.findIndex(s => s.id === progress.step);
  
  // Build function that can be called multiple times
  const runBuild = useCallback(async (apiKey: string) => {
    if (!extractedDetails) {
      setLocalError('No project details available. Please go back and describe your bot.');
      return;
    }
    
    setLocalError(null);
    setProgress({
      step: 'generating',
      message: 'Starting build...',
      progress: 0,
    });
    
    // Get AI credentials from store
    const aiCredentials = credentials.anthropicApiKey || credentials.googleAiApiKey
      ? {
          apiKey: credentials.aiProvider === 'google' 
            ? credentials.googleAiApiKey 
            : credentials.anthropicApiKey,
          provider: credentials.aiProvider || 'anthropic' as const
        }
      : undefined;
    
    const result = await instantBuild(
      extractedDetails.description,
      extractedDetails,
      projectConfig.brandAssets || null,
      apiKey,
      user.email || 'anonymous',
      (update) => setProgress(update),
      cachedGenerationRef.current || undefined,
      aiCredentials
    );
    
    if (result.success) {
      // Clear cache on success
      cachedGenerationRef.current = null;
      setInstantBuildResult(result);
      
      // Save build timing for future estimates
      if (progress.pipelineStartedAt) {
        const totalMs = Math.round(performance.now() - progress.pipelineStartedAt);
        saveBuildTiming(totalMs);
      }
      
      // Save to Supabase for cross-device access and permanent storage
      const solutionData = {
        name: extractedDetails.projectName || 'Instant Build Solution',
        clientName: extractedDetails.clientName || '',
        projectType: 'custom' as const,
        description: extractedDetails.description || '',
        status: 'deployed' as const,
        nodeCount: result.nodeCount || 0,
        csvContent: result.csv,
        widgetUrl: result.widgetUrl,
        botUrl: result.widgetUrl,
        spreadsheetUrl: result.sheetsUrl,
        deployedEnvironment: 'sandbox' as const,
      };
      
      // Update existing or create new
      if (activeSolutionId) {
        updateSavedSolution(activeSolutionId, solutionData);
        console.log(`[ProcessingPage] Updated solution ${activeSolutionId} in Supabase`);
      } else if (user.email) {
        addSavedSolution(solutionData).then((saved) => {
          if (saved) {
            setActiveSolution(saved.id);
            console.log(`[ProcessingPage] Saved new solution ${saved.id} to Supabase`);
          }
        });
      }
      
      setInstantStep('results');
    } else {
      // Cache generation result so retry skips expensive CSV regeneration
      if (result._cachedGeneration) {
        cachedGenerationRef.current = result._cachedGeneration;
        console.log('[ProcessingPage] Cached generation result for pipeline resume');
      }
      
      // Check for auth error
      if (result.error?.includes('API token') || result.error?.includes('invalid') || result.error?.includes('expired')) {
        setNeedsApiKey(true);
        setCredentials({ pypestreamApiKey: undefined });
      } else {
        setLocalError(result.error || 'Build failed');
        setFailedResult(result);
        setProgress({
          step: 'error',
          message: result.error || 'Build failed',
          progress: 0,
        });
      }
    }
  }, [extractedDetails, projectConfig.brandAssets, user.email, setInstantBuildResult, setInstantStep, setCredentials, addSavedSolution, updateSavedSolution, activeSolutionId, setActiveSolution]);
  
  useEffect(() => {
    // Prevent double-run in React 18 Strict Mode (only for initial mount)
    if (buildTrigger === 0 && buildStarted.current) return;
    if (buildTrigger === 0) buildStarted.current = true;
    
    const token = credentials.pypestreamApiKey;
    if (!token) {
      // Show API key input instead of error
      setNeedsApiKey(true);
      return;
    }
    
    runBuild(token);
  }, [buildTrigger, credentials.pypestreamApiKey, runBuild]);
  
  const handleApiKeySubmit = () => {
    if (!apiKeyInput.trim()) return;
    // Save the API key
    setCredentials({ pypestreamApiKey: apiKeyInput.trim() });
    setNeedsApiKey(false);
    // Trigger a new build - the useEffect will pick up the new API key
    setBuildTrigger(prev => prev + 1);
  };
  
  const handleRetry = () => {
    setLocalError(null);
    // Trigger a new build
    setBuildTrigger(prev => prev + 1);
  };
  
  const handleBack = () => {
    setInstantStep('create');
  };
  
  // API Key prompt
  if (needsApiKey) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] px-6">
        <div className="bg-[#12121a] border border-white/[0.08] rounded-2xl p-10 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-2xl bg-[#6366f1]/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#6366f1]/10">
            <Key className="w-8 h-8 text-[#6366f1]" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Pypestream API Key Required</h2>
          <p className="text-sm text-[#6a6a75] mb-8">
            Enter your Pypestream Bot Manager API key to deploy bots.
          </p>
          <div className="space-y-5">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-4 py-3.5 bg-[#0a0a0f] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#6366f1] transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
            />
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handleBack}
                className="px-5 py-2.5 text-sm text-[#8585a3] hover:text-white transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={handleApiKeySubmit}
                disabled={!apiKeyInput.trim()}
                className="px-5 py-2.5 bg-[#6366f1] text-white text-sm rounded-xl hover:bg-[#5558e3] transition-colors disabled:opacity-50 font-medium"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  if (error || progress.step === 'error') {
    const failedRows = failedResult?.failedRows || [];
    const hasFailedRows = failedRows.length > 0;
    
    const handleCopyFailedRows = async () => {
      const jsonData = JSON.stringify(failedRows, null, 2);
      await navigator.clipboard.writeText(jsonData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    
    return (
      <div className="flex items-center justify-center min-h-[70vh] px-6 py-8">
        <div className={`bg-[#12121a] border border-white/[0.08] rounded-2xl p-10 text-center w-full ${hasFailedRows ? 'max-w-2xl' : 'max-w-md'}`}>
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-red-500/10">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Build Failed</h2>
          <p className="text-sm text-[#6a6a75] mb-6 leading-relaxed">
            {error || progress.message}
          </p>
          
          {/* Failed Rows Section */}
          {hasFailedRows && (
            <div className="mb-6 text-left">
              <button
                onClick={() => setShowFailedRows(!showFailedRows)}
                className="flex items-center gap-2 text-sm text-[#6366f1] hover:text-[#818cf8] transition-colors mb-3 mx-auto"
              >
                {showFailedRows ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {failedRows.length} Failed Row{failedRows.length !== 1 ? 's' : ''} - Click to {showFailedRows ? 'hide' : 'view'}
              </button>
              
              {showFailedRows && (
                <div className="bg-[#0a0a0f] border border-white/[0.08] rounded-xl p-4 max-h-64 overflow-auto">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs text-[#6a6a75]">Failed nodes with validation errors</span>
                    <button
                      onClick={handleCopyFailedRows}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6366f1]/10 text-[#6366f1] text-xs rounded-lg hover:bg-[#6366f1]/20 transition-colors"
                    >
                      {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied!' : 'Copy JSON'}
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {failedRows.map((row, idx) => (
                      <div key={idx} className="bg-[#12121a] border border-white/[0.05] rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono bg-red-500/10 text-red-400 px-2 py-0.5 rounded">
                            Node {row.nodeNum}
                          </span>
                          {row.nodeType && (
                            <span className={`text-xs px-2 py-0.5 rounded ${row.nodeType === 'A' ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>
                              {row.nodeType === 'A' ? 'Action' : 'Decision'}
                            </span>
                          )}
                          {row.nodeName && (
                            <span className="text-xs text-[#8585a3] truncate max-w-[200px]">{row.nodeName}</span>
                          )}
                        </div>
                        <div className="text-xs text-red-300 space-y-1">
                          {row.errors.map((err, errIdx) => (
                            <div key={errIdx} className="font-mono break-all">{err}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleBack}
              className="px-5 py-2.5 text-sm text-[#8585a3] hover:text-white transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={handleRetry}
              className="px-5 py-2.5 bg-[#6366f1] text-white text-sm rounded-xl hover:bg-[#5558e3] transition-colors font-medium"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex items-center justify-center min-h-[70vh] px-6 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl w-full items-stretch">
        {/* Left: Build Progress Card */}
        <div className="bg-[#12121a] border border-white/[0.08] rounded-2xl p-8 flex flex-col items-center justify-center">
          {/* Animated logo */}
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 flex items-center justify-center mb-6 animate-pulse shadow-lg shadow-[#6366f1]/10">
            <Database className="w-10 h-10 text-[#a5b4fc]" />
          </div>
          
          {/* Project info */}
          <h2 className="text-xl font-semibold text-white mb-1 text-center">
            Building {extractedDetails?.projectName || 'Solution'}
          </h2>
          <p className="text-sm text-[#6a6a75] mb-8 text-center">
            {extractedDetails?.targetCompany ? `for ${extractedDetails.targetCompany}` : 'Please wait...'}
          </p>
          
          {/* Progress steps */}
          <div className="space-y-4 w-full max-w-xs mb-8">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStepIndex;
              const isDone = index < currentStepIndex || progress.step === 'done';
              const isPending = index > currentStepIndex;
              
              return (
                <div 
                  key={step.id}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 ${
                    isDone ? 'bg-[#22c55e]/10 text-[#22c55e]' :
                    isActive ? 'bg-[#6366f1]/10 text-[#a5b4fc]' :
                    'bg-white/[0.02] text-[#4a4a55]'
                  }`}
                >
                  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                    {isDone ? (
                      <Check className="w-4 h-4" />
                    ) : isActive ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-current opacity-40" />
                    )}
                  </div>
                  <span className={`text-sm ${isDone || isActive ? 'font-medium' : ''}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
          
          {/* Progress bar */}
          <div className="w-full max-w-xs">
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] rounded-full transition-all duration-500"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <p className="text-xs text-[#6a6a75] mt-3 text-center">
              {progress.message}
            </p>
            {progress.details && (
              <p className="text-xs text-[#4a4a55] mt-1 text-center truncate">
                {progress.details}
              </p>
            )}
          </div>
          
          {/* Time estimate with elapsed timer */}
          <TimeEstimate 
            step={progress.step} 
            pipelineStartedAt={progress.pipelineStartedAt} 
          />
          
          {/* Cancel button */}
          <button
            onClick={handleBack}
            className="mt-6 px-4 py-2 text-sm text-[#6a6a75] hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
        
        {/* Right: Flowchart Progress (hidden on mobile) */}
        <div className="hidden lg:flex bg-[#12121a] border border-white/[0.08] rounded-2xl p-8 items-center justify-center min-h-[500px]">
          <FlowchartProgress sequentialProgress={progress.sequentialProgress} />
        </div>
      </div>
    </div>
  );
}
