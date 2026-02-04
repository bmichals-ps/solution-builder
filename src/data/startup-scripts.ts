/**
 * Startup Scripts Registry
 * 
 * SINGLE SOURCE OF TRUTH for all scripts required by the startup flow.
 * These scripts are BUNDLED with the application to guarantee availability.
 * 
 * Why bundle instead of fetch from Supabase?
 * 1. These scripts are CRITICAL - bot crashes immediately without them
 * 2. Supabase may not have them, or they may be deleted accidentally
 * 3. Network issues shouldn't prevent bot deployment
 * 4. Version control - we know exactly what script version is deployed
 */

export interface StartupScript {
  name: string;
  description: string;
  usedByNodes: number[];
  critical: boolean;  // If true, deployment MUST fail if script can't be uploaded
  content: string;    // The actual Python script content
}

/**
 * HandleBotError - Global error handler (Node -500)
 * 
 * This is the MOST critical script. If it's missing or broken:
 * - Any unhandled exception triggers a transfer to live agent
 * - User sees "technical difficulties" immediately
 * - The bot appears completely broken
 */
const HANDLE_BOT_ERROR: StartupScript = {
  name: 'HandleBotError',
  description: 'Global error handler for bot session crashes. Catches all unhandled exceptions.',
  usedByNodes: [-500],
  critical: true,
  content: `# -*- coding: utf-8 -*-
r'''
    ______  ______  _____________________  _________    __  ___
   / __ \\ \\/ / __ \\/ ____/ ___/_  __/ __ \\/ ____/   |  /  |/  /
  / /_/ /\\  / /_/ / __/  \\__ \\ / / / /_/ / __/ / /| | / /|_/ /
 / ____/ / / ____/ /___ ___/ // / / _, _/ /___/ ___ |/ /  / /
/_/     /_/_/   /_____//____//_/ /_/ |_/_____/_/  |_/_/  /_/
action node script

HandleBotError - Global error handler for bot session crashes.
Catches all unhandled exceptions and routes to appropriate error nodes.

Decision Variable: error_type
What Next?: bot_error~99990|bot_timeout~99990|other~99990
'''


class HandleBotError:
    def execute(self, log, payload=None, context=None):
        try:
            log('HandleBotError triggered')
            
            # Get error details from context if available
            error_info = {}
            error_type = 'other'  # Default error type
            
            if context:
                if isinstance(context, dict):
                    error_info = context.get('error', {})
                    chat_id = context.get('chat_id', 'unknown')
                else:
                    error_info = getattr(context, 'error', {})
                    chat_id = getattr(context, 'chat_id', 'unknown')
            
            # Determine error type
            if error_info:
                error_message = str(error_info.get('message', ''))
                error_code = str(error_info.get('code', ''))
                
                if 'timeout' in error_message.lower() or 'timeout' in error_code.lower():
                    error_type = 'bot_timeout'
                elif error_message or error_code:
                    error_type = 'bot_error'
                else:
                    error_type = 'other'
            
            # Save error details for logging/debugging
            save_error_to = payload.get('save_error_to', 'PLATFORM_ERROR') if payload else 'PLATFORM_ERROR'
            error_details = f"Type: {error_type}, Info: {error_info}"
            
            log(f'HandleBotError: error_type={error_type}, details={error_details}')
            
            return {
                'success': 'true',
                'error_type': error_type,
                save_error_to: error_details
            }
            
        except Exception as err:
            import sys
            log(f'HandleBotError itself failed on line {sys.exc_info()[-1].tb_lineno}: {err}')
            return {
                'success': 'true',
                'error_type': 'other',
                'PLATFORM_ERROR': f'HandleBotError exception: {err}'
            }
`
};

/**
 * UserPlatformRouting - Device detection (Node 10)
 * 
 * Identifies if user is on iOS, Android, Mac, or Windows.
 * Routes to different nodes based on detected platform.
 */
