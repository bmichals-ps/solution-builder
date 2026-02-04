/**
 * AI Generation Service
 * 
 * Calls the backend API to generate Pypestream bot CSVs using Claude AI
 */

import type { ProjectConfig, ClarifyingQuestion, FileUpload } from '../types';
import {
  logErrorPattern,
  logFixAttempt,
  getKnownFixes,
  normalizeError,
  formatKnownFixesForPrompt,
  type ValidationError,
  type FixAttempt,
} from './error-learning';

export interface CustomScript {
  name: string;
  content: string;
}

export interface GenerationResult {
  csv: string;
  nodeCount: number;
  officialNodesUsed: string[];
  customScripts: CustomScript[];
  warnings: string[];
  readme: string;
  // For reconstructing result from saved solution
  scripts?: { name: string; content: string }[];
  validation?: { valid: boolean; errors: string[] };
}

export interface GenerationError {
  error: string;
  details?: string;
}

/**
 * Rate limit error with retry information
 */
export class RateLimitError extends Error {
  constructor(message: string, public retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Authentication error - API key is invalid or expired
 */
export class AuthError extends Error {
  constructor(message: string = 'API token is invalid or expired') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Pre-deploy validation result
 */
export interface PreDeployValidation {
  valid: boolean;
  errors: {
    nodeNum: number;
    field: string;
    error: string;
    value: string;
    autoFixable: boolean;
  }[];
  fixedCsv?: string;
}

/**
 * Official action nodes that are available in the Pypestream system
 * These don't need to be uploaded - they're built-in or already available
 */
export const SYSTEM_ACTION_NODES = new Set([
  // Sys* nodes - built into the platform, no script needed
  'SysAssignVariable',
  'SysMultiMatchRouting', 
  'SysShowMetadata',
  'SysSetEnv',
  'SysVariableReset',
]);

/**
 * Official action node scripts available in Official-Action-Nodes folder
 */
export const OFFICIAL_ACTION_NODE_SCRIPTS = new Set([
  'AgentTimeCheck', 'AppendValue', 'AppendValueEnd', 'AssignVariable', 'AWSDetectLanguage',
  'AWSPhoneValidate', 'AWSTranslate', 'BackOrProceed', 'CapVariable', 'CheckIfGlobalVarsEqual',
  'CheckLastURL', 'CheckTranscriptEngaged', 'CheckTranscriptEscalation', 'CompileDisclaimerText',
  'CompileSummaryMessage', 'ConcatenateStrings', 'CountryListpicker', 'CreateContactCenterSession',
  'CreateMapLink', 'DateTimeRouting', 'DecodeGlobalVariables', 'DialogflowESChitChatNLU',
  'DialogflowNLU', 'DocumentAIOCR', 'DovetailChitChat', 'DovetailLookup', 'DynamicRouting',
  'EncodeForComparison', 'EncodeGalleryContents', 'EncodeGlobalVariables', 'EncodeText',
  'FailCountCheck', 'FeedbackToSheets', 'FormatPhone', 'FormatTimestamp', 'GenerateCalendarLinks',
  'GenerateDateSelection', 'GenerateImage', 'GenerateRandomCode', 'GenerateTimeSelection',
  'GenAIFallback',  // AI-powered intent understanding for intelligent NLU fallback
  'GetAddressFromForm', 'GetAgentStatus', 'GetAgentWaitTime', 'GetBodyParts', 'GetBodyPartsBack',
  'GetCurrentDateTime', 'GetDataFromFile', 'GetDetailsFromZip', 'GetDialogflowIntent',
  'GetDistance', 'GetEvents', 'GetEventsDates', 'GetFirstUserMessage', 'GetGeminiCompletionContext',
  'GetGeminiCompletionContextFile', 'GetGeminiCompletionSimple', 'GetGeminiCompletionVideo',
  'GetGeneratorSelection', 'GetGPTCompletion', 'GetInternetSpeed', 'GetNLUIntent',
  'GetPaLMCompletion', 'GetParamFromEnv', 'GetResourceMetrics', 'GetSessionID', 'GetSliderValues',
  'GetTimeSelection', 'GetTimeZoneInfo', 'GetURLParams', 'GetWeather', 'GoBack', 'GoogleCloudOCR',
  'GoogleTranslate', 'GoogleZipCodeSearch', 'InputEscape', 'IntentionalError', 'IntentionalException',
  'LimitCounter', 'ListPickerGenerator', 'Lowercase', 'MakeAPICall', 'MaskSensitiveInfo',
  'MatchRouting', 'MathOperation', 'MedicareCardOCR', 'MultiMatchRouting', 'MultiMatchRoutingContains',
  'NearbySearch', 'NodeReturn', 'ParseFullName', 'ParseGeminiJSONResponse', 'PassportLicenseOCR',
  'PDFDocumentOCR', 'PostEventToBQ', 'ProcessSelectedLPValue2', 'RangeSliderSetup', 'ReadFromBQ',
  'ReformatTranscript', 'RegExFindAndReplace', 'ReturnToFlow', 'SalesforceAgentAvailCheck',
  'SalesforcePrechatDetails', 'SaveNode', 'ScaleWebviewHeight', 'ScheduleTwilioMessage',
  'SearchNearbyLocations', 'SelectAddressSuggestion', 'SelectedItem', 'SelectedItemRouting',
  'SelectionDestinations', 'SelectionGenerator', 'SendEmail', 'SendEmailWithFile', 'SendTwilioMessage',
  'SendTwilioMessageWhatsApp', 'SetCarousel', 'SetDateFormat', 'SetPersistentMenu', 'SetVar',
  'ShortenLink', 'ShowMetadata', 'SliderSetup', 'SpellCheck', 'StarRatingSetup', 'StoreInfo',
  'TitleFormat', 'UploadImageGCS', 'UploadJSONToS3', 'URLEncode', 'UserPlatformRouting',
  'ValidateAddress', 'ValidateDate', 'ValidatePhoneAndReturnStripped', 'ValidateRegex',
  'VarCheck', 'VariableReset', 'VerifyGPS',
]);

/**
 * Registry of action script output values
 * Maps script names to their possible Decision Variable return values.
 * Used to validate that What Next routing covers all possible outcomes.
 * 
 * CRITICAL: If a What Next is missing a route for any of these values,
 * the bot will fail with an unhandled routing error.
 */
export const SCRIPT_OUTPUTS: Record<string, string[]> = {
  // Startup & Platform
  'UserPlatformRouting': ['ios', 'android', 'mac', 'windows', 'other', 'error'],
  'SysShowMetadata': ['true', 'error'],
  'SysSetEnv': ['true', 'error'],
  
  // Variable Operations
  'SysAssignVariable': ['true', 'error'],
  'SetVar': ['true', 'false', 'error'],
  'AssignVariable': ['true', 'false', 'error'],
  'SysVariableReset': ['true', 'error'],
  
  // Routing & Matching
  'SysMultiMatchRouting': ['false', 'error'], // 'false' for no match, other values are dynamic
  'MatchRouting': ['true', 'false', 'error'],
  'MultiMatchRouting': ['false', 'error'], // matches are dynamic, false/error are standard
  'VarCheck': ['true', 'false', 'error'],
  
  // Validation
  'ValidateRegex': ['true', 'false', 'error'],
  'ValidateDate': ['true', 'false', 'error'],
  'ValidateAddress': ['true', 'false', 'error'],
  'ValidatePhoneAndReturnStripped': ['true', 'false', 'error'],
  
  // Error Handling
  'HandleBotError': ['bot_error', 'bot_timeout', 'other'],
  
  // AI/NLU
  'GenAIFallback': ['understood', 'route_flow', 'not_understood', 'error'],
  'GetGPTCompletion': ['true', 'false', 'error'],
  'GetGeminiCompletionSimple': ['true', 'false', 'error'],
  
  // Common utilities
  'LimitCounter': ['stop', 'continue', 'error'],
  'FailCountCheck': ['stop', 'continue', 'error'],
  'GetValue': ['true', 'false', 'error'],
  'BotToPlatform': ['true', 'false', 'error'],
};

/**
 * Result of script detection
 */
export interface ScriptDetectionResult {
  requiredScripts: string[];           // All scripts used in the CSV
  officialScripts: string[];           // Scripts from Official-Action-Nodes (can auto-upload)
  customScripts: string[];             // Scripts that need manual upload
  missingScripts: string[];            // ALL scripts that need uploading (official + custom)
  systemNodes: string[];               // Sys* nodes (built-in, no script needed)
}

/**
 * Detect which action node scripts are used in a CSV and categorize them
 */
export function detectRequiredScripts(csv: string): ScriptDetectionResult {
  const lines = csv.split('\n');
  const COMMAND_COL = 13;
  
  const usedCommands = new Set<string>();
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    const fields = parseCSVLineForFix(line);
    const nodeType = fields[1]?.trim().toUpperCase();
    const command = fields[COMMAND_COL]?.trim();
    
    if (nodeType === 'A' && command) {
      usedCommands.add(command);
    }
  }
  
  const requiredScripts: string[] = [];
  const officialScripts: string[] = [];
  const customScripts: string[] = [];
  const systemNodes: string[] = [];
  
  for (const cmd of usedCommands) {
    requiredScripts.push(cmd);
    
    if (SYSTEM_ACTION_NODES.has(cmd)) {
      systemNodes.push(cmd);
    } else if (OFFICIAL_ACTION_NODE_SCRIPTS.has(cmd)) {
      officialScripts.push(cmd);
    } else {
      customScripts.push(cmd);
    }
  }
  
  // Missing scripts = ALL non-system scripts (they all need uploading to bot version)
  // Official scripts can be auto-uploaded, custom scripts need manual upload
  const missingScripts = [...officialScripts, ...customScripts];
  
  return {
    requiredScripts: requiredScripts.sort(),
    officialScripts: officialScripts.sort(),
    customScripts: customScripts.sort(),
    missingScripts: missingScripts.sort(),
    systemNodes: systemNodes.sort(),
  };
}

/**
 * Remove a script from the solution by replacing nodes that use it
 * with SysAssignVariable (a no-op passthrough)
 */
export function removeScriptFromSolution(csv: string, scriptName: string): {
  csv: string;
  nodesModified: number[];
  success: boolean;
} {
  const lines = csv.split('\n');
  if (lines.length < 2) return { csv, nodesModified: [], success: false };
  
  const COMMAND_COL = 13;
  const NODE_NUM_COL = 0;
  const NODE_TYPE_COL = 1;
  const NODE_NAME_COL = 2;
  const PARAM_INPUT_COL = 17;
  const DECISION_VAR_COL = 18;
  const WHAT_NEXT_COL = 19;
  const OUTPUT_COL = 15;
  
  const fixedLines: string[] = [lines[0]]; // Keep header
  const nodesModified: number[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      fixedLines.push(line);
      continue;
    }
    
    const fields = parseCSVLineForFix(line);
    while (fields.length < 26) fields.push('');
    
    const nodeNum = parseInt(fields[NODE_NUM_COL], 10);
    const nodeType = fields[NODE_TYPE_COL]?.trim().toUpperCase();
    const command = fields[COMMAND_COL]?.trim();
    
    // Check if this node uses the script we're removing
    if (nodeType === 'A' && command === scriptName) {
      // Get the original output variables to preserve them as mock values
      const originalOutput = fields[OUTPUT_COL]?.trim() || '';
      const outputVars = originalOutput.split(',').map(v => v.trim()).filter(v => v);
      
      // Build mock output - set each output variable to a placeholder
      const mockSet: Record<string, string> = {};
      if (outputVars.length > 0) {
        outputVars.forEach(v => {
          mockSet[v.toUpperCase()] = `MOCK_${v.toUpperCase()}`;
        });
      } else {
        mockSet['SCRIPT_REMOVED'] = 'true';
        mockSet['ORIGINAL_COMMAND'] = scriptName;
      }
      
      // Replace with SysAssignVariable
      fields[COMMAND_COL] = 'SysAssignVariable';
      fields[PARAM_INPUT_COL] = JSON.stringify({ set: mockSet });
      
      // Ensure decision variable exists
      if (!fields[DECISION_VAR_COL]?.trim()) {
        fields[DECISION_VAR_COL] = 'success';
      }
      
      // Fix What Next if needed - ensure it has the decision variable format
      const whatNext = fields[WHAT_NEXT_COL]?.trim();
      if (whatNext && !whatNext.includes('~')) {
        // It's just a node number, convert to proper format
        fields[WHAT_NEXT_COL] = `true~${whatNext}|error~99990`;
      } else if (!whatNext) {
        fields[WHAT_NEXT_COL] = 'true~105|error~99990';
      }
      
      // Update node name to indicate it was modified
      const nodeName = fields[NODE_NAME_COL] || '';
      if (!nodeName.includes('[Mock]')) {
        fields[NODE_NAME_COL] = `${nodeName} [Mock - ${scriptName} removed]`.trim();
      }
      
      nodesModified.push(nodeNum);
      
      // Reconstruct line
      const newLine = fields.map(f => {
        if (!f) return '';
        const str = String(f);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }).join(',');
      fixedLines.push(newLine);
    } else {
      fixedLines.push(line);
    }
  }
  
  return {
    csv: fixedLines.join('\n'),
    nodesModified,
    success: nodesModified.length > 0,
  };
}

/**
 * Check if CSV has required structure (node 1, etc.)
 */
export function validateCSVStructure(csv: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = csv.split('\n').filter(l => l.trim());
  
  if (lines.length < 2) {
    errors.push('CSV has no data rows');
    return { valid: false, errors };
  }
  
  // Check for node 1
  let hasNode1 = false;
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLineForFix(lines[i]);
    const nodeNum = parseInt(fields[0], 10);
    if (nodeNum === 1) {
      hasNode1 = true;
      break;
    }
  }
  
