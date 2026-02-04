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

import type { ExtractedDetails, InstantBuildResult, BrandAssets, ProjectConfig, FailedRow, HealthCheckResult } from '../types';
import { generateBotCSV, validateAndRefineIteratively, parseCSVStats, type GenerationResult, type GenerationOptions, type SequentialProgress } from './generation';
import { oneClickDeploy, generateBotId, createChannelWithWidget } from './botmanager';
import { exportToGoogleSheets } from './composio';
import { fetchScripts } from './action-scripts-api';
import { 
  STARTUP_SCRIPTS, 
  CRITICAL_STARTUP_SCRIPTS, 
  getBundledScript, 
  validateCriticalScripts,
  logScriptRegistry
} from '../data/startup-scripts';

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

/**
 * Flow status in sequential generation
 */
export interface FlowProgressItem {
  name: string;
  description?: string;
  status: 'pending' | 'active' | 'done' | 'error';
  startNode?: number;
  nodeCount?: number;  // Number of nodes generated for this flow
  error?: string;  // Error message when status is 'error'
}

/**
 * Sequential generation progress for flowchart visualization
 */
export interface SequentialProgressState {
  phase: 'planning' | 'startup' | 'flow' | 'assembly' | 'validation';
  status: 'pending' | 'active' | 'done' | 'error';
  flows: FlowProgressItem[];
  currentFlowIndex?: number;
  totalFlows?: number;
}

export interface InstantBuildProgress {
  step: 'extracting' | 'branding' | 'generating' | 'validating' | 'deploying' | 'exporting' | 'done' | 'error';
  message: string;
  progress: number; // 0-100
  details?: string;
  // Timing data for elapsed time display
  stepStartedAt?: number;      // performance.now() when current step started
  pipelineStartedAt?: number;  // performance.now() when pipeline started
  // Node count for progress display
  nodeCount?: number;
  // Sequential generation details for flowchart visualization
  sequentialProgress?: SequentialProgressState;
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
 * Required startup scripts derived from the bundled script registry.
 * These are used by the startup node templates and are critical for bot operation.
 * If missing, the bot will crash immediately with "technical difficulties".
 * 
 * NOTE: These scripts are now BUNDLED with the app, so they're never truly "missing".
 */
const REQUIRED_STARTUP_SCRIPT_NAMES = CRITICAL_STARTUP_SCRIPTS.map(s => s.name);

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
  
