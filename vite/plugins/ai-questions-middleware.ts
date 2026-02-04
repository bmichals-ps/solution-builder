import type { Plugin } from 'vite'

/**
 * AI Requirements Questions Middleware
 * Generates customized multiple-choice questions for bot configuration
 */
export function aiQuestionsMiddlewarePlugin(): Plugin {
  return {
    name: 'ai-requirements-questions-middleware',
    async configureServer(server) {
      server.middlewares.use('/api/generate-requirements', async (req, res, next) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        
        if (req.method === 'OPTIONS') {
          res.statusCode = 200
          res.end()
          return
        }
        
        if (req.method !== 'POST') {
          next()
          return
        }
        
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          try {
            const { projectConfig } = JSON.parse(body)
            const apiKey = process.env.ANTHROPIC_API_KEY
            
            if (!apiKey || apiKey === 'your-api-key-here') {
              console.log('[AI Requirements] No API key, using fallback questions')
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ 
                questions: generateFallbackQuestions(projectConfig)
              }))
              return
            }
            
            console.log('[AI Requirements] Generating questions for:', projectConfig?.projectName)
            
            const systemPrompt = `You are an expert Pypestream chatbot designer. Generate highly customized multiple-choice questions with PROJECT-SPECIFIC answer options.

## CRITICAL: CUSTOMIZE EVERYTHING TO THIS SPECIFIC PROJECT
Both the QUESTIONS and the ANSWER OPTIONS must be tailored to the exact project being built. 

WRONG (generic):
- Question: "What data should be collected?"
- Options: ["Name", "Email", "Phone", "Address"]

RIGHT (project-specific for a water damage claim bot):
- Question: "What details about the water damage should be collected?"
- Options: [
    "Source of water (pipe burst, appliance leak, storm flooding, etc.)",
    "Affected areas (basement, kitchen, bathroom, multiple rooms)",
    "Duration of exposure (just happened, hours, days)",
    "Type of flooring/materials affected (hardwood, carpet, drywall)"
  ]

## GENERATE 10-14 QUESTIONS COVERING:

1. **Opening Experience** - How should THIS bot greet users for THIS use case?
2. **Primary Flow** - What are the specific steps for THIS bot's main journey?
3. **Data Fields** - What SPECIFIC information does THIS type of request need?
4. **Validation Rules** - What format/validation rules apply to THIS data?
5. **Decision Points** - What routing decisions are unique to THIS flow?
6. **Documentation** - What files/photos/evidence does THIS process need?
7. **Urgency/Priority** - How does THIS use case handle urgency levels?
8. **Escalation Triggers** - What specific situations in THIS flow need a human?
9. **Confirmation/Summary** - What should be confirmed back to the user?
10. **Completion & Next Steps** - What happens after THIS request is submitted?

## ANSWER OPTION REQUIREMENTS
- Each option must be SPECIFIC to this project (no generic "Option A" labels)
- Include realistic examples in the description (actual sample values/text)
- Options should represent meaningfully different choices, not just variations
- Use terminology appropriate to this industry/domain

## OUTPUT FORMAT
Return a JSON array:
[
  {
    "id": "q1",
    "category": "opening",
    "question": "Project-specific question text?",
    "options": [
      {"id": "a", "label": "Specific choice", "description": "Example: 'Hi! I'm here to help with your [specific thing]...'"},
      {"id": "b", "label": "Different specific choice", "description": "Example: 'Welcome to [Company]. Let's get started with...'"}
    ],
    "allowMultiple": false
  }
]

Set allowMultiple: true when users might want multiple options (e.g., "Which damage types?" or "What features to include?").

Return ONLY valid JSON array. No markdown, no explanation.`

            const description = projectConfig?.description || ''
            const projectType = projectConfig?.projectType || 'custom'
            const clientName = projectConfig?.clientName || 'Unknown Client'
            const projectName = projectConfig?.projectName || 'Unknown Project'
            
            const userPrompt = `Generate highly customized requirements questions for this specific chatbot:

## PROJECT DETAILS
- **Client:** ${clientName}
- **Project Name:** ${projectName}
- **Type:** ${projectType}
- **Full Description:** ${description}

## YOUR TASK
Generate 10-14 multiple-choice questions where BOTH the questions AND the answer options are specifically tailored to building a ${projectType} chatbot for ${clientName}.

For example, if this is a water damage claims bot:
- Don't ask "What info to collect?" with generic options
- DO ask "What details about the water damage incident should be captured?" with options like "Source of leak", "Affected rooms", "Water exposure duration", etc.

Every question and every answer option should feel like it was written specifically for THIS project, not copied from a template.

Make the answer options realistic and include example text/values in the descriptions where helpful.`

            const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4000,
                messages: [
                  { role: 'user', content: userPrompt }
                ],
                system: systemPrompt
              })
            })
            
            if (!response.ok) {
              const errorText = await response.text()
              console.error('[AI Requirements] Claude API error:', response.status, errorText)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ 
                questions: generateFallbackQuestions(projectConfig)
              }))
              return
            }
            
            const result = await response.json()
            const content = result.content?.[0]?.text || ''
            
            console.log('[AI Requirements] Raw response length:', content.length)
            
            let questions
            try {
              let jsonStr = content.trim()
              const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
              if (jsonMatch) {
                jsonStr = jsonMatch[1].trim()
              }
              const arrayMatch = content.match(/\[[\s\S]*\]/)
              if (arrayMatch) {
                jsonStr = arrayMatch[0]
              }
              
              questions = JSON.parse(jsonStr)
              console.log('[AI Requirements] Parsed', questions.length, 'questions')
            } catch (parseError) {
              console.error('[AI Requirements] Parse error:', parseError)
              questions = generateFallbackQuestions(projectConfig)
            }
            
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ questions }))
            
          } catch (e: any) {
            console.error('[AI Requirements] Error:', e)
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message || String(e) }))
          }
        })
      })
    }
  }
}

