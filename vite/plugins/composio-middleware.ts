import type { Plugin } from 'vite'

// Map our integration IDs to Composio toolkit slugs
const TOOLKIT_SLUGS: Record<string, string> = {
  'google-sheets': 'googlesheets',
  'figma': 'figma',
  'github': 'github',
  'google-drive': 'googledrive',
}

/**
 * Composio API Middleware Plugin
 * Handles OAuth connections and file operations for third-party integrations
 */
export function composioMiddlewarePlugin(): Plugin {
  return {
    name: 'composio-api-middleware',
    async configureServer(server) {
      // Dynamically import Composio SDK (ES module)
      let Composio: any = null
      let composioClient: any = null
      
      // Cache for auth config IDs (toolkit slug -> auth config id)
      const authConfigCache: Record<string, string> = {}
      
      const initComposio = async () => {
        if (composioClient) return composioClient
        
        const apiKey = process.env.VITE_COMPOSIO_API_KEY
        if (!apiKey) return null
        
        try {
          const module = await import('@composio/core')
          Composio = module.Composio
          composioClient = new Composio({ apiKey })
          console.log('[Composio] SDK initialized')
          return composioClient
        } catch (e) {
          console.error('[Composio] Failed to init SDK:', e)
          return null
        }
      }
      
      // Get or create an auth config for a toolkit
      const getOrCreateAuthConfig = async (toolkitSlug: string): Promise<string> => {
        // Check cache first
        if (authConfigCache[toolkitSlug]) {
          return authConfigCache[toolkitSlug]
        }
        
        const apiKey = process.env.VITE_COMPOSIO_API_KEY
        if (!apiKey) throw new Error('API key not configured')
        
        // First, try to list existing auth configs for this toolkit
        console.log(`[Composio] Looking for existing auth config for ${toolkitSlug}...`)
        
        const listResponse = await fetch(
          `https://backend.composio.dev/api/v3/auth_configs?toolkit_slugs=${toolkitSlug}`,
          {
            headers: { 'x-api-key': apiKey },
          }
        )
        
        console.log(`[Composio] List response status: ${listResponse.status}`)
        
        if (listResponse.ok) {
          const listData = await listResponse.json()
          const configs = listData.items || listData.data || listData
          
          if (Array.isArray(configs) && configs.length > 0) {
            // Find the config that matches our toolkit slug
            const matchingConfig = configs.find((c: any) => 
              c.toolkit?.slug === toolkitSlug || 
              c.toolkit?.slug?.toLowerCase() === toolkitSlug.toLowerCase()
            )
            
            if (matchingConfig) {
              const configId = matchingConfig.id || matchingConfig.auth_config_id || matchingConfig.auth_config?.id
              console.log(`[Composio] Found matching auth config for ${toolkitSlug}: ${configId}`)
              authConfigCache[toolkitSlug] = configId
              return configId
            } else {
              console.log(`[Composio] No matching config found for ${toolkitSlug} in ${configs.length} configs`)
            }
          }
        }
        
        // No existing config, create a new one with Composio's managed auth
        console.log(`[Composio] Creating new auth config for ${toolkitSlug}...`)
        
        const createResponse = await fetch(
          'https://backend.composio.dev/api/v3/auth_configs',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify({
              toolkit: { slug: toolkitSlug }
            }),
          }
        )
        
        const createData = await createResponse.json()
        console.log(`[Composio] Create response status: ${createResponse.status}`, JSON.stringify(createData, null, 2))
        
        if (!createResponse.ok) {
          console.error('[Composio] Failed to create auth config:', createData)
          throw new Error(createData.message || createData.error || `Failed to create auth config for ${toolkitSlug}`)
        }
        
        // The response has auth_config nested
        const configId = createData.auth_config?.id || createData.id || createData.auth_config_id
        console.log(`[Composio] Created auth config: ${configId}`)
        
        authConfigCache[toolkitSlug] = configId
        return configId
      }

      // Helper to check if Composio response indicates success
      const isComposioSuccess = (result: any): boolean => {
        if (result.error) return false
        if (result.data?.error) return false
        if (result.data?.message?.includes('Invalid')) return false
        if (result.data?.message?.includes('missing')) return false
        if (result.successful === true || result.successfull === true) return true
        if (result.data?.response_data?.updatedCells) return true
        if (result.data?.response_data?.updatedRows) return true
        if (result.data?.spreadsheet) return true
        return !result.error
      }

      // Parse CSV properly handling multi-line values
      const parseCSVToRows = (csv: string): string[] => {
        const rows: string[] = []
        let currentRow = ''
        let inQuotes = false
        
        for (let i = 0; i < csv.length; i++) {
          const char = csv[i]
          
          if (char === '"') {
            currentRow += char
            if (inQuotes && csv[i + 1] === '"') {
              currentRow += '"'
              i++
            } else {
              inQuotes = !inQuotes
            }
          } else if (char === '\n' && !inQuotes) {
            if (currentRow.trim()) {
              rows.push(currentRow)
            }
            currentRow = ''
          } else {
            currentRow += char
          }
        }
        
        if (currentRow.trim()) {
          rows.push(currentRow)
        }
        
        return rows
      }

      // Parse CSV line handling quoted fields
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = []
        let current = ''
        let inQuotes = false
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i]
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              current += '"'
              i++
            } else {
              inQuotes = !inQuotes
            }
          } else if (char === ',' && !inQuotes) {
            result.push(current)
            current = ''
          } else {
            current += char
          }
        }
        result.push(current)
        return result
      }
      
      server.middlewares.use('/api/composio', async (req, res, next) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        
        if (req.method === 'OPTIONS') {
          res.statusCode = 200
          res.end()
          return
        }
        
        try {
          // POST /api/composio/connect - Initiate OAuth connection
          if (req.method === 'POST' && req.url === '/connect') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', async () => {
              try {
                const { integrationId, userId, redirectUrl } = JSON.parse(body)
                
                const client = await initComposio()
                if (!client) {
                  res.statusCode = 500
                  res.end(JSON.stringify({ 
                    error: 'VITE_COMPOSIO_API_KEY not set in .env file' 
                  }))
                  return
                }
                
                const toolkitSlug = TOOLKIT_SLUGS[integrationId] || integrationId
                console.log(`[Composio] Connecting ${integrationId} (toolkit: ${toolkitSlug})`)
                
                const authConfigId = await getOrCreateAuthConfig(toolkitSlug)
                console.log('[Composio] Creating link with auth config:', authConfigId)
                
                const connectionRequest = await client.connectedAccounts.link(
                  userId || `user_${Date.now()}`,
                  authConfigId,
                  { callbackUrl: redirectUrl }
                )
                
                console.log('[Composio] Connection request created:', connectionRequest.id)
                
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({
                  redirectUrl: connectionRequest.redirectUrl,
                  connectionId: connectionRequest.id,
                }))
              } catch (e: any) {
                console.error('[Composio] Error:', e)
                res.statusCode = 500
                res.end(JSON.stringify({ error: e.message || String(e) }))
              }
            })
            return
          }
          
          // GET /api/composio/status/:id - Check connection status
          if (req.method === 'GET' && req.url?.startsWith('/status/')) {
            const connectionId = req.url.replace('/status/', '')
            
            const client = await initComposio()
            if (!client) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: 'API key not configured' }))
              return
            }
            
            try {
              const account = await client.connectedAccounts.get(connectionId)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                status: account.status,
                connectionId: account.id,
              }))
            } catch (e: any) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Connection not found' }))
            }
            return
          }
          
          // POST /api/composio/files - List files from connected account
          if (req.method === 'POST' && req.url === '/files') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', async () => {
              try {
                const { integrationId, userId } = JSON.parse(body)
                const apiKey = process.env.VITE_COMPOSIO_API_KEY
                
                if (!apiKey) {
                  res.statusCode = 500
                  res.end(JSON.stringify({ error: 'API key not configured' }))
                  return
                }
                
                const toolkitSlug = TOOLKIT_SLUGS[integrationId] || integrationId
                console.log(`[Composio] Fetching files for ${toolkitSlug}, user: ${userId}`)
                
                const accountsResponse = await fetch(
                  `https://backend.composio.dev/api/v1/connectedAccounts?user_uuid=${encodeURIComponent(userId)}&showActiveOnly=true`,
                  { headers: { 'x-api-key': apiKey } }
                )
                
                if (!accountsResponse.ok) {
                  console.log('[Composio] Failed to fetch connected accounts:', accountsResponse.status)
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ files: [], error: 'Failed to fetch accounts' }))
                  return
                }
                
                const accountsData = await accountsResponse.json()
                const accounts = accountsData.items || accountsData
                
                const connectedAccount = accounts.find((acc: any) => 
                  acc.appName?.toLowerCase() === toolkitSlug.toLowerCase() ||
                  acc.appUniqueId?.toLowerCase().includes(toolkitSlug.toLowerCase())
                )
                
                if (!connectedAccount) {
                  console.log('[Composio] No connected account found for', toolkitSlug)
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ files: [], error: 'No connected account found' }))
                  return
                }
                
                console.log(`[Composio] Found connected account: ${connectedAccount.id}`)
                
                let files: any[] = []
                
                if (toolkitSlug === 'googlesheets') {
                  try {
                    const executeResponse = await fetch(
                      'https://backend.composio.dev/api/v2/actions/GOOGLEDRIVE_LIST_FILES/execute',
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'x-api-key': apiKey
                        },
                        body: JSON.stringify({
                          connectedAccountId: connectedAccount.id,
                          input: {
                            q: "mimeType='application/vnd.google-apps.spreadsheet'",
                            pageSize: 50
                          }
                        })
                      }
                    )
                    
                    if (executeResponse.ok) {
                      const result = await executeResponse.json()
                      console.log('[Composio] Drive response:', JSON.stringify(result, null, 2).substring(0, 500))
                      
                      const filesList = result.data?.response_data?.files || 
                                       result.response_data?.files ||
                                       result.data?.files ||
                                       result.files || []
                      
                      files = filesList.map((file: any) => ({
                        id: file.id,
                        name: file.name || 'Untitled',
                        type: 'spreadsheet',
                        lastModified: file.modifiedTime || file.createdTime || 'Unknown'
                      }))
                    } else {
                      const errorData = await executeResponse.text()
                      console.log('[Composio] Execute failed:', executeResponse.status, errorData)
                    }
                  } catch (e: any) {
                    console.log('[Composio] Could not list spreadsheets:', e.message)
                  }
                } else if (toolkitSlug === 'figma') {
                  try {
                    const executeResponse = await fetch(
                      'https://backend.composio.dev/api/v2/actions/FIGMA_GET_TEAM_PROJECTS/execute',
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'x-api-key': apiKey
                        },
                        body: JSON.stringify({
                          connectedAccountId: connectedAccount.id,
                          input: {}
                        })
                      }
                    )
                    
                    if (executeResponse.ok) {
                      const result = await executeResponse.json()
                      console.log('[Composio] Figma response:', JSON.stringify(result, null, 2).substring(0, 500))
                      
                      const projects = result.data?.response_data?.projects || 
                                      result.response_data?.projects ||
                                      result.data?.projects ||
                                      result.projects || []
                      
                      files = projects.map((project: any) => ({
                        id: project.id,
                        name: project.name || 'Untitled Project',
                        type: 'project',
                        lastModified: 'Unknown'
                      }))
                    } else {
                      const errorData = await executeResponse.text()
                      console.log('[Composio] Figma execute failed:', executeResponse.status, errorData)
                    }
                  } catch (e: any) {
                    console.log('[Composio] Could not list Figma files:', e.message)
                  }
                }
                
                console.log(`[Composio] Found ${files.length} files`)
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ files }))
                
              } catch (e: any) {
                console.error('[Composio] Files error:', e)
                res.statusCode = 500
                res.end(JSON.stringify({ error: e.message || String(e) }))
              }
            })
            return
          }
          
          // POST /api/composio/export-sheet - Export CSV to Google Sheets
          if (req.method === 'POST' && req.url === '/export-sheet') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', async () => {
              try {
                const { csvContent, fileName, userId } = JSON.parse(body)
                const apiKey = process.env.VITE_COMPOSIO_API_KEY
                
                if (!apiKey) {
                  res.statusCode = 500
                  res.end(JSON.stringify({ error: 'API key not configured' }))
                  return
                }
                
                console.log(`[Composio] Exporting to Google Sheets: ${fileName}`)
                
                const accountsResponse = await fetch(
                  `https://backend.composio.dev/api/v1/connectedAccounts?user_uuid=${encodeURIComponent(userId)}&showActiveOnly=true`,
                  { headers: { 'x-api-key': apiKey } }
                )
                
                if (!accountsResponse.ok) {
                  res.statusCode = 400
                  res.end(JSON.stringify({ error: 'Failed to fetch connected accounts' }))
                  return
                }
                
                const accountsData = await accountsResponse.json()
                const accounts = accountsData.items || accountsData
                
                const sheetsAccount = accounts.find((acc: any) => 
                  acc.appName?.toLowerCase() === 'googlesheets' ||
                  acc.appUniqueId?.toLowerCase().includes('googlesheets')
                )
                
                if (!sheetsAccount) {
                  res.statusCode = 400
                  res.end(JSON.stringify({ error: 'No Google Sheets account connected' }))
                  return
                }
                
                console.log(`[Composio] Found Sheets account: ${sheetsAccount.id}`)
                
                const normalizedCSV = csvContent.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n')
                const lines = parseCSVToRows(normalizedCSV)
                
                console.log(`[Composio] Parsed ${lines.length} CSV rows`)
                
                // Create a new spreadsheet
                const createResponse = await fetch(
                  'https://backend.composio.dev/api/v2/actions/GOOGLESHEETS_CREATE_GOOGLE_SHEET1/execute',
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-api-key': apiKey
                    },
                    body: JSON.stringify({
                      connectedAccountId: sheetsAccount.id,
                      input: {
                        title: fileName || 'Pypestream Bot Export'
                      }
                    })
                  }
                )
                
                if (!createResponse.ok) {
                  const errorText = await createResponse.text()
                  console.log('[Composio] Create sheet failed:', createResponse.status, errorText)
                  res.statusCode = 500
                  res.end(JSON.stringify({ error: 'Failed to create spreadsheet' }))
                  return
                }
                
                const createResult = await createResponse.json()
                console.log('[Composio] Create result:', JSON.stringify(createResult, null, 2))
                
                let spreadsheetId = null
                let spreadsheetUrl = null
                
                const possibleData = [
                  createResult.data?.response_data,
                  createResult.response_data,
                  createResult.data,
                  createResult,
                  createResult.successfulExecutions?.[0]?.output,
                  createResult.data?.successfulExecutions?.[0]?.output,
                ]
                
                for (const data of possibleData) {
                  if (data && !spreadsheetId) {
                    spreadsheetId = data.spreadsheetId || data.id || data.spreadsheet_id
                    spreadsheetUrl = data.spreadsheetUrl || data.spreadsheet_url || data.url
                  }
                }
                
                if (!spreadsheetId) {
                  const props = createResult.data?.response_data?.properties || 
                               createResult.response_data?.properties ||
                               createResult.properties
                  if (props) {
                    spreadsheetId = props.spreadsheetId
                  }
                }
                
                if (spreadsheetId && !spreadsheetUrl) {
                  spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
                }
                
                if (!spreadsheetId) {
                  console.log('[Composio] No spreadsheet ID found in response')
                  res.statusCode = 500
                  res.end(JSON.stringify({ error: 'Failed to get spreadsheet ID from response' }))
                  return
                }
                
                console.log(`[Composio] Created spreadsheet: ${spreadsheetId}`)
                
                // Parse all lines into a 2D array
                const allRows = lines.map((line, idx) => {
                  const parsed = parseCSVLine(line)
                  while (parsed.length < 26) {
                    parsed.push('')
                  }
                  if (parsed.length > 26) {
                    console.log(`[Composio] Warning: Row ${idx} has ${parsed.length} columns, truncating to 26`)
                    return parsed.slice(0, 26)
                  }
                  return parsed
                })
                
                console.log(`[Composio] Header columns: ${allRows[0]?.length || 0}`)
                console.log(`[Composio] Attempting to write ${allRows.length} rows`)
                
                let batchUpdateSuccess = false
                let lastError = ''
                
                const numRows = allRows.length
                const numCols = allRows[0]?.length || 26
                const endColumn = numCols <= 26 ? String.fromCharCode(64 + numCols) : 'ZZ'
                const range = `Sheet1!A1:${endColumn}${numRows}`
                
                // Try GOOGLESHEETS_BATCH_UPDATE
                console.log('[Composio] Trying GOOGLESHEETS_BATCH_UPDATE...')
                try {
                  const batchResponse = await fetch(
                    'https://backend.composio.dev/api/v2/actions/GOOGLESHEETS_BATCH_UPDATE/execute',
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey
                      },
                      body: JSON.stringify({
                        connectedAccountId: sheetsAccount.id,
                        input: {
                          spreadsheet_id: spreadsheetId,
                          sheet_name: 'Sheet1',
                          first_cell_location: 'A1',
                          values: allRows,
                          valueInputOption: 'RAW'
                        }
                      })
                    }
                  )
                  
                  if (batchResponse.ok) {
                    const result = await batchResponse.json()
                    if (isComposioSuccess(result)) {
                      console.log('[Composio] BATCH_UPDATE successful!')
                      batchUpdateSuccess = true
                    } else {
                      lastError = result.data?.message || result.error || 'Unknown error'
                    }
                  } else {
                    lastError = await batchResponse.text()
                  }
                } catch (e: any) {
                  lastError = e.message
                }
                
                // Fallback: GOOGLESHEETS_VALUES_UPDATE
                if (!batchUpdateSuccess) {
                  console.log('[Composio] Trying GOOGLESHEETS_VALUES_UPDATE fallback...')
                  try {
                    const updateResponse = await fetch(
                      'https://backend.composio.dev/api/v2/actions/GOOGLESHEETS_VALUES_UPDATE/execute',
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'x-api-key': apiKey
                        },
                        body: JSON.stringify({
                          connectedAccountId: sheetsAccount.id,
                          input: {
                            spreadsheet_id: spreadsheetId,
                            range: range,
                            values: allRows,
                            value_input_option: 'RAW'
                          }
                        })
                      }
                    )
                    
                    if (updateResponse.ok) {
                      const result = await updateResponse.json()
                      if (isComposioSuccess(result)) {
                        console.log('[Composio] VALUES_UPDATE successful!')
                        batchUpdateSuccess = true
                      }
                    }
                  } catch (e: any) {
                    lastError = e.message
                  }
                }
                
                // Last resort: GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND
                if (!batchUpdateSuccess) {
                  console.log('[Composio] Trying APPEND as last resort...')
                  try {
                    const appendResponse = await fetch(
                      'https://backend.composio.dev/api/v2/actions/GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND/execute',
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'x-api-key': apiKey
                        },
                        body: JSON.stringify({
                          connectedAccountId: sheetsAccount.id,
                          input: {
                            spreadsheetId: spreadsheetId,
                            range: 'Sheet1',
                            values: allRows,
                            valueInputOption: 'RAW'
                          }
                        })
                      }
                    )
                    
                    if (appendResponse.ok) {
                      const result = await appendResponse.json()
                      if (isComposioSuccess(result)) {
                        console.log('[Composio] APPEND successful!')
                        batchUpdateSuccess = true
                      }
                    }
                  } catch (e: any) {
                    lastError = e.message
                  }
                }
                
                if (!batchUpdateSuccess) {
                  console.log('[Composio] All batch update attempts failed')
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ 
                    success: true,
                    spreadsheetId,
                    spreadsheetUrl,
                    warning: 'Spreadsheet created but could not populate data.',
                    error: lastError.substring(0, 200)
                  }))
                  return
                }
                
                console.log('[Composio] Export completed successfully')
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ 
                  success: true,
                  spreadsheetId,
                  spreadsheetUrl
                }))
                
              } catch (e: any) {
                console.error('[Composio] Export error:', e)
                res.statusCode = 500
                res.end(JSON.stringify({ error: e.message || String(e) }))
              }
            })
            return
          }
          
          next()
        } catch (error: any) {
          console.error('[Composio] Middleware error:', error)
          res.statusCode = 500
          res.end(JSON.stringify({ error: error.message || String(error) }))
        }
      })
    }
  }
}
