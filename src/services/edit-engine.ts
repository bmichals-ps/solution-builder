/**
 * Edit Engine Service
 * 
 * Translates natural language edit requests into bot CSV and script changes.
 * Uses Claude API with conversation context for targeted, intelligent edits.
 */

import type { EditRequest, EditResult, ConversationContext, CustomScript } from '../types';

// API endpoint for AI generation
const AI_ENDPOINT = '/api/ai/generate';

/**
 * Process a natural language edit request and return the modified CSV/scripts
 */
export async function processEditRequest(request: EditRequest): Promise<EditResult> {
  const { instruction, context, currentCsv, currentScripts } = request;
  
  console.log('[EditEngine] Processing edit request:', instruction);
  console.log('[EditEngine] Context messages:', context.messages.length);
  
  try {
    // Build the prompt with context
    const prompt = buildEditPrompt(instruction, context, currentCsv, currentScripts);
    
    // Call the AI API
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'edit',
        prompt,
        currentCsv,
        currentScripts: currentScripts.map(s => ({ name: s.name, content: s.content }))
      })
    });
    
    if (!response.ok) {
      throw new Error(`AI API returned ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      return {
        success: false,
        modifiedCsv: currentCsv,
        changesSummary: 'Failed to apply changes',
        affectedNodes: [],
        error: result.error || 'Unknown error'
      };
    }
    
    // Parse the result
    const modifiedCsv = result.csv || currentCsv;
    const modifiedScripts = result.scripts || currentScripts;
    const changesSummary = result.summary || 'Changes applied';
    const affectedNodes = result.affectedNodes || [];
    
    console.log('[EditEngine] Edit complete:', changesSummary);
    console.log('[EditEngine] Affected nodes:', affectedNodes);
    
    return {
      success: true,
      modifiedCsv,
      modifiedScripts,
      changesSummary,
      affectedNodes
    };
    
  } catch (error: any) {
    console.error('[EditEngine] Error:', error);
    return {
      success: false,
      modifiedCsv: currentCsv,
      changesSummary: 'Failed to process edit',
      affectedNodes: [],
      error: error.message
    };
  }
}

/**
 * Build the edit prompt with context
 */
function buildEditPrompt(
  instruction: string,
  context: ConversationContext,
  currentCsv: string,
  currentScripts: CustomScript[]
): string {
  // Build conversation summary
  const recentMessages = context.messages.slice(-10);
  const conversationSummary = recentMessages.map(m => 
    `${m.fromSide === 'bot' ? 'Bot' : 'User'}: ${m.text?.substring(0, 100) || '[no text]'}`
  ).join('\n');
  
  // Identify current context
  const currentBotMessage = context.lastBotMessage?.text || '';
  const currentRichAsset = context.lastBotMessage?.richAssetType || '';
  
  return `
## TASK: Edit Bot CSV Based on User Request

### User's Edit Request
"${instruction}"

### Current Conversation Context
The user is testing the bot and has reached this point in the conversation:

Last Bot Message: ${currentBotMessage || 'N/A'}
Rich Asset Type: ${currentRichAsset || 'none'}

Recent Conversation:
${conversationSummary || 'No conversation yet'}

### Current Bot CSV (first 50 rows for context)
\`\`\`csv
${currentCsv.split('\n').slice(0, 50).join('\n')}
\`\`\`

### Current Scripts (${currentScripts.length})
${currentScripts.map(s => `- ${s.name}`).join('\n') || 'No custom scripts'}

### Instructions
1. Analyze the user's edit request in the context of the current conversation
2. Make the minimal changes needed to fulfill the request
3. Preserve all existing functionality unless explicitly asked to change it
4. Return the complete modified CSV with changes applied
5. List which node numbers were affected

### Response Format
Return a JSON object with:
- csv: The complete modified CSV
- summary: Brief description of changes made
- affectedNodes: Array of node numbers that were modified
- scripts: Array of modified scripts (if any)
`;
}

/**
 * Apply a simple text replacement edit
 * This is a fast path for simple message changes
 */
export function applySimpleEdit(
  csv: string,
  nodeNum: number,
  columnName: string,
  newValue: string
): EditResult {
  const lines = csv.split('\n');
  const header = lines[0];
  const headerCols = parseCSVRow(header);
  
  // Find column index
  const colIndex = headerCols.findIndex(
    h => h.toLowerCase().trim() === columnName.toLowerCase().trim()
  );
  
  if (colIndex === -1) {
    return {
      success: false,
      modifiedCsv: csv,
      changesSummary: `Column "${columnName}" not found`,
      affectedNodes: [],
      error: `Column not found: ${columnName}`
    };
  }
  
  // Find and modify the node
  let modified = false;
  const modifiedLines = lines.map((line, i) => {
    if (i === 0) return line; // Keep header
    
    const cols = parseCSVRow(line);
    if (cols.length === 0) return line;
    
    const lineNodeNum = parseInt(cols[0], 10);
    if (lineNodeNum === nodeNum) {
      cols[colIndex] = escapeCSVField(newValue);
      modified = true;
      return cols.join(',');
    }
    
    return line;
  });
  
  if (!modified) {
    return {
      success: false,
      modifiedCsv: csv,
      changesSummary: `Node ${nodeNum} not found`,
      affectedNodes: [],
      error: `Node not found: ${nodeNum}`
    };
  }
  
  return {
    success: true,
    modifiedCsv: modifiedLines.join('\n'),
    changesSummary: `Updated ${columnName} for node ${nodeNum}`,
    affectedNodes: [nodeNum]
  };
}

/**
 * Parse a CSV row handling quoted fields
 */
function parseCSVRow(line: string): string[] {
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
 * Escape a field for CSV
 */
function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Find nodes matching a text pattern
 */
export function findNodesWithText(csv: string, searchText: string): number[] {
  const lines = csv.split('\n');
  const matches: number[] = [];
  const searchLower = searchText.toLowerCase();
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes(searchLower)) {
      const cols = parseCSVRow(lines[i]);
      const nodeNum = parseInt(cols[0], 10);
      if (!isNaN(nodeNum)) {
        matches.push(nodeNum);
      }
    }
  }
  
  return matches;
}

/**
 * Get node details by number
 */
export function getNodeDetails(csv: string, nodeNum: number): Record<string, string> | null {
  const lines = csv.split('\n');
  const header = parseCSVRow(lines[0]);
  
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const lineNodeNum = parseInt(cols[0], 10);
    
    if (lineNodeNum === nodeNum) {
      const details: Record<string, string> = {};
      header.forEach((col, idx) => {
        details[col] = cols[idx] || '';
      });
      return details;
    }
  }
  
  return null;
}

export default {
  processEditRequest,
  applySimpleEdit,
  findNodesWithText,
  getNodeDetails
};
