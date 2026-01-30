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
    const richType = fields[COL.RICH_TYPE]?.trim().toLowerCase();
    const richContent = fields[COL.RICH_CONTENT]?.trim() || '';

    // --- FIX: Column count (pad/trim to exactly 26) ---
    if (fields.length !== 26) {
      fixes.push(`Node ${nodeNum}: Fixed column count from ${fields.length} to 26`);
      while (fields.length < 26) fields.push('');
      if (fields.length > 26) fields.length = 26;
      modified = true;
    }

    // --- FIX: "buttons" (plural) with pipe content → "button" (singular) ---
    if (richType === 'buttons' && richContent && !richContent.startsWith('{')) {
      fields[COL.RICH_TYPE] = 'button';
      fixes.push(`Node ${nodeNum}: Changed Rich Asset Type "buttons" → "button" (pipe format requires singular)`);
      modified = true;
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
    if (nodeType === 'A') {
      const cmd = fields[COL.COMMAND]?.trim();
      if (!cmd) {
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

      // --- FIX: What Next without error path ---
      const wn = fields[COL.WHAT_NEXT]?.trim();
      if (wn && !wn.toLowerCase().includes('error~')) {
        fields[COL.WHAT_NEXT] = wn + '|error~99990';
        fixes.push(`Node ${nodeNum}: Added missing |error~99990 to What Next`);
        modified = true;
      }

      // --- FIX: What Next present but no Decision Variable ---
      if (fields[COL.WHAT_NEXT]?.trim() && !fields[COL.DEC_VAR]?.trim()) {
        fields[COL.DEC_VAR] = 'success';
        fixes.push(`Node ${nodeNum}: Added missing Decision Variable "success"`);
        modified = true;
      }
    }

    // --- FIX: Decision node dead-end (no Next Nodes, no buttons, no xfer_to_agent) ---
    if (nodeType === 'D') {
      const hasNext = !!fields[COL.NEXT_NODES]?.trim();
      const hasBtns = !!fields[COL.RICH_CONTENT]?.trim() && (richType === 'button' || richType === 'buttons' || richType === 'listpicker' || richType === 'quick_reply');
      const hasXfer = fields[COL.BEHAVIORS]?.includes('xfer_to_agent');
      const isEndChat = nodeNum === 666;
      if (!hasNext && !hasBtns && !hasXfer && !isEndChat) {
        // Add a "Back to Menu" button to prevent dead-end
        fields[COL.RICH_TYPE] = 'button';
        fields[COL.RICH_CONTENT] = 'Back to Menu~201|Talk to Agent~999';
        fields[COL.ANS_REQ] = '1';
        fixes.push(`Node ${nodeNum}: Added recovery buttons to dead-end Decision node`);
        modified = true;
      }
    }

    // --- FIX: Variable column not ALL_CAPS ---
    const varCol = fields[COL.VARIABLE]?.trim();
    if (varCol && /[a-z]/.test(varCol)) {
      fields[COL.VARIABLE] = varCol.toUpperCase().replace(/[\s-]+/g, '_');
      fixes.push(`Node ${nodeNum}: Converted Variable to ALL_CAPS: ${fields[COL.VARIABLE]}`);
      modified = true;
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
  const requiredSystemNodes: Record<number, string> = {
    [-500]: '-500,A,HandleBotError,,,,,,,,,,,HandleBotError,Catches exceptions,error_type,,"{""save_error_to"":""PLATFORM_ERROR""}",error_type,bot_error~99990|bot_timeout~99990|other~99990,,,PLATFORM_ERROR,,,',
    [666]: '666,D,EndChat,,,,,,Thank you for using our service. Goodbye!,,,,,,,,,,,,,,,,,,',
    [999]: '999,D,Agent Transfer,,,,,,,,,,xfer_to_agent,,,,,,,,,,,,,,',
    [1800]: '1800,D,OutOfScope,out_of_scope,,,,,I\'m not sure I understood that.,button,Start Over~1|Talk to Agent~999,1,disable_input,,,,,,,,,,,,',
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
 * This fixes a common AI mistake where | appears inside price labels
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
  // Pattern: $<number>|k or $<number>|K (for thousands like $25k, $35k)
  fixedContent = fixedContent.replace(/(\$\d+)\|([kK])/g, '$1$2');
  
  // Fix 2: Price labels with pipe before 'm' (million) - "$1|m" -> "$1m"
  fixedContent = fixedContent.replace(/(\$\d+)\|([mM])/g, '$1$2');
  
  // Fix 3: General pattern - pipe between number and single letter that's NOT followed by ~
  // This catches "$25|k-$35|k" patterns where pipe is inside a range label
  fixedContent = fixedContent.replace(/(\d+)\|([a-zA-Z])(?=[^~]*~)/g, '$1$2');
  
  // Fix 4: Handle ranges like "$25|k-$35|k" -> "$25k-$35k"
  // Look for pipe between digits/letters within a label (before ~)
  const parts = fixedContent.split('~');
  const fixedParts = parts.map((part, idx) => {
    // Each part except the last has format: "Label" or "Label|" 
    // The last part is just a node number
    if (idx < parts.length - 1 || !part.match(/^\d+$/)) {
      // This is a label, fix any internal pipes that shouldn't be there
      // Pattern: something|letter where letter is not followed by node routing
      return part.replace(/\|([a-zA-Z])/g, (match, letter) => {
        // Check if this looks like a proper button separator (letter followed by label text)
        // If it's just a single letter like 'k' or 'm' for thousands/millions, remove the pipe
        if (letter.match(/^[kKmMbB]$/)) {
          return letter; // Remove pipe, keep letter (e.g., "$25|k" -> "$25k")
        }
        return match; // Keep the pipe (it's a real separator)
      });
    }
    return part;
  });
  fixedContent = fixedParts.join('~');
  
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
    const lines = csv.split('\n');
    const fixedLines = lines.map((line, idx) => {
      if (idx === 0) return line;
      
      const fields = parseCSVLineForFix(line);
      if (fields.length < 20) return line;
      
      const lineNodeNum = parseInt(fields[0], 10);
      if (lineNodeNum === nodeNum) {
        // Set Decision Variable to "success" — the universal safe default
        fields[18] = 'success';
        // Ensure What Next uses success-based routing
        const wn = fields[19]?.trim();
        if (!wn || !wn.includes('success') || !wn.includes('true')) {
          fields[19] = 'true~' + (fields[7]?.trim()?.split(/[,|]/)[0] || '201') + '|false~99990|error~99990';
        }
        console.log(`[Programmatic Fix] Fixed Decision Variable for node ${nodeNum} → "success"`);
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
      
      if (richType === 'button' && isJsonFormat) {
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
    // ========================================
    if (nodeType === 'A') {
      const commandValue = fields[COMMAND_COL]?.trim() || '';
      if (!commandValue) {
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
    
    // ========================================
    // FIX 13: SysAssignVariable - populate Variable column with ALL set variables
    // Error: "Referenced global variable does not exist" means Variable column is incomplete
    // ========================================
    if (nodeType === 'A' && commandField === 'SysAssignVariable') {
      const paramInput = fields[PARAM_INPUT_COL]?.trim() || '';
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
 * Generate a Pypestream bot CSV using AI
 */
export async function generateBotCSV(
  projectConfig: ProjectConfig,
  clarifyingQuestions: ClarifyingQuestion[],
  referenceFiles?: FileUpload[],
  aiCredentials?: { apiKey?: string; provider?: 'anthropic' | 'google' }
): Promise<GenerationResult> {
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

  // Post-process CSV: normalize columns then fix alignment
  const normalizedCSV = normalizeCSVColumns(result.csv);
  const fixedCSV = fixCSVColumnAlignment(normalizedCSV);

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
  
  if (fixed > 0 || removed > 0) {
    console.log(`[CSV Normalize] Fixed ${fixed} rows with wrong column count, removed ${removed} invalid rows`);
  }
  
  return normalizedLines.join('\n');
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
    // Only clear if they contain obvious non-Decision content
    // Don't clear blindly — some values might be correctly placed
  }
  
  // For Action nodes: clear Decision-only columns (8-12)
  if (nodeType === 'A') {
    // Same — don't clear blindly
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
    'ListPickerGenerator', 'GetAllProducts', 'ProductRecommendation', 'ProductQA'
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
  
  // Post-process the refined CSV
  const normalizedRefinedCSV = normalizeCSVColumns(result.csv);
  const fixedCSV = fixCSVColumnAlignment(normalizedRefinedCSV);

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