// Helper function for fallback questions
function generateFallbackQuestions(projectConfig: any) {
  const projectType = projectConfig?.projectType || 'custom'
  const clientName = projectConfig?.clientName || 'Your Company'
  const projectName = projectConfig?.projectName || 'Chatbot'
  const description = (projectConfig?.description || '').toLowerCase()
  
  const hasWaterDamage = description.includes('water') && description.includes('damage')
  const hasInsurance = description.includes('insurance') || description.includes('claim')
  const hasAuto = description.includes('auto') || description.includes('car') || description.includes('vehicle')
  const hasScheduling = description.includes('schedule') || description.includes('appointment') || description.includes('book')
  const hasLeads = description.includes('lead') || description.includes('sales')
  
  const questions: any[] = []
  
  // Q1: Greeting
  questions.push({
    id: 'q1',
    category: 'greeting',
    question: `How should the ${projectName} greet users?`,
    options: hasInsurance ? [
      { id: 'a', label: 'Empathetic & supportive', description: `"I'm sorry to hear about your situation. Let me help you file a claim quickly."` },
      { id: 'b', label: 'Professional & efficient', description: `"Welcome to ${clientName} Claims. I'll guide you through the process."` },
      { id: 'c', label: 'Reassuring & informative', description: `"You're in good hands. Let's get your claim started - it only takes a few minutes."` },
      { id: 'd', label: 'Direct & action-oriented', description: `"Ready to file a claim? Let's begin."` }
    ] : [
      { id: 'a', label: 'Friendly & welcoming', description: `"Hi! I'm the ${clientName} assistant. How can I help you today?"` },
      { id: 'b', label: 'Professional & helpful', description: `"Welcome to ${clientName}. I'm here to assist you."` },
      { id: 'c', label: 'Efficient & direct', description: `"What can I help you with?"` },
      { id: 'd', label: 'Personalized with name', description: `"Hi [Name]! Good to see you. What brings you here today?"` }
    ],
    allowMultiple: false
  })
  
  // Q2: Main flow entry
  if (hasWaterDamage) {
    questions.push({
      id: 'q2',
      category: 'flow',
      question: 'How should users describe the damage incident?',
      options: [
        { id: 'a', label: 'Guided step-by-step', description: 'Ask about source, location, severity one at a time' },
        { id: 'b', label: 'Category selection first', description: 'Pick damage type (flood, leak, burst pipe) then details' },
        { id: 'c', label: 'Open description + AI analysis', description: 'Let them describe freely, extract details with AI' },
        { id: 'd', label: 'Visual selection with photos', description: 'Show example images to identify damage type' }
      ],
      allowMultiple: false
    })
    
    questions.push({
      id: 'q3',
      category: 'data',
      question: 'What water damage details are most important to capture?',
      options: [
        { id: 'a', label: 'Source of water', description: 'Pipe burst, appliance leak, roof leak, flooding' },
        { id: 'b', label: 'Affected areas', description: 'Which rooms, floors, square footage' },
        { id: 'c', label: 'Duration of exposure', description: 'When discovered, how long water was present' },
        { id: 'd', label: 'Mitigation steps taken', description: 'What has the policyholder already done' },
        { id: 'e', label: 'Current urgency', description: 'Is water still flowing? Safety concerns?' }
      ],
      allowMultiple: true
    })
  } else if (hasScheduling) {
    questions.push({
      id: 'q2',
      category: 'flow',
      question: 'How should appointment scheduling work?',
      options: [
        { id: 'a', label: 'Show available slots', description: 'Display calendar with open times' },
        { id: 'b', label: 'Preference collection', description: 'Ask preferred date/time, confirm availability' },
        { id: 'c', label: 'Immediate booking', description: 'Book first available slot automatically' },
        { id: 'd', label: 'Waitlist option', description: 'Join waitlist if preferred time unavailable' }
      ],
      allowMultiple: false
    })
  } else {
    questions.push({
      id: 'q2',
      category: 'navigation',
      question: `What's the main action users want to take with ${projectName}?`,
      options: [
        { id: 'a', label: 'Get information', description: 'Answer questions, provide details' },
        { id: 'b', label: 'Submit a request', description: 'Fill out forms, start a process' },
        { id: 'c', label: 'Get support', description: 'Troubleshoot issues, resolve problems' },
        { id: 'd', label: 'Make a transaction', description: 'Purchase, schedule, or book something' }
      ],
      allowMultiple: false
    })
  }
  
  // Error handling
  questions.push({
    id: 'q_errors',
    category: 'errors',
    question: 'When a user provides invalid or unclear input, what should happen?',
    options: [
      { id: 'a', label: 'Show example & retry', description: '"Please enter in this format: XXX-XXX-XXXX"' },
      { id: 'b', label: 'Offer alternatives', description: 'Suggest valid options they can click' },
      { id: 'c', label: 'Allow skip', description: 'Let them skip optional fields' },
      { id: 'd', label: 'Transfer to agent', description: 'After 2 failed attempts, offer human help' }
    ],
    allowMultiple: true
  })
  
  // Escalation
  questions.push({
    id: 'q_escalation',
    category: 'escalation',
    question: hasInsurance
      ? 'When should a claim be escalated to a human adjuster?'
      : 'When should users be transferred to a live agent?',
    options: hasInsurance ? [
      { id: 'a', label: 'High-value claims', description: 'Claims over a certain threshold' },
      { id: 'b', label: 'Complex situations', description: 'Multiple damages, liability issues, injuries' },
      { id: 'c', label: 'User frustration', description: 'When errors pile up or user requests it' },
      { id: 'd', label: 'Always offer option', description: 'Human help available throughout' }
    ] : [
      { id: 'a', label: 'User requests it', description: 'Only when they explicitly ask for human' },
      { id: 'b', label: 'After repeated errors', description: "When bot can't help after 2-3 tries" },
      { id: 'c', label: 'For complex issues', description: 'Route certain categories to agents' },
      { id: 'd', label: 'Always visible', description: 'Agent button available on every screen' }
    ],
    allowMultiple: true
  })
  
  // Completion
  questions.push({
    id: 'q_completion',
    category: 'completion',
    question: hasInsurance
      ? 'What should happen when the claim is submitted?'
      : `What should happen when the user completes their request?`,
    options: hasInsurance ? [
      { id: 'a', label: 'Claim number + timeline', description: 'Show claim #, expected response time' },
      { id: 'b', label: 'Email confirmation', description: 'Send detailed summary to email' },
      { id: 'c', label: 'Next steps guide', description: 'Explain what happens next, what to expect' },
      { id: 'd', label: 'Schedule adjuster', description: 'Book inspection appointment before closing' }
    ] : [
      { id: 'a', label: 'Confirmation + reference', description: 'Show success message with reference number' },
      { id: 'b', label: 'Email summary', description: 'Send confirmation to their email' },
      { id: 'c', label: 'Offer additional help', description: 'Ask if they need anything else' },
      { id: 'd', label: 'Quick survey', description: 'Ask for feedback rating before closing' }
    ],
    allowMultiple: true
  })
  
  // Features
  questions.push({
    id: 'q_features',
    category: 'features',
    question: `Which features should the ${projectName} include?`,
    options: [
      { id: 'a', label: 'File uploads', description: 'Let users attach documents or photos' },
      { id: 'b', label: 'Date/time picker', description: 'Calendar widget for scheduling' },
      { id: 'c', label: 'Rich forms (webview)', description: 'Complex data entry in a form' },
      { id: 'd', label: 'Carousels', description: 'Swipeable cards for browsing options' },
      { id: 'e', label: 'Quick replies', description: 'Tap-to-respond button chips' }
    ],
    allowMultiple: true
  })
  
  // Language
  questions.push({
    id: 'q_language',
    category: 'language',
    question: 'What language support is needed?',
    options: [
      { id: 'a', label: 'English only', description: 'Single language experience' },
      { id: 'b', label: 'English + Spanish', description: 'Bilingual with language selection at start' },
      { id: 'c', label: 'Multiple languages', description: 'Support for 3+ languages' },
      { id: 'd', label: 'Auto-detect', description: 'Detect from browser/input and switch automatically' }
    ],
    allowMultiple: false
  })
  
  return questions
}