  if (!hasNode1) {
    errors.push('Missing required start node (Node Number 1). Every bot must have a node numbered 1 as the entry point.');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Comprehensive structural pre-validation and auto-fix.
 * Runs BEFORE Bot Manager validation to catch issues that the AI commonly generates.
 * Returns the fixed CSV and a list of all fixes applied.
 * 
 * This covers:
 * 1. Column count enforcement (exactly 26 per row)
 * 2. Orphan node detection (nodes referenced but not defined)
 * 3. Dead-end detection (decision nodes with no outgoing path)
 * 4. Button format normalization (JSON buttons → pipe format)
 * 5. NLU Disabled + multi-child conflict resolution
 * 6. Action node completeness (Command, Decision Variable, What Next, error path)
 * 7. Required system node injection (-500, 666, 999, 1800, 99990)
 * 8. What Next error path enforcement
 * 9. Rich Asset Type singular/plural normalization
 * 10. Variable ALL_CAPS enforcement
 */
export function structuralPreValidation(csv: string): { csv: string; fixes: string[] } {
  const fixes: string[] = [];
  const lines = csv.split('\n');
  if (lines.length < 2) return { csv, fixes };

  // Column indices
  const COL = {
    NODE_NUM: 0, NODE_TYPE: 1, NODE_NAME: 2, INTENT: 3,
    ENTITY_TYPE: 4, ENTITY: 5, NLU_DISABLED: 6, NEXT_NODES: 7,
    MESSAGE: 8, RICH_TYPE: 9, RICH_CONTENT: 10, ANS_REQ: 11,
    BEHAVIORS: 12, COMMAND: 13, DESCRIPTION: 14, OUTPUT: 15,
    NODE_INPUT: 16, PARAM_INPUT: 17, DEC_VAR: 18, WHAT_NEXT: 19,
    TAGS: 20, SKILL: 21, VARIABLE: 22, PLATFORM: 23, FLOWS: 24, CSS: 25
  };

  // === PASS 1: Parse all nodes and collect references ===
  const nodeSet = new Set<number>();
  const referencedNodes = new Set<number>();
  const parsedRows: { fields: string[]; lineIdx: number }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = parseCSVLineForFix(line);
    while (fields.length < 26) fields.push('');
    // Trim excess columns
    if (fields.length > 26) fields.length = 26;

    const nodeNum = parseInt(fields[COL.NODE_NUM], 10);
    if (isNaN(nodeNum)) continue;
    nodeSet.add(nodeNum);
    parsedRows.push({ fields, lineIdx: i });

    // Collect references from Next Nodes
    const nextNodes = fields[COL.NEXT_NODES]?.trim();
    if (nextNodes) {
      nextNodes.split(/[,|]/).forEach(n => {
        const num = parseInt(n.trim(), 10);
        if (!isNaN(num)) referencedNodes.add(num);
      });
    }

    // Collect references from What Next
    const whatNext = fields[COL.WHAT_NEXT]?.trim();
    if (whatNext) {
      whatNext.split('|').forEach(pair => {
        const parts = pair.split('~');
        if (parts.length === 2) {
          const num = parseInt(parts[1].trim(), 10);
          if (!isNaN(num)) referencedNodes.add(num);
        }
      });
    }

    // Collect references from Rich Asset Content (button pipe format)
    const richContent = fields[COL.RICH_CONTENT]?.trim() || '';
    const richType = fields[COL.RICH_TYPE]?.trim().toLowerCase() || '';
    if (richContent && !richContent.startsWith('{') && richContent.includes('~')) {
      richContent.split('|').forEach(btn => {
        const parts = btn.split('~');
        if (parts.length === 2) {
          const num = parseInt(parts[1].trim(), 10);
          if (!isNaN(num)) referencedNodes.add(num);
        }
      });
    }
    // JSON buttons/quick_reply/listpicker dest references
    if (richContent.startsWith('{')) {
      try {
        const obj = JSON.parse(cleanJsonString(richContent));
        if (obj.options && Array.isArray(obj.options)) {
          obj.options.forEach((opt: any) => {
            const num = parseInt(String(opt.dest), 10);
            if (!isNaN(num)) referencedNodes.add(num);
          });
        }
      } catch { /* ignore parse errors — handled elsewhere */ }
    }
  }

  // === PASS 2: Fix each row ===
  const fixedLines: string[] = [lines[0]]; // keep header

  for (const { fields, lineIdx } of parsedRows) {
    let modified = false;
    const nodeNum = parseInt(fields[COL.NODE_NUM], 10);
    const nodeType = fields[COL.NODE_TYPE]?.trim().toUpperCase();
    let richType = fields[COL.RICH_TYPE]?.trim().toLowerCase();
    let richContent = fields[COL.RICH_CONTENT]?.trim() || '';

    // --- FIX: Column count (pad/trim to exactly 26) ---
    if (fields.length !== 26) {
      fixes.push(`Node ${nodeNum}: Fixed column count from ${fields.length} to 26`);
      while (fields.length < 26) fields.push('');
      if (fields.length > 26) fields.length = 26;
      modified = true;
    }

    // --- CRITICAL FIX: Node 1800 MUST have out_of_scope intent ---
    // NLU-enabled bots require this for the fallback handler
    if (nodeNum === 1800) {
      const currentIntent = fields[COL.INTENT]?.trim().toLowerCase();
      if (!currentIntent || currentIntent !== 'out_of_scope') {
        fields[COL.INTENT] = 'out_of_scope';
        fixes.push(`Node 1800: Added out_of_scope intent (NLU requirement)`);
        console.log(`[structuralPreValidation] CRITICAL FIX: Node 1800 intent set to out_of_scope`);
        modified = true;
      }
    }

    // --- FIX: Rich Asset Type in Message field (AI put type in wrong field!) ---
    const messageField = fields[COL.MESSAGE]?.trim() || '';
    const RICH_ASSET_TYPES = ['quick_reply', 'button', 'buttons', 'listpicker', 'carousel', 'datepicker', 'timepicker', 'webview', 'file_upload', 'star_rating', 'imagebutton'];
    if (messageField && RICH_ASSET_TYPES.includes(messageField.toLowerCase())) {
      fixes.push(`Node ${nodeNum}: CRITICAL - Message field contained rich asset type "${messageField}" (clearing)`);
      console.log(`[structuralPreValidation] CRITICAL FIX: Node ${nodeNum} message field had rich asset type: "${messageField}"`);
      fields[COL.MESSAGE] = '';
      modified = true;
    }
    
    // --- FIX: Node numbers in Message field (CRITICAL - should NEVER happen) ---
    // Pattern: message is just comma-separated numbers like "510,520,530"
    const messageFieldForNumbers = fields[COL.MESSAGE]?.trim() || '';
    if (messageFieldForNumbers && /^\d+(\s*,\s*\d+)*$/.test(messageFieldForNumbers)) {
      fixes.push(`Node ${nodeNum}: CRITICAL - Message field contained node numbers "${messageFieldForNumbers}" (clearing)`);
      console.log(`[structuralPreValidation] CRITICAL FIX: Node ${nodeNum} message field had node numbers: "${messageFieldForNumbers}"`);
      
      // Check if this is a button/listpicker/quick_reply node
      // If so, DO NOT put multiple nodes in Next Nodes - buttons handle routing via dest
      const hasRichAsset = richType && ['button', 'buttons', 'listpicker', 'quick_reply', 'carousel'].includes(richType);
      
      if (!hasRichAsset && !fields[COL.NEXT_NODES]?.trim()) {
        // Only move to Next Nodes if there's no rich asset AND it's a single number
        // Multiple comma-separated node numbers in Next Nodes is invalid
        const nodeNums = messageFieldForNumbers.split(',').map(n => n.trim()).filter(n => n);
        if (nodeNums.length === 1) {
          fields[COL.NEXT_NODES] = nodeNums[0];
          fixes.push(`Node ${nodeNum}: Moved single node number to Next Nodes field`);
        }
        // If multiple numbers, they're probably button destinations - just discard
      }
      
      // ALWAYS clear the message - these are node numbers, not user-facing text
      fields[COL.MESSAGE] = '';
      modified = true;
    }
    
    // --- FIX: Multiple node numbers in Next Nodes (only single node allowed) ---
    const nextNodesField = fields[COL.NEXT_NODES]?.trim() || '';
    if (nextNodesField && nextNodesField.includes(',')) {
      // Multiple comma-separated nodes is only valid if the destinations are for different conditions
      // But for Decision nodes with buttons, Next Nodes should be empty (buttons have dest)
      const hasRichAssetRouting = richType && ['button', 'buttons', 'listpicker', 'quick_reply', 'carousel'].includes(richType);
      
      if (hasRichAssetRouting && nodeType === 'D') {
        // Button node with multiple Next Nodes - clear it, buttons handle routing
        fixes.push(`Node ${nodeNum}: Cleared multiple Next Nodes (buttons handle routing via dest)`);
        fields[COL.NEXT_NODES] = '';
        modified = true;
      }
    }

    // --- FIX: "buttons" (plural) with pipe content → "button" (singular) ---
    if (richType === 'buttons' && richContent && !richContent.startsWith('{')) {
      fields[COL.RICH_TYPE] = 'button';
      fixes.push(`Node ${nodeNum}: Changed Rich Asset Type "buttons" → "button" (pipe format requires singular)`);
      modified = true;
    }

    // --- FIX: Rich Asset Type with empty content → clear the type ---
    // Bot Manager requires content if type is set
    if (richType && (!richContent || richContent.trim() === '')) {
      fields[COL.RICH_TYPE] = '';
      fixes.push(`Node ${nodeNum}: Cleared empty Rich Asset Type "${richType}" (no content provided)`);
      console.log(`[structuralPreValidation] EMPTY CONTENT FIX: Node ${nodeNum} cleared rich type "${richType}"`);
      modified = true;
      richType = ''; // Update local variable
    }

    // --- FIX: Pipe characters INSIDE button labels (CRITICAL - breaks parsing) ---
    // Common AI mistakes: "10-20|people" or "5-10|Minutes Ago" 
    // The | should ONLY separate buttons, not appear in labels
    if ((richType === 'button' || richType === 'buttons') && richContent && !richContent.startsWith('{') && richContent.includes('~')) {
      // CRITICAL: Fix missing pipes BEFORE sanitizing labels
      // This converts "Label~100Label~200" -> "Label~100|Label~200"
      // Must happen first or the label sanitization below will corrupt the content
      const { fixed: pipedContent, wasFixed: pipesAdded } = fixButtonPipeFormat(richContent);
      if (pipesAdded) {
        richContent = pipedContent;
        fields[COL.RICH_CONTENT] = richContent;
        fixes.push(`Node ${nodeNum}: Added missing pipe separators between buttons`);
        console.log(`[structuralPreValidation] PIPE FIX: Node ${nodeNum} added missing pipes`);
        modified = true;
      }
      
      // NOW parse and sanitize individual button labels (pipes are in place)
      const buttons = richContent.split('|');
      let needsFix = false;
      const sanitizedButtons: string[] = [];
      
      for (const btn of buttons) {
        const lastTildeIdx = btn.lastIndexOf('~');
        if (lastTildeIdx > 0) {
          let label = btn.substring(0, lastTildeIdx);
          const dest = btn.substring(lastTildeIdx + 1);
          
          // Check if label contains additional pipes or tildes (shouldn't happen)
          if (label.includes('|') || label.includes('~')) {
            // Sanitize: replace | and ~ with hyphen
            const originalLabel = label;
            label = label.replace(/[|~]/g, '-');
            fixes.push(`Node ${nodeNum}: Sanitized button label "${originalLabel}" → "${label}" (removed reserved chars)`);
            console.log(`[structuralPreValidation] BUTTON LABEL FIX: Node ${nodeNum} "${originalLabel}" → "${label}"`);
            needsFix = true;
          }
          sanitizedButtons.push(`${label}~${dest}`);
        } else {
          // Malformed button without tilde - keep as-is
          sanitizedButtons.push(btn);
        }
      }
      
      if (needsFix) {
        fields[COL.RICH_CONTENT] = sanitizedButtons.join('|');
        modified = true;
      }
    }

    // --- FIX: "button" (singular) with JSON content → convert to pipe format ---
    if ((richType === 'button' || richType === 'buttons') && richContent.startsWith('{')) {
      try {
        const obj = JSON.parse(cleanJsonString(richContent));
        if (obj.options && Array.isArray(obj.options) && obj.options.length > 0) {
          const pipeContent = obj.options
            .map((opt: any) => `${opt.label || 'Option'}~${opt.dest || 105}`)
            .join('|');
          fields[COL.RICH_TYPE] = 'button';
          fields[COL.RICH_CONTENT] = pipeContent;
          fixes.push(`Node ${nodeNum}: Converted JSON buttons to pipe format (${obj.options.length} buttons)`);
          modified = true;
        }
      } catch { /* leave as-is if unparseable */ }
    }

    // --- FIX: NLU Disabled=1 with multiple button destinations ---
    if (fields[COL.NLU_DISABLED]?.trim() === '1' && nodeType === 'D') {
      const rc = fields[COL.RICH_CONTENT]?.trim() || '';
      let destCount = 0;
      const destSet = new Set<string>();

      // Count destinations in pipe-format buttons
      if (rc && !rc.startsWith('{') && rc.includes('~')) {
        rc.split('|').forEach(btn => {
          const parts = btn.split('~');
          if (parts.length === 2) {
            destSet.add(parts[1].trim());
          }
        });
        destCount = destSet.size;
      }
      // Count destinations in JSON options
      if (rc.startsWith('{')) {
        try {
          const obj = JSON.parse(cleanJsonString(rc));
          if (obj.options && Array.isArray(obj.options)) {
            obj.options.forEach((opt: any) => destSet.add(String(opt.dest)));
            destCount = destSet.size;
          }
        } catch { /* ignore */ }
      }

      // Also count Next Nodes
      const nn = fields[COL.NEXT_NODES]?.trim();
      if (nn) {
        nn.split(/[,|]/).forEach(n => destSet.add(n.trim()));
        destCount = destSet.size;
      }

      if (destCount > 1) {
        fields[COL.NLU_DISABLED] = '';
        fixes.push(`Node ${nodeNum}: Cleared NLU Disabled (had ${destCount} distinct destinations — max 1 allowed with NLU Disabled)`);
        modified = true;
      }
      
      // CATCH-ALL: If NLU Disabled=1 and Rich Asset Type implies multi-route, clear it
      // This catches cases where JSON parsing above failed silently
      if (fields[COL.NLU_DISABLED]?.trim() === '1') {
        const rt = richType;
        const hasMultiRouteAsset = ['button', 'buttons', 'listpicker', 'quick_reply', 'carousel', 'imagebutton'].includes(rt);
        const nn = fields[COL.NEXT_NODES]?.trim() || '';
        const hasMultiNextNodes = nn.includes(',') || nn.includes('|');
        
        if (hasMultiRouteAsset || hasMultiNextNodes) {
          fields[COL.NLU_DISABLED] = '';
          fixes.push(`Node ${nodeNum}: Cleared NLU Disabled (catch-all: has ${hasMultiRouteAsset ? `Rich Asset Type '${rt}'` : 'multiple Next Nodes'})`);
          modified = true;
        }
      }
    }

    // --- FIX: Action node with empty Command ---
    // CRITICAL: Skip startup nodes managed by injectRequiredStartupNodes
    // These have specific commands that should NOT be overwritten to SysAssignVariable
    const CRITICAL_STARTUP_NODES = new Set([
      -500, // HandleBotError
      1, 10, // ShowMetadata, UserPlatformRouting
      100, 101, 102, 103, 104, 105, // Platform routing + SetEnv + InitContext
      666, 999, // EndChat, LiveAgent (Decision nodes - template managed)
      1800, 1802, 1803, 1804, // GenAI fallback chain
      99990, // Error message
      200, 201, 210, // Main menu nodes (D nodes, not A nodes!)
    ]);
    
    if (nodeType === 'A') {
      const cmd = fields[COL.COMMAND]?.trim();
      if (!cmd) {
        // SKIP fixing startup nodes - let injectRequiredStartupNodes handle them
        if (CRITICAL_STARTUP_NODES.has(nodeNum)) {
          fixes.push(`WARNING: Node ${nodeNum} has empty Command but is a critical startup node - skipping fix, will be handled by startup injection`);
          // DON'T modify - injectRequiredStartupNodes will replace this node entirely
        } else {
          fields[COL.COMMAND] = 'SysAssignVariable';
          if (!fields[COL.PARAM_INPUT]?.trim()) {
            fields[COL.PARAM_INPUT] = '{"set":{"PLACEHOLDER":"true"}}';
          }
          if (!fields[COL.DEC_VAR]?.trim()) {
            fields[COL.DEC_VAR] = 'success';
          }
          if (!fields[COL.WHAT_NEXT]?.trim()) {
            fields[COL.WHAT_NEXT] = 'true~105|error~99990';
          }
          fixes.push(`Node ${nodeNum}: Added SysAssignVariable to empty Action node Command`);
          modified = true;
        }
      }

      // --- FIX: Action node with Command but missing What Next (CRITICAL!) ---
      // Action nodes MUST have What Next for routing - bot will fail without it
      const wn = fields[COL.WHAT_NEXT]?.trim();
      const currentCmd = fields[COL.COMMAND]?.trim();
      
      if (currentCmd && !wn) {
        // Action node has command but no What Next - add default routing
        // Use command-specific routing where possible
        const COMMAND_WHATNEXT_MAP: Record<string, string> = {
          'SysAssignVariable': 'true~105|false~99990|error~99990',
          'SysShowMetadata': 'true~10|error~99990',
          'SysSetEnv': 'true~105|error~99990',
          'UserPlatformRouting': 'ios~100|android~101|mac~102|windows~102|other~102|error~103',
          'GenAIFallback': 'understood~1802|route_flow~1803|not_understood~1804|error~1804',
          'HandleBotError': 'bot_error~99990|bot_timeout~99990|other~99990',
          'ValidateRegex': 'true~200|false~200|error~99990',
          'SysMultiMatchRouting': 'false~1800|error~1800',
        };
        
        // Default: route to return menu (201) on success, error handler on failure
        const defaultWhatNext = COMMAND_WHATNEXT_MAP[currentCmd] || 'true~201|false~99990|error~99990';
        fields[COL.WHAT_NEXT] = defaultWhatNext;
        fixes.push(`Node ${nodeNum}: Added missing What Next for ${currentCmd}: "${defaultWhatNext}"`);
        modified = true;
      } else if (wn && !wn.toLowerCase().includes('error~')) {
        // What Next exists but missing error path
        fields[COL.WHAT_NEXT] = wn + '|error~99990';
        fixes.push(`Node ${nodeNum}: Added missing |error~99990 to What Next`);
        modified = true;
      }

      // --- FIX: What Next present but no Decision Variable ---
      if (fields[COL.WHAT_NEXT]?.trim() && !fields[COL.DEC_VAR]?.trim()) {
        // Use command-specific Decision Variable, not just "success"
        const cmdForDecVar = fields[COL.COMMAND]?.trim() || '';
        const COMMAND_TO_DECVAR_MAP: Record<string, string> = {
          'GenAIFallback': 'result',
          'HandleBotError': 'error_type',
          'SysMultiMatchRouting': 'route_to',
          'UserPlatformRouting': 'success',
          'SysAssignVariable': 'success',
          'SysShowMetadata': 'success',
          'SysSetEnv': 'success',
          'ValidateRegex': 'success',
        };
        const correctDecVar = COMMAND_TO_DECVAR_MAP[cmdForDecVar] || 'success';
        fields[COL.DEC_VAR] = correctDecVar;
        fixes.push(`Node ${nodeNum}: Added missing Decision Variable "${correctDecVar}"`);
        modified = true;
      }
    }

    // --- FIX: Decision node dead-end (no Next Nodes, no buttons, no xfer_to_agent) ---
    if (nodeType === 'D') {
      // CRITICAL FIX: Decision nodes CANNOT have Decision Variable or What Next
      // These fields are ONLY valid for Action nodes. If present, clear them.
      const hasDecVar = !!fields[COL.DEC_VAR]?.trim();
      const hasWhatNext = !!fields[COL.WHAT_NEXT]?.trim();
      if (hasDecVar || hasWhatNext) {
        const clearedFields: string[] = [];
        if (hasDecVar) {
          clearedFields.push(`Decision Variable="${fields[COL.DEC_VAR]}"`);
          fields[COL.DEC_VAR] = '';
        }
        if (hasWhatNext) {
          clearedFields.push(`What Next="${fields[COL.WHAT_NEXT]}"`);
          fields[COL.WHAT_NEXT] = '';
        }
        fixes.push(`Node ${nodeNum}: Cleared invalid ${clearedFields.join(' and ')} from Decision node (only Action nodes can have these)`);
        modified = true;
      }
      
      const hasNext = !!fields[COL.NEXT_NODES]?.trim();
      const hasBtns = !!fields[COL.RICH_CONTENT]?.trim() && (richType === 'button' || richType === 'buttons' || richType === 'listpicker' || richType === 'quick_reply');
      const hasXfer = fields[COL.BEHAVIORS]?.includes('xfer_to_agent');
      const isEndChat = nodeNum === 666;
      const nluDisabled = fields[COL.NLU_DISABLED]?.trim() === '1';
      
      // --- FIX: Nodes with buttons but no nextNodes should route typed input to GenAI ---
      // This ensures users can type natural responses instead of only clicking buttons
      if (hasBtns && !hasNext && !nluDisabled && !hasXfer) {
        const message = fields[COL.MESSAGE] || '';
        const isQuestion = message.includes('?');
        
        // Skip system nodes and agent transfer nodes
        const isSystemNode = [666, 999, 99990, 1802, 1804].includes(nodeNum);
        
        if (!isSystemNode && message.trim()) {
          // Add nextNodes to 1800 (GenAI) so typed responses get intelligent handling
          fields[COL.NEXT_NODES] = '1800';
          fixes.push(`Node ${nodeNum}: Added GenAI fallback (nextNodes=1800) for typed input`);
          modified = true;
          
          // Also ensure NLU is enabled
          if (fields[COL.NLU_DISABLED]?.trim()) {
            fields[COL.NLU_DISABLED] = '';
            fixes.push(`Node ${nodeNum}: Enabled NLU for natural input handling`);
          }
        }
      }
      
      if (!hasNext && !hasBtns && !hasXfer && !isEndChat) {
        // This node has no path forward - it's a true dead-end
        // The AI should have provided either nextNodes OR richContent
        const nodeName = fields[COL.NODE_NAME] || '';
        const message = fields[COL.MESSAGE] || '';
        
        // Only add fallback buttons if the node has a message (user-facing)
        // Empty message nodes might be placeholders that need review
        if (message.trim()) {
          // Log a warning - this indicates AI generation issue
          console.warn(`[Dead-End Fix] Node ${nodeNum} "${nodeName}" has message but no path forward`);
          
          // Analyze the message to determine appropriate action
          const msgLower = message.toLowerCase();
          const isQuestion = message.includes('?') || 
                            msgLower.includes('what ') ||
                            msgLower.includes('which ') ||
                            msgLower.includes('would you') ||
                            msgLower.includes('do you');
          
          const isEndContext = msgLower.includes('thank') ||
                              msgLower.includes('complete') ||
                              msgLower.includes('finished') ||
                              msgLower.includes('all set') ||
                              nodeName.toLowerCase().includes('end') ||
                              nodeName.toLowerCase().includes('result');
          
          fields[COL.RICH_TYPE] = 'button';
          
          if (isEndContext) {
            // This looks like an end-of-flow message - add appropriate exit options
            fields[COL.RICH_CONTENT] = 'Back to Menu~200|All Done~666|Talk to Agent~999';
            fixes.push(`Node ${nodeNum}: Added exit options (end-of-flow context detected)`);
          } else if (isQuestion) {
            // This is a question without answer options - AI failed to provide choices
            // Add a minimal "Continue" to prevent dead-end, but flag for review
            const baseNode = Math.floor(nodeNum / 100) * 100;
            const nextNode = nodeNum + 1;
            fields[COL.RICH_CONTENT] = `Continue~${nextNode}|Back to Menu~200`;
            fixes.push(`Node ${nodeNum}: Question without options - added Continue (needs review)`);
          } else {
            // Informational node - should have had nextNodes
            // Add a Continue button to the next sequential node
            const nextNode = nodeNum + 1;
            fields[COL.RICH_CONTENT] = `Continue~${nextNode}|Back to Menu~200`;
            fixes.push(`Node ${nodeNum}: Info node without nextNodes - added Continue`);
          }
          
          fields[COL.ANS_REQ] = '1';
          modified = true;
        } else {
          // Node has no message - might be a placeholder or error
          fixes.push(`Node ${nodeNum}: Empty Decision node with no routing (may need review)`);
        }
      }
    }

    // --- FIX: Variable column not ALL_CAPS ---
    const varCol = fields[COL.VARIABLE]?.trim();
    if (varCol && /[a-z]/.test(varCol)) {
      fields[COL.VARIABLE] = varCol.toUpperCase().replace(/[\s-]+/g, '_');
      fixes.push(`Node ${nodeNum}: Converted Variable to ALL_CAPS: ${fields[COL.VARIABLE]}`);
      modified = true;
    }

    // --- FIX: ValidateRegex missing Parameter Input ---
    // Error: "Referenced global variable does not exist (value: LAST_USER_MESSAGE)"
    const command = fields[COL.COMMAND]?.trim();
    if (nodeType === 'A' && command === 'ValidateRegex') {
      const paramInput = fields[COL.PARAM_INPUT]?.trim() || '';
      let needsFix = false;
      
      if (!paramInput) {
        needsFix = true;
      } else {
        try {
          const parsed = JSON.parse(paramInput);
          // Check for required fields (bundled format: regex+input, official: global_vars+validation)
          needsFix = !((parsed.regex && parsed.input) || (parsed.global_vars && parsed.validation));
        } catch {
          needsFix = true;
        }
      }
      
      if (needsFix) {
        const variableCol2 = fields[COL.VARIABLE]?.trim().toUpperCase() || '';
        const nodeName2 = (fields[COL.NODE_NAME] || '').toLowerCase();
        const desc = (fields[COL.DESCRIPTION] || '').toLowerCase();
        const nodeInputCol = fields[COL.NODE_INPUT]?.trim() || '';
        
        // Infer regex based on hints
        let regexPattern = '^[A-Za-z0-9]+$';
        let varName = variableCol2 || 'INPUT_VALUE';
        
        const hint = variableCol2 + ' ' + nodeName2 + ' ' + desc;
        if (hint.includes('zip') || hint.includes('postal')) {
          regexPattern = '^[0-9]{5}(-[0-9]{4})?$';
          if (!variableCol2) varName = 'ZIP_CODE';
        } else if (hint.includes('email')) {
          regexPattern = '^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$';
          if (!variableCol2) varName = 'USER_EMAIL';
        } else if (hint.includes('phone')) {
          regexPattern = '^[0-9]{10,15}$';
          if (!variableCol2) varName = 'PHONE_NUMBER';
        }
        
        // Use Node Input to reference previous node where user typed
        // Find the actual previous node that exists (not just nodeNum - 1 which may not exist)
        const sortedNodes = Array.from(nodeSet).filter(n => n < nodeNum && n > 0).sort((a, b) => b - a);
        const prevNodeNum = sortedNodes.length > 0 ? sortedNodes[0] : nodeNum - 1;
        if (!nodeInputCol) {
          fields[COL.NODE_INPUT] = `user_input: ${prevNodeNum}`;
        }
        
        // Use bundled script format with Node Input reference
        const inputRef = nodeInputCol ? 
          `{${nodeInputCol.split(':')[0].trim()}}` : 
          '{user_input}';
        
        fields[COL.PARAM_INPUT] = JSON.stringify({
          regex: regexPattern,
          input: inputRef
        });
        
        // Ensure Variable column is set
        if (!fields[COL.VARIABLE]?.trim()) {
          fields[COL.VARIABLE] = varName;
        }
        
        // Ensure Decision Variable is 'success' (bundled script returns success=true/false)
        if (fields[COL.DEC_VAR]?.trim() !== 'success') {
          fields[COL.DEC_VAR] = 'success';
        }
        
        fixes.push(`Node ${nodeNum}: Added ValidateRegex Parameter Input with Node Input: user_input: ${prevNodeNum}`);
        modified = true;
      }
    }

    // --- FIX: xfer_to_agent with non-empty Next Nodes ---
    if (fields[COL.BEHAVIORS]?.includes('xfer_to_agent') && fields[COL.NEXT_NODES]?.trim()) {
      fields[COL.NEXT_NODES] = '';
      fixes.push(`Node ${nodeNum}: Cleared Next Nodes for xfer_to_agent node`);
      modified = true;
    }

    // --- FIX: datepicker/timepicker missing Answer Required or disable_input ---
    if (richType === 'datepicker' || richType === 'timepicker' || richType === 'file_upload') {
      if (fields[COL.ANS_REQ]?.trim() !== '1') {
        fields[COL.ANS_REQ] = '1';
        fixes.push(`Node ${nodeNum}: Set Answer Required=1 for ${richType}`);
        modified = true;
      }
      if (!fields[COL.BEHAVIORS]?.includes('disable_input')) {
        fields[COL.BEHAVIORS] = fields[COL.BEHAVIORS] ? fields[COL.BEHAVIORS] + ',disable_input' : 'disable_input';
        fixes.push(`Node ${nodeNum}: Added disable_input behavior for ${richType}`);
        modified = true;
      }
    }

    // --- FIX: datepicker/timepicker Rich Asset Content must be {"type":"static","message":"..."} ---
    if (richType === 'datepicker' || richType === 'timepicker') {
      const defaultMsg = richType === 'datepicker' ? 'Please select a date' : 'Please select a time';
      const rc2 = fields[COL.RICH_CONTENT]?.trim();
      if (!rc2) {
        fields[COL.RICH_CONTENT] = JSON.stringify({ type: 'static', message: defaultMsg });
        fixes.push(`Node ${nodeNum}: Created ${richType} JSON with required message property`);
        modified = true;
      } else {
        try {
          const obj = JSON.parse(cleanJsonString(rc2));
          if (obj.type !== 'static' || !obj.message) {
            obj.type = 'static';
            if (!obj.message) obj.message = defaultMsg;
            fields[COL.RICH_CONTENT] = JSON.stringify(obj);
            fixes.push(`Node ${nodeNum}: Fixed ${richType} JSON (type→static, added message)`);
            modified = true;
          }
        } catch {
          fields[COL.RICH_CONTENT] = JSON.stringify({ type: 'static', message: defaultMsg });
          fixes.push(`Node ${nodeNum}: Replaced invalid ${richType} JSON`);
          modified = true;
        }
      }
    }

    // Reconstruct the line
    if (modified) {
      fixedLines.push(reconstructCSVLine(fields));
    } else {
      fixedLines.push(lines[lineIdx]);
    }
  }

  // === PASS 3: Inject missing required system nodes ===
  // NOTE: Node 1800 is NOT here - it's handled by GENAI_FALLBACK_NODES (Action node with GenAIFallback)
  // The old definition as a Decision node was incorrect and caused validation errors
  const requiredSystemNodes: Record<number, string> = {
    [-500]: '-500,A,HandleBotError,,,,,,,,,,,HandleBotError,Catches exceptions,error_type,,"{""save_error_to"":""PLATFORM_ERROR""}",error_type,bot_error~99990|bot_timeout~99990|other~99990,,,PLATFORM_ERROR,,,',
    [666]: '666,D,EndChat,,,,,,Thank you for using our service. Goodbye!,,,,,,,,,,,,,,,,,,',
    [999]: '999,D,Agent Transfer,,,,,,,,,,xfer_to_agent,,,,,,,,,,,,,,',
    [99990]: '99990,D,Error Message,,,,,,Oops! Something went wrong. Let me help you get back on track.,button,Start Over~1|Talk to Agent~999,1,disable_input,,,,,,,,,,,,',
  };

  for (const [nodeNumStr, csvRow] of Object.entries(requiredSystemNodes)) {
    const nodeNum = parseInt(nodeNumStr, 10);
    if (!nodeSet.has(nodeNum)) {
      fixedLines.push(csvRow);
      fixes.push(`Injected missing required system node ${nodeNum}`);
    }
  }

  // === PASS 4: Fix orphan references (nodes referenced but not defined) ===
  const systemNodeNums = new Set(Object.keys(requiredSystemNodes).map(Number));
  const allValidNodes = new Set([...nodeSet, ...systemNodeNums]);
  const orphanRefs = [...referencedNodes].filter(n => !allValidNodes.has(n));
  
  if (orphanRefs.length > 0) {
    const orphanSet = new Set(orphanRefs);
    // Find the nearest valid node for each orphan
    const findNearest = (orphanNum: number): number => {
      // Try common fallback nodes first
      if (allValidNodes.has(201)) return 201; // Return Menu
      if (allValidNodes.has(200)) return 200; // Main Menu
      if (allValidNodes.has(99990)) return 99990; // Error
      // Find nearest by number
      let nearest = 99990;
      let minDist = Infinity;
      for (const valid of allValidNodes) {
        const dist = Math.abs(valid - orphanNum);
        if (dist < minDist && dist > 0) {
          minDist = dist;
          nearest = valid;
        }
      }
      return nearest;
    };
    
    // Re-process fixedLines to replace orphan references
    for (let i = 1; i < fixedLines.length; i++) {
      const line = fixedLines[i];
      if (!line.trim()) continue;
      const fields = parseCSVLineForFix(line);
      if (fields.length < 8) continue;
      let lineModified = false;
      const nodeNum = parseInt(fields[0], 10);
      
      // Fix Next Nodes
      const nn = fields[COL.NEXT_NODES]?.trim();
      if (nn) {
        const parts = nn.split(/[,|]/);
        const fixed = parts.map(p => {
          const n = parseInt(p.trim(), 10);
          if (!isNaN(n) && orphanSet.has(n)) {
            const replacement = findNearest(n);
            fixes.push(`Node ${nodeNum}: Replaced orphan Next Node ${n} → ${replacement}`);
            lineModified = true;
            return String(replacement);
          }
          return p.trim();
        });
        if (lineModified) fields[COL.NEXT_NODES] = fixed.join('|');
      }
      
      // Fix What Next orphan refs
      const wn = fields[COL.WHAT_NEXT]?.trim();
      if (wn) {
        const pairs = wn.split('|');
        let wnModified = false;
        const fixedPairs = pairs.map(pair => {
          const parts = pair.split('~');
          if (parts.length === 2) {
            const n = parseInt(parts[1].trim(), 10);
            if (!isNaN(n) && orphanSet.has(n)) {
              const replacement = findNearest(n);
              fixes.push(`Node ${nodeNum}: Replaced orphan What Next ref ${n} → ${replacement}`);
              wnModified = true;
              return `${parts[0].trim()}~${replacement}`;
            }
          }
          return pair;
        });
        if (wnModified) { fields[COL.WHAT_NEXT] = fixedPairs.join('|'); lineModified = true; }
      }
      
      // Fix Rich Asset Content orphan button destinations (pipe format)
      const rc = fields[COL.RICH_CONTENT]?.trim() || '';
      if (rc && !rc.startsWith('{') && rc.includes('~')) {
        const btns = rc.split('|');
        let rcModified = false;
        const fixedBtns = btns.map(btn => {
          const parts = btn.split('~');
          if (parts.length === 2) {
            const n = parseInt(parts[1].trim(), 10);
            if (!isNaN(n) && orphanSet.has(n)) {
              const replacement = findNearest(n);
              fixes.push(`Node ${nodeNum}: Replaced orphan button dest ${n} → ${replacement}`);
              rcModified = true;
              return `${parts[0].trim()}~${replacement}`;
            }
          }
          return btn;
        });
        if (rcModified) { fields[COL.RICH_CONTENT] = fixedBtns.join('|'); lineModified = true; }
      }
      
      // Fix JSON button destinations
      if (rc.startsWith('{') && rc.includes('dest')) {
        try {
          const obj = JSON.parse(cleanJsonString(rc));
          let jsonModified = false;
          if (obj.options && Array.isArray(obj.options)) {
            obj.options.forEach((opt: any) => {
              const n = parseInt(String(opt.dest), 10);
              if (!isNaN(n) && orphanSet.has(n)) {
                const replacement = findNearest(n);
                fixes.push(`Node ${nodeNum}: Replaced orphan JSON button dest ${n} → ${replacement}`);
                opt.dest = replacement;
                jsonModified = true;
              }
            });
          }
          if (jsonModified) { fields[COL.RICH_CONTENT] = JSON.stringify(obj); lineModified = true; }
        } catch { /* skip unparseable JSON — handled elsewhere */ }
      }
      
      if (lineModified) {
        fixedLines[i] = reconstructCSVLine(fields);
      }
    }
    
    if (orphanRefs.length > 0) {
      fixes.push(`Fixed ${orphanRefs.length} orphan node references: ${orphanRefs.sort((a, b) => a - b).join(', ')}`);
    }
  }

  // === PASS 5: Global Variable Reference Validation ===
  // CRITICAL: Ensures no variable is referenced before it's declared
  // Error: "Referenced global variable does not exist" - NEVER let this happen
  {
    // Known system/platform variables that are always available
    // NOTE: LAST_USER_MESSAGE is NOT a system variable - it must be declared or use Node Input
    const SYSTEM_VARIABLES = new Set([
      // Environment & Session
      'ENV', 'ENVIRONMENT', 'SESSION_ID', 'CHAT_ID', 'USER_ID', 'CONSUMER_ID',
      // Platform info
      'PLATFORM', 'PLATFORM_ERROR', 'DEVICE_TYPE', 'BROWSER', 'USER_AGENT',
      'IOS_USER', 'ANDROID_USER', 'DESKTOP_USER', 'MOBILE_USER',
      // Branding
      'COMPANY_NAME', 'BRAND_NAME', 'BOT_NAME', 'CLIENT_NAME',
      // Common startup variables (set by SysShowMetadata, SysSetEnv)
      'FORM_ID', 'ERROR_FLAG', 'RETRY_COUNT',
      // Context tracking (set by GenAIFallback)
      'LAST_TOPIC', 'LAST_ENTITY', 'CONVERSATION_CONTEXT', 'CONTEXT_FLOW',
    ]);
    
    // Track all declared variables and which node declares them
    const declaredVars = new Map<string, number>(); // var_name -> declaring_node_num
    const nodeInputVars = new Map<string, { nodeNum: number; refNode: number }>(); // var_name -> {nodeNum, refNode}
    
    // Re-parse all lines to collect variable declarations in node order
    interface ParsedNode {
      nodeNum: number;
      nodeType: string;
      fields: string[];
      lineIdx: number;
    }
    const allNodes: ParsedNode[] = [];
    
    for (let i = 1; i < fixedLines.length; i++) {
      const line = fixedLines[i];
      if (!line.trim()) continue;
      const fields = parseCSVLineForFix(line);
      while (fields.length < 26) fields.push('');
      const nodeNum = parseInt(fields[COL.NODE_NUM], 10);
      if (isNaN(nodeNum)) continue;
      
      allNodes.push({ nodeNum, nodeType: fields[COL.NODE_TYPE]?.trim().toUpperCase() || '', fields, lineIdx: i });
      
      // Collect variables declared in Variable column
      const varCol = fields[COL.VARIABLE]?.trim();
      if (varCol) {
        varCol.split(',').forEach(v => {
          const vName = v.trim().toUpperCase();
          if (vName && !declaredVars.has(vName)) {
            declaredVars.set(vName, nodeNum);
          }
        });
      }
      
      // Collect variables created via Node Input
      const nodeInput = fields[COL.NODE_INPUT]?.trim();
      if (nodeInput) {
        // Format: var_name: node_num, other_var: node_num
        nodeInput.split(',').forEach(pair => {
          const [varPart, nodePart] = pair.split(':').map(s => s.trim());
          if (varPart && nodePart) {
            const refNode = parseInt(nodePart, 10);
            if (!isNaN(refNode)) {
              nodeInputVars.set(varPart.toUpperCase(), { nodeNum, refNode });
            }
          }
        });
      }
    }
    
    // Sort nodes by node number to process in logical order
    allNodes.sort((a, b) => a.nodeNum - b.nodeNum);
    
    // Extract all variable references from a string (finds {VAR_NAME} patterns)
    const extractVarRefs = (str: string): string[] => {
      if (!str) return [];
      const refs: string[] = [];
      const regex = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
      let match;
      while ((match = regex.exec(str)) !== null) {
        refs.push(match[1].toUpperCase());
      }
      return refs;
    };
    
    // Find the most recent Decision node before a given node (for input collection)
    const findPreviousDecisionNode = (beforeNodeNum: number): number | null => {
      let closest: number | null = null;
      for (const node of allNodes) {
        if (node.nodeNum >= beforeNodeNum) break;
        if (node.nodeType === 'D') {
          const ansReq = node.fields[COL.ANS_REQ]?.trim();
          // Decision node that collects input (Answer Required=1)
          if (ansReq === '1') {
            closest = node.nodeNum;
          }
        }
      }
      return closest;
    };
    
    // Process each node and fix undeclared variable references
    for (const node of allNodes) {
      const { nodeNum, nodeType, fields, lineIdx } = node;
      let modified = false;
      
      // Build set of variables available at this node (declared before this node)
      const availableVars = new Set<string>(SYSTEM_VARIABLES);
      for (const [varName, declNode] of declaredVars) {
        if (declNode < nodeNum || declNode === nodeNum) { // Include same node for self-references
          availableVars.add(varName);
        }
      }
      for (const [varName, info] of nodeInputVars) {
        if (info.nodeNum <= nodeNum) {
          availableVars.add(varName);
        }
      }
      
      // Columns that can contain variable references
      const columnsToCheck = [
        { col: COL.MESSAGE, name: 'Message' },
        { col: COL.PARAM_INPUT, name: 'Parameter Input' },
        { col: COL.RICH_CONTENT, name: 'Rich Asset Content' },
        { col: COL.DESCRIPTION, name: 'Description' },
      ];
      
      for (const { col, name } of columnsToCheck) {
        const content = fields[col]?.trim() || '';
        if (!content) continue;
        
        const refs = extractVarRefs(content);
        const undeclaredRefs = refs.filter(r => !availableVars.has(r));
        
        if (undeclaredRefs.length > 0) {
          // Fix each undeclared reference
          let fixedContent = content;
          
          for (const undeclaredVar of undeclaredRefs) {
            // Strategy 1: If it's an action node Parameter Input, try to add Node Input
            if (col === COL.PARAM_INPUT && nodeType === 'A') {
              const prevDecNode = findPreviousDecisionNode(nodeNum);
              if (prevDecNode !== null) {
                // Add Node Input to reference the previous decision node
                const existingNodeInput = fields[COL.NODE_INPUT]?.trim() || '';
                const newVarName = undeclaredVar.toLowerCase();
                if (!existingNodeInput.includes(newVarName)) {
                  fields[COL.NODE_INPUT] = existingNodeInput 
                    ? `${existingNodeInput}, ${newVarName}: ${prevDecNode}`
                    : `${newVarName}: ${prevDecNode}`;
                  // Update the reference to use the Node Input variable
                  fixedContent = fixedContent.replace(
                    new RegExp(`\\{${undeclaredVar}\\}`, 'gi'),
                    `{${newVarName}}`
                  );
                  fixes.push(`Node ${nodeNum}: Added Node Input "${newVarName}: ${prevDecNode}" to resolve {${undeclaredVar}}`);
                  modified = true;
                  // Add to available vars for subsequent checks
                  availableVars.add(newVarName.toUpperCase());
                  nodeInputVars.set(newVarName.toUpperCase(), { nodeNum, refNode: prevDecNode });
                }
              } else {
                // No previous decision node found - replace with empty string or remove reference
                fixedContent = fixedContent.replace(
                  new RegExp(`\\{${undeclaredVar}\\}`, 'gi'),
                  ''
                );
                fixes.push(`Node ${nodeNum}: Removed undeclared var {${undeclaredVar}} from ${name} (no source node found)`);
                modified = true;
              }
            }
            // Strategy 2: For Message column, check if there's a matching Variable column we can use
            else if (col === COL.MESSAGE) {
              // Check if a node AFTER this one declares the variable (forward reference)
              const futureDecl = [...declaredVars.entries()].find(([v, n]) => v === undeclaredVar && n > nodeNum);
              if (futureDecl) {
                // Remove the forward reference - can't use variable before it's declared
                fixedContent = fixedContent.replace(
                  new RegExp(`\\{${undeclaredVar}\\}`, 'gi'),
                  `[${undeclaredVar}]` // Convert to display text
                );
                fixes.push(`Node ${nodeNum}: Converted forward ref {${undeclaredVar}} to [${undeclaredVar}] in ${name}`);
                modified = true;
              } else {
                // Unknown variable - remove it
                fixedContent = fixedContent.replace(
                  new RegExp(`\\{${undeclaredVar}\\}`, 'gi'),
                  ''
                );
                fixes.push(`Node ${nodeNum}: Removed undeclared var {${undeclaredVar}} from ${name}`);
                modified = true;
              }
            }
            // Strategy 3: For other columns, remove the undeclared reference
            else {
              fixedContent = fixedContent.replace(
                new RegExp(`\\{${undeclaredVar}\\}`, 'gi'),
                ''
              );
              fixes.push(`Node ${nodeNum}: Removed undeclared var {${undeclaredVar}} from ${name}`);
              modified = true;
            }
          }
          
          if (fixedContent !== content) {
            fields[col] = fixedContent;
          }
        }
      }
      
      if (modified) {
        fixedLines[lineIdx] = reconstructCSVLine(fields);
      }
    }
    
    // Log summary of variable validation
    const varValidationFixes = fixes.filter(f => 
      f.includes('undeclared var') || f.includes('Node Input') || f.includes('forward ref')
    );
    if (varValidationFixes.length > 0) {
      console.log(`[PreValidation] PASS 5: Fixed ${varValidationFixes.length} undeclared variable references`);
    }
  }

  // === PASS 6: What Next Routing Completeness Validation ===
  // CRITICAL: Ensures action nodes with known scripts have all required routes
  // Error: If UserPlatformRouting returns 'mac' but What Next doesn't have mac~xxx, bot fails
  {
    let routingFixes = 0;
    
    for (let i = 1; i < fixedLines.length; i++) {
      const line = fixedLines[i];
      if (!line.trim()) continue;
      
      const fields = parseCSVLineForFix(line);
      while (fields.length < 26) fields.push('');
      
      const nodeNum = parseInt(fields[COL.NODE_NUM], 10);
      if (isNaN(nodeNum)) continue;
      
      const nodeType = fields[COL.NODE_TYPE]?.trim().toUpperCase();
      if (nodeType !== 'A') continue; // Only action nodes have What Next
      
      const command = fields[COL.COMMAND]?.trim();
      const whatNext = fields[COL.WHAT_NEXT]?.trim() || '';
      
      if (!command || !whatNext) continue;
      
      // Check if this script has known outputs
      const expectedOutputs = SCRIPT_OUTPUTS[command];
      if (!expectedOutputs) continue;
      
      // Parse existing routes from What Next (format: value~node|value~node)
      const existingRoutes = new Set<string>();
      whatNext.split('|').forEach(pair => {
        const parts = pair.split('~');
        if (parts.length === 2) {
          existingRoutes.add(parts[0].trim().toLowerCase());
        }
      });
      
      // Find missing routes
      const missingRoutes: string[] = [];
      for (const output of expectedOutputs) {
        if (!existingRoutes.has(output.toLowerCase())) {
          missingRoutes.push(output);
        }
      }
      
      // Auto-fix: Add missing routes to error handler (99990) or first valid route's destination
      if (missingRoutes.length > 0) {
        // Determine fallback destination
        let fallbackDest = '99990';
        
        // For platform routing, use the same destination as 'other' or first non-error route
        if (command === 'UserPlatformRouting') {
          // Try to find an existing desktop/other route, or use the first non-error destination
          const firstRoute = whatNext.split('|')[0];
          const firstDest = firstRoute?.split('~')[1]?.trim();
          if (firstDest && firstDest !== '103' && firstDest !== '99990') {
            fallbackDest = firstDest;
          }
        }
        
        // Add missing routes
        const newRoutes = missingRoutes.map(r => `${r}~${fallbackDest}`);
        const fixedWhatNext = whatNext + '|' + newRoutes.join('|');
        
        fields[COL.WHAT_NEXT] = fixedWhatNext;
        fixedLines[i] = reconstructCSVLine(fields);
        routingFixes++;
        
        fixes.push(`Node ${nodeNum}: Added missing ${command} routes: ${missingRoutes.join(', ')} → ${fallbackDest}`);
      }
    }
    
    if (routingFixes > 0) {
      console.log(`[PreValidation] PASS 6: Fixed ${routingFixes} incomplete What Next routes`);
    }
  }

  // === PASS 7: Question Loop Detection ===
  // CRITICAL: Detect flows where user keeps getting questions without actual content delivery
  // This is a major UX issue - user clicks "Ingredients" and gets another question instead of info
  {
    // Build a map of nodes for traversal
    const nodeMap = new Map<number, { message: string; nextNodes: number[]; richDests: number[] }>();
    
    for (let i = 1; i < fixedLines.length; i++) {
      const line = fixedLines[i];
      if (!line.trim()) continue;
      
      const fields = parseCSVLineForFix(line);
      const nodeNum = parseInt(fields[COL.NODE_NUM], 10);
      if (isNaN(nodeNum)) continue;
      
      const nodeType = fields[COL.NODE_TYPE]?.trim().toUpperCase();
      if (nodeType !== 'D') continue; // Only Decision nodes
      
      const message = fields[COL.MESSAGE]?.trim() || '';
      const nextNodesStr = fields[COL.NEXT_NODES]?.trim() || '';
      const richContent = fields[COL.RICH_CONTENT]?.trim() || '';
      
      // Parse next nodes
      const nextNodes: number[] = [];
      if (nextNodesStr) {
        const num = parseInt(nextNodesStr, 10);
        if (!isNaN(num) && num !== 1800) nextNodes.push(num); // Exclude GenAI fallback
      }
      
      // Parse button destinations
      const richDests: number[] = [];
      if (richContent.includes('~')) {
        // Pipe format
        richContent.split('|').forEach(btn => {
          const match = btn.match(/~(\d+)/);
          if (match) {
            const dest = parseInt(match[1], 10);
            if (!isNaN(dest) && dest !== 200 && dest !== 201 && dest !== 666 && dest !== 999) {
              richDests.push(dest);
            }
          }
        });
      } else if (richContent.startsWith('{')) {
        // JSON format
        try {
          const obj = JSON.parse(richContent);
          (obj.options || []).forEach((opt: any) => {
            const dest = parseInt(String(opt.dest), 10);
            if (!isNaN(dest) && dest !== 200 && dest !== 201 && dest !== 666 && dest !== 999) {
              richDests.push(dest);
            }
          });
        } catch { /* ignore */ }
      }
      
      nodeMap.set(nodeNum, { message, nextNodes, richDests });
    }
    
    // Detect question loops: 3+ consecutive questions without info
    const isQuestion = (msg: string): boolean => {
      const lower = msg.toLowerCase();
      return msg.includes('?') || 
             lower.includes('what ') ||
             lower.includes('which ') ||
             lower.includes('would you') ||
             lower.includes('do you') ||
             lower.includes('how can') ||
             lower.includes('select');
    };
    
    // Check paths from each node
    const questionLoopWarnings: string[] = [];
    
    for (const [startNode, data] of nodeMap) {
      // Only start from 3xx, 4xx, etc. flow entry points
      if (startNode < 300 || startNode % 100 !== 0) continue;
      
      // BFS to detect question loops
      const visited = new Set<number>();
      const queue: { node: number; questionDepth: number; path: number[] }[] = [];
      
      queue.push({ node: startNode, questionDepth: isQuestion(data.message) ? 1 : 0, path: [startNode] });
      
      while (queue.length > 0) {
        const { node, questionDepth, path } = queue.shift()!;
        
        if (visited.has(node)) continue;
        visited.add(node);
        
        const nodeData = nodeMap.get(node);
        if (!nodeData) continue;
        
        const isQ = isQuestion(nodeData.message);
        const newDepth = isQ ? questionDepth + 1 : 0;
        
        // Flag if we hit 4+ questions in a row (allowing 1 category + 1 subcategory + 1 specific)
        if (newDepth >= 4) {
          questionLoopWarnings.push(
            `WARNING: Question loop detected! Path ${path.join(' → ')} → ${node} has ${newDepth} consecutive questions without delivering information.`
          );
          continue; // Don't traverse further
        }
        
        // Add children to queue
        const children = [...nodeData.nextNodes, ...nodeData.richDests];
        for (const child of children) {
          if (!visited.has(child) && nodeMap.has(child)) {
            queue.push({ node: child, questionDepth: newDepth, path: [...path, child] });
          }
        }
      }
    }
    
    if (questionLoopWarnings.length > 0) {
      console.warn(`[PreValidation] PASS 7: ${questionLoopWarnings.length} question loop(s) detected - UX review recommended`);
      for (const warn of questionLoopWarnings) {
        console.warn(`[QuestionLoop] ${warn}`);
        fixes.push(warn);
      }
    }
  }

  return { csv: fixedLines.join('\n'), fixes };
}

/**
 * Parse a CSV line respecting quoted fields
 */
function parseCSVLineForFix(line: string): string[] {
  // Safety check - always return an array
  if (!line || typeof line !== 'string') {
    return [];
  }
  
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
}

/**
 * Clean up a JSON string that might have extra quoting
 * Handles cases where JSON is wrapped in extra quotes: '"{"type":...}"' -> '{"type":...}'
 */
function cleanJsonString(content: string): string {
  if (!content) return content;
  
  let cleaned = content.trim();
  
  // Remove outer quotes if present and content looks like quoted JSON
  // Pattern: "{ ... }" or '{ ... }'
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    const inner = cleaned.slice(1, -1);
    // Check if inner content is valid JSON
    try {
      JSON.parse(inner);
      cleaned = inner;
    } catch {
      // Not valid JSON after removing quotes, keep original
    }
  }
  
