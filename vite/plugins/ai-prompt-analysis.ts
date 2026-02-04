import type { Plugin } from 'vite'

/**
 * AI Prompt Analysis Middleware
 * Extracts project details from natural language descriptions
 */
export function aiPromptAnalysisPlugin(): Plugin {
  return {
    name: 'ai-prompt-analysis-middleware',
    async configureServer(server) {
      server.middlewares.use('/api/analyze-prompt', async (req, res, next) => {
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
            const { prompt } = JSON.parse(body)
            const apiKey = process.env.ANTHROPIC_API_KEY
            
            if (!apiKey || apiKey === 'your-api-key-here') {
              console.log('[AI Analyze] No API key configured')
              res.statusCode = 503
              res.end(JSON.stringify({ 
                error: 'ANTHROPIC_API_KEY not configured',
                useLocalFallback: true
              }))
              return
            }
            
            console.log('[AI Analyze] Analyzing prompt:', prompt.substring(0, 100) + '...')
            
            const systemPrompt = `You are an expert at extracting project details from natural language descriptions for Pypestream chatbot projects.

Your job is to analyze a user's description and extract/infer ALL of the following fields. You MUST provide a value for EVERY field.

## FIELDS TO EXTRACT

1. **clientName**: ALWAYS set to "CX" - this is a fixed organizational value.

2. **targetCompany**: The actual company or brand name being built for.
   - Extract ONLY the company/brand name — NOT "X customers", "X users", etc.
   - Strip trailing words like: customers, users, clients, members, patients, employees
   - Keep spaces and proper casing (e.g., "Travelers Insurance", "WeWork")

3. **projectName**: The project name in PascalCase (no spaces).
   - Examples: "ClaimsFNOL", "CustomerSupport", "LeadCapture"

4. **projectType**: One of: "claims", "support", "sales", "faq", "survey", "custom"

5. **description**: A cleaned-up, structured version of their input.

ALWAYS respond with valid JSON only. No markdown, no explanation.`

            const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                messages: [
                  { role: 'user', content: `Extract project details from this description:\n\n"${prompt}"` }
                ],
                system: systemPrompt
              })
            })
            
            if (!response.ok) {
              const errorText = await response.text()
              console.error('[AI Analyze] Claude API error:', response.status, errorText)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ 
                clientName: '',
                projectName: '',
                projectType: 'custom',
                description: prompt
              }))
              return
            }
            
            const result = await response.json()
            const content = result.content?.[0]?.text || ''
            
            console.log('[AI Analyze] Raw response:', content)
            
            let extractedDetails
            try {
              let jsonStr = content.trim()
              const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
              if (jsonMatch) {
                jsonStr = jsonMatch[1].trim()
              }
              const rawJsonMatch = content.match(/\{[\s\S]*\}/)
              if (rawJsonMatch) {
                jsonStr = rawJsonMatch[0]
              }
              
              extractedDetails = JSON.parse(jsonStr)
              console.log('[AI Analyze] Extracted:', extractedDetails)
            } catch (parseError) {
              console.error('[AI Analyze] Failed to parse:', parseError)
              extractedDetails = {
                clientName: '',
                projectName: '',
                projectType: 'custom',
                description: prompt
              }
            }
            
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(extractedDetails))
            
          } catch (e: any) {
            console.error('[AI Analyze] Error:', e)
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message || String(e) }))
          }
        })
      })
    }
  }
}