const USER_PLATFORM_ROUTING: StartupScript = {
  name: 'UserPlatformRouting',
  description: 'Identifies user platform (iOS/Android/Mac/Windows) and routes accordingly.',
  usedByNodes: [10],
  critical: true,
  content: `# -*- coding: utf-8 -*-
r'''
    ______  ______  _____________________  _________    __  ___
   / __ \\ \\/ / __ \\/ ____/ ___/_  __/ __ \\/ ____/   |  /  |/  /
  / /_/ /\\  / /_/ / __/  \\__ \\ / / / /_/ / __/ / /| | / /|_/ /
 / ____/ / / ____/ /___ ___/ // / / _, _/ /___/ ___ |/ /  / /
/_/     /_/_/   /_____//____//_/ /_/ |_/_____/_/  |_/_/  /_/
action node script
Identify if the user is on iOS, Android, Mac, or Windows,
and based on the identified OS, route them to different destinations.

'''


class UserPlatformRouting:
    def execute(self, log, payload=None, context=None):
        try:
            platform = context['user_data']['platform']
            if 'iOS' in platform:
                success = 'ios'
            elif 'Android' in platform:
                success = 'android'
            elif 'Mac' in platform:
                success = 'mac'
            elif 'Windows' in platform:
                success = 'windows'
            else:
                success = 'other'

            return {'success': success}

        except Exception as err:
            log('UserPlatformRouting get Exception error: {}'.format(err))
            return {'success': 'error'}
`
};

/**
 * ValidateRegex - Input validation (used for email, phone, etc.)
 * 
 * Validates user input against a regex pattern.
 * Used by email input flows and other validation scenarios.
 */
const VALIDATE_REGEX: StartupScript = {
  name: 'ValidateRegex',
  description: 'Validates user input against a regex pattern for email, phone, etc.',
  usedByNodes: [],  // Used dynamically based on bot features
  critical: false,  // Not critical for startup, but commonly used
  content: `# -*- coding: utf-8 -*-
r'''
    ______  ______  _____________________  _________    __  ___
   / __ \\ \\/ / __ \\/ ____/ ___/_  __/ __ \\/ ____/   |  /  |/  /
  / /_/ /\\  / /_/ / __/  \\__ \\ / / / /_/ / __/ / /| | / /|_/ /
 / ____/ / / ____/ /___ ___/ // / / _, _/ /___/ ___ |/ /  / /
/_/     /_/_/   /_____//____//_/ /_/ |_/_____/_/  |_/_/  /_/
action node script

ValidateRegex - Validates input against a regex pattern.

Parameter Input: {"regex": "^[^@]+@[^@]+\\\\.[^@]+$", "input": "{LAST_USER_MESSAGE}"}
Decision Variable: success
What Next?: true~next|false~invalid|error~99990
'''

import re


class ValidateRegex:
    def execute(self, log, payload=None, context=None):
        try:
            if not payload:
                log('ValidateRegex: No payload provided')
                return {'success': 'false'}
            
            regex_pattern = payload.get('regex', '')
            input_value = payload.get('input', '')
            
            if not regex_pattern:
                log('ValidateRegex: No regex pattern provided')
                return {'success': 'false'}
            
            # Compile and match the regex
            pattern = re.compile(regex_pattern)
            match = pattern.match(str(input_value))
            
            if match:
                log(f'ValidateRegex: Input "{input_value}" matches pattern')
                return {'success': 'true', 'matched_value': input_value}
            else:
                log(f'ValidateRegex: Input "{input_value}" does not match pattern')
                return {'success': 'false'}
                
        except re.error as regex_err:
            log(f'ValidateRegex: Invalid regex pattern: {regex_err}')
            return {'success': 'error', 'error': str(regex_err)}
        except Exception as err:
            log(f'ValidateRegex: Exception: {err}')
            return {'success': 'error', 'error': str(err)}
`
};

/**
 * GenAIFallback - AI-powered intent understanding (Nodes 1800-1804)
 * 
 * Uses LLM to understand user intent, resolve pronouns (it, them, that),
 * and generate contextual responses before falling back to human escalation.
 * This enables intelligent NLU that handles follow-up questions like
 * "What ingredients are in them" after discussing a product.
 */