  // Also handle CSV-escaped quotes: ""{""type"":...}""
  if (cleaned.startsWith('""') || cleaned.includes('""')) {
    // This might be double-escaped - try to unescape
    const unescaped = cleaned.replace(/""/g, '"');
    // Remove outer quotes if they exist now
    if (unescaped.startsWith('"') && unescaped.endsWith('"')) {
      const inner = unescaped.slice(1, -1);
      try {
        JSON.parse(inner);
        cleaned = inner;
      } catch {
        // Try the unescaped version directly
        try {
          JSON.parse(unescaped);
          cleaned = unescaped;
        } catch {
          // Keep original
        }
      }
    }
  }
  
  return cleaned;
}

/**
 * Fix Rich Asset Content issues
 * Common issue: "dest" at root level instead of inside options
 * 
 * Note: richType parameter determines dest type:
 * - listpicker/imagebutton: dest should be STRING
 * - buttons/quick_reply: dest should be INTEGER
 */
function fixRichAssetContent(content: string, richType?: string): { fixed: string; wasFixed: boolean } {
  // First clean up any extra quoting
  const cleanContent = cleanJsonString(content);
  
  if (!cleanContent || !cleanContent.trim().startsWith('{')) {
    return { fixed: content, wasFixed: false };
  }
  
  try {
    const obj = JSON.parse(cleanContent);
    let wasFixed = cleanContent !== content; // If we cleaned it, it was fixed
    
    // Fix: dest at root level should be moved to each option
    if (obj.dest !== undefined && obj.options && Array.isArray(obj.options)) {
      const defaultDest = obj.dest;
      delete obj.dest;
      
      // Add dest to options that don't have it
      for (const opt of obj.options) {
        if (opt.dest === undefined) {
          opt.dest = defaultDest;
          wasFixed = true;
        }
      }
    }
    
    // Fix dest type based on Rich Asset Type
    // Listpicker/imagebutton use STRING dests, buttons/quick_reply use INTEGER dests
    if (obj.options && Array.isArray(obj.options)) {
      const useStringDest = richType === 'listpicker' || richType === 'imagebutton';
      
      for (const opt of obj.options) {
        if (opt.dest !== undefined) {
          if (useStringDest && typeof opt.dest === 'number') {
            // Convert to string for listpicker
            opt.dest = String(opt.dest);
            wasFixed = true;
          } else if (!useStringDest && typeof opt.dest === 'string') {
            // Convert to integer for buttons
            const parsed = parseInt(opt.dest, 10);
            if (!isNaN(parsed)) {
              opt.dest = parsed;
              wasFixed = true;
            }
          }
        }
      }
    }
    
    return { 
      fixed: JSON.stringify(obj), 
      wasFixed 
    };
  } catch {
    return { fixed: content, wasFixed: false };
  }
}

/**
 * Fix reserved characters inside button labels
 * Pattern: "$25|k" -> "$25k" (pipe character incorrectly inside label)
 * Pattern: "2|FA" -> "2FA" (pipe inside acronym like 2FA)
 * This fixes common AI mistakes where | appears inside labels instead of between buttons
 */
function fixReservedCharactersInButtons(content: string): { fixed: string; wasFixed: boolean } {
  // Skip if JSON format
  if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
    return { fixed: content, wasFixed: false };
  }
  
  // Check if it looks like button content
  if (!content.includes('~')) {
    return { fixed: content, wasFixed: false };
  }
  
  let fixedContent = content;
  
  // Fix 1: Price labels with pipe before 'k' (thousand) - "$25|k" -> "$25k"
  fixedContent = fixedContent.replace(/(\$\d+)\|([kK])/g, '$1$2');
  
  // Fix 2: Price labels with pipe before 'm' (million) - "$1|m" -> "$1m"
  fixedContent = fixedContent.replace(/(\$\d+)\|([mM])/g, '$1$2');
  
  // Fix 3: Acronyms like "2|FA" -> "2FA" (two-factor auth)
  // Pattern: digit|uppercase letters (common for 2FA, 3D, 4K, etc.)
  fixedContent = fixedContent.replace(/(\d)\|([A-Z]{1,3})(?=[\s~]|$)/g, '$1$2');
  
  // Fix 4: General pattern - pipe between alphanumeric characters within a button label
  // Look at each button individually (split by | and recombine smartly)
  // First, identify valid button separators: they come after ~nodeNum
  // Invalid pipes are inside labels (before the first ~ or between label chars)
  const buttons = fixedContent.split('|');
  const fixedButtons: string[] = [];
  
  for (let i = 0; i < buttons.length; i++) {
    let btn = buttons[i];
    
    // If this segment doesn't contain ~ and the previous one ended with ~number,
    // this is likely a continuation of a broken label
    if (i > 0 && !btn.includes('~') && fixedButtons.length > 0) {
      // Check if this looks like it should be part of the previous button's label
      // e.g., "Enable 2" + "FA~631" should become "Enable 2FA~631"
      const lastBtn = fixedButtons[fixedButtons.length - 1];
      if (!lastBtn.includes('~')) {
        // Previous button also has no ~, merge them
        fixedButtons[fixedButtons.length - 1] = lastBtn + btn;
        continue;
      } else if (btn.match(/^[A-Z]{1,4}~/)) {
        // This starts with uppercase letters then ~ (like "FA~631")
        // It's likely the second half of an acronym, merge with previous
        // But only if previous ends with a digit
        const prevParts = lastBtn.split('~');
        if (prevParts.length === 1 && prevParts[0].match(/\d$/)) {
          fixedButtons[fixedButtons.length - 1] = lastBtn + btn;
          continue;
        }
      }
    }
    
    fixedButtons.push(btn);
  }
  
  fixedContent = fixedButtons.join('|');
  
  return { 
    fixed: fixedContent, 
    wasFixed: fixedContent !== content 
  };
}

/**
 * Fix button pipe format - add missing | between button options
 * Pattern: "Label~100Label~200" -> "Label~100|Label~200"
 */
function fixButtonPipeFormat(content: string): { fixed: string; wasFixed: boolean } {
  // Skip if JSON format
  if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
    return { fixed: content, wasFixed: false };
  }
  
  // Check if it looks like button content (contains ~ but might be missing |)
  if (!content.includes('~')) {
    return { fixed: content, wasFixed: false };
  }
  
  // First, fix reserved characters inside labels (like $25|k -> $25k)
  let fixedContent = fixReservedCharactersInButtons(content).fixed;
  
  // Pattern: Label~node should be separated by |
  // Fix cases like "Option A~100Option B~200" -> "Option A~100|Option B~200"
  // Also fix "Option A~100 Option B~200" -> "Option A~100|Option B~200"
  fixedContent = fixedContent.replace(/(\d+)\s*([A-Za-z<])/g, '$1|$2');
  
  // Also fix double pipes or missing pipes after icons
  fixedContent = fixedContent.replace(/\|\|+/g, '|');
  
  return { 
    fixed: fixedContent, 
    wasFixed: fixedContent !== content 
  };
}

/**
 * Fix Parameter Input JSON errors
 * - Convert arrays to objects
 * - Unquote improperly quoted JSON
 * - Quote unquoted variable references
 */
function fixParameterInputJSON(content: string): { fixed: string; wasFixed: boolean } {
  if (!content || !content.trim()) {
    return { fixed: content, wasFixed: false };
  }
  
  let fixed = content.trim();
  let wasFixed = false;
  
  // Fix 1: If it starts with [ instead of {, it's an array - wrap in object
  if (fixed.startsWith('[')) {
    fixed = '{"items":' + fixed + '}';
    wasFixed = true;
    console.log('[Sanitize] Wrapped Parameter Input array in object');
  }
  
  // Fix 2: If it starts with "{ instead of { (quoted JSON), unquote
  if (fixed.startsWith('"{') && fixed.endsWith('}"')) {
    fixed = fixed.slice(1, -1).replace(/""/g, '"');
    wasFixed = true;
    console.log('[Sanitize] Unquoted Parameter Input JSON');
  }
  
  // Fix 3: Check if valid JSON, if not try to repair
  try {
    JSON.parse(fixed);
  } catch {
    // Try to fix common issues
    // Unquoted variables: {selected_date} -> "{selected_date}"
    const repaired = fixed.replace(/:\s*\{([^}]+)\}(?=[,}])/g, ':"{$1}"');
    try {
      JSON.parse(repaired);
      fixed = repaired;
      wasFixed = true;
      console.log('[Sanitize] Fixed unquoted variables in Parameter Input');
    } catch {
      // Couldn't repair, keep original
    }
  }
  
  return { fixed, wasFixed };
}

/**
 * Map BotManager field names to column indices
 * Includes display names, snake_case variants, and alternative API names
 */
function getColumnIndexByFieldName(fieldName: string): number {
  const fieldMap: Record<string, number> = {
    // Display names (from column headers)
    'Node Number': 0,
    'Node Type': 1,
    'Node Name': 2,
    'Intent': 3,
    'Entity Type': 4,
    'Entity': 5,
    'NLU Disabled?': 6,
    'Next Nodes': 7,
    'Message': 8,
    'Rich Asset Type': 9,
    'Rich Asset Content': 10,
    'Answer Required?': 11,
    'Behaviors': 12,
    'Command': 13,
    'Description': 14,
    'Output': 15,
    'Node Input': 16,
    'Parameter Input': 17,
    'Decision Variable': 18,
    'What Next?': 19,
    'Node Tags': 20,
    'Skill Tag': 21,
    'Variable': 22,
    'Platform Flag': 23,
    'Flows': 24,
    'CSS Classname': 25,
    // snake_case variants (BotManager API might use these)
    'node_number': 0,
    'node_type': 1,
    'node_name': 2,
    'intent': 3,
    'entity_type': 4,
    'entity': 5,
    'nlu_disabled': 6,
    'next_nodes': 7,
    'message': 8,
    'rich_asset_type': 9,
    'rich_asset_content': 10,
    'answer_required': 11,
    'ans_req': 11,
    'behaviors': 12,
    'command': 13,
    'action_script': 13,
    'description': 14,
    'output': 15,
    'node_input': 16,
    'parameter_input': 17,
    'decision_variable': 18,
    'dir_field': 18,
    'what_next': 19,
    'node_tags': 20,
    'skill_tag': 21,
    'variable': 22,
    'platform_flag': 23,
    'flows': 24,
    'css_classname': 25,
    // Alternative names
    'Destination': 7,
    'Default Destination': 7,
    'Action Script': 13,
  };
  return fieldMap[fieldName] ?? -1;
}

/**
 * Check if a specific node row still contains the error content
 * Much more targeted than checking the entire CSV string
 * If fieldName is provided, only checks that specific column (avoids false positives)
 */
function isErrorStillInNode(csv: string, nodeNum: number, errorContent: string, fieldName?: string): boolean {
  const lines = csv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Quick check: does this line start with the node number?
    const fields = parseCSVLineForFix(line);
    if (fields.length < 1) continue;
    const lineNodeNum = parseInt(fields[0], 10);
    if (lineNodeNum === nodeNum) {
      // If we know the field name, only check that specific column
      // This prevents false positives (e.g., fix sets "success" and we find "success" in another field)
      if (fieldName) {
        const colIdx = getColumnIndexByFieldName(fieldName);
        if (colIdx >= 0 && colIdx < fields.length) {
          return fields[colIdx]?.includes(errorContent) ?? false;
        }
      }
      // Fallback: check all fields (but this can cause false positives)
      return fields.some(f => f && f.includes(errorContent));
    }
  }
  // Node not found — can't verify, assume not present
  return false;
}

/**
 * Apply programmatic fix for a specific validation error
 * This is used as a fallback when AI refinement fails to fix an error
 */
function applyProgrammaticFixForError(csv: string, error: ValidationError): string {
  const errorDesc = error.err_msgs?.[0]?.error_description?.toLowerCase() || '';
  const errorContent = error.err_msgs?.[0]?.field_entry || '';
  const fieldName = error.err_msgs?.[0]?.field_name || '';
  
  // Fix: Pipe character inside button labels (e.g., "$25|k" -> "$25k")
  if (errorDesc.includes('pipe character') || errorDesc.includes('button construction')) {
    // Apply the reserved character fix to the entire CSV
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line; // Skip header
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 11) return line;
      
      // Check Rich Asset Content column (index 10)
      const richContent = fields[10];
      if (richContent && richContent.includes(errorContent)) {
        // Apply the fix
        const { fixed, wasFixed } = fixReservedCharactersInButtons(richContent);
        if (wasFixed) {
          fields[10] = fixed;
          console.log(`[Programmatic Fix] Fixed reserved characters in node row ${idx}`);
          return reconstructCSVLine(fields);
        }
      }
      return line;
    });
    return fixedLines.join('\n');
  }
  
  // Fix: NLU Disabled with multiple children
  if (errorDesc.includes('nlu disabled') && errorDesc.includes('one child')) {
    const nodeNum = error.node_num;
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line;
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 7) return line;
      
      const lineNodeNum = parseInt(fields[0], 10);
      if (lineNodeNum === nodeNum && fields[6]?.trim() === '1') {
        // Clear NLU Disabled
        fields[6] = '';
        console.log(`[Programmatic Fix] Cleared NLU Disabled for node ${nodeNum}`);
        return reconstructCSVLine(fields);
      }
      return line;
    });
    return fixedLines.join('\n');
  }
  
  // Fix: Parameter Input JSON errors
  if ((errorDesc.includes('json input error') || errorDesc.includes('expecting property name') || errorDesc.includes('expecting input')) && (fieldName === 'Parameter Input' || fieldName === 'parameter_input')) {
    const nodeNum = error.node_num;
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line;
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 18) return line;
      
      const lineNodeNum = parseInt(fields[0], 10);
      if (lineNodeNum === nodeNum && fields[17]) {
        let paramInput = fields[17].trim();
        
        // Fix 1: Remove extra closing braces
        let openBraces = (paramInput.match(/{/g) || []).length;
        let closeBraces = (paramInput.match(/}/g) || []).length;
        while (closeBraces > openBraces) {
          paramInput = paramInput.replace(/}([^}]*)$/, '$1');
          closeBraces--;
        }
        
        // Fix 2: Array to object — [{"key":"val"}] → {"set":{"key":"val"}}
        if (paramInput.startsWith('[')) {
          try {
            const arr = JSON.parse(paramInput);
            if (Array.isArray(arr) && arr.length > 0) {
              paramInput = JSON.stringify({ set: arr[0] });
            }
          } catch { /* keep as-is */ }
        }
        
        // Fix 3: Unquoted variable refs — {var_name} → "{var_name}"
        paramInput = paramInput.replace(/:(\s*)\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ':$1"{$2}"');
        
        // Fix 4: Validate final JSON - if still broken, DON'T modify (let AI try)
        try {
          JSON.parse(paramInput);
          // JSON is valid now, apply the fix
          fields[17] = paramInput;
          console.log(`[Programmatic Fix] Fixed Parameter Input JSON for node ${nodeNum}`);
          return reconstructCSVLine(fields);
        } catch {
          // JSON is still broken - don't apply a placeholder, let AI try to fix it
          console.log(`[Programmatic Fix] Parameter Input unfixable for node ${nodeNum}, deferring to AI`);
          return line; // Return original line unchanged
        }
      }
      return line;
    });
    return fixedLines.join('\n');
  }
  
  // Fix: Decision Variable mismatch ("dir_field not in payload")
  if (errorDesc.includes('dir_field') || errorDesc.includes('proposed dir_field')) {
    const nodeNum = error.node_num;
    
    // CRITICAL: Skip programmatic fixes for startup nodes that are managed by injectRequiredStartupNodes
    // These nodes have specific configurations that should NOT be overwritten
    const PROTECTED_STARTUP_NODES = new Set([
      -500, // HandleBotError - decVar: error_type
      1, // SysShowMetadata - decVar: success
      10, // UserPlatformRouting - decVar: success (but special What Next)
      100, 101, 102, // Platform SetVar - decVar: success
      104, // SysSetEnv - decVar: success
      105, // InitContext - decVar: success
      1800, // GenAIFallback - decVar: result (NOT success!)
      1803, // RouteDetectedIntent - decVar: route_to
      1804, // FallbackLoop - may have special config
    ]);
    
    if (nodeNum !== undefined && PROTECTED_STARTUP_NODES.has(nodeNum)) {
      console.log(`[Programmatic Fix] Skipping protected startup node ${nodeNum} - will be handled by startup injection`);
      return csv; // Don't modify - let injectRequiredStartupNodes handle it
    }
    
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line;
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 20) return line;
      
      const lineNodeNum = parseInt(fields[0], 10);
      if (lineNodeNum === nodeNum) {
        const nodeType = fields[1]?.trim().toUpperCase();
        
        // For Decision nodes: CLEAR Action-only columns - D nodes should NOT have Decision Variable
        if (nodeType === 'D') {
          // Move any message from Node Input (col 16) to Message (col 8) if Message is empty
          if (!fields[8]?.trim() && fields[16]?.trim()) {
            fields[8] = fields[16];
            fields[16] = '';
            console.log(`[Programmatic Fix] Moved message from Node Input to Message for node ${nodeNum}`);
          }
          // Clear Action-only columns: Command(13), Description(14), Output(15), ParamInput(17), DecisionVar(18), WhatNext(19)
          fields[13] = '';
          fields[14] = '';
          fields[15] = '';
          fields[17] = '';
          fields[18] = '';
          fields[19] = '';
          console.log(`[Programmatic Fix] Cleared Action-only columns for Decision node ${nodeNum}`);
          return reconstructCSVLine(fields);
        }
        
        // For Action nodes: Use command-specific Decision Variable, not just "success"
        const command = fields[13]?.trim() || '';
        const COMMAND_TO_DECVAR: Record<string, string> = {
          'SysAssignVariable': 'success',
          'SysShowMetadata': 'success',
          'SysSetEnv': 'success',
          'SysVariableReset': 'success',
          'HandleBotError': 'error_type',
          'UserPlatformRouting': 'success',
          'GenAIFallback': 'result',
          'ValidateRegex': 'success',
          'ValidateDate': 'success',
          'GetValue': 'success',
          'SetVar': 'success',
          'VarCheck': 'valid',
          'LimitCounter': 'valid',
          'BotToPlatform': 'success',
          'SysMultiMatchRouting': 'route_to', // Uses output variable name
        };
        
        const correctDecVar = COMMAND_TO_DECVAR[command] || 'success';
        fields[18] = correctDecVar;
        
        // Only fix What Next if it's empty or clearly wrong for the decision variable
        const wn = fields[19]?.trim();
        if (!wn) {
          // Generate appropriate What Next based on the decision variable
          if (correctDecVar === 'success') {
            fields[19] = 'true~' + (fields[7]?.trim()?.split(/[,|]/)[0] || '201') + '|false~99990|error~99990';
          } else if (correctDecVar === 'error_type') {
            fields[19] = 'bot_error~99990|bot_timeout~99990|other~99990';
          } else if (correctDecVar === 'valid') {
            fields[19] = 'true~' + (fields[7]?.trim()?.split(/[,|]/)[0] || '201') + '|false~99990|error~99990';
          }
          // For other decision variables, leave What Next alone - AI or startup injection will handle
        }
        console.log(`[Programmatic Fix] Fixed Decision Variable for Action node ${nodeNum} → "${correctDecVar}"`);
        return reconstructCSVLine(fields);
      }
      return line;
    });
    return fixedLines.join('\n');
  }
  
  // Fix: Variable not ALL_CAPS
  if (errorDesc.includes('capital letters') || errorDesc.includes('all capital')) {
    const nodeNum = error.node_num;
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line;
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 23) return line;
      
      const lineNodeNum = parseInt(fields[0], 10);
      if (lineNodeNum === nodeNum && fields[22]) {
        fields[22] = fields[22].trim().toUpperCase().replace(/[\s-]+/g, '_');
        console.log(`[Programmatic Fix] Fixed Variable case for node ${nodeNum} → ${fields[22]}`);
        return reconstructCSVLine(fields);
      }
      return line;
    });
    return fixedLines.join('\n');
  }
  
  // Fix: Answer Required must be 1 for datepicker/timepicker/file_upload
  if (errorDesc.includes('ans_req') && errorDesc.includes('1')) {
    const nodeNum = error.node_num;
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line;
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 12) return line;
      
      const lineNodeNum = parseInt(fields[0], 10);
      if (lineNodeNum === nodeNum) {
        fields[11] = '1';
        console.log(`[Programmatic Fix] Set Answer Required=1 for node ${nodeNum}`);
        return reconstructCSVLine(fields);
      }
      return line;
    });
    return fixedLines.join('\n');
  }
  
  // Fix: Node number not an integer (broken row from multi-line message)
  if (errorDesc.includes('not an integer') && fieldName === 'Node Number') {
    // This usually means a message with newlines broke into separate rows
    // Remove the orphan row since the content should be in the Message column
    const lines = csv.split('\n');
    const fixedLines = lines.filter((line, idx) => {
      if (idx === 0) return true; // Keep header
      const firstComma = line.indexOf(',');
      const firstField = firstComma > 0 ? line.substring(0, firstComma).trim() : line.trim();
      const nodeNum = parseInt(firstField, 10);
      // Keep valid rows, remove rows where first field isn't a number
      if (isNaN(nodeNum) && firstField.length > 0) {
        console.log(`[Programmatic Fix] Removed orphan row (non-integer Node Number): "${firstField.substring(0, 40)}..."`);
        return false;
      }
      return true;
    });
    return fixedLines.join('\n');
  }
  
  // Fix: Rich Asset Type invalid - content exists but type is missing/invalid
  if (errorDesc.includes('rich type is invalid') || (fieldName === 'Rich Asset Content' && errorDesc.includes('embed type'))) {
    const nodeNum = error.node_num;
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line;
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 11) return line;
      
      const lineNodeNum = parseInt(fields[0], 10);
      if (lineNodeNum === nodeNum) {
        const richContent = fields[10]?.trim() || '';
        if (richContent) {
          const isJsonFormat = richContent.startsWith('{') || richContent.startsWith('[');
          const isPipeFormat = richContent.includes('~') && !richContent.startsWith('{');
          
          if (isPipeFormat) {
            fields[9] = 'button';
            console.log(`[Programmatic Fix] Set Rich Asset Type to 'button' for pipe content at node ${nodeNum}`);
          } else if (isJsonFormat) {
            // Try to detect the type from JSON content
            try {
              const parsed = JSON.parse(richContent);
              if (parsed.url) {
                fields[9] = 'webview';
              } else if (parsed.options?.some((opt: { description?: string }) => opt.description)) {
                fields[9] = 'listpicker';
              } else {
                fields[9] = 'buttons';
              }
            } catch {
              fields[9] = 'buttons';
            }
            console.log(`[Programmatic Fix] Set Rich Asset Type to '${fields[9]}' for JSON content at node ${nodeNum}`);
          }
          return reconstructCSVLine(fields);
        }
      }
      return line;
    });
    return fixedLines.join('\n');
  }
  
  return csv;
}

/**
 * Reconstruct a CSV line from fields with proper escaping
 */
function reconstructCSVLine(fields: string[]): string {
  return fields.map(f => {
    if (!f) return '';
    const str = String(f);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }).join(',');
}

/**
 * Sanitize CSV for deployment - fixes common issues
 * Implements 17 programmatic fixes based on Pypestream documentation
 * 
 * Fix List:
 * 1. Rich Asset Type/Format Match - Change button↔buttons based on content format
 * 2. Button Pipe Format - Add missing | between button options  
 * 3. Parameter Input JSON - Fix arrays to objects, quote variables
 * 4. Variable ALL_CAPS - Convert lowercase to UPPERCASE
 * 5. Datepicker Message Column - Clear Message for datepicker/timepicker
 * 6. Datepicker JSON - Remove message property from JSON
 * 7. Datepicker Answer Required - Set to 1
 * 8. Datepicker Behaviors - Add disable_input
 * 9. NLU Disabled + Next Nodes - Reduce to single node
 * 10. Decision Variable - Add 'success' if missing
 * 11. What Next Error Path - Append |error~99990
 * 12. Empty Command - Add SysAssignVariable placeholder
 * 13. Listpicker dest type - STRING for listpicker, INTEGER for buttons
 * 14. xfer_to_agent + Next Nodes - Clear Next Nodes
 * 15. Dynamic embed + disable_input - Add behavior
 * 16. Dynamic embed + NLU Disabled - Set to 1
 * 17. File upload validation - Ensure required JSON properties
 */
