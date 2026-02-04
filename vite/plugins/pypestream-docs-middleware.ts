import type { Plugin, ViteDevServer } from 'vite'

/**
 * Pypestream Docs MCP Middleware
 * Connects to the Pypestream documentation MCP server for real-time doc queries
 */
export function pypestreamDocsMiddlewarePlugin(): Plugin {
  return {
    name: 'pypestream-docs-middleware',
    configureServer(server) {
      const PYPESTREAM_DOCS_BASE = 'https://pypestream-docs-mcp.fly.dev'
      const PYPESTREAM_DOCS_KEY = process.env.PYPESTREAM_DOCS_MCP_KEY || ''
      
      // SSE Connection state
      let sseSessionId: string | null = null
      let sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null
      let sseController: AbortController | null = null
      let isConnecting = false
      let isConnected = false
      
      // Pending requests
      const pendingRequests = new Map<number, {
        resolve: (value: any) => void
        reject: (error: Error) => void
        timeout: NodeJS.Timeout
      }>()
      
      // Available tools cache
      let availableTools: any[] = []
      let isInitialized = false
      
      // Parse SSE event data
      const parseSSEEvent = (eventText: string): { event?: string; data?: string } => {
        const result: { event?: string; data?: string } = {}
        const lines = eventText.split('\n')
        for (const line of lines) {
          if (line.startsWith('event:')) {
            result.event = line.substring(6).trim()
          } else if (line.startsWith('data:')) {
            result.data = line.substring(5).trim()
          }
        }
        return result
      }
      
      // Process incoming SSE messages
      const processSSEMessage = (eventText: string) => {
        const { event, data } = parseSSEEvent(eventText)
        
        if (event === 'endpoint' && data) {
          const match = data.match(/session_id=([a-f0-9]+)/)
          if (match) {
            sseSessionId = match[1]
            console.log(`[PypeDocs] SSE session established: ${sseSessionId.substring(0, 8)}...`)
          }
        } else if (event === 'message' && data) {
          try {
            const response = JSON.parse(data)
            console.log(`[PypeDocs] SSE message received: id=${response.id}, hasResult=${!!response.result}, hasError=${!!response.error}`)
            
            if (response.id !== undefined && pendingRequests.has(response.id)) {
              const pending = pendingRequests.get(response.id)!
              clearTimeout(pending.timeout)
              pendingRequests.delete(response.id)
              
              if (response.error) {
                pending.reject(new Error(response.error.message || JSON.stringify(response.error)))
              } else {
                pending.resolve(response.result)
              }
            }
          } catch (e) {
            console.log(`[PypeDocs] Failed to parse SSE message: ${data.substring(0, 100)}`)
          }
        }
      }
      
      // Start SSE listener loop
      const startSSEListener = async () => {
        const decoder = new TextDecoder()
        let buffer = ''
        
        console.log('[PypeDocs] SSE listener started')
        isConnected = true
        
        while (sseReader) {
          try {
            const { value, done } = await sseReader.read()
            if (done) {
              console.log('[PypeDocs] SSE stream ended')
              break
            }
            
            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk
            
            while (buffer.includes('\n\n') || buffer.includes('\r\n\r\n')) {
              let eventEnd = buffer.indexOf('\n\n')
              let skipLen = 2
              
              const crlfEnd = buffer.indexOf('\r\n\r\n')
              if (crlfEnd !== -1 && (eventEnd === -1 || crlfEnd < eventEnd)) {
                eventEnd = crlfEnd
                skipLen = 4
              }
              
              if (eventEnd === -1) break
              
              const eventText = buffer.substring(0, eventEnd)
              buffer = buffer.substring(eventEnd + skipLen)
              
              if (eventText.trim() && !eventText.startsWith(':')) {
                processSSEMessage(eventText)
              }
            }
          } catch (e: any) {
            if (e.name !== 'AbortError') {
              console.log(`[PypeDocs] SSE read error: ${e.message}`)
            }
            break
          }
        }
        
        isConnected = false
        sseSessionId = null
        console.log('[PypeDocs] SSE listener stopped')
      }
      
      // Connect to SSE server
      const connectSSE = async (): Promise<boolean> => {
        if (isConnected && sseSessionId) return true
        if (isConnecting) {
          for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 100))
            if (isConnected && sseSessionId) return true
          }
          return false
        }
        
        if (!PYPESTREAM_DOCS_KEY) {
          console.log('[PypeDocs] No API key configured')
          return false
        }
        
        isConnecting = true
        console.log('[PypeDocs] Connecting to SSE server...')
        
        try {
          if (sseController) sseController.abort()
          if (sseReader) await sseReader.cancel().catch(() => {})
          
          sseController = new AbortController()
          
          let fetchFn = fetch
          try {
            const { fetch: undiciFetch } = await import('undici')
            fetchFn = undiciFetch as typeof fetch
            console.log('[PypeDocs] Using undici fetch for SSE')
          } catch {
            console.log('[PypeDocs] Using native fetch for SSE')
          }
          
          const response = await fetchFn(`${PYPESTREAM_DOCS_BASE}/sse`, {
            headers: { 'X-API-Key': PYPESTREAM_DOCS_KEY },
            signal: sseController.signal
          })
          
          if (!response.ok) {
            console.log(`[PypeDocs] SSE connection failed: ${response.status}`)
            isConnecting = false
            return false
          }
          
          const body = response.body
          if (!body) {
            console.log('[PypeDocs] No response body')
            isConnecting = false
            return false
          }
          
          if (typeof body.getReader === 'function') {
            sseReader = body.getReader()
          } else {
            console.log('[PypeDocs] Converting Node stream to web stream')
            const { Readable } = await import('stream')
            const webStream = Readable.toWeb(body as any)
            sseReader = (webStream as ReadableStream<Uint8Array>).getReader()
          }
          
          if (!sseReader) {
            console.log('[PypeDocs] Could not get reader')
            isConnecting = false
            return false
          }
          
          startSSEListener()
          
          for (let i = 0; i < 100; i++) {
            await new Promise(r => setTimeout(r, 100))
            if (sseSessionId) {
              isConnecting = false
              return true
            }
          }
          
          console.log('[PypeDocs] Timeout waiting for session ID')
          isConnecting = false
          return false
        } catch (e: any) {
          console.log(`[PypeDocs] Connection error: ${e.message}`)
          isConnecting = false
          return false
        }
      }
      
      // Send JSON-RPC request
      const sendRequest = async (method: string, params: any = {}, timeoutMs: number = 30000): Promise<any> => {
        if (!await connectSSE()) {
          throw new Error('Failed to connect to MCP server')
        }
        
        const requestId = Date.now() + Math.floor(Math.random() * 1000)
        const messagesUrl = `${PYPESTREAM_DOCS_BASE}/messages/?session_id=${sseSessionId}`
        
        console.log(`[PypeDocs] Sending request: ${method} (id=${requestId})`)
        
        const responsePromise = new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            pendingRequests.delete(requestId)
            reject(new Error(`Request timeout: ${method}`))
          }, timeoutMs)
          
          pendingRequests.set(requestId, { resolve, reject, timeout })
        })
        
        const response = await fetch(messagesUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': PYPESTREAM_DOCS_KEY
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: requestId
          })
        })
        
        const responseText = await response.text()
        if (responseText !== 'Accepted') {
          console.log(`[PypeDocs] Unexpected response: ${responseText}`)
        }
        
        return responsePromise
      }
      
      // Initialize MCP connection
      const initializeMCP = async (): Promise<boolean> => {
        if (isInitialized) return true
        
        try {
          console.log('[PypeDocs] Initializing MCP connection...')
          const result = await sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'pypestream-solution-builder',
              version: '1.0.0'
            }
          })
          console.log(`[PypeDocs] Initialized: ${JSON.stringify(result).substring(0, 100)}`)
          isInitialized = true
          
          await sendRequest('notifications/initialized', {}).catch(() => {})
          
          return true
        } catch (e: any) {
          console.log(`[PypeDocs] Initialization failed: ${e.message}`)
          return false
        }
      }
      
      // List available tools
      const listTools = async (): Promise<any[]> => {
        if (availableTools.length > 0) return availableTools
        
        if (!await initializeMCP()) return []
        
        try {
          const result = await sendRequest('tools/list', {})
          availableTools = result?.tools || []
          console.log(`[PypeDocs] Available tools: ${availableTools.map((t: any) => t.name).join(', ')}`)
          return availableTools
        } catch (e: any) {
          console.log(`[PypeDocs] Failed to list tools: ${e.message}`)
          return []
        }
      }
      
      // Query Pypestream docs
      const queryPypestreamDocs = async (query: string, toolName?: string): Promise<string> => {
        try {
          if (!toolName) {
            const tools = await listTools()
            const searchTool = tools.find((t: any) => 
              t.name.toLowerCase().includes('search') || 
              t.name.toLowerCase().includes('query') ||
              t.name.toLowerCase().includes('find')
            )
            toolName = searchTool?.name || tools[0]?.name
            
            if (!toolName) {
              console.log('[PypeDocs] No tools available')
              return ''
            }
          }
          
          console.log(`[PypeDocs] Calling tool: ${toolName} with query: "${query}"`)
          
          const result = await sendRequest('tools/call', {
            name: toolName,
            arguments: { query }
          })
          
          if (result?.content) {
            if (Array.isArray(result.content)) {
              return result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
            }
            return typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
          }
          
          return JSON.stringify(result)
        } catch (e: any) {
          console.log(`[PypeDocs] Query failed: ${e.message}`)
          return ''
        }
      }
      
      // API endpoint
      server.middlewares.use('/api/pypestream-docs', async (req: any, res: any, next: any) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          res.statusCode = 200
          res.end()
          return
        }
        
        if (req.method !== 'POST' && req.method !== 'GET') { 
          next()
          return
        }
        
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', 'application/json')
        
        if (req.method === 'GET') {
          try {
            const tools = await listTools()
            res.end(JSON.stringify({ 
              connected: isConnected,
              sessionId: sseSessionId?.substring(0, 8),
              tools: tools.map((t: any) => ({ name: t.name, description: t.description }))
            }))
          } catch (error: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
          return
        }
        
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', async () => {
          try {
            const { query, tool } = JSON.parse(body)
            
            if (!query) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Query is required' }))
              return
            }
            
            const docs = await queryPypestreamDocs(query, tool)
            res.end(JSON.stringify({ 
              success: !!docs,
              query,
              tool,
              docs 
            }))
          } catch (error: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        })
      })
      
      // Export helpers for other middlewares
      ;(server as any).queryPypestreamDocs = queryPypestreamDocs
      ;(server as any).listPypestreamDocsTools = listTools
      
      // Auto-connect on startup
      if (PYPESTREAM_DOCS_KEY) {
        console.log('[PypeDocs] Middleware initialized - connecting to MCP server...')
        connectSSE().then(connected => {
          if (connected) listTools()
        })
      } else {
        console.log('[PypeDocs] Middleware initialized - no API key configured')
      }
    }
  }
}
