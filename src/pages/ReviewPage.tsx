import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Card, CardHeader } from '../components/Card';
import { Input } from '../components/Input';
import { ConnectService } from '../components/ConnectService';
import { exportToGoogleSheets } from '../services/composio';
import { 
  validateWithBotManager, 
  generateBotId, 
  formatBotManagerErrors 
} from '../services/botmanager';
import { 
  validateAndRefineIteratively,
  sanitizeCSVForDeploy,
  structuralPreValidation,
  parseCSVStats,
  applyMockDataToWarning,
  enrichWarningsWithApiInfo
} from '../services/generation';
import { 
  ArrowRight, 
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  Download,
  Copy,
  ExternalLink,
  Code,
  Shield,
  Loader2,
  Wand2,
  RotateCw,
  Database,
  Check
} from 'lucide-react';

type TabId = 'overview' | 'nodes' | 'validation' | 'readme';

export function ReviewPage() {
  const { 
    projectConfig,
    solution,
    setSolution,
    integrations,
    user,
    credentials,
    setCredentials,
    nextStep, 
    prevStep,
    activeSolutionId,
    updateSavedSolution,
    restoreSolutionFromSaved,
    savedSolutions,
    solutionsLoaded,
    fetchSavedSolutions,
  } = useStore();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  
  const setActiveSolution = useStore((state) => state.setActiveSolution);
  
  // Debug: Log restoration state
  useEffect(() => {
    console.log('[Review] State check:', {
      activeSolutionId,
      hasSolution: !!solution,
      hasCsvContent: !!solution?.csvContent,
      solutionsLoaded,
      savedSolutionsCount: savedSolutions.length,
    });
  }, [activeSolutionId, solution, solutionsLoaded, savedSolutions]);
  
  // Restore solution from Supabase if needed (after page reload)
  useEffect(() => {
    // If solutions haven't been loaded yet, fetch them first
    if (!solutionsLoaded) {
      console.log('[Review] Fetching solutions from Supabase...');
      fetchSavedSolutions();
      return;
    }
    
    // If no active solution ID but we have solutions, select the most recent one
    if (!activeSolutionId && savedSolutions.length > 0 && !solution?.csvContent) {
      // Sort by updatedAt descending and pick the most recent
      const sortedSolutions = [...savedSolutions].sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      const mostRecent = sortedSolutions[0];
      console.log('[Review] No active solution, auto-selecting most recent:', mostRecent.name);
      setActiveSolution(mostRecent.id);
      return;
    }
    
    // If we have an active solution ID but no solution data, try to restore from Supabase
    if (activeSolutionId && !solution?.csvContent) {
      console.log('[Review] Solution missing, attempting restore...');
      const savedSolution = savedSolutions.find(s => s.id === activeSolutionId);
      console.log('[Review] Found saved solution:', savedSolution?.name, 'has csvContent:', !!savedSolution?.csvContent);
      restoreSolutionFromSaved();
    }
  }, [activeSolutionId, solution, solutionsLoaded, savedSolutions, restoreSolutionFromSaved, fetchSavedSolutions, setActiveSolution]);
  const [copied, setCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ success: boolean; url?: string; error?: string } | null>(null);
  
  // Official validation state
  const [isOfficialValidating, setIsOfficialValidating] = useState(false);
  const [officialValidationResult, setOfficialValidationResult] = useState<{
    valid: boolean;
    versionId?: string;
    errors?: string[];
    message?: string;
  } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  
  // Autofix state
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [autoFixStatus, setAutoFixStatus] = useState<string>('');
  const [autoFixIteration, setAutoFixIteration] = useState(0);
  const [currentErrors, setCurrentErrors] = useState<string[]>([]);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  
  // Mock data state
  const [mockDataApplied, setMockDataApplied] = useState<Set<number>>(new Set());
  const [applyingMockData, setApplyingMockData] = useState<number | null>(null);

  // Enrich warnings with API dependency info (for legacy solutions without it)
  const enrichedWarnings = useMemo(() => {
    const warnings = solution?.validationResult?.warnings || [];
    // If warnings already have apiDependency, return as-is
    if (warnings.length > 0 && warnings.some(w => w.apiDependency)) {
      return warnings;
    }
    // Otherwise, enrich them
    const warningMessages = warnings.map(w => w.message);
    return enrichWarningsWithApiInfo(warningMessages);
  }, [solution?.validationResult?.warnings]);

  const googleSheetsConnected = integrations.find((i) => i.id === 'google-sheets')?.connected;
  const hasApiKey = !!credentials.pypestreamApiKey;
  
  // Calculate node stats directly from CSV (more reliable than stored stats)
  const nodeStats = useMemo(() => {
    if (!solution?.csvContent) {
      return { totalNodes: 0, decisionNodes: 0, actionNodes: 0 };
    }
    
    let decisionNodes = 0;
    let actionNodes = 0;
    
    try {
      const lines = solution.csvContent.split('\n');
      // Skip header row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Node Type is column 2 (index 1 after split)
        const match = line.match(/^[^,]*,\s*([^,]*)/);
        const nodeType = match?.[1]?.trim().toUpperCase();
        if (nodeType === 'D') decisionNodes++;
        else if (nodeType === 'A') actionNodes++;
      }
    } catch (e) {
      console.warn('[ReviewPage] Could not parse CSV for node counts:', e);
    }
    
    const totalNodes = decisionNodes + actionNodes;
    return { totalNodes, decisionNodes, actionNodes };
  }, [solution?.csvContent]);
  
  // Debug: Log what CSV we have on mount
  useEffect(() => {
    if (solution?.csvContent) {
      console.log(`[ReviewPage] Solution loaded with csvContent length: ${solution.csvContent.length}`);
      console.log(`[ReviewPage] Node stats:`, nodeStats);
    } else {
      console.warn('[ReviewPage] No solution.csvContent available!');
    }
  }, [solution?.csvContent, nodeStats]);
  
  // If solution was already officially validated in generation, show that result
  useEffect(() => {
    if (solution?.validationResult?.officiallyValidated && !officialValidationResult) {
      console.log('[ReviewPage] Using validation result from generation page');
      setOfficialValidationResult({
        valid: solution.validationResult.passed || false,
        versionId: solution.validationResult.versionId,
        message: 'Validated during generation',
      });
    }
  }, [solution?.validationResult?.officiallyValidated]);
  
  // If solution was already exported to Google Sheets, show the link
  useEffect(() => {
    if (solution?.spreadsheetUrl && !exportResult) {
      setExportResult({ success: true, url: solution.spreadsheetUrl });
    }
  }, [solution?.spreadsheetUrl]);
  
  // Handle official Bot Manager validation
  const handleOfficialValidation = async () => {
    if (!solution?.csvContent) return;
    
    const token = credentials.pypestreamApiKey;
    if (!token) return;
    
    setIsOfficialValidating(true);
    setOfficialValidationResult(null);
    
    try {
      const botId = generateBotId(
        projectConfig.clientName || 'Client',
        projectConfig.projectName || 'Bot'
      );
      
      const result = await validateWithBotManager(solution.csvContent, botId, token);
      
      setOfficialValidationResult({
        valid: result.valid,
        versionId: result.versionId,
        errors: result.errors ? formatBotManagerErrors(result.errors) : undefined,
        message: result.message,
      });
      
      // Update solution with official validation status
      if (result.valid && solution) {
        setSolution({
          ...solution,
          validationResult: {
            ...solution.validationResult!,
            passed: true,
            officiallyValidated: true,
            versionId: result.versionId,
          },
        });
      }
      
    } catch (error: any) {
      const errorMsg = error.message || 'Validation failed';
      const isAuthError = errorMsg.toLowerCase().includes('token') || 
                          errorMsg.toLowerCase().includes('auth') ||
                          errorMsg.toLowerCase().includes('401') ||
                          errorMsg.toLowerCase().includes('expired') ||
                          errorMsg.toLowerCase().includes('invalid');
      
      setOfficialValidationResult({
        valid: false,
        errors: [errorMsg],
        message: isAuthError ? 'Please update your API key and try again.' : undefined,
      });
      
      // Auto-show API key input on auth errors
      if (isAuthError) {
        setShowApiKeyInput(true);
      }
    }
    
    setIsOfficialValidating(false);
  };
  
  // Handle autofix and revalidate
  const handleAutoFixAndRevalidate = async () => {
    if (!solution?.csvContent || !credentials.pypestreamApiKey) return;
    
    const token = credentials.pypestreamApiKey;
    const botId = generateBotId(
      projectConfig.clientName || 'Client',
      projectConfig.projectName || 'Bot'
    );
    
    setIsAutoFixing(true);
    setAutoFixStatus('Sanitizing CSV...');
    setAutoFixIteration(0);
    setCurrentErrors([]);
    
    try {
      // First run structural pre-validation (catches orphans, dead-ends, format issues)
      const preResult = structuralPreValidation(solution.csvContent);
      if (preResult.fixes.length > 0) {
        console.log(`[Pre-Validation] Applied ${preResult.fixes.length} structural fixes:`, preResult.fixes);
      }
      // Then sanitize the CSV
      const sanitizedCsv = sanitizeCSVForDeploy(preResult.csv);
      
      setAutoFixStatus('Running AI auto-fix...');
      
      // Run the iterative validation and refinement
      const result = await validateAndRefineIteratively(
        sanitizedCsv,
        botId,
        token,
        projectConfig, // project config for AI context
        (progress) => {
          setAutoFixIteration(progress.iteration);
          if (progress.phase === 'validating') {
            setAutoFixStatus(`Validating (attempt ${progress.iteration})...`);
          } else {
            setAutoFixStatus(`AI fixing ${progress.errors?.length || 0} errors (attempt ${progress.iteration})...`);
          }
          // Update BOTH current errors AND the main error list in real-time
          if (progress.errors && progress.errors.length > 0) {
            setCurrentErrors(progress.errors);
            // Also update the main error display so user sees errors decreasing
            setOfficialValidationResult(prev => ({
              ...prev!,
              valid: false,
              errors: progress.errors,
              message: `Iteration ${progress.iteration}: ${progress.errors!.length} errors remaining`
            }));
          } else if (progress.phase === 'validating' && progress.iteration > 1) {
            // Clear errors when re-validating (before we know the result)
            setCurrentErrors([]);
          }
        },
        5 // max iterations
      );
      
      // Always update solution with the latest CSV (even if errors remain)
      // This preserves progress so the next auto-fix attempt continues from here
      const stats = parseCSVStats(result.csv);
      setSolution({
        ...solution,
        csvContent: result.csv,
        validationResult: {
          ...solution.validationResult!,
          passed: result.valid,
          officiallyValidated: result.valid,
          versionId: result.versionId,
          decisionNodes: stats.decisionNodes,
          actionNodes: stats.actionNodes,
        },
      });
      
      // Save to Supabase (preserve progress even if not fully fixed)
      if (activeSolutionId) {
        updateSavedSolution(activeSolutionId, {
          csvContent: result.csv,
        });
      }
      
      if (result.valid) {
        setOfficialValidationResult({
          valid: true,
          versionId: result.versionId,
          message: `Fixed in ${result.iterations || 1} iteration(s). Fixes: ${(result.allFixesMade || ['Validation passed']).join(', ')}`,
        });
      } else {
        const errorCount = result.remainingErrors ? result.remainingErrors.length : 0;
        setOfficialValidationResult({
          valid: false,
          errors: result.remainingErrors && result.remainingErrors.length > 0 ? result.remainingErrors : ['Auto-fix could not resolve all errors'],
          message: `Attempted ${result.iterations} iteration(s), ${errorCount} error(s) remain. Click again to continue fixing.`,
        });
      }
    } catch (error: any) {
      const errorMsg = error.message || 'Auto-fix failed';
      const isAuthError = error.name === 'AuthError' ||
                          errorMsg.toLowerCase().includes('token') || 
                          errorMsg.toLowerCase().includes('auth') ||
                          errorMsg.toLowerCase().includes('401') ||
                          errorMsg.toLowerCase().includes('expired') ||
                          errorMsg.toLowerCase().includes('invalid');
      
      setOfficialValidationResult({
        valid: false,
        errors: [errorMsg],
        message: isAuthError ? 'API key is invalid or expired. Please update your key.' : undefined,
      });
      
      // Auto-show API key input on auth errors
      if (isAuthError) {
        setShowApiKeyInput(true);
      }
    }
    
    setIsAutoFixing(false);
    setAutoFixStatus('');
  };
  
  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      setCredentials({ pypestreamApiKey: apiKeyInput.trim() });
      setApiKeyInput('');
    }
  };

  // Handle applying mock data to a warning's API dependency
  const handleApplyMockData = async (warningIndex: number, warningMessage: string) => {
    if (!solution?.csvContent) return;
    
    setApplyingMockData(warningIndex);
    
    try {
      const result = applyMockDataToWarning(solution.csvContent, warningMessage);
      
      if (result.applied) {
        // Update solution with modified CSV
        const updatedSolution = {
          ...solution,
          csvContent: result.csv,
        };
        setSolution(updatedSolution);
        
        // Mark this warning as having mock data applied
        setMockDataApplied(prev => new Set([...prev, warningIndex]));
        
        // Update warnings to show mock data was applied
        if (solution.validationResult?.warnings) {
          const updatedWarnings = [...solution.validationResult.warnings];
          if (updatedWarnings[warningIndex]?.apiDependency) {
            updatedWarnings[warningIndex] = {
              ...updatedWarnings[warningIndex],
              apiDependency: {
                ...updatedWarnings[warningIndex].apiDependency!,
                mockDataApplied: true,
              },
            };
          }
          
          setSolution({
            ...updatedSolution,
            validationResult: {
              ...solution.validationResult,
              warnings: updatedWarnings,
            },
          });
        }
        
        // Save to Supabase
        if (activeSolutionId) {
          await updateSavedSolution(activeSolutionId, {
            csvContent: result.csv,
          });
        }
        
        console.log(`[MockData] Applied mock data: ${result.changes.join(', ')}`);
      } else {
        console.log(`[MockData] No matching nodes found for warning: ${warningMessage}`);
      }
    } catch (error) {
      console.error('[MockData] Error applying mock data:', error);
    }
    
    setApplyingMockData(null);
  };

  const handleCopyCSV = () => {
    if (solution?.csvContent) {
      navigator.clipboard.writeText(solution.csvContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadCSV = () => {
    if (solution?.csvContent) {
      const blob = new Blob([solution.csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectConfig.clientName}-${projectConfig.projectName}-bot.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExportToSheets = async () => {
    if (!solution?.csvContent) {
      setExportResult({ success: false, error: 'No CSV content to export' });
      return;
    }
    
    setIsExporting(true);
    setExportResult(null);
    
    try {
      const fileName = `${projectConfig.clientName}-${projectConfig.projectName}-bot`;
      const userId = user.email || `user_${Date.now()}`;
      
      const result = await exportToGoogleSheets(solution.csvContent, fileName, userId);
      
      if (result.success && result.spreadsheetUrl) {
        setExportResult({ success: true, url: result.spreadsheetUrl });
        
        // Update local solution with spreadsheet URL (persists on reload)
        setSolution({
          ...solution,
          spreadsheetUrl: result.spreadsheetUrl,
          spreadsheetId: result.spreadsheetId,
        });
        
        // Save spreadsheet URL to solution in Supabase
        if (activeSolutionId) {
          await updateSavedSolution(activeSolutionId, {
            spreadsheetUrl: result.spreadsheetUrl,
            currentStep: 'review',
          });
        }
        
        // Open the spreadsheet in a new tab
        window.open(result.spreadsheetUrl, '_blank');
      } else {
        setExportResult({ success: false, error: result.error || 'Export failed' });
      }
    } catch (error) {
      setExportResult({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Export failed' 
      });
    } finally {
      setIsExporting(false);
    }
  };

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'nodes' as const, label: 'Nodes' },
    { id: 'validation' as const, label: 'Validation' },
    { id: 'readme' as const, label: 'README' },
  ];

  return (
    <div className="space-y-6 stagger-children">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-headline text-[#f0f0f5] mb-2">Review solution</h2>
          <p className="text-body text-[#8585a3]">
            Review before deployment
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyCSV} icon={<Copy className="w-3.5 h-3.5" />}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadCSV} icon={<Download className="w-3.5 h-3.5" />}>
            Download
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[rgba(255,255,255,0.06)]">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-4 py-2.5 text-[13px] font-medium rounded-t-lg transition-all duration-200
                ${activeTab === tab.id
                  ? 'text-[#e8e8f0] bg-[rgba(255,255,255,0.04)] border-b-2 border-[#6366f1]'
                  : 'text-[#8585a3] hover:text-[#c4c4d6]'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[350px]">
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card variant="ghost">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.15)] flex items-center justify-center">
                    <FileSpreadsheet className="w-5 h-5 text-[#818cf8]" />
                  </div>
                  <div>
                    <div className="text-xl font-bold text-[#e8e8f0]">
                      {nodeStats.totalNodes}
                    </div>
                    <div className="text-[11px] text-[#5c5c78] font-medium">Total Nodes</div>
                  </div>
                </div>
              </Card>

              <Card variant="ghost">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.15)] flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-[#4ade80]" />
                  </div>
                  <div>
                    <div className="text-xl font-bold text-[#e8e8f0]">
                      {nodeStats.decisionNodes}
                    </div>
                    <div className="text-[11px] text-[#5c5c78] font-medium">Decision</div>
                  </div>
                </div>
              </Card>

              <Card variant="ghost">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[rgba(139,92,246,0.1)] border border-[rgba(139,92,246,0.15)] flex items-center justify-center">
                    <Code className="w-5 h-5 text-[#a78bfa]" />
                  </div>
                  <div>
                    <div className="text-xl font-bold text-[#e8e8f0]">
                      {nodeStats.actionNodes}
                    </div>
                    <div className="text-[11px] text-[#5c5c78] font-medium">Action</div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Project Info */}
            <Card>
              <CardHeader title="Project Details" size="sm" />
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div className="flex justify-between p-2.5 rounded-lg bg-[rgba(255,255,255,0.02)]">
                  <span className="text-[#8585a3]">Client</span>
                  <span className="text-[#e8e8f0] font-medium">{projectConfig.clientName}</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-[rgba(255,255,255,0.02)]">
                  <span className="text-[#8585a3]">Project</span>
                  <span className="text-[#e8e8f0] font-medium">{projectConfig.projectName}</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-[rgba(255,255,255,0.02)]">
                  <span className="text-[#8585a3]">Type</span>
                  <span className="text-[#e8e8f0] font-medium capitalize">{projectConfig.projectType}</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-[rgba(255,255,255,0.02)]">
                  <span className="text-[#8585a3]">Bot ID</span>
                  <span className="text-[#e8e8f0] font-mono text-[12px]">
                    {projectConfig.clientName}.{projectConfig.projectName}
                  </span>
                </div>
              </div>
            </Card>

            {/* Google Sheets Export - Contextual Connection */}
            <Card>
              <CardHeader 
                title="Export to Google Sheets" 
                description="Populate your bot CSV directly in Sheets"
                icon={<FileSpreadsheet className="w-5 h-5" />}
                size="sm"
              />
              
              {googleSheetsConnected ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-[rgba(34,197,94,0.04)] rounded-xl border border-[rgba(34,197,94,0.12)]">
                    <div className="flex items-center gap-2 text-[13px] text-[#4ade80]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Google Sheets connected</span>
                    </div>
                    <Button 
                      size="sm" 
                      onClick={handleExportToSheets}
                      loading={isExporting}
                      icon={<ExternalLink className="w-3.5 h-3.5" />}
                    >
                      {isExporting ? 'Exporting...' : 'Export to Sheets'}
                    </Button>
                  </div>
                  
                  {/* Export result feedback */}
                  {exportResult && (
                    <div className={`p-3 rounded-xl border ${
                      exportResult.success 
                        ? 'bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.15)]' 
                        : 'bg-[rgba(239,68,68,0.06)] border-[rgba(239,68,68,0.15)]'
                    }`}>
                      {exportResult.success ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-[13px] text-[#4ade80]">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>
                              {/* Show "Previously exported" if URL came from saved solution */}
                              {solution?.spreadsheetUrl === exportResult.url && !isExporting
                                ? 'Previously exported to Sheets'
                                : 'Exported successfully!'
                              }
                            </span>
                          </div>
                          {exportResult.url && (
                            <a 
                              href={exportResult.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[12px] text-[#818cf8] hover:text-[#a5b4fc] flex items-center gap-1"
                            >
                              Open Sheet <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[13px] text-[#f87171]">
                          <XCircle className="w-4 h-4" />
                          <span>{exportResult.error}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-[rgba(255,255,255,0.02)] rounded-xl border border-[rgba(255,255,255,0.06)]">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] text-[#8585a3]">
                      Connect Google Sheets to export your solution directly
                    </p>
                    <ConnectService 
                      serviceId="google-sheets" 
                      variant="inline"
                      actionLabel="Connect Sheets"
                    />
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {activeTab === 'nodes' && (
          <Card padding="none">
            <div className="p-4 border-b border-[rgba(255,255,255,0.06)]">
              <h3 className="text-[14px] font-medium text-[#e8e8f0]">Generated Nodes</h3>
            </div>
            <div className="p-4 font-mono text-[12px] overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[#5c5c78] border-b border-[rgba(255,255,255,0.04)]">
                    <th className="pb-3 pr-4 font-medium">Node</th>
                    <th className="pb-3 pr-4 font-medium">Type</th>
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 font-medium">Command</th>
                  </tr>
                </thead>
                <tbody className="text-[#a3a3bd]">
                  <tr className="border-b border-[rgba(255,255,255,0.03)]"><td className="py-2.5 pr-4 text-[#818cf8]">-500</td><td className="py-2.5 pr-4">A</td><td className="py-2.5 pr-4">HandleBotError</td><td className="py-2.5">HandleBotError</td></tr>
                  <tr className="border-b border-[rgba(255,255,255,0.03)]"><td className="py-2.5 pr-4 text-[#818cf8]">1</td><td className="py-2.5 pr-4">A</td><td className="py-2.5 pr-4">SysShowMetadata</td><td className="py-2.5">SysShowMetadata</td></tr>
                  <tr className="border-b border-[rgba(255,255,255,0.03)]"><td className="py-2.5 pr-4 text-[#818cf8]">10</td><td className="py-2.5 pr-4">A</td><td className="py-2.5 pr-4">UserPlatformRouting</td><td className="py-2.5">UserPlatformRouting</td></tr>
                  <tr className="border-b border-[rgba(255,255,255,0.03)]"><td className="py-2.5 pr-4 text-[#818cf8]">100</td><td className="py-2.5 pr-4">A</td><td className="py-2.5 pr-4">SysAssignVariable</td><td className="py-2.5">SysAssignVariable</td></tr>
                  <tr className="border-b border-[rgba(255,255,255,0.03)]"><td className="py-2.5 pr-4 text-[#818cf8]">105</td><td className="py-2.5 pr-4">D</td><td className="py-2.5 pr-4">Welcome Message</td><td className="py-2.5 text-[#5c5c78]">—</td></tr>
                  <tr><td className="py-2.5 pr-4 text-[#5c5c78]">...</td><td className="py-2.5 pr-4 text-[#5c5c78]">...</td><td className="py-2.5 pr-4 text-[#5c5c78]">+ 40 more</td><td className="py-2.5 text-[#5c5c78]">...</td></tr>
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {activeTab === 'validation' && (
          <div className="space-y-4">
            {/* Local Validation Status */}
            <Card className={solution?.validationResult?.passed ? 'bg-[rgba(34,197,94,0.04)] border-[rgba(34,197,94,0.15)]' : 'bg-[rgba(239,68,68,0.04)] border-[rgba(239,68,68,0.15)]'}>
              <div className="flex items-center gap-3">
                {solution?.validationResult?.passed ? (
                  <CheckCircle2 className="w-6 h-6 text-[#4ade80]" />
                ) : (
                  <XCircle className="w-6 h-6 text-[#f87171]" />
                )}
                <div>
                  <h3 className="text-[15px] font-semibold text-[#e8e8f0]">
                    {solution?.validationResult?.passed ? 'Local Validation Passed' : 'Local Validation Failed'}
                  </h3>
                  <p className="text-[13px] text-[#8585a3]">
                    {solution?.validationResult?.errors.length || 0} errors, {solution?.validationResult?.warnings.length || 0} warnings
                  </p>
                </div>
              </div>
            </Card>

            {/* Official Bot Manager Validation */}
            <Card variant="elevated">
              <CardHeader 
                title="Official Bot Manager Validation" 
                description="Validate using Pypestream's production compiler"
                icon={<Shield className="w-5 h-5" />}
                size="sm"
              />
              
              {hasApiKey && !showApiKeyInput ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-[rgba(99,102,241,0.04)] rounded-xl border border-[rgba(99,102,241,0.12)]">
                    <div className="flex items-center gap-2 text-[13px] text-[#a5b4fc]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>API key configured</span>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowApiKeyInput(true)}
                      >
                        Update Key
                      </Button>
                      <Button 
                        size="sm" 
                        onClick={handleOfficialValidation}
                        loading={isOfficialValidating}
                        icon={<Shield className="w-3.5 h-3.5" />}
                      >
                        {isOfficialValidating ? 'Validating...' : 'Run Official Validation'}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Official validation result */}
                  {officialValidationResult && (
                    <div className={`p-4 rounded-xl border ${
                      officialValidationResult.valid 
                        ? 'bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.15)]' 
                        : 'bg-[rgba(239,68,68,0.06)] border-[rgba(239,68,68,0.15)]'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        {officialValidationResult.valid ? (
                          <CheckCircle2 className="w-5 h-5 text-[#4ade80]" />
                        ) : (
                          <XCircle className="w-5 h-5 text-[#f87171]" />
                        )}
                        <span className={`text-[14px] font-medium ${
                          officialValidationResult.valid ? 'text-[#4ade80]' : 'text-[#f87171]'
                        }`}>
                          {officialValidationResult.valid ? 'Official Validation Passed!' : 'Official Validation Failed'}
                        </span>
                      </div>
                      
                      {officialValidationResult.versionId && (
                        <p className="text-[12px] text-[#8585a3] mb-2">
                          Version: <span className="font-mono text-[#a5b4fc]">{officialValidationResult.versionId}</span>
                        </p>
                      )}
                      
                      {officialValidationResult.errors && officialValidationResult.errors.length > 0 && (
                        <div className="space-y-1 mt-2" key={`errors-${officialValidationResult.errors.length}-${autoFixIteration}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[12px] text-[#f87171] font-medium">
                              {officialValidationResult.errors.length} error{officialValidationResult.errors.length !== 1 ? 's' : ''} found
                              {isAutoFixing && <span className="text-[#fbbf24] ml-2">(updating...)</span>}
                            </span>
                            {officialValidationResult.errors.length > 3 && (
                              <button 
                                onClick={() => setShowAllErrors(!showAllErrors)}
                                className="text-[11px] text-[#a5b4fc] hover:text-[#c4b5fd] transition-colors"
                              >
                                {showAllErrors ? 'Show less' : `Show all ${officialValidationResult.errors.length}`}
                              </button>
                            )}
                          </div>
                          <div className={`space-y-1 ${showAllErrors ? 'max-h-[300px] overflow-y-auto' : ''}`}>
                            {(showAllErrors ? officialValidationResult.errors : officialValidationResult.errors.slice(0, 3)).map((error, idx) => (
                              <div key={`${autoFixIteration}-${idx}-${error.substring(0, 20)}`} className="text-[12px] text-[#f87171] flex items-start gap-2 p-2 bg-[rgba(239,68,68,0.04)] rounded transition-all duration-300">
                                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                <span className="break-words">{error}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {officialValidationResult.message && (
                        <p className="text-[12px] text-[#8585a3] mt-2">{officialValidationResult.message}</p>
                      )}
                      
                      {/* Autofix button - only show when validation failed */}
                      {!officialValidationResult.valid && (
                        <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                          {isAutoFixing ? (
                            <div className="space-y-3">
                              {/* Progress indicator */}
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-[rgba(99,102,241,0.15)] flex items-center justify-center">
                                  <RotateCw className="w-4 h-4 text-[#a5b4fc] animate-spin" />
                                </div>
                                <div>
                                  <p className="text-[13px] font-medium text-[#e8e8f0]">
                                    {autoFixStatus}
                                  </p>
                                  <p className="text-[11px] text-[#8585a3]">
                                    Iteration {autoFixIteration} of 5
                                  </p>
                                </div>
                              </div>
                              
                              {/* Current errors being fixed */}
                              {currentErrors.length > 0 && (
                                <div className="bg-[rgba(0,0,0,0.2)] rounded-lg p-3">
                                  <p className="text-[11px] text-[#8585a3] mb-2">
                                    Currently fixing {currentErrors.length} error{currentErrors.length !== 1 ? 's' : ''}:
                                  </p>
                                  <div className="space-y-1 max-h-[150px] overflow-y-auto">
                                    {currentErrors.slice(0, 5).map((err, idx) => (
                                      <div key={idx} className="text-[11px] text-[#fbbf24] flex items-start gap-2">
                                        <span className="text-[#8585a3]">•</span>
                                        <span className="truncate">{err}</span>
                                      </div>
                                    ))}
                                    {currentErrors.length > 5 && (
                                      <p className="text-[10px] text-[#5c5c78]">
                                        +{currentErrors.length - 5} more
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={handleAutoFixAndRevalidate}
                                icon={<Wand2 className="w-3.5 h-3.5" />}
                              >
                                Auto-Fix & Revalidate
                              </Button>
                              <p className="text-[11px] text-[#5c5c78] mt-2">
                                Uses AI to automatically fix common errors and revalidate
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] text-[#8585a3]">
                    {showApiKeyInput 
                      ? 'Enter a new API key to replace the current one.'
                      : 'Enter your Pypestream API key to validate with the official Bot Manager compiler.'
                    }
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="Enter Pypestream API key"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="flex-1"
                      autoFocus={showApiKeyInput}
                    />
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      onClick={() => {
                        handleSaveApiKey();
                        setShowApiKeyInput(false);
                      }}
                      disabled={!apiKeyInput.trim()}
                    >
                      {showApiKeyInput ? 'Update Key' : 'Save Key'}
                    </Button>
                    {showApiKeyInput && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setShowApiKeyInput(false);
                          setApiKeyInput('');
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-[#5c5c78]">
                    Find your API key in Pypestream Console → Settings → API Keys
                  </p>
                </div>
              )}
            </Card>

            {/* Warnings section - show if there are warnings */}
            {enrichedWarnings.length > 0 && (
              <Card>
                <CardHeader title="Warnings" description="Recommended to review" size="sm" />
                <div className="space-y-2">
                  {enrichedWarnings.map((warning, index) => (
                    <div key={index} className="flex items-start gap-2.5 p-3 bg-[rgba(251,191,36,0.05)] rounded-xl border border-[rgba(251,191,36,0.1)]">
                      <AlertTriangle className="w-4 h-4 text-[#fbbf24] shrink-0 mt-0.5" />
                      <div className="flex-1 flex items-start justify-between gap-3">
                        <span className="text-[13px] text-[#c4c4d6]">{warning.message}</span>
                        {/* Show "Use Mock Data" button for warnings with API dependencies */}
                        {warning.apiDependency && (
                          <button
                            onClick={() => handleApplyMockData(index, warning.message)}
                            disabled={applyingMockData === index || warning.apiDependency?.mockDataApplied || mockDataApplied.has(index)}
                            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                              warning.apiDependency?.mockDataApplied || mockDataApplied.has(index)
                                ? 'bg-[rgba(74,222,128,0.1)] text-[#4ade80] border border-[rgba(74,222,128,0.2)] cursor-default'
                                : 'bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] border border-[rgba(99,102,241,0.2)] hover:bg-[rgba(99,102,241,0.2)] hover:border-[rgba(99,102,241,0.3)]'
                            }`}
                          >
                            {applyingMockData === index ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>Applying...</span>
                              </>
                            ) : warning.apiDependency?.mockDataApplied || mockDataApplied.has(index) ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Mock Applied</span>
                              </>
                            ) : (
                              <>
                                <Database className="w-3 h-3" />
                                <span>Use Mock Data</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            
            {/* Quick Actions - Always visible */}
            {hasApiKey && !officialValidationResult?.valid && (
              <Card variant="ghost">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-[14px] font-medium text-[#e8e8f0] mb-1">Quick Actions</h4>
                    <p className="text-[12px] text-[#8585a3]">
                      Use AI to automatically fix issues and validate with Bot Manager
                    </p>
                  </div>
                  {isAutoFixing ? (
                    <div className="flex items-center gap-2 text-[13px] text-[#a5b4fc]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{autoFixStatus || `Iteration ${autoFixIteration}...`}</span>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleAutoFixAndRevalidate}
                      icon={<Wand2 className="w-3.5 h-3.5" />}
                    >
                      Auto-Fix & Iterate
                    </Button>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'readme' && (
          <Card padding="none">
            <div className="p-4 border-b border-[rgba(255,255,255,0.06)]">
              <h3 className="text-[14px] font-medium text-[#e8e8f0]">Generated README</h3>
            </div>
            <div className="p-4 font-mono text-[12px] text-[#a3a3bd] whitespace-pre-wrap leading-relaxed overflow-x-auto">
              {solution?.readme || 'No README generated'}
            </div>
          </Card>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={prevStep} icon={<ArrowLeft className="w-4 h-4" />}>
          Back
        </Button>
        <div className="flex items-center gap-3">
          {!solution?.validationResult?.passed && (
            <span className="text-[12px] text-[#f87171] max-w-[200px] text-right">
              Fix validation errors to deploy
            </span>
          )}
          <Button 
            onClick={nextStep} 
            icon={<ArrowRight className="w-4 h-4" />}
            iconPosition="right"
            disabled={!solution?.validationResult?.passed}
          >
            Continue to Deploy
          </Button>
        </div>
      </div>
    </div>
  );
}
