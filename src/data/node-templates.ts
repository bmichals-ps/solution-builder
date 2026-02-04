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
  // GenAI Fallback Chain (1800-1804) - AI understanding before human escalation
  {
    num: 1800, type: 'A', name: 'OutOfScope → Try GenAI',
    intent: 'out_of_scope',
    command: 'GenAIFallback', description: 'AI attempts to understand with company knowledge', output: 'result',
    paramInput: '{"question":"{LAST_USER_MESSAGE}","context":"{LAST_TOPIC}","entity":"{LAST_ENTITY}","conversation_context":"{CONVERSATION_CONTEXT}","company_name":"{COMPANY_NAME}","company_context":"{COMPANY_CONTEXT}","bot_persona":"{BOT_PERSONA}","conversation_history":"{CONVERSATION_HISTORY}"}',
    decVar: 'result', whatNext: 'understood~1802|route_flow~1803|not_understood~1804|error~1804',
    variable: 'AI_RESPONSE',
  },
  {
    num: 1802, type: 'D', name: 'GenAIResponse → AI Answer',
    message: '{AI_RESPONSE}',
    nextNodes: '1800', // User can type follow-up questions → goes back to AI
    richType: 'quick_reply',
    richContent: '{"type":"static","options":[{"label":"Back to Menu","dest":200},{"label":"All Done","dest":666},{"label":"Talk to Agent","dest":999}]}',
    nluDisabled: '', // Keep NLU enabled for follow-up questions
    ansReq: '1',
  },
  {
    num: 1803, type: 'A', name: 'RouteDetectedIntent',
    command: 'SysMultiMatchRouting', description: 'Route to detected flow', output: 'route_to',
    paramInput: '{"global_vars":"DETECTED_INTENT","input_vars":"product,details,schedule,pricing,support"}',
    decVar: 'route_to', whatNext: 'product~300|details~320|schedule~400|pricing~500|support~600|error~1804',
  },
  {
    num: 1804, type: 'D', name: 'FallbackFail → Human Help',
    message: 'I want to make sure I help you correctly. Let me connect you with someone who can assist.',
    richType: 'button', richContent: 'Talk to Agent~999|Start Over~1',
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
// STARTUP FLOW (Nodes 1-105)
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
    decVar: 'success', whatNext: 'ios~100|android~101|mac~102|windows~102|other~102|error~103',
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
    decVar: 'success', whatNext: 'true~105|error~99990',
    variable: 'ENV',
  },
  // Context initialization - required for intelligent NLU and company knowledge
  {
    num: 105, type: 'A', name: 'InitContext → Set Context Vars',
    command: 'SysAssignVariable', description: 'Initialize conversation context and company knowledge', output: 'success',
    // COMPANY_NAME, COMPANY_CONTEXT, and BOT_PERSONA are populated during bot generation
    // CONVERSATION_HISTORY is updated throughout the conversation by the platform
    paramInput: '{"set":{"LAST_TOPIC":"","LAST_ENTITY":"","CONVERSATION_CONTEXT":"","CONTEXT_FLOW":"","COMPANY_NAME":"","COMPANY_CONTEXT":"","BOT_PERSONA":"","CONVERSATION_HISTORY":""}}',
    decVar: 'success', whatNext: 'true~200|error~99990',
    variable: 'LAST_TOPIC',
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

/** Context update - saves current topic/entity for intelligent follow-ups */
export function contextUpdate(
  nodeNum: number, 
  topic: string, 
  entityVar: string, 
  contextType: string,
  nextNode: number
): NodeTemplate {
  return {
    num: nodeNum, type: 'A', name: `UpdateContext → ${topic}`,
    command: 'SysAssignVariable', description: 'Save topic context for follow-ups', output: 'success',
    paramInput: JSON.stringify({
      set: {
        LAST_TOPIC: topic,
        LAST_ENTITY: `{${entityVar}}`,
        CONVERSATION_CONTEXT: contextType,
      }
    }),
    decVar: 'success', whatNext: `true~${nextNode}|error~${nextNode}`,
    variable: 'LAST_ENTITY',
  };
}

/** Enhanced intent routing with synonyms */
export function enhancedIntentRouting(
  nodeNum: number,
  intentsWithSynonyms: Array<{ intent: string; synonyms: string[]; dest: number }>,
  fallbackNode: number = 1800
): NodeTemplate {
  // Flatten all intents and synonyms into input_vars
  const allKeywords: string[] = [];
  const routingParts: string[] = [];
  
  for (const item of intentsWithSynonyms) {
    allKeywords.push(item.intent);
    allKeywords.push(...item.synonyms);
    
    // Map primary intent to destination
    routingParts.push(`${item.intent}~${item.dest}`);
    // Map each synonym to same destination
    for (const syn of item.synonyms) {
      routingParts.push(`${syn}~${item.dest}`);
    }
  }
  
  routingParts.push(`error~${fallbackNode}`);
  
  return {
    num: nodeNum, type: 'A', name: 'IntentRouting → Enhanced',
    command: 'SysMultiMatchRouting', 
    description: 'Routes with synonym coverage', 
    output: 'next_node',
    paramInput: JSON.stringify({
      global_vars: 'LAST_USER_MESSAGE',
      input_vars: allKeywords.join(','),
    }),
    decVar: 'next_node', 
    whatNext: routingParts.join('|'),
  };
}

// ============================================
// GENAI FALLBACK NODES (for intelligent fallback)
// ============================================

export const GENAI_FALLBACK_NODES: NodeTemplate[] = [
  {
    num: 1800, type: 'A', name: 'OutOfScope → Try GenAI',
    intent: 'out_of_scope',
    command: 'GenAIFallback', description: 'AI attempts to understand with company knowledge', output: 'result',
    paramInput: '{"question":"{LAST_USER_MESSAGE}","context":"{LAST_TOPIC}","entity":"{LAST_ENTITY}","conversation_context":"{CONVERSATION_CONTEXT}","company_name":"{COMPANY_NAME}","company_context":"{COMPANY_CONTEXT}","bot_persona":"{BOT_PERSONA}","conversation_history":"{CONVERSATION_HISTORY}"}',
    decVar: 'result', whatNext: 'understood~1802|route_flow~1803|not_understood~1804|error~1804',
    variable: 'AI_RESPONSE',
  },
  {
    num: 1802, type: 'D', name: 'GenAIResponse → AI Answer',
    message: '{AI_RESPONSE}',
    nextNodes: '1800', // User can type follow-up questions → goes back to AI
    richType: 'quick_reply',
    richContent: '{"type":"static","options":[{"label":"Back to Menu","dest":200},{"label":"All Done","dest":666},{"label":"Talk to Agent","dest":999}]}',
    nluDisabled: '', // Keep NLU enabled for follow-up questions
    ansReq: '1',
  },
  {
    num: 1803, type: 'A', name: 'RouteDetectedIntent',
    command: 'SysMultiMatchRouting', description: 'Route to detected flow', output: 'route_to',
    paramInput: '{"global_vars":"DETECTED_INTENT","input_vars":"product,details,schedule,pricing,support"}',
    decVar: 'route_to', whatNext: 'product~300|details~320|schedule~400|pricing~500|support~600|error~1804',
  },
  {
    num: 1804, type: 'D', name: 'FallbackFail → Human Help',
    message: 'I want to make sure I help you correctly. Let me connect you with someone who can assist.',
    richType: 'button', richContent: 'Talk to Agent~999|Start Over~1',
    ansReq: '1', behaviors: 'disable_input',
  },
];

// ============================================
// TEMPLATE EXPORT FOR GENERATION PROMPT
// ============================================

/** Get all templates as a formatted string for the generation prompt */
export function getTemplateContext(): string {
  return `
## NODE TEMPLATE LIBRARY (Copy these patterns!)

### System Nodes (include all of these):
${JSON.stringify(SYSTEM_NODES, null, 2)}

### Startup Flow (include all of these - note context initialization at node 105):
${JSON.stringify(STARTUP_NODES, null, 2)}

### GenAI Fallback Chain (intelligent NLU before human escalation):
${JSON.stringify(GENAI_FALLBACK_NODES, null, 2)}

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

### Pattern: Context Update (IMPORTANT - use after every topic/product selection)
After showing product info or selecting a topic, update context for intelligent follow-ups:
{ type: "A", command: "SysAssignVariable", paramInput: {"set":{"LAST_TOPIC":"topic_name","LAST_ENTITY":"{PRODUCT_NAME}","CONVERSATION_CONTEXT":"browsing"}} }

### Pattern: Enhanced Intent Routing with Synonyms
Include synonyms in SysMultiMatchRouting input_vars for better coverage:
{ command: "SysMultiMatchRouting", paramInput: {"global_vars":"LAST_USER_MESSAGE","input_vars":"product,products,item,items,browse,ingredients,nutrition,details,more"} }
`;
}