const GENAI_FALLBACK: StartupScript = {
  name: 'GenAIFallback',
  description: 'AI-powered intent understanding for intelligent NLU fallback. Resolves pronouns and context.',
  usedByNodes: [1800],
  critical: true,  // Critical for intelligent NLU - without it, contextual follow-ups fail
  content: `# -*- coding: utf-8 -*-
r'''
    ______  ______  _____________________  _________    __  ___
   / __ \\ \\/ / __ \\/ ____/ ___/_  __/ __ \\/ ____/   |  /  |/  /
  / /_/ /\\  / /_/ / __/  \\__ \\ / / / /_/ / __/ / /| | / /|_/ /
 / ____/ / / ____/ /___ ___/ // / / _, _/ /___/ ___ |/ /  / /
/_/     /_/_/   /_____//____//_/ /_/ |_/_____/_/  |_/_/  /_/
action node script

GenAIFallback - AI-powered intent understanding for out-of-scope queries.
Uses LLM to understand user intent, resolve pronouns (it, them, that), and 
generate contextual responses before falling back to human escalation.

Parameter Input:
{
    "question": "{LAST_USER_MESSAGE}",
    "context": "{LAST_TOPIC}",
    "entity": "{LAST_ENTITY}",
    "conversation_context": "{CONVERSATION_CONTEXT}",
    "company_name": "{COMPANY_NAME}",
    "company_context": "{COMPANY_CONTEXT}"
}

Decision Variable: result
What Next?: understood~1802|route_flow~1803|not_understood~1804|error~1804

Output Variables:
- AI_RESPONSE: Generated response text (when result=understood)
- DETECTED_INTENT: Detected intent keyword (when result=route_flow)
- CONFIDENCE: Confidence level (high/medium/low)
'''

import json
import openai

# Import Pypestream app module for API key access (same as GetGPTCompletion.py)
from .. import app


class GenAIFallback:
    
    # Common intent keywords for routing
    KNOWN_INTENTS = [
        'product', 'products', 'items', 'browse',
        'ingredients', 'nutrition', 'details', 'specs',
        'schedule', 'book', 'appointment', 'calendar',
        'pricing', 'cost', 'price', 'plans',
        'support', 'help', 'issue', 'problem',
        'order', 'orders', 'purchase', 'buy',
        'account', 'profile', 'settings',
        'contact', 'agent', 'human', 'representative'
    ]
    
    # Pronoun patterns that need context resolution
    PRONOUNS = ['it', 'them', 'that', 'this', 'those', 'these', 'the one', 'the ones']
    
    # Follow-up patterns that refer to previous context
    FOLLOWUP_PATTERNS = [
        'more', 'tell me more', 'more info', 'more details',
        'about it', 'about them', 'about that',
        'what about', 'how about', 'and',
        'also', 'additionally', 'furthermore'
    ]
    
    def execute(self, log, payload=None, context=None):
        try:
            log('GenAIFallback starting execution')
            
            # Get environment and try to set OpenAI API key (may not be configured)
            env = context.get('env', 'sandbox') if context else 'sandbox'
            self.has_openai = False
            try:
                api_key = app.PARAMS.get(env, {}).get('openai_api_key', '')
                if api_key:
                    openai.api_key = api_key
                    self.has_openai = True
                    log('GenAIFallback: OpenAI API key configured')
                else:
                    log('GenAIFallback: No OpenAI API key - using template fallback')
            except Exception as key_err:
                log(f'GenAIFallback: Could not get API key: {key_err}')
            
            # Extract parameters
            question = payload.get('question', '') if payload else ''
            topic_context = payload.get('context', '') if payload else ''
            entity = payload.get('entity', '') if payload else ''
            conversation_context = payload.get('conversation_context', '') if payload else ''
            company_name = payload.get('company_name', '') if payload else ''
            company_context = payload.get('company_context', '') if payload else ''
            
            # CRITICAL: If question is empty or just a variable reference, try to get from context
            # Pypestream provides the user's message in context when NLU triggers out_of_scope
            if not question or question.startswith('{') or question == 'LAST_USER_MESSAGE':
                if context:
                    question = (
                        context.get('user_message') or 
                        context.get('text') or 
                        context.get('message') or 
                        context.get('user_input') or
                        context.get('last_user_message') or
                        context.get('input_text') or
                        ''
                    )
                    if question:
                        log(f'GenAIFallback: Got user message from context: "{question[:50]}..."')
                    else:
                        log('GenAIFallback: Could not find user message in context')
            
            # Store for use in other methods
            self.company_name = company_name or 'our company'
            self.company_context = company_context
            
            log(f'GenAIFallback: question="{question}", company="{company_name}", env="{env}"')
            
            if not question:
                log('GenAIFallback: No question provided')
                return {
                    'success': 'true',
                    'result': 'not_understood',
                    'AI_RESPONSE': '',
                    'DETECTED_INTENT': '',
                    'CONFIDENCE': 'low'
                }
            
            # Step 1: Check for direct intent keywords first (fast path)
            detected_intent = self._detect_direct_intent(question.lower())
            if detected_intent:
                log(f'GenAIFallback: Direct intent detected: {detected_intent}')
                return {
                    'success': 'true',
                    'result': 'route_flow',
                    'AI_RESPONSE': '',
                    'DETECTED_INTENT': detected_intent,
                    'CONFIDENCE': 'high'
                }
            
            # Step 2: Check for pronoun/context references
            has_pronoun = self._has_pronoun_reference(question.lower())
            has_followup = self._has_followup_pattern(question.lower())
            
            if (has_pronoun or has_followup) and entity:
                # User is asking about the previous entity
                log(f'GenAIFallback: Contextual reference detected, entity="{entity}"')
                
                # Try to understand what they want to know about it
                detail_intent = self._detect_detail_intent(question.lower())
                if detail_intent:
                    return {
                        'success': 'true',
                        'result': 'route_flow',
                        'AI_RESPONSE': '',
                        'DETECTED_INTENT': detail_intent,
                        'CONFIDENCE': 'high'
                    }
                
                # Generate contextual response using AI
                ai_response = self._generate_ai_response(question, entity, topic_context, log)
                if ai_response:
                    return {
                        'success': 'true',
                        'result': 'understood',
                        'AI_RESPONSE': ai_response,
                        'DETECTED_INTENT': '',
                        'CONFIDENCE': 'medium'
                    }
            
            # Step 3: Try AI understanding as last resort
            ai_result = self._try_ai_understanding(question, entity, topic_context, conversation_context, log)
            if ai_result:
                return ai_result
            
            # Step 4: Try template response as fallback (when no OpenAI)
            template_response = self._generate_template_response(question, entity, topic_context)
            if template_response:
                log(f'GenAIFallback: Using template response')
                return {
                    'success': 'true',
                    'result': 'understood',
                    'AI_RESPONSE': template_response,
                    'DETECTED_INTENT': '',
                    'CONFIDENCE': 'low'
                }
            
            # Step 5: Could not understand
            log('GenAIFallback: Could not understand query')
            return {
                'success': 'true',
                'result': 'not_understood',
                'AI_RESPONSE': '',
                'DETECTED_INTENT': '',
                'CONFIDENCE': 'low'
            }
            
        except Exception as err:
            import sys
            log(f'GenAIFallback error on line {sys.exc_info()[-1].tb_lineno}: {err}')
            return {
                'success': 'error',
                'result': 'error',
                'AI_RESPONSE': '',
                'DETECTED_INTENT': '',
                'CONFIDENCE': 'low'
            }
    
    def _detect_direct_intent(self, question):
        """Check if question contains a direct intent keyword."""
        words = question.replace('?', '').replace('.', '').replace(',', '').split()
        for word in words:
            if word in self.KNOWN_INTENTS:
                return word
        return None
    
    def _has_pronoun_reference(self, question):
        """Check if question contains pronouns that need context resolution."""
        for pronoun in self.PRONOUNS:
            if pronoun in question:
                return True
        return False
    
    def _has_followup_pattern(self, question):
        """Check if question is a follow-up to previous context."""
        for pattern in self.FOLLOWUP_PATTERNS:
            if pattern in question:
                return True
        return False
    
    def _detect_detail_intent(self, question):
        """Detect what detail the user wants about the current entity."""
        detail_keywords = {
            'ingredients': ['ingredient', 'ingredients', 'made of', 'contain', 'contains', 'whats in'],
            'nutrition': ['nutrition', 'calories', 'fat', 'protein', 'carb', 'sugar', 'sodium', 'healthy'],
            'details': ['details', 'detail', 'more', 'info', 'information', 'tell me about', 'tell me more'],
            'specs': ['specs', 'specifications', 'features', 'size', 'dimensions', 'weight'],
            'pricing': ['price', 'cost', 'how much', 'pricing', 'expensive', 'cheap'],
            'availability': ['available', 'availability', 'in stock', 'buy', 'purchase', 'where can']
        }
        
        for intent, keywords in detail_keywords.items():
            for keyword in keywords:
                if keyword in question:
                    return intent
        return None
    
    def _generate_ai_response(self, question, entity, topic, log):
        """Generate a contextual AI response using OpenAI (if available) or template."""
        # If no OpenAI API key, use template response
        if not self.has_openai:
            log('GenAIFallback: Using template response (no OpenAI key)')
            return self._generate_template_response(question, entity, topic)
        
        try:
            system_prompt = f"You are a helpful customer service assistant for {self.company_name}."
            if self.company_context:
                system_prompt += f" Company info: {self.company_context}"
            
            user_prompt = f"""The customer was discussing "{entity}" in the context of "{topic}".

They asked: "{question}"

Provide a brief, helpful response (2-3 sentences max)."""

            # Use OpenAI ChatCompletion (same pattern as GetGPTCompletion.py)
            completion = openai.ChatCompletion.create(
                model='gpt-4o-mini',
                messages=[
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                max_tokens=150,
                temperature=0.7
            )
            
            if completion and 'choices' in completion and completion['choices']:
                ai_response = completion['choices'][0]['message']['content'].strip()
                log(f'GenAIFallback: AI response: {ai_response[:50]}...')
                return ai_response
                
            return self._generate_template_response(question, entity, topic)
                
        except Exception as err:
            log(f'GenAIFallback: AI generation error: {err}')
            return self._generate_template_response(question, entity, topic)
    
    def _generate_template_response(self, question, entity, topic):
        """Generate a template-based response when AI is unavailable."""
        question_lower = question.lower()
        
        # If we have entity context, provide entity-specific responses
        if entity:
            if any(word in question_lower for word in ['ingredient', 'made of', 'contain', 'whats in']):
                return f"For detailed ingredient information about {entity}, I'd recommend checking the product packaging or our website. Would you like me to help you find that information?"
            elif any(word in question_lower for word in ['nutrition', 'calories', 'healthy']):
                return f"For nutritional information about {entity}, you can find complete details on our website or product packaging. Would you like me to help with something else?"
            elif any(word in question_lower for word in ['price', 'cost', 'how much']):
                return f"Pricing for {entity} may vary by location and retailer. Would you like me to help you find a store near you?"
            elif any(word in question_lower for word in ['where', 'buy', 'purchase', 'available']):
                return f"You can find {entity} at most major retailers and grocery stores. Would you like help locating a store near you?"
            else:
                return f"Regarding {entity}, I'd be happy to help you learn more. What specific information are you looking for?"
        
        # No entity context - provide helpful generic responses based on question type
        if any(word in question_lower for word in ['when', 'release', 'out', 'available', 'coming']):
            return f"I'd be happy to help you find that information! Please check our main menu for the most up-to-date details, or I can connect you with someone who can help."
        elif any(word in question_lower for word in ['how', 'what', 'why', 'can you']):
            return f"That's a great question! Let me help you find the right information. Please select from the menu options, or I can connect you with a team member."
        elif any(word in question_lower for word in ['help', 'support', 'issue', 'problem']):
            return f"I'm here to help! Please tell me more about what you need, or select from the menu to get started."
        else:
            return f"I want to make sure I understand your question correctly. Could you please select from the menu options, or let me connect you with someone who can help?"
    
    def _try_ai_understanding(self, question, entity, topic, conversation_context, log):
        """Try to understand the query using AI classification (if OpenAI available)."""
        # If no OpenAI API key, return None to trigger fallback
        if not self.has_openai:
            log('GenAIFallback: Skipping AI understanding (no OpenAI key)')
            return None
        
        try:
            intents_list = ', '.join(self.KNOWN_INTENTS[:15])
            
            system_prompt = f"You are an intelligent assistant for {self.company_name}. Respond with valid JSON only."
            if self.company_context:
                system_prompt += f" Company info: {self.company_context}"
            
            user_prompt = f"""Analyze this customer query:

Previous context: {topic or 'None'}
Previous entity: {entity or 'None'}

Customer said: "{question}"

Respond with ONLY a JSON object:
{{
    "understood": true/false,
    "intent": "one of [{intents_list}] or 'unknown'",
    "resolved_entity": "what the customer is referring to",
    "response": "helpful response if understood",
    "confidence": "high/medium/low"
}}"""

            # Use OpenAI ChatCompletion (same pattern as GetGPTCompletion.py)
            completion = openai.ChatCompletion.create(
                model='gpt-4o-mini',
                messages=[
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                max_tokens=200,
                temperature=0.3
            )
            
            if completion and 'choices' in completion and completion['choices']:
                content = completion['choices'][0]['message']['content'].strip()
                
                # Parse JSON response
                try:
                    # Remove markdown code blocks if present
                    triple_tick = chr(96) + chr(96) + chr(96)
                    if content.startswith(triple_tick):
                        content = content.split(triple_tick)[1]
                        if content.startswith('json'):
                            content = content[4:]
                    
                    result = json.loads(content)
                    
                    if result.get('understood') and result.get('response'):
                        return {
                            'success': 'true',
                            'result': 'understood',
                            'AI_RESPONSE': result.get('response'),
                            'DETECTED_INTENT': result.get('intent', ''),
                            'CONFIDENCE': result.get('confidence', 'medium')
                        }
                    elif result.get('intent') in self.KNOWN_INTENTS:
                        return {
                            'success': 'true',
                            'result': 'route_flow',
                            'AI_RESPONSE': '',
                            'DETECTED_INTENT': result.get('intent'),
                            'CONFIDENCE': result.get('confidence', 'medium')
                        }
                except json.JSONDecodeError:
                    log(f'GenAIFallback: Failed to parse: {content[:50]}')
            
            return None
            
        except Exception as err:
            log(f'GenAIFallback: AI understanding error: {err}')
            return None
`
};