export function sanitizeCSVForDeploy(csv: string): string {
  const lines = csv.split('\n');
  if (lines.length < 2) return csv;
  
  // Column indices (0-indexed)
  const NODE_NUM_COL = 0;
  const NODE_TYPE_COL = 1;
  const NLU_DISABLED_COL = 6;
  const NEXT_NODES_COL = 7;
  const MESSAGE_COL = 8;
  const RICH_TYPE_COL = 9;
  const RICH_CONTENT_COL = 10;
  const ANSWER_REQ_COL = 11;
  const BEHAVIORS_COL = 12;
  const COMMAND_COL = 13;
  const PARAM_INPUT_COL = 17;
  const DECISION_VAR_COL = 18;
  const WHAT_NEXT_COL = 19;
  const VARIABLE_COL = 22;
  
  const fixedLines: string[] = [lines[0]]; // Keep header
  let hasNode1 = false;
  let skippedRows = 0;
  let fixesApplied = 0;
  
  // FIRST PASS: Collect all valid node numbers for reference lookup
  const allNodeNumbers = new Set<number>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const tempFields = parseCSVLineForFix(line);
    const numStr = tempFields[NODE_NUM_COL]?.trim() || '';
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && numStr === String(num)) {
      allNodeNumbers.add(num);
    }
  }
  
  // Helper: Find the actual previous node that exists (not just nodeNum - 1)
  const findPreviousExistingNode = (beforeNode: number): number => {
    const candidates = Array.from(allNodeNumbers).filter(n => n < beforeNode && n > 0).sort((a, b) => b - a);
    return candidates.length > 0 ? candidates[0] : beforeNode - 1;
  };
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      fixedLines.push(line);
      continue;
    }
    
    const fields = parseCSVLineForFix(line);
    
    // Ensure we have enough columns (pad if needed)
    while (fields.length < 26) {
      fields.push('');
    }
    
    // Check if Node Number is valid (integer)
    const nodeNumStr = fields[NODE_NUM_COL]?.trim() || '';
    const nodeNum = parseInt(nodeNumStr, 10);
    
    // Skip rows with invalid node numbers (bullet points, text, numbered steps, etc.)
    // Detect numbered steps like "1. Tap your profile photo", "2. Go to 'Payment'"
    const hasTextAfterNumber = /^\d+\.\s*[A-Za-z]/.test(nodeNumStr);
    // Catch bullets, asterisks, quotes (common leaked content patterns)
    // NOTE: Don't catch "-" alone - negative numbers like -500 are valid system nodes!
    const startsWithLeakedChar = /^[•*"']/.test(nodeNumStr) || /^-[^0-9]/.test(nodeNumStr);
    // No valid node number is 7+ characters (max is -99999 = 6 chars)
    const isTooLong = nodeNumStr.length > 6;
    // Also catch values that don't match the parsed number exactly (e.g., "1abc" parses as 1)
    const isExactInt = nodeNumStr === String(nodeNum);
    
    if (isNaN(nodeNum) || !isExactInt || startsWithLeakedChar || nodeNumStr.includes(':') || hasTextAfterNumber || isTooLong) {
      console.warn(`[Sanitize] Skipping row ${i + 1} with invalid Node Number: "${nodeNumStr.substring(0, 50)}"`);
      skippedRows++;
      continue;
    }
    
    // Track if we have node 1
    if (nodeNum === 1) hasNode1 = true;
    
    let needsReconstruct = false;
    const nodeType = fields[NODE_TYPE_COL]?.trim().toUpperCase();
    let richType = fields[RICH_TYPE_COL]?.trim().toLowerCase();
    const richContent = fields[RICH_CONTENT_COL]?.trim() || '';
    const behaviorsCol = fields[BEHAVIORS_COL]?.trim().toLowerCase() || '';
    const commandField = fields[COMMAND_COL]?.trim() || '';
    
    // Debug logging for Action nodes
    if (nodeType === 'A' && !commandField) {
      console.log(`[Sanitize] DEBUG: Node ${nodeNum} is Action type with empty Command. Will fix.`);
    }
    
    // Debug logging for datepicker
    if (richType === 'datepicker' || richType === 'timepicker') {
      console.log(`[Sanitize] DEBUG: Node ${nodeNum} is ${richType}, content: ${richContent.substring(0, 80)}`);
    }
    
    // ========================================
    // FIX 1: Rich Asset Type/Format Mismatch
    // ========================================
    if (richContent) {
      const isJsonFormat = richContent.startsWith('{') || richContent.startsWith('[');
      const isPipeFormat = richContent.includes('~') && !richContent.startsWith('{');
      
      // FIX 1a: Rich Asset Content exists but Rich Asset Type is empty or invalid
      if (!richType || !['button', 'buttons', 'listpicker', 'quick_reply', 'carousel', 'webview', 'datepicker', 'timepicker', 'file_upload', 'imagebutton'].includes(richType)) {
        if (isPipeFormat) {
          // Pipe format (Label~dest|Label~dest) needs 'button' (singular)
          fields[RICH_TYPE_COL] = 'button';
          richType = 'button';
          needsReconstruct = true;
          fixesApplied++;
          console.log(`[Sanitize] Set missing Rich Asset Type to 'button' for pipe content at node ${nodeNum}`);
        } else if (isJsonFormat) {
          // JSON format needs 'buttons' (plural) by default - can be listpicker too
          try {
            const parsed = JSON.parse(richContent);
            if (parsed.type === 'dynamic' || (parsed.options && Array.isArray(parsed.options))) {
              // Check if it looks more like a listpicker (has description fields)
              const hasDescriptions = parsed.options?.some((opt: { description?: string }) => opt.description);
              fields[RICH_TYPE_COL] = hasDescriptions ? 'listpicker' : 'buttons';
              richType = hasDescriptions ? 'listpicker' : 'buttons';
            } else if (parsed.url) {
              fields[RICH_TYPE_COL] = 'webview';
              richType = 'webview';
            } else {
              fields[RICH_TYPE_COL] = 'buttons';
              richType = 'buttons';
            }
          } catch {
            fields[RICH_TYPE_COL] = 'buttons';
            richType = 'buttons';
          }
          needsReconstruct = true;
          fixesApplied++;
          console.log(`[Sanitize] Set missing Rich Asset Type to '${richType}' for JSON content at node ${nodeNum}`);
        }
      } else if (richType === 'button' && isJsonFormat) {
        // Change to 'buttons' (plural) for JSON format
        fields[RICH_TYPE_COL] = 'buttons';
        richType = 'buttons';
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Changed Rich Asset Type from 'button' to 'buttons' for JSON content at node ${nodeNum}`);
      } else if (richType === 'buttons' && isPipeFormat) {
        // Change to 'button' (singular) for pipe format
        fields[RICH_TYPE_COL] = 'button';
        richType = 'button';
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Changed Rich Asset Type from 'buttons' to 'button' for pipe content at node ${nodeNum}`);
      } else if ((richType === 'quick_reply' || richType === 'listpicker') && isPipeFormat) {
        // CRITICAL FIX: quick_reply and listpicker REQUIRE JSON format, not pipe format
        // Convert pipe format (Label~dest|Label~dest) to JSON format
        try {
          const buttons = richContent.split('|').filter((b: string) => b.trim());
          const options: Array<{ label: string; dest: string; description?: string }> = [];
          
          for (const btn of buttons) {
            // Handle pipes within labels (e.g., "15-30|people~721" should be "15-30 people~721")
            // Find the LAST ~ which is the separator between label and dest
            const lastTildeIdx = btn.lastIndexOf('~');
            if (lastTildeIdx > 0) {
              let label = btn.substring(0, lastTildeIdx).trim();
              const dest = btn.substring(lastTildeIdx + 1).trim();
              
              // Replace any remaining pipes in the label with spaces
              label = label.replace(/\|/g, ' ');
              
              if (label && dest) {
                options.push({ label, dest });
              }
            }
          }
          
          if (options.length > 0) {
            const jsonContent = JSON.stringify({ type: 'static', options });
            fields[RICH_CONTENT_COL] = jsonContent;
            needsReconstruct = true;
            fixesApplied++;
            console.log(`[Sanitize] Converted pipe format to JSON for ${richType} at node ${nodeNum}: ${options.length} options`);
          }
        } catch (e) {
          console.warn(`[Sanitize] Failed to convert pipe format to JSON for ${richType} at node ${nodeNum}:`, e);
        }
      }
    }
    
    // ========================================
    // FIX 2: Button Pipe Format (missing |)
    // ========================================
    if (richContent && !richContent.startsWith('{')) {
      const { fixed, wasFixed } = fixButtonPipeFormat(richContent);
      if (wasFixed) {
        fields[RICH_CONTENT_COL] = fixed;
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Fixed missing pipe in button format at node ${nodeNum}`);
      }
    }
    
    // ========================================
    // FIX 13: Rich Asset Content JSON validation and repair
    // ========================================
    if (richContent && (richContent.startsWith('{') || richContent.startsWith('"'))) {
      // First, try to validate the JSON
      let jsonContent = richContent;
      let jsonFixed = false;
      
      // Clean up common JSON issues
      const cleanedContent = cleanJsonString(richContent);
      if (cleanedContent !== richContent) {
        jsonContent = cleanedContent;
        jsonFixed = true;
      }
      
      // Validate and attempt repair
      try {
        JSON.parse(jsonContent);
      } catch (parseError) {
        // JSON is invalid - try to repair common issues
        console.log(`[Sanitize] Invalid JSON at node ${nodeNum}, attempting repair: ${jsonContent.substring(0, 100)}`);
        
        let repaired = jsonContent;
        
        // Fix 1: Remove trailing commas before } or ]
        repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
        
        // Fix 2: Add missing quotes around property names (handles: options: -> "options":)
        repaired = repaired.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
        
        // Fix 3: Replace single quotes with double quotes
        repaired = repaired.replace(/'/g, '"');
        
        // Fix 4: Quote unquoted string values (handles: "label":Continue -> "label":"Continue")
        // This regex matches :"value" where value is unquoted alphanumeric with spaces
        repaired = repaired.replace(/:(\s*)([A-Za-z][A-Za-z0-9\s]*?)(\s*[,}\]])/g, ':"$2"$3');
        
        // Fix 5: Close unclosed brackets - count { vs } and [ vs ]
        const openBraces = (repaired.match(/{/g) || []).length;
        const closeBraces = (repaired.match(/}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/]/g) || []).length;
        
        // Add missing closing brackets
        for (let i = 0; i < openBrackets - closeBrackets; i++) {
          repaired += ']';
        }
        for (let i = 0; i < openBraces - closeBraces; i++) {
          repaired += '}';
        }
        
        try {
          JSON.parse(repaired);
          jsonContent = repaired;
          jsonFixed = true;
          console.log(`[Sanitize] Repaired JSON at node ${nodeNum}: ${repaired.substring(0, 100)}`);
        } catch (repairError) {
          // Still invalid - if it's buttons/listpicker/quick_reply, create a default
          if (richType === 'buttons' || richType === 'quick_reply' || richType === 'listpicker') {
            jsonContent = '{"type":"static","options":[{"label":"Continue","dest":105}]}';
            jsonFixed = true;
            console.warn(`[Sanitize] Created default ${richType} JSON at node ${nodeNum} (original was unrepairable: ${jsonContent.substring(0, 50)})`);
          } else {
            console.error(`[Sanitize] Could not repair JSON at node ${nodeNum}: ${repairError}`);
          }
        }
      }
      
      // Now apply dest type fixes
      const { fixed, wasFixed } = fixRichAssetContent(jsonContent, richType);
      if (wasFixed || jsonFixed) {
        fields[RICH_CONTENT_COL] = fixed;
        needsReconstruct = true;
        fixesApplied++;
      }
    }
    
    // ========================================
    // FIX 5 & 6: Datepicker/Timepicker - Ensure proper JSON format with REQUIRED message property
    // Bot Manager REQUIRES: {"type":"static","message":"..."} AND Message column MUST be empty
    // ========================================
    if (richType === 'datepicker' || richType === 'timepicker') {
      const defaultMessage = richType === 'datepicker' ? 'Please select a date' : 'Please select a time';
      
      // CRITICAL FIX: Message column MUST be empty for datepicker/timepicker
      // BotManager error: "Interaction string must be empty when rich type is date/time picker"
      const messageContent = fields[MESSAGE_COL]?.trim() || '';
      if (messageContent) {
        // Merge message into existing Rich Asset Content JSON (don't overwrite)
        const existingContent = fields[RICH_CONTENT_COL]?.trim();
        if (existingContent) {
          try {
            const parsed = JSON.parse(existingContent);
            if (!parsed.message) {
              parsed.message = messageContent;
              parsed.type = parsed.type || 'static';
              fields[RICH_CONTENT_COL] = JSON.stringify(parsed);
            }
          } catch {
            // Existing content isn't valid JSON, create new
            fields[RICH_CONTENT_COL] = JSON.stringify({ type: 'static', message: messageContent });
          }
        } else {
          fields[RICH_CONTENT_COL] = JSON.stringify({ type: 'static', message: messageContent });
        }
        fields[MESSAGE_COL] = ''; // CLEAR - required by BotManager
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Moved message to Rich Asset Content and cleared Message for ${richType} at node ${nodeNum}`);
      }
      
      if (fields[RICH_CONTENT_COL]) {
        try {
          const content = cleanJsonString(fields[RICH_CONTENT_COL]);
          const obj = JSON.parse(content);
          let modified = false;
          
          // Ensure type is 'static' (REQUIRED)
          if (obj.type !== 'static') {
            obj.type = 'static';
            modified = true;
          }
          
          // Ensure message property exists (REQUIRED by Bot Manager)
          if (!obj.message) {
            obj.message = defaultMessage;
            modified = true;
            console.log(`[Sanitize] Added required message to ${richType} JSON at node ${nodeNum}`);
          }
          
          if (modified) {
            fields[RICH_CONTENT_COL] = JSON.stringify(obj);
            needsReconstruct = true;
            fixesApplied++;
          }
        } catch {
          // If not valid JSON, create proper format with required message
          fields[RICH_CONTENT_COL] = JSON.stringify({ type: 'static', message: defaultMessage });
          needsReconstruct = true;
          fixesApplied++;
          console.log(`[Sanitize] Created valid ${richType} JSON with message at node ${nodeNum}`);
        }
      } else {
        // No Rich Asset Content - create it
        fields[RICH_CONTENT_COL] = JSON.stringify({ type: 'static', message: defaultMessage });
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Created ${richType} JSON at node ${nodeNum}`);
      }
    }
    
    // ========================================
    // FIX 7: Datepicker/Timepicker/file_upload must have Answer Required = 1
    // ========================================
    if ((richType === 'datepicker' || richType === 'timepicker' || richType === 'file_upload') 
        && fields[ANSWER_REQ_COL]?.trim() !== '1') {
      fields[ANSWER_REQ_COL] = '1';
      needsReconstruct = true;
      fixesApplied++;
      console.log(`[Sanitize] Set Answer Required=1 for ${richType} at node ${nodeNum}`);
    }
    
    // ========================================
    // FIX 8: Datepicker/Timepicker should have disable_input behavior
    // ========================================
    if ((richType === 'datepicker' || richType === 'timepicker') 
        && !fields[BEHAVIORS_COL]?.includes('disable_input')) {
      fields[BEHAVIORS_COL] = fields[BEHAVIORS_COL] 
        ? fields[BEHAVIORS_COL] + ',disable_input' 
        : 'disable_input';
      needsReconstruct = true;
      fixesApplied++;
    }
    
    // ========================================
    // FIX 14: xfer_to_agent must have EMPTY Next Nodes
    // ========================================
    if (behaviorsCol.includes('xfer_to_agent') && fields[NEXT_NODES_COL]?.trim()) {
      fields[NEXT_NODES_COL] = '';
      needsReconstruct = true;
      fixesApplied++;
      console.log(`[Sanitize] Cleared Next Nodes for xfer_to_agent at node ${nodeNum}`);
    }
    
    // ========================================
    // FIX 15 & 16: Dynamic embeds require NLU Disabled=1 and disable_input
    // ========================================
    if (richContent.includes('"type":"dynamic"') || richContent.includes('"type": "dynamic"')) {
      // FIX 16: Must have NLU Disabled = 1
      if (fields[NLU_DISABLED_COL]?.trim() !== '1') {
        fields[NLU_DISABLED_COL] = '1';
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Set NLU Disabled=1 for dynamic embed at node ${nodeNum}`);
      }
      
      // FIX 15: Must have disable_input in Behaviors
      if (!fields[BEHAVIORS_COL]?.includes('disable_input')) {
        fields[BEHAVIORS_COL] = fields[BEHAVIORS_COL] 
          ? fields[BEHAVIORS_COL] + ',disable_input' 
          : 'disable_input';
        needsReconstruct = true;
        fixesApplied++;
      }
    }
    
    // ========================================
    // FIX 9: NLU Disabled + multiple Next Nodes - reduce to single node
    // ========================================
    if (fields[NLU_DISABLED_COL]?.trim() === '1') {
      // Check for multiple nodes (comma or pipe separated)
      const nextNodes = fields[NEXT_NODES_COL]?.trim() || '';
      if (nextNodes.includes(',') || nextNodes.includes('|')) {
        // Take only the first node
        const nodes = nextNodes.split(/[,|]/).filter(n => n.trim());
        if (nodes.length > 1) {
          fields[NEXT_NODES_COL] = nodes[0].trim();
          needsReconstruct = true;
          fixesApplied++;
          console.log(`[Sanitize] Reduced Next Nodes to single for NLU Disabled node ${nodeNum}`);
        }
      }
    }
    
    // ========================================
    // FIX 17: File upload validation - ensure required JSON properties
    // ========================================
    if (richType === 'file_upload' && fields[RICH_CONTENT_COL]) {
      try {
        const content = cleanJsonString(fields[RICH_CONTENT_COL]);
        const obj = JSON.parse(content);
        let modified = false;
        
        // Ensure type is present
        if (!obj.type) {
          obj.type = 'action_node';
          modified = true;
        }
        
        // Ensure upload_label is present
        if (!obj.upload_label) {
          obj.upload_label = 'Upload file';
          modified = true;
        }
        
        // Ensure cancel_label is present
        if (!obj.cancel_label) {
          obj.cancel_label = 'Skip';
          modified = true;
        }
        
        if (modified) {
          fields[RICH_CONTENT_COL] = JSON.stringify(obj);
          needsReconstruct = true;
          fixesApplied++;
          console.log(`[Sanitize] Added missing file_upload properties at node ${nodeNum}`);
        }
      } catch {
        // Create proper file upload format
        fields[RICH_CONTENT_COL] = JSON.stringify({
          type: 'action_node',
          upload_label: 'Upload file',
          cancel_label: 'Skip'
        });
        needsReconstruct = true;
        fixesApplied++;
      }
    }
    
    // ========================================
    // FIX 3: Parameter Input JSON errors
    // ========================================
    if (fields[PARAM_INPUT_COL]?.trim()) {
      const { fixed, wasFixed } = fixParameterInputJSON(fields[PARAM_INPUT_COL]);
      if (wasFixed) {
        fields[PARAM_INPUT_COL] = fixed;
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Fixed Parameter Input JSON at node ${nodeNum}`);
      }
    }
    
    // ========================================
    // FIX 4: Variable column ALL_CAPS
    // ========================================
    const variableCol = fields[VARIABLE_COL]?.trim();
    if (variableCol && /[a-z]/.test(variableCol)) {
      // Convert to uppercase, replacing spaces/hyphens with underscores
      fields[VARIABLE_COL] = variableCol
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
      needsReconstruct = true;
      fixesApplied++;
      console.log(`[Sanitize] Converted Variable to ALL_CAPS at node ${nodeNum}: ${fields[VARIABLE_COL]}`);
    }
    
    // ========================================
    // FIX 10: Action nodes with What Next but no Decision Variable
    // ========================================
    if (nodeType === 'A' && fields[WHAT_NEXT_COL]?.trim() && !fields[DECISION_VAR_COL]?.trim()) {
      fields[DECISION_VAR_COL] = 'success';
      needsReconstruct = true;
      fixesApplied++;
      console.log(`[Sanitize] Added Decision Variable 'success' to node ${nodeNum}`);
    }
    
    // ========================================
    // FIX 11: What Next should have error path
    // ========================================
    if (nodeType === 'A' && fields[WHAT_NEXT_COL]?.trim()) {
      const whatNext = fields[WHAT_NEXT_COL].trim();
      if (!whatNext.toLowerCase().includes('error~')) {
        fields[WHAT_NEXT_COL] = whatNext + '|error~99990';
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] Added error path to What Next at node ${nodeNum}`);
      }
    }
    
    // ========================================
    // FIX 12: Empty Command on Action nodes - CRITICAL!
    // Error: "Command string must follow camelcase convention" means Command is empty
    // 
    // EXCEPTION: Skip critical startup nodes - they're managed by injectRequiredStartupNodes
    // which will replace them entirely with the correct template
    // ========================================
    const CRITICAL_STARTUP_NODES_F12 = new Set([
      -500, // HandleBotError
      1, 10, // ShowMetadata, UserPlatformRouting
      100, 101, 102, 103, 104, 105, // Platform routing + SetEnv + InitContext
      1800, 1802, 1803, 1804, // GenAI fallback chain
      200, 201, 210, 300, // Main menu nodes
    ]);
    
    if (nodeType === 'A') {
      const commandValue = fields[COMMAND_COL]?.trim() || '';
      if (!commandValue) {
        // SKIP critical startup nodes - injectRequiredStartupNodes handles these
        if (CRITICAL_STARTUP_NODES_F12.has(nodeNum)) {
          console.log(`[Sanitize] FIX 12: Skipping startup node ${nodeNum} - will be handled by startup injection`);
        } else {
          fields[COMMAND_COL] = 'SysAssignVariable';
          // Also add default Parameter Input if missing
          if (!fields[PARAM_INPUT_COL]?.trim()) {
            fields[PARAM_INPUT_COL] = '{"set":{"PLACEHOLDER":"value"}}';
          }
          // Add Decision Variable and What Next if missing
          if (!fields[DECISION_VAR_COL]?.trim()) {
            fields[DECISION_VAR_COL] = 'success';
          }
          if (!fields[WHAT_NEXT_COL]?.trim()) {
            fields[WHAT_NEXT_COL] = 'true~105|error~99990';
          }
          needsReconstruct = true;
          fixesApplied++;
          console.warn(`[Sanitize] FIX 12: Added SysAssignVariable to empty Action node ${nodeNum}`);
        }
      }
    }
    
    // ========================================
    // FIX 13: SysAssignVariable - populate Variable column with ALL set variables
    // Error: "Referenced global variable does not exist" means Variable column is incomplete
    // ========================================
    if (nodeType === 'A' && commandField === 'SysAssignVariable') {
      let paramInput = fields[PARAM_INPUT_COL]?.trim() || '';
      
      // FIX 13b: Ensure 'success' is in the payload if Decision Variable is 'success'
      // Error: "proposed dir_field is not an element of the proposed payload"
      const decVar = fields[DECISION_VAR_COL]?.trim();
      if (decVar === 'success') {
        try {
          // If paramInput is empty, create it
          if (!paramInput || paramInput === '{}') {
            paramInput = '{"set":{"success":"true"}}';
            fields[PARAM_INPUT_COL] = paramInput;
            needsReconstruct = true;
            fixesApplied++;
            console.log(`[Sanitize] FIX 13b: Added default payload {"set":{"success":"true"}} for node ${nodeNum}`);
          } else {
            const parsed = JSON.parse(paramInput);
            if (parsed.set && typeof parsed.set === 'object') {
              // Check if 'success' key exists (case-insensitive)
              const hasSuccess = Object.keys(parsed.set).some(k => k.toLowerCase() === 'success');
              if (!hasSuccess) {
                // Add success: "true" to the set object
                parsed.set['success'] = 'true';
                paramInput = JSON.stringify(parsed);
                fields[PARAM_INPUT_COL] = paramInput;
                needsReconstruct = true;
                fixesApplied++;
                console.log(`[Sanitize] FIX 13b: Added "success":"true" to payload for node ${nodeNum}`);
              }
            }
          }
        } catch { /* ignore JSON errors, handled elsewhere */ }
      }

      if (paramInput) {
        try {
          const parsed = JSON.parse(paramInput);
          if (parsed.set && typeof parsed.set === 'object') {
            // Get all variable names from the set object, convert to uppercase
            const setVars = Object.keys(parsed.set)
              .filter(k => k && typeof k === 'string')
              .map(k => k.toUpperCase().replace(/[\s-]+/g, '_'));
            
            if (setVars.length > 0) {
              const currentVarCol = fields[VARIABLE_COL]?.trim() || '';
              const currentVars = currentVarCol 
                ? currentVarCol.split(',').map(v => v.trim().toUpperCase()).filter(Boolean) 
                : [];
              
              // Add any missing variables from the set object
              const allVars = new Set([...currentVars, ...setVars]);
              const newVarCol = Array.from(allVars).join(',');
              
              if (newVarCol !== currentVarCol) {
                fields[VARIABLE_COL] = newVarCol;
                needsReconstruct = true;
                fixesApplied++;
                console.log(`[Sanitize] FIX 13: Updated Variable column at node ${nodeNum}: ${newVarCol}`);
              }
            }
          }
        } catch {
          // JSON parse failed, skip this fix
        }
      }
    }
    
    // ========================================
    // FIX 18: ValidateRegex - ensure Parameter Input has proper format
    // Error: "Referenced global variable does not exist (value: LAST_USER_MESSAGE)"
    // Happens when ValidateRegex node is missing the required Parameter Input config
    // 
    // The bundled script expects: {"regex": "...", "input": "value_to_validate"}
    // where "input" should be the actual value or a variable reference like {VAR_NAME}
    // 
    // CRITICAL: {LAST_USER_MESSAGE} won't work unless that variable is declared somewhere
    // We need to use the Variable column value from the previous decision node
    // ========================================
    const NODE_INPUT_COL = 16;
    if (nodeType === 'A' && commandField === 'ValidateRegex') {
      const paramInput = fields[PARAM_INPUT_COL]?.trim() || '';
      const nodeInputCol = fields[NODE_INPUT_COL]?.trim() || '';
      const variableCol = fields[VARIABLE_COL]?.trim() || '';
      const nodeName = fields[2]?.toLowerCase() || ''; // Node Name column
      const description = fields[14]?.toLowerCase() || ''; // Description column
      
      // Infer the regex pattern based on variable name or node name
      const getRegexForType = (hint: string): { regex: string; varName: string } => {
        const lowerHint = hint.toLowerCase();
        if (lowerHint.includes('zip') || lowerHint.includes('postal')) {
          return { regex: '^[0-9]{5}(-[0-9]{4})?$', varName: 'ZIP_CODE' };
        } else if (lowerHint.includes('email')) {
          return { regex: '^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$', varName: 'USER_EMAIL' };
        } else if (lowerHint.includes('phone')) {
          return { regex: '^[0-9]{10,15}$', varName: 'PHONE_NUMBER' };
        } else if (lowerHint.includes('date')) {
          return { regex: '^\\\\d{1,2}/\\\\d{1,2}/\\\\d{4}$', varName: 'DATE_VALUE' };
        } else if (lowerHint.includes('ssn') || lowerHint.includes('social')) {
          return { regex: '^[0-9]{3}-?[0-9]{2}-?[0-9]{4}$', varName: 'SSN_VALUE' };
        } else if (lowerHint.includes('code') || lowerHint.includes('pin')) {
          return { regex: '^[0-9]{4,6}$', varName: 'CODE_VALUE' };
        }
        // Default: alphanumeric
        return { regex: '^[A-Za-z0-9]+$', varName: 'INPUT_VALUE' };
      };
      
      // If Parameter Input is missing or doesn't have the required fields
      let needsParamFix = false;
      let regexPattern = '';
      let targetVarName = variableCol || '';
      
      if (!paramInput) {
        needsParamFix = true;
        // Infer from variable column, node name, or description
        const hint = variableCol || nodeName || description;
        const inferred = getRegexForType(hint);
        regexPattern = inferred.regex;
        if (!targetVarName) targetVarName = inferred.varName;
      } else {
        // Parameter Input exists - check if it has the required fields
        try {
          const parsed = JSON.parse(paramInput);
          // Check for both bundled script format (regex/input) and official format (global_vars/validation)
          const hasBundledFormat = parsed.regex && parsed.input;
          const hasOfficialFormat = parsed.global_vars && parsed.validation;
          
          if (!hasBundledFormat && !hasOfficialFormat) {
            needsParamFix = true;
            const hint = variableCol || nodeName || description;
            const inferred = getRegexForType(hint);
            regexPattern = inferred.regex;
            if (!targetVarName) targetVarName = inferred.varName;
          }
        } catch {
          // Invalid JSON - needs fix
          needsParamFix = true;
          const hint = variableCol || nodeName || description;
          const inferred = getRegexForType(hint);
          regexPattern = inferred.regex;
          if (!targetVarName) targetVarName = inferred.varName;
        }
      }
      
      if (needsParamFix) {
        targetVarName = targetVarName.toUpperCase();
        
        // Strategy: Use Node Input to reference the previous node where user typed their answer
        // This is more reliable than using a variable reference that might not exist
        // Format: "input_value: node_num" where node_num is typically the previous node
        // Use findPreviousExistingNode to get actual previous node (not just nodeNum - 1 which may not exist)
        const prevNodeNum = findPreviousExistingNode(nodeNum);
        
        // Check if Node Input is empty and we can set it
        if (!nodeInputCol) {
          fields[NODE_INPUT_COL] = `user_input: ${prevNodeNum}`;
          console.log(`[Sanitize] FIX 18: Added Node Input for ValidateRegex at node ${nodeNum}: user_input: ${prevNodeNum}`);
        }
        
        // Use the bundled script format with the Node Input reference
        // The value from Node Input becomes available as {user_input}
        const inputRef = nodeInputCol ? 
          `{${nodeInputCol.split(':')[0].trim()}}` : // Use existing Node Input var name
          '{user_input}'; // Use our newly set Node Input
        
        const newParamInput = JSON.stringify({
          regex: regexPattern,
          input: inputRef
        });
        fields[PARAM_INPUT_COL] = newParamInput;
        needsReconstruct = true;
        fixesApplied++;
        console.log(`[Sanitize] FIX 18: Added ValidateRegex Parameter Input at node ${nodeNum}: ${newParamInput}`);
        
        // Also ensure Variable column is set - the ValidateRegex output variable
        if (!fields[VARIABLE_COL]?.trim()) {
          fields[VARIABLE_COL] = targetVarName;
          console.log(`[Sanitize] FIX 18: Set Variable column for ValidateRegex at node ${nodeNum}: ${targetVarName}`);
        }
        
        // Ensure Decision Variable matches what bundled script returns: 'success'
        const currentDecVar = fields[DECISION_VAR_COL]?.trim() || '';
        if (currentDecVar !== 'success') {
          fields[DECISION_VAR_COL] = 'success';
          console.log(`[Sanitize] FIX 18: Set Decision Variable to 'success' for ValidateRegex at node ${nodeNum}`);
        }
        
        // Ensure What Next uses true/false pattern (bundled script returns success=true/false)
        const whatNext = fields[WHAT_NEXT_COL]?.trim() || '';
        if (whatNext) {
          // Bundled ValidateRegex returns {success: "true"} or {success: "false"}
          // What Next format should use: true~successNode|false~retryNode|error~errorNode
          // If it currently uses 'success,true~' format, that's also valid
          if (!whatNext.includes('true~') && !whatNext.includes('false~')) {
            // Doesn't have the right format - try to fix
            const fixedWhatNext = whatNext
              .replace(/\bvalid\b/gi, 'success')
              .replace(/\byes~/gi, 'true~')
              .replace(/\bno~/gi, 'false~');
            if (fixedWhatNext !== whatNext) {
              fields[WHAT_NEXT_COL] = fixedWhatNext;
              console.log(`[Sanitize] FIX 18: Fixed What Next for ValidateRegex at node ${nodeNum}: ${fixedWhatNext}`);
            }
          }
        }
      }
    }
    
    if (needsReconstruct) {
      // Reconstruct line with proper CSV escaping
      if (!fields || !Array.isArray(fields)) {
        console.error(`[Sanitize] Error: fields is not an array at line ${i}, keeping original`);
        fixedLines.push(line);
      } else {
        const newLine = fields.map(f => {
          if (!f) return '';
          const str = String(f);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        }).join(',');
        fixedLines.push(newLine);
      }
    } else {
      fixedLines.push(line);
    }
  }
  
  if (skippedRows > 0) {
    console.log(`[Sanitize] Skipped ${skippedRows} rows with invalid Node Numbers`);
  }
  if (fixesApplied > 0) {
    console.log(`[Sanitize] Applied ${fixesApplied} automatic fixes`);
  }
  
  // Safety check: if we lost node 1, return original CSV
  if (!hasNode1) {
    console.error('[Sanitize] Warning: Node 1 not found after sanitization, returning original CSV');
    return csv;
  }
  
  return fixedLines.join('\n');
}

/**
 * Apply mock data to a specific warning's API dependency
 * Converts API-dependent nodes to use hardcoded mock values
 */
