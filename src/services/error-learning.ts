/**
 * Error Learning Service
 * 
 * Provides self-improvement capabilities by logging validation errors,
 * tracking fix attempts, and querying proven solutions.
 * 
 * Integration points:
 * - During CSV generation: Include errors to avoid in prompt
 * - During validation: Log error patterns
 * - During refinement: Query known fixes, log fix attempts
 */

import { supabase } from '../lib/supabase';

// ============================================
// TYPES
// ============================================

export interface ErrorPattern {
  id: string;
  error_signature: string;
  error_type: string;
  field_name: string | null;
  error_description: string;
  node_context: Record<string, unknown> | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface FixAttempt {
  id: string;
  error_pattern_id: string;
  fix_description: string;
  fix_diff: Record<string, unknown> | null;
  success: boolean;
  applied_count: number;
  success_count: number;
  failure_count: number;
  confidence_score: number;
  created_at: string;
  last_applied_at: string;
  error_patterns?: ErrorPattern;
}

export interface ErrorToAvoid {
  error_type: string;
  field: string | null;
  description: string;
  occurrences: number;
  known_fix?: string;
}

export interface ValidationError {
  node_num?: number;
  row_num?: number;
  field_name?: string;
  error_description?: string;
  err_msgs?: Array<{
    field_name: string;
    error_description: string;
    field_entry?: string;  // The actual content that caused the error
  }>;
}

// ============================================
// ERROR NORMALIZATION
// ============================================

/**
 * Creates a normalized error signature for matching similar errors
 * Removes node-specific details to create a pattern
 */
export function normalizeError(error: ValidationError): string {
  const fieldName = error.field_name || error.err_msgs?.[0]?.field_name || 'unknown';
  const description = error.error_description || error.err_msgs?.[0]?.error_description || '';
  
  // Normalize the description by removing variable parts
  const normalizedDesc = description
    .replace(/node \d+/gi, 'node X')
    .replace(/"\d+"/g, '"X"')
    .replace(/row \d+/gi, 'row X')
    .replace(/\d+ characters?/gi, 'N characters')
    .toLowerCase()
    .trim();
  
  // Create a simple hash from field + normalized description
  const input = `${fieldName.toLowerCase()}:${normalizedDesc}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `err_${Math.abs(hash).toString(16)}`;
}

/**
 * Categorizes an error into a high-level type
 */
export function categorizeError(error: ValidationError): string {
  const description = (error.error_description || error.err_msgs?.[0]?.error_description || '').toLowerCase();
  const fieldName = (error.field_name || error.err_msgs?.[0]?.field_name || '').toLowerCase();
  
  // Match known error patterns
  if (description.includes('nlu disabled') && description.includes('one child')) {
    return 'NLU_DISABLED_MULTI_CHILD';
  }
  if (description.includes('invalid json') || description.includes('malformed')) {
    return 'INVALID_JSON';
  }
  if (description.includes('does not exist') || description.includes('not found')) {
    return 'MISSING_REFERENCE';
  }
  if (fieldName.includes('next nodes') && description.includes('child')) {
    return 'NEXT_NODES_CONSTRAINT';
  }
  if (fieldName.includes('rich asset')) {
    return 'RICH_ASSET_ERROR';
  }
  if (fieldName.includes('message') && description.includes('character')) {
    return 'MESSAGE_LENGTH';
  }
  if (description.includes('reserved') || description.includes('special character')) {
    return 'RESERVED_CHARACTER';
  }
  if (description.includes('answer required')) {
    return 'ANSWER_REQUIRED_CONSTRAINT';
  }
  
  // Default to field name or generic
  return fieldName ? `${fieldName.toUpperCase().replace(/\s+/g, '_')}_ERROR` : 'UNKNOWN_ERROR';
}

/**
 * Extracts relevant node context from CSV for error logging
 */
export function extractNodeContext(csv: string, nodeNum: number | undefined): Record<string, unknown> | null {
  if (!nodeNum) return null;
  
  try {
    const lines = csv.split('\n');
    const headers = lines[0]?.split(',').map(h => h.trim().replace(/"/g, ''));
    
    // Find the row with this node number
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Simple check for node number at start
      if (line.startsWith(`${nodeNum},`) || line.startsWith(`"${nodeNum}",`)) {
        const values = parseCSVLine(line);
        const context: Record<string, unknown> = {};
        headers?.forEach((header, idx) => {
          if (values[idx] && values[idx].trim()) {
            context[header] = values[idx];
          }
        });
        return context;
      }
    }
  } catch (e) {
    console.warn('[SELF-IMPROVE] Failed to extract node context:', e);
  }
  
  return null;
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

// ============================================
// API FUNCTIONS
// ============================================

const EDGE_FUNCTION_URL = '/functions/v1/sd-error-learning';

// Track consecutive failures to avoid spamming on temporary outages
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_BACKOFF = 3;

/**
 * Check if we should attempt the request (simple backoff on repeated failures)
 */
function shouldAttemptRequest(): boolean {
  if (consecutiveFailures >= MAX_FAILURES_BEFORE_BACKOFF) {
    // After 3 failures, only retry every 10th call
    return Math.random() < 0.1;
  }
  return true;
}

/**
 * Record a successful request
 */
function recordSuccess(): void {
  consecutiveFailures = 0;
}

/**
 * Record a failed request
 */
function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures === MAX_FAILURES_BEFORE_BACKOFF) {
    console.log('[SELF-IMPROVE] ℹ️ Error learning temporarily unavailable - reducing request frequency');
  }
}

/**
 * Log an error pattern (creates or increments occurrence count)
 */
export async function logErrorPattern(
  error: ValidationError,
  csv?: string
): Promise<string | null> {
  // Skip if we're in backoff mode
  if (!shouldAttemptRequest()) {
    return null;
  }
  
  try {
    const signature = normalizeError(error);
    const errorType = categorizeError(error);
    const fieldName = error.field_name || error.err_msgs?.[0]?.field_name;
    const description = error.error_description || error.err_msgs?.[0]?.error_description || '';
    const nodeContext = csv ? extractNodeContext(csv, error.node_num) : null;
    
    console.log(`[SELF-IMPROVE] 📝 Logging error pattern: ${errorType} (${signature})`);
    
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch(`${EDGE_FUNCTION_URL}/patterns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.session?.access_token || ''}`,
      },
      body: JSON.stringify({
        error_signature: signature,
        error_type: errorType,
        field_name: fieldName,
        error_description: description,
        node_context: nodeContext,
      }),
    });
    
    if (!response.ok) {
      recordFailure();
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.warn('[SELF-IMPROVE] ❌ Failed to log error pattern:', errorData);
      return null;
    }
    
    recordSuccess();
    const result = await response.json();
    console.log(`[SELF-IMPROVE] ✅ Error pattern logged: ${result.pattern_id}`);
    return result.pattern_id;
  } catch (e) {
    recordFailure();
    console.warn('[SELF-IMPROVE] ❌ Error logging pattern:', e);
    return null;
  }
}

/**
 * Log a fix attempt (creates or updates based on success)
 */
export async function logFixAttempt(
  errorPatternId: string,
  fixDescription: string,
  success: boolean,
  fixDiff?: Record<string, unknown>
): Promise<string | null> {
  // Skip if we're in backoff mode
  if (!shouldAttemptRequest()) {
    return null;
  }
  
  try {
    console.log(`[SELF-IMPROVE] 📝 Logging fix attempt: ${fixDescription.substring(0, 50)}... (${success ? '✅ success' : '❌ failure'})`);
    
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch(`${EDGE_FUNCTION_URL}/fixes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.session?.access_token || ''}`,
      },
      body: JSON.stringify({
        error_pattern_id: errorPatternId,
        fix_description: fixDescription,
        fix_diff: fixDiff,
        success,
      }),
    });
    
    if (!response.ok) {
      recordFailure();
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.warn('[SELF-IMPROVE] ❌ Failed to log fix attempt:', errorData);
      return null;
    }
    
    recordSuccess();
    const result = await response.json();
    console.log(`[SELF-IMPROVE] ✅ Fix attempt logged: ${result.fix_id}`);
    return result.fix_id;
  } catch (e) {
    recordFailure();
    console.warn('[SELF-IMPROVE] ❌ Error logging fix attempt:', e);
    return null;
  }
}

/**
 * Get errors to avoid for generation prompt
 */
export async function getErrorsToAvoid(limit = 20): Promise<ErrorToAvoid[]> {
  // Skip if we're in backoff mode
  if (!shouldAttemptRequest()) {
    return [];
  }
  
  try {
    console.log(`[SELF-IMPROVE] 🔍 Fetching errors to avoid (limit: ${limit})...`);
    
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch(`${EDGE_FUNCTION_URL}/errors-to-avoid?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.session?.access_token || ''}`,
      },
    });
    
    if (!response.ok) {
      recordFailure();
      console.warn('[SELF-IMPROVE] ❌ Failed to get errors to avoid');
      return [];
    }
    
    recordSuccess();
    const result = await response.json();
    const errors = result.errors_to_avoid || [];
    console.log(`[SELF-IMPROVE] ✅ Loaded ${errors.length} error patterns to avoid`);
    return errors;
  } catch (e) {
    recordFailure();
    console.warn('[SELF-IMPROVE] ❌ Error getting errors to avoid:', e);
    return [];
  }
}

/**
 * Query known fixes for specific error signatures
 */
export async function getKnownFixes(errors: ValidationError[]): Promise<FixAttempt[]> {
  if (errors.length === 0) return [];
  
  // Skip if we're in backoff mode
  if (!shouldAttemptRequest()) {
    return [];
  }
  
  try {
    const signatures = errors.map(e => normalizeError(e));
    console.log(`[SELF-IMPROVE] 🔍 Querying known fixes for ${signatures.length} error signatures...`);
    
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch(`${EDGE_FUNCTION_URL}/query-fixes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.session?.access_token || ''}`,
      },
      body: JSON.stringify({ error_signatures: signatures }),
    });
    
    if (!response.ok) {
      recordFailure();
      console.warn('[SELF-IMPROVE] ❌ Failed to query known fixes');
      return [];
    }
    
    recordSuccess();
    const result = await response.json();
    const fixes = result.fixes || [];
    if (fixes.length > 0) {
      console.log(`[SELF-IMPROVE] ✅ Found ${fixes.length} known fixes to apply`);
    } else {
      console.log(`[SELF-IMPROVE] ℹ️ No known fixes found for these errors`);
    }
    return fixes;
  } catch (e) {
    recordFailure();
    console.warn('[SELF-IMPROVE] ❌ Error querying known fixes:', e);
    return [];
  }
}

/**
 * Get all proven fixes (high confidence)
 */
export async function getProvenFixes(
  minConfidence = 0.7,
  minApplied = 3,
  limit = 50
): Promise<FixAttempt[]> {
  // Skip if we're in backoff mode
  if (!shouldAttemptRequest()) {
    return [];
  }
  
  try {
    console.log(`[SELF-IMPROVE] 🔍 Fetching proven fixes (min confidence: ${minConfidence * 100}%)...`);
    
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch(
      `${EDGE_FUNCTION_URL}/fixes?min_confidence=${minConfidence}&min_applied=${minApplied}&limit=${limit}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.session?.access_token || ''}`,
        },
      }
    );
    
    if (!response.ok) {
      recordFailure();
      console.warn('[SELF-IMPROVE] ❌ Failed to get proven fixes');
      return [];
    }
    
    recordSuccess();
    const result = await response.json();
    const fixes = result.fixes || [];
    console.log(`[SELF-IMPROVE] ✅ Loaded ${fixes.length} proven fixes`);
    return fixes;
  } catch (e) {
    recordFailure();
    console.warn('[SELF-IMPROVE] ❌ Error getting proven fixes:', e);
    return [];
  }
}

// ============================================
// FORMATTING HELPERS
// ============================================

/**
 * Format errors to avoid for injection into generation prompt
 * Creates highly actionable guidance with DO/DON'T examples
 */
export function formatErrorsToAvoidForPrompt(errors: ErrorToAvoid[]): string {
  if (errors.length === 0) return '';
  
  // Group errors by type for better organization
  const groupedErrors: Record<string, ErrorToAvoid[]> = {};
  for (const error of errors) {
    const type = error.error_type || 'General';
    if (!groupedErrors[type]) {
      groupedErrors[type] = [];
    }
    groupedErrors[type].push(error);
  }
  
  const sections: string[] = [];
  
  for (const [errorType, typeErrors] of Object.entries(groupedErrors)) {
    const items = typeErrors.slice(0, 5).map((e, i) => {
      let item = `   ${i + 1}. ${e.description}`;
      if (e.field) {
        item += ` (Field: ${e.field})`;
      }
      if (e.occurrences > 3) {
        item += ` [${e.occurrences}x occurrences - HIGH PRIORITY]`;
      }
      if (e.known_fix) {
        item += `\n      ✓ CORRECT: ${e.known_fix}`;
      }
      return item;
    });
    
    sections.push(`### ${errorType} Errors (${typeErrors.length} patterns)\n${items.join('\n')}`);
  }
  
  return `
## ⚠️ CRITICAL: LEARNED ERROR PATTERNS TO AVOID
The following mistakes have been detected in previous generations. You MUST avoid these:

${sections.join('\n\n')}

**IMPORTANT**: These are real errors that have occurred before. Take extra care to avoid them.
`;
}