// ============================================
// EXPORTS
// ============================================

/**
 * All startup scripts that may be needed for bot deployment.
 * Order matters - critical scripts first.
 */
export const STARTUP_SCRIPTS: StartupScript[] = [
  HANDLE_BOT_ERROR,
  USER_PLATFORM_ROUTING,
  GENAI_FALLBACK,
  VALIDATE_REGEX,
];

/**
 * Scripts that are REQUIRED for every bot deployment.
 * These are used by the startup node templates.
 */
export const CRITICAL_STARTUP_SCRIPTS: StartupScript[] = STARTUP_SCRIPTS.filter(s => s.critical);

/**
 * Get a bundled script by name.
 * Returns the script content directly from this file - no network call needed.
 */
export function getBundledScript(name: string): StartupScript | undefined {
  return STARTUP_SCRIPTS.find(s => s.name === name);
}

/**
 * Get all bundled scripts as a Map for quick lookup.
 */
export function getBundledScriptsMap(): Map<string, StartupScript> {
  const map = new Map<string, StartupScript>();
  for (const script of STARTUP_SCRIPTS) {
    map.set(script.name, script);
  }
  return map;
}

/**
 * Get script content by name.
 * This is the primary function used during deployment.
 */
export function getScriptContent(name: string): string | undefined {
  const script = getBundledScript(name);
  return script?.content;
}

/**
 * Check if all critical scripts are available.
 * This should always return true since scripts are bundled.
 */
export function validateCriticalScripts(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  
  for (const script of CRITICAL_STARTUP_SCRIPTS) {
    if (!script.content || script.content.length < 100) {
      missing.push(script.name);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Log script registry info for debugging.
 */
export function logScriptRegistry(): void {
  console.log('[Script Registry] Bundled scripts:');
  for (const script of STARTUP_SCRIPTS) {
    const status = script.critical ? '⚠️ CRITICAL' : '📦 Optional';
    console.log(`  ${status} ${script.name} (${script.content.length} bytes) - ${script.description}`);
  }
}
