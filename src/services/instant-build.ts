/**
 * Instant Build Pipeline Service
 * 
 * Orchestrates the complete flow from description to deployed bot:
 * 1. Extract project details from description (AI)
 * 2. Fetch brand assets (Brandfetch)
 * 3. Generate bot CSV (AI)
 * 4. Validate and auto-fix (Bot Manager API)
 * 5. Detect and fetch required action node scripts (Supabase)
 * 6. Deploy to sandbox with scripts
 * 7. Create branded channel/widget
 * 8. Export to Google Sheets
 */

import type { ExtractedDetails, InstantBuildResult, BrandAssets, ProjectConfig, FailedRow } from '../types';
import { generateBotCSV, validateAndRefineIteratively, parseCSVStats, type GenerationResult } from './generation';
import { oneClickDeploy, generateBotId, createChannelWithWidget } from './botmanager';
import { exportToGoogleSheets } from './composio';
import { fetchScripts } from './action-scripts-api';

/**
 * Extract failed row details from validation errors for debugging
 */
function extractFailedRows(errors: any[], csv: string): FailedRow[] {
  if (!errors || !Array.isArray(errors)) return [];
  
  const lines = csv.split('\n');
  const headers = lines[0]?.split(',').map(h => h.trim().replace(/^"|"$/g, '')) || [];
  
  // Parse CSV line handling quotes
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };
  
  const failedRows: FailedRow[] = [];
  const seenNodes = new Set<number>();
  
  for (const error of errors) {
    const nodeNum = error.node_num ?? error.nodeNum;
    const rowNum = error.row_num ?? error.rowNum ?? 0;
    
    // Skip duplicates
    if (nodeNum !== undefined && seenNodes.has(nodeNum)) continue;
    if (nodeNum !== undefined) seenNodes.add(nodeNum);
    
    // Find the raw row
    let rawRow = '';
    let fields: Record<string, string> = {};
    
    if (rowNum > 0 && rowNum < lines.length) {
      rawRow = lines[rowNum];
      const parsedFields = parseCSVLine(rawRow);
      headers.forEach((header, idx) => {
        if (parsedFields[idx] !== undefined) {
          fields[header] = parsedFields[idx];
        }
      });
    } else if (nodeNum !== undefined) {
      // Find by node number
      for (let i = 1; i < lines.length; i++) {
        const parsedFields = parseCSVLine(lines[i]);
        if (parseInt(parsedFields[0], 10) === nodeNum) {
          rawRow = lines[i];
          headers.forEach((header, idx) => {
            if (parsedFields[idx] !== undefined) {
              fields[header] = parsedFields[idx];
            }
          });
          break;
        }
      }
    }
    
    // Extract error messages
    const errorMessages: string[] = [];
    if (error.err_msgs && Array.isArray(error.err_msgs)) {
      for (const msg of error.err_msgs) {
        const fieldName = msg.field_name || '';
        const desc = msg.error_description || '';
        const entry = msg.field_entry ? ` (value: "${msg.field_entry.substring(0, 50)}...")` : '';
        errorMessages.push(`[${fieldName}] ${desc}${entry}`);
      }
    } else if (error.error_description) {
      errorMessages.push(error.error_description);
    } else if (typeof error === 'string') {
      errorMessages.push(error);
    }
    
    failedRows.push({
      nodeNum: nodeNum ?? -1,
      rowNum: rowNum ?? -1,
      nodeName: fields['Node Name'] || '',
      nodeType: fields['Node Type'] || '',
      errors: errorMessages,
      rawRow: rawRow.substring(0, 500), // Truncate for display
      fields
    });
  }
  
  return failedRows;
}

export interface InstantBuildProgress {
  step: 'extracting' | 'branding' | 'generating' | 'validating' | 'deploying' | 'exporting' | 'done' | 'error';
  message: string;
  progress: number; // 0-100
  details?: string;
}

export type ProgressCallback = (update: InstantBuildProgress) => void;

// System action nodes that don't require script upload
const SYSTEM_ACTION_NODES = new Set([
  'SysAssignVariable',
  'SysMultiMatchRouting', 
  'SysSetEnv',
  'SysShowMetadata',
  'SysVariableReset',
  'SysSendEmail',
  'SysHttpRequest',
]);

/**
 * Detect action node scripts referenced in CSV that need to be uploaded
 */