/**
 * Format known fixes for injection into refinement prompt
 */
export function formatKnownFixesForPrompt(fixes: FixAttempt[]): string {
  if (fixes.length === 0) return '';
  
  // Group by error type and pick highest confidence fix for each
  const fixesByType: Record<string, FixAttempt> = {};
  for (const fix of fixes) {
    const errorType = fix.error_patterns?.error_type || 'unknown';
    if (!fixesByType[errorType] || fix.confidence_score > fixesByType[errorType].confidence_score) {
      fixesByType[errorType] = fix;
    }
  }
  
  const lines = Object.entries(fixesByType).map(([errorType, fix]) => {
    return `- For ${errorType} errors: ${fix.fix_description} (${Math.round(fix.confidence_score * 100)}% success rate)`;
  });
  
  return `
PROVEN FIXES (apply these first):
${lines.join('\n')}
`;
}

/**
 * Format proven fixes as positive examples for initial generation
 * This gives the AI patterns that are KNOWN TO WORK
 */
export function formatProvenFixesForGeneration(fixes: FixAttempt[]): string {
  if (fixes.length === 0) return '';
  
  // Group by error type and get the best fix for each
  const bestFixesByType: Record<string, FixAttempt> = {};
  for (const fix of fixes) {
    const errorType = fix.error_patterns?.error_type || 'General';
    if (!bestFixesByType[errorType] || fix.confidence_score > bestFixesByType[errorType].confidence_score) {
      bestFixesByType[errorType] = fix;
    }
  }
  
  const patterns = Object.entries(bestFixesByType)
    .filter(([_, fix]) => fix.confidence_score >= 0.7)
    .slice(0, 10)
    .map(([errorType, fix]) => {
      const confidence = Math.round(fix.confidence_score * 100);
      const applied = fix.applied_count;
      let description = fix.fix_description;
      
      // Extract field name if available
      const fieldName = fix.error_patterns?.field_name;
      if (fieldName) {
        return `   - ${fieldName}: ${description} [${confidence}% success, ${applied}x verified]`;
      }
      return `   - ${errorType}: ${description} [${confidence}% success, ${applied}x verified]`;
    });
  
  if (patterns.length === 0) return '';
  
  return `
## ✅ PROVEN PATTERNS (Use These!)
The following patterns have been VERIFIED to work correctly across multiple generations:

${patterns.join('\n')}

**TIP**: When generating similar content, follow these proven patterns exactly.
`;
}