export function applyMockDataToWarning(csv: string, warningMessage: string): { csv: string; applied: boolean; changes: string[] } {
  const lines = csv.split('\n');
  if (lines.length < 2) return { csv, applied: false, changes: [] };
  
  const changes: string[] = [];
  const fixedLines: string[] = [lines[0]]; // Keep header
  
  // Column indices
  const NODE_NUM_COL = 0;
  const NODE_TYPE_COL = 1;
  const NODE_NAME_COL = 2;
  const MESSAGE_COL = 8;
  const COMMAND_COL = 13;
  const PARAM_INPUT_COL = 17;
  const DECISION_VAR_COL = 18;
  const WHAT_NEXT_COL = 19;
  
  // Detect what type of API dependency based on warning message
  const isPostEventToBQ = warningMessage.toLowerCase().includes('posteventtobq') || 
                          warningMessage.toLowerCase().includes('bigquery');
  const isBooking = warningMessage.toLowerCase().includes('booking');
  const isEmail = warningMessage.toLowerCase().includes('email');
  const isIntegration = warningMessage.toLowerCase().includes('integration');
  const isAgentTransfer = warningMessage.toLowerCase().includes('agent');
  
  // Extract table name from message if BigQuery
  const tableMatch = warningMessage.match(/(?:table|BigQuery table)\s+(\w+\.\w+)/i);
  const tableName = tableMatch ? tableMatch[1] : null;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      fixedLines.push(line);
      continue;
    }
    
    const fields = parseCSVLineForFix(line);
    while (fields.length < 26) fields.push('');
    
    const nodeNum = fields[NODE_NUM_COL];
    const nodeType = fields[NODE_TYPE_COL]?.toUpperCase();
    const nodeName = fields[NODE_NAME_COL] || '';
    const command = fields[COMMAND_COL] || '';
    const paramInput = fields[PARAM_INPUT_COL] || '';
    
    let modified = false;
    
    // Handle PostEventToBQ nodes - replace with SysAssignVariable
    if (isPostEventToBQ && nodeType === 'A' && command === 'PostEventToBQ') {
      // Check if this node references the table in the warning
      if (!tableName || paramInput.includes(tableName)) {
        fields[COMMAND_COL] = 'SysAssignVariable';
        fields[PARAM_INPUT_COL] = JSON.stringify({ 
          set: { 
            MOCK_BQ_LOGGED: 'true',
            MOCK_TIMESTAMP: new Date().toISOString().split('T')[0]
          }
        });
        fields[DECISION_VAR_COL] = 'success';
        // Keep existing What Next or add default
        if (!fields[WHAT_NEXT_COL]?.trim()) {
          fields[WHAT_NEXT_COL] = 'true~105|error~99990';
        }
        modified = true;
        changes.push(`Node ${nodeNum}: Replaced PostEventToBQ with mock logging (SysAssignVariable)`);
      }
    }
    
    // Handle booking-related action nodes
    if (isBooking && nodeType === 'A' && 
        (nodeName.toLowerCase().includes('book') || command.toLowerCase().includes('book'))) {
      fields[COMMAND_COL] = 'SysAssignVariable';
      fields[PARAM_INPUT_COL] = JSON.stringify({ 
        set: { 
          BOOKING_STATUS: 'MOCK_CONFIRMED',
          BOOKING_REF: 'MOCK-' + Math.random().toString(36).substring(7).toUpperCase(),
          BOOKING_DATE: new Date().toISOString().split('T')[0]
        }
      });
      fields[DECISION_VAR_COL] = 'success';
      if (!fields[WHAT_NEXT_COL]?.trim()) {
        fields[WHAT_NEXT_COL] = 'true~105|error~99990';
      }
      modified = true;
      changes.push(`Node ${nodeNum}: Replaced booking API with mock confirmation`);
    }
    
    // Handle email-related action nodes
    if (isEmail && nodeType === 'A' && 
        (nodeName.toLowerCase().includes('email') || command.toLowerCase().includes('email') || 
         nodeName.toLowerCase().includes('confirm'))) {
      fields[COMMAND_COL] = 'SysAssignVariable';
      fields[PARAM_INPUT_COL] = JSON.stringify({ 
        set: { 
          EMAIL_STATUS: 'MOCK_SENT',
          EMAIL_REF: 'EMAIL-' + Date.now()
        }
      });
      fields[DECISION_VAR_COL] = 'success';
      if (!fields[WHAT_NEXT_COL]?.trim()) {
        fields[WHAT_NEXT_COL] = 'true~105|error~99990';
      }
      modified = true;
      changes.push(`Node ${nodeNum}: Replaced email sending with mock confirmation`);
    }
    
    // Handle general integration nodes
    if (isIntegration && nodeType === 'A' && 
        (nodeName.toLowerCase().includes('integration') || 
         nodeName.toLowerCase().includes('api') ||
         nodeName.toLowerCase().includes('external'))) {
      fields[COMMAND_COL] = 'SysAssignVariable';
      fields[PARAM_INPUT_COL] = JSON.stringify({ 
        set: { 
          API_STATUS: 'MOCK_SUCCESS',
          API_RESPONSE: 'Mock data - integration not connected'
        }
      });
      fields[DECISION_VAR_COL] = 'success';
      if (!fields[WHAT_NEXT_COL]?.trim()) {
        fields[WHAT_NEXT_COL] = 'true~105|error~99990';
      }
      modified = true;
      changes.push(`Node ${nodeNum}: Replaced external API with mock response`);
    }
    
    // Reconstruct line if modified
    if (modified) {
      const newLine = fields.map(f => {
        if (!f) return '';
        const str = String(f);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }).join(',');
      fixedLines.push(newLine);
    } else {
      fixedLines.push(line);
    }
  }
  
  return { 
    csv: fixedLines.join('\n'), 
    applied: changes.length > 0, 
    changes 
  };
}

/**
 * Detect API dependencies in warnings and enrich them with metadata
 */
export function enrichWarningsWithApiInfo(warnings: string[]): Array<{
  message: string;
  severity: 'warning';
  apiDependency?: {
    type: 'bigquery' | 'email' | 'booking' | 'external_api' | 'integration';
    command?: string;
    affectedNodes?: number[];
    mockDataApplied?: boolean;
  };
}> {
  return warnings.map(w => {
    const result: {
      message: string;
      severity: 'warning';
      apiDependency?: {
        type: 'bigquery' | 'email' | 'booking' | 'external_api' | 'integration';
        command?: string;
        affectedNodes?: number[];
        mockDataApplied?: boolean;
      };
    } = { message: w, severity: 'warning' as const };
    
    const lowerMsg = w.toLowerCase();
    
    // Detect BigQuery/PostEventToBQ
    if (lowerMsg.includes('posteventtobq') || lowerMsg.includes('bigquery') || lowerMsg.includes('logged to')) {
      result.apiDependency = { type: 'bigquery', command: 'PostEventToBQ' };
    }
    // Detect email
    else if (lowerMsg.includes('email') || lowerMsg.includes('confirm via email')) {
      result.apiDependency = { type: 'email' };
    }
    // Detect booking
    else if (lowerMsg.includes('booking') || lowerMsg.includes('reservation')) {
      result.apiDependency = { type: 'booking' };
    }
    // Detect general integration
    else if (lowerMsg.includes('integration') || lowerMsg.includes('api') || lowerMsg.includes('needs integration')) {
      result.apiDependency = { type: 'integration' };
    }
    // Detect external API
    else if (lowerMsg.includes('external') || lowerMsg.includes('route to')) {
      result.apiDependency = { type: 'external_api' };
    }
    
    return result;
  });
}

/**
 * Pre-deploy validation and auto-fix
 * Checks for common issues before deploying to Bot Manager
 */
export function preDeployValidation(csv: string, autoFix: boolean = false): PreDeployValidation {
  const lines = csv.split('\n');
  const errors: PreDeployValidation['errors'] = [];
  const fixedLines: string[] = [];
  let anyFixed = false;
  
  // Column index for Rich Asset Content
  const RICH_CONTENT_COL = 10;
  const NODE_NUM_COL = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 || !line.trim()) {
      fixedLines.push(line);
      continue;
    }
    
    const fields = parseCSVLineForFix(line);
    const nodeNum = parseInt(fields[NODE_NUM_COL]) || 0;
    const richContent = fields[RICH_CONTENT_COL] || '';
    
    // Check Rich Asset Content for common issues
    if (richContent && richContent.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(richContent);
        
        // Check for dest at root level (invalid)
        if (obj.dest !== undefined && obj.options) {
          errors.push({
            nodeNum,
            field: 'Rich Asset Content',
            error: '"dest" should be inside each option, not at root level',
            value: richContent.substring(0, 100),
            autoFixable: true
          });
          
          if (autoFix) {
            const { fixed, wasFixed } = fixRichAssetContent(richContent);
            if (wasFixed) {
              // Store the raw fixed JSON - quoting will be handled in reconstruction
              fields[RICH_CONTENT_COL] = fixed;
              anyFixed = true;
            }
          }
        }
      } catch {
        // Invalid JSON in rich content
        errors.push({
          nodeNum,
          field: 'Rich Asset Content',
          error: 'Invalid JSON format',
          value: richContent.substring(0, 100),
          autoFixable: false
        });
      }
    }
    
    // Reconstruct line
    if (autoFix && anyFixed && fields && Array.isArray(fields)) {
      fixedLines.push(fields.map(f => {
        if (!f) return '';
        const str = String(f);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','));
    } else {
      fixedLines.push(line);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    fixedCsv: autoFix && anyFixed ? fixedLines.join('\n') : undefined
  };
}

/**
 * Options for CSV generation
 */
export interface GenerationOptions {
  /** Use sequential generation (default: true). Falls back to single-call on failure. */
  useSequential?: boolean;
  /** Progress callback for sequential generation */
  onProgress?: (progress: SequentialProgress) => void;
  /** Skip fallback to single-call on sequential failure */
  noFallback?: boolean;
}

/**
 * Generate a Pypestream bot CSV using AI
 * 
 * By default, uses sequential generation which is faster and more reliable.
 * Falls back to single-call generation if sequential fails.
 */
export async function generateBotCSV(
  projectConfig: ProjectConfig,
  clarifyingQuestions: ClarifyingQuestion[],
  referenceFiles?: FileUpload[],
  aiCredentials?: { apiKey?: string; provider?: 'anthropic' | 'google' },
  options?: GenerationOptions
): Promise<GenerationResult> {
  const useSequential = options?.useSequential !== false;
  
  // Try sequential generation first (faster, more reliable)
  if (useSequential) {
    try {
      console.log('[Generation] Using sequential generation...');
      const result = await generateSequentially(
        projectConfig,
        clarifyingQuestions,
        options?.onProgress
      );
      console.log('[Generation] Sequential generation succeeded');
      return result;
    } catch (seqError: any) {
      console.warn('[Generation] Sequential generation failed:', seqError.message);
      if (options?.noFallback) {
        throw seqError;
      }
      console.log('[Generation] Falling back to single-call generation...');
    }
  }
  
  // Fallback: Original single-call generation
  // Fetch errors to avoid from the learning system (non-blocking on failure)
  let errorsToAvoidContext = '';
  try {
    const { getErrorsToAvoid, formatErrorsToAvoidForPrompt } = await import('./error-learning');
    const errorsToAvoid = await getErrorsToAvoid(15);
    if (errorsToAvoid.length > 0) {
      console.log(`[SELF-IMPROVE] 🧠 Including ${errorsToAvoid.length} learned error patterns to avoid in generation`);
      errorsToAvoidContext = formatErrorsToAvoidForPrompt(errorsToAvoid);
    }
  } catch (e) {
    console.warn('[Generation] Failed to fetch errors to avoid:', e);
  }

  const response = await fetch('/api/generate-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectConfig,
      clarifyingQuestions,
      referenceFiles,
      errorsToAvoidContext,
      // Pass user's AI API key if provided
      aiApiKey: aiCredentials?.apiKey,
      aiProvider: aiCredentials?.provider || 'anthropic',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    
    // Special handling for rate limit errors
    if (response.status === 429 || error.isRateLimit) {
      const retryAfter = error.retryAfterSeconds || 60;
      throw new RateLimitError(
        error.error || 'Rate limit exceeded. Please wait a moment and try again.',
        retryAfter
      );
    }
    
    throw new Error(error.error || `Generation failed: ${response.status}`);
  }

  const result = await response.json();
  
  // Validate the result structure
  if (!result.csv) {
    throw new Error('Invalid response: missing CSV content');
  }

  // Post-process CSV: normalize columns, fix alignment, fix Decision Variables, then inject required startup nodes
  const normalizedCSV = normalizeCSVColumns(result.csv);
  const alignedCSV = fixCSVColumnAlignment(normalizedCSV);
  const decVarFixedCSV = fixDecisionVariables(alignedCSV);
  
  // CRITICAL: Inject required startup nodes if missing
  // This ensures the bot ALWAYS has nodes 1, 10, 100-104, -500, 666, 999, 1800, 99990
  const fixedCSV = injectRequiredStartupNodes(decVarFixedCSV);
  
  // Validate startup nodes are correctly configured
  const startupIssues = validateStartupNodes(fixedCSV);
  if (startupIssues.length > 0) {
    console.warn('[Startup Validation] Issues found:', startupIssues);
  }

  // Calculate node count and detect official nodes from CSV
  const stats = parseCSVStats(fixedCSV);
  const calculatedNodeCount = stats.totalNodes || (stats.decisionNodes + stats.actionNodes);
  
  // Use detected official nodes from CSV (more reliable than AI self-reporting)
  const detectedOfficialNodes = stats.officialNodesUsed || [];
  // Merge with any AI-reported nodes (in case we miss some)
  const allOfficialNodes = Array.from(new Set([
    ...detectedOfficialNodes,
    ...(result.officialNodesUsed || [])
  ])).sort();
  
  return {
    csv: fixedCSV,
    nodeCount: calculatedNodeCount || result.nodeCount || 0,
    officialNodesUsed: allOfficialNodes,
    customScripts: result.customScripts || [],
    warnings: result.warnings || [],
    readme: result.readme || '',
  };
}

/**
 * Fix CSV column alignment issues caused by AI inconsistency
 * This post-processes the CSV to ensure all values are in correct columns
 */
/**
 * Normalize CSV to ensure exactly 26 columns per row.
 * 
 * Handles:
 * - Rows with too few columns (pad with empty)
 * - Rows with too many columns (merge excess — likely unescaped commas in content)
 * - Rows that aren't valid data (non-integer Node Number — remove)
 * - Enforces field type constraints per column
 */
function normalizeCSVColumns(csv: string): string {
  const lines = csv.split('\n');
  if (lines.length < 2) return csv;
  
  const EXPECTED_COLS = 26;
  const header = lines[0];
  const normalizedLines: string[] = [header];
  let fixed = 0;
  let removed = 0;
  
  // Track seen node numbers to prevent duplicates - first occurrence wins
  // (startup nodes are added first, so they take precedence)
  const seenNodeNums = new Set<number>();
  let duplicates = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = parseCSVLineForFix(line);
    
    // Skip rows where Node Number isn't a valid integer
    const nodeNum = parseInt(fields[0], 10);
    if (isNaN(nodeNum)) {
      removed++;
      continue;
    }
    
    // Skip duplicate node numbers - first occurrence wins
    if (seenNodeNums.has(nodeNum)) {
      duplicates++;
      continue;
    }
    seenNodeNums.add(nodeNum);
    
    const nodeType = (fields[1] || '').toUpperCase();
    
    if (fields.length === EXPECTED_COLS) {
      // Correct count — just validate field types
      const validated = validateFieldTypes(fields, nodeType);
      normalizedLines.push(reconstructCSVLine(validated));
    } else if (fields.length < EXPECTED_COLS) {
      // Too few columns — pad with empty strings
      while (fields.length < EXPECTED_COLS) fields.push('');
      const validated = validateFieldTypes(fields, nodeType);
      normalizedLines.push(reconstructCSVLine(validated));
      fixed++;
    } else {
      // Too many columns — likely unescaped commas in a field
      // Strategy: merge excess columns into the most likely field
      // For Decision nodes: Message (col 8) or Rich Asset Content (col 10)
      // For Action nodes: Parameter Input (col 17) or Description (col 14)
      const excess = fields.length - EXPECTED_COLS;
      const mergedFields = [...fields];
      
      if (nodeType === 'D') {
        // Try to find where the split happened by looking for JSON-like content
        const richContentIdx = findJsonFieldStart(mergedFields, 10);
        const messageIdx = 8;
        
        if (richContentIdx !== -1 && richContentIdx >= 10) {
          // Merge from Rich Asset Content
          mergeFieldsAt(mergedFields, richContentIdx, excess);
        } else {
          // Merge into Message field
          mergeFieldsAt(mergedFields, messageIdx, excess);
        }
      } else if (nodeType === 'A') {
        const paramIdx = findJsonFieldStart(mergedFields, 17);
        if (paramIdx !== -1) {
          mergeFieldsAt(mergedFields, paramIdx, excess);
        } else {
          // Merge into Description
          mergeFieldsAt(mergedFields, 14, excess);
        }
      } else {
        // Unknown type — merge into the last populated field
        mergeFieldsAt(mergedFields, Math.min(fields.length - excess - 1, 8), excess);
      }
      
      // Trim/pad to exactly 26
      while (mergedFields.length < EXPECTED_COLS) mergedFields.push('');
      if (mergedFields.length > EXPECTED_COLS) mergedFields.length = EXPECTED_COLS;
      
      const validated = validateFieldTypes(mergedFields, nodeType);
      normalizedLines.push(reconstructCSVLine(validated));
      fixed++;
    }
  }
  
  if (fixed > 0 || removed > 0 || duplicates > 0) {
    console.log(`[CSV Normalize] Fixed ${fixed} rows with wrong column count, removed ${removed} invalid rows, deduplicated ${duplicates} duplicate nodes`);
  }
  
  return normalizedLines.join('\n');
}

/**
 * Fix Decision Variable mismatches for action nodes.
 * Each action script has a specific output variable that must match the Decision Variable.
 * Common AI mistakes: using "success" for SysMultiMatchRouting (should be "next_node" or "valid")
 */
function fixDecisionVariables(csv: string): string {
  const lines = csv.split('\n');
  if (lines.length < 2) return csv;
  
  const header = lines[0];
  const fixedLines = [header];
  let fixes = 0;
  
  // Command → Expected Decision Variable mapping
  const COMMAND_DEC_VAR_MAP: Record<string, string> = {
    'SysAssignVariable': 'success',
    'SysShowMetadata': 'success',
    'SysSetEnv': 'success',
    'SysVariableReset': 'success',
    'HandleBotError': 'error_type',
    'UserPlatformRouting': 'success',
    'GenAIFallback': 'result',
    'ValidateRegex': 'success',
    'ValidateDate': 'success',
    'GetValue': 'success',
    'SetVar': 'success',
    'VarCheck': 'valid',
    'LimitCounter': 'valid',
    'BotToPlatform': 'success',
    'EventsToGlobalVariableValues': 'success',
    'SetFormID': 'success',
  };
  
  // Scripts where DecVar should match Output (variable names)
  const DECVAR_MATCHES_OUTPUT = new Set(['SysMultiMatchRouting']);
  
  // Column indices
  const COL_TYPE = 1;
  const COL_COMMAND = 13;
  const COL_OUTPUT = 15;
  const COL_DEC_VAR = 18;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = parseCSVLineForFix(line);
    const nodeType = (fields[COL_TYPE] || '').toUpperCase();
    
    // Only fix Action nodes
    if (nodeType !== 'A') {
      fixedLines.push(line);
      continue;
    }
    
    const command = fields[COL_COMMAND] || '';
    const currentDecVar = fields[COL_DEC_VAR] || '';
    const currentOutput = fields[COL_OUTPUT] || '';
    
    let needsFix = false;
    
    // Special handling for SysMultiMatchRouting - DecVar should match Output
    if (DECVAR_MATCHES_OUTPUT.has(command)) {
      if (currentOutput && currentDecVar && currentDecVar !== currentOutput) {
        console.log(`[DecVar Fix] Node ${fields[0]} (${command}): Fixing Decision Variable from "${currentDecVar}" to "${currentOutput}" (must match output)`);
        fields[COL_DEC_VAR] = currentOutput;
        needsFix = true;
      } else if (!currentOutput && currentDecVar) {
        // Output is missing, set it to match DecVar
        fields[COL_OUTPUT] = currentDecVar;
        needsFix = true;
      } else if (currentOutput && !currentDecVar) {
        // DecVar is missing, set it to match Output
        fields[COL_DEC_VAR] = currentOutput;
        needsFix = true;
      } else if (!currentOutput && !currentDecVar) {
        // Both missing, use default
        fields[COL_OUTPUT] = 'next_node';
        fields[COL_DEC_VAR] = 'next_node';
        needsFix = true;
      }
    } else {
      // For other commands, use the mapping
      const expectedDecVar = COMMAND_DEC_VAR_MAP[command];
      
      if (expectedDecVar) {
        // Always set to expected value for known commands
        if (!currentDecVar || currentDecVar !== expectedDecVar) {
          console.log(`[DecVar Fix] Node ${fields[0]} (${command}): Fixing Decision Variable from "${currentDecVar || '(empty)'}" to "${expectedDecVar}"`);
          fields[COL_DEC_VAR] = expectedDecVar;
          needsFix = true;
        }
        // Also fix output if missing
        if (!currentOutput) {
          fields[COL_OUTPUT] = expectedDecVar;
        }
      }
    }
    
    if (needsFix) {
      fixes++;
      fixedLines.push(reconstructCSVLine(fields));
    } else {
      fixedLines.push(line);
    }
  }
  
  if (fixes > 0) {
    console.log(`[DecVar Fix] Fixed ${fixes} Decision Variable mismatches`);
  }
  
  return fixedLines.join('\n');
}

import { SYSTEM_NODES, STARTUP_NODES, GENAI_FALLBACK_NODES, returnMenu, type NodeTemplate } from '../data/node-templates';

/**
 * Convert a NodeTemplate to a 26-column CSV row string.
 * Uses the canonical templates from node-templates.ts
 */
function nodeTemplateToCSVRow(template: NodeTemplate): string {
  const escapeField = (val: any): string => {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  
  // Build 26-column array
  const cols: string[] = new Array(26).fill('');
  cols[0] = String(template.num);           // Node Number
  cols[1] = template.type;                   // Node Type
  cols[2] = template.name;                   // Node Name
  cols[3] = template.intent || '';           // Intent
  cols[4] = '';                              // Entity Type
  cols[5] = '';                              // Entity
  cols[6] = template.nluDisabled || '';      // NLU Disabled?
  cols[7] = template.nextNodes || '';        // Next Nodes
  cols[8] = template.message || '';          // Message
  cols[9] = template.richType || '';         // Rich Asset Type
  cols[10] = template.richContent || '';     // Rich Asset Content
  cols[11] = template.ansReq || '';          // Answer Required?
  cols[12] = template.behaviors || '';       // Behaviors
  cols[13] = template.command || '';         // Command
  cols[14] = template.description || '';     // Description
  cols[15] = template.output || '';          // Output
  cols[16] = template.nodeInput || '';       // Node Input
  cols[17] = template.paramInput || '';      // Parameter Input
  cols[18] = template.decVar || '';          // Decision Variable
  cols[19] = template.whatNext || '';        // What Next?
  cols[20] = '';                             // Node Tags
  cols[21] = '';                             // Skill Tag
  cols[22] = template.variable || '';        // Variable
  cols[23] = '';                             // Platform Flag
  cols[24] = template.flows || '';           // Flows
  cols[25] = '';                             // CSS Classname
  
  return cols.map(escapeField).join(',');
}

/**
 * Build the REQUIRED_STARTUP_NODES map from node-templates.ts
 * This ensures we use the canonical, validated templates
 */
function buildRequiredStartupNodes(): Record<number, string> {
  const nodes: Record<number, string> = {};
  
  // Add all system nodes
  for (const template of SYSTEM_NODES) {
    nodes[template.num] = nodeTemplateToCSVRow(template);
  }
  
  // Add all startup nodes (includes context initialization at 105)
  for (const template of STARTUP_NODES) {
    nodes[template.num] = nodeTemplateToCSVRow(template);
  }
  
  // Add GenAI fallback nodes (1800, 1802, 1803, 1804) for intelligent NLU
  for (const template of GENAI_FALLBACK_NODES) {
    nodes[template.num] = nodeTemplateToCSVRow(template);
  }
  
  // Add fallback main menu nodes (these aren't in node-templates.ts yet)
  // NOTE: Node 300 is intentionally NOT included here - it's a FLOW node, not a startup node.
  // The AI generates actual flow content for node 300+. We only include it as a FALLBACK_ONLY
  // node that gets injected ONLY if the AI fails to generate any flows.
  const fallbackNodes: NodeTemplate[] = [
    {
      num: 200, type: 'D', name: 'MainMenu → Welcome',
      nextNodes: '210',
      message: 'Welcome! How can I help you today?',
      richType: 'quick_reply',
      richContent: '{"type":"static","options":[{"label":"Get Help","dest":300},{"label":"Talk to Agent","dest":999}]}',
      ansReq: '1',
      flows: 'main_menu_entry',
    },
    {
      num: 210, type: 'A', name: 'IntentRouting → Route Input',
      command: 'SysMultiMatchRouting', description: 'Routes user input', output: 'next_node',
      paramInput: '{"global_vars":"LAST_USER_MESSAGE","input_vars":"help,support,agent,question"}',
      decVar: 'next_node', whatNext: 'help~300|support~300|agent~999|question~300|false~1800|error~1800',
    },
    returnMenu(201), // Uses the template function for return menu
  ];
  
  for (const template of fallbackNodes) {
    nodes[template.num] = nodeTemplateToCSVRow(template);
  }
  
  // Node 300 is a FALLBACK ONLY - only injected if AI doesn't generate any flows
  // This is a safety net, not the default behavior
  const fallbackNode300: NodeTemplate = {
    num: 300, type: 'D', name: 'Help → Information',
    nextNodes: '201',
    message: 'I can help you with questions and connect you to a live agent if needed.',
    richType: 'buttons',
    richContent: '{"type":"static","options":[{"label":"Main Menu","dest":200},{"label":"Talk to Agent","dest":999},{"label":"End Chat","dest":666}]}',
    ansReq: '1',
  };
  nodes[300] = nodeTemplateToCSVRow(fallbackNode300);
  
  console.log(`[Startup Templates] Loaded ${Object.keys(nodes).length} node templates from node-templates.ts`);
  return nodes;
}

// Build the required nodes map at module load time
const REQUIRED_STARTUP_NODES = buildRequiredStartupNodes();

// Nodes that are ONLY injected if missing - not overwritten if AI generated them
// Node 300 is here because it's the first flow's start node - AI generates the actual content
const FALLBACK_ONLY_NODES = new Set<number>([300]);
// Nodes that are ALWAYS required and will be injected/fixed if missing or broken
// Includes: startup (1-105), error handling (-500, 99990), system (666, 999), GenAI fallback chain (1800-1804), and main menu (200, 201, 210)
// NOTE: Node 300+ are FLOW nodes - NOT critical startup. They're generated by AI for each flow.
const CRITICAL_STARTUP_NODES = new Set([1, 10, 100, 101, 102, 103, 104, 105, -500, 666, 999, 1800, 1802, 1803, 1804, 99990, 200, 201, 210]);

/**
 * Check if a node is critically misconfigured (wrong type, missing command, etc.)
 */
function isNodeBroken(fields: string[], nodeNum: number): boolean {
  if (!fields || fields.length < 20) return true;
  
  const nodeType = fields[1]?.toUpperCase();
  const command = fields[13]?.trim();
  const whatNext = fields[19]?.trim();
  
  // Node -500 MUST be Action node with HandleBotError
  // This is the global error handler - if broken, the bot shows "technical difficulties" immediately
  if (nodeNum === -500) {
    if (nodeType !== 'A') {
      console.log(`[isNodeBroken] Node -500 has wrong type: ${nodeType} (expected A)`);
      return true;
    }
    if (!command || command !== 'HandleBotError') {
      console.log(`[isNodeBroken] Node -500 has wrong/missing command: "${command}" (expected HandleBotError)`);
      return true;
    }
    if (!whatNext || !whatNext.includes('~')) {
      console.log(`[isNodeBroken] Node -500 has missing What Next routing`);
      return true;
    }
  }
  
  // Node 1 must be Action node with ShowMetadata
  if (nodeNum === 1) {
    if (nodeType !== 'A') return true;
    if (!command || !command.includes('ShowMetadata')) return true;
    if (!whatNext || !whatNext.includes('~')) return true;
  }
  
  // Node 10 must be Action node with UserPlatformRouting
  if (nodeNum === 10) {
    if (nodeType !== 'A') return true;
    if (!command || !command.includes('UserPlatformRouting')) return true;
  }
  
  // Nodes 100, 101, 102 must be Action nodes with SysAssignVariable
  if (nodeNum === 100 || nodeNum === 101 || nodeNum === 102) {
    if (nodeType !== 'A') return true;
    if (!command || !command.includes('SysAssignVariable')) return true;
  }
  
  // Node 104 must be Action node with SysSetEnv and route correctly
  if (nodeNum === 104) {
    if (nodeType !== 'A') return true;
    if (!command || !command.includes('SysSetEnv')) return true;
    if (!whatNext || !whatNext.includes('~')) return true;
  }
  
  // Node 1800 MUST be Action node with GenAIFallback (NOT a Decision node!)
  // This is critical - Decision nodes can't have Decision Variable, which causes validation errors
  // ALSO: Must have out_of_scope intent - NLU-enabled bots REQUIRE this
  if (nodeNum === 1800) {
    if (nodeType !== 'A') {
      console.log(`[isNodeBroken] Node 1800 has wrong type: ${nodeType} (expected A - must be Action node with GenAIFallback)`);
      return true;
    }
    if (!command || !command.includes('GenAIFallback')) {
      console.log(`[isNodeBroken] Node 1800 has wrong/missing command: "${command}" (expected GenAIFallback)`);
      return true;
    }
    if (!whatNext || !whatNext.includes('~')) {
      console.log(`[isNodeBroken] Node 1800 has missing What Next routing`);
      return true;
    }
    // Strict check for Decision Variable - must be 'result'
    const decVar = fields[18]?.trim();
    if (decVar !== 'result') {
      console.log(`[isNodeBroken] Node 1800 has wrong Decision Variable: "${decVar}" (expected "result")`);
      return true;
    }
    // CRITICAL: Check for out_of_scope intent - NLU bots REQUIRE this
    const intent = fields[3]?.trim().toLowerCase();
    if (!intent || intent !== 'out_of_scope') {
      console.log(`[isNodeBroken] Node 1800 missing or wrong intent: "${intent}" (expected "out_of_scope")`);
      return true;
    }
  }
  
  // Main Menu nodes (200, 201, 300) MUST be Decision nodes, NOT Action nodes
  // If AI generates these as Action nodes with SysAssignVariable, they will fail with
  // "proposed dir_field is not an element of the proposed payload" error
  if (nodeNum === 200 || nodeNum === 201 || nodeNum === 300) {
    if (nodeType !== 'D') {
      console.log(`[isNodeBroken] Node ${nodeNum} has wrong type: ${nodeType} (expected D - must be Decision node)`);
      return true;
    }
    // Decision nodes should NOT have Command or Decision Variable
    if (command) {
      console.log(`[isNodeBroken] Node ${nodeNum} has Command "${command}" but should be empty for Decision node`);
      return true;
    }
    const decVar = fields[18]?.trim();
    if (decVar) {
      console.log(`[isNodeBroken] Node ${nodeNum} has Decision Variable "${decVar}" but should be empty for Decision node`);
      return true;
    }
  }
  
  // Node 210 MUST be Action node with SysMultiMatchRouting for intent routing
  if (nodeNum === 210) {
    if (nodeType !== 'A') {
      console.log(`[isNodeBroken] Node 210 has wrong type: ${nodeType} (expected A)`);
      return true;
    }
    if (!command || !command.includes('SysMultiMatchRouting')) {
      console.log(`[isNodeBroken] Node 210 has wrong/missing command: "${command}" (expected SysMultiMatchRouting)`);
      return true;
    }
  }
  
  return false;
}

/**
 * Inject required startup nodes if they're missing from the CSV.
 * This ensures the bot ALWAYS has a working startup flow.
 * 
 * Two categories:
 * 1. CRITICAL_STARTUP_NODES - Always injected if missing OR BROKEN (nodes 1, 10, 100-104, etc.)
 * 2. FALLBACK_ONLY_NODES - Only injected if missing AND no alternative exists (200, 201, 210, 300)
 */
function injectRequiredStartupNodes(csv: string): string {
  const lines = csv.split('\n');
  if (lines.length < 1) return csv;
  
  const header = lines[0];
  const dataLines = lines.slice(1).filter(l => l.trim());
  
  // Parse existing node numbers and their lines
  const existingNodes = new Map<number, { line: string; fields: string[] }>();
  for (const line of dataLines) {
    const fields = parseCSVLineForFix(line);
    const nodeNum = parseInt(fields[0], 10);
    if (!isNaN(nodeNum)) {
      existingNodes.set(nodeNum, { line, fields });
    }
  }
  
  // Determine which nodes need to be injected or replaced
  const nodesToInject: number[] = [];
  const nodesToReplace: number[] = [];
  const requiredNodeNumbers = Object.keys(REQUIRED_STARTUP_NODES).map(n => parseInt(n, 10));
  
  for (const nodeNum of requiredNodeNumbers) {
    const isCritical = CRITICAL_STARTUP_NODES.has(nodeNum);
    const isFallback = FALLBACK_ONLY_NODES.has(nodeNum);
    const existing = existingNodes.get(nodeNum);
    const nodeExists = !!existing;
    
    if (isCritical) {
      if (!nodeExists) {
        // Missing critical node - inject
        nodesToInject.push(nodeNum);
      } else if (isNodeBroken(existing.fields, nodeNum)) {
        // Broken critical node - replace
        nodesToReplace.push(nodeNum);
      }
    } else if (isFallback && !nodeExists) {
      // Missing fallback node - inject
      nodesToInject.push(nodeNum);
    }
  }
  
  if (nodesToInject.length === 0 && nodesToReplace.length === 0) {
    console.log('[Startup Inject] All required startup nodes present and valid');
    return csv;
  }
  
  // Log what's happening
  if (nodesToReplace.length > 0) {
    console.warn(`[Startup Inject] REPLACING broken critical nodes: ${nodesToReplace.join(', ')}`);
  }
  if (nodesToInject.length > 0) {
    const criticalMissing = nodesToInject.filter(n => CRITICAL_STARTUP_NODES.has(n));
    const fallbackMissing = nodesToInject.filter(n => FALLBACK_ONLY_NODES.has(n));
    if (criticalMissing.length > 0) {
      console.warn(`[Startup Inject] CRITICAL nodes missing: ${criticalMissing.join(', ')}`);
    }
    if (fallbackMissing.length > 0) {
      console.log(`[Startup Inject] Fallback nodes needed: ${fallbackMissing.join(', ')}`);
    }
  }
  
  // Build the final data lines
  const finalDataLines: string[] = [];
  const nodesToRemove = new Set(nodesToReplace);
  
  // Keep existing lines except those being replaced
  for (const line of dataLines) {
    const fields = parseCSVLineForFix(line);
    const nodeNum = parseInt(fields[0], 10);
    if (!nodesToRemove.has(nodeNum)) {
      finalDataLines.push(line);
    }
  }
  
  // Add injected and replacement nodes
  const allNodesToAdd = [...nodesToInject, ...nodesToReplace];
  for (const nodeNum of allNodesToAdd) {
    const nodeLine = REQUIRED_STARTUP_NODES[nodeNum];
    if (nodeLine) {
      finalDataLines.push(nodeLine);
      const action = nodesToReplace.includes(nodeNum) ? 'REPLACED' : 'INJECTED';
      console.log(`[Startup Inject] ${action} node ${nodeNum}`);
    }
  }
  
  // Sort by node number for cleaner output
  finalDataLines.sort((a, b) => {
    const numA = parseInt(parseCSVLineForFix(a)[0], 10) || 0;
    const numB = parseInt(parseCSVLineForFix(b)[0], 10) || 0;
    return numA - numB;
  });
  
  const totalChanges = nodesToInject.length + nodesToReplace.length;
  console.log(`[Startup Inject] Made ${totalChanges} changes (${nodesToInject.length} injected, ${nodesToReplace.length} replaced)`);
  
  return [header, ...finalDataLines].join('\n');
}

/**
 * Validate that critical startup nodes exist and are correctly configured.
 * Returns an array of issues found (after injection, these should be minimal).
 */
export function validateStartupNodes(csv: string): string[] {
  const issues: string[] = [];
  const lines = csv.split('\n');
  
  // Parse nodes into a map
  const nodeMap = new Map<number, string[]>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLineForFix(line);
    const nodeNum = parseInt(fields[0], 10);
    if (!isNaN(nodeNum)) {
      nodeMap.set(nodeNum, fields);
    }
  }
  
  // Check node -500 (HandleBotError) - CRITICAL for error handling
  if (!nodeMap.has(-500)) {
    issues.push('CRITICAL: Node -500 (HandleBotError) is missing - bot will crash on any error');
  } else {
    const node = nodeMap.get(-500)!;
    const nodeType = node[1]?.toUpperCase();
    const command = node[13]?.trim();
    const whatNext = node[19]?.trim();
    
    if (nodeType !== 'A') {
      issues.push('CRITICAL: Node -500 must be Action type (A), not Decision');
    }
    if (!command || command !== 'HandleBotError') {
      issues.push(`CRITICAL: Node -500 must use HandleBotError command, found: "${command}"`);
    }
    if (!whatNext || !whatNext.includes('~')) {
      issues.push(`CRITICAL: Node -500 missing valid What Next? routing, found: "${whatNext}"`);
    }
  }
  
  // Check node 1 exists and is configured correctly (after injection this should always be true)
  if (!nodeMap.has(1)) {
    issues.push('CRITICAL: Node 1 (SysShowMetadata) is missing - bot cannot start');
  } else {
    const node1 = nodeMap.get(1)!;
    const nodeType = node1[1]?.toUpperCase();
    const command = node1[13]?.trim();
    const whatNext = node1[19]?.trim();
    
    if (nodeType !== 'A') {
      issues.push('Node 1 must be Action type (A), not Decision');
    }
    if (!command || !command.includes('ShowMetadata')) {
      issues.push(`Node 1 should use SysShowMetadata command, found: "${command}"`);
    }
    if (!whatNext || !whatNext.includes('~')) {
      issues.push(`Node 1 missing valid What Next? routing, found: "${whatNext}"`);
    }
  }
  
  // Check node 10 exists (UserPlatformRouting)
  if (!nodeMap.has(10)) {
    issues.push('Node 10 (UserPlatformRouting) is missing');
  } else {
    const node = nodeMap.get(10)!;
    const command = node[13]?.trim();
    if (!command || command !== 'UserPlatformRouting') {
      issues.push(`Node 10 must use UserPlatformRouting command, found: "${command}"`);
    }
  }
  
  // Check node 104 exists
  if (!nodeMap.has(104)) {
    issues.push('Node 104 (SysSetEnv) is missing');
  }
  
  // Check error handler exists
  if (!nodeMap.has(99990)) {
    issues.push('Node 99990 (Error Message) is missing');
  }
  
  // Check node 200 exists (main menu) - should be injected if missing
  if (!nodeMap.has(200)) {
    issues.push('Node 200 (Main Menu) is missing');
  }
  
  return issues;
}

