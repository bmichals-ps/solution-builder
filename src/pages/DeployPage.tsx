import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Card, CardHeader } from '../components/Card';
import { Input } from '../components/Input';
import { 
  oneClickDeploy, 
  generateBotId,
  validateBotId
} from '../services/botmanager';
import { 
  preDeployValidation, 
  sanitizeCSVForDeploy,
  structuralPreValidation,
  validateCSVStructure, 
  detectRequiredScripts,
  removeScriptFromSolution,
  type PreDeployValidation,
  type ScriptDetectionResult
} from '../services/generation';
import { 
  ArrowLeft,
  Rocket,
  CheckCircle2,
  ExternalLink,
  Copy,
  RotateCcw,
  Server,
  Globe,
  AlertTriangle,
  PartyPopper,
  Key,
  Check,
  Edit2,
  Wrench,
  Shield,
  FileCode,
  Upload,
  Loader2,
  Trash2,
  Plus,
  Play,
  Building2,
  Palette,
  RefreshCw,
  Type,
  Image
} from 'lucide-react';

type Environment = 'sandbox' | 'production';
type DeployStatus = 'idle' | 'deploying' | 'success' | 'error';

export function DeployPage() {
  const { 
    projectConfig,
    setProjectConfig,
    credentials,
    setCredentials,
    solution,
    setSolution,
    reset,
    prevStep,
    activeSolutionId,
    updateSavedSolution,
    restoreSolutionFromSaved,
    solutionsLoaded,
    fetchSavedSolutions,
    savedSolutions,
    setActiveSolution,
  } = useStore();
  
  // Restore solution from Supabase if needed (after page reload)
  useEffect(() => {
    // If solutions haven't been loaded yet, fetch them first
    if (!solutionsLoaded) {
      fetchSavedSolutions();
      return;
    }
    
    // If no active solution ID but we have solutions, select the most recent one
    if (!activeSolutionId && savedSolutions.length > 0 && !solution?.csvContent) {
      const sortedSolutions = [...savedSolutions].sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      const mostRecent = sortedSolutions[0];
      console.log('[Deploy] No active solution, auto-selecting most recent:', mostRecent.name);
      setActiveSolution(mostRecent.id);
      return;
    }
    
    // If we have an active solution ID but no solution data, try to restore from Supabase
    if (activeSolutionId && !solution?.csvContent) {
      console.log('[Deploy] Solution missing, restoring from Supabase...');
      restoreSolutionFromSaved();
    }
  }, [activeSolutionId, solution, solutionsLoaded, savedSolutions, restoreSolutionFromSaved, fetchSavedSolutions, setActiveSolution]);

  const [selectedEnv, setSelectedEnv] = useState<Environment>('sandbox');
  const [deployStatus, setDeployStatus] = useState<DeployStatus>('idle');
  const [deployProgress, setDeployProgress] = useState<string>('');
  const [deployResult, setDeployResult] = useState<{
    versionId?: string;
    previewUrl?: string;
    widgetId?: string;
    channelNote?: string;
    consoleUrl?: string;
    error?: string;
    errors?: string[];
    authError?: boolean;
  }>({});
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  
  // Pre-deploy validation state
  const [preValidation, setPreValidation] = useState<PreDeployValidation | null>(null);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  
  // Script detection state
  const [scriptDetection, setScriptDetection] = useState<ScriptDetectionResult | null>(null);
  const [isUploadingScripts, setIsUploadingScripts] = useState(false);
  const [uploadedScripts, setUploadedScripts] = useState<Set<string>>(new Set());
  
  // Deployment readiness state
  const [configUploaded, setConfigUploaded] = useState(false);
  const [isUploadingConfig, setIsUploadingConfig] = useState(false);
  const [channelExists, setChannelExists] = useState(false);
  const [isCheckingChannel, setIsCheckingChannel] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  
  
  // Bot ID state
  const defaultBotId = generateBotId(
    projectConfig.clientName || 'Client',
    projectConfig.projectName || 'Bot'
  );
  // Use saved customBotId from solution if available
  const [customBotId, setCustomBotId] = useState(solution?.customBotId || defaultBotId);
  const [isEditingBotId, setIsEditingBotId] = useState(false);
  const [botIdError, setBotIdError] = useState<string | null>(null);
  
  // Target company / brand state
  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [editedCompanyName, setEditedCompanyName] = useState(projectConfig.targetCompany || '');
  const [isFetchingBrand, setIsFetchingBrand] = useState(false);

  // Check for env-based API key on mount
  useEffect(() => {
    const envApiKey = import.meta.env.VITE_PYPESTREAM_API_KEY;
    if (envApiKey && !credentials.pypestreamApiKey) {
      setCredentials({ pypestreamApiKey: envApiKey });
    }
  }, []);
  
  // If solution was already deployed, show previous deployment info
  useEffect(() => {
    if (solution?.botUrl && solution?.deployedEnvironment && deployStatus === 'idle') {
      setDeployResult({
        previewUrl: solution.botUrl,
        versionId: solution.deployedVersionId,
      });
      setSelectedEnv(solution.deployedEnvironment);
    }
  }, [solution?.botUrl, solution?.deployedEnvironment]);
  
  // Update default bot ID when project config changes (but respect saved customBotId)
  useEffect(() => {
    // If solution has a saved customBotId, use that
    if (solution?.customBotId) {
      setCustomBotId(solution.customBotId);
      return;
    }
    
    // Otherwise generate from project config
    const newDefaultId = generateBotId(
      projectConfig.clientName || 'Client',
      projectConfig.projectName || 'Bot'
    );
    if (customBotId === defaultBotId || !customBotId) {
      setCustomBotId(newDefaultId);
    }
  }, [projectConfig.clientName, projectConfig.projectName, solution?.customBotId]);

  // Detect required scripts when solution changes
  useEffect(() => {
    if (solution?.csvContent) {
      const detection = detectRequiredScripts(solution.csvContent);
      setScriptDetection(detection);
      console.log('[Deploy] Script detection:', detection);
    }
  }, [solution?.csvContent]);

  const hasApiKey = !!credentials.pypestreamApiKey;
  const botId = customBotId || defaultBotId;
  
  // Check if there are scripts that need to be uploaded
  const hasMissingScripts = scriptDetection && scriptDetection.missingScripts.length > 0;

  // Helper to detect auth errors in error messages
  const isAuthError = (error: string | undefined): boolean => {
    if (!error) return false;
    const authKeywords = ['token', 'api key', 'apikey', 'unauthorized', 'authentication', 'expired', 'invalid', 'autherror'];
    const lowerError = error.toLowerCase();
    return authKeywords.some(keyword => lowerError.includes(keyword));
  };
  
  // Check if current deploy result has an auth error
  const hasAuthError = deployResult.authError || isAuthError(deployResult.error) || deployResult.errors?.some(e => isAuthError(e));

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      setCredentials({ pypestreamApiKey: apiKeyInput.trim() });
      setApiKeyInput('');
    }
  };
  
  // Validate and save bot ID
  const handleBotIdChange = (value: string) => {
    setCustomBotId(value);
    const validation = validateBotId(value);
    setBotIdError(validation.valid ? null : validation.error || null);
  };
  
  const handleBotIdSave = async () => {
    const validation = validateBotId(customBotId);
    if (validation.valid) {
      setIsEditingBotId(false);
      setBotIdError(null);
      
      // Save customBotId to solution (persists to localStorage via Zustand)
      if (solution) {
        setSolution({
          ...solution,
          customBotId: customBotId,
        });
      }
      
      // Also save to Supabase
      if (activeSolutionId) {
        try {
          await updateSavedSolution(activeSolutionId, {
            // Parse bot ID back to client/project names if it changed
            clientName: customBotId.split('.')[0] || projectConfig.clientName,
          });
        } catch (e) {
          console.error('Failed to save Bot ID:', e);
        }
      }
    } else {
      setBotIdError(validation.error || 'Invalid Bot ID');
    }
  };
  
  // Handle saving target company and re-fetching brand assets
  const handleSaveCompany = async () => {
    if (!editedCompanyName.trim()) {
      setIsEditingCompany(false);
      return;
    }
    
    setIsFetchingBrand(true);
    
    try {
      // Fetch brand assets for the new company name
      const response = await fetch('/api/brandfetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: editedCompanyName.trim() })
      });
      
      const data = await response.json();
      
      if (data.success && data.brand) {
        // Update project config with new company and brand assets
        setProjectConfig({
          targetCompany: editedCompanyName.trim(),
          brandAssets: data.brand,
        });
        console.log('[Deploy] Brand updated:', data.brand.name);
      } else {
        // Just update the company name without brand assets
        setProjectConfig({
          targetCompany: editedCompanyName.trim(),
          brandAssets: undefined,
        });
        console.log('[Deploy] No brand found, cleared brand assets');
      }
    } catch (error) {
      console.error('[Deploy] Brand fetch error:', error);
      // Still update the company name
      setProjectConfig({
        targetCompany: editedCompanyName.trim(),
      });
    }
    
    setIsFetchingBrand(false);
    setIsEditingCompany(false);
  };

  // Run pre-deploy validation
  const runPreDeployValidation = () => {
    if (!solution?.csvContent) return;
    const result = preDeployValidation(solution.csvContent, false);
    setPreValidation(result);
    return result;
  };
  
  // Auto-fix pre-deploy issues
  const handleAutoFix = async () => {
    if (!solution?.csvContent) return;
    
    setIsAutoFixing(true);
    const result = preDeployValidation(solution.csvContent, true);
    
    if (result.fixedCsv) {
      // Update solution with fixed CSV
      setSolution({
        ...solution,
        csvContent: result.fixedCsv
      });
      
      // Save to Supabase
      if (activeSolutionId) {
        await updateSavedSolution(activeSolutionId, {
          csvContent: result.fixedCsv
        });
      }
      
      // Re-run validation to confirm fix
      setPreValidation(preDeployValidation(result.fixedCsv, false));
    }
    
    setIsAutoFixing(false);
  };

  // Upload a script file to Bot Manager
  const handleUploadScript = async (scriptName: string, file: File) => {
    if (!hasApiKey) return;
    
    setIsUploadingScripts(true);
    
    try {
      const content = await file.text();
      const token = credentials.pypestreamApiKey!;
      
      // Upload script via API
      const response = await fetch('/api/botmanager/upload-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId,
          scriptName,
          scriptContent: content,
          token,
          environment: selectedEnv,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setUploadedScripts(prev => new Set([...prev, scriptName]));
        console.log(`[Deploy] Uploaded script: ${scriptName}`);
      } else {
        console.error(`[Deploy] Failed to upload script: ${result.error}`);
        setDeployResult({
          error: `Failed to upload ${scriptName}: ${result.error}`,
        });
      }
    } catch (error: any) {
      console.error(`[Deploy] Script upload error:`, error);
      setDeployResult({
        error: `Failed to upload ${scriptName}: ${error.message}`,
      });
    }
    
    setIsUploadingScripts(false);
  };

  // Handle file input for script upload
  const handleScriptFileSelect = (scriptName: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUploadScript(scriptName, file);
    }
  };

  // Remove a script from the solution (replace with mock)
  const handleRemoveScript = async (scriptName: string) => {
    if (!solution?.csvContent) return;
    
    const result = removeScriptFromSolution(solution.csvContent, scriptName);
    
    if (result.success) {
      // Update solution with modified CSV
      const updatedSolution = {
        ...solution,
        csvContent: result.csv,
      };
      setSolution(updatedSolution);
      
      // Re-detect scripts to update the list
      const newDetection = detectRequiredScripts(result.csv);
      setScriptDetection(newDetection);
      
      // Save to Supabase
      if (activeSolutionId) {
        await updateSavedSolution(activeSolutionId, {
          csvContent: result.csv,
        });
      }
      
      console.log(`[Deploy] Removed script ${scriptName} from nodes: ${result.nodesModified.join(', ')}`);
    } else {
      console.warn(`[Deploy] No nodes found using script: ${scriptName}`);
    }
  };

  // Upload app.py config file
  const handleUploadConfig = async (file: File) => {
    if (!hasApiKey) return;
    
    setIsUploadingConfig(true);
    
    try {
      const content = await file.text();
      const token = credentials.pypestreamApiKey!;
      
      const response = await fetch('/api/botmanager/upload-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId,
          configContent: content,
          token,
          environment: selectedEnv,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setConfigUploaded(true);
        console.log(`[Deploy] Uploaded config: app.py`);
      } else {
        console.error(`[Deploy] Failed to upload config: ${result.error}`);
        setDeployResult({
          error: `Failed to upload config: ${result.error}`,
        });
      }
    } catch (error: any) {
      console.error(`[Deploy] Config upload error:`, error);
      setDeployResult({
        error: `Failed to upload config: ${error.message}`,
      });
    }
    
    setIsUploadingConfig(false);
  };

  // Generate a default app.py config with Pypestream's shared OpenAI key
  const generateDefaultConfig = () => {
    // Pypestream's shared OpenAI API key (from environment variable)
    const pypestreamOpenAIKey = import.meta.env.VITE_PYPESTREAM_OPENAI_KEY || '';
    
    const config = `import os

NAME = '${botId}'

BOTS = []

CSV_BOTS = ['${botId}']

PATH = os.path.dirname(__file__)

PARAMS = {
    "sandbox": {
        # OpenAI API credentials (for GenAI fallback and AI features)
        "openai_api_key": "${pypestreamOpenAIKey}",
        
        # Sentry alerting
        "sentry_dsn": "https://62ff156d79c7b9241720b513af77e06f@o4509032988344320.ingest.us.sentry.io/4509159116046336",
    },
    "live": {
        # OpenAI API credentials (for GenAI fallback and AI features)
        "openai_api_key": "${pypestreamOpenAIKey}",
        
        # Sentry alerting
        "sentry_dsn": "https://62ff156d79c7b9241720b513af77e06f@o4509032988344320.ingest.us.sentry.io/4509159116046336",
    }
}
`;
    return config;
  };

  // Download default config template
  const handleDownloadConfigTemplate = () => {
    const config = generateDefaultConfig();
    const blob = new Blob([config], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'app.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Check if channel exists for this bot
  const handleCheckChannel = async () => {
    if (!hasApiKey) return;
    
    setIsCheckingChannel(true);
    
    try {
      const token = credentials.pypestreamApiKey!;
      
      const response = await fetch('/api/botmanager/check-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId,
          token,
          environment: selectedEnv,
        }),
      });
      
      const result = await response.json();
      setChannelExists(result.exists);
      
      if (!result.exists) {
        console.log(`[Deploy] No channel found for ${botId}`);
      }
    } catch (error) {
      console.error(`[Deploy] Channel check error:`, error);
      setChannelExists(false);
    }
    
    setIsCheckingChannel(false);
  };
  
  // Create a channel for the deployed bot
  const handleCreateChannel = async () => {
    if (!hasApiKey || !deployResult.versionId) return;
    
    setIsCreatingChannel(true);
    setChannelError(null);
    
    try {
      const token = credentials.pypestreamApiKey!;
      
      console.log('[Deploy] Creating channel for', botId, 'in', selectedEnv);
      console.log('[Deploy] Brand assets being sent:', {
        hasAssets: !!projectConfig.brandAssets,
        logoUrl: projectConfig.brandAssets?.logoUrl || 'none',
        colorCount: projectConfig.brandAssets?.colors?.length || 0,
        primaryColor: projectConfig.brandAssets?.primaryColor,
        targetCompany: projectConfig.targetCompany,
      });
      
      const response = await fetch('/api/botmanager/create-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId,
          versionId: deployResult.versionId,
          token,
          environment: selectedEnv,
          brandAssets: projectConfig.brandAssets,  // Pass brand colors for widget styling
          targetCompany: projectConfig.targetCompany,  // Pass company name for widget title
        }),
      });
      
      const result = await response.json();
      console.log('[Deploy] Create channel result:', result);
      
      if (result.success) {
        // Update deploy result with preview URL and console URL
        setDeployResult(prev => ({
          ...prev,
          previewUrl: result.previewUrl || prev.previewUrl,
          channelNote: result.message,
          consoleUrl: result.consoleUrl,
        }));
        
        setChannelExists(true);
        
        // Save the widgetUrl to the saved solution for "View Channel Design" button
        if (result.previewUrl && activeSolutionId) {
          updateSavedSolution(activeSolutionId, {
            widgetUrl: result.previewUrl,
            botUrl: result.previewUrl,  // Also update botUrl if not set
          });
        }
        
        // Open preview URL if available, otherwise console
        if (result.previewUrl) {
          window.open(result.previewUrl, '_blank');
        } else if (result.consoleUrl) {
          window.open(result.consoleUrl, '_blank');
        }
      } else {
        setChannelError(result.error || result.hint || 'Failed to create channel');
      }
    } catch (error: any) {
      console.error(`[Deploy] Channel creation error:`, error);
      setChannelError(error.message || 'Failed to create channel');
    }
    
    setIsCreatingChannel(false);
  };

  // One-click deploy: Upload + Deploy in single action
  const handleOneClickDeploy = async () => {
    if (!hasApiKey || !solution?.csvContent) return;
    
    // Validate bot ID first
    const validation = validateBotId(botId);
    if (!validation.valid) {
      setBotIdError(validation.error || 'Invalid Bot ID');
      return;
    }
    
    // Check CSV structure first (node 1 exists, etc.)
    const structureCheck = validateCSVStructure(solution.csvContent);
    if (!structureCheck.valid) {
      setDeployStatus('error');
      setDeployResult({ 
        error: (structureCheck.errors || ['Invalid CSV structure']).join('\n') + '\n\nPlease regenerate the solution to fix this issue.'
      });
      return;
    }
    
    // Run pre-deploy validation
    const preCheck = preDeployValidation(solution.csvContent, false);
    if (!preCheck.valid) {
      setPreValidation(preCheck);
      // Don't stop deployment, but show warning
    } else {
      setPreValidation(null);
    }
    
    const token = credentials.pypestreamApiKey!;
    setDeployStatus('deploying');
    setDeployResult({});
    
    try {
      // Step 1: Fetch all required script contents for upload with CSV
      const currentDetection = detectRequiredScripts(solution.csvContent);
      console.log('[Deploy] ========== SCRIPT DETECTION ==========');
      console.log('[Deploy] Official scripts:', currentDetection.officialScripts);
      console.log('[Deploy] Custom scripts:', currentDetection.customScripts);
      console.log('[Deploy] Missing scripts (need upload):', currentDetection.missingScripts);
      console.log('[Deploy] System nodes (no upload needed):', currentDetection.systemNodes);
      console.log('[Deploy] Already uploaded:', Array.from(uploadedScripts));
      
      const scriptsToUpload = currentDetection.missingScripts.filter(s => !uploadedScripts.has(s));
      console.log('[Deploy] Scripts to fetch and upload:', scriptsToUpload);
      
      // Fetch script contents from API (Supabase or local files)
      const scriptsForDeploy: { name: string; content: string }[] = [];
      
      if (scriptsToUpload.length > 0) {
        setDeployProgress(`Fetching ${scriptsToUpload.length} action node scripts...`);
        
        for (const scriptName of scriptsToUpload) {
          try {
            const response = await fetch('/api/scripts/get-content', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scriptName }),
            });
            
            if (response.ok) {
              const result = await response.json();
              if (result.content) {
                scriptsForDeploy.push({ name: scriptName, content: result.content });
                console.log(`[Deploy] Fetched script: ${scriptName}`);
              }
            } else {
              console.warn(`[Deploy] Failed to fetch script ${scriptName}`);
            }
          } catch (e) {
            console.warn(`[Deploy] Error fetching script ${scriptName}:`, e);
          }
        }
        
        console.log(`[Deploy] Fetched ${scriptsForDeploy.length}/${scriptsToUpload.length} scripts`);
      }
      
      // Step 2: Auto-generate and upload the app.py config
      setDeployProgress('Generating and uploading configuration...');
      const configContent = generateDefaultConfig();
      try {
        const configResponse = await fetch('/api/botmanager/upload-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botId,
            configContent,
            token,
          }),
        });
        
        if (configResponse.ok) {
          setConfigUploaded(true);
          console.log('[Deploy] Auto-generated app.py config uploaded successfully');
        } else {
          console.warn('[Deploy] Config upload failed, continuing with deployment...');
        }
      } catch (configError) {
        console.warn('[Deploy] Config upload error, continuing:', configError);
      }
      
      // Step 3: Sanitize and upload CSV
      if (scriptsForDeploy.length > 0) {
        setDeployProgress(`Uploading CSV and ${scriptsForDeploy.length} scripts...`);
      } else {
        setDeployProgress('Sanitizing and uploading CSV...');
      }
      
      // Run structural pre-validation first, then sanitize
      const preResult = structuralPreValidation(solution.csvContent);
      if (preResult.fixes.length > 0) {
        console.log(`[Deploy] Structural pre-validation applied ${preResult.fixes.length} fixes:`, preResult.fixes);
      }
      const sanitizedCsv = sanitizeCSVForDeploy(preResult.csv);
      
      // Pass scripts to deploy - they'll be uploaded to the same version as the CSV
      console.log('[Deploy] ========== CALLING DEPLOY ==========');
      console.log('[Deploy] Scripts to include:', scriptsForDeploy.map(s => s.name));
      console.log('[Deploy] Script count:', scriptsForDeploy.length);
      
      const result = await oneClickDeploy(
        sanitizedCsv,
        botId,
        selectedEnv,
        token,
        scriptsForDeploy.length > 0 ? scriptsForDeploy : undefined
      );
      
      // Mark scripts as uploaded on success
      if (result.success && scriptsForDeploy.length > 0) {
        const newUploaded = new Set(uploadedScripts);
        scriptsForDeploy.forEach(s => newUploaded.add(s.name));
        setUploadedScripts(newUploaded);
      }
      
      if (result.success && result.deployed) {
        let finalPreviewUrl = result.previewUrl;
        let finalWidgetId = result.widgetId;
        let finalChannelNote = result.channelNote;
        
        // If no preview URL, automatically create a channel
        if (!finalPreviewUrl && result.versionId) {
          setDeployProgress('Creating channel...');
          console.log('[Deploy] No preview URL, auto-creating channel...');
          console.log('[Deploy] Brand assets being sent:', {
            hasAssets: !!projectConfig.brandAssets,
            logoUrl: projectConfig.brandAssets?.logoUrl || 'none',
            colorCount: projectConfig.brandAssets?.colors?.length || 0,
            primaryColor: projectConfig.brandAssets?.primaryColor,
            targetCompany: projectConfig.targetCompany,
          });
          
          try {
            const channelResponse = await fetch('/api/botmanager/create-channel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                botId,
                versionId: result.versionId,
                token,
                environment: selectedEnv,
                brandAssets: projectConfig.brandAssets,  // Pass brand colors for widget styling
                targetCompany: projectConfig.targetCompany,  // Pass company name for widget title
              }),
            });
            
            const channelResult = await channelResponse.json();
            console.log('[Deploy] Auto channel creation result:', channelResult);
            
            if (channelResult.success && channelResult.previewUrl) {
              finalPreviewUrl = channelResult.previewUrl;
              finalChannelNote = channelResult.message;
              setChannelExists(true);
              console.log('[Deploy] Channel created with preview URL:', finalPreviewUrl);
            } else if (channelResult.error) {
              console.log('[Deploy] Channel creation failed:', channelResult.error);
              setChannelError(channelResult.error);
            }
          } catch (channelError: any) {
            console.error('[Deploy] Channel creation error:', channelError);
            setChannelError(channelError.message || 'Channel creation failed');
          }
        }
        
        setDeployResult({
          versionId: result.versionId,
          previewUrl: finalPreviewUrl,
          widgetId: finalWidgetId,
          channelNote: finalChannelNote,
        });
        setDeployStatus('success');
        
        // Update local solution with deployment info (persists on reload)
        if (solution) {
          setSolution({
            ...solution,
            botUrl: finalPreviewUrl,
            deployedEnvironment: selectedEnv,
            deployedVersionId: result.versionId,
          });
        }
        
        // Update saved solution with deployment info in Supabase
        // Save both botUrl (for "View Bot") and widgetUrl (for "View Channel Design")
        if (activeSolutionId) {
          updateSavedSolution(activeSolutionId, {
            status: 'deployed',
            deployedEnvironment: selectedEnv,
            botUrl: finalPreviewUrl,
            widgetUrl: finalPreviewUrl,  // Same URL - the widget preview
          });
        }
      } else if (result.success && !result.deployed) {
        // Upload succeeded but deploy failed
        setDeployResult({
          versionId: result.versionId,
          error: 'Upload succeeded but deployment failed. Please try again.',
          errors: result.deployResult?.error ? [JSON.stringify(result.deployResult.error)] : undefined,
        });
        setDeployStatus('error');
      } else {
        // Check for auth error in result
        const isAuth = result.authError || result.errors?.some((e: any) => 
          typeof e === 'string' && e.toLowerCase().includes('token')
        );
        
        setDeployResult({
          error: result.message || 'Deployment failed. The bot could not be compiled.',
          errors: result.errors?.map((e: any) => typeof e === 'string' ? e : JSON.stringify(e)),
          authError: isAuth,
        });
        setDeployStatus('error');
      }
    } catch (error: any) {
      // Check if the error message indicates an auth issue
      const errorMsg = error.message || 'Deployment failed. Please check your API key and bot ID.';
      const isAuth = errorMsg.toLowerCase().includes('token') || 
                     errorMsg.toLowerCase().includes('api key') ||
                     errorMsg.toLowerCase().includes('expired') ||
                     errorMsg.toLowerCase().includes('unauthorized');
      
      setDeployResult({
        error: errorMsg,
        authError: isAuth,
      });
      setDeployStatus('error');
    }
    
    setDeployProgress('');
  };

  const handleCopyUrl = () => {
    if (deployResult.previewUrl) {
      navigator.clipboard.writeText(deployResult.previewUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  return (
    <div className="space-y-6 stagger-children">
      {/* Header */}
      <div>
        <h2 className="text-headline text-[#f0f0f5] mb-2">Deploy solution</h2>
        <p className="text-body text-[#8585a3]">
          Push your bot to Pypestream
        </p>
      </div>

      {/* Previously Deployed Indicator */}
      {deployStatus === 'idle' && solution?.botUrl && solution?.deployedEnvironment && (
        <Card className="bg-[rgba(34,197,94,0.04)] border-[rgba(34,197,94,0.15)]">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#4ade80] shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-[#e8e8f0]">Previously Deployed</h3>
              <p className="text-[13px] text-[#8585a3] mt-1">
                This solution was deployed to {solution.deployedEnvironment}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <a href={solution.botUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="secondary" icon={<ExternalLink className="w-3.5 h-3.5" />}>
                    Open Solution
                  </Button>
                </a>
                <span className="text-[12px] text-[#5c5c78]">
                  You can re-deploy to update or switch environments
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Success State */}
      {deployStatus === 'success' && (
        <>
        <Card variant="elevated" className="bg-gradient-to-br from-[rgba(34,197,94,0.08)] to-[rgba(34,197,94,0.02)] border-[rgba(34,197,94,0.2)]">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#22c55e] to-[#16a34a] flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(34,197,94,0.3)]">
              <PartyPopper className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold text-[#e8e8f0] mb-1">Deployed successfully!</h3>
              <p className="text-[14px] text-[#8585a3] mb-4">
                Your bot is live on {selectedEnv}
              </p>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="text-[#5c5c78] w-16">Version</span>
                  <span className="text-[#e8e8f0] font-mono bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded">{deployResult.versionId}</span>
                </div>
                
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="text-[#5c5c78] w-16">Bot ID</span>
                  <span className="text-[#e8e8f0] font-mono bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded">{botId}</span>
                </div>

                {deployResult.previewUrl ? (
                  <div className="space-y-4 mt-4">
                    {/* Prominent Open Solution Button */}
                    <a href={deployResult.previewUrl} target="_blank" rel="noopener noreferrer" className="block">
                      <Button 
                        size="lg" 
                        className="w-full bg-gradient-to-r from-[#22c55e] to-[#16a34a] hover:from-[#16a34a] hover:to-[#15803d]"
                        icon={<ExternalLink className="w-5 h-5" />}
                      >
                        Open Solution in Pypestream
                      </Button>
                    </a>
                    
                    {/* URL Copy Section */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={deployResult.previewUrl}
                        className="flex-1 px-3 py-2 bg-[rgba(10,10,15,0.6)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[12px] text-[#a3a3bd] font-mono"
                      />
                      <Button variant="secondary" size="sm" onClick={handleCopyUrl} icon={<Copy className="w-3.5 h-3.5" />}>
                        {copiedUrl ? 'Copied!' : 'Copy'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="p-4 bg-[rgba(129,140,248,0.06)] border border-[rgba(129,140,248,0.15)] rounded-xl">
                      <div className="flex items-start gap-3">
                        <Globe className="w-5 h-5 text-[#818cf8] shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h4 className="text-[14px] font-medium text-[#818cf8] mb-1">Create an Interface to Preview</h4>
                          <p className="text-[12px] text-[#a3a3bd] leading-relaxed mb-3">
                            Your bot is deployed! Create a channel to test it:
                          </p>
                          
                          <div className="flex flex-wrap gap-3 mb-4">
                            <Button 
                              onClick={handleCreateChannel}
                              disabled={isCreatingChannel}
                              className="bg-gradient-to-r from-[#818cf8] to-[#6366f1] hover:from-[#6366f1] hover:to-[#4f46e5]"
                              icon={isCreatingChannel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            >
                              {isCreatingChannel ? 'Creating Channel...' : 'Create Channel Automatically'}
                            </Button>
                            <a 
                              href={`https://console.pypestream.com/customers/${botId.split('.')[0]}/solutions/${botId.split('.')[1]}/interfaces`}
                              target="_blank" 
                              rel="noopener noreferrer"
                            >
                              <Button variant="outline" icon={<ExternalLink className="w-4 h-4" />}>
                                Open Console
                              </Button>
                            </a>
                          </div>
                          
                          {channelError && (
                            <div className="p-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] rounded-lg mb-3">
                              <p className="text-[12px] text-[#f87171]">{channelError}</p>
                              <p className="text-[11px] text-[#a3a3bd] mt-1">
                                You can still create a channel manually in the Console.
                              </p>
                            </div>
                          )}
                          
                          <details className="text-[12px] text-[#6b6b8a]">
                            <summary className="cursor-pointer hover:text-[#a3a3bd]">Manual steps (if auto-create fails)</summary>
                            <ol className="list-decimal list-inside space-y-1 mt-2 ml-2">
                              <li>Go to <strong>Solutions</strong> → <strong>{botId.split('.')[1] || 'Your Solution'}</strong></li>
                              <li>Click on the <strong>Interfaces</strong> tab</li>
                              <li>Click <strong>+ Add Interface</strong></li>
                              <li>Copy the embed code or use the preview URL</li>
                            </ol>
                          </details>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
        
        {/* What's Next Section */}
        <Card variant="elevated" className="mt-6">
          <h3 className="text-[15px] font-semibold text-[#e8e8f0] mb-4">What's next?</h3>
          <div className="flex flex-wrap gap-3">
            <Button 
              variant="outline"
              onClick={() => reset()}
              icon={<RotateCcw className="w-4 h-4" />}
            >
              New Project
            </Button>
            <a href="https://console.pypestream.com" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" icon={<ExternalLink className="w-4 h-4" />}>
                Open Console
              </Button>
            </a>
            {deployResult.previewUrl && (
              <a href={deployResult.previewUrl} target="_blank" rel="noopener noreferrer">
                <Button 
                  className="bg-gradient-to-r from-[#22c55e] to-[#16a34a] hover:from-[#16a34a] hover:to-[#15803d]"
                  icon={<Play className="w-4 h-4" />}
                >
                  Test Solution
                </Button>
              </a>
            )}
          </div>
        </Card>
        </>
      )}

      {/* Error State */}
      {deployStatus === 'error' && (
        <Card className="bg-[rgba(239,68,68,0.04)] border-[rgba(239,68,68,0.15)]">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#f87171] shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-[#e8e8f0]">Deployment Failed</h3>
              <p className="text-[13px] text-[#8585a3] mt-1">{deployResult.error}</p>
              {deployResult.errors && deployResult.errors.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {deployResult.errors.slice(0, 5).map((err, idx) => (
                    <li key={idx} className="text-[12px] text-[#c4c4d6]">• {err}</li>
                  ))}
                </ul>
              )}
              
              {/* Show API key input prominently if this is an auth error */}
              {hasAuthError ? (
                <div className="mt-4 p-4 rounded-xl bg-[rgba(251,191,36,0.15)] border-2 border-[rgba(251,191,36,0.4)]">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-[rgba(251,191,36,0.2)] flex items-center justify-center">
                      <Key className="w-4 h-4 text-[#fbbf24]" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-semibold text-[#fbbf24]">API Key Required</h4>
                      <p className="text-[12px] text-[#d4a833]">Your API key is invalid or expired</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Input
                      type="password"
                      placeholder="Paste your new Pypestream API key here"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && apiKeyInput.trim()) {
                          setCredentials({ pypestreamApiKey: apiKeyInput.trim() });
                          setApiKeyInput('');
                          setDeployStatus('idle');
                          setDeployResult({});
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          if (apiKeyInput.trim()) {
                            setCredentials({ pypestreamApiKey: apiKeyInput.trim() });
                            setApiKeyInput('');
                            setDeployStatus('idle');
                            setDeployResult({});
                          }
                        }}
                        disabled={!apiKeyInput.trim()}
                        className="flex-1"
                      >
                        Save Key & Retry Deploy
                      </Button>
                      <a 
                        href="https://console.pypestream.com/settings/api-keys" 
                        target="_blank" 
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline">
                          Get API Key
                        </Button>
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setDeployStatus('idle')}>
                  Try Again
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Pre-deploy UI */}
      {deployStatus !== 'success' && (
        <>
          {/* API Key Section */}
          <Card variant="elevated">
            <CardHeader 
              title="Pypestream API Key" 
              description="Required for deployment"
              icon={<Key className="w-5 h-5" />}
              size="sm"
            />
            
            {hasApiKey ? (
              <div className="flex items-center justify-between p-3 bg-[rgba(34,197,94,0.04)] rounded-xl border border-[rgba(34,197,94,0.12)]">
                <div className="flex items-center gap-2 text-[13px] text-[#4ade80]">
                  <Check className="w-4 h-4" />
                  <span>API key configured</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setCredentials({ pypestreamApiKey: undefined })}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  type="password"
                  placeholder="Enter your Pypestream API key"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                  helperText="Find this in Pypestream Console → Settings → API Keys"
                />
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={handleSaveApiKey}
                  disabled={!apiKeyInput.trim()}
                >
                  Save Key
                </Button>
              </div>
            )}
          </Card>

          {/* Bot ID Section */}
          <Card>
            <CardHeader 
              title="Bot ID" 
              description="Target bot for deployment"
              size="sm"
            />
            
            {isEditingBotId ? (
              <div className="space-y-3">
                <Input
                  value={customBotId}
                  onChange={(e) => handleBotIdChange(e.target.value)}
                  placeholder="CustomerName.BotName"
                  helperText="Format: CustomerName.BotName (e.g., Yeti.ProductBot)"
                  error={botIdError || undefined}
                />
                <div className="flex gap-2">
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleBotIdSave}
                    disabled={!!botIdError}
                  >
                    Save
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      setIsEditingBotId(false);
                      setCustomBotId(defaultBotId);
                      setBotIdError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-[rgba(255,255,255,0.02)] rounded-xl border border-[rgba(255,255,255,0.06)]">
                <div className="flex items-center gap-3">
                  <span className="text-[14px] text-[#e8e8f0] font-mono">{botId}</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setIsEditingBotId(true)}
                  icon={<Edit2 className="w-3.5 h-3.5" />}
                >
                  Edit
                </Button>
              </div>
            )}
            
            <p className="text-[11px] text-[#5c5c78] mt-2">
              Bot will be created automatically if it doesn't exist
            </p>
          </Card>

          {/* Target Company / Brand Section */}
          <Card className={projectConfig.brandAssets ? "border-[rgba(99,102,241,0.2)] bg-[rgba(99,102,241,0.02)]" : ""}>
            <CardHeader 
              title="Target Company / Brand" 
              description="Brand colors and logo will be applied to the widget"
              icon={<Building2 className="w-5 h-5" />}
              size="sm"
            />
            
            {isEditingCompany ? (
              <div className="space-y-3">
                <Input
                  value={editedCompanyName}
                  onChange={(e) => setEditedCompanyName(e.target.value)}
                  placeholder="e.g., Travelers Insurance, WeWork, Delta Airlines"
                  helperText="Enter the company name to auto-detect brand colors and logo"
                />
                <div className="flex gap-2">
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleSaveCompany}
                    loading={isFetchingBrand}
                    disabled={isFetchingBrand}
                  >
                    {isFetchingBrand ? 'Fetching brand...' : 'Save & Detect Brand'}
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      setIsEditingCompany(false);
                      setEditedCompanyName(projectConfig.targetCompany || '');
                    }}
                    disabled={isFetchingBrand}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Company name and logo display */}
                <div className="flex items-center justify-between p-3 bg-[rgba(255,255,255,0.02)] rounded-xl border border-[rgba(255,255,255,0.06)]">
                  <div className="flex items-center gap-3">
                    {projectConfig.brandAssets?.logoUrl && (
                      <div 
                        className={`w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden border ${
                          // Use dark background for light/transparent logos, light for dark logos
                          projectConfig.brandAssets.logoBackground === 'dark' 
                            ? 'bg-[#1a1a1f] border-[rgba(255,255,255,0.1)]' 
                            : 'bg-[#2a2a35] border-[rgba(255,255,255,0.15)]'
                        }`}
                      >
                        <img 
                          src={projectConfig.brandAssets.logoUrl} 
                          alt="" 
                          className="max-w-[32px] max-h-[32px] object-contain"
                        />
                      </div>
                    )}
                    <div>
                      <span className="text-[14px] text-[#e8e8f0] font-medium">
                        {projectConfig.targetCompany || projectConfig.brandAssets?.name || 'Not specified'}
                      </span>
                      {projectConfig.brandAssets?.domain && (
                        <p className="text-[11px] text-[#5c5c78]">{projectConfig.brandAssets.domain}</p>
                      )}
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      setEditedCompanyName(projectConfig.targetCompany || '');
                      setIsEditingCompany(true);
                    }}
                    icon={<Edit2 className="w-3.5 h-3.5" />}
                  >
                    Edit
                  </Button>
                </div>
                
                {/* Brand assets grid */}
                {projectConfig.brandAssets && (
                  <div className="grid grid-cols-1 gap-3">
                    {/* Colors row */}
                    <div className="flex items-center gap-3 px-3 py-2 bg-[rgba(255,255,255,0.02)] rounded-lg">
                      <div className="flex items-center gap-1.5 min-w-[70px]">
                        <Palette className="w-3.5 h-3.5 text-[#8585a3]" />
                        <span className="text-[12px] text-[#8585a3]">Colors</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {projectConfig.brandAssets.colors?.slice(0, 6).map((color, i) => (
                          <div 
                            key={i}
                            className="w-6 h-6 rounded border border-[rgba(255,255,255,0.2)] shadow-sm" 
                            style={{ backgroundColor: color.hex }}
                            title={`${color.name}: ${color.hex}`}
                          />
                        ))}
                        {(!projectConfig.brandAssets.colors || projectConfig.brandAssets.colors.length === 0) && (
                          <span className="text-[11px] text-[#5c5c78]">None detected</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Fonts row */}
                    <div className="flex items-center gap-3 px-3 py-2 bg-[rgba(255,255,255,0.02)] rounded-lg">
                      <div className="flex items-center gap-1.5 min-w-[70px]">
                        <Type className="w-3.5 h-3.5 text-[#8585a3]" />
                        <span className="text-[12px] text-[#8585a3]">Fonts</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {projectConfig.brandAssets.fonts?.map((font, i) => (
                          <span 
                            key={i}
                            className="text-[12px] text-[#c4c4d6] px-2 py-0.5 bg-[rgba(255,255,255,0.05)] rounded"
                            title={`${font.type}: ${font.name}`}
                          >
                            {font.name}
                          </span>
                        ))}
                        {(!projectConfig.brandAssets.fonts || projectConfig.brandAssets.fonts.length === 0) && (
                          <span className="text-[11px] text-[#5c5c78]">None detected</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Brand header/images row */}
                    {projectConfig.brandAssets.images && projectConfig.brandAssets.images.length > 0 && (
                      <div className="px-3 py-2 bg-[rgba(255,255,255,0.02)] rounded-lg">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Image className="w-3.5 h-3.5 text-[#8585a3]" />
                          <span className="text-[12px] text-[#8585a3]">Brand Images</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto">
                          {projectConfig.brandAssets.images.slice(0, 3).map((img, i) => (
                            <div 
                              key={i}
                              className="w-20 h-12 rounded-lg overflow-hidden bg-[#1a1a1f] border border-[rgba(255,255,255,0.1)] flex-shrink-0"
                            >
                              <img 
                                src={img.url} 
                                alt={img.type}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Re-detect button */}
                {projectConfig.brandAssets && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditedCompanyName(projectConfig.targetCompany || '');
                        setIsEditingCompany(true);
                      }}
                      icon={<RefreshCw className="w-3 h-3" />}
                      className="text-[11px]"
                    >
                      Re-detect Brand
                    </Button>
                  </div>
                )}
                
                {/* No brand detected message */}
                {!projectConfig.brandAssets && projectConfig.targetCompany && (
                  <p className="text-[11px] text-[#8585a3] px-3">
                    No brand detected. Click Edit to try a different company name, or default colors will be used.
                  </p>
                )}
              </div>
            )}
            
            <p className="text-[11px] text-[#5c5c78] mt-3 pt-3 border-t border-[rgba(255,255,255,0.05)]">
              Brand colors and logo will be applied to the widget when the channel is created.
            </p>
          </Card>

          {/* Environment Selection */}
          <Card>
            <CardHeader title="Environment" description="Choose deployment target" size="sm" />
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSelectedEnv('sandbox')}
                className={`
                  p-4 rounded-xl border text-left transition-all duration-200
                  ${selectedEnv === 'sandbox'
                    ? 'border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.08)]'
                    : 'border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)]'
                  }
                `}
              >
                <div className="flex items-center gap-2.5 mb-1.5">
                  <Server className={`w-4 h-4 ${selectedEnv === 'sandbox' ? 'text-[#a5b4fc]' : 'text-[#5c5c78]'}`} />
                  <span className={`text-[14px] font-medium ${selectedEnv === 'sandbox' ? 'text-[#a5b4fc]' : 'text-[#e8e8f0]'}`}>
                    Sandbox
                  </span>
                </div>
                <p className="text-[12px] text-[#5c5c78]">Test environment</p>
              </button>

              <button
                onClick={() => setSelectedEnv('production')}
                className={`
                  p-4 rounded-xl border text-left transition-all duration-200
                  ${selectedEnv === 'production'
                    ? 'border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.08)]'
                    : 'border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)]'
                  }
                `}
              >
                <div className="flex items-center gap-2.5 mb-1.5">
                  <Globe className={`w-4 h-4 ${selectedEnv === 'production' ? 'text-[#a5b4fc]' : 'text-[#5c5c78]'}`} />
                  <span className={`text-[14px] font-medium ${selectedEnv === 'production' ? 'text-[#a5b4fc]' : 'text-[#e8e8f0]'}`}>
                    Production
                  </span>
                </div>
                <p className="text-[12px] text-[#5c5c78]">Live environment</p>
              </button>
            </div>
          </Card>

          {/* Action Node Scripts Info */}
          {hasMissingScripts && (
            <Card className="border-[rgba(99,102,241,0.2)] bg-[rgba(99,102,241,0.02)]">
              <div className="flex items-start gap-3 mb-3">
                <FileCode className="w-5 h-5 text-[#818cf8] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-[14px] font-semibold text-[#818cf8] mb-1">
                    Action Node Scripts
                  </h4>
                  <p className="text-[12px] text-[#a3a3bd]">
                    These scripts will be automatically uploaded when you deploy.
                  </p>
                </div>
              </div>
              
              {/* Official Scripts - Auto-uploaded */}
              {scriptDetection && scriptDetection.officialScripts.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] text-[#4ade80] font-medium">
                      Official Scripts ({scriptDetection.officialScripts.length})
                    </span>
                    <span className="text-[10px] text-[#4ade80] px-1.5 py-0.5 bg-[rgba(34,197,94,0.1)] rounded">
                      Auto-upload
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {scriptDetection.officialScripts.map((scriptName) => (
                      <span
                        key={scriptName}
                        className={`text-[11px] font-mono px-2 py-1 rounded ${
                          uploadedScripts.has(scriptName)
                            ? 'bg-[rgba(34,197,94,0.15)] text-[#4ade80]'
                            : 'bg-[rgba(99,102,241,0.1)] text-[#a5b4fc]'
                        }`}
                      >
                        {uploadedScripts.has(scriptName) && '✓ '}{scriptName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Custom Scripts - Need manual upload or remove */}
              {scriptDetection && scriptDetection.customScripts.length > 0 && (
                <div className="mb-3 pt-3 border-t border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] text-[#f87171] font-medium">
                      Custom Scripts ({scriptDetection.customScripts.length})
                    </span>
                    <span className="text-[10px] text-[#f87171] px-1.5 py-0.5 bg-[rgba(239,68,68,0.1)] rounded">
                      Requires action
                    </span>
                  </div>
                  <div className="space-y-2">
                    {scriptDetection.customScripts.map((scriptName) => (
                      <div 
                        key={scriptName} 
                        className={`p-2.5 rounded-lg border ${
                          uploadedScripts.has(scriptName)
                            ? 'bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.2)]'
                            : 'bg-[rgba(239,68,68,0.04)] border-[rgba(239,68,68,0.15)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {uploadedScripts.has(scriptName) ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#4ade80]" />
                            ) : (
                              <FileCode className="w-3.5 h-3.5 text-[#f87171]" />
                            )}
                            <span className="text-[12px] font-mono text-[#e8e8f0]">{scriptName}.py</span>
                          </div>
                          
                          {uploadedScripts.has(scriptName) ? (
                            <span className="text-[10px] text-[#4ade80]">Uploaded</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <label className="cursor-pointer">
                                <input
                                  type="file"
                                  accept=".py"
                                  className="hidden"
                                  onChange={handleScriptFileSelect(scriptName)}
                                  disabled={isUploadingScripts}
                                />
                                <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] hover:bg-[rgba(99,102,241,0.2)] border border-[rgba(99,102,241,0.2)] cursor-pointer">
                                  <Upload className="w-3 h-3" />
                                  Upload
                                </span>
                              </label>
                              <button
                                onClick={() => handleRemoveScript(scriptName)}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-[rgba(239,68,68,0.1)] text-[#f87171] hover:bg-[rgba(239,68,68,0.2)] border border-[rgba(239,68,68,0.2)]"
                                title="Replace with mock data"
                              >
                                <Trash2 className="w-3 h-3" />
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#5c5c78] mt-2">
                    Custom scripts must be uploaded manually, or click "Remove" to replace with mock data.
                  </p>
                </div>
              )}
              
              {/* Summary */}
              {scriptDetection && (
                <div className="text-[11px] text-[#8585a3] pt-2 border-t border-[rgba(255,255,255,0.05)]">
                  {scriptDetection.officialScripts.length > 0 && (
                    <span className="text-[#4ade80]">✓ {scriptDetection.officialScripts.length} official scripts ready for auto-upload</span>
                  )}
                  {scriptDetection.customScripts.length > 0 && scriptDetection.officialScripts.length > 0 && ' • '}
                  {scriptDetection.customScripts.filter(s => !uploadedScripts.has(s)).length > 0 && (
                    <span className="text-[#f87171]">{scriptDetection.customScripts.filter(s => !uploadedScripts.has(s)).length} custom scripts need attention</span>
                  )}
                </div>
              )}
            </Card>
          )}
          
          {/* Deployment Readiness Checklist */}
          <Card>
            <CardHeader 
              title="Deployment Readiness" 
              description="Complete these steps before deploying"
              size="sm" 
            />
            <div className="space-y-3">
              {/* CSV Uploaded */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-[rgba(34,197,94,0.05)] border border-[rgba(34,197,94,0.1)]">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
                  <span className="text-[13px] text-[#e8e8f0]">CSV Solution</span>
                </div>
                <span className="text-[11px] text-[#4ade80] px-2 py-1 bg-[rgba(34,197,94,0.1)] rounded">Ready</span>
              </div>

              {/* Action Node Scripts - Auto-uploaded */}
              <div className={`p-3 rounded-lg border ${
                (scriptDetection?.customScripts.filter(s => !uploadedScripts.has(s)).length || 0) > 0
                  ? 'bg-[rgba(251,191,36,0.05)] border-[rgba(251,191,36,0.1)]'
                  : 'bg-[rgba(34,197,94,0.05)] border-[rgba(34,197,94,0.1)]'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {(scriptDetection?.customScripts.filter(s => !uploadedScripts.has(s)).length || 0) > 0 ? (
                      <AlertTriangle className="w-4 h-4 text-[#fbbf24]" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
                    )}
                    <div>
                      <span className="text-[13px] text-[#e8e8f0]">Action Node Scripts</span>
                      <p className="text-[10px] text-[#5c5c78]">Official scripts auto-upload during deployment</p>
                    </div>
                  </div>
                  {scriptDetection && scriptDetection.officialScripts.length > 0 && (
                    <span className="text-[11px] text-[#4ade80] px-2 py-1 bg-[rgba(34,197,94,0.1)] rounded">
                      {scriptDetection.officialScripts.length} auto
                    </span>
                  )}
                </div>
                {(scriptDetection?.customScripts.filter(s => !uploadedScripts.has(s)).length || 0) > 0 && (
                  <p className="text-[10px] text-[#fbbf24] mt-2">
                    ⚠ {scriptDetection?.customScripts.filter(s => !uploadedScripts.has(s)).length} custom script(s) need manual upload or removal
                  </p>
                )}
              </div>

              {/* Config File (app.py) - Auto-generated */}
              <div className={`flex items-center justify-between p-3 rounded-lg border ${
                configUploaded 
                  ? 'bg-[rgba(34,197,94,0.05)] border-[rgba(34,197,94,0.1)]'
                  : 'bg-[rgba(99,102,241,0.05)] border-[rgba(99,102,241,0.1)]'
              }`}>
                <div className="flex items-center gap-2">
                  {configUploaded ? (
                    <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
                  ) : (
                    <Wrench className="w-4 h-4 text-[#818cf8]" />
                  )}
                  <div>
                    <span className="text-[13px] text-[#e8e8f0]">Configuration (app.py)</span>
                    <p className="text-[10px] text-[#5c5c78]">Auto-generated during deployment</p>
                  </div>
                </div>
                {configUploaded ? (
                  <span className="text-[11px] text-[#4ade80] px-2 py-1 bg-[rgba(34,197,94,0.1)] rounded">Uploaded</span>
                ) : (
                  <span className="text-[11px] text-[#818cf8] px-2 py-1 bg-[rgba(99,102,241,0.1)] rounded">Auto</span>
                )}
              </div>

              {/* Channel/Widget - informational */}
              <div className="p-3 rounded-lg bg-[rgba(99,102,241,0.05)] border border-[rgba(99,102,241,0.1)]">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4 text-[#818cf8]" />
                  <span className="text-[13px] text-[#e8e8f0]">Channel/Widget</span>
                </div>
                <p className="text-[11px] text-[#8585a3]">
                  A channel will be created automatically during deployment. You can also create one manually in the Pypestream console.
                </p>
              </div>
            </div>
          </Card>

          {/* Pre-Deploy Validation */}
          {preValidation && !preValidation.valid && (
            <Card className="border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.02)]">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-[#fbbf24] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-[14px] font-semibold text-[#fbbf24] mb-1">
                    Pre-Deploy Validation Issues
                  </h4>
                  <p className="text-[12px] text-[#a3a3bd]">
                    {preValidation.errors.length} issue(s) found that may cause deployment errors
                  </p>
                </div>
              </div>
              
              <div className="space-y-2 max-h-40 overflow-y-auto mb-3">
                {preValidation.errors.map((err, idx) => (
                  <div key={idx} className="p-2.5 bg-[rgba(239,68,68,0.06)] rounded-lg border border-[rgba(239,68,68,0.1)]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] text-[#818cf8] font-mono">Node {err.nodeNum}</span>
                      <span className="text-[11px] text-[#5c5c78]">•</span>
                      <span className="text-[11px] text-[#8585a3]">{err.field}</span>
                      {err.autoFixable && (
                        <span className="text-[10px] text-[#4ade80] px-1.5 py-0.5 bg-[rgba(34,197,94,0.1)] rounded">
                          Auto-fixable
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#c4c4d6]">{err.error}</p>
                  </div>
                ))}
              </div>
              
              {preValidation.errors.some(e => e.autoFixable) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoFix}
                  loading={isAutoFixing}
                  icon={<Wrench className="w-3.5 h-3.5" />}
                  className="w-full"
                >
                  {isAutoFixing ? 'Fixing...' : 'Auto-Fix Issues'}
                </Button>
              )}
            </Card>
          )}
          
          {/* Pre-validation passed indicator */}
          {preValidation?.valid && (
            <div className="flex items-center gap-2 p-3 bg-[rgba(34,197,94,0.06)] rounded-xl border border-[rgba(34,197,94,0.15)]">
              <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
              <span className="text-[13px] text-[#4ade80]">Pre-deploy validation passed</span>
            </div>
          )}

          {/* Deploy Button */}
          <div className="pt-2">
            <div className="flex gap-2 mb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={runPreDeployValidation}
                icon={<Shield className="w-3.5 h-3.5" />}
                className="flex-1"
              >
                Validate First
              </Button>
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={handleOneClickDeploy}
              disabled={!hasApiKey || deployStatus === 'deploying' || !!botIdError || isEditingBotId}
              loading={deployStatus === 'deploying'}
              icon={<Rocket className="w-5 h-5" />}
            >
              {deployStatus === 'deploying' 
                ? (deployProgress || 'Deploying...') 
                : `Deploy to ${selectedEnv}`
              }
            </Button>
            
            {!hasApiKey && (
              <p className="text-[12px] text-[#f87171] text-center mt-2">
                Please add your API key above to deploy
              </p>
            )}
          </div>
        </>
      )}


      {/* Navigation */}
      {deployStatus !== 'success' && (
        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={prevStep} icon={<ArrowLeft className="w-4 h-4" />}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
