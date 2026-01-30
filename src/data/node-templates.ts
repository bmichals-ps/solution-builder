/**
 * Node Template Library
 * 
 * Pre-built, validated node patterns for common bot scenarios.
 * These are guaranteed to pass Bot Manager validation.
 * 
 * Used by:
 * 1. Generation prompt — AI copies these patterns instead of inventing
 * 2. Programmatic fixes — inject correct patterns for missing nodes
 * 3. Validation — compare generated nodes against expected patterns
 */

export interface NodeTemplate {
  num: number;
  type: 'D' | 'A';
  name: string;
  intent?: string;
  nluDisabled?: string;
  nextNodes?: string;
  message?: string;
  richType?: string;
  richContent?: string;
  ansReq?: string;
  behaviors?: string;
  command?: string;
  description?: string;
  output?: string;
  nodeInput?: string;
  paramInput?: string;
  decVar?: string;
  whatNext?: string;
  variable?: string;
  flows?: string;
}

// ============================================
// SYSTEM NODES (Required in every bot)
// ============================================

export const SYSTEM_NODES: NodeTemplate[] = [
  {
    num: -500, type: 'A', name: 'HandleBotError',
    command: 'HandleBotError', description: 'Catches exceptions', output: 'error_type',
    paramInput: '{"save_error_to":"PLATFORM_ERROR"}',
    decVar: 'error_type', whatNext: 'bot_error~99990|bot_timeout~99990|other~99990',
    variable: 'PLATFORM_ERROR',
  },
  {
    num: 666, type: 'D', name: 'EndChat',
    message: 'Thank you for using our service. Goodbye!',
  },
  {
    num: 999, type: 'D', name: 'Agent Transfer',
    behaviors: 'xfer_to_agent',
  },
  {
    num: 1800, type: 'D', name: 'OutOfScope',
    intent: 'out_of_scope',
    message: "I'm not sure I understood that.",
    richType: 'button', richContent: 'Start Over~1|Talk to Agent~999',
    ansReq: '1', behaviors: 'disable_input',
  },
  {
    num: 99990, type: 'D', name: 'Error Message',
    message: 'Oops! Something went wrong. Let me help you get back on track.',
    richType: 'button', richContent: 'Start Over~1|Talk to Agent~999',
    ansReq: '1', behaviors: 'disable_input',
  },
];

// ============================================
// STARTUP FLOW (Nodes 1-104)
// ============================================

export const STARTUP_NODES: NodeTemplate[] = [
  {
    num: 1, type: 'A', name: 'SysShowMetadata',
    command: 'SysShowMetadata', description: 'Gets session info', output: 'success',
    paramInput: '{"passthrough_mapping":{},"assign_metadata_vars":{"chat_id":"CHATID","session_id":"SESSION_ID"}}',
    decVar: 'success', whatNext: 'true~10|error~99990',
    variable: 'CHATID',
  },
  {
    num: 10, type: 'A', name: 'UserPlatformRouting',
    command: 'UserPlatformRouting', description: 'Detects device type', output: 'success',
    decVar: 'success', whatNext: 'ios~100|android~101|desktop~102|error~103',
  },
  {
    num: 100, type: 'A', name: 'SetVar iOS',
    command: 'SysAssignVariable', description: 'Sets platform to iOS', output: 'success',
    paramInput: '{"set":{"USER_PLATFORM":"iOS"}}',
    decVar: 'success', whatNext: 'true~104|error~99990',
    variable: 'USER_PLATFORM',
  },
  {
    num: 101, type: 'A', name: 'SetVar Android',
    command: 'SysAssignVariable', description: 'Sets platform to Android', output: 'success',
    paramInput: '{"set":{"USER_PLATFORM":"Android"}}',
    decVar: 'success', whatNext: 'true~104|error~99990',
    variable: 'USER_PLATFORM',
  },
  {
    num: 102, type: 'A', name: 'SetVar Desktop',
    command: 'SysAssignVariable', description: 'Sets platform to Desktop', output: 'success',
    paramInput: '{"set":{"USER_PLATFORM":"Desktop"}}',
    decVar: 'success', whatNext: 'true~104|error~99990',
    variable: 'USER_PLATFORM',
  },
  {
    num: 103, type: 'D', name: 'Platform Fallback',
    nextNodes: '104',
  },
  {
    num: 104, type: 'A', name: 'SysSetEnv',
    command: 'SysSetEnv', description: 'Sets environment', output: 'success',
    paramInput: '{"set_env_as":"ENV"}',
    decVar: 'success', whatNext: 'true~200|error~99990',
    variable: 'ENV',
  },
];

// ============================================
// COMMON PATTERNS (Feature flow building blocks)
// ============================================

/** Free text input → store variable */
export function freeTextInput(
  nodeNum: number, name: string, message: string,
  storeNodeNum: number, varName: string, nextNode: number
): NodeTemplate[] {
  return [
    {
      num: nodeNum, type: 'D', name,
      message, ansReq: '1',
    },
    {
      num: storeNodeNum, type: 'A', name: `Store ${varName}`,
      command: 'SysAssignVariable', description: `Stores ${varName.toLowerCase()}`,
      output: 'success',
      paramInput: `{"set":{"${varName}":"{LAST_USER_MESSAGE}"}}`,
      decVar: 'success', whatNext: `true~${nextNode}|error~99990`,
      variable: varName,
    },
  ];
}