/** Find the start of a JSON field (starts with { ) in parsed fields */
function findJsonFieldStart(fields: string[], startFrom: number): number {
  for (let i = startFrom; i < fields.length; i++) {
    if (fields[i]?.trim().startsWith('{')) return i;
  }
  return -1;
}

/** Merge excess columns into one field by joining with commas */
function mergeFieldsAt(fields: string[], idx: number, count: number): void {
  if (idx < 0 || idx >= fields.length) return;
  const merged = fields.slice(idx, idx + count + 1).join(',');
  fields.splice(idx, count + 1, merged);
}

/** Validate field types match expected column constraints */
function validateFieldTypes(fields: string[], nodeType: string): string[] {
  // Node Number must be integer
  const nn = parseInt(fields[0], 10);
  if (isNaN(nn)) fields[0] = '0';
  
  // Node Type must be D or A
  if (fields[1] !== 'D' && fields[1] !== 'A') {
    fields[1] = nodeType === 'A' ? 'A' : 'D';
  }
  
  // NLU Disabled (col 6) must be empty, "0", or "1"
  const nlu = fields[6]?.trim();
  if (nlu && nlu !== '0' && nlu !== '1') fields[6] = '';
  
  // Answer Required (col 11) must be empty, "0", or "1"
  const ansReq = fields[11]?.trim();
  if (ansReq && ansReq !== '0' && ansReq !== '1') fields[11] = '';
  
  // For Decision nodes: clear Action-only columns (13-15, 17-19)
  if (nodeType === 'D') {
    // Decision nodes should NOT have: Command(13), Description(14), Output(15), 
    // Parameter Input(17), Decision Variable(18), What Next(19)
    
    // Move any message from Node Input (col 16) to Message (col 8) if Message is empty
    if (!fields[8]?.trim() && fields[16]?.trim()) {
      fields[8] = fields[16];
      fields[16] = '';
    }
    
    // Clear Action-only columns
    fields[13] = ''; // Command
    fields[14] = ''; // Description
    fields[15] = ''; // Output
    fields[17] = ''; // Parameter Input
    fields[18] = ''; // Decision Variable
    fields[19] = ''; // What Next
  }
  
  // For Action nodes: clear Decision-only columns (8-12)
  if (nodeType === 'A') {
    // Action nodes should NOT have: Message(8), Rich Asset Type(9), Rich Asset Content(10),
    // Answer Required(11), Behaviors(12)
    fields[8] = '';  // Message
    fields[9] = '';  // Rich Asset Type
    fields[10] = ''; // Rich Asset Content
    fields[11] = ''; // Answer Required
    fields[12] = ''; // Behaviors
  }
  
  // Variable column (22) must be ALL_CAPS
  const varCol = fields[22]?.trim();
  if (varCol && /[a-z]/.test(varCol)) {
    fields[22] = varCol.toUpperCase().replace(/[\s-]+/g, '_');
  }
  
  return fields;
}

function fixCSVColumnAlignment(csv: string): string {
  const lines = csv.split('\n');
  if (lines.length < 2) return csv;
  
  // Keep header as-is
  const header = lines[0];
  const fixedLines = [header];
  
  // Column indices
  const COL = {
    NODE_NUM: 0,
    NODE_TYPE: 1,
    NODE_NAME: 2,
    INTENT: 3,
    ENTITY_TYPE: 4,
    ENTITY: 5,
    NLU_DISABLED: 6,
    NEXT_NODES: 7,
    MESSAGE: 8,
    RICH_TYPE: 9,
    RICH_CONTENT: 10,
    ANS_REQ: 11,
    BEHAVIORS: 12,
    COMMAND: 13,
    DESCRIPTION: 14,
    OUTPUT: 15,
    NODE_INPUT: 16,
    PARAM_INPUT: 17,
    DEC_VAR: 18,
    WHAT_NEXT: 19,
    TAGS: 20,
    SKILL: 21,
    VARIABLE: 22,
    PLATFORM: 23,
    FLOWS: 24,
    CSS: 25
  };
  
  // Known action node commands
  const KNOWN_COMMANDS = new Set([
    'SysAssignVariable', 'SysMultiMatchRouting', 'SysShowMetadata', 'SysSetEnv', 
    'SysVariableReset', 'HandleBotError', 'SlackLogger', 'UserPlatformRouting',
    'GetValue', 'SetVar', 'VarCheck', 'ValidateRegex', 'ValidateDate',
    'ListPickerGenerator', 'GetAllProducts', 'ProductRecommendation', 'ProductQA',
    'GenAIFallback', 'GetGPTCompletion', 'BotToPlatform', 'LimitCounter',  // Added GenAI and other common scripts
    'EventsToGlobalVariableValues', 'SetFormID', 'PostEventToBQ'
  ]);
  
  // Rich asset types
  const RICH_TYPES = new Set(['buttons', 'button', 'listpicker', 'carousel', 'webview', 'datepicker', 'timepicker', 'file_upload', 'star_rating']);
  
  // Behaviors
  const BEHAVIORS = new Set(['disable_input', 'xfer_to_agent', 'multiple_choice', 'inline', 'secure']);
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse the line
    const values = parseCSVLineForFix(line);
    
    // Create a new row with exactly 26 columns
    const newRow: string[] = new Array(26).fill('');
    
    // First 3 columns are usually correct
    newRow[COL.NODE_NUM] = values[0] || '';
    newRow[COL.NODE_TYPE] = values[1] || '';
    newRow[COL.NODE_NAME] = values[2] || '';
    
    const nodeType = (values[1] || '').toUpperCase();
    
    // Analyze remaining values and place in correct columns
    const remaining = values.slice(3);
    
    if (nodeType === 'D') {
      // Decision node - look for message, rich asset, behaviors
      placeDecisionNodeValues(remaining, newRow, COL, RICH_TYPES, BEHAVIORS);
    } else if (nodeType === 'A') {
      // Action node - look for command, description, parameter input, what next
      placeActionNodeValues(remaining, newRow, COL, KNOWN_COMMANDS);
    }
    
    // Convert back to CSV line with proper escaping
    const csvLine = newRow.map(v => escapeCSVValue(v)).join(',');
    fixedLines.push(csvLine);
  }
  
  return fixedLines.join('\n');
}

/**
 * Escape a value for CSV output
 */
