import type { Plugin } from 'vite'

/**
 * AI Edit Middleware
 * Handles natural language edit requests for bot CSVs
 */
export function aiEditMiddlewarePlugin(): Plugin {
  return {
    name: 'ai-edit-middleware',
    async configureServer(server) {
      server.middlewares.use('/api/ai/generate', async (req, res, next) => {
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
            const { type, prompt, currentCsv, currentScripts } = JSON.parse(body)
            
            // Only handle 'edit' type requests here
            if (type !== 'edit') {
              next()
              return
            }
            
            const apiKey = process.env.ANTHROPIC_API_KEY
            
            if (!apiKey || apiKey === 'your-api-key-here') {
              console.log('[AI Edit] No API key configured')
              res.statusCode = 503
              res.end(JSON.stringify({ 
                success: false,
                error: 'ANTHROPIC_API_KEY not configured'
              }))
              return
            }
            
            console.log('[AI Edit] Processing edit request')
            console.log('[AI Edit] Prompt:', prompt.substring(0, 200) + '...')
            
            const systemPrompt = `You are an expert Pypestream bot editor. Your job is to modify bot CSV files based on natural language instructions.

## CSV FORMAT
The bot CSV has these columns (in order):
Node Number, Node Type, Node Name, Intent, Entity Type, Entity, NLU Disabled?, Next Nodes, Message, Rich Asset Type, Rich Asset Content, Answer Required?, Behaviors, Command, Description, Output, Node Input, Parameter Input, Decision Variable, What Next?, Node Tags, Skill Tag, Variable, Platform Flag, Flows, CSS Classname

## NODE TYPES
- D = Decision Node (user-facing messages, buttons, inputs)
- A = Action Node (backend scripts, API calls, variable assignment)

## EDITING RULES
1. Make MINIMAL changes to fulfill the request
2. PRESERVE existing node numbers - don't renumber unless absolutely necessary
3. When adding new nodes, use the next available number in the appropriate range
4. Keep all formatting consistent with the original CSV
5. Maintain all existing rich asset formats (buttons, listpicker, etc.)

## RESPONSE FORMAT
You MUST respond with a JSON object containing:
{
  "csv": "the complete modified CSV content",
  "summary": "brief description of changes made",
  "affectedNodes": [array of modified node numbers],
  "scripts": [] // if any scripts were modified
}

RESPOND WITH JSON ONLY. No markdown, no explanation.`

            const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 16000,
                messages: [
                  { 
                    role: 'user', 
                    content: `${prompt}

## CURRENT CSV
\`\`\`csv
${currentCsv}
\`\`\`

## CURRENT SCRIPTS (${currentScripts?.length || 0})
${currentScripts?.map((s: any) => `- ${s.name}`).join('\n') || 'None'}

Apply the requested changes and return the complete modified CSV.` 
                  }
                ],
                system: systemPrompt
              })
            })
            
            if (!response.ok) {
              const errorText = await response.text()
              console.error('[AI Edit] Claude API error:', response.status, errorText)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ 
                success: false,
                error: `Claude API error: ${response.status}`
              }))
              return
            }
            
            const result = await response.json()
            const content = result.content?.[0]?.text || ''
            
            console.log('[AI Edit] Response received, length:', content.length)
            
            let editResult
            try {
              // Try to parse JSON from the response
              let jsonStr = content.trim()
              
              // Check for markdown code block
              const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
              if (jsonMatch) {
                jsonStr = jsonMatch[1].trim()
              }
              
              // Try to find raw JSON object
              const rawJsonMatch = content.match(/\{[\s\S]*\}/)
              if (rawJsonMatch) {
                jsonStr = rawJsonMatch[0]
              }
              
              editResult = JSON.parse(jsonStr)
              editResult.success = true
              
              console.log('[AI Edit] Changes:', editResult.summary)
              console.log('[AI Edit] Affected nodes:', editResult.affectedNodes)
              
            } catch (parseError) {
              console.error('[AI Edit] Failed to parse response:', parseError)
              
              // Try to extract CSV directly if JSON parsing fails
              const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
              if (csvMatch) {
                editResult = {
                  success: true,
                  csv: csvMatch[1].trim(),
                  summary: 'Changes applied',
                  affectedNodes: [],
                  scripts: currentScripts
                }
              } else {
                editResult = {
                  success: false,
                  error: 'Failed to parse AI response'
                }
              }
            }
            
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(editResult))
            
          } catch (e: any) {
            console.error('[AI Edit] Error:', e)
            res.statusCode = 500
            res.end(JSON.stringify({ 
              success: false, 
              error: e.message || String(e) 
            }))
          }
        })
      })
    }
  }
}