/** Email input with validation */
export function emailInput(
  startNode: number, varName: string, nextNode: number
): NodeTemplate[] {
  return [
    {
      num: startNode, type: 'D', name: 'Ask Email',
      message: "What's your email address?", ansReq: '1',
    },
    {
      num: startNode + 5, type: 'A', name: 'ValidateEmail',
      command: 'ValidateRegex', description: 'Validates email format',
      output: 'success',
      paramInput: '{"regex":"^[^@]+@[^@]+\\\\.[^@]+$","input":"{LAST_USER_MESSAGE}"}',
      decVar: 'success', whatNext: `true~${startNode + 6}|false~${startNode + 7}|error~99990`,
      variable: varName,
    },
    {
      num: startNode + 6, type: 'A', name: 'StoreEmail',
      command: 'SysAssignVariable', description: 'Stores validated email',
      output: 'success',
      paramInput: `{"set":{"${varName}":"{LAST_USER_MESSAGE}"}}`,
      decVar: 'success', whatNext: `true~${nextNode}|error~99990`,
      variable: varName,
    },
    {
      num: startNode + 7, type: 'D', name: 'Invalid Email',
      message: "That doesn't look like a valid email. Could you try again? (e.g., name@company.com)",
      nextNodes: String(startNode), ansReq: '1',
    },
  ];
}

/** Datepicker node */
export function datepicker(
  nodeNum: number, name: string, message: string,
  storeNode: number, varName: string, nextNode: number
): NodeTemplate[] {
  return [
    {
      num: nodeNum, type: 'D', name,
      message, richType: 'datepicker',
      richContent: '{"type":"static","message":"Select a date"}',
      ansReq: '1', behaviors: 'disable_input',
    },
    {
      num: storeNode, type: 'A', name: `Store ${varName}`,
      command: 'SysAssignVariable', description: `Stores selected date`,
      output: 'success',
      paramInput: `{"set":{"${varName}":"{LAST_USER_MESSAGE}"}}`,
      decVar: 'success', whatNext: `true~${nextNode}|error~99990`,
      variable: varName,
    },
  ];
}

/** Yes/No confirmation buttons */
export function yesNoConfirmation(
  nodeNum: number, name: string, message: string,
  yesNode: number, noNode: number
): NodeTemplate {
  return {
    num: nodeNum, type: 'D', name,
    message, richType: 'button',
    richContent: `Yes~${yesNode}|No~${noNode}`,
    ansReq: '1',
  };
}

/** Return menu / "anything else?" */
export function returnMenu(nodeNum: number = 201): NodeTemplate {
  return {
    num: nodeNum, type: 'D', name: 'ReturnMenu',
    nextNodes: '210',
    message: 'Is there anything else I can help with?',
    richType: 'quick_reply',
    richContent: '{"type":"static","options":[{"label":"Yes","dest":200},{"label":"No thanks","dest":666},{"label":"Talk to Agent","dest":999}]}',
    ansReq: '1',
  };
}

/** Listpicker selection */
export function listpicker(
  nodeNum: number, name: string, message: string,
  options: Array<{ label: string; dest: number; description?: string }>
): NodeTemplate {
  const jsonOptions = options.map(o => ({
    label: o.label,
    dest: String(o.dest),
    ...(o.description ? { description: o.description } : {}),
  }));
  return {
    num: nodeNum, type: 'D', name,
    message, richType: 'listpicker',
    richContent: JSON.stringify({ type: 'static', options: jsonOptions }),
    ansReq: '1', behaviors: 'disable_input',
    nluDisabled: '1',
  };
}

// ============================================
// TEMPLATE EXPORT FOR GENERATION PROMPT
// ============================================

/** Get all templates as a formatted string for the generation prompt */
export function getTemplateContext(): string {
  return `
## NODE TEMPLATE LIBRARY (Copy these patterns!)

### System Nodes (include all of these):
${JSON.stringify(SYSTEM_NODES, null, 2)}

### Startup Flow (include all of these):
${JSON.stringify(STARTUP_NODES, null, 2)}

### Pattern: Free Text Input
Ask question → user types → store in variable
Fields: { type: "D", message: "...", ansReq: "1" } → { type: "A", command: "SysAssignVariable", paramInput: {"set":{...}} }

### Pattern: Email with Validation  
Ask → ValidateRegex → Store (valid) or Re-prompt (invalid)

### Pattern: Datepicker
{ richType: "datepicker", richContent: {"type":"static","message":"..."}, ansReq: "1", behaviors: "disable_input" }

### Pattern: Yes/No Confirmation
{ richType: "button", richContent: "Yes~100|No~200", ansReq: "1" }

### Pattern: Listpicker Selection
{ richType: "listpicker", richContent: {"type":"static","options":[...]}, ansReq: "1", behaviors: "disable_input", nluDisabled: "1" }
`;
}
