import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { 
  Sparkles, 
  CheckCircle2, 
  Loader2,
  FileSpreadsheet,
  Code,
  Shield,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  Zap,
  RotateCw,
  Key,
  X,
  Clock,
  Copy,
  Check
} from 'lucide-react';
import { 
  generateBotCSV, 
  validateCSV, 
  parseCSVStats,
  validateAndRefineIteratively,
  enrichWarningsWithApiInfo,
  RateLimitError,
  AuthError,
  type RefinementProgressCallback
} from '../services/generation';
import { generateBotId } from '../services/botmanager';
import type { GenerationResult } from '../services/generation';

const generationSteps = [
  { id: 'analyze', label: 'Analyzing requirements', icon: Sparkles, startPercent: 0, endPercent: 15 },
  { id: 'nodes', label: 'Generating bot nodes', icon: FileSpreadsheet, startPercent: 15, endPercent: 65 },
  { id: 'scripts', label: 'Creating action scripts', icon: Code, startPercent: 65, endPercent: 75 },
  { id: 'validate', label: 'Preparing for validation', icon: Shield, startPercent: 75, endPercent: 80 },
  { id: 'autofix', label: 'Official Validation & Auto-Fix', icon: Zap, startPercent: 80, endPercent: 100 },
];

interface RefinementStatus {
  iteration: number;
  phase: 'validating' | 'refining';
  message: string;
  errors?: string[];
}

