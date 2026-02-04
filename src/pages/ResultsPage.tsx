import { useStore } from '../store/useStore';
import { 
  CheckCircle2, 
  ExternalLink, 
  FileSpreadsheet, 
  Rocket, 
  PenSquare, 
  Plus,
  Copy,
  Check,
  AlertTriangle,
  ClipboardCopy,
  Send,
  Lightbulb,
  Key,
  X,
  Loader2,
  RefreshCw,
  Palette,
  Link2,
  Wand2,
  Sparkles
} from 'lucide-react';
import { useState } from 'react';
import { submitHumanFix } from '../services/error-learning';
import { createChannelWithWidget, oneClickDeploy } from '../services/botmanager';
import { exportToGoogleSheets } from '../services/composio';
import { validateCSV, refineCSV, sanitizeCSVForDeploy } from '../services/generation';

/**
 * ResultsPage - Shows the completed instant build results
 * 
 * Displays:
 * - Success message with solution name and node count
 * - View in Google Sheets button (opens new tab)
 * - View Solution button (opens widget in new tab)
 * - Edit Flow button (opens visual editor)
 * - Create Another button
 */
export function ResultsPage() {
  const { 
    instantBuildResult,
    setInstantBuildResult,
    extractedDetails,
    projectConfig,
    setInstantStep,
    startNewSolution,
    setStep,
    setCredentials,
    credentials,
    activeSolutionId,
    updateSavedSolution,
    integrations,
    connectIntegration,
    user
  } = useStore();
  
  const [copiedWidget, setCopiedWidget] = useState(false);
  const [copiedSheets, setCopiedSheets] = useState(false);
  const [copiedContext, setCopiedContext] = useState(false);
  const [fixInput, setFixInput] = useState('');
  const [submittingFix, setSubmittingFix] = useState(false);
  const [fixSubmitted, setFixSubmitted] = useState(false);
  const [showIntervention, setShowIntervention] = useState(
    instantBuildResult?.needsHumanIntervention || false
  );
  
  // API Key modal state for widget creation
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [creatingWidget, setCreatingWidget] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  
  // Redeploy state
  const [redeploying, setRedeploying] = useState(false);
  const [redeployError, setRedeployError] = useState<string | null>(null);
  const [redeploySuccess, setRedeploySuccess] = useState(false);
  
  // Refresh Widget state (just recreate widget, no deploy)
  const [refreshingWidget, setRefreshingWidget] = useState(false);
  const [refreshWidgetError, setRefreshWidgetError] = useState<string | null>(null);
  const [refreshWidgetSuccess, setRefreshWidgetSuccess] = useState(false);
  
  // Google Sheets export state
  const [exportingToSheets, setExportingToSheets] = useState(false);
  const [sheetsExportError, setSheetsExportError] = useState<string | null>(null);
  
  // AI Review state
  const [aiReviewing, setAiReviewing] = useState(false);
  const [aiReviewPhase, setAiReviewPhase] = useState<'analyzing' | 'applying' | null>(null);
  const [aiReviewResult, setAiReviewResult] = useState<{
    success: boolean;
    analysis?: {
      overallScore?: number;
      summary?: string;
      criticalFlaws?: string[];
      journeys?: Array<{ name: string; nodes: number[]; experience: string; issues: string[] }>;
      issues?: Array<{ severity: string; nodeNum: number; issue: string; suggestion: string; category: string }>;
      improvements?: Array<{ nodeNum: number; field: string; currentValue: string; suggestedValue: string; reason: string }>;
      rewrittenMessages?: Record<string, string>;
      rewrittenButtons?: Record<string, unknown>;
      missingElements?: string[];
    };
    appliedCount?: number;
    error?: string;
  } | null>(null);
  const [showReviewDetails, setShowReviewDetails] = useState(false);
  
  // Check if Google Sheets is connected
  const googleSheetsIntegration = integrations.find((i) => i.id === 'google-sheets');
  const isSheetsConnected = googleSheetsIntegration?.connected ?? false;
  
  const handleCopyContext = async () => {
    if (instantBuildResult?.humanInterventionContext) {
      await navigator.clipboard.writeText(instantBuildResult.humanInterventionContext);
      setCopiedContext(true);
      setTimeout(() => setCopiedContext(false), 2000);
    }
  };
  
  const handleSubmitFix = async () => {
    if (!fixInput.trim()) return;
    
    setSubmittingFix(true);
    try {
      // Parse the fix JSON and submit to learning system
      const fixData = JSON.parse(fixInput);
      await submitHumanFix(fixData);
      setFixSubmitted(true);
      setFixInput('');
    } catch (e) {
      console.error('Failed to parse/submit fix:', e);
      alert('Failed to parse fix JSON. Please check the format.');
    } finally {
      setSubmittingFix(false);
    }
  };
  
  const handleCreateWidget = async () => {
    if (!apiKeyInput.trim() || !instantBuildResult?.botId) return;
    
    setCreatingWidget(true);
    setWidgetError(null);
    
    try {
      // Save the new API key
      setCredentials({ pypestreamApiKey: apiKeyInput.trim() });
      
      const widgetResult = await createChannelWithWidget(
        instantBuildResult.botId,
        'sandbox',
        apiKeyInput.trim(),
        {
          targetCompany: extractedDetails?.targetCompany || projectConfig.brandAssets?.name || extractedDetails?.projectName,
          brandAssets: projectConfig.brandAssets ? {
            name: projectConfig.brandAssets.name,
            domain: projectConfig.brandAssets.domain,
            primaryColor: projectConfig.brandAssets.primaryColor,
            secondaryColor: projectConfig.brandAssets.secondaryColor,
            logoUrl: projectConfig.brandAssets.logoUrl || (projectConfig.brandAssets as any).logo,
            brandMomentUrl: projectConfig.brandAssets.brandMomentUrl,
            images: projectConfig.brandAssets.images,
            colors: projectConfig.brandAssets.colors,
            fonts: projectConfig.brandAssets.fonts,
          } : undefined,
        }
      );
      
      if (widgetResult.success && widgetResult.widgetUrl) {
        // Update the result with the new widget URL
        setInstantBuildResult({
          ...instantBuildResult,
          widgetUrl: widgetResult.widgetUrl,
          widgetId: widgetResult.widgetId,
        });
        setShowApiKeyModal(false);
        setApiKeyInput('');
        // Open the widget
        window.open(widgetResult.widgetUrl, '_blank');
      } else {
        setWidgetError(widgetResult.error || 'Failed to create widget');
      }
    } catch (e: any) {
      console.error('Widget creation failed:', e);
      setWidgetError(e.message || 'Failed to create widget');
    } finally {
      setCreatingWidget(false);
    }
  };
  
  const handleViewSheets = async () => {
    // Case 1: Already have a sheetsUrl - just open it
    if (instantBuildResult?.sheetsUrl) {
      window.open(instantBuildResult.sheetsUrl, '_blank');
      return;
    }
    
    // Case 2: Not connected to Google Sheets - initiate OAuth flow
    if (!isSheetsConnected) {
      setExportingToSheets(true);
      setSheetsExportError(null);
      
      try {
        const connected = await connectIntegration('google-sheets');
        
        if (!connected) {
          setSheetsExportError('Failed to connect to Google Sheets');
          setExportingToSheets(false);
          return;
        }
        
        // After connecting, export the CSV
        await exportCSVToSheets();
      } catch (e: any) {
        console.error('Sheets connection error:', e);
        setSheetsExportError(e.message || 'Failed to connect');
        setExportingToSheets(false);
      }
      return;
    }
    
    // Case 3: Connected but no sheetsUrl yet - export now
    await exportCSVToSheets();
  };
  
  const exportCSVToSheets = async () => {
    if (!instantBuildResult?.csv) {
      setSheetsExportError('No CSV content available to export');
      setExportingToSheets(false);
      return;
    }
    
    setExportingToSheets(true);
    setSheetsExportError(null);
    
    try {
      const userId = user.email || `user_${Date.now()}`;
      const fileName = `${extractedDetails?.clientName || 'Solution'}_${extractedDetails?.projectName || 'Export'}`;
      
      const result = await exportToGoogleSheets(
        instantBuildResult.csv,
        fileName,
        userId
      );
      
      if (result.success && result.spreadsheetUrl) {
        // Update the result with the new sheetsUrl
        setInstantBuildResult({
          ...instantBuildResult,
          sheetsUrl: result.spreadsheetUrl,
          spreadsheetId: result.spreadsheetId,
        });
        
        // Also update in Supabase if we have an active solution
        if (activeSolutionId) {
          updateSavedSolution(activeSolutionId, {
            spreadsheetUrl: result.spreadsheetUrl,
          });
        }
        
        // Open the new spreadsheet
        window.open(result.spreadsheetUrl, '_blank');
      } else {
        setSheetsExportError(result.error || 'Failed to export to Google Sheets');
      }
    } catch (e: any) {
      console.error('Sheets export error:', e);
      setSheetsExportError(e.message || 'Export failed');
    } finally {
      setExportingToSheets(false);
    }
  };
  
  const handleViewWidget = () => {
    if (instantBuildResult?.widgetUrl) {
      window.open(instantBuildResult.widgetUrl, '_blank');
    }
  };
  
  const handleEditFlow = () => {
    setInstantStep('editor');
  };
  
  const handleCreateAnother = () => {
    startNewSolution();
    setInstantStep('create');
    setStep('welcome');
  };
  
  // Redeploy using cached CSV - no regeneration needed
  const handleRedeploy = async () => {
    if (!instantBuildResult?.csv || !instantBuildResult.botId) {
      setRedeployError('No cached solution found. Please regenerate.');
      return;
    }
    
    // Get the API token
    const token = credentials.pypestreamApiKey;
    if (!token) {
      setShowApiKeyModal(true);
      return;
    }
    
    setRedeploying(true);
    setRedeployError(null);
    setRedeploySuccess(false);
    
    try {
      // Use the cached CSV and scripts
      const deployResult = await oneClickDeploy(
        instantBuildResult.csv,
        instantBuildResult.botId,
        'sandbox',
        token,
        instantBuildResult.scripts
      );
      
      if (deployResult.success) {
        // Update the version ID if it changed
        if (deployResult.versionId && deployResult.versionId !== instantBuildResult.versionId) {
          setInstantBuildResult({
            ...instantBuildResult,
            versionId: deployResult.versionId,
          });
        }
        
        // Check if we need to create a new widget
        // Stream-based URLs (stream_xxx) don't work - need a real widget
        const hasValidWidget = instantBuildResult.widgetUrl && 
          !instantBuildResult.widgetUrl.includes('stream_');
        
        if (!hasValidWidget) {
          console.log('[Redeploy] No valid widget, creating one...');
          try {
            const widgetResult = await createChannelWithWidget(
              instantBuildResult.botId,
              'sandbox',
              token,
              {
                widgetName: `${extractedDetails?.projectName || 'Solution'} Widget`,
                brandAssets: projectConfig.brandAssets || undefined,
                targetCompany: extractedDetails?.targetCompany,
              }
            );
            
            if (widgetResult.success && widgetResult.widgetUrl) {
              setInstantBuildResult({
                ...instantBuildResult,
                widgetUrl: widgetResult.widgetUrl,
                widgetId: widgetResult.widgetId,
                versionId: deployResult.versionId,
              });
              
              // Also update in Supabase
              if (activeSolutionId) {
                updateSavedSolution(activeSolutionId, {
                  widgetUrl: widgetResult.widgetUrl,
                  botUrl: widgetResult.widgetUrl,
                });
              }
              console.log('[Redeploy] Widget created:', widgetResult.widgetUrl);
            } else {
              console.warn('[Redeploy] Widget creation failed:', widgetResult.error);
            }
          } catch (widgetErr: any) {
            console.warn('[Redeploy] Widget creation error:', widgetErr.message);
          }
        }
        
        setRedeploySuccess(true);
        setTimeout(() => setRedeploySuccess(false), 3000);
      } else {
        setRedeployError(deployResult.message || 'Redeploy failed');
      }
    } catch (e: any) {
      console.error('Redeploy failed:', e);
      setRedeployError(e.message || 'Redeploy failed');
    } finally {
      setRedeploying(false);
    }
  };
  
  // Refresh Widget - just recreate the widget with new CSS, no bot deploy
  const handleRefreshWidget = async () => {
    if (!instantBuildResult?.botId) {
      setRefreshWidgetError('No bot ID found. Please regenerate.');
      return;
    }
    
    const token = credentials.pypestreamApiKey;
    if (!token) {
      setShowApiKeyModal(true);
      return;
    }
    
    setRefreshingWidget(true);
    setRefreshWidgetError(null);
    setRefreshWidgetSuccess(false);
    
    try {
      console.log('[RefreshWidget] Creating new widget for', instantBuildResult.botId);
      
      const widgetResult = await createChannelWithWidget(
        instantBuildResult.botId,
        'sandbox',
        token,
        {
          widgetName: `${extractedDetails?.projectName || 'Solution'} Widget`,
          brandAssets: projectConfig.brandAssets || undefined,
          targetCompany: extractedDetails?.targetCompany,
        }
      );
      
      if (widgetResult.success && widgetResult.widgetUrl) {
        // Update local state with new widget URL
        setInstantBuildResult({
          ...instantBuildResult,
          widgetUrl: widgetResult.widgetUrl,
          widgetId: widgetResult.widgetId,
        });
        
        // Also update in Supabase
        if (activeSolutionId) {
          updateSavedSolution(activeSolutionId, {
            widgetUrl: widgetResult.widgetUrl,
            botUrl: widgetResult.widgetUrl,
          });
        }
        
        setRefreshWidgetSuccess(true);
        console.log('[RefreshWidget] New widget created:', widgetResult.widgetUrl);
        
        // Open the new widget
        window.open(widgetResult.widgetUrl, '_blank');
        
        setTimeout(() => setRefreshWidgetSuccess(false), 3000);
      } else {
        // Check if it's an auth error - show API key modal
        const errorMsg = widgetResult.error || 'Widget creation failed';
        const isAuthError = widgetResult.authError || 
          errorMsg.includes('401') || 
          errorMsg.includes('Authorization') || 
          errorMsg.includes('token') || 
          errorMsg.includes('expired');
        
        if (isAuthError) {
          console.log('[RefreshWidget] Auth error detected, showing API key modal');
          setCredentials({ pypestreamApiKey: undefined });
          setShowApiKeyModal(true);
        } else {
          setRefreshWidgetError(errorMsg);
        }
      }
    } catch (e: any) {
      console.error('Widget refresh failed:', e);
      const errorMsg = e.message || 'Widget refresh failed';
      // Check if it's an auth error
      if (errorMsg.includes('401') || errorMsg.includes('Authorization') || errorMsg.includes('token') || errorMsg.includes('expired')) {
        console.log('[RefreshWidget] Auth error in catch, showing API key modal');
        setCredentials({ pypestreamApiKey: undefined });
        setShowApiKeyModal(true);
      } else {
        setRefreshWidgetError(errorMsg);
      }
    } finally {
      setRefreshingWidget(false);
    }
  };
  
  const copyToClipboard = async (text: string, type: 'widget' | 'sheets') => {
    await navigator.clipboard.writeText(text);
    if (type === 'widget') {
      setCopiedWidget(true);
      setTimeout(() => setCopiedWidget(false), 2000);
    } else {
      setCopiedSheets(true);
      setTimeout(() => setCopiedSheets(false), 2000);
    }
  };
  
  // AI UX Review - Intelligent flow analysis
  const handleAiReview = async () => {
    if (!instantBuildResult?.csv) {
      setAiReviewResult({ success: false, error: 'No CSV content available' });
      return;
    }
    
    setAiReviewing(true);
    setAiReviewResult(null);
    setAiReviewPhase('analyzing');
    
    try {
      // Step 1: Call UX Review API for intelligent analysis
      const reviewResponse = await fetch('/api/ux-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: instantBuildResult.csv,
          projectConfig: {
            clientName: extractedDetails?.clientName,
            projectName: extractedDetails?.projectName,
            projectType: extractedDetails?.projectType,
            targetCompany: extractedDetails?.targetCompany,
          },
        }),
      });
      
      if (!reviewResponse.ok) {
        const error = await reviewResponse.json().catch(() => ({ error: 'Review failed' }));
        throw new Error(error.error || 'UX review failed');
      }
      
      const reviewData = await reviewResponse.json();
      
      if (!reviewData.success || !reviewData.analysis) {
        throw new Error(reviewData.error || 'Analysis returned no data');
      }
      
      const analysis = reviewData.analysis;
      
      // Step 2: If there are improvements, apply them
      const hasImprovements = (analysis.improvements && analysis.improvements.length > 0) ||
        (analysis.rewrittenMessages && Object.keys(analysis.rewrittenMessages).length > 0) ||
        (analysis.rewrittenButtons && Object.keys(analysis.rewrittenButtons).length > 0);
        
      if (hasImprovements) {
        setAiReviewPhase('applying');
        
        const applyResponse = await fetch('/api/ux-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csv: instantBuildResult.csv,
            improvements: analysis.improvements || [],
            rewrittenMessages: analysis.rewrittenMessages || {},
            rewrittenButtons: analysis.rewrittenButtons || {},
            projectConfig: {
              clientName: extractedDetails?.clientName,
              projectName: extractedDetails?.projectName,
            },
          }),
        });
        
        if (applyResponse.ok) {
          const applyData = await applyResponse.json();
          
          if (applyData.success && applyData.csv) {
            // Sanitize the improved CSV
            const improvedCSV = sanitizeCSVForDeploy(applyData.csv);
            
            // Update the solution with improved CSV
            setInstantBuildResult({
              ...instantBuildResult,
              csv: improvedCSV,
            });
            
            // Save to Supabase
            if (activeSolutionId) {
              updateSavedSolution(activeSolutionId, {
                csvContent: improvedCSV,
              });
            }
            
            setAiReviewResult({
              success: true,
              analysis,
              appliedCount: applyData.appliedCount || analysis.improvements.length,
            });
          } else {
            // Improvements couldn't be applied, but analysis is still valid
            setAiReviewResult({
              success: true,
              analysis,
              error: 'Could not auto-apply improvements',
            });
          }
        } else {
          // API call failed, but we still have the analysis
          setAiReviewResult({
            success: true,
            analysis,
            error: 'Could not auto-apply improvements',
          });
        }
      } else {
        // No improvements needed - flow is good!
        setAiReviewResult({
          success: true,
          analysis,
        });
      }
      
      setShowReviewDetails(true);
      
    } catch (e: any) {
      console.error('AI UX Review failed:', e);
      setAiReviewResult({
        success: false,
        error: e.message || 'AI review failed',
      });
    } finally {
      setAiReviewing(false);
      setAiReviewPhase(null);
    }
  };
  
  if (!instantBuildResult || !instantBuildResult.success) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-[#6a6a75]">No results available.</p>
          <button
            onClick={handleCreateAnother}
            className="mt-4 px-4 py-2 text-sm text-[#a5b4fc] hover:text-white"
          >
            Start Over
          </button>
        </div>
      </div>
    );
  }
  
  const projectName = extractedDetails?.projectName || 'Solution';
  const targetCompany = extractedDetails?.targetCompany || projectConfig.targetCompany;
  const brandColor = projectConfig.brandAssets?.primaryColor || '#6366f1';
  
  return (
    <div className="max-w-2xl mx-auto py-12 px-4 animate-fade-in">
      {/* Success Header */}
      <div className="text-center mb-10">
        <div className="w-20 h-20 rounded-full bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10 text-[#22c55e]" />
        </div>
        
        <h1 className="text-2xl font-semibold text-white mb-2">
          Your solution is ready!
        </h1>
        
        <div className="flex items-center justify-center gap-2 text-[#8585a3]">
          {targetCompany && (
            <>
              <span>{targetCompany}</span>
              <span className="text-[#4a4a55]">•</span>
            </>
          )}
          <span>{projectName}</span>
        </div>
        
        <p className="text-sm text-[#6a6a75] mt-2">
          {instantBuildResult.nodeCount} nodes • Deployed to sandbox
        </p>
      </div>
      
      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* View in Google Sheets */}
        <div
          onClick={exportingToSheets ? undefined : handleViewSheets}
          role="button"
          tabIndex={exportingToSheets ? -1 : 0}
          onKeyDown={(e) => e.key === 'Enter' && !exportingToSheets && handleViewSheets()}
          className={`group relative bg-[#1a1a1f] border rounded-xl p-6 text-left transition-all cursor-pointer ${
            exportingToSheets 
              ? 'border-[#22c55e]/30 cursor-wait' 
              : sheetsExportError
              ? 'border-red-500/30'
              : instantBuildResult.sheetsUrl 
              ? 'border-white/10 hover:border-[#22c55e]/50' 
              : !isSheetsConnected
              ? 'border-amber-500/30 hover:border-amber-500/50'
              : 'border-white/10 hover:border-[#22c55e]/50'
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
            !isSheetsConnected && !instantBuildResult.sheetsUrl
              ? 'bg-amber-500/10'
              : 'bg-[#22c55e]/10'
          }`}>
            {exportingToSheets ? (
              <Loader2 className="w-6 h-6 text-[#22c55e] animate-spin" />
            ) : !isSheetsConnected && !instantBuildResult.sheetsUrl ? (
              <Link2 className="w-6 h-6 text-amber-400" />
            ) : (
              <FileSpreadsheet className="w-6 h-6 text-[#22c55e]" />
            )}
          </div>
          <h3 className="text-white font-medium mb-1">
            {exportingToSheets 
              ? 'Exporting...' 
              : instantBuildResult.sheetsUrl 
              ? 'View in Google Sheets'
              : !isSheetsConnected
              ? 'Connect Google Sheets'
              : 'Export to Sheets'}
          </h3>
          <p className="text-xs text-[#6a6a75]">
            {exportingToSheets
              ? 'Creating spreadsheet...'
              : sheetsExportError
              ? sheetsExportError
              : instantBuildResult.sheetsUrl 
              ? 'Open spreadsheet' 
              : !isSheetsConnected
              ? 'Sign in to export'
              : 'Export CSV now'}
          </p>
          <ExternalLink className="absolute top-4 right-4 w-4 h-4 text-[#4a4a55] group-hover:text-[#6a6a75] transition-colors" />
          
          {instantBuildResult.sheetsUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(instantBuildResult.sheetsUrl!, 'sheets');
              }}
              className="absolute bottom-4 right-4 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              title="Copy link"
            >
              {copiedSheets ? (
                <Check className="w-3.5 h-3.5 text-[#22c55e]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#4a4a55]" />
              )}
            </button>
          )}
        </div>
        
        {/* View Solution (Widget) */}
        <div
          onClick={instantBuildResult.widgetUrl ? handleViewWidget : () => setShowApiKeyModal(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && (instantBuildResult.widgetUrl ? handleViewWidget() : setShowApiKeyModal(true))}
          className={`group relative bg-[#1a1a1f] border border-white/10 rounded-xl p-6 text-left hover:border-[#6366f1]/50 transition-all cursor-pointer ${
            !instantBuildResult.widgetUrl ? 'border-amber-500/30' : ''
          }`}
        >
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
            style={{ backgroundColor: instantBuildResult.widgetUrl ? `${brandColor}20` : 'rgba(245, 158, 11, 0.1)' }}
          >
            {instantBuildResult.widgetUrl ? (
              <Rocket className="w-6 h-6" style={{ color: brandColor }} />
            ) : (
              <Key className="w-6 h-6 text-amber-400" />
            )}
          </div>
          <h3 className="text-white font-medium mb-1">
            {instantBuildResult.widgetUrl ? 'View Solution' : 'Create Widget'}
          </h3>
          <p className="text-xs text-[#6a6a75]">
            {instantBuildResult.widgetUrl ? 'Open live widget' : 'Requires API key'}
          </p>
          <ExternalLink className="absolute top-4 right-4 w-4 h-4 text-[#4a4a55] group-hover:text-[#6a6a75] transition-colors" />
          
          {instantBuildResult.widgetUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(instantBuildResult.widgetUrl!, 'widget');
              }}
              className="absolute bottom-4 right-4 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              title="Copy link"
            >
              {copiedWidget ? (
                <Check className="w-3.5 h-3.5 text-[#22c55e]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#4a4a55]" />
              )}
            </button>
          )}
        </div>
        
        {/* Edit Flow */}
        <div
          onClick={handleEditFlow}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleEditFlow()}
          className="group relative bg-[#1a1a1f] border border-white/10 rounded-xl p-6 text-left hover:border-[#6366f1]/50 transition-all cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-[#6366f1]/10 flex items-center justify-center mb-4">
            <PenSquare className="w-6 h-6 text-[#6366f1]" />
          </div>
          <h3 className="text-white font-medium mb-1">Edit Flow</h3>
          <p className="text-xs text-[#6a6a75]">
            Visual editor with sync
          </p>
        </div>
        
        {/* AI UX Review */}
        <div
          onClick={aiReviewing ? undefined : handleAiReview}
          role="button"
          tabIndex={aiReviewing ? -1 : 0}
          onKeyDown={(e) => e.key === 'Enter' && !aiReviewing && handleAiReview()}
          className={`group relative bg-[#1a1a1f] border rounded-xl p-6 text-left transition-all ${
            aiReviewing 
              ? 'border-[#f59e0b]/30 cursor-wait' 
              : aiReviewResult?.success === true
              ? 'border-[#22c55e]/30 hover:border-[#22c55e]/50 cursor-pointer'
              : aiReviewResult?.success === false
              ? 'border-red-500/30 hover:border-red-500/50 cursor-pointer'
              : 'border-white/10 hover:border-[#f59e0b]/50 cursor-pointer'
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
            aiReviewResult?.success === true
              ? 'bg-[#22c55e]/10'
              : aiReviewResult?.success === false
              ? 'bg-red-500/10'
              : 'bg-[#f59e0b]/10'
          }`}>
            {aiReviewing ? (
              <Loader2 className="w-6 h-6 text-[#f59e0b] animate-spin" />
            ) : aiReviewResult?.success === true ? (
              <Check className="w-6 h-6 text-[#22c55e]" />
            ) : aiReviewResult?.success === false ? (
              <AlertTriangle className="w-6 h-6 text-red-400" />
            ) : (
              <Sparkles className="w-6 h-6 text-[#f59e0b]" />
            )}
          </div>
          <h3 className="text-white font-medium mb-1">
            {aiReviewing 
              ? aiReviewPhase === 'applying' ? 'Applying fixes...' : 'Analyzing UX...'
              : aiReviewResult?.success === true
              ? 'UX Review Complete'
              : aiReviewResult?.success === false
              ? 'Review Failed'
              : 'AI UX Review'}
          </h3>
          <p className="text-xs text-[#6a6a75]">
            {aiReviewing
              ? aiReviewPhase === 'applying' ? 'Optimizing flow...' : 'Tracing user journeys...'
              : aiReviewResult?.success === true
              ? `Score: ${aiReviewResult.analysis?.overallScore || '?'}/10`
              : aiReviewResult?.success === false
              ? aiReviewResult.error || 'Click to retry'
              : 'Analyze & optimize flows'}
          </p>
          
          {/* Show score badge */}
          {aiReviewResult?.analysis?.overallScore && (
            <div className={`absolute top-4 right-4 px-2 py-0.5 text-xs rounded-full ${
              aiReviewResult.analysis.overallScore >= 8
                ? 'bg-[#22c55e]/20 text-[#22c55e]'
                : aiReviewResult.analysis.overallScore >= 5
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              {aiReviewResult.analysis.overallScore}/10
            </div>
          )}
          
          {/* Show improvements applied badge */}
          {aiReviewResult?.appliedCount && aiReviewResult.appliedCount > 0 && (
            <div className="absolute bottom-4 right-4 px-2 py-0.5 bg-[#22c55e]/20 text-[#22c55e] text-xs rounded-full">
              {aiReviewResult.appliedCount} improved
            </div>
          )}
        </div>
        
        {/* Live Edit */}
        <div
          onClick={() => {
            window.history.pushState({}, '', '/live-edit');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              window.history.pushState({}, '', '/live-edit');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          }}
          className="group relative bg-[#1a1a1f] border border-white/10 rounded-xl p-6 text-left hover:border-[#10b981]/50 transition-all cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-[#10b981]/10 flex items-center justify-center mb-4">
            <Wand2 className="w-6 h-6 text-[#10b981]" />
          </div>
          <h3 className="text-white font-medium mb-1">Live Edit</h3>
          <p className="text-xs text-[#6a6a75]">
            Chat-based editing
          </p>
        </div>
      </div>
      
      {/* AI UX Review Details Panel */}
      {showReviewDetails && aiReviewResult?.analysis && (
        <div className="bg-[#1a1a1f] border border-white/10 rounded-xl p-6 mb-8 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                (aiReviewResult.analysis.overallScore || 0) >= 8
                  ? 'bg-[#22c55e]/10'
                  : (aiReviewResult.analysis.overallScore || 0) >= 5
                  ? 'bg-amber-500/10'
                  : 'bg-red-500/10'
              }`}>
                <Sparkles className={`w-5 h-5 ${
                  (aiReviewResult.analysis.overallScore || 0) >= 8
                    ? 'text-[#22c55e]'
                    : (aiReviewResult.analysis.overallScore || 0) >= 5
                    ? 'text-amber-400'
                    : 'text-red-400'
                }`} />
              </div>
              <div>
                <h3 className="text-white font-medium">UX Analysis Results</h3>
                <p className="text-xs text-[#6a6a75]">
                  Score: {aiReviewResult.analysis.overallScore}/10
                  {aiReviewResult.appliedCount ? ` • ${aiReviewResult.appliedCount} improvements applied` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowReviewDetails(false)}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4 text-[#6a6a75]" />
            </button>
          </div>
          
          {/* Summary */}
          {aiReviewResult.analysis.summary && (
            <div className="mb-4 p-3 bg-[#0a0a0f] rounded-lg">
              <p className="text-sm text-[#a3a3bd]">{aiReviewResult.analysis.summary}</p>
            </div>
          )}
          
          {/* Critical Flaws - Most Important */}
          {aiReviewResult.analysis.criticalFlaws && aiReviewResult.analysis.criticalFlaws.length > 0 && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <h4 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Critical Issues Found
              </h4>
              <ul className="space-y-2">
                {aiReviewResult.analysis.criticalFlaws.map((flaw, idx) => (
                  <li key={idx} className="text-sm text-red-300 flex items-start gap-2">
                    <span className="text-red-500 mt-1">•</span>
                    <span>{flaw}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Rewritten Messages Preview */}
          {aiReviewResult.analysis.rewrittenMessages && Object.keys(aiReviewResult.analysis.rewrittenMessages).length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-[#8585a3] uppercase tracking-wider mb-2">
                Message Rewrites ({Object.keys(aiReviewResult.analysis.rewrittenMessages).length})
              </h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {Object.entries(aiReviewResult.analysis.rewrittenMessages).slice(0, 5).map(([nodeNum, newMessage]) => (
                  <div key={nodeNum} className="p-3 bg-[#22c55e]/5 border border-[#22c55e]/20 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-[#22c55e] font-medium">Node {nodeNum}</span>
                      <span className="text-xs text-[#22c55e]">→ Rewritten</span>
                    </div>
                    <p className="text-sm text-[#a3a3bd]">"{newMessage}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* User Journeys */}
          {aiReviewResult.analysis.journeys && aiReviewResult.analysis.journeys.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-[#8585a3] uppercase tracking-wider mb-2">User Journeys</h4>
              <div className="space-y-2">
                {aiReviewResult.analysis.journeys.slice(0, 3).map((journey, idx) => (
                  <div key={idx} className="p-3 bg-[#0a0a0f] rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">{journey.name}</span>
                      <span className="text-xs text-[#6a6a75]">
                        ({journey.nodes?.length || 0} nodes)
                      </span>
                    </div>
                    <p className="text-xs text-[#8585a3] mb-2">{journey.experience}</p>
                    {journey.issues && journey.issues.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {journey.issues.map((issue, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded">
                            {issue}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Issues Found */}
          {aiReviewResult.analysis.issues && aiReviewResult.analysis.issues.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-[#8585a3] uppercase tracking-wider mb-2">
                Issues Found ({aiReviewResult.analysis.issues.length})
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {aiReviewResult.analysis.issues.map((issue, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${
                    issue.severity === 'critical'
                      ? 'bg-red-500/5 border-red-500/20'
                      : issue.severity === 'major'
                      ? 'bg-amber-500/5 border-amber-500/20'
                      : 'bg-[#0a0a0f] border-white/5'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        issue.severity === 'critical'
                          ? 'bg-red-500/20 text-red-400'
                          : issue.severity === 'major'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-[#6366f1]/20 text-[#a5b4fc]'
                      }`}>
                        {issue.severity}
                      </span>
                      <span className="text-xs text-[#6a6a75]">Node {issue.nodeNum}</span>
                      <span className="text-xs text-[#4a4a55]">•</span>
                      <span className="text-xs text-[#6a6a75]">{issue.category}</span>
                    </div>
                    <p className="text-sm text-white mb-1">{issue.issue}</p>
                    <p className="text-xs text-[#22c55e]">Suggestion: {issue.suggestion}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Missing Elements */}
          {aiReviewResult.analysis.missingElements && aiReviewResult.analysis.missingElements.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-[#8585a3] uppercase tracking-wider mb-2">
                Recommended Additions
              </h4>
              <div className="flex flex-wrap gap-2">
                {aiReviewResult.analysis.missingElements.map((element, idx) => (
                  <span key={idx} className="text-xs px-2 py-1 bg-[#6366f1]/10 text-[#a5b4fc] rounded-lg">
                    {element}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Applied Improvements */}
          {aiReviewResult.appliedCount && aiReviewResult.appliedCount > 0 && (
            <div className="p-3 bg-[#22c55e]/10 border border-[#22c55e]/20 rounded-lg">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#22c55e]" />
                <span className="text-sm text-[#22c55e] font-medium">
                  {aiReviewResult.appliedCount} improvements automatically applied to your flow
                </span>
              </div>
            </div>
          )}
          
          {/* Run Again Button */}
          <div className="mt-4 pt-4 border-t border-white/5">
            <button
              onClick={handleAiReview}
              disabled={aiReviewing}
              className="flex items-center gap-2 px-4 py-2 text-sm text-[#a5b4fc] hover:text-white border border-[#6366f1]/30 hover:border-[#6366f1]/50 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              Run Review Again
            </button>
          </div>
        </div>
      )}
      
      {/* Bot ID Info */}
      <div className="bg-[#1a1a1f]/50 border border-white/5 rounded-lg p-4 mb-8">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#6a6a75]">Bot ID</span>
          <code className="text-[#a5b4fc] font-mono">{instantBuildResult.botId}</code>
        </div>
        {instantBuildResult.versionId && (
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-[#6a6a75]">Version</span>
            <code className="text-[#8585a3] font-mono text-xs">{instantBuildResult.versionId}</code>
          </div>
        )}
      </div>
      
      {/* Human Intervention Panel */}
      {instantBuildResult.needsHumanIntervention && (
        <div className="bg-[#1a1a1f] border border-amber-500/30 rounded-xl p-6 mb-8">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-white font-medium mb-1">Validation Issues Detected</h3>
              <p className="text-sm text-[#6a6a75]">
                The AI couldn't fix all validation errors after 5 attempts. Help improve future generations by providing fixes.
              </p>
            </div>
          </div>
          
          {!fixSubmitted ? (
            <>
              {/* Step 1: Copy Context */}
              <div className="bg-[#0a0a0f] rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[#8585a3] font-medium">Step 1: Copy error context</span>
                  <button
                    onClick={handleCopyContext}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs bg-[#6366f1]/10 text-[#a5b4fc] rounded-lg hover:bg-[#6366f1]/20 transition-colors"
                  >
                    {copiedContext ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="w-3.5 h-3.5" />
                        Copy to Clipboard
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-[#4a4a55]">
                  This includes the validation errors, current CSV content, and what was already tried.
                </p>
              </div>
              
              {/* Step 2: Get Help */}
              <div className="bg-[#0a0a0f] rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-[#8585a3]" />
                  <span className="text-sm text-[#8585a3] font-medium">Step 2: Paste into Claude/ChatGPT and ask for fix</span>
                </div>
                <p className="text-xs text-[#4a4a55]">
                  The AI will analyze the errors and provide a JSON fix response.
                </p>
              </div>
              
              {/* Step 3: Submit Fix */}
              <div className="bg-[#0a0a0f] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Send className="w-4 h-4 text-[#8585a3]" />
                  <span className="text-sm text-[#8585a3] font-medium">Step 3: Paste fix response here</span>
                </div>
                <textarea
                  value={fixInput}
                  onChange={(e) => setFixInput(e.target.value)}
                  placeholder='Paste the JSON fix response here...\n\n{\n  "fixes": [...],\n  "general_guidance": "..."\n}'
                  className="w-full h-32 px-3 py-2 bg-[#12121a] border border-white/10 rounded-lg text-sm text-white font-mono placeholder-[#4a4a55] focus:outline-none focus:border-[#6366f1] resize-none"
                />
                <button
                  onClick={handleSubmitFix}
                  disabled={!fixInput.trim() || submittingFix}
                  className="mt-3 flex items-center gap-2 px-4 py-2 bg-[#6366f1] text-white text-sm rounded-lg hover:bg-[#5558e3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submittingFix ? 'Submitting...' : 'Submit Fix to Learning System'}
                </button>
              </div>
            </>
          ) : (
            <div className="bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-lg p-4 text-center">
              <Check className="w-6 h-6 text-[#22c55e] mx-auto mb-2" />
              <p className="text-sm text-[#22c55e] font-medium">Fix submitted successfully!</p>
              <p className="text-xs text-[#6a6a75] mt-1">
                This knowledge will be used to improve future generations.
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Redeploy & Create Another */}
      <div className="flex items-center justify-center gap-4 flex-wrap">
        {/* Redeploy Button - uses cached CSV, no regeneration */}
        <button
          onClick={handleRedeploy}
          disabled={redeploying || !instantBuildResult.csv}
          className={`inline-flex items-center gap-2 px-6 py-3 text-sm border rounded-lg transition-all ${
            redeploySuccess 
              ? 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]'
              : redeployError
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'text-[#a5b4fc] hover:text-white border-[#6366f1]/30 hover:border-[#6366f1]/50 hover:bg-[#6366f1]/10'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {redeploying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Redeploying...
            </>
          ) : redeploySuccess ? (
            <>
              <Check className="w-4 h-4" />
              Redeployed!
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              Redeploy (No Regen)
            </>
          )}
        </button>
        
        {/* Refresh Widget Button - just recreate widget CSS, no deploy */}
        <button
          onClick={handleRefreshWidget}
          disabled={refreshingWidget || !instantBuildResult.botId}
          className={`inline-flex items-center gap-2 px-6 py-3 text-sm border rounded-lg transition-all ${
            refreshWidgetSuccess 
              ? 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]'
              : refreshWidgetError
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'text-[#f59e0b] hover:text-white border-[#f59e0b]/30 hover:border-[#f59e0b]/50 hover:bg-[#f59e0b]/10'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {refreshingWidget ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Refreshing UI...
            </>
          ) : refreshWidgetSuccess ? (
            <>
              <Check className="w-4 h-4" />
              Widget Updated!
            </>
          ) : (
            <>
              <Palette className="w-4 h-4" />
              Refresh Widget CSS
            </>
          )}
        </button>
        
        <button
          onClick={handleCreateAnother}
          className="inline-flex items-center gap-2 px-6 py-3 text-sm text-[#8585a3] hover:text-white border border-white/10 rounded-lg hover:border-white/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          Create Another Solution
        </button>
      </div>
      
      {/* Error Messages */}
      {(redeployError || refreshWidgetError) && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
          <p className="text-sm text-red-400">{redeployError || refreshWidgetError}</p>
        </div>
      )}
      
      {/* API Key Modal for Widget Creation */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#12121a] border border-white/[0.08] rounded-2xl p-8 max-w-md w-full animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 flex items-center justify-center">
                  <Key className="w-5 h-5 text-[#6366f1]" />
                </div>
                <h3 className="text-lg font-semibold text-white">Create Widget</h3>
              </div>
              <button
                onClick={() => {
                  setShowApiKeyModal(false);
                  setWidgetError(null);
                  setApiKeyInput('');
                }}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5 text-[#6a6a75]" />
              </button>
            </div>
            
            <p className="text-sm text-[#6a6a75] mb-6">
              Widget creation requires an API key with GES permissions. Enter a Pypestream API key to create a preview widget.
            </p>
            
            {widgetError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-400">{widgetError}</p>
              </div>
            )}
            
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Enter Pypestream API key"
              className="w-full px-4 py-3 bg-[#0a0a0f] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#6366f1] transition-colors mb-4"
              onKeyDown={(e) => e.key === 'Enter' && !creatingWidget && handleCreateWidget()}
            />
            
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowApiKeyModal(false);
                  setWidgetError(null);
                  setApiKeyInput('');
                }}
                className="px-4 py-2.5 text-sm text-[#8585a3] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWidget}
                disabled={!apiKeyInput.trim() || creatingWidget}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#6366f1] text-white text-sm rounded-xl hover:bg-[#5558e3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {creatingWidget ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    Create Widget
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