  // CRITICAL: Always include required startup scripts regardless of CSV detection
  // These are BUNDLED with the app and essential for bot operation
  for (const scriptName of REQUIRED_STARTUP_SCRIPT_NAMES) {
    if (!scripts.has(scriptName)) {
      console.log(`[InstantBuild] Adding required startup script (bundled): ${scriptName}`);
      scripts.add(scriptName);
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
 * Fetch required action node scripts - BUNDLED FIRST, then Supabase fallback.
 * 
 * This is the HARDENED version that guarantees critical scripts are always available:
 * 1. Check bundled scripts first (compiled into the app - never missing)
 * 2. Fall back to Supabase for non-bundled scripts
 * 3. FAIL FAST if any critical script is missing after both sources
 */
async function fetchRequiredScripts(
  scriptNames: string[],
  onProgress?: ProgressCallback
): Promise<{ name: string; content: string }[]> {
  if (scriptNames.length === 0) return [];
  
  console.log('[InstantBuild] Scripts to fetch:', scriptNames);
  
  // Log bundled script registry on first call
  logScriptRegistry();
  
  // Validate that all critical scripts are bundled (should always pass)
  const criticalValidation = validateCriticalScripts();
  if (!criticalValidation.valid) {
    console.error('[InstantBuild] ⚠️ CRITICAL: Bundled scripts corrupted:', criticalValidation.missing);
    throw new Error(`Critical scripts corrupted in bundle: ${criticalValidation.missing.join(', ')}`);
  }
  
  onProgress?.({
    step: 'deploying',
    message: `Loading ${scriptNames.length} action node script(s)...`,
    progress: 55,
    details: scriptNames.join(', ')
  });
  
  const scripts: { name: string; content: string }[] = [];
  const needFromSupabase: string[] = [];
  const missing: string[] = [];
  
  // Step 1: Get scripts from bundled registry first
  for (const name of scriptNames) {
    const bundled = getBundledScript(name);
    if (bundled) {
      scripts.push({ name: bundled.name, content: bundled.content });
      console.log(`[InstantBuild] ✅ Loaded bundled script: ${name}`);
    } else {
      needFromSupabase.push(name);
    }
  }
  
  // Step 2: Fetch remaining scripts from Supabase
  if (needFromSupabase.length > 0) {
    console.log(`[InstantBuild] Fetching ${needFromSupabase.length} scripts from Supabase:`, needFromSupabase);
    
    try {
      const scriptsMap = await fetchScripts(needFromSupabase);
      
      for (const name of needFromSupabase) {
        const script = scriptsMap.get(name);
        if (script && script.content) {
          scripts.push({ name: script.name, content: script.content });
          console.log(`[InstantBuild] ✅ Fetched from Supabase: ${name}`);
        } else {
          missing.push(name);
          console.warn(`[InstantBuild] ⚠️ Script not found in Supabase: ${name}`);
        }
      }
    } catch (supabaseError) {
      console.error('[InstantBuild] Supabase fetch failed:', supabaseError);
      // All non-bundled scripts are now missing
      missing.push(...needFromSupabase);
    }
  }
  
  // Step 3: Check if any CRITICAL scripts are missing
  const criticalScriptNames = CRITICAL_STARTUP_SCRIPTS.map(s => s.name);
  const missingCritical = scriptNames.filter(
    name => criticalScriptNames.includes(name) && missing.includes(name)
  );
  
  if (missingCritical.length > 0) {
    // This should NEVER happen since critical scripts are bundled
    console.error(`[InstantBuild] 🔥 FATAL: Missing critical scripts: ${missingCritical.join(', ')}`);
    throw new Error(`Missing critical startup scripts: ${missingCritical.join(', ')}. Bot cannot start.`);
  }
  
  // Log summary
  if (missing.length > 0) {
    console.warn(`[InstantBuild] ⚠️ Non-critical scripts missing (bot may have reduced functionality): ${missing.join(', ')}`);
  }
  
  console.log(`[InstantBuild] 📦 Scripts ready: ${scripts.length} loaded, ${missing.length} missing`);
  
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
  
  // Generate project name based on type - MUST include company name
  // Clean company name for use in project name (remove spaces, keep PascalCase)
  const companyPrefix = targetCompany
    ? targetCompany
        .replace(/\s+(Insurance|Company|Inc|LLC|Corp|Corporation)$/i, '') // Shorten common suffixes
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('')
        .replace(/[^a-zA-Z0-9]/g, '') // Remove special chars
    : '';
  
  let projectSuffix = 'Bot';
  if (projectType === 'claims') {
    if (lowerText.includes('water') || lowerText.includes('flood')) projectSuffix = 'ClaimsFNOL';
    else if (lowerText.includes('auto') || lowerText.includes('car')) projectSuffix = 'AutoClaimsMVP';
    else projectSuffix = 'ClaimsFNOL';
  } else if (projectType === 'support') {
    projectSuffix = 'SupportBot';
  } else if (projectType === 'sales') {
    projectSuffix = 'SalesBot';
  } else if (projectType === 'faq') {
    projectSuffix = 'FAQBot';
  }
  
  const projectName = companyPrefix ? `${companyPrefix}${projectSuffix}` : `ChatbotMVP`;
  
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
 * Pre-flight validation - runs BEFORE deployment to catch issues early.
 * This ensures all critical components are ready.
 */
export interface PreflightResult {
  ready: boolean;
  issues: string[];
  warnings: string[];
}

export function runPreflightChecks(token?: string): PreflightResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  console.log('[Preflight] Running pre-deployment checks...');
  
  // Check 1: Critical scripts are bundled
  const scriptValidation = validateCriticalScripts();
  if (!scriptValidation.valid) {
    issues.push(`Critical scripts missing from bundle: ${scriptValidation.missing.join(', ')}`);
  } else {
    console.log('[Preflight] ✅ Critical scripts bundled:', CRITICAL_STARTUP_SCRIPTS.map(s => s.name).join(', '));
  }
  
  // Check 2: API token is present
  if (!token) {
    issues.push('Bot Manager API token is missing');
  } else if (token.length < 20) {
    issues.push('Bot Manager API token appears invalid (too short)');
  } else {
    console.log('[Preflight] ✅ API token present');
  }
  
  // Check 3: Startup scripts registry
  const bundledScripts = STARTUP_SCRIPTS.length;
  const criticalScripts = CRITICAL_STARTUP_SCRIPTS.length;
  console.log(`[Preflight] ✅ Script registry: ${bundledScripts} total, ${criticalScripts} critical`);
  
  // Log result
  if (issues.length > 0) {
    console.error('[Preflight] ❌ Pre-flight checks FAILED:');
    issues.forEach(i => console.error(`  - ${i}`));
  } else {
    console.log('[Preflight] ✅ All pre-flight checks passed');
  }
  
  if (warnings.length > 0) {
    console.warn('[Preflight] ⚠️ Warnings:');
    warnings.forEach(w => console.warn(`  - ${w}`));
  }
  
  return {
    ready: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * Post-deployment health check - verifies the bot actually works.
 * 
 * Uses the Engagement API to:
 * 1. Create an anonymous session
 * 2. Start the chat
 * 3. Get the initial snapshot
 * 4. Verify no "technical difficulties" or immediate error messages
 */
export async function runPostDeploymentHealthCheck(
  widgetId: string,
  onProgress?: (msg: string) => void
): Promise<HealthCheckResult> {
  console.log('[HealthCheck] Starting post-deployment verification...');
  onProgress?.('Starting health check...');
  
  const ENGAGEMENT_API = 'https://engagement-api-sandbox.pypestream.com';
  
  try {
    // Step 1: Create anonymous session
    const deviceId = `health-check-${Date.now()}`;
    const sessionRes = await fetch(`${ENGAGEMENT_API}/messaging/v1/consumers/anonymous_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: widgetId,
        app_type: 'consumer',
        device_id: deviceId,
        device_type: 'web',
        platform: 'Mac OS X',
        browser_language: 'en-US',
        referring_site: 'https://health-check.pypestream.com',
        user_browser: 'Health Check'
      })
    });
    
    if (!sessionRes.ok) {
      console.warn('[HealthCheck] Failed to create session:', sessionRes.status);
      return { healthy: false, errorDetected: true, errorType: 'unknown', details: `Session creation failed: ${sessionRes.status}` };
    }
    
    const session = await sessionRes.json();
    const { chat_id, id: userId, access_token, web_chat_pype_id, web_chat_stream_id } = session;
    
    console.log('[HealthCheck] Session created:', chat_id);
    onProgress?.('Session created, starting chat...');
    
    // Step 2: Start the chat
    const startRes = await fetch(`${ENGAGEMENT_API}/messaging/v1/chats/${chat_id}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
      body: JSON.stringify({
        app_id: widgetId,
        consumer: `consumer_${userId}`,
        gateway: 'pypestream_widget',
        pype_id: web_chat_pype_id,
        stream_id: web_chat_stream_id,
        user_id: userId,
        version: '1'
      })
    });
    
    if (!startRes.ok) {
      console.warn('[HealthCheck] Failed to start chat:', startRes.status);
      return { healthy: false, errorDetected: true, errorType: 'unknown', details: `Chat start failed: ${startRes.status}` };
    }
    
    // Wait for bot to process initial flow
    await new Promise(resolve => setTimeout(resolve, 2000));
    onProgress?.('Waiting for bot response...');
    
    // Step 3: Get snapshot of messages
    const snapshotRes = await fetch(`${ENGAGEMENT_API}/messaging/v1/chats/${chat_id}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
      body: JSON.stringify({})
    });
    
    if (!snapshotRes.ok) {
      console.warn('[HealthCheck] Failed to get snapshot:', snapshotRes.status);
      // This often indicates the bot crashed
      return { healthy: false, errorDetected: true, errorType: 'technical_difficulties', details: `Snapshot failed: ${snapshotRes.status} - bot may have crashed` };
    }
    
    const snapshot = await snapshotRes.json();
    
    // Step 4: Analyze messages for errors
    const messages = snapshot?.result?.messages || [];
    const botMessages = messages.filter((m: any) => m.side === 'bot' || m.type === 'bot');
    
    console.log('[HealthCheck] Bot messages:', botMessages.length);
    
    // Check for error patterns in messages
    const errorPatterns = [
      { pattern: /technical difficulties/i, type: 'technical_difficulties' as const },
      { pattern: /no agents available/i, type: 'no_agents' as const },
      { pattern: /something went wrong/i, type: 'technical_difficulties' as const },
      { pattern: /transfer.*live agent/i, type: 'technical_difficulties' as const },
      { pattern: /conversation has ended/i, type: 'technical_difficulties' as const },
    ];
    
    for (const msg of botMessages) {
      const text = msg.msg || msg.message || msg.text || '';
      for (const { pattern, type } of errorPatterns) {
        if (pattern.test(text)) {
          console.error(`[HealthCheck] ❌ Error detected in bot response: "${text.substring(0, 100)}..."`);
          return {
            healthy: false,
            firstMessage: text,
            errorDetected: true,
            errorType: type,
            details: `Bot immediately showed error: ${text.substring(0, 200)}`
          };
        }
      }
    }
    
    // Step 5: End the chat (cleanup)
    try {
      await fetch(`${ENGAGEMENT_API}/messaging/v1/chats/${chat_id}/end`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
    } catch (e) {
      // Non-blocking
    }
    
    const firstBotMessage = botMessages[0]?.msg || botMessages[0]?.message || '';
    console.log('[HealthCheck] ✅ Bot appears healthy. First message:', firstBotMessage.substring(0, 100));
    
    return {
      healthy: true,
      firstMessage: firstBotMessage,
      errorDetected: false,
      details: `Bot responded correctly with ${botMessages.length} message(s)`
    };
    
  } catch (error: any) {
    console.error('[HealthCheck] Exception:', error);
    return {
      healthy: false,
      errorDetected: true,
      errorType: 'unknown',
      details: `Health check exception: ${error.message}`
    };
  }
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
    // Step 0: Pre-flight validation - fail fast if critical components are missing
    const preflightStart = performance.now();
    onProgress?.({
      step: 'generating',
      message: 'Running pre-flight checks...',
      progress: 5,
      details: 'Validating critical components',
      pipelineStartedAt: pipelineStart,
      stepStartedAt: preflightStart
    });
    
    const preflight = runPreflightChecks(token);
    if (!preflight.ready) {
      throw new Error(`Pre-flight checks failed: ${preflight.issues.join('; ')}`);
    }
    
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
    
    // Track flows for flowchart visualization
    let flowsState: FlowProgressItem[] = [];
    let currentPhase: SequentialProgressState['phase'] = 'planning';
    
    if (cachedGeneration?.result) {
      // Resume from cached generation — skip the expensive AI generation step
      console.log('[InstantBuild] Resuming with cached generation result (skipping CSV generation)');
      generationResult = cachedGeneration.result;
      
      // Reconstruct flowsState from the cached generation for visualization
      // Parse the CSV to extract flow names from node names (flows start at node 300+)
      const csvLines = generationResult.csv.split('\n');
      const flowNames = new Set<string>();
      for (const line of csvLines.slice(1)) { // Skip header
        const nodeNumMatch = line.match(/^"?(\d+)"?,/);
        if (nodeNumMatch) {
          const nodeNum = parseInt(nodeNumMatch[1], 10);
          if (nodeNum >= 300 && nodeNum < 99990) {
            // Extract flow name from node name (format: "FlowName → Step")
            const nameMatch = line.match(/^"?\d+"?,"?[AD]"?,"?([^"→]+)/);
            if (nameMatch && nameMatch[1]) {
              const flowPart = nameMatch[1].trim().split(' ')[0];
              if (flowPart && flowPart.length > 2 && !['Main', 'Menu', 'Error', 'End'].includes(flowPart)) {
                flowNames.add(flowPart);
              }
            }
          }
        }
      }
      
      // Create flow items from detected flows
      flowsState = Array.from(flowNames).slice(0, 6).map(name => ({
        name: name.replace(/([A-Z])/g, ' $1').trim(), // CamelCase to spaces
        status: 'done' as const
      }));
      
      // If no flows detected, add a generic one
      if (flowsState.length === 0) {
        flowsState = [{ name: 'Conversation Flow', status: 'done' }];
      }
      
      console.log('[InstantBuild] Reconstructed flows for visualization:', flowsState.map(f => f.name));
      
      onProgress?.({
        step: 'validating',
        message: 'Resuming from cached generation...',
        progress: 35,
        details: `Using previously generated ${generationResult.nodeCount} nodes`,
        pipelineStartedAt: pipelineStart,
        stepStartedAt: performance.now(),
        sequentialProgress: {
          phase: 'validation',
          status: 'active',
          flows: flowsState,
          totalFlows: flowsState.length
        }
      });
    } else {
      // Step 1: Generate CSV
      const genStart = performance.now();
      onProgress?.({
        step: 'generating',
        message: 'Generating bot solution...',
        progress: 10,
        details: `Creating ${extractedDetails.projectName} for ${extractedDetails.targetCompany || 'client'}`,
        pipelineStartedAt: pipelineStart,
        stepStartedAt: genStart,
        sequentialProgress: {
          phase: 'planning',
          status: 'active',
          flows: [],
          totalFlows: 0
        }
      });
      
      generationResult = await generateBotCSV(projectConfig!, [], [], aiCredentials, {
        onProgress: (seqProgress) => {
          // Map sequential progress to flowchart state
          currentPhase = seqProgress.step;
          
          // Update flows state based on progress
          if (seqProgress.step === 'planning' && seqProgress.status === 'done' && seqProgress.totalFlows) {
            // Initialize flows as pending after planning completes
            // Flows will be populated when each flow starts
            flowsState = [];
          }
          
          if (seqProgress.step === 'flow') {
            const flowName = seqProgress.flowName || `Flow ${seqProgress.currentFlow}`;
            const flowIndex = (seqProgress.currentFlow || 1) - 1;
            
            if (seqProgress.status === 'started') {
              // Add or update flow as active
              if (flowIndex >= flowsState.length) {
                flowsState.push({
                  name: flowName,
                  status: 'active'
                });
              } else {
                flowsState[flowIndex] = { ...flowsState[flowIndex], name: flowName, status: 'active' };
              }
            } else if (seqProgress.status === 'done') {
              // Mark flow as done with node count
              if (flowsState[flowIndex]) {
                flowsState[flowIndex].status = 'done';
                // Capture the node count from the rows property
                if (seqProgress.rows) {
                  flowsState[flowIndex].nodeCount = seqProgress.rows;
                }
              }
            } else if (seqProgress.status === 'error') {
              if (flowsState[flowIndex]) {
                flowsState[flowIndex].status = 'error';
                // Capture error message for tooltip display
                flowsState[flowIndex].error = seqProgress.message || 'Flow generation failed';
              }
            }
          }
          
          // Calculate progress based on phase
          let progress = 10;
          let message = 'Generating...';
          
          switch (seqProgress.step) {
            case 'planning':
              progress = seqProgress.status === 'done' ? 15 : 12;
              message = seqProgress.status === 'done' 
                ? `Planned ${seqProgress.totalFlows} conversation flows`
                : 'Planning conversation flows...';
              break;
            case 'startup':
              progress = seqProgress.status === 'done' ? 18 : 16;
              message = seqProgress.status === 'done'
                ? 'System nodes ready'
                : 'Generating system nodes...';
              break;
            case 'flow':
              const flowNum = seqProgress.currentFlow || 1;
              const totalFlows = seqProgress.totalFlows || 1;
              // Flows take from 18% to 32% (14% total, divided by number of flows)
              progress = 18 + Math.round((flowNum / totalFlows) * 14);
              message = seqProgress.status === 'done'
                ? `Generated ${seqProgress.flowName}`
                : `Generating ${seqProgress.flowName}...`;
              break;
            case 'assembly':
              progress = seqProgress.status === 'done' ? 35 : 33;
              message = seqProgress.status === 'done'
                ? 'Assembly complete'
                : 'Assembling solution...';
              break;
            case 'validation':
              progress = 35;
              message = 'Generation complete';
              break;
          }
          
          // Emit progress update with flowchart state
          onProgress?.({
            step: 'generating',
            message,
            progress,
            details: seqProgress.flowName || seqProgress.step,
            pipelineStartedAt: pipelineStart,
            stepStartedAt: genStart,
            sequentialProgress: {
              phase: seqProgress.step,
              status: seqProgress.status === 'started' ? 'active' : seqProgress.status === 'done' ? 'done' : seqProgress.status,
              flows: [...flowsState],
              currentFlowIndex: seqProgress.currentFlow ? seqProgress.currentFlow - 1 : undefined,
              totalFlows: seqProgress.totalFlows
            }
          });
        }
      });
      timeStep('1_csv_generation', genStart);
    }
    
    if (!generationResult || !generationResult.csv) {
      throw new Error('Failed to generate bot CSV');
    }
    
    // Capture final flowchart state after generation for use during validation/deploy
    const finalFlowchartState: SequentialProgressState = {
      phase: 'validation',
      status: 'done',
      flows: [...flowsState],
      totalFlows: flowsState.length
    };
    
    // Step 2: Validate and refine
    const valStart = performance.now();
    onProgress?.({
      step: 'validating',
      message: 'Validating with Bot Manager...',
      progress: 40,
      details: `Checking ${generationResult.nodeCount} nodes`,
      nodeCount: generationResult.nodeCount,
      pipelineStartedAt: pipelineStart,
      stepStartedAt: valStart,
      sequentialProgress: finalFlowchartState
    });
    
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
          details: update.errors?.slice(0, 2).join(', '),
          nodeCount: generationResult?.nodeCount || 0,
          pipelineStartedAt: pipelineStart,
          stepStartedAt: valStart,
          sequentialProgress: finalFlowchartState
        });
      },
      5 // max iterations
    );
    timeStep('2_validation_refinement', valStart);
    
    if (!validationResult.valid && validationResult.remainingErrors.length > 0) {
      // Continue anyway - deploy with warnings
      console.warn('[InstantBuild] Validation has remaining errors:', validationResult.remainingErrors);
    }
    
    // Use validated CSV directly (UX review removed - users can run manually from Results page if needed)
    const finalCSV = validationResult.csv;
    const stats = parseCSVStats(finalCSV);
    
    // Step 5: Detect and fetch required action node scripts
    const scriptDetectStart = performance.now();
    onProgress?.({
      step: 'deploying',
      message: 'Preparing deployment...',
      progress: 55,
      details: 'Detecting required scripts',
      pipelineStartedAt: pipelineStart,
      stepStartedAt: scriptDetectStart,
      sequentialProgress: finalFlowchartState
    });
    const detectedScriptNames = detectActionNodeScripts(finalCSV);
    console.log('[InstantBuild] Detected action node scripts:', detectedScriptNames);
    
    // Fetch scripts from Supabase
    const fetchedScripts = await fetchRequiredScripts(detectedScriptNames, onProgress);
    timeStep('4_script_detection_fetch', scriptDetectStart);
    
    // Combine with any custom scripts from generation
    const allScripts = [
      ...fetchedScripts,
      ...(generationResult.customScripts || [])
    ];
    
    // Step 6: Deploy to sandbox
    const deployStart = performance.now();
    onProgress?.({
      step: 'deploying',
      message: 'Deploying to sandbox...',
      progress: 60,
      details: `${botId} (${allScripts.length} scripts)`,
      pipelineStartedAt: pipelineStart,
      stepStartedAt: deployStart,
      sequentialProgress: finalFlowchartState
    });
    const deployResult = await oneClickDeploy(
      finalCSV,
      botId,
      'sandbox',
      token,
      allScripts
    );
    timeStep('5_deploy', deployStart);
    
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
    
    // Step 7: Create channel/widget for testing
    const widgetStart = performance.now();
    onProgress?.({
      step: 'deploying',
      message: 'Creating test widget...',
      progress: 70,
      details: 'Setting up channel and widget',
      pipelineStartedAt: pipelineStart,
      stepStartedAt: widgetStart,
      sequentialProgress: finalFlowchartState
    });
    
    let widgetUrl = deployResult.previewUrl;
    let widgetId: string | undefined;
    
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
    timeStep('6_widget_creation', widgetStart);
    
    // Step 7b: Post-deployment health check (non-blocking but logged)
    let healthCheckResult: HealthCheckResult | undefined;
    if (widgetId) {
      const healthStart = performance.now();
      onProgress?.({
        step: 'deploying',
        message: 'Verifying bot health...',
        progress: 75,
        details: 'Running post-deployment health check',
        pipelineStartedAt: pipelineStart,
        stepStartedAt: healthStart,
        sequentialProgress: finalFlowchartState
      });
      
      try {
        healthCheckResult = await runPostDeploymentHealthCheck(
          widgetId,
          (msg) => onProgress?.({ 
            step: 'deploying', 
            message: msg, 
            progress: 75,
            pipelineStartedAt: pipelineStart,
            stepStartedAt: healthStart,
            sequentialProgress: finalFlowchartState
          })
        );
        
        if (!healthCheckResult.healthy) {
          console.error('[InstantBuild] ⚠️ HEALTH CHECK FAILED:', healthCheckResult.details);
          console.error('[InstantBuild] Error type:', healthCheckResult.errorType);
          console.error('[InstantBuild] First message:', healthCheckResult.firstMessage);
          
          // Add warning to progress but don't fail the pipeline
          onProgress?.({
            step: 'deploying',
            message: `⚠️ Health check warning: ${healthCheckResult.errorType}`,
            progress: 76,
            details: healthCheckResult.details,
            pipelineStartedAt: pipelineStart,
            stepStartedAt: healthStart,
            sequentialProgress: finalFlowchartState
          });
        } else {
          console.log('[InstantBuild] ✅ Health check passed:', healthCheckResult.details);
        }
      } catch (healthError) {
        console.warn('[InstantBuild] Health check failed (non-blocking):', healthError);
      }
      timeStep('5b_health_check', healthStart);
    } else {
      console.warn('[InstantBuild] Skipping health check - no widget ID');
    }
    
    // Step 8: Export to Google Sheets
    const sheetsStart = performance.now();
    onProgress?.({
      step: 'exporting',
      message: 'Exporting to Google Sheets...',
      progress: 80,
      details: `${extractedDetails.projectName}.csv`,
      pipelineStartedAt: pipelineStart,
      stepStartedAt: sheetsStart,
      sequentialProgress: finalFlowchartState
    });
    
    let sheetsResult: { success: boolean; spreadsheetUrl?: string; spreadsheetId?: string } = { 
      success: false, 
      spreadsheetUrl: undefined, 
      spreadsheetId: undefined 
    };
    try {
      sheetsResult = await exportToGoogleSheets(
        finalCSV,
        `${extractedDetails.clientName}_${extractedDetails.projectName}`,
        userId
      );
    } catch (sheetsError) {
      console.warn('[InstantBuild] Sheets export failed (non-blocking):', sheetsError);
    }
    timeStep('7_sheets_export', sheetsStart);
    
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
      pipelineStartedAt: pipelineStart,
      stepStartedAt: performance.now(),
      sequentialProgress: finalFlowchartState
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
      // Health check result - warnings about bot status
      healthCheck: healthCheckResult,
    };
    
  } catch (error: any) {
    console.error('[InstantBuild] Pipeline error:', error);
    
    onProgress?.({
      step: 'error',
      message: error.message || 'Build failed',
      progress: 0,
      pipelineStartedAt: pipelineStart,
      stepStartedAt: performance.now()
    });
    
    // If we have a generation result, cache it so retry can skip regeneration
    const cachedGen = (typeof generationResult !== 'undefined' && generationResult?.csv)
      ? { result: generationResult, projectConfig }
      : undefined;
    
    // Extract failed rows from the error object
    const failedRows: FailedRow[] = error.failedRows || [];
    const errorCsv = error.csv || (typeof generationResult !== 'undefined' ? generationResult.csv : '');
    
    // Calculate actual node count from CSV even on error
    let actualNodeCount = 0;
    if (errorCsv) {
      try {
        const stats = parseCSVStats(errorCsv);
        actualNodeCount = stats.totalNodes;
      } catch (e) {
        // Fallback: count rows
        actualNodeCount = errorCsv.split('\n').filter((line: string) => line.trim()).length - 1; // -1 for header
      }
    }
    
    return {
      success: false,
      error: error.message || 'Build failed',
      nodeCount: actualNodeCount,
      botId: '',
      _cachedGeneration: cachedGen,
      csv: errorCsv,
      failedRows: failedRows.length > 0 ? failedRows : undefined,
    };
  }
}