function detectActionNodeScripts(csv: string): string[] {
  const scripts = new Set<string>();
  const lines = csv.split('\n');
  
  if (lines.length < 2) return [];
  
  // Parse header to find column indices dynamically
  const header = parseCSVLine(lines[0]);
  const nodeTypeIdx = header.findIndex(h => h.toLowerCase().trim() === 'node type');
  const commandIdx = header.findIndex(h => h.toLowerCase().trim() === 'command');
  
  console.log('[InstantBuild] CSV columns - NodeType at:', nodeTypeIdx, ', Command at:', commandIdx);
  console.log('[InstantBuild] Header preview:', header.slice(0, 15).join(' | '));
  
  if (nodeTypeIdx === -1 || commandIdx === -1) {
    console.warn('[InstantBuild] Could not find required columns in CSV header');
    return [];
  }
  
  // Process data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line);
    const nodeType = values[nodeTypeIdx]?.trim();
    const command = values[commandIdx]?.trim();
    
    // Only process action nodes (type 'A')
    if (nodeType === 'A' && command) {
      // Skip system nodes that don't need script upload
      if (!SYSTEM_ACTION_NODES.has(command) && command.length > 0) {
        scripts.add(command);
      }
    }
  }
  
  console.log('[InstantBuild] Detected scripts from CSV:', Array.from(scripts));
  return Array.from(scripts);
}

/**
 * Simple CSV line parser that handles quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

/**
 * Fetch required action node scripts from Supabase
 */
async function fetchRequiredScripts(
  scriptNames: string[],
  onProgress?: ProgressCallback
): Promise<{ name: string; content: string }[]> {
  if (scriptNames.length === 0) return [];
  
  console.log('[InstantBuild] Scripts to fetch:', scriptNames);
  
  onProgress?.({
    step: 'deploying',
    message: `Fetching ${scriptNames.length} action node script(s)...`,
    progress: 55,
    details: scriptNames.join(', ')
  });
  
  const scriptsMap = await fetchScripts(scriptNames);
  const scripts: { name: string; content: string }[] = [];
  const missing: string[] = [];
  
  for (const name of scriptNames) {
    const script = scriptsMap.get(name);
    if (script && script.content) {
      scripts.push({ name: script.name, content: script.content });
      console.log(`[InstantBuild] Fetched script: ${name}`);
    } else {
      missing.push(name);
      console.warn(`[InstantBuild] Script not found in Supabase: ${name}`);
    }
  }
  
  if (missing.length > 0) {
    console.warn(`[InstantBuild] Missing scripts (deployment may fail): ${missing.join(', ')}`);
  }
  
  return scripts;
}

/**
 * Extract project details from a natural language description using AI
 */
export async function extractProjectDetails(description: string): Promise<ExtractedDetails> {
  try {
    const response = await fetch('/api/analyze-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: description })
    });
    
    if (response.ok) {
      const result = await response.json();
      // Clean targetCompany — strip trailing audience words (e.g., "Honda customers" → "Honda")
      let cleanCompany = (result.targetCompany || '').replace(
        /\s+(?:customers?|users?|clients?|members?|patients?|employees?|teams?|staff|subscribers?|shoppers?|owners?|drivers?)$/i, ''
      ).trim();
      return {
        clientName: result.clientName || 'CX',
        projectName: result.projectName || 'ChatbotMVP',
        projectType: result.projectType || 'custom',
        botPurpose: result.description || description,
        keyFeatures: result.keyFeatures || [],
        targetCompany: cleanCompany,
        description: description,
      };
    }
  } catch (error) {
    console.error('[InstantBuild] AI extraction failed:', error);
  }
  
  // Fallback to basic extraction
  return extractProjectDetailsBasic(description);
}

/**
 * Basic extraction logic when AI is unavailable
 */