// ============================================
// HUMAN INTERVENTION
// ============================================

export interface HumanFix {
  fixes: Array<{
    node_num: number;
    field: string;
    current_value: string;
    correct_value: string;
    explanation: string;
  }>;
  general_guidance: string;
}

/**
 * Submit a human-provided fix to the learning system
 * This creates high-confidence fix patterns that will be used in future generations
 */
export async function submitHumanFix(fixData: HumanFix): Promise<boolean> {
  if (!shouldAttemptRequest()) {
    console.warn('[SELF-IMPROVE] Skipping human fix submission (in backoff)');
    return false;
  }
  
  try {
    console.log(`[SELF-IMPROVE] 📝 Submitting human fix with ${fixData.fixes.length} corrections`);
    
    const { data: session } = await supabase.auth.getSession();
    
    // Submit each fix as a high-confidence pattern
    for (const fix of fixData.fixes) {
      // Create error pattern
      const patternResponse = await fetch(`${EDGE_FUNCTION_URL}/patterns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.session?.access_token || ''}`,
        },
        body: JSON.stringify({
          error_signature: `node_${fix.node_num}_${fix.field}`,
          error_type: 'Human-Identified',
          field_name: fix.field,
          error_description: `Field "${fix.field}" had incorrect value. ${fix.explanation}`,
          node_context: { node_num: fix.node_num, field: fix.field },
        }),
      });
      
      if (!patternResponse.ok) {
        console.warn('[SELF-IMPROVE] Failed to create pattern for human fix');
        continue;
      }
      
      const patternResult = await patternResponse.json();
      const patternId = patternResult.pattern_id;
      
      // Create fix attempt with high success rate
      const fixResponse = await fetch(`${EDGE_FUNCTION_URL}/fixes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.session?.access_token || ''}`,
        },
        body: JSON.stringify({
          error_pattern_id: patternId,
          fix_description: `Change "${fix.current_value}" to "${fix.correct_value}". ${fix.explanation}`,
          fix_diff: JSON.stringify({ before: fix.current_value, after: fix.correct_value }),
          success: true,
        }),
      });
      
      if (fixResponse.ok) {
        console.log(`[SELF-IMPROVE] ✅ Human fix logged for node ${fix.node_num}`);
      }
    }
    
    // Log general guidance as a pattern
    if (fixData.general_guidance) {
      await fetch(`${EDGE_FUNCTION_URL}/patterns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.session?.access_token || ''}`,
        },
        body: JSON.stringify({
          error_signature: `guidance_${Date.now()}`,
          error_type: 'Human-Guidance',
          field_name: null,
          error_description: fixData.general_guidance,
          node_context: null,
        }),
      });
      console.log(`[SELF-IMPROVE] ✅ General guidance logged`);
    }
    
    recordSuccess();
    return true;
  } catch (e) {
    console.error('[SELF-IMPROVE] ❌ Failed to submit human fix:', e);
    recordFailure();
    return false;
  }
}