export function GenerationPage() {
  const { 
    projectConfig,
    clarifyingQuestions,
    credentials,
    setCredentials,
    setSolution,
    solution,
    nextStep,
    addSavedSolution,
    updateSavedSolution,
    activeSolutionId,
    setActiveSolution
  } = useStore();

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  
  // Auto-fix state
  const [refinementStatus, setRefinementStatus] = useState<RefinementStatus | null>(null);
  const [refinementResult, setRefinementResult] = useState<{
    valid: boolean;
    iterations: number;
    fixesMade: string[];
    remainingErrors: string[];
  } | null>(null);
  const [skipAutoFix, setSkipAutoFix] = useState(false);
  
  // API Key modal state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyResolver, setApiKeyResolver] = useState<{
    resolve: (key: string | null) => void;
  } | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  
  // Rate limit state
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [errorsCopied, setErrorsCopied] = useState(false);

  // Copy errors to clipboard
  const copyErrorsToClipboard = async (errors: string[]) => {
    try {
      const errorText = (errors || []).join('\n');
      await navigator.clipboard.writeText(errorText);
      setErrorsCopied(true);
      setTimeout(() => setErrorsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy errors:', err);
    }
  };

  // Check if we have an API key for auto-fix
  const hasApiKey = !!credentials.pypestreamApiKey;
  
  // Handle API key submission from modal
  const handleApiKeySubmit = () => {
    if (apiKeyInput.trim()) {
      setCredentials({ pypestreamApiKey: apiKeyInput.trim() });
      apiKeyResolver?.resolve(apiKeyInput.trim());
    } else {
      apiKeyResolver?.resolve(null);
    }
    setShowApiKeyModal(false);
    setApiKeyInput('');
    setApiKeyResolver(null);
    setApiKeyError(null);
  };
  
  // Handle skipping auto-fix
  const handleSkipAutoFix = () => {
    apiKeyResolver?.resolve(null);
    setShowApiKeyModal(false);
    setApiKeyInput('');
    setApiKeyResolver(null);
    setApiKeyError(null);
    setSkipAutoFix(true);
  };
  
  // Prompt for API key with a modal (optionally with error message)
  const promptForApiKey = (errorMessage?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setApiKeyError(errorMessage || null);
      setApiKeyResolver({ resolve });
      setShowApiKeyModal(true);
    });
  };

  // Calculate current step progress
  const currentStep = generationSteps[currentStepIndex];
  const overallProgress = isComplete ? 100 : progressPercent;

  // Progress callback for refinement
  const handleRefinementProgress: RefinementProgressCallback = useCallback((update) => {
    setRefinementStatus(update);
    // Update progress based on iteration (80-100% range)
    const iterationProgress = 80 + (update.iteration * 4);
    setProgressPercent(Math.min(iterationProgress, 98));
  }, []);

  const runGeneration = async () => {
    setError(null);
    setIsComplete(false);
    setCompletedSteps([]);
    setCurrentStepIndex(0);
    setNodeCount(0);
    setIsRetrying(false);
    setProgressPercent(0);
    setRefinementStatus(null);
    setRefinementResult(null);
    setIsRateLimited(false);
    setRateLimitCountdown(null);
    
    try {
      // Step 1: Analyzing requirements (0-15%)
      setCurrentStepIndex(0);
      setProgressPercent(5);
      await new Promise((resolve) => setTimeout(resolve, 400));
      setProgressPercent(10);
      await new Promise((resolve) => setTimeout(resolve, 400));
      setProgressPercent(15);
      setCompletedSteps(['analyze']);
      
      // Step 2: Generating bot nodes (15-65%) - this is the long AI call
      setCurrentStepIndex(1);
      setProgressPercent(20);
      
      // Simulate progress during AI call
      const progressInterval = setInterval(() => {
        setProgressPercent(prev => {
          if (prev < 60) return prev + 2;
          return prev;
        });
      }, 1000);
      
      // Helper to generate with retry on rate limit
      const generateWithRetry = async (maxRetries = 2): Promise<GenerationResult> => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await generateBotCSV(
              projectConfig,
              clarifyingQuestions,
              projectConfig.referenceFiles
            );
          } catch (err) {
            if (err instanceof RateLimitError && attempt < maxRetries) {
              // Show countdown and wait
              const waitTime = err.retryAfterSeconds || 60;
              setIsRateLimited(true);
              
              // Countdown timer
              for (let remaining = waitTime; remaining > 0; remaining--) {
                setRateLimitCountdown(remaining);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              
              setIsRateLimited(false);
              setRateLimitCountdown(null);
              continue;
            }
            throw err;
          }
        }
        throw new Error('Generation failed after retries');
      };
      
      const result = await generateWithRetry(3);
      
      clearInterval(progressInterval);
      setProgressPercent(65);
      setGenerationResult(result);
      setNodeCount(result.nodeCount);
      setCompletedSteps(['analyze', 'nodes']);
      
      // Step 3: Creating action scripts (65-75%)
      setCurrentStepIndex(2);
      setProgressPercent(70);
      await new Promise((resolve) => setTimeout(resolve, 300));
      setProgressPercent(75);
      setCompletedSteps(['analyze', 'nodes', 'scripts']);
      
      // Step 4: Quick local checks (just for warnings, not authoritative)
      setCurrentStepIndex(3);
      setProgressPercent(77);
      const localChecks = validateCSV(result.csv);
      // Keep warnings for info, but official validation is what matters
      const allWarnings = [...(result.warnings || []), ...localChecks.warnings];
      setValidationWarnings(allWarnings);
      setProgressPercent(80);
      setCompletedSteps(['analyze', 'nodes', 'scripts', 'validate']);
      
      let finalCSV = result.csv;
      let officiallyValidated = false;
      let versionId: string | undefined;
      
      // Step 5: AI Auto-Fix with Bot Manager validation (80-100%)
      // Check for API key - if not set, prompt user
      let apiKeyToUse = credentials.pypestreamApiKey;
      
      if (!apiKeyToUse && !skipAutoFix) {
        // Show modal and wait for user response
        setCurrentStepIndex(4);
        apiKeyToUse = await promptForApiKey() ?? undefined;
      }
      
      // Only run if we have an API key and user hasn't skipped
      if (apiKeyToUse && !skipAutoFix) {
        setCurrentStepIndex(4);
        setProgressPercent(82);
        
        const botId = generateBotId(
          projectConfig.clientName || 'Client',
          projectConfig.projectName || 'Bot'
        );
        
        try {
          const autoFixResult = await validateAndRefineIteratively(
            result.csv,
            botId,
            apiKeyToUse,
            {
              clientName: projectConfig.clientName,
              projectName: projectConfig.projectName,
              projectType: projectConfig.projectType,
            },
            handleRefinementProgress,
            5 // max iterations
          );
          
          finalCSV = autoFixResult.csv;
          officiallyValidated = autoFixResult.valid;
          versionId = autoFixResult.versionId;
          
          console.log(`[Generation] Auto-fix completed: valid=${autoFixResult.valid}, iterations=${autoFixResult.iterations}, errors=${autoFixResult.remainingErrors?.length || 0}`);
          
          setRefinementResult({
            valid: autoFixResult.valid,
            iterations: autoFixResult.iterations,
            fixesMade: autoFixResult.allFixesMade,
            remainingErrors: autoFixResult.remainingErrors || [],
          });
          
          if (autoFixResult.valid) {
            setCompletedSteps(['analyze', 'nodes', 'scripts', 'validate', 'autofix']);
            console.log('[Generation] Official validation PASSED');
          } else {
            console.log(`[Generation] Official validation failed with ${autoFixResult.remainingErrors?.length || 0} errors`);
          }
        } catch (autoFixError: any) {
          console.error('Auto-fix error:', autoFixError);
          
          // Check if it's an auth error - prompt for new key
          if (autoFixError instanceof AuthError || autoFixError.name === 'AuthError') {
            // Clear the invalid API key
            setCredentials({ pypestreamApiKey: undefined });
            
            // Prompt user for new API key with error message
            setRefinementResult({
              valid: false,
              iterations: 0,
              fixesMade: [],
              remainingErrors: ['API token is invalid or expired. Please enter a valid key.'],
            });
            
            // Show modal to re-enter key with error context
            const newApiKey = await promptForApiKey('Your API key is invalid or expired. Please enter a valid key.');
            
            if (newApiKey) {
              // Retry with new key - use finalCSV which may have partial fixes from first attempt
              try {
                const retryResult = await validateAndRefineIteratively(
                  finalCSV,  // Use current state (may have partial fixes)
                  botId,
                  newApiKey,
                  {
                    clientName: projectConfig.clientName,
                    projectName: projectConfig.projectName,
                    projectType: projectConfig.projectType,
                  },
                  handleRefinementProgress,
                  5
                );
                
                finalCSV = retryResult.csv;
                officiallyValidated = retryResult.valid;
                versionId = retryResult.versionId;
                
                setRefinementResult({
                  valid: retryResult.valid,
                  iterations: retryResult.iterations,
                  fixesMade: retryResult.allFixesMade,
                  remainingErrors: retryResult.remainingErrors,
                });
                
                if (retryResult.valid) {
                  setCompletedSteps(['analyze', 'nodes', 'scripts', 'validate', 'autofix']);
                }
              } catch (retryError: any) {
                console.error('Retry auto-fix error:', retryError);
                setRefinementResult({
                  valid: false,
                  iterations: 0,
                  fixesMade: [],
                  remainingErrors: [retryError.message || 'Auto-fix failed after retry'],
                });
              }
            }
          } else {
            // Continue with original CSV if auto-fix fails
            setRefinementResult({
              valid: false,
              iterations: 0,
              fixesMade: [],
              remainingErrors: [autoFixError.message || 'Auto-fix failed'],
            });
          }
        }
      } else {
        // Skip auto-fix step - mark as not validated
        console.log('[Generation] Auto-fix skipped (no API key)');
        setCompletedSteps(['analyze', 'nodes', 'scripts', 'validate', 'autofix']);
        setRefinementResult({
          valid: false,
          iterations: 0,
          fixesMade: [],
          remainingErrors: ['Official validation was skipped - run validation on Review page'],
        });
      }
      
      setProgressPercent(100);
      
      // Get stats from final CSV (includes detected official nodes)
      const stats = parseCSVStats(finalCSV);
      
      // Update node count with final stats
      setNodeCount(stats.totalNodes || stats.decisionNodes + stats.actionNodes);
      
      // CRITICAL: Only official Bot Manager validation matters
      // If we skipped auto-fix, the solution is NOT validated yet
      const validationPassed = officiallyValidated;
      
      // Create solution object - preserve existing ID if we have one
      const existingSolutionId = solution?.id || (activeSolutionId ? `saved_${activeSolutionId}` : `sol_${Date.now()}`);
      
      // Enrich warnings with API dependency info for "Use Mock Data" feature
      const enrichedWarnings = enrichWarningsWithApiInfo(allWarnings);
      
      const newSolution = {
        id: existingSolutionId,
        nodes: [],
        csvContent: finalCSV,
        readme: result.readme || generateReadme(projectConfig, result),
        validationResult: {
          passed: validationPassed,
          // Local errors are just hints - official validation is authoritative
          errors: [],
          warnings: enrichedWarnings,
          stats,
          officiallyValidated,
          versionId,
        },
      };
      
      // CRITICAL: Update store FIRST before any async operations
      setSolution(newSolution);
      
      console.log(`[Generation] Saving solution with csvContent length: ${finalCSV.length}, officiallyValidated: ${officiallyValidated}`);
      
      // Save or update solution in Supabase - use finalCSV which includes any auto-fixes
      const solutionData = {
        name: projectConfig.projectName || 'Untitled Solution',
        clientName: projectConfig.clientName || '',
        projectType: projectConfig.projectType,
        description: projectConfig.description || '',
        status: 'draft' as const,
        nodeCount: stats.totalNodes,
        currentStep: 'generation' as const,
        csvContent: finalCSV,
      };
      
      // Wait for save to complete before marking as complete
      try {
        if (activeSolutionId) {
          await updateSavedSolution(activeSolutionId, solutionData);
          console.log(`[Generation] Updated solution ${activeSolutionId} with fixed CSV`);
        } else {
          const saved = await addSavedSolution(solutionData);
          if (saved) {
            setActiveSolution(saved.id);
            console.log(`[Generation] Created new solution ${saved.id} with fixed CSV`);
          }
        }
      } catch (saveErr) {
        console.error('[Generation] Failed to save to Supabase, but solution is in local store:', saveErr);
        // Continue anyway - the solution is in the store
      }
      
      setIsComplete(true);
      
    } catch (err: any) {
      console.error('Generation failed:', err);
      setError(err.message || 'Generation failed. Please try again.');
    }
  };

  // Check if we already have a generated solution
  const [hasExistingSolution, setHasExistingSolution] = useState(false);
  
  useEffect(() => {
    // If we already have a solution with CSV content, show it instead of regenerating
    if (solution?.csvContent) {
      console.log('[GenerationPage] Existing solution found, showing results');
      setHasExistingSolution(true);
      setIsComplete(true);
      
      // Parse stats from existing CSV
      const stats = parseCSVStats(solution.csvContent);
      setNodeCount(stats.decisionNodes + stats.actionNodes);
      
      // Set all steps as completed
      setCompletedSteps(generationSteps.map(s => s.id));
      setCurrentStepIndex(generationSteps.length - 1);
      setProgressPercent(100);
      
      // Reconstruct generation result from solution
      setGenerationResult({
        csv: solution.csvContent,
        nodeCount: stats.decisionNodes + stats.actionNodes,
        officialNodesUsed: [],
        customScripts: [],
        warnings: [],
        readme: solution.readme || '',
        scripts: solution.scripts || [],
        validation: solution.validation || { valid: true, errors: [] }
      });
      
      // Show validation success if previously validated
      if (solution.validationResult?.officiallyValidated) {
        console.log('[Generation] Restoring previous validation state: passed');
        setRefinementResult({
          valid: true,
          iterations: 0,
          fixesMade: ['Previously validated with Bot Manager'],
          remainingErrors: [],
        });
      } else {
        console.log('[Generation] Existing solution not officially validated');
      }
    } else {
      // No existing solution, start generation
      runGeneration();
    }
  }, []);
  
  const handleRegenerate = () => {
    setHasExistingSolution(false);
    setIsComplete(false);
    setIsRetrying(true);
    runGeneration();
  };
  
  const handleRetry = () => {
    setIsRetrying(true);
    runGeneration();
  };

  return (
    <div className="space-y-8">
      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleSkipAutoFix}
          />
          
          {/* Modal */}
          <div className="relative bg-[#1a1a2e] border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-2xl max-w-md w-full mx-4 animate-fade-up">
            {/* Close button */}
            <button 
              onClick={handleSkipAutoFix}
              className="absolute top-4 right-4 text-[#5c5c78] hover:text-[#8585a3] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            {/* Header */}
            <div className="p-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  apiKeyError 
                    ? 'bg-gradient-to-br from-[#ef4444] to-[#f97316]' 
                    : 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                }`}>
                  {apiKeyError ? (
                    <AlertCircle className="w-6 h-6 text-white" />
                  ) : (
                    <Key className="w-6 h-6 text-white" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[#e8e8f0]">
                    {apiKeyError ? 'API Key Invalid' : 'Enable AI Auto-Fix'}
                  </h3>
                  <p className="text-[13px] text-[#8585a3]">
                    {apiKeyError ? 'Please enter a valid key' : 'Validate with Pypestream Bot Manager'}
                  </p>
                </div>
              </div>
              
              {/* Error Alert */}
              {apiKeyError && (
                <div className="mb-3 p-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] rounded-lg">
                  <p className="text-[13px] text-[#f87171] flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {apiKeyError}
                  </p>
                </div>
              )}
              
              <p className="text-[13px] text-[#a3a3bd] leading-relaxed">
                {apiKeyError 
                  ? 'Your previous API key was rejected. Please check that it\'s correct and has Bot Manager permissions.'
                  : 'Enter your Pypestream API key to enable automatic validation and AI-powered fixes. The AI will iterate until your bot passes all official validation checks.'
                }
              </p>
            </div>
            
            {/* Input */}
            <div className="px-6 pb-4">
              <Input
                type="password"
                placeholder="Enter your Pypestream API key"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && apiKeyInput.trim()) {
                    handleApiKeySubmit();
                  }
                }}
                helperText="Find this in Pypestream Console → Settings → API Keys"
              />
            </div>
            
            {/* Actions */}
            <div className="px-6 pb-6 flex gap-3">
              <Button 
                variant="ghost" 
                className="flex-1"
                onClick={handleSkipAutoFix}
              >
                Skip Auto-Fix
              </Button>
              <Button 
                className="flex-1"
                onClick={handleApiKeySubmit}
                disabled={!apiKeyInput.trim()}
                icon={<Zap className="w-4 h-4" />}
              >
                Enable & Continue
              </Button>
            </div>
            
            {/* Footer note */}
            <div className="px-6 pb-4 border-t border-[rgba(255,255,255,0.06)] pt-4">
              <p className="text-[11px] text-[#5c5c78] text-center">
                Your API key is stored locally and never sent to third parties.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="text-center space-y-2 pt-4">
        <h2 className="text-headline text-[#f0f0f5]">
          {error 
            ? 'Generation failed' 
            : isComplete 
              ? 'Solution ready' 
              : showApiKeyModal 
                ? 'API Key Required' 
                : isRateLimited
                  ? 'Rate Limit - Please Wait'
                  : 'Generating solution'
          }
        </h2>
        <p className="text-body text-[#8585a3]">
          {error 
            ? 'There was a problem generating your solution'
            : isComplete 
              ? refinementResult?.valid
                ? 'Official validation passed - ready to deploy!'
                : refinementResult && refinementResult.remainingErrors?.length > 0
                  ? `Generated with ${refinementResult.remainingErrors.length} validation error${refinementResult.remainingErrors.length !== 1 ? 's' : ''} - review and fix manually`
                  : !refinementResult
                    ? 'Generated - run official validation to verify it compiles'
                    : 'Your bot solution is ready for review' 
              : showApiKeyModal
                ? 'Enter your API key to enable official validation'
                : isRateLimited
                  ? `AI service is cooling down. Auto-retry in ${rateLimitCountdown}s...`
                  : 'Building your custom bot solution with AI...'
          }
        </p>
      </div>

      {/* Error State */}
      {error && (
        <Card variant="elevated" className="max-w-xl mx-auto border-red-500/20">
          <div className="flex items-start gap-4 p-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-medium text-red-400 mb-1">Error</p>
              <p className="text-[13px] text-[#8585a3]">{error}</p>
            </div>
          </div>
          <div className="px-4 pb-4">
            <Button 
              variant="secondary"
              onClick={handleRetry}
              disabled={isRetrying}
              icon={<RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />}
            >
              {isRetrying ? 'Retrying...' : 'Try Again'}
            </Button>
          </div>
        </Card>
      )}

      {/* Generation Progress */}
      {!error && (
        <Card variant="elevated" className="max-w-xl mx-auto">
          {/* Overall Progress Bar */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] text-[#8585a3] font-medium">Overall Progress</span>
              <span className="text-[14px] text-[#a5b4fc] font-bold">{overallProgress}%</span>
            </div>
            <div className="h-2 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] rounded-full transition-all duration-500 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
          
          <div className="space-y-1 pt-2">
            {generationSteps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStepIndex && !isComplete;
              const isCompleted = completedSteps.includes(step.id);
              
              // Calculate step-specific progress
              let stepProgress = 0;
              if (isCompleted) {
                stepProgress = 100;
              } else if (isActive) {
                const stepRange = step.endPercent - step.startPercent;
                const currentInStep = overallProgress - step.startPercent;
                stepProgress = Math.min(100, Math.max(0, (currentInStep / stepRange) * 100));
              }
              
              return (
                <div 
                  key={step.id}
                  className={`
                    flex items-center gap-4 p-4 rounded-xl transition-all duration-300
                    ${isActive ? 'bg-[rgba(99,102,241,0.06)]' : ''}
                  `}
                >
                  <div className={`
                    w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300
                    ${isCompleted 
                      ? 'bg-[rgba(34,197,94,0.15)] text-[#4ade80]' 
                      : isActive 
                        ? 'bg-[rgba(99,102,241,0.15)] text-[#a5b4fc]' 
                        : 'bg-[rgba(255,255,255,0.04)] text-[#5c5c78]'
                    }
                  `}>
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isActive ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className={`text-[14px] font-medium transition-colors ${isCompleted || isActive ? 'text-[#e8e8f0]' : 'text-[#5c5c78]'}`}>
                        {step.label}
                      </p>
                      {isActive && (
                        <span className="text-[12px] text-[#818cf8] font-medium">
                          {Math.round(stepProgress)}%
                        </span>
                      )}
                    </div>
                    {isActive && step.id === 'nodes' && nodeCount > 0 && !isRateLimited && (
                      <p className="text-[12px] text-[#818cf8] mt-0.5 font-medium">
                        {nodeCount} nodes generated
                      </p>
                    )}
                    {/* Rate limit indicator */}
                    {isActive && step.id === 'nodes' && isRateLimited && (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-[rgba(251,191,36,0.1)] rounded-md">
                          <div className="w-2 h-2 bg-[#fbbf24] rounded-full animate-pulse" />
                          <span className="text-[11px] text-[#fbbf24] font-medium">
                            Rate limited - retrying in {rateLimitCountdown}s
                          </span>
                        </div>
                      </div>
                    )}
                    {/* Refinement status for autofix step */}
                    {isActive && step.id === 'autofix' && refinementStatus && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 ${
                            refinementStatus.phase === 'validating' 
                              ? 'bg-[rgba(99,102,241,0.15)] text-[#a5b4fc]' 
                              : 'bg-[rgba(251,191,36,0.15)] text-[#fbbf24]'
                          }`}>
                            {refinementStatus.phase === 'validating' ? (
                              <Shield className="w-3 h-3" />
                            ) : (
                              <RotateCw className="w-3 h-3 animate-spin" />
                            )}
                            {refinementStatus.phase === 'validating' ? 'Validating' : 'AI Fixing'}
                          </div>
                          <span className="text-[11px] text-[#8585a3]">
                            Attempt {refinementStatus.iteration} of 5
                          </span>
                        </div>
                        {refinementStatus.errors && refinementStatus.errors.length > 0 && (
                          <div className="p-2 bg-[rgba(239,68,68,0.08)] rounded-lg border border-[rgba(239,68,68,0.15)]">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] text-[#f87171] font-medium">
                                {refinementStatus.errors.length} error{refinementStatus.errors.length !== 1 ? 's' : ''} to fix
                              </span>
                              <button
                                onClick={() => copyErrorsToClipboard(refinementStatus.errors || [])}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[#8585a3] hover:text-[#e8e8f0] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                                title="Copy errors to clipboard"
                              >
                                {errorsCopied ? (
                                  <>
                                    <Check className="w-3 h-3 text-[#4ade80]" />
                                    <span className="text-[#4ade80]">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="space-y-1 max-h-16 overflow-y-auto">
                              {refinementStatus.errors.slice(0, 2).map((err, idx) => (
                                <p key={idx} className="text-[10px] text-[#c4c4d6] leading-tight">
                                  • {err.length > 80 ? err.substring(0, 80) + '...' : err}
                                </p>
                              ))}
                              {refinementStatus.errors.length > 2 && (
                                <p className="text-[10px] text-[#5c5c78]">
                                  +{refinementStatus.errors.length - 2} more errors
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isCompleted && (
                    <span className="text-[12px] text-[#4ade80] font-medium">Done</span>
                  )}
                </div>
              );
            })}
          </div>
          
        </Card>
      )}

      {/* AI Auto-Fix Results */}
      {isComplete && refinementResult && (
        <Card variant="elevated" className={`max-w-xl mx-auto animate-fade-up ${
          refinementResult.valid 
            ? 'border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.02)]'
            : refinementResult.iterations > 0
              ? 'border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.02)]'
              : ''
        }`}>
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              {refinementResult.valid ? (
                <div className="w-10 h-10 rounded-full bg-[rgba(34,197,94,0.15)] flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-[#4ade80]" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-[rgba(251,191,36,0.15)] flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-[#fbbf24]" />
                </div>
              )}
              <div>
                <h3 className="text-[15px] font-semibold text-[#e8e8f0]">
                  {refinementResult.valid 
                    ? 'Official Validation Passed!' 
                    : `Auto-Fix Completed (${refinementResult.iterations} iterations)`
                  }
                </h3>
                <p className="text-[13px] text-[#8585a3]">
                  {refinementResult.valid 
                    ? 'Bot Manager API validated your solution successfully'
                    : refinementResult.remainingErrors.length > 0
                      ? `${refinementResult.remainingErrors.length} issues remaining`
                      : 'Manual review recommended'
                  }
                </p>
              </div>
            </div>
            
            {/* Fixes Made */}
            {refinementResult.fixesMade.length > 0 && (
              <div className="mb-3">
                <p className="text-[12px] text-[#5c5c78] font-medium mb-1.5">
                  AI Applied {refinementResult.fixesMade.length} Fixes:
                </p>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {refinementResult.fixesMade.slice(0, 5).map((fix, idx) => (
                    <p key={idx} className="text-[11px] text-[#a5b4fc] flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-[#4ade80] mt-0.5 shrink-0" />
                      <span>{fix}</span>
                    </p>
                  ))}
                  {refinementResult.fixesMade.length > 5 && (
                    <p className="text-[11px] text-[#5c5c78]">
                      ...and {refinementResult.fixesMade.length - 5} more fixes
                    </p>
                  )}
                </div>
              </div>
            )}
            
            {/* Remaining Errors */}
            {!refinementResult.valid && refinementResult.remainingErrors.length > 0 && (
              <div className="p-2.5 bg-[rgba(239,68,68,0.05)] rounded-lg border border-[rgba(239,68,68,0.1)]">
                <p className="text-[11px] text-[#f87171] font-medium mb-1">Remaining Issues:</p>
                <div className="max-h-20 overflow-y-auto space-y-0.5">
                  {refinementResult.remainingErrors.slice(0, 3).map((err, idx) => (
                    <p key={idx} className="text-[11px] text-[#c4c4d6]">• {err}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Completion Stats */}
      {isComplete && generationResult && (
        <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto animate-fade-up">
          <Card variant="ghost" className="text-center py-5">
            <div className="text-2xl font-bold text-[#a5b4fc] mb-1">{nodeCount}</div>
            <div className="text-[12px] text-[#5c5c78] font-medium">Total Nodes</div>
          </Card>
          <Card variant="ghost" className="text-center py-5">
            <div className="text-2xl font-bold text-[#4ade80] mb-1">
              {generationResult.officialNodesUsed?.length || 0}
            </div>
            <div className="text-[12px] text-[#5c5c78] font-medium">Official Nodes</div>
          </Card>
          <Card variant="ghost" className="text-center py-5">
            <div className="text-2xl font-bold text-[#fbbf24] mb-1">
              {validationWarnings.length}
            </div>
            <div className="text-[12px] text-[#5c5c78] font-medium">Warnings</div>
          </Card>
        </div>
      )}
      
      {/* Official Nodes Used */}
      {isComplete && generationResult?.officialNodesUsed && generationResult.officialNodesUsed.length > 0 && (
        <Card variant="ghost" className="max-w-xl mx-auto animate-fade-up">
          <div className="px-4 py-3">
            <p className="text-[12px] text-[#5c5c78] font-medium mb-2">Official Action Nodes Used</p>
            <div className="flex flex-wrap gap-2">
              {generationResult.officialNodesUsed.map((node, i) => (
                <span 
                  key={i}
                  className="px-2 py-1 text-[11px] bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] rounded-md"
                >
                  {node}
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}
      
      {/* Custom Scripts Notice */}
      {isComplete && generationResult?.customScripts && generationResult.customScripts.length > 0 && (
        <Card variant="ghost" className="max-w-xl mx-auto animate-fade-up border-amber-500/20">
          <div className="px-4 py-3">
            <p className="text-[12px] text-amber-400 font-medium mb-2">
              Custom Scripts Generated ({generationResult.customScripts.length})
            </p>
            <p className="text-[11px] text-[#8585a3]">
              These scripts will need to be uploaded to the Pypestream platform.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {generationResult.customScripts.map((script, i) => (
                <span 
                  key={i}
                  className="px-2 py-1 text-[11px] bg-amber-500/10 text-amber-400 rounded-md"
                >
                  {script.name}
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Validation Warning */}
      {isComplete && refinementResult && !refinementResult.valid && refinementResult.remainingErrors?.length > 0 && (
        <Card variant="elevated" className="max-w-xl mx-auto border-yellow-500/20 mb-4">
          <div className="flex items-start gap-4 p-4">
            <div className="w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-medium text-yellow-400 mb-1">
                Validation incomplete - {refinementResult.remainingErrors.length} error{refinementResult.remainingErrors.length !== 1 ? 's' : ''} remaining
              </p>
              <p className="text-[12px] text-[#8585a3]">
                The auto-fix couldn't resolve all errors. You can still review your solution and try manual fixes or regenerate.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Continue Button */}
      {isComplete && (
        <div className="flex justify-center gap-3 pt-2 animate-fade-up">
          {hasExistingSolution && (
            <Button 
              size="lg"
              variant="outline"
              onClick={handleRegenerate}
              icon={<RotateCw className="w-4 h-4" />}
            >
              Regenerate
            </Button>
          )}
          <Button 
            size="lg"
            onClick={nextStep}
            icon={<ArrowRight className="w-4 h-4" />}
            iconPosition="right"
            variant={refinementResult?.valid ? 'primary' : 'secondary'}
          >
            {refinementResult?.valid 
              ? 'Continue to Review' 
              : refinementResult && refinementResult.remainingErrors?.length > 0
                ? 'Review (Has Errors)'
                : 'Review (Not Validated)'}
          </Button>
        </div>
      )}
    </div>
  );
}

// Helper to generate README if not provided by AI
function generateReadme(projectConfig: any, result: GenerationResult): string {
  const clientName = projectConfig.clientName || 'Client';
  const projectName = projectConfig.projectName || 'Project';
  
  let readme = `# ${clientName} - ${projectName}

## Overview
Generated by Pypestream Solution Builder using AI.

## Action Node Usage

### Official Nodes Used
${result.officialNodesUsed?.map(n => `- ${n}`).join('\n') || '- None specified'}

### Custom Nodes Created
${result.customScripts?.length 
  ? result.customScripts.map(s => `- ${s.name}`).join('\n')
  : 'None - all official nodes used.'}

## Statistics
- Total Nodes: ${result.nodeCount}
`;

  if (result.warnings?.length) {
    readme += `
## Warnings
${result.warnings.map(w => `- ${w}`).join('\n')}
`;
  }

  return readme;
}