function extractProjectDetailsBasic(text: string): ExtractedDetails {
  const lowerText = text.toLowerCase();
  
  // Try to extract target company name
  let targetCompany = '';
  const forMatch = text.match(/for\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|\s+(?:to|that|which|who|bot|chat))/i);
  const clientMatch = text.match(/(?:client|company|customer|brand)(?:\s+is|\s*:)?\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|$)/i);
  const namedMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:insurance|bank|health|corp|inc|llc|company)/i);
  
  if (forMatch) targetCompany = forMatch[1].trim();
  else if (clientMatch) targetCompany = clientMatch[1].trim();
  else if (namedMatch) targetCompany = namedMatch[0].trim();
  
  // Strip trailing audience/role words — we want the brand name, not "Honda customers"
  targetCompany = targetCompany.replace(/\s+(?:customers?|users?|clients?|members?|patients?|employees?|teams?|staff|subscribers?|shoppers?|owners?|drivers?)$/i, '').trim();
  
  // Detect project type from keywords
  let projectType: ExtractedDetails['projectType'] = 'custom';
  if (lowerText.includes('claim') || lowerText.includes('fnol') || lowerText.includes('damage')) {
    projectType = 'claims';
  } else if (lowerText.includes('support') || lowerText.includes('help') || lowerText.includes('troubleshoot')) {
    projectType = 'support';
  } else if (lowerText.includes('sales') || lowerText.includes('lead') || lowerText.includes('quote')) {
    projectType = 'sales';
  } else if (lowerText.includes('faq') || lowerText.includes('question') || lowerText.includes('answer')) {
    projectType = 'faq';
  } else if (lowerText.includes('survey') || lowerText.includes('feedback')) {
    projectType = 'survey';
  }
  
  // Generate project name based on type
  let projectName = 'ChatbotMVP';
  if (projectType === 'claims') {
    if (lowerText.includes('water') || lowerText.includes('flood')) projectName = 'WaterDamageFNOL';
    else if (lowerText.includes('auto') || lowerText.includes('car')) projectName = 'AutoClaimsMVP';
    else projectName = 'ClaimsFNOL';
  } else if (projectType === 'support') {
    projectName = 'CustomerSupportMVP';
  } else if (projectType === 'sales') {
    projectName = 'SalesAssistMVP';
  }
  
  // Extract key features
  const keyFeatures: string[] = [];
  if (lowerText.includes('collect')) keyFeatures.push('Data collection');
  if (lowerText.includes('agent') || lowerText.includes('escalat')) keyFeatures.push('Agent escalation');
  if (lowerText.includes('photo') || lowerText.includes('image') || lowerText.includes('upload')) keyFeatures.push('File upload');
  if (lowerText.includes('schedule') || lowerText.includes('appointment')) keyFeatures.push('Scheduling');
  if (lowerText.includes('form') || lowerText.includes('webview')) keyFeatures.push('Webview forms');
  
  return {
    clientName: 'CX',
    projectName,
    projectType,
    botPurpose: text.trim(),
    keyFeatures,
    targetCompany,
    description: text.trim(),
  };
}

/**
 * Fetch brand assets from Brandfetch API
 */
export async function fetchBrandAssets(companyName: string): Promise<BrandAssets | null> {
  if (!companyName) return null;
  
  // Clean company name before lookup — strip audience words that break brand detection
  const cleanName = companyName.replace(
    /\s+(?:customers?|users?|clients?|members?|patients?|employees?|teams?|staff|subscribers?|shoppers?|owners?|drivers?)$/i, ''
  ).trim();
  
  if (!cleanName) return null;
  console.log(`[InstantBuild] Brand lookup: "${companyName}" → "${cleanName}"`);
  
  try {
    const response = await fetch('/api/brandfetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: cleanName })
    });
    
    const data = await response.json();
    if (data.success && data.brand) {
      return data.brand;
    }
  } catch (error) {
    console.error('[InstantBuild] Brand fetch failed:', error);
  }
  
  return null;
}

/**
 * Run the complete instant build pipeline
 */