// ============================================
// CSV DIFF UTILITIES
// ============================================

export interface CSVNodeChange {
  nodeNum: number;
  changeType: 'added' | 'removed' | 'modified';
  changedFields: string[];
  before?: Record<string, string>;
  after?: Record<string, string>;
}

export interface CSVDiffResult {
  changes: CSVNodeChange[];
  summary: string;
  addedNodes: number[];
  removedNodes: number[];
  modifiedNodes: number[];
}

/**
 * Parse CSV into a map of nodes keyed by node number
 */
function parseCSVToNodeMap(csv: string): Map<number, Record<string, string>> {
  const lines = csv.split('\n').filter(line => line.trim());
  if (lines.length < 2) return new Map();
  
  const headers = parseCSVLine(lines[0]);
  const nodeMap = new Map<number, Record<string, string>>();
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const nodeNum = parseInt(values[0]);
    
    if (!isNaN(nodeNum)) {
      const node: Record<string, string> = {};
      headers.forEach((header, idx) => {
        node[header.trim()] = values[idx] || '';
      });
      nodeMap.set(nodeNum, node);
    }
  }
  
  return nodeMap;
}

/**
 * Compare two CSVs and return the differences
 */
export function diffCSV(beforeCSV: string, afterCSV: string): CSVDiffResult {
  const beforeNodes = parseCSVToNodeMap(beforeCSV);
  const afterNodes = parseCSVToNodeMap(afterCSV);
  
  const changes: CSVNodeChange[] = [];
  const addedNodes: number[] = [];
  const removedNodes: number[] = [];
  const modifiedNodes: number[] = [];
  
  // Find added and modified nodes
  for (const [nodeNum, afterNode] of afterNodes) {
    const beforeNode = beforeNodes.get(nodeNum);
    
    if (!beforeNode) {
      // Node was added
      addedNodes.push(nodeNum);
      changes.push({
        nodeNum,
        changeType: 'added',
        changedFields: Object.keys(afterNode).filter(k => afterNode[k]),
        after: afterNode,
      });
    } else {
      // Check for modifications
      const changedFields: string[] = [];
      for (const field of Object.keys(afterNode)) {
        if (beforeNode[field] !== afterNode[field]) {
          changedFields.push(field);
        }
      }
      
      if (changedFields.length > 0) {
        modifiedNodes.push(nodeNum);
        changes.push({
          nodeNum,
          changeType: 'modified',
          changedFields,
          before: beforeNode,
          after: afterNode,
        });
      }
    }
  }
  
  // Find removed nodes
  for (const nodeNum of beforeNodes.keys()) {
    if (!afterNodes.has(nodeNum)) {
      const beforeNode = beforeNodes.get(nodeNum)!;
      removedNodes.push(nodeNum);
      changes.push({
        nodeNum,
        changeType: 'removed',
        changedFields: Object.keys(beforeNode).filter(k => beforeNode[k]),
        before: beforeNode,
      });
    }
  }
  
  // Generate summary
  const summaryParts: string[] = [];
  if (addedNodes.length > 0) {
    summaryParts.push(`Added ${addedNodes.length} node(s): ${addedNodes.join(', ')}`);
  }
  if (removedNodes.length > 0) {
    summaryParts.push(`Removed ${removedNodes.length} node(s): ${removedNodes.join(', ')}`);
  }
  if (modifiedNodes.length > 0) {
    summaryParts.push(`Modified ${modifiedNodes.length} node(s): ${modifiedNodes.join(', ')}`);
  }
  
  return {
    changes,
    summary: summaryParts.join('; ') || 'No changes detected',
    addedNodes,
    removedNodes,
    modifiedNodes,
  };
}