function escapeCSVValue(value: string): string {
  if (!value) return '';
  // If contains comma, quote, or newline, wrap in quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Place Decision node values in correct columns
 */
function placeDecisionNodeValues(
  values: string[], 
  row: string[], 
  COL: Record<string, number>,
  RICH_TYPES: Set<string>,
  BEHAVIORS: Set<string>
) {
  for (const val of values) {
    const v = val.trim();
    if (!v) continue;
    
    const vLower = v.toLowerCase();
    
    // Check for known patterns
    if (vLower === 'out_of_scope' || vLower.includes('intent')) {
      row[COL.INTENT] = v;
    } else if (v === '0' || v === '1') {
      // Could be NLU Disabled, Answer Required, or Next Nodes
      if (!row[COL.ANS_REQ] && row[COL.MESSAGE]) {
        row[COL.ANS_REQ] = v;
      } else if (!row[COL.NLU_DISABLED]) {
        row[COL.NLU_DISABLED] = v;
      }
    } else if (/^\d+$/.test(v) && parseInt(v) < 100000) {
      // Numeric value - likely Next Nodes
      if (!row[COL.NEXT_NODES]) {
        row[COL.NEXT_NODES] = v;
      }
    } else if (RICH_TYPES.has(vLower)) {
      row[COL.RICH_TYPE] = v;
    } else if (v.startsWith('{') && v.includes('type')) {
      // JSON with type - Rich Asset Content
      row[COL.RICH_CONTENT] = v;
    } else if (v.includes('~') && v.includes('|')) {
      // Pipe format buttons - Rich Asset Content
      row[COL.RICH_CONTENT] = v;
    } else if (BEHAVIORS.has(vLower)) {
      row[COL.BEHAVIORS] = v;
    } else if (vLower === 'xfer_to_agent') {
      row[COL.BEHAVIORS] = v;
    } else if (vLower.includes('_entry') || vLower.includes('_exit')) {
      row[COL.FLOWS] = v;
    } else if (vLower.includes('collect_user_info')) {
      row[COL.PLATFORM] = v;
    } else if (v.includes(':') && !v.includes('{')) {
      // Could be Node Input format
      row[COL.NODE_INPUT] = v;
    } else if (!row[COL.MESSAGE] && v.length > 10 && !v.startsWith('{')) {
      // Long text without JSON - likely Message
      row[COL.MESSAGE] = v;
    }
  }
}

/**
 * Place Action node values in correct columns
 */
function placeActionNodeValues(
  values: string[], 
  row: string[], 
  COL: Record<string, number>,
  KNOWN_COMMANDS: Set<string>
) {
  for (const val of values) {
    const v = val.trim();
    if (!v) continue;
    
    // Check for known patterns
    if (KNOWN_COMMANDS.has(v)) {
      row[COL.COMMAND] = v;
    } else if (v.startsWith('{') && (v.includes('set') || v.includes('global_vars') || v.includes('assign') || v.includes('save'))) {
      // JSON - Parameter Input
      row[COL.PARAM_INPUT] = v;
    } else if (v.includes('~') && v.includes('|') && v.includes('error')) {
      // What Next routing
      row[COL.WHAT_NEXT] = v;
    } else if (v === 'success' || v === 'valid' || v === 'error_type') {
      // Could be Output or Decision Variable
      if (!row[COL.OUTPUT]) {
        row[COL.OUTPUT] = v;
      } else if (!row[COL.DEC_VAR]) {
        row[COL.DEC_VAR] = v;
      }
    } else if (v.includes(',') && v.includes('CHATID')) {
      // Variable list
      row[COL.VARIABLE] = v;
    } else if (v.toUpperCase() === v && v.includes('_')) {
      // ALL_CAPS with underscore - likely Variable
      row[COL.VARIABLE] = v;
    } else if (v.includes(':') && !v.startsWith('{')) {
      // Node Input format
      row[COL.NODE_INPUT] = v;
    } else if (v.length > 5 && !v.startsWith('{') && !row[COL.DESCRIPTION]) {
      // Descriptive text
      row[COL.DESCRIPTION] = v;
    }
  }
}

/**
 * Parse a CSV line handling quoted fields
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
 * Validate generated CSV content
 */
export function validateCSV(csv: string): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    errors.push('CSV must have at least a header row and one data row');
    return { valid: false, errors, warnings };
  }

  // Check header
  const header = lines[0];
  const expectedColumns = [
    'Node Number', 'Node Type', 'Node Name', 'Intent', 'Entity Type', 'Entity',
    'NLU Disabled?', 'Next Nodes', 'Message', 'Rich Asset Type', 'Rich Asset Content',
    'Answer Required?', 'Behaviors', 'Command', 'Description', 'Output', 'Node Input',
    'Parameter Input', 'Decision Variable', 'What Next?', 'Node Tags', 'Skill Tag',
    'Variable', 'Platform Flag', 'Flows', 'CSS Classname'
  ];
  
  const headerColumns = parseCSVLine(header);
  if (headerColumns.length !== 26) {
    errors.push(`CSV must have exactly 26 columns, found ${headerColumns.length}`);
  }

  // Collect all node data for reference validation
  const nodeNumbers = new Set<string>();
  const nodeData: { nodeNum: string; nodeType: string; nextNodes: string; whatNext: string; message: string; nodeName: string }[] = [];
  const requiredNodes = ['-500', '666', '1800', '99990'];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const parts = parseCSVLine(line);
    
    if (parts.length < 2) continue;
    
    const nodeNum = parts[0]?.trim();
    const nodeType = parts[1]?.trim().toUpperCase();
    const nodeName = parts[2]?.trim() || '';
    const nextNodes = parts[7]?.trim() || '';
    const message = parts[8]?.trim() || '';
    const whatNext = parts[19]?.trim() || '';
    
    if (nodeNum) {
      if (nodeNumbers.has(nodeNum)) {
        errors.push(`Duplicate node number: ${nodeNum}`);
      }
      nodeNumbers.add(nodeNum);
      nodeData.push({ nodeNum, nodeType, nextNodes, whatNext, message, nodeName });
    }
  }

  // Check for required system nodes
  for (const required of requiredNodes) {
    if (!nodeNumbers.has(required)) {
      warnings.push(`Missing recommended system node: ${required}`);
    }
  }

  // Validate node references
  for (const node of nodeData) {
    // Check Next Nodes references (Decision nodes)
    if (node.nodeType === 'D' && node.nextNodes) {
      const refs = node.nextNodes.split(',').map(r => r.trim()).filter(r => r);
      for (const ref of refs) {
        if (!nodeNumbers.has(ref)) {
          warnings.push(`Node ${node.nodeNum}: Next Node reference "${ref}" does not exist`);
        }
      }
    }
    
    // Check What Next? references (Action nodes)
    if (node.nodeType === 'A' && node.whatNext) {
      // Parse format: value~node|value~node
      const pairs = node.whatNext.split('|');
      for (const pair of pairs) {
        const parts = pair.split('~');
        if (parts.length === 2) {
          const targetNode = parts[1].trim();
          if (targetNode && !nodeNumbers.has(targetNode)) {
            warnings.push(`Node ${node.nodeNum}: What Next reference "${targetNode}" does not exist`);
          }
        }
      }
      
      // Check for error path
      if (!node.whatNext.toLowerCase().includes('error')) {
        warnings.push(`Node ${node.nodeNum} (${node.nodeName}): What Next should include an error path`);
      }
    }
    
    // Check for reserved characters in messages
    if (node.message && /[*=]/.test(node.message)) {
      warnings.push(`Node ${node.nodeNum}: Message contains reserved characters (* or =)`);
    }
    
    // Check message length
    if (node.message && node.message.length > 200) {
      warnings.push(`Node ${node.nodeNum}: Message is ${node.message.length} chars - consider splitting`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Official Pypestream action node scripts
const OFFICIAL_ACTION_NODES = new Set([
  // System nodes (Sys* prefix)
  'SysAssignVariable',
  'SysMultiMatchRouting', 
  'SysShowMetadata',
  'SysSetEnv',
  'SysVariableReset',
  // Common scripts
  'HandleBotError',
  'SlackLogger',
  'UserPlatformRouting',
  'GetValue',
  'SetVar',
  'VarCheck',
  'ValidateRegex',
  'ValidateDate',
  'BotToPlatform',
  'LimitCounter',
  'EventsToGlobalVariableValues',
  'SetFormID',
  'PostEventToBQ',
  // Product/List generation
  'ListPickerGenerator',
  'GetAllProducts',
  'ProductRecommendation',
  'ProductQA',
  // File handling
  'UploadImageGCS',
  'UploadImagePypestream'
]);

/**
 * Parse CSV to extract node count and other stats
 */
export function parseCSVStats(csv: string): {
  totalNodes: number;
  decisionNodes: number;
  actionNodes: number;
  officialNodesUsed: string[];
} {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    return { totalNodes: 0, decisionNodes: 0, actionNodes: 0, officialNodesUsed: [] };
  }

  let decisionNodes = 0;
  let actionNodes = 0;
  const officialNodesFound = new Set<string>();
  
  // Command column is index 13 (0-indexed)
  const COMMAND_COL = 13;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Use parseCSVLine to properly handle quoted fields with commas
    const parts = parseCSVLine(line);
    if (parts.length > 1) {
      const nodeType = parts[1].trim().toUpperCase();
      if (nodeType === 'D') decisionNodes++;
      else if (nodeType === 'A') {
        actionNodes++;
        // Check if command is an official node
        const command = parts[COMMAND_COL]?.trim();
        if (command && OFFICIAL_ACTION_NODES.has(command)) {
          officialNodesFound.add(command);
        }
      }
    }
  }

  return {
    totalNodes: lines.length - 1,
    decisionNodes,
    actionNodes,
    officialNodesUsed: Array.from(officialNodesFound).sort(),
  };
}

/**
 * Refinement result from AI
 */
export interface RefinementResult {
  csv: string;
  fixesMade: string[];
  stillBroken: string[];
}

/**
 * Iterative refinement cycle result
 */
export interface IterativeRefinementResult {
  csv: string;
  valid: boolean;
  iterations: number;
  maxIterationsReached: boolean;
  allFixesMade: string[];
  remainingErrors: string[];
  versionId?: string;
}

/**
 * Callback for refinement progress updates
 */
export type RefinementProgressCallback = (update: {
  iteration: number;
  phase: 'validating' | 'refining';
  message: string;
  errors?: string[];
}) => void;

/**
 * Refine CSV based on validation errors
 */
export async function refineCSV(
  csv: string,
  validationErrors: any[],
  projectConfig: { clientName?: string; projectName?: string; projectType?: string },
  iteration: number,
  knownFixesContext?: string
): Promise<RefinementResult> {
  const response = await fetch('/api/refine-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      csv,
      validationErrors,
      projectConfig,
      iteration,
      knownFixesContext,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Refinement failed: ${response.status}`);
  }

  const result = await response.json();
  
  // Post-process the refined CSV: normalize, align, fix Decision Variables, then inject startup nodes
  const normalizedRefinedCSV = normalizeCSVColumns(result.csv);
  const alignedCSV = fixCSVColumnAlignment(normalizedRefinedCSV);
  const decVarFixedCSV = fixDecisionVariables(alignedCSV);
  
  // CRITICAL: Re-inject required startup nodes after refinement
  // AI refinement might accidentally remove or break startup nodes
  const fixedCSV = injectRequiredStartupNodes(decVarFixedCSV);

  return {
    csv: fixedCSV,
    fixesMade: result.fixesMade || [],
    stillBroken: result.stillBroken || [],
  };
}

/**
 * Validate and iteratively refine CSV until it passes Bot Manager validation
 * 
 * This creates an AI-driven feedback loop:
 * 1. Validate CSV with Bot Manager API
 * 2. If errors, send to AI for fixes
 * 3. Re-validate
 * 4. Repeat until valid or max iterations reached
 */
export async function validateAndRefineIteratively(
  initialCSV: string,
  botId: string,
  token: string,
  projectConfig: { clientName?: string; projectName?: string; projectType?: string },
  onProgress?: RefinementProgressCallback,
  maxIterations: number = 5
): Promise<IterativeRefinementResult> {
  let currentCSV = initialCSV;
  let iteration = 0;
  const allFixesMade: string[] = [];
  let lastErrors: string[] = [];
  let lastRawErrors: ValidationError[] = [];
  let versionId: string | undefined;
  
  // Track error pattern IDs for fix logging
  const errorPatternIds: Map<string, string> = new Map();
  
  // Track error signatures across iterations for stuck loop detection
  const errorSignatureHistory: Set<string>[] = [];
  
  // Timing for each iteration
  const refinementStart = performance.now();
  const iterationTimings: Array<{ iteration: number; preValidation: number; botManagerValidation: number; aiRefinement: number; total: number; errorsIn: number; errorsOut: number }> = [];
  
  // Track consecutive stuck iterations for early break-out
  let consecutiveStuckIterations = 0;
  
  // Track error signatures that have been tried and failed - exclude from future AI calls
  const unfixableSignatures = new Set<string>();

  while (iteration < maxIterations) {
    iteration++;
    
    const iterStart = performance.now();
    let preValTime = 0, bmValTime = 0, aiRefineTime = 0;
    
    // Pre-iteration: Run structural pre-validation first, then sanitize
    const preValStart = performance.now();
    const preResult = structuralPreValidation(currentCSV);
    if (preResult.fixes.length > 0) {
      console.log(`[Refine] Structural pre-validation applied ${preResult.fixes.length} fixes at iteration ${iteration}:`, preResult.fixes);
      allFixesMade.push(...preResult.fixes.filter(f => !f.startsWith('WARNING:')));
      currentCSV = preResult.csv;
    }
    const sanitizedCSV = sanitizeCSVForDeploy(currentCSV);
    if (sanitizedCSV !== currentCSV) {
      console.log(`[Refine] Applied automatic sanitization fixes at iteration ${iteration}`);
      currentCSV = sanitizedCSV;
    }
    preValTime = Math.round(performance.now() - preValStart);
    
    // Phase 1: Validate with Bot Manager API
    const bmValStart = performance.now();
    onProgress?.({
      iteration,
      phase: 'validating',
      message: `Validating with Bot Manager API (attempt ${iteration}/${maxIterations})...`,
    });

    const validationResponse = await fetch('/api/botmanager/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: currentCSV, botId, token }),
    });

    const validationResult = await validationResponse.json();
    bmValTime = Math.round(performance.now() - bmValStart);
    
    // Check for auth errors
    if (validationResult.authError || validationResponse.status === 401) {
      throw new AuthError(validationResult.errors || 'API token is invalid or expired');
    }
    
    // Check if validation passed
    if (validationResult.valid) {
      onProgress?.({
        iteration,
        phase: 'validating',
        message: 'Validation passed!',
      });
      
      // Log timing for final iteration
      const iterTotal = Math.round(performance.now() - iterStart);
      iterationTimings.push({ iteration, preValidation: preValTime, botManagerValidation: bmValTime, aiRefinement: 0, total: iterTotal, errorsIn: lastRawErrors.length, errorsOut: 0 });
      logRefinementTimingSummary(iterationTimings, refinementStart);
      
      // Log successful fixes for errors that were fixed in the last iteration
      if (iteration > 1 && lastRawErrors.length > 0) {
        await logSuccessfulFixes(lastRawErrors, allFixesMade.slice(-5), errorPatternIds);
      }
      
      return {
        csv: currentCSV,
        valid: true,
        iterations: iteration,
        maxIterationsReached: false,
        allFixesMade,
        remainingErrors: [],
        versionId: validationResult.versionId,
      };
    }

    // Validation failed - extract errors
    const errors: ValidationError[] = validationResult.errors || [];
    lastErrors = formatValidationErrors(errors);
    
    // Log error patterns to the learning system (non-blocking)
    logErrorPatternsBatch(errors, currentCSV, errorPatternIds).catch(e => {
      console.warn('[SELF-IMPROVE] ❌ Failed to log error patterns:', e);
    });
    
    // Check which errors from last iteration were fixed
    if (iteration > 1 && lastRawErrors.length > 0) {
      const currentSignatures = new Set(errors.map(e => normalizeError(e)));
      const fixedErrors = lastRawErrors.filter(e => !currentSignatures.has(normalizeError(e)));
      
      if (fixedErrors.length > 0) {
        console.log(`[Refine] ${fixedErrors.length} errors were fixed in this iteration`);
        // Log successful fixes for the errors that are now gone
        await logSuccessfulFixes(fixedErrors, allFixesMade.slice(-5), errorPatternIds);
      }
      
      // Log failed fixes for errors that persist
      const persistingErrors = lastRawErrors.filter(e => currentSignatures.has(normalizeError(e)));
      if (persistingErrors.length > 0) {
        await logFailedFixes(persistingErrors, allFixesMade.slice(-5), errorPatternIds);
      }
    }
    
    lastRawErrors = errors;
    
    // Track current error signatures for stuck loop detection
    const currentSignatures = new Set(errors.map(e => normalizeError(e)));
    
    // Stuck loop detection: Check if the SAME errors persist across iterations
    let stuckLoopDetected = false;
    if (iteration > 1 && errorSignatureHistory.length > 0) {
      const prevSignatures = errorSignatureHistory[errorSignatureHistory.length - 1];
      const unchangedCount = [...currentSignatures].filter(s => prevSignatures.has(s)).length;
      
      if (unchangedCount === currentSignatures.size && unchangedCount > 0) {
        console.warn(`[AI Refine] STUCK LOOP DETECTED - same ${unchangedCount} errors persist after iteration ${iteration}`);
        stuckLoopDetected = true;
        consecutiveStuckIterations++;
        
        // Mark these errors as unfixable so we don't waste AI tokens on them
        for (const error of errors) {
          unfixableSignatures.add(normalizeError(error));
        }
        
        // Break out early after 2 consecutive stuck iterations - no point burning more API calls
        if (consecutiveStuckIterations >= 2) {
          console.warn(`[AI Refine] Breaking out after ${consecutiveStuckIterations} consecutive stuck iterations - errors cannot be fixed programmatically or by AI`);
          errorSignatureHistory.push(currentSignatures);
          break;
        }
        
        // Apply aggressive programmatic fixes for stuck errors
        let aggressiveFixedCsv = currentCSV;
        for (const error of errors) {
          const beforeFix = aggressiveFixedCsv;
          aggressiveFixedCsv = applyProgrammaticFixForError(aggressiveFixedCsv, error);
          if (aggressiveFixedCsv !== beforeFix) {
            console.log(`[AI Refine] Aggressive fix applied for stuck error in node ${error.node_num}`);
            allFixesMade.push(`Aggressive programmatic fix for stuck error in node ${error.node_num}`);
          }
        }
        
        // Additional aggressive fixes: sanitize again after programmatic fixes
        aggressiveFixedCsv = sanitizeCSVForDeploy(aggressiveFixedCsv);
        
        if (aggressiveFixedCsv !== currentCSV) {
          currentCSV = aggressiveFixedCsv;
          console.log('[AI Refine] Applied aggressive fixes for stuck loop - skipping AI refinement this iteration');
          // Skip AI refinement this iteration - go directly to re-validation
          errorSignatureHistory.push(currentSignatures);
          continue;
        }
      } else {
        // Made progress - reset the stuck counter
        consecutiveStuckIterations = 0;
      }
    }
    errorSignatureHistory.push(currentSignatures);
    
    onProgress?.({
      iteration,
      phase: 'validating',
      message: `Found ${lastErrors.length} validation errors${stuckLoopDetected ? ' (stuck loop detected)' : ''}`,
      errors: lastErrors, // Send ALL errors so UI can show full count
    });

    // Check if we've reached max iterations
    if (iteration >= maxIterations) {
      break;
    }

    // === Phase 1.5: Try programmatic fixes BEFORE AI ===
    // Classify errors and fix what we can deterministically
    let programmaticFixCount = 0;
    const errorsForAI: ValidationError[] = [];
    
    for (const error of errors) {
      const beforeFix = currentCSV;
      currentCSV = applyProgrammaticFixForError(currentCSV, error);
      if (currentCSV !== beforeFix) {
        programmaticFixCount++;
        allFixesMade.push(`Programmatic fix for node ${error.node_num || 'unknown'}`);
      } else {
        // Only add to AI queue if not previously marked as unfixable
        const sig = normalizeError(error);
        if (!unfixableSignatures.has(sig)) {
          errorsForAI.push(error);
        }
      }
    }
    
    if (programmaticFixCount > 0) {
      console.log(`[Refine] 🔧 Programmatic fixes applied: ${programmaticFixCount}/${errors.length} errors (${errorsForAI.length} remaining for AI)`);
      
      // Re-run structural validation after programmatic fixes
      const recheck = structuralPreValidation(currentCSV);
      if (recheck.fixes.length > 0) {
        currentCSV = recheck.csv;
        allFixesMade.push(...recheck.fixes.filter(f => !f.startsWith('WARNING:')));
      }
      
      // CRITICAL: Re-inject startup nodes after programmatic fixes
      // This ensures protected startup nodes (1800 GenAIFallback, etc.) are always correct
      const startupFixedCSV = injectRequiredStartupNodes(currentCSV);
      if (startupFixedCSV !== currentCSV) {
        console.log('[Refine] 🔧 Re-injected startup nodes after programmatic fixes');
        currentCSV = startupFixedCSV;
      }
      
      // If all errors were fixed programmatically, skip AI entirely
      if (errorsForAI.length === 0) {
        console.log(`[Refine] ✅ All errors fixed programmatically! Skipping AI refinement.`);
        const iterTotal = Math.round(performance.now() - iterStart);
        iterationTimings.push({ iteration, preValidation: preValTime, botManagerValidation: bmValTime, aiRefinement: 0, total: iterTotal, errorsIn: lastRawErrors.length, errorsOut: 0 });
        continue; // Go back to validation
      }
    }

    // Check if all remaining errors are unfixable (no programmatic fixes worked AND errors were filtered out)
    if (errorsForAI.length === 0 && errors.length > 0 && programmaticFixCount === 0) {
      console.log(`[Refine] All ${errors.length} remaining errors marked unfixable, skipping AI refinement`);
      const iterTotal = Math.round(performance.now() - iterStart);
      iterationTimings.push({ iteration, preValidation: preValTime, botManagerValidation: bmValTime, aiRefinement: 0, total: iterTotal, errorsIn: lastRawErrors.length, errorsOut: errors.length });
      break;
    }
    
    // If errorsForAI is empty but programmatic fixes were made, continue to re-validate
    if (errorsForAI.length === 0) {
      console.log(`[Refine] No errors for AI (${programmaticFixCount} programmatic fixes applied), re-validating...`);
      const iterTotal = Math.round(performance.now() - iterStart);
      iterationTimings.push({ iteration, preValidation: preValTime, botManagerValidation: bmValTime, aiRefinement: 0, total: iterTotal, errorsIn: lastRawErrors.length, errorsOut: 0 });
      continue;
    }

    // Query known fixes from the learning system
    let knownFixesContext = '';
    try {
      const knownFixes = await getKnownFixes(errorsForAI);
      if (knownFixes.length > 0) {
        console.log(`[SELF-IMPROVE] 🧠 Found ${knownFixes.length} known fixes to apply for current errors`);
        knownFixesContext = formatKnownFixesForPrompt(knownFixes);
      }
    } catch (e) {
      console.warn('[SELF-IMPROVE] ❌ Failed to query known fixes:', e);
    }

    // Phase 2: Refine with AI (only for errors we couldn't fix programmatically)
    const aiRefineStart = performance.now();
    const aiErrorCount = errorsForAI.length;
    onProgress?.({
      iteration,
      phase: 'refining',
      message: `AI is fixing ${aiErrorCount} errors (${programmaticFixCount} already fixed programmatically)...`,
      errors: lastErrors,
    });

    try {
      // Send only the errors AI needs to fix, not all errors
      const refinement = await refineCSV(currentCSV, errorsForAI, projectConfig, iteration, knownFixesContext);
      
      // === GUARD RAIL: Reject AI output that's structurally worse ===
      const originalLines = currentCSV.split('\n').filter(l => l.trim());
      const refinedLines = refinement.csv.split('\n').filter(l => l.trim());
      
      // Check 1: Row count shouldn't change dramatically (allow ±5% or ±3 rows)
      const rowDiff = Math.abs(refinedLines.length - originalLines.length);
      const rowDiffPct = rowDiff / originalLines.length;
      if (rowDiffPct > 0.05 && rowDiff > 3) {
        console.warn(`[AI Refine] GUARD RAIL: Row count changed too much (${originalLines.length}→${refinedLines.length}, ${(rowDiffPct * 100).toFixed(1)}%). Rejecting AI fix.`);
        // Fall through to programmatic fixes only
        refinement.csv = currentCSV;
        refinement.fixesMade = ['REJECTED: AI changed row count too much'];
      }
      
      // Check 2: Verify column alignment — every data row should have ~25 commas
      if (refinement.csv !== currentCSV) {
        const badColumnRows: number[] = [];
        const checkLines = refinement.csv.split('\n');
        for (let i = 1; i < checkLines.length; i++) {
          const line = checkLines[i].trim();
          if (!line) continue;
          // Count commas outside of quoted fields
          let commaCount = 0;
          let inQuotes = false;
          for (let j = 0; j < line.length; j++) {
            if (line[j] === '"') inQuotes = !inQuotes;
            else if (line[j] === ',' && !inQuotes) commaCount++;
          }
          if (commaCount !== 25) {
            badColumnRows.push(i);
          }
        }
        if (badColumnRows.length > 5) {
          console.warn(`[AI Refine] GUARD RAIL: ${badColumnRows.length} rows have wrong column count. Rejecting AI fix.`);
          refinement.csv = currentCSV;
          refinement.fixesMade = [`REJECTED: ${badColumnRows.length} rows had wrong column alignment`];
        } else if (badColumnRows.length > 0) {
          console.warn(`[AI Refine] GUARD RAIL: ${badColumnRows.length} rows have wrong column count (rows: ${badColumnRows.slice(0, 5).join(',')}). Allowing but logging.`);
        }
      }
      
      // CRITICAL: Verify that the AI's fix actually addresses the error
      // by checking if the SPECIFIC NODE still contains the error content in the flagged field
      let verifiedCsv = refinement.csv;
      let programmaticFixesApplied: string[] = [];
      
      for (const error of errors) {
        const errorContent = error.err_msgs?.[0]?.field_entry;
        const errorNodeNum = error.node_num;
        const errorFieldName = error.err_msgs?.[0]?.field_name;
        if (!errorContent || !errorNodeNum) continue;
        
        // Check the specific node row, not the entire CSV
        // Pass fieldName to avoid false positives (e.g., fix sets "success" and we find it in another field)
        const stillPresent = isErrorStillInNode(verifiedCsv, errorNodeNum, errorContent, errorFieldName);
        if (stillPresent) {
          console.warn(`[AI Refine] FIX NOT APPLIED - Node ${errorNodeNum} still contains error content: ${errorContent.substring(0, 50)}...`);
          // Apply programmatic fix as fallback
          const beforeFix = verifiedCsv;
          verifiedCsv = applyProgrammaticFixForError(verifiedCsv, error);
          if (verifiedCsv !== beforeFix) {
            programmaticFixesApplied.push(`Programmatic fix applied for node ${error.node_num}`);
          }
        }
      }
      
      if (programmaticFixesApplied.length > 0) {
        console.log(`[AI Refine] Applied ${programmaticFixesApplied.length} programmatic fallback fixes`);
        refinement.fixesMade.push(...programmaticFixesApplied);
        
        // CRITICAL: Re-inject startup nodes after fallback fixes
        verifiedCsv = injectRequiredStartupNodes(verifiedCsv);
      }
      
      currentCSV = verifiedCsv;
      allFixesMade.push(...refinement.fixesMade);
      
      onProgress?.({
        iteration,
        phase: 'refining',
        message: `Applied ${refinement.fixesMade.length} fixes`,
      });
      
      // If AI reports it couldn't fix some issues, note them
      if (refinement.stillBroken.length > 0) {
        console.log('[Refine] AI reported unfixable issues:', refinement.stillBroken);
      }
    } catch (refineError: any) {
      console.error('[Refine] Refinement error:', refineError);
      onProgress?.({
        iteration,
        phase: 'refining',
        message: `Refinement error: ${refineError.message}`,
      });
      // Continue to next iteration anyway
    }
    aiRefineTime = Math.round(performance.now() - aiRefineStart);
    
    // Log iteration timing
    const errorsOut = lastErrors.length;
    const iterTotal = Math.round(performance.now() - iterStart);
    iterationTimings.push({ iteration, preValidation: preValTime, botManagerValidation: bmValTime, aiRefinement: aiRefineTime, total: iterTotal, errorsIn: lastRawErrors.length, errorsOut });
    console.log(`[⏱ Iteration ${iteration}] preVal: ${preValTime}ms | bmVal: ${bmValTime}ms | aiRefine: ${aiRefineTime}ms | total: ${iterTotal}ms | errors: ${lastRawErrors.length}→${errorsOut}`);
  }

  // Max iterations reached without full success
  logRefinementTimingSummary(iterationTimings, refinementStart);
  
  // Log remaining errors as failed fixes
  if (lastRawErrors.length > 0) {
    await logFailedFixes(lastRawErrors, allFixesMade.slice(-5), errorPatternIds);
  }

  return {
    csv: currentCSV,
    valid: false,
    iterations: iteration,
    maxIterationsReached: true,
    allFixesMade,
    remainingErrors: lastErrors,
    versionId,
  };
}

/**
 * Log a formatted timing summary table for the refinement loop
 */
function logRefinementTimingSummary(
  timings: Array<{ iteration: number; preValidation: number; botManagerValidation: number; aiRefinement: number; total: number; errorsIn: number; errorsOut: number }>,
  overallStart: number
) {
  const totalMs = Math.round(performance.now() - overallStart);
  console.log(`\n[⏱ Refinement Summary] Total: ${(totalMs / 1000).toFixed(2)}s across ${timings.length} iteration(s)`);
  console.table(timings.map(t => ({
    Iteration: t.iteration,
    'Pre-Validation': `${t.preValidation}ms`,
    'Bot Manager API': `${t.botManagerValidation}ms`,
    'AI Refinement': `${t.aiRefinement}ms`,
    'Total': `${(t.total / 1000).toFixed(2)}s`,
    'Errors In': t.errorsIn,
    'Errors Out': t.errorsOut,
  })));
  
  // Aggregate stats
  const totalPreVal = timings.reduce((s, t) => s + t.preValidation, 0);
  const totalBmVal = timings.reduce((s, t) => s + t.botManagerValidation, 0);
  const totalAiRefine = timings.reduce((s, t) => s + t.aiRefinement, 0);
  console.log(`[⏱ Aggregates] preValidation: ${totalPreVal}ms | botManagerAPI: ${totalBmVal}ms | aiRefinement: ${totalAiRefine}ms | overhead: ${totalMs - totalPreVal - totalBmVal - totalAiRefine}ms`);
  
  // === PIPELINE QUALITY METRICS ===
  const aiWasNeeded = timings.some(t => t.aiRefinement > 0);
  const initialErrors = timings[0]?.errorsIn || 0;
  const finalErrors = timings[timings.length - 1]?.errorsOut || 0;
  const errorExplosions = timings.filter(t => t.errorsOut > t.errorsIn).length;
  const programmaticFixPct = totalAiRefine === 0 ? 100 : 
    Math.round((totalPreVal / (totalPreVal + totalAiRefine)) * 100);
  
  console.log(`\n[📊 Pipeline Quality]`);
  console.log(`  AI refinement needed: ${aiWasNeeded ? '❌ YES' : '✅ NO'}`);
  console.log(`  Initial errors: ${initialErrors} → Final: ${finalErrors}`);
  console.log(`  Error explosions: ${errorExplosions}`);
  console.log(`  Fix time split: ${programmaticFixPct}% programmatic / ${100 - programmaticFixPct}% AI`);
  console.log(`  Target: AI needed <10%, explosions = 0`);
}

/**
 * Log a batch of error patterns to the learning system
 */
async function logErrorPatternsBatch(
  errors: ValidationError[],
  csv: string,
  patternIdMap: Map<string, string>
): Promise<void> {
  for (const error of errors) {
    const signature = normalizeError(error);
    if (!patternIdMap.has(signature)) {
      const patternId = await logErrorPattern(error, csv);
      if (patternId) {
        patternIdMap.set(signature, patternId);
      }
    }
  }
}

/**
 * Log successful fixes for errors that were resolved
 */
async function logSuccessfulFixes(
  fixedErrors: ValidationError[],
  recentFixes: string[],
  patternIdMap: Map<string, string>
): Promise<void> {
  if (fixedErrors.length === 0) return;
  
  console.log(`[SELF-IMPROVE] 📊 Logging ${fixedErrors.length} SUCCESSFUL fixes`);
  
  const fixDescription = recentFixes.length > 0 
    ? recentFixes.join('; ')
    : 'Fix applied (details not captured)';
  
  for (const error of fixedErrors) {
    const signature = normalizeError(error);
    const patternId = patternIdMap.get(signature);
    if (patternId) {
      await logFixAttempt(patternId, fixDescription, true);
    }
  }
}

/**
 * Log failed fixes for errors that persist
 * Deduplicated by pattern ID: logs each UNIQUE pattern once, not per-error
 */
async function logFailedFixes(
  persistingErrors: ValidationError[],
  recentFixes: string[],
  patternIdMap: Map<string, string>
): Promise<void> {
  if (recentFixes.length === 0 || persistingErrors.length === 0) return;
  
  const fixDescription = recentFixes.join('; ');
  
  // Deduplicate by pattern ID - log each unique pattern once
  const loggedPatterns = new Set<string>();
  for (const error of persistingErrors) {
    const signature = normalizeError(error);
    const patternId = patternIdMap.get(signature);
    if (patternId && !loggedPatterns.has(patternId)) {
      loggedPatterns.add(patternId);
      await logFixAttempt(patternId, fixDescription, false);
    }
  }
  
  // Log ONE summary line to console
  console.log(`[SELF-IMPROVE] 📊 ${loggedPatterns.size} unique patterns failed (${persistingErrors.length} total errors)`);
}

/**
 * Format validation errors for display
 */
function formatValidationErrors(errors: any[]): string[] {
  if (!errors || !Array.isArray(errors)) return [];
  
  return errors.flatMap(err => {
    if (typeof err === 'string') return [err];
    
    // Handle Bot Manager API format: {row_num, node_num, err_msgs: [{field_name, error_description}]}
    if (err.node_num !== undefined || err.row_num !== undefined) {
      const nodeInfo = err.node_num ? `Node ${err.node_num}` : `Row ${err.row_num}`;
      if (err.err_msgs && Array.isArray(err.err_msgs)) {
        return err.err_msgs.map((msg: any) => {
          const field = msg.field_name ? `[${msg.field_name}] ` : '';
          const desc = msg.error_description || msg.message || JSON.stringify(msg);
          return `${nodeInfo}: ${field}${desc}`;
        });
      }
      return [`${nodeInfo}: ${JSON.stringify(err)}`];
    }
    
    // Handle old array format
    if (Array.isArray(err)) {
      const [nodeNum, details] = err;
      if (Array.isArray(details)) {
        return details.map((d: any) => {
          if (Array.isArray(d)) {
            const [category, field, message] = d;
            return `Node ${nodeNum || '?'}: ${message || d}`;
          }
          return String(d);
        });
      }
      return [`Node ${nodeNum}: ${JSON.stringify(details)}`];
    }
    
    return [JSON.stringify(err)];
  }).filter(Boolean);
}

// ============================================
// SEQUENTIAL CSV GENERATION
// ============================================

/**
 * Standard 26-column CSV header for Pypestream bots
 */
export const CSV_HEADER = 'Node Number,Node Type,Node Name,Intent,Entity Type,Entity,NLU Disabled?,Next Nodes,Message,Rich Asset Type,Rich Asset Content,Answer Required?,Behaviors,Command,Description,Output,Node Input,Parameter Input,Decision Variable,What Next?,Node Tags,Skill Tag,Variable,Platform Flag,Flows,CSS Classname';

/**
 * Flow definition for sequential generation
 */
export interface FlowPlan {
  name: string;
  description: string;
  startNode: number;
  endNode: number;
}

/**
 * Progress callback for sequential generation
 */
export interface SequentialProgress {
  step: 'startup' | 'planning' | 'flow' | 'assembly' | 'validation';
  status: 'started' | 'done' | 'error';
  flowName?: string;
  rows?: number;
  totalFlows?: number;
  currentFlow?: number;
  message?: string;
}

/**
 * Main menu option from flow planning
 */
interface MainMenuOption {
  label: string;
  description?: string;
  flowName?: string;
  startNode?: number;
}

/**
 * Options for startup node generation
 */
interface StartupNodeOptions {
  targetCompany?: string;
  mainMenuOptions?: MainMenuOption[];
  companyContext?: string;  // Knowledge about the company for AI responses
  botPersona?: string;      // How the bot should act/speak
  projectDescription?: string;  // Description of what the bot does
}

/**
 * Generate startup nodes programmatically from templates.
 * No AI needed - uses canonical templates from node-templates.ts.
 * 
 * Returns CSV rows (without header) for:
 * - System nodes: -500, 666, 999, 1800-1804, 99990
 * - Startup flow: 1, 10, 100-104, 105
 * - Main menu: 200, 201, 210, 300 (customized based on options)
 */
export function generateStartupNodes(options?: StartupNodeOptions): string[] {
  const rows: string[] = [];
  
  // Build company context for AI from project details
  const companyName = options?.targetCompany || '';
  const companyContext = options?.companyContext || options?.projectDescription || '';
  const botPersona = options?.botPersona || 
    (companyName ? `a friendly and helpful ${companyName} customer service assistant` : 'a friendly and helpful customer service assistant');
  
  // Add all system nodes
  for (const template of SYSTEM_NODES) {
    rows.push(nodeTemplateToCSVRow(template));
  }
  
  // Add all startup nodes (1, 10, 100-104)
  for (const template of STARTUP_NODES) {
    // Customize node 105 (InitContext) with actual company info
    if (template.num === 105) {
      const customTemplate = { ...template };
      const contextVars: Record<string, string> = {
        LAST_TOPIC: '',
        LAST_ENTITY: '',
        CONVERSATION_CONTEXT: '',
        CONTEXT_FLOW: '',
        COMPANY_NAME: companyName,
        COMPANY_CONTEXT: companyContext,
        BOT_PERSONA: botPersona,
        CONVERSATION_HISTORY: ''
      };
      customTemplate.paramInput = JSON.stringify({ set: contextVars });
      rows.push(nodeTemplateToCSVRow(customTemplate));
    } else {
      rows.push(nodeTemplateToCSVRow(template));
    }
  }
  
  // Add GenAI fallback nodes (if defined)
  if (typeof GENAI_FALLBACK_NODES !== 'undefined') {
    for (const template of GENAI_FALLBACK_NODES) {
      // Skip if already added as part of SYSTEM_NODES
      if (!SYSTEM_NODES.some(s => s.num === template.num)) {
        rows.push(nodeTemplateToCSVRow(template));
      }
    }
  }
  
  // Generate customized main menu nodes (200, 201, 210, 300)
  const mainMenuNodes = generateMainMenuNodes(options);
  for (const template of mainMenuNodes) {
    rows.push(nodeTemplateToCSVRow(template));
  }
  
  console.log(`[Sequential] Generated ${rows.length} startup/system nodes programmatically`);
  return rows;
}

/**
 * Generate customized main menu nodes based on options
 */
function generateMainMenuNodes(options?: StartupNodeOptions): NodeTemplate[] {
  const targetCompany = options?.targetCompany || '';
  const mainMenuOptions = options?.mainMenuOptions || [];
  
  // Build welcome message - more engaging and specific
  let welcomeMessage = 'Hi! What can I help you with?';
  if (targetCompany) {
    // Create a more engaging, specific welcome
    welcomeMessage = `Hi! I'm your ${targetCompany} assistant. What can I help you with?`;
  }
  
  // Build quick reply options from mainMenuOptions
  let quickReplyOptions: { label: string; dest: number }[] = [];
  let intentRouting: { keyword: string; dest: number }[] = [];
  
  if (mainMenuOptions.length > 0) {
    // Use planned menu options
    quickReplyOptions = mainMenuOptions.map((opt, idx) => ({
      label: opt.label,
      dest: opt.startNode || (300 + idx * 100)
    }));
    
    // Generate intent routing keywords from labels
    intentRouting = mainMenuOptions.map((opt, idx) => {
      const keywords = opt.label.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(' ')
        .filter((w: string) => w.length > 2);
      return {
        keyword: keywords[0] || opt.flowName || `flow${idx}`,
        dest: opt.startNode || (300 + idx * 100)
      };
    });
  } else {
    // Default fallback options
    quickReplyOptions = [
      { label: 'Get Help', dest: 300 },
      { label: 'Talk to Agent', dest: 999 }
    ];
    intentRouting = [
      { keyword: 'help', dest: 300 },
      { keyword: 'support', dest: 300 },
      { keyword: 'question', dest: 300 }
    ];
  }
  
  // Always add "Talk to Agent" if not present
  if (!quickReplyOptions.some(o => o.dest === 999)) {
    quickReplyOptions.push({ label: 'Talk to Agent', dest: 999 });
    intentRouting.push({ keyword: 'agent', dest: 999 });
  }
  
  // Limit to 6 options max (UX best practice)
  if (quickReplyOptions.length > 6) {
    quickReplyOptions = quickReplyOptions.slice(0, 5);
    quickReplyOptions.push({ label: 'Talk to Agent', dest: 999 });
    intentRouting = intentRouting.slice(0, 6);
  }
  
  // Build JSON for quick reply
  const quickReplyContent = JSON.stringify({
    type: 'static',
    options: quickReplyOptions.map(o => ({ label: o.label, dest: o.dest }))
  });
  
  // Build intent routing What Next? and input_vars
  const inputVars = intentRouting.map(r => r.keyword).join(',');
  const whatNextParts = intentRouting.map(r => `${r.keyword}~${r.dest}`);
  whatNextParts.push('false~1800', 'error~1800'); // Fallback to GenAI
  const whatNext = whatNextParts.join('|');
  
  console.log(`[MainMenu] Generated ${quickReplyOptions.length} menu options for "${targetCompany || 'bot'}"`);
  
  // Core menu nodes - 200 (welcome), 210 (intent routing), 201 (return menu)
  // NOTE: We do NOT generate node 300 here - that's the first flow's start node!
  // The AI generates node 300+ as part of the actual conversation flows.
  // This prevents the generic "Help → Information" from overwriting the AI-generated flow content.
  const nodes: NodeTemplate[] = [
    {
      num: 200, type: 'D', name: 'MainMenu → Welcome',
      nextNodes: '210',
      message: welcomeMessage,
      richType: 'quick_reply',
      richContent: quickReplyContent,
      ansReq: '1',
      flows: 'main_menu_entry',
    },
    {
      num: 210, type: 'A', name: 'IntentRouting → Route Input',
      command: 'SysMultiMatchRouting', description: 'Routes user input', output: 'next_node',
      paramInput: `{"global_vars":"LAST_USER_MESSAGE","input_vars":"${inputVars}"}`,
      decVar: 'next_node', whatNext: whatNext,
    },
    returnMenu(201), // Uses the template function for return menu
  ];
  
  // Only add fallback node 300 if no mainMenuOptions were provided
  // (meaning no flows were planned and we need a catch-all)
  if (mainMenuOptions.length === 0) {
    console.log(`[MainMenu] No flows planned - adding fallback node 300`);
    nodes.push({
      num: 300, type: 'D', name: 'Help → Information',
      nextNodes: '201',
      message: targetCompany 
        ? `I can help you with questions about ${targetCompany}. What would you like to know?`
        : 'I can help you with questions and connect you to a live agent if needed.',
      richType: 'buttons',
      richContent: '{"type":"static","options":[{"label":"Main Menu","dest":200},{"label":"Talk to Agent","dest":999},{"label":"End Chat","dest":666}]}',
      ansReq: '1',
    });
  }
  
  return nodes;
}

/**
 * Generate the complete startup CSV with header.
 * Ready to be combined with flow-generated nodes.
 */
export function generateStartupCSV(): string {
  const rows = generateStartupNodes();
  return CSV_HEADER + '\n' + rows.join('\n');
}

/**
 * Convert JSON nodes array to CSV rows.
 * Handles the output from /api/generate-flow.
 */
export function nodesToCSVRows(nodes: any[]): string[] {
  const rows: string[] = [];
  
  // Helper: Check if a string looks like comma-separated node numbers
  const looksLikeNodeNumbers = (str: string): boolean => {
    if (!str || typeof str !== 'string') return false;
    // Pattern: "123,456,789" or "123" - all comma-separated numbers
    return /^\d+(\s*,\s*\d+)*$/.test(str.trim());
  };
  
  // Helper: Check if a string looks like a message (has words, not just numbers)
  const looksLikeMessage = (str: string): boolean => {
    if (!str || typeof str !== 'string') return false;
    // Contains letters and isn't just JSON/numbers
    return /[a-zA-Z]{3,}/.test(str) && !str.startsWith('{') && !str.startsWith('[');
  };
  
  for (const node of nodes) {
    // =========================================
    // FIX: Detect and correct field confusion
    // AI sometimes puts nextNodes in message field and vice versa
    // =========================================
    let message = node.message || '';
    let nextNodes = node.nextNodes || '';
    let nodeInput = node.nodeInput || '';
    const richType = (node.richType || '').toLowerCase();
    const hasButtonRouting = ['button', 'buttons', 'listpicker', 'quick_reply', 'carousel'].includes(richType);
    
    // Case 0: message contains rich asset type names (AI put type in wrong field!)
    // e.g., message = "quick_reply" when it should be in richType
    const RICH_ASSET_TYPES = ['quick_reply', 'button', 'buttons', 'listpicker', 'carousel', 'datepicker', 'timepicker', 'webview', 'file_upload', 'star_rating', 'imagebutton'];
    if (message && RICH_ASSET_TYPES.includes(message.toLowerCase().trim())) {
      console.log(`[nodesToCSVRows] FIX: Node ${node.num || node.nodeNum} - message contains rich asset type "${message}" (clearing - should be in richType field)`);
      message = '';
    }
    
    // Case 1: message contains node numbers (ALWAYS wrong - messages should never be just numbers!)
    // This is a CRITICAL fix - node numbers in message field will display to users
    if (looksLikeNodeNumbers(message)) {
      console.log(`[nodesToCSVRows] FIX: Node ${node.num || node.nodeNum} - message contains node numbers "${message}" (clearing)`);
      
      // For button/listpicker nodes, DON'T move to nextNodes - buttons handle routing via dest
      // For non-button nodes with empty nextNodes, only use if it's a SINGLE number
      if (!hasButtonRouting && !nextNodes) {
        const nodeNums = message.split(',').map((n: string) => n.trim()).filter((n: string) => n);
        if (nodeNums.length === 1) {
          nextNodes = nodeNums[0];
          console.log(`[nodesToCSVRows] FIX: Node ${node.num || node.nodeNum} - moved single node number to nextNodes`);
        }
        // Multiple comma-separated numbers are probably button dests - just discard
      }
      
      // ALWAYS clear message if it's just node numbers - never display numbers to users
      message = '';
    }
    
    // Case 2: Multiple node numbers in nextNodes with button routing - clear nextNodes
    // Buttons handle routing via dest, nextNodes should be empty or single NLU fallback
    if (hasButtonRouting && nextNodes && nextNodes.includes(',')) {
      console.log(`[nodesToCSVRows] FIX: Node ${node.num || node.nodeNum} - clearing multiple nextNodes (buttons handle routing via dest)`);
      nextNodes = '';
    }
    
    // Case 3: nodeInput contains message text but message is empty
    if (looksLikeMessage(nodeInput) && !message) {
      console.log(`[nodesToCSVRows] FIX: Node ${node.num || node.nodeNum} - moving nodeInput→message (was in wrong field)`);
      message = nodeInput;
      nodeInput = '';
    }
    
    // Case 4: description contains message text but message is empty  
    if (looksLikeMessage(node.description) && !message && node.type !== 'A') {
      console.log(`[nodesToCSVRows] FIX: Node ${node.num || node.nodeNum} - moving description→message`);
      message = node.description;
    }
    
    // Case 5: Decision node with no message but has name - use name as fallback message
    // (Better than showing nothing or showing node numbers)
    if (!message && node.type === 'D' && node.name) {
      // Don't use name if it contains technical terms like "→" or node numbers
      const cleanName = node.name.replace(/→.*$/, '').replace(/[0-9]+/g, '').trim();
      if (cleanName.length > 5 && looksLikeMessage(cleanName)) {
        console.log(`[nodesToCSVRows] FIX: Node ${node.num || node.nodeNum} - using name as fallback message: "${cleanName}"`);
        message = cleanName;
      }
    }
    
    // Handle richContent - AI might return it as an object instead of a string
    let richContent = node.richContent || node.richAssetContent || '';
    if (richContent && typeof richContent === 'object') {
      // Convert object to JSON string
      richContent = JSON.stringify(richContent);
    }
    
    // DEBUG: Log richContent conversion
    const nodeNumForLog = node.num || node.nodeNum;
    if (richType || richContent) {
      console.log(`[nodesToCSVRows] Node ${nodeNumForLog}: richType="${richType}", richContent=${String(richContent).substring(0, 80)}...`);
    } else if (node.type === 'D') {
      console.log(`[nodesToCSVRows] WARNING: Decision node ${nodeNumForLog} has NO richType or richContent!`);
    }
    
    // Handle paramInput - AI might return it as an object
    let paramInput = node.paramInput || node.parameterInput || '';
    if (paramInput && typeof paramInput === 'object') {
      paramInput = JSON.stringify(paramInput);
    }
    
    // Map JSON node properties to CSV columns (26 columns)
    // Use the corrected message/nextNodes/nodeInput values
    const fields = [
      node.num || node.nodeNum || '',           // 0: Node Number
      node.type || 'D',                          // 1: Node Type
      node.name || '',                           // 2: Node Name
      node.intent || '',                         // 3: Intent
      node.entityType || '',                     // 4: Entity Type
      node.entity || '',                         // 5: Entity
      node.nluDisabled || '',                    // 6: NLU Disabled?
      nextNodes,                                 // 7: Next Nodes (corrected)
      message,                                   // 8: Message (corrected)
      node.richType || node.richAssetType || '',       // 9: Rich Asset Type
      richContent,                                     // 10: Rich Asset Content
      node.ansReq || node.answerRequired || '',  // 11: Answer Required?
      node.behaviors || '',                      // 12: Behaviors
      node.command || '',                        // 13: Command
      node.description || '',                    // 14: Description
      node.output || '',                         // 15: Output
      nodeInput,                                       // 16: Node Input (corrected)
      paramInput,                                      // 17: Parameter Input
      node.decVar || node.decisionVariable || '', // 18: Decision Variable
      node.whatNext || '',                       // 19: What Next?
      node.nodeTags || '',                       // 20: Node Tags
      node.skillTag || '',                       // 21: Skill Tag
      node.variable || '',                       // 22: Variable
      node.platformFlag || '',                   // 23: Platform Flag
      node.flows || '',                          // 24: Flows
      node.cssClass || node.cssClassname || '',  // 25: CSS Classname
    ];
    
    // Validate we have exactly 26 columns
    if (fields.length !== 26) {
      console.error(`[nodesToCSVRows] Node ${node.num} has ${fields.length} fields instead of 26!`);
    }
    
    // Escape fields for CSV - MUST handle all special characters
    const escapedFields = fields.map((f, idx) => {
      const str = String(f ?? '');
      // Always quote fields that contain: comma, quote, newline, or are richContent/paramInput
      if (str.includes(',') || str.includes('"') || str.includes('\n') || idx === 10 || idx === 17) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
    
    const row = escapedFields.join(',');
    
    // Validate the row has correct column count by counting unquoted commas
    const rowColumns = parseCSVLineForFix(row).length;
    if (rowColumns !== 26) {
      console.error(`[nodesToCSVRows] Node ${node.num} row has ${rowColumns} columns after escaping (expected 26)`);
      console.error(`[nodesToCSVRows] Problematic row: ${row.substring(0, 200)}...`);
    }
    
    rows.push(row);
  }
  
  console.log(`[nodesToCSVRows] Converted ${nodes.length} nodes to ${rows.length} CSV rows`);
  return rows;
}

// ============================================
// NODE NUMBER RESERVATION AND PROTECTION SYSTEM
// ============================================

/**
 * Reserved node number ranges for Pypestream bots.
 * AI-generated flows must NOT use these ranges.
 * 
 * This ensures critical infrastructure nodes are never overwritten.
 */
export const RESERVED_NODE_RANGES = {
  // Startup/infrastructure (nodes 1-199)
  STARTUP: { start: 1, end: 105, description: 'Startup flow (metadata, platform routing, env)' },
  MAIN_MENU: { start: 200, end: 299, description: 'Main menu and navigation (200, 201, 210)' },
  
  // System nodes (special negative and high numbers)
  ERROR_HANDLER: { start: -500, end: -500, description: 'Global error handler' },
  END_CHAT: { start: 666, end: 666, description: 'End chat node' },
  LIVE_AGENT: { start: 999, end: 999, description: 'Live agent transfer' },
  OUT_OF_SCOPE: { start: 1800, end: 1804, description: 'GenAI fallback chain (NLU fallback)' },
  ERROR_MESSAGE: { start: 99990, end: 99990, description: 'Error recovery message' },
  
  // Reserved for future system use
  SYSTEM_RESERVED: { start: 9000, end: 9999, description: 'Reserved for system nodes' },
} as const;

/**
 * Safe flow node ranges - AI can generate flows in these ranges.
 * Each flow gets a 100-node block (e.g., 300-399, 400-499, etc.)
 */
export const FLOW_NODE_RANGES = {
  FIRST_FLOW: { start: 300, end: 399 },
  SECOND_FLOW: { start: 400, end: 499 },
  THIRD_FLOW: { start: 500, end: 599 },
  FOURTH_FLOW: { start: 600, end: 699 },
  FIFTH_FLOW: { start: 700, end: 799 },
  // Additional flows continue: 800-899, 900-999 (stops before 9000)
  MAX_FLOW_END: 8999, // Flows cannot exceed this
} as const;

/**
 * Get the set of all reserved node numbers (individual nodes, not ranges)
 */
function getReservedNodeNumbers(): Set<number> {
  const reserved = new Set<number>();
  
  // Add specific system nodes
  reserved.add(-500);  // HandleBotError
  reserved.add(1);     // SysShowMetadata
  reserved.add(10);    // UserPlatformRouting
  reserved.add(100);   // SetVar iOS
  reserved.add(101);   // SetVar Android
  reserved.add(102);   // SetVar Desktop
  reserved.add(103);   // Platform Fallback
  reserved.add(104);   // SysSetEnv
  reserved.add(105);   // InitContext
  reserved.add(200);   // MainMenu Welcome
  reserved.add(201);   // ReturnMenu
  reserved.add(210);   // IntentRouting
  reserved.add(666);   // EndChat
  reserved.add(999);   // LiveAgent
  reserved.add(1800);  // OutOfScope GenAI
  reserved.add(1802);  // GenAIResponse
  reserved.add(1803);  // RouteDetectedIntent
  reserved.add(1804);  // FallbackFail
  reserved.add(99990); // ErrorMessage
  
  return reserved;
}

/**
 * Check if a node number is in a reserved range
 */
function isNodeNumberReserved(nodeNum: number): boolean {
  // Check specific reserved nodes
  if (getReservedNodeNumbers().has(nodeNum)) {
    return true;
  }
  
  // Check reserved ranges
  const ranges = RESERVED_NODE_RANGES;
  
  // Startup range (1-105)
  if (nodeNum >= ranges.STARTUP.start && nodeNum <= ranges.STARTUP.end) return true;
  
  // Main menu range (200-299) - only 200, 201, 210 are actually reserved
  // But we check specifically to allow 220, 230, etc. for sub-menus if needed
  if (nodeNum === 200 || nodeNum === 201 || nodeNum === 210) return true;
  
  // Out of scope chain
  if (nodeNum >= ranges.OUT_OF_SCOPE.start && nodeNum <= ranges.OUT_OF_SCOPE.end) return true;
  
  // System reserved (9000-9999)
  if (nodeNum >= ranges.SYSTEM_RESERVED.start && nodeNum <= ranges.SYSTEM_RESERVED.end) return true;
  
  return false;
}

/**
 * Get the expected flow range for a flow index (0-based)
 */
function getFlowRange(flowIndex: number): { start: number; end: number } {
  const baseStart = 300;
  const rangeSize = 100;
  const start = baseStart + (flowIndex * rangeSize);
  const end = start + rangeSize - 1;
  
  // Cap at max flow end to avoid system reserved range
  return {
    start,
    end: Math.min(end, FLOW_NODE_RANGES.MAX_FLOW_END)
  };
}

/**
 * Validate and remap AI-generated nodes to prevent conflicts with reserved nodes.
 * 
 * This function:
 * 1. Identifies any nodes using reserved node numbers
 * 2. Remaps conflicting nodes to safe ranges
 * 3. Updates all references (Next Nodes, What Next, button destinations) to use new numbers
 * 4. Returns the corrected nodes with a log of changes
 */
export function validateAndRemapNodeNumbers(
  nodes: any[],
  flowIndex: number,
  reservedNodes: Set<number>
): { nodes: any[]; remappings: Map<number, number>; warnings: string[] } {
  const warnings: string[] = [];
  const remappings = new Map<number, number>();
  
  // Get the expected range for this flow
  const flowRange = getFlowRange(flowIndex);
  let nextAvailableNode = flowRange.start;
  
  // Track which node numbers are already used in this flow
  const usedInFlow = new Set<number>();
  
  // First pass: identify conflicts and plan remappings
  for (const node of nodes) {
    const nodeNum = node.num || node.nodeNum;
    if (nodeNum === undefined) continue;
    
    const numVal = parseInt(String(nodeNum), 10);
    if (isNaN(numVal)) continue;
    
    // Check if this node conflicts with reserved nodes
    if (reservedNodes.has(numVal) || isNodeNumberReserved(numVal)) {
      // Find next available node in flow range
      while (usedInFlow.has(nextAvailableNode) || reservedNodes.has(nextAvailableNode)) {
        nextAvailableNode++;
        if (nextAvailableNode > flowRange.end) {
          // Overflow to next available range
          const overflowRange = getFlowRange(flowIndex + 1);
          nextAvailableNode = overflowRange.start;
          warnings.push(`Flow ${flowIndex} overflowed into next range (${overflowRange.start}+)`);
        }
      }
      
      remappings.set(numVal, nextAvailableNode);
      warnings.push(`Node ${numVal} conflicts with reserved range, remapped to ${nextAvailableNode}`);
      usedInFlow.add(nextAvailableNode);
      nextAvailableNode++;
    } else {
      usedInFlow.add(numVal);
      
      // Check if node is outside its expected flow range (but not a conflict)
      if (numVal < flowRange.start || numVal > flowRange.end) {
        // Allow nodes that route TO system nodes (like 999, 666, 99990)
        // but warn if it's creating its own out-of-range node
        if (!isNodeNumberReserved(numVal)) {
          warnings.push(`Node ${numVal} is outside expected flow range (${flowRange.start}-${flowRange.end})`);
        }
      }
    }
  }
  
  // If no remappings needed, return early
  if (remappings.size === 0) {
    return { nodes, remappings, warnings };
  }
  
  console.log(`[NodeRemap] Remapping ${remappings.size} conflicting nodes in flow ${flowIndex}`);
  
  // Second pass: apply remappings to nodes and all references
  const remappedNodes = nodes.map(node => {
    const newNode = { ...node };
    
    // Remap the node's own number
    const nodeNum = parseInt(String(node.num || node.nodeNum), 10);
    if (!isNaN(nodeNum) && remappings.has(nodeNum)) {
      newNode.num = remappings.get(nodeNum);
      newNode.nodeNum = remappings.get(nodeNum);
    }
    
    // Remap nextNodes references
    if (newNode.nextNodes) {
      newNode.nextNodes = remapNodeReferences(String(newNode.nextNodes), remappings);
    }
    
    // Remap whatNext references
    if (newNode.whatNext) {
      newNode.whatNext = remapWhatNextReferences(String(newNode.whatNext), remappings);
    }
    
    // Remap rich asset content (button/listpicker destinations)
    if (newNode.richContent) {
      newNode.richContent = remapRichAssetReferences(newNode.richContent, remappings);
    }
    
    return newNode;
  });
  
  return { nodes: remappedNodes, remappings, warnings };
}

/**
 * Remap node numbers in a comma-separated Next Nodes string
 */
function remapNodeReferences(nextNodes: string, remappings: Map<number, number>): string {
  if (!nextNodes || remappings.size === 0) return nextNodes;
  
  return nextNodes.split(/[,|]/).map(n => {
    const num = parseInt(n.trim(), 10);
    if (!isNaN(num) && remappings.has(num)) {
      return String(remappings.get(num));
    }
    return n.trim();
  }).join(',');
}

/**
 * Remap node numbers in What Next? routing string (format: value~node|value~node)
 */
function remapWhatNextReferences(whatNext: string, remappings: Map<number, number>): string {
  if (!whatNext || remappings.size === 0) return whatNext;
  
  return whatNext.split('|').map(part => {
    const [value, nodeStr] = part.split('~');
    if (!nodeStr) return part;
    
    const num = parseInt(nodeStr.trim(), 10);
    if (!isNaN(num) && remappings.has(num)) {
      return `${value}~${remappings.get(num)}`;
    }
    return part;
  }).join('|');
}

/**
 * Remap node numbers in rich asset content (button/listpicker destinations)
 */
function remapRichAssetReferences(richContent: any, remappings: Map<number, number>): any {
  if (!richContent || remappings.size === 0) return richContent;
  
  // Handle string content (could be JSON or pipe format)
  if (typeof richContent === 'string') {
    // Try to parse as JSON
    if (richContent.startsWith('{') || richContent.startsWith('[')) {
      try {
        const parsed = JSON.parse(richContent);
        const remapped = remapRichAssetReferences(parsed, remappings);
        return JSON.stringify(remapped);
      } catch {
        // Not valid JSON, try pipe format
      }
    }
    
    // Pipe format: Label~dest|Label~dest
    if (richContent.includes('~')) {
      return richContent.split('|').map((part: string) => {
        const match = part.match(/^(.+)~(\d+)$/);
        if (match) {
          const [, label, destStr] = match;
          const dest = parseInt(destStr, 10);
          if (remappings.has(dest)) {
            return `${label}~${remappings.get(dest)}`;
          }
        }
        return part;
      }).join('|');
    }
    
    return richContent;
  }
  
  // Handle object content (JSON format)
  if (typeof richContent === 'object' && richContent !== null) {
    const newContent = { ...richContent };
    
    if (Array.isArray(newContent.options)) {
      newContent.options = newContent.options.map((opt: any) => {
        if (opt.dest !== undefined) {
          const dest = typeof opt.dest === 'string' ? parseInt(opt.dest, 10) : opt.dest;
          if (!isNaN(dest) && remappings.has(dest)) {
            return { ...opt, dest: remappings.get(dest) };
          }
        }
        return opt;
      });
    }
    
    return newContent;
  }
  
  return richContent;
}

/**
 * Comprehensive node number alignment and protection.
 * Run this BEFORE assembling flows to ensure no conflicts.
 */
export function alignFlowNodeNumbers(
  flowRowsArrays: string[][],
  reservedNodes: Set<number>
): { aligned: string[][]; report: NodeAlignmentReport } {
  const report: NodeAlignmentReport = {
    totalFlows: flowRowsArrays.length,
    remappedNodes: 0,
    warnings: [],
    flowRanges: []
  };
  
  const aligned: string[][] = [];
  
  for (let flowIdx = 0; flowIdx < flowRowsArrays.length; flowIdx++) {
    const flowRows = flowRowsArrays[flowIdx];
    const flowRange = getFlowRange(flowIdx);
    
    report.flowRanges.push({
      flowIndex: flowIdx,
      expectedRange: `${flowRange.start}-${flowRange.end}`,
      actualNodes: []
    });
    
    // Parse rows into node objects with field confusion detection
    const nodes: any[] = [];
    for (const row of flowRows) {
      const fields = parseCSVLineForFix(row);
      const nodeNum = parseInt(fields[0], 10);
      if (isNaN(nodeNum)) continue;
      
      report.flowRanges[flowIdx].actualNodes.push(nodeNum);
      
      // =========================================
      // FIX: Detect node numbers in message field (should NEVER happen)
      // This catches issues at the CSV level after initial conversion
      // =========================================
      let message = fields[8] || '';
      let nextNodes = fields[7] || '';
      const richType = (fields[9] || '').toLowerCase();
      const hasButtonRouting = ['button', 'buttons', 'listpicker', 'quick_reply', 'carousel'].includes(richType);
      
      // Pattern: looks like comma-separated node numbers (e.g., "510,520,530")
      if (/^\d+(\s*,\s*\d+)*$/.test(message.trim()) && message.trim()) {
        console.log(`[alignFlowNodeNumbers] FIX: Node ${nodeNum} has node numbers in message field: "${message}"`);
        
        // For button nodes, DO NOT move to nextNodes - buttons handle routing
        // Only move to nextNodes if single number and no button routing
        if (!hasButtonRouting && !nextNodes) {
          const nodeNums = message.split(',').map(n => n.trim()).filter(n => n);
          if (nodeNums.length === 1) {
            nextNodes = nodeNums[0];
          }
        }
        
        message = ''; // Clear - will need to be regenerated or use fallback
        report.warnings.push(`Node ${nodeNum}: Cleared node numbers from message field (was: ${fields[8]})`);
      }
      
      // FIX: Multiple node numbers in nextNodes with button routing - clear it
      if (hasButtonRouting && nextNodes && nextNodes.includes(',')) {
        console.log(`[alignFlowNodeNumbers] FIX: Node ${nodeNum} clearing multiple nextNodes (buttons handle routing)`);
        nextNodes = '';
        report.warnings.push(`Node ${nodeNum}: Cleared multiple nextNodes (buttons handle routing via dest)`);
      }
      
      nodes.push({
        num: nodeNum,
        type: fields[1],
        name: fields[2],
        intent: fields[3],
        entityType: fields[4],
        entity: fields[5],
        nluDisabled: fields[6],
        nextNodes: nextNodes,  // Use potentially fixed value
        message: message,      // Use potentially fixed value
        richType: fields[9],
        richContent: fields[10],
        ansReq: fields[11],
        behaviors: fields[12],
        command: fields[13],
        description: fields[14],
        output: fields[15],
        nodeInput: fields[16],
        paramInput: fields[17],
        decVar: fields[18],
        whatNext: fields[19],
        nodeTags: fields[20],
        skillTag: fields[21],
        variable: fields[22],
        platformFlag: fields[23],
        flows: fields[24],
        cssClass: fields[25],
        _originalRow: row
      });
    }
    
    // Validate and remap if needed
    const { nodes: remappedNodes, remappings, warnings } = validateAndRemapNodeNumbers(
      nodes, 
      flowIdx, 
      reservedNodes
    );
    
    report.remappedNodes += remappings.size;
    report.warnings.push(...warnings);
    
    // Convert back to CSV rows
    const alignedRows = remappedNodes.map(node => nodesToCSVRows([node])[0]);
    aligned.push(alignedRows);
  }
  
  // Log alignment report
  if (report.remappedNodes > 0 || report.warnings.length > 0) {
    console.log(`[NodeAlignment] Report:`);
    console.log(`  - Total flows: ${report.totalFlows}`);
    console.log(`  - Nodes remapped: ${report.remappedNodes}`);
    if (report.warnings.length > 0) {
      console.log(`  - Warnings: ${report.warnings.length}`);
      report.warnings.slice(0, 5).forEach(w => console.log(`    • ${w}`));
      if (report.warnings.length > 5) {
        console.log(`    ... and ${report.warnings.length - 5} more`);
      }
    }
  } else {
    console.log(`[NodeAlignment] All ${report.totalFlows} flows aligned correctly, no conflicts detected`);
  }
  
  return { aligned, report };
}

interface NodeAlignmentReport {
  totalFlows: number;
  remappedNodes: number;
  warnings: string[];
  flowRanges: {
    flowIndex: number;
    expectedRange: string;
    actualNodes: number[];
  }[];
}

/**
 * Log a comprehensive inventory of all nodes in the CSV.
 * Groups nodes by their functional category (startup, menu, flows, system).
 * Useful for debugging node number conflicts.
 */
function logNodeInventory(csv: string, stage: string = ''): void {
  const lines = csv.split('\n');
  if (lines.length < 2) return;
  
  const inventory = {
    startup: [] as number[],       // 1-105
    mainMenu: [] as number[],      // 200-299
    flows: [] as { range: string; nodes: number[] }[],  // 300+
    system: [] as number[],        // 666, 999, 1800-1804, 99990, -500
    other: [] as number[]          // Anything else
  };
  
  // Initialize flow ranges
  for (let i = 0; i < 8; i++) {
    const start = 300 + (i * 100);
    inventory.flows.push({ range: `${start}-${start + 99}`, nodes: [] });
  }
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = parseCSVLineForFix(line);
    const nodeNum = parseInt(fields[0], 10);
    if (isNaN(nodeNum)) continue;
    
    // Categorize node
    if (nodeNum >= 1 && nodeNum <= 105) {
      inventory.startup.push(nodeNum);
    } else if (nodeNum >= 200 && nodeNum <= 299) {
      inventory.mainMenu.push(nodeNum);
    } else if (nodeNum >= 300 && nodeNum <= 999) {
      const flowIdx = Math.floor((nodeNum - 300) / 100);
      if (flowIdx >= 0 && flowIdx < inventory.flows.length) {
        inventory.flows[flowIdx].nodes.push(nodeNum);
      } else {
        inventory.other.push(nodeNum);
      }
    } else if (nodeNum === -500 || nodeNum === 666 || nodeNum === 999 || 
               (nodeNum >= 1800 && nodeNum <= 1804) || nodeNum === 99990) {
      inventory.system.push(nodeNum);
    } else {
      inventory.other.push(nodeNum);
    }
  }
  
  // Log summary
  const stagePrefix = stage ? `[${stage}] ` : '';
  console.log(`\n${stagePrefix}📊 Node Inventory:`);
  console.log(`  Startup (1-105): ${inventory.startup.length} nodes [${inventory.startup.slice(0, 8).join(', ')}${inventory.startup.length > 8 ? '...' : ''}]`);
  console.log(`  Main Menu (200-299): ${inventory.mainMenu.length} nodes [${inventory.mainMenu.join(', ')}]`);
  
  const activeFlows = inventory.flows.filter(f => f.nodes.length > 0);
  for (const flow of activeFlows) {
    console.log(`  Flow ${flow.range}: ${flow.nodes.length} nodes [${flow.nodes.slice(0, 5).join(', ')}${flow.nodes.length > 5 ? '...' : ''}]`);
  }
  
  console.log(`  System (-500, 666, 999, 1800+, 99990): ${inventory.system.length} nodes [${inventory.system.join(', ')}]`);
  
  if (inventory.other.length > 0) {
    console.log(`  ⚠️ Other/Unexpected: ${inventory.other.length} nodes [${inventory.other.join(', ')}]`);
  }
  
  const totalNodes = inventory.startup.length + inventory.mainMenu.length + 
                     inventory.flows.reduce((sum, f) => sum + f.nodes.length, 0) + 
                     inventory.system.length + inventory.other.length;
  console.log(`  TOTAL: ${totalNodes} nodes\n`);
}

/**
 * Assemble multiple flow CSVs and run validation pipeline.
 * Combines startup nodes with generated flows, then runs all fixes.
 */
export function assembleAndValidateCSV(
  startupRows: string[],
  flowRowsArrays: string[][]
): string {
  // Extract node numbers from startup rows (these are protected and take precedence)
  const startupNodeNums = new Set<number>();
  for (const row of startupRows) {
    const nodeNum = parseInt(row.split(',')[0], 10);
    if (!isNaN(nodeNum)) {
      startupNodeNums.add(nodeNum);
    }
  }
  
  // Add all reserved system nodes to the protected set
  const reservedNodes = new Set([...startupNodeNums, ...getReservedNodeNumbers()]);
  
  // STEP 1: Align flow node numbers BEFORE assembly
  // This remaps any conflicting node numbers to safe ranges
  const { aligned: alignedFlowRows, report } = alignFlowNodeNumbers(flowRowsArrays, reservedNodes);
  
  if (report.remappedNodes > 0) {
    console.log(`[Sequential] Node alignment remapped ${report.remappedNodes} conflicting nodes`);
  }
  
  // Combine all rows with header, filtering out any AI-generated duplicates of startup nodes
  const allRows = [CSV_HEADER, ...startupRows];
  let duplicatesFiltered = 0;
  
  for (const flowRows of alignedFlowRows) {
    for (const row of flowRows) {
      const nodeNum = parseInt(row.split(',')[0], 10);
      // Skip rows that duplicate startup node numbers - startup nodes take precedence
      if (!isNaN(nodeNum) && startupNodeNums.has(nodeNum)) {
        console.log(`[Sequential] Filtered duplicate node ${nodeNum} from AI-generated flow (startup template takes precedence)`);
        duplicatesFiltered++;
        continue;
      }
      allRows.push(row);
    }
  }
  
  if (duplicatesFiltered > 0) {
    console.log(`[Sequential] Filtered ${duplicatesFiltered} duplicate nodes that conflicted with startup templates`);
  }
  
  let csv = allRows.join('\n');
  console.log(`[Sequential] Assembled ${allRows.length - 1} total rows`);
  
  // Generate and log node inventory for debugging
  logNodeInventory(csv, 'After Assembly');
  
  // Helper to trace node 1800's state for debugging
  const traceNode1800 = (stage: string, csvContent: string) => {
    const lines = csvContent.split('\n');
    for (const line of lines) {
      if (line.startsWith('1800,') || line.startsWith('"1800",')) {
        const fields = parseCSVLineForFix(line);
        const cmd = fields[13] || '(empty)';
        const decVar = fields[18] || '(empty)';
        console.log(`[Node1800 Trace] ${stage}: command="${cmd}", decVar="${decVar}"`);
        return;
      }
    }
    console.log(`[Node1800 Trace] ${stage}: NODE NOT FOUND`);
  };
  
  traceNode1800('After assembly', csv);
  
  // Run the existing validation pipeline
  csv = normalizeCSVColumns(csv);
  console.log('[Sequential] Normalized columns');
  traceNode1800('After normalizeCSVColumns', csv);
  
  csv = fixCSVColumnAlignment(csv);
  console.log('[Sequential] Fixed column alignment');
  traceNode1800('After fixCSVColumnAlignment', csv);
  
  csv = fixDecisionVariables(csv);
  console.log('[Sequential] Fixed decision variables');
  traceNode1800('After fixDecisionVariables', csv);
  
  // Run structural pre-validation
  const { csv: preValidatedCsv, fixes } = structuralPreValidation(csv);
  if (fixes.length > 0) {
    console.log(`[Sequential] Pre-validation applied ${fixes.length} fixes`);
  }
  csv = preValidatedCsv;
  traceNode1800('After structuralPreValidation', csv);
  
  // Run sanitization for deploy
  const sanitizedCsv = sanitizeCSVForDeploy(csv);
  if (sanitizedCsv !== csv) {
    console.log('[Sequential] Sanitization applied fixes');
  }
  csv = sanitizedCsv;
  traceNode1800('After sanitizeCSVForDeploy', csv);
  
  // CRITICAL: Inject/fix required startup nodes LAST
  // This ensures nodes like 1800 (GenAIFallback) have correct configuration
  // regardless of what the AI generated or what other fixes did
  const startupFixedCsv = injectRequiredStartupNodes(csv);
  if (startupFixedCsv !== csv) {
    console.log('[Sequential] Startup nodes injected/fixed');
  }
  csv = startupFixedCsv;
  
  return csv;
}

/**
 * Sequential generation - orchestrates the full pipeline.
 * 
 * 1. Generate startup nodes programmatically (instant)
 * 2. Call /api/plan-flows to identify needed flows (5-10s)
 * 3. For each flow, call /api/generate-flow (10-20s each)
 * 4. Assemble and validate (instant)
 */
export async function generateSequentially(
  projectConfig: ProjectConfig,
  clarifyingQuestions: ClarifyingQuestion[] = [],
  onProgress?: (progress: SequentialProgress) => void
): Promise<GenerationResult> {
  const startTime = performance.now();
  
  try {
    // Step 1: Use pre-planned flows from Architecture page if available, otherwise plan now
    onProgress?.({ step: 'planning', status: 'started' });
    
    let flows: FlowPlan[];
    let mainMenuOptions: MainMenuOption[] | undefined;
    
    // Check for pre-planned flows from SolutionArchitecturePage
    const prePlannedFlows = (window as any).__plannedFlows as FlowPlan[] | undefined;
    const prePlannedMenu = (window as any).__plannedMenuOptions as MainMenuOption[] | undefined;
    
    // Check for flow previews - conversation structures the user has seen/approved
    const flowPreviews = (window as any).__flowPreviews as Record<string, any[]> | undefined;
    
    if (prePlannedFlows && prePlannedFlows.length > 0) {
      // Use the flows from the architecture review
      flows = prePlannedFlows;
      mainMenuOptions = prePlannedMenu;
      console.log(`[Sequential] Using ${flows.length} pre-planned flows from Architecture review`);
      if (flowPreviews) {
        console.log(`[Sequential] Have ${Object.keys(flowPreviews).length} flow previews to maintain consistency`);
      }
      
      // Clear the pre-planned data so it's not reused on next build
      delete (window as any).__plannedFlows;
      delete (window as any).__plannedMenuOptions;
      delete (window as any).__flowPreviews;
    } else {
      // No pre-planned flows, call the planning API
      // Only pass serializable fields - avoid passing full projectConfig which may contain DOM refs or blobs
      const planResponse = await fetch('/api/plan-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          projectConfig: {
            projectName: projectConfig.projectName,
            projectType: projectConfig.projectType,
            description: projectConfig.description,
            targetCompany: projectConfig.targetCompany
          }, 
          clarifyingQuestions 
        })
      });
      
      if (!planResponse.ok) {
        throw new Error(`Flow planning failed: ${await planResponse.text()}`);
      }
      
      const planResult = await planResponse.json() as { 
        flows: FlowPlan[]; 
        mainMenuOptions?: MainMenuOption[];
      };
      flows = planResult.flows;
      mainMenuOptions = planResult.mainMenuOptions;
    }
    
    onProgress?.({ step: 'planning', status: 'done', totalFlows: flows.length });
    console.log(`[Sequential] Step 1: Planned ${flows.length} flows with ${mainMenuOptions?.length || 0} menu options`);
    
    // Step 2: Generate startup nodes with customized main menu and company context
    onProgress?.({ step: 'startup', status: 'started' });
    const startupRows = generateStartupNodes({
      targetCompany: projectConfig?.targetCompany || projectConfig?.projectName,
      mainMenuOptions: mainMenuOptions,
      projectDescription: projectConfig?.description,
      companyContext: projectConfig?.companyContext,
      botPersona: projectConfig?.botPersona
    });
    onProgress?.({ step: 'startup', status: 'done', rows: startupRows.length });
    console.log(`[Sequential] Step 2: Generated ${startupRows.length} startup nodes`);
    
    // Step 3: Generate flows in PARALLEL for speed (with concurrency limit)
    const flowRowsArrays: string[][] = [];
    const generatedNodeNums: number[] = [1, 10, 100, 101, 102, 103, 104, 105, 666, 999, 99990];
    const failedFlows: { name: string; error: string }[] = [];
    
    // Generate flows in parallel with max 3 concurrent
    const PARALLEL_LIMIT = 3;
    const flowResults: { index: number; rows: string[]; success: boolean; error?: string }[] = [];
    
    // Helper to generate a single flow with retry
    const generateSingleFlow = async (flow: FlowPlan, index: number): Promise<{ index: number; rows: string[]; success: boolean; error?: string }> => {
      const isWelcome = flow.name === 'welcome' || flow.name === 'greeting';
      const MAX_FLOW_RETRIES = 3;
      
      // Check if we have a preview for this flow that the user has seen/approved
      const preview = flowPreviews?.[flow.name];
      if (preview) {
        console.log(`[Parallel] Flow "${flow.name}" has preview with ${preview.length} nodes - will ensure consistency`);
      }
      
      onProgress?.({ 
        step: 'flow', 
        status: 'started', 
        flowName: flow.name,
        currentFlow: index + 1,
        totalFlows: flows.length
      });
      
      for (let attempt = 1; attempt <= MAX_FLOW_RETRIES; attempt++) {
        if (attempt > 1) {
          console.log(`[Parallel] Retrying flow "${flow.name}" (attempt ${attempt}/${MAX_FLOW_RETRIES})...`);
          await new Promise(r => setTimeout(r, 500 * attempt)); // Shorter delay
        }
        
        try {
          const flowResponse = await fetch('/api/generate-flow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              flow,
              projectConfig,
              contextNodes: generatedNodeNums,
              isWelcome,
              // Pass the preview so the AI generates CSV that matches what the user saw
              conversationPreview: preview
            })
          });
          
          if (!flowResponse.ok) {
            const errorText = await flowResponse.text();
            console.error(`[Parallel] Flow "${flow.name}" attempt ${attempt} failed:`, errorText);
            continue;
          }
          
          const { nodes } = await flowResponse.json() as { nodes: any[] };
          
          if (!nodes || nodes.length === 0) {
            console.error(`[Parallel] Flow "${flow.name}" attempt ${attempt}: Empty response`);
            continue;
          }
          
          const flowRows = nodesToCSVRows(nodes);
          
          onProgress?.({ 
            step: 'flow', 
            status: 'done', 
            flowName: flow.name,
            rows: flowRows.length,
            currentFlow: index + 1,
            totalFlows: flows.length
          });
          console.log(`[Parallel] Generated ${flowRows.length} nodes for "${flow.name}"`);
          
          return { index, rows: flowRows, success: true };
          
        } catch (fetchError: any) {
          console.error(`[Parallel] Flow "${flow.name}" attempt ${attempt} exception:`, fetchError.message);
        }
      }
      
      // All retries failed
      onProgress?.({ step: 'flow', status: 'error', flowName: flow.name, message: `Failed after ${MAX_FLOW_RETRIES} attempts` });
      return { index, rows: [], success: false, error: `Failed after ${MAX_FLOW_RETRIES} attempts` };
    };
    
    // Process flows in parallel batches
    console.log(`[Sequential] Generating ${flows.length} flows in parallel (max ${PARALLEL_LIMIT} concurrent)...`);
    const startParallel = performance.now();
    
    for (let batchStart = 0; batchStart < flows.length; batchStart += PARALLEL_LIMIT) {
      const batch = flows.slice(batchStart, batchStart + PARALLEL_LIMIT);
      const batchPromises = batch.map((flow, batchIndex) => 
        generateSingleFlow(flow, batchStart + batchIndex)
      );
      const batchResults = await Promise.all(batchPromises);
      flowResults.push(...batchResults);
    }
    
    const parallelTime = Math.round(performance.now() - startParallel);
    console.log(`[Sequential] Parallel generation complete in ${parallelTime}ms`);
    
    // Sort results by index and collect
    flowResults.sort((a, b) => a.index - b.index);
    for (const result of flowResults) {
      if (result.success) {
        flowRowsArrays.push(result.rows);
      } else {
        failedFlows.push({ name: flows[result.index].name, error: result.error || 'Unknown error' });
      }
    }
    
    // CRITICAL: Check if any flows failed - DO NOT deploy incomplete bots
    if (failedFlows.length > 0) {
      const failedNames = failedFlows.map(f => f.name).join(', ');
      const errorMsg = `BLOCKING DEPLOYMENT: ${failedFlows.length} flow(s) failed to generate: ${failedNames}. ` +
        `Failed flows: ${JSON.stringify(failedFlows)}`;
      console.error(`[Sequential] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Step 4: Assemble and validate
    onProgress?.({ step: 'assembly', status: 'started' });
    const csv = assembleAndValidateCSV(startupRows, flowRowsArrays);
    onProgress?.({ step: 'assembly', status: 'done' });
    
    // Step 5: Validation
    onProgress?.({ step: 'validation', status: 'started' });
    const stats = parseCSVStats(csv);
    onProgress?.({ step: 'validation', status: 'done' });
    
    const totalTime = Math.round(performance.now() - startTime);
    console.log(`[Sequential] Complete in ${totalTime}ms: ${stats.totalNodes} nodes`);
    
    return {
      csv,
      nodeCount: stats.totalNodes,
      officialNodesUsed: stats.officialNodesUsed,
      customScripts: [],
      warnings: [],
      readme: `Bot generated using sequential generation in ${totalTime}ms`
    };
    
  } catch (error: any) {
    console.error('[Sequential] Generation failed:', error);
    throw error;
  }
}