export async function instantBuild(
  description: string,
  extractedDetails: ExtractedDetails,
  brandAssets: BrandAssets | null,
  token: string,
  userId: string,
  onProgress?: ProgressCallback,
  cachedGeneration?: { result: GenerationResult; projectConfig: ProjectConfig },
  aiCredentials?: { apiKey?: string; provider?: 'anthropic' | 'google' }
): Promise<InstantBuildResult> {
  // Hoist these so they're accessible in catch for pipeline resume
  let generationResult: GenerationResult | undefined;
  let projectConfig: ProjectConfig | undefined;
  
  // Pipeline timing
  const pipelineStart = performance.now();
  const timings: Record<string, number> = {};
  const timeStep = (name: string, start: number) => {
    const elapsed = Math.round(performance.now() - start);
    timings[name] = elapsed;
    console.log(`[⏱ Timing] ${name}: ${(elapsed / 1000).toFixed(2)}s`);
  };
  
  try {
    // Generate bot ID
    const botId = generateBotId(extractedDetails.clientName, extractedDetails.projectName);
    
    projectConfig = cachedGeneration?.projectConfig || {
      clientName: extractedDetails.clientName,
      projectName: extractedDetails.projectName,
      projectType: extractedDetails.projectType,
      description: extractedDetails.botPurpose,
      referenceFiles: [],
      targetCompany: extractedDetails.targetCompany,
      brandAssets: brandAssets || undefined,
    };
    
    if (cachedGeneration?.result) {
      // Resume from cached generation — skip the expensive AI generation step
      console.log('[InstantBuild] Resuming with cached generation result (skipping CSV generation)');
      generationResult = cachedGeneration.result;
      onProgress?.({
        step: 'validating',
        message: 'Resuming from cached generation...',
        progress: 35,
        details: `Using previously generated ${generationResult.nodeCount} nodes`
      });
    } else {
      // Step 1: Generate CSV
      onProgress?.({
        step: 'generating',
        message: 'Generating bot solution...',
        progress: 20,
        details: `Creating ${extractedDetails.projectName} for ${extractedDetails.targetCompany || 'client'}`
      });
      
      const genStart = performance.now();
      generationResult = await generateBotCSV(projectConfig!, [], [], aiCredentials);
      timeStep('1_csv_generation', genStart);
    }
    
    if (!generationResult || !generationResult.csv) {
      throw new Error('Failed to generate bot CSV');
    }
    
    // Step 2: Validate and refine
    onProgress?.({
      step: 'validating',
      message: 'Validating with Bot Manager...',
      progress: 40,
      details: `Checking ${generationResult.nodeCount} nodes`
    });
    
    const valStart = performance.now();
    const validationResult = await validateAndRefineIteratively(
      generationResult.csv,
      botId,
      token,
      projectConfig,
      (update) => {
        onProgress?.({
          step: 'validating',
          message: `Validation: ${update.message}`,
          progress: 40 + (update.iteration * 5),
          details: update.errors?.slice(0, 2).join(', ')
        });
      },
      5 // max iterations
    );
    timeStep('2_validation_refinement', valStart);
    
    if (!validationResult.valid && validationResult.remainingErrors.length > 0) {
      // Continue anyway - deploy with warnings
      console.warn('[InstantBuild] Validation has remaining errors:', validationResult.remainingErrors);
    }
    
    const finalCSV = validationResult.csv;
    const stats = parseCSVStats(finalCSV);
    
    // Step 3: Detect and fetch required action node scripts
    onProgress?.({
      step: 'deploying',
      message: 'Preparing deployment...',
      progress: 55,
      details: 'Detecting required scripts'
    });
    
    const scriptDetectStart = performance.now();
    const detectedScriptNames = detectActionNodeScripts(finalCSV);
    console.log('[InstantBuild] Detected action node scripts:', detectedScriptNames);
    
    // Fetch scripts from Supabase
    const fetchedScripts = await fetchRequiredScripts(detectedScriptNames, onProgress);
    timeStep('3_script_detection_fetch', scriptDetectStart);
    
    // Combine with any custom scripts from generation
    const allScripts = [
      ...fetchedScripts,
      ...(generationResult.customScripts || [])
    ];
    
    // Step 4: Deploy to sandbox
    onProgress?.({
      step: 'deploying',
      message: 'Deploying to sandbox...',
      progress: 60,
      details: `${botId} (${allScripts.length} scripts)`
    });
    
    const deployStart = performance.now();
    const deployResult = await oneClickDeploy(
      finalCSV,
      botId,
      'sandbox',
      token,
      allScripts
    );
    timeStep('4_deploy', deployStart);
    
    // Check both success and deployed flags - server returns success:true even for failed deploys
    // The 'deployed' field correctly reflects actual deployment status
    if (!deployResult.success || (deployResult.deployed === false)) {
      if (deployResult.authError) {
        throw new Error('API token is invalid or expired. Please update your Pypestream API key.');
      }
      // Extract failed rows for debugging
      const failedRows = extractFailedRows(deployResult.errors || [], finalCSV);
      const errorMsg = deployResult.deployResult?.error?.messages?.[0] 
        || deployResult.deployResult?.error?.errors
        || deployResult.message 
        || 'Deployment failed';
      const error = new Error(errorMsg);
      (error as any).failedRows = failedRows;
      (error as any).csv = finalCSV;
      throw error;
    }
    
    // Step 5: Create channel/widget for testing
    onProgress?.({
      step: 'deploying',
      message: 'Creating test widget...',
      progress: 70,
      details: 'Setting up channel and widget'
    });
    
    let widgetUrl = deployResult.previewUrl;
    let widgetId: string | undefined;
    
    const widgetStart = performance.now();
    try {
      const widgetResult = await createChannelWithWidget(
        botId,
        'sandbox',
        token,
        {
          widgetName: `${extractedDetails.projectName} Widget`,
          // Pass full brand assets (colors, logos, fonts, images) for comprehensive CSS generation
          brandAssets: brandAssets || undefined,
          targetCompany: extractedDetails.targetCompany,
        }
      );
      
      if (widgetResult.success && widgetResult.widgetUrl) {
        widgetUrl = widgetResult.widgetUrl;
        widgetId = widgetResult.widgetId;
        console.log(`[InstantBuild] Widget created: ${widgetUrl}`);
      } else {
        console.warn('[InstantBuild] Widget creation returned:', widgetResult.error);
      }
    } catch (widgetError) {
      console.warn('[InstantBuild] Widget creation failed (non-blocking):', widgetError);
      // Continue with fallback preview URL
    }
    timeStep('5_widget_creation', widgetStart);
    
    // Step 6: Export to Google Sheets
    onProgress?.({
      step: 'exporting',
      message: 'Exporting to Google Sheets...',
      progress: 80,
      details: `${extractedDetails.projectName}.csv`
    });
    
    let sheetsResult: { success: boolean; spreadsheetUrl?: string; spreadsheetId?: string } = { 
      success: false, 
      spreadsheetUrl: undefined, 
      spreadsheetId: undefined 
    };
    const sheetsStart = performance.now();
    try {
      sheetsResult = await exportToGoogleSheets(
        finalCSV,
        `${extractedDetails.clientName}_${extractedDetails.projectName}`,
        userId
      );
    } catch (sheetsError) {
      console.warn('[InstantBuild] Sheets export failed (non-blocking):', sheetsError);
    }
    timeStep('6_sheets_export', sheetsStart);
    
    // Done — log full timing summary
    const totalMs = Math.round(performance.now() - pipelineStart);
    timings['TOTAL'] = totalMs;
    console.log(`[⏱ Pipeline Complete] Total: ${(totalMs / 1000).toFixed(2)}s`);
    console.log('[⏱ Timing Summary]', JSON.stringify(timings, null, 2));
    console.table(Object.entries(timings).map(([step, ms]) => ({
      Step: step,
      Duration: `${(ms / 1000).toFixed(2)}s`,
      '% of Total': `${((ms / totalMs) * 100).toFixed(1)}%`
    })));
    
    onProgress?.({
      step: 'done',
      message: 'Solution ready!',
      progress: 100,
    });
    
    return {
      success: true,
      widgetUrl: widgetUrl,
      widgetId: widgetId,
      sheetsUrl: sheetsResult.spreadsheetUrl,
      spreadsheetId: sheetsResult.spreadsheetId,
      nodeCount: stats.totalNodes,
      botId,
      versionId: deployResult.versionId,
      csv: finalCSV,
      // Include all scripts (fetched + AI-generated custom) for editing in EditorPage
      scripts: allScripts,
    };
    
  } catch (error: any) {
    console.error('[InstantBuild] Pipeline error:', error);
    
    onProgress?.({
      step: 'error',
      message: error.message || 'Build failed',
      progress: 0,
    });
    
    // If we have a generation result, cache it so retry can skip regeneration
    const cachedGen = (typeof generationResult !== 'undefined' && generationResult?.csv)
      ? { result: generationResult, projectConfig }
      : undefined;
    
    // Extract failed rows from the error object
    const failedRows: FailedRow[] = error.failedRows || [];
    const errorCsv = error.csv || (typeof generationResult !== 'undefined' ? generationResult.csv : '');
    
    return {
      success: false,
      error: error.message || 'Build failed',
      nodeCount: 0,
      botId: '',
      _cachedGeneration: cachedGen,
      csv: errorCsv,
      failedRows: failedRows.length > 0 ? failedRows : undefined,
    };
  }
}