/**
 * Generate a human-readable description of changes for a specific node
 */
export function describeNodeChanges(change: CSVNodeChange): string {
  if (change.changeType === 'added') {
    return `Added node ${change.nodeNum}`;
  }
  
  if (change.changeType === 'removed') {
    return `Removed node ${change.nodeNum}`;
  }
  
  // Modified
  const fieldChanges = change.changedFields.map(field => {
    const before = change.before?.[field] || '(empty)';
    const after = change.after?.[field] || '(empty)';
    
    // Truncate long values
    const truncate = (s: string, max = 50) => 
      s.length > max ? s.substring(0, max) + '...' : s;
    
    return `${field}: "${truncate(before)}" → "${truncate(after)}"`;
  });
  
  return `Modified node ${change.nodeNum}: ${fieldChanges.join(', ')}`;
}

/**
 * Match changes to errors they likely fixed
 */
export function matchChangesToErrors(
  changes: CSVNodeChange[],
  errors: ValidationError[]
): Map<string, CSVNodeChange[]> {
  const matchMap = new Map<string, CSVNodeChange[]>();
  
  for (const error of errors) {
    const errorSig = normalizeError(error);
    const nodeNum = error.node_num;
    const fieldName = error.field_name || error.err_msgs?.[0]?.field_name;
    
    // Find changes that might have fixed this error
    const matchingChanges = changes.filter(change => {
      // Match by node number if specified
      if (nodeNum && change.nodeNum === nodeNum) {
        return true;
      }
      
      // Match by field name if the change modified that field
      if (fieldName && change.changedFields.some(f => 
        f.toLowerCase().includes(fieldName.toLowerCase()) ||
        fieldName.toLowerCase().includes(f.toLowerCase())
      )) {
        return true;
      }
      
      return false;
    });
    
    if (matchingChanges.length > 0) {
      matchMap.set(errorSig, matchingChanges);
    }
  }
  
  return matchMap;
}
