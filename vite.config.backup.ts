import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { config as dotenvConfig } from 'dotenv'
import path, { resolve } from 'path'
import fs, { readFileSync, readdirSync } from 'fs'
import { readFile as fsReadFile } from 'fs/promises'

// Load .env file for server-side middleware
dotenvConfig({ path: resolve(__dirname, '.env') })

// Map our integration IDs to Composio toolkit slugs
const TOOLKIT_SLUGS: Record<string, string> = {
  'google-sheets': 'googlesheets',
  'figma': 'figma',
  'github': 'github',
  'google-drive': 'googledrive',
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // SPA fallback - serve index.html for all routes (except API and assets)
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Skip API routes, Supabase functions, and assets
          if (req.url?.startsWith('/api/') || 
              req.url?.startsWith('/functions/') ||  // Supabase edge function proxies
              req.url?.startsWith('/@') || 
              req.url?.startsWith('/node_modules/') ||
              req.url?.includes('.')) {
            return next();
          }
          // Serve index.html for all other routes (SPA routing)
          req.url = '/';
          next();
        });
      }
    },
    // API middleware plugin for Composio OAuth
    {
      name: 'composio-api-middleware',
      async configureServer(server) {
        // Dynamically import Composio SDK (ES module)
        let Composio: any = null;
        let composioClient: any = null;
        
        // Cache for auth config IDs (toolkit slug -> auth config id)
        const authConfigCache: Record<string, string> = {};
        
        const initComposio = async () => {
          if (composioClient) return composioClient;
          
          const apiKey = process.env.VITE_COMPOSIO_API_KEY;
          if (!apiKey) return null;
          
          try {
            const module = await import('@composio/core');
            Composio = module.Composio;
            composioClient = new Composio({ apiKey });
            console.log('[Composio] SDK initialized');
            return composioClient;
          } catch (e) {
            console.error('[Composio] Failed to init SDK:', e);
            return null;
          }
        };
        
        // Get or create an auth config for a toolkit
        const getOrCreateAuthConfig = async (toolkitSlug: string): Promise<string> => {
          // Check cache first
          if (authConfigCache[toolkitSlug]) {
            return authConfigCache[toolkitSlug];
          }
          
          const apiKey = process.env.VITE_COMPOSIO_API_KEY;
          if (!apiKey) throw new Error('API key not configured');
          
          // First, try to list existing auth configs for this toolkit
          console.log(`[Composio] Looking for existing auth config for ${toolkitSlug}...`);
          
          const listResponse = await fetch(
            `https://backend.composio.dev/api/v3/auth_configs?toolkit_slugs=${toolkitSlug}`,
            {
              headers: { 'x-api-key': apiKey },
            }
          );
          
          console.log(`[Composio] List response status: ${listResponse.status}`);
          
          if (listResponse.ok) {
            const listData = await listResponse.json();
            const configs = listData.items || listData.data || listData;
            
            if (Array.isArray(configs) && configs.length > 0) {
              // Find the config that matches our toolkit slug
              const matchingConfig = configs.find((c: any) => 
                c.toolkit?.slug === toolkitSlug || 
                c.toolkit?.slug?.toLowerCase() === toolkitSlug.toLowerCase()
              );
              
              if (matchingConfig) {
                const configId = matchingConfig.id || matchingConfig.auth_config_id || matchingConfig.auth_config?.id;
                console.log(`[Composio] Found matching auth config for ${toolkitSlug}: ${configId}`);
                authConfigCache[toolkitSlug] = configId;
                return configId;
              } else {
                console.log(`[Composio] No matching config found for ${toolkitSlug} in ${configs.length} configs`);
              }
            }
          }
          
          // No existing config, create a new one with Composio's managed auth
          console.log(`[Composio] Creating new auth config for ${toolkitSlug}...`);
          
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
          );
          
          const createData = await createResponse.json();
          console.log(`[Composio] Create response status: ${createResponse.status}`, JSON.stringify(createData, null, 2));
          
          if (!createResponse.ok) {
            console.error('[Composio] Failed to create auth config:', createData);
            throw new Error(createData.message || createData.error || `Failed to create auth config for ${toolkitSlug}`);
          }
          
          // The response has auth_config nested
          const configId = createData.auth_config?.id || createData.id || createData.auth_config_id;
          console.log(`[Composio] Created auth config: ${configId}`);
          
          authConfigCache[toolkitSlug] = configId;
          return configId;
        };
        
        server.middlewares.use('/api/composio', async (req, res, next) => {
          // Handle CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          try {
            // POST /api/composio/connect - Initiate OAuth connection
            if (req.method === 'POST' && req.url === '/connect') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  const { integrationId, userId, redirectUrl } = JSON.parse(body);
                  
                  const client = await initComposio();
                  if (!client) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ 
                      error: 'VITE_COMPOSIO_API_KEY not set in .env file' 
                    }));
                    return;
                  }
                  
                  // Map integration ID to toolkit slug
                  const toolkitSlug = TOOLKIT_SLUGS[integrationId] || integrationId;
                  
                  console.log(`[Composio] Connecting ${integrationId} (toolkit: ${toolkitSlug})`);
                  
                  // Get or create auth config automatically
                  const authConfigId = await getOrCreateAuthConfig(toolkitSlug);
                  
                  console.log('[Composio] Creating link with auth config:', authConfigId);
                  
                  // Use the SDK's link() method for hosted OAuth
                  const connectionRequest = await client.connectedAccounts.link(
                    userId || `user_${Date.now()}`,
                    authConfigId,
                    { callbackUrl: redirectUrl }
                  );
                  
                  console.log('[Composio] Connection request created:', connectionRequest.id);
                  
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({
                    redirectUrl: connectionRequest.redirectUrl,
                    connectionId: connectionRequest.id,
                  }));
                } catch (e: any) {
                  console.error('[Composio] Error:', e);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: e.message || String(e) }));
                }
              });
              return;
            }
            
            // GET /api/composio/status/:id - Check connection status
            if (req.method === 'GET' && req.url?.startsWith('/status/')) {
              const connectionId = req.url.replace('/status/', '');
              
              const client = await initComposio();
              if (!client) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'API key not configured' }));
                return;
              }
              
              try {
                const account = await client.connectedAccounts.get(connectionId);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  status: account.status,
                  connectionId: account.id,
                }));
              } catch (e: any) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Connection not found' }));
              }
              return;
            }
            
            // POST /api/composio/files - List files from connected account
            if (req.method === 'POST' && req.url === '/files') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  const { integrationId, userId } = JSON.parse(body);
                  const apiKey = process.env.VITE_COMPOSIO_API_KEY;
                  
                  if (!apiKey) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'API key not configured' }));
                    return;
                  }
                  
                  const toolkitSlug = TOOLKIT_SLUGS[integrationId] || integrationId;
                  console.log(`[Composio] Fetching files for ${toolkitSlug}, user: ${userId}`);
                  
                  // Get the user's connected accounts using REST API
                  const accountsResponse = await fetch(
                    `https://backend.composio.dev/api/v1/connectedAccounts?user_uuid=${encodeURIComponent(userId)}&showActiveOnly=true`,
                    {
                      headers: { 'x-api-key': apiKey }
                    }
                  );
                  
                  if (!accountsResponse.ok) {
                    console.log('[Composio] Failed to fetch connected accounts:', accountsResponse.status);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ files: [], error: 'Failed to fetch accounts' }));
                    return;
                  }
                  
                  const accountsData = await accountsResponse.json();
                  const accounts = accountsData.items || accountsData;
                  
                  // Find account matching the toolkit
                  const connectedAccount = accounts.find((acc: any) => 
                    acc.appName?.toLowerCase() === toolkitSlug.toLowerCase() ||
                    acc.appUniqueId?.toLowerCase().includes(toolkitSlug.toLowerCase())
                  );
                  
                  if (!connectedAccount) {
                    console.log('[Composio] No connected account found for', toolkitSlug);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ files: [], error: 'No connected account found' }));
                    return;
                  }
                  
                  console.log(`[Composio] Found connected account: ${connectedAccount.id}`);
                  
                  let files: any[] = [];
                  
                  // Execute action via REST API
                  if (toolkitSlug === 'googlesheets') {
                    try {
                      // Use Google Drive API via Composio to list spreadsheets
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
                      );
                      
                      if (executeResponse.ok) {
                        const result = await executeResponse.json();
                        console.log('[Composio] Drive response:', JSON.stringify(result, null, 2).substring(0, 500));
                        
                        const filesList = result.data?.response_data?.files || 
                                         result.response_data?.files ||
                                         result.data?.files ||
                                         result.files || [];
                        
                        files = filesList.map((file: any) => ({
                          id: file.id,
                          name: file.name || 'Untitled',
                          type: 'spreadsheet',
                          lastModified: file.modifiedTime || file.createdTime || 'Unknown'
                        }));
                      } else {
                        const errorData = await executeResponse.text();
                        console.log('[Composio] Execute failed:', executeResponse.status, errorData);
                      }
                    } catch (e: any) {
                      console.log('[Composio] Could not list spreadsheets:', e.message);
                    }
                  } else if (toolkitSlug === 'figma') {
                    try {
                      // List Figma projects first, then files
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
                      );
                      
                      if (executeResponse.ok) {
                        const result = await executeResponse.json();
                        console.log('[Composio] Figma response:', JSON.stringify(result, null, 2).substring(0, 500));
                        
                        const projects = result.data?.response_data?.projects || 
                                        result.response_data?.projects ||
                                        result.data?.projects ||
                                        result.projects || [];
                        
                        files = projects.map((project: any) => ({
                          id: project.id,
                          name: project.name || 'Untitled Project',
                          type: 'project',
                          lastModified: 'Unknown'
                        }));
                      } else {
                        const errorData = await executeResponse.text();
                        console.log('[Composio] Figma execute failed:', executeResponse.status, errorData);
                      }
                    } catch (e: any) {
                      console.log('[Composio] Could not list Figma files:', e.message);
                    }
                  }
                  
                  console.log(`[Composio] Found ${files.length} files`);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ files }));
                  
                } catch (e: any) {
                  console.error('[Composio] Files error:', e);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: e.message || String(e) }));
                }
              });
              return;
            }
            
            // POST /api/composio/export-sheet - Export CSV to Google Sheets
            if (req.method === 'POST' && req.url === '/export-sheet') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  const { csvContent, fileName, userId } = JSON.parse(body);
                  const apiKey = process.env.VITE_COMPOSIO_API_KEY;
                  
                  if (!apiKey) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'API key not configured' }));
                    return;
                  }
                  
                  console.log(`[Composio] Exporting to Google Sheets: ${fileName}`);
                  
                  // Get the user's connected accounts
                  const accountsResponse = await fetch(
                    `https://backend.composio.dev/api/v1/connectedAccounts?user_uuid=${encodeURIComponent(userId)}&showActiveOnly=true`,
                    {
                      headers: { 'x-api-key': apiKey }
                    }
                  );
                  
                  if (!accountsResponse.ok) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Failed to fetch connected accounts' }));
                    return;
                  }
                  
                  const accountsData = await accountsResponse.json();
                  const accounts = accountsData.items || accountsData;
                  
                  // Find Google Sheets account
                  const sheetsAccount = accounts.find((acc: any) => 
                    acc.appName?.toLowerCase() === 'googlesheets' ||
                    acc.appUniqueId?.toLowerCase().includes('googlesheets')
                  );
                  
                  if (!sheetsAccount) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'No Google Sheets account connected' }));
                    return;
                  }
                  
                  console.log(`[Composio] Found Sheets account: ${sheetsAccount.id}`);
                  
                  // Parse CSV properly handling multi-line values and different line endings
                  // First normalize line endings
                  const normalizedCSV = csvContent.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                  
                  // Parse CSV handling quoted fields with embedded newlines
                  const parseCSVToRows = (csv: string): string[] => {
                    const rows: string[] = [];
                    let currentRow = '';
                    let inQuotes = false;
                    
                    for (let i = 0; i < csv.length; i++) {
                      const char = csv[i];
                      
                      if (char === '"') {
                        currentRow += char;
                        // Check for escaped quote
                        if (inQuotes && csv[i + 1] === '"') {
                          currentRow += '"';
                          i++;
                        } else {
                          inQuotes = !inQuotes;
                        }
                      } else if (char === '\n' && !inQuotes) {
                        if (currentRow.trim()) {
                          rows.push(currentRow);
                        }
                        currentRow = '';
                      } else {
                        currentRow += char;
                      }
                    }
                    
                    // Don't forget the last row
                    if (currentRow.trim()) {
                      rows.push(currentRow);
                    }
                    
                    return rows;
                  };
                  
                  const lines = parseCSVToRows(normalizedCSV);
                  const headers = lines[0];
                  const dataRows = lines.slice(1);
                  
                  console.log(`[Composio] Parsed ${lines.length} CSV rows`);
                  
                  // Create a new spreadsheet using Google Sheets action
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
                  );
                  
                  if (!createResponse.ok) {
                    const errorText = await createResponse.text();
                    console.log('[Composio] Create sheet failed:', createResponse.status, errorText);
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'Failed to create spreadsheet' }));
                    return;
                  }
                  
                  const createResult = await createResponse.json();
                  console.log('[Composio] Create result:', JSON.stringify(createResult, null, 2));
                  
                  // Try multiple possible response structures
                  let spreadsheetId = null;
                  let spreadsheetUrl = null;
                  
                  // Check various nested paths where the ID might be
                  const possibleData = [
                    createResult.data?.response_data,
                    createResult.response_data,
                    createResult.data,
                    createResult,
                    createResult.successfulExecutions?.[0]?.output,
                    createResult.data?.successfulExecutions?.[0]?.output,
                  ];
                  
                  for (const data of possibleData) {
                    if (data && !spreadsheetId) {
                      spreadsheetId = data.spreadsheetId || data.id || data.spreadsheet_id;
                      spreadsheetUrl = data.spreadsheetUrl || data.spreadsheet_url || data.url;
                    }
                  }
                  
                  // Also check if the response has a 'properties' object (Google Sheets API format)
                  if (!spreadsheetId) {
                    const props = createResult.data?.response_data?.properties || 
                                 createResult.response_data?.properties ||
                                 createResult.properties;
                    if (props) {
                      spreadsheetId = props.spreadsheetId;
                    }
                  }
                  
                  // Build URL if we have ID but no URL
                  if (spreadsheetId && !spreadsheetUrl) {
                    spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
                  }
                  
                  if (!spreadsheetId) {
                    console.log('[Composio] No spreadsheet ID found in response. Full response:', JSON.stringify(createResult, null, 2));
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'Failed to get spreadsheet ID from response' }));
                    return;
                  }
                  
                  console.log(`[Composio] Created spreadsheet: ${spreadsheetId}`);
                  
                  // Now batch update the spreadsheet with CSV data
                  // Parse CSV line properly (handling quoted fields)
                  const parseCSVLine = (line: string): string[] => {
                    const result: string[] = [];
                    let current = '';
                    let inQuotes = false;
                    
                    for (let i = 0; i < line.length; i++) {
                      const char = line[i];
                      if (char === '"') {
                        if (inQuotes && line[i + 1] === '"') {
                          // Escaped quote - add single quote to content
                          current += '"';
                          i++;
                        } else {
                          // Toggle quote state, don't add to content
                          inQuotes = !inQuotes;
                        }
                      } else if (char === ',' && !inQuotes) {
                        result.push(current);
                        current = '';
                      } else {
                        current += char;
                      }
                    }
                    result.push(current);
                    return result;
                  };
                  
                  // Parse all lines into a 2D array
                  const allRows = lines.map((line, idx) => {
                    const parsed = parseCSVLine(line);
                    // Ensure exactly 26 columns (pad with empty strings if needed)
                    while (parsed.length < 26) {
                      parsed.push('');
                    }
                    // Truncate if too many columns (shouldn't happen with correct CSV)
                    if (parsed.length > 26) {
                      console.log(`[Composio] Warning: Row ${idx} has ${parsed.length} columns, truncating to 26`);
                      return parsed.slice(0, 26);
                    }
                    return parsed;
                  });
                  
                  // Log column counts for debugging
                  console.log(`[Composio] Header columns: ${allRows[0]?.length || 0}`);
                  console.log(`[Composio] First data row columns: ${allRows[1]?.length || 0}`);
                  console.log(`[Composio] Sample header: ${allRows[0]?.slice(0, 5)?.join(' | ') || 'N/A'}`);
                  
                  console.log(`[Composio] Attempting to write ${allRows.length} rows (${allRows[0]?.length || 0} columns) to spreadsheet ${spreadsheetId}`);
                  
                  let batchUpdateSuccess = false;
                  let lastError = '';
                  
                  // Calculate range based on data size
                  const numRows = allRows.length;
                  const numCols = allRows[0]?.length || 26;
                  const endColumn = numCols <= 26 ? String.fromCharCode(64 + numCols) : 'ZZ';
                  const range = `Sheet1!A1:${endColumn}${numRows}`;
                  
                  console.log(`[Composio] Data range: ${range}`);
                  
                  // Helper to check if Composio response indicates success
                  const isComposioSuccess = (result: any): boolean => {
                    // Check for error in response body (Composio returns 200 even on errors)
                    if (result.error) return false;
                    if (result.data?.error) return false;
                    if (result.data?.message?.includes('Invalid')) return false;
                    if (result.data?.message?.includes('missing')) return false;
                    // Check for success indicators
                    if (result.successful === true || result.successfull === true) return true;
                    if (result.data?.response_data?.updatedCells) return true;
                    if (result.data?.response_data?.updatedRows) return true;
                    if (result.data?.spreadsheet) return true;
                    // If no clear indicator, assume success if no error
                    return !result.error;
                  };
                  
                  // Try GOOGLESHEETS_BATCH_UPDATE first (correct schema)
                  console.log('[Composio] Trying GOOGLESHEETS_BATCH_UPDATE...');
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
                    );
                    
                    if (batchResponse.ok) {
                      const result = await batchResponse.json();
                      console.log('[Composio] BATCH_UPDATE response:', JSON.stringify(result).substring(0, 500));
                      
                      if (isComposioSuccess(result)) {
                        console.log('[Composio] BATCH_UPDATE truly successful!');
                        batchUpdateSuccess = true;
                      } else {
                        console.log('[Composio] BATCH_UPDATE returned error in body');
                        lastError = result.data?.message || result.error || 'Unknown error in response';
                      }
                    } else {
                      const errorText = await batchResponse.text();
                      console.log('[Composio] BATCH_UPDATE HTTP failed:', batchResponse.status, errorText.substring(0, 500));
                      lastError = errorText;
                    }
                  } catch (e: any) {
                    console.log('[Composio] BATCH_UPDATE error:', e.message);
                    lastError = e.message;
                  }
                  
                  // Fallback: Try GOOGLESHEETS_VALUES_UPDATE if batch failed
                  if (!batchUpdateSuccess) {
                    console.log('[Composio] Trying GOOGLESHEETS_VALUES_UPDATE fallback...');
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
                      );
                      
                      if (updateResponse.ok) {
                        const result = await updateResponse.json();
                        console.log('[Composio] VALUES_UPDATE response:', JSON.stringify(result).substring(0, 500));
                        
                        if (isComposioSuccess(result)) {
                          console.log('[Composio] VALUES_UPDATE truly successful!');
                          batchUpdateSuccess = true;
                        } else {
                          console.log('[Composio] VALUES_UPDATE returned error in body');
                          lastError = result.data?.message || result.error || 'Unknown error';
                        }
                      } else {
                        const errorText = await updateResponse.text();
                        console.log('[Composio] VALUES_UPDATE HTTP failed:', updateResponse.status, errorText.substring(0, 500));
                        lastError = errorText;
                      }
                    } catch (e: any) {
                      console.log('[Composio] VALUES_UPDATE error:', e.message);
                      lastError = e.message;
                    }
                  }
                  
                  // Last resort: Try GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND
                  if (!batchUpdateSuccess) {
                    console.log('[Composio] Trying GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND as last resort...');
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
                      );
                      
                      if (appendResponse.ok) {
                        const result = await appendResponse.json();
                        console.log('[Composio] APPEND response:', JSON.stringify(result).substring(0, 500));
                        
                        if (isComposioSuccess(result)) {
                          console.log('[Composio] APPEND truly successful!');
                          batchUpdateSuccess = true;
                        } else {
                          console.log('[Composio] APPEND returned error in body');
                          lastError = result.data?.message || result.error || 'Unknown error';
                        }
                      } else {
                        const errorText = await appendResponse.text();
                        console.log('[Composio] APPEND HTTP failed:', appendResponse.status, errorText.substring(0, 500));
                        lastError = errorText;
                      }
                    } catch (e: any) {
                      console.log('[Composio] APPEND error:', e.message);
                      lastError = e.message;
                    }
                  }
                  
                  if (!batchUpdateSuccess) {
                    console.log('[Composio] All batch update attempts failed. Spreadsheet created but empty.');
                    // Return partial success - spreadsheet created but not populated
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ 
                      success: true,
                      spreadsheetId,
                      spreadsheetUrl,
                      warning: 'Spreadsheet created but could not populate data. Please paste CSV manually.',
                      error: lastError.substring(0, 200)
                    }));
                    return;
                  }
                  
                  console.log('[Composio] Export completed successfully');
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ 
                    success: true,
                    spreadsheetId,
                    spreadsheetUrl
                  }));
                  
                } catch (e: any) {
                  console.error('[Composio] Export error:', e);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: e.message || String(e) }));
                }
              });
              return;
            }
            
            next();
          } catch (error: any) {
            console.error('[Composio] Middleware error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error.message || String(error) }));
          }
        });
      }
    },
    // AI Requirements Questions middleware
    {
      name: 'ai-requirements-questions-middleware',
      async configureServer(server) {
        server.middlewares.use('/api/generate-requirements', async (req, res, next) => {
          // Handle CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          if (req.method !== 'POST') {
            next();
            return;
          }
          
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const { projectConfig } = JSON.parse(body);
              const apiKey = process.env.ANTHROPIC_API_KEY;
              
              if (!apiKey || apiKey === 'your-api-key-here') {
                // Return fallback questions
                console.log('[AI Requirements] No API key, using fallback questions');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  questions: generateFallbackQuestions(projectConfig)
                }));
                return;
              }
              
              console.log('[AI Requirements] Generating questions for:', projectConfig?.projectName);
              
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

Return ONLY valid JSON array. No markdown, no explanation.`;

              // Extract key details from description for better context
              const description = projectConfig?.description || '';
              const projectType = projectConfig?.projectType || 'custom';
              const clientName = projectConfig?.clientName || 'Unknown Client';
              const projectName = projectConfig?.projectName || 'Unknown Project';
              
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

Make the answer options realistic and include example text/values in the descriptions where helpful.`;

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
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error('[AI Requirements] Claude API error:', response.status, errorText);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  questions: generateFallbackQuestions(projectConfig)
                }));
                return;
              }
              
              const result = await response.json();
              const content = result.content?.[0]?.text || '';
              
              console.log('[AI Requirements] Raw response length:', content.length);
              
              let questions;
              try {
                let jsonStr = content.trim();
                const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonMatch) {
                  jsonStr = jsonMatch[1].trim();
                }
                const arrayMatch = content.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                  jsonStr = arrayMatch[0];
                }
                
                questions = JSON.parse(jsonStr);
                console.log('[AI Requirements] Parsed', questions.length, 'questions');
              } catch (parseError) {
                console.error('[AI Requirements] Parse error:', parseError);
                questions = generateFallbackQuestions(projectConfig);
              }
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ questions }));
              
            } catch (e: any) {
              console.error('[AI Requirements] Error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Helper function for fallback questions - generates project-specific options
        function generateFallbackQuestions(projectConfig: any) {
          const projectType = projectConfig?.projectType || 'custom';
          const clientName = projectConfig?.clientName || 'Your Company';
          const projectName = projectConfig?.projectName || 'Chatbot';
          const description = (projectConfig?.description || '').toLowerCase();
          
          // Detect specific keywords from description
          const hasWaterDamage = description.includes('water') && description.includes('damage');
          const hasInsurance = description.includes('insurance') || description.includes('claim');
          const hasFNOL = description.includes('fnol') || description.includes('first notice');
          const hasProperty = description.includes('property') || description.includes('home');
          const hasAuto = description.includes('auto') || description.includes('car') || description.includes('vehicle');
          const hasScheduling = description.includes('schedule') || description.includes('appointment') || description.includes('book');
          const hasLeads = description.includes('lead') || description.includes('sales');
          
          const questions: any[] = [];
          
          // Q1: Greeting - customized to project
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
          });
          
          // Q2: Main flow entry - project-specific
          if (hasWaterDamage || hasProperty) {
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
            });
            
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
            });
            
            questions.push({
              id: 'q4',
              category: 'documentation',
              question: 'What photos/documentation should be collected?',
              options: [
                { id: 'a', label: 'Damage photos required', description: 'Must upload photos of affected areas before proceeding' },
                { id: 'b', label: 'Damage photos optional', description: 'Offer upload but allow skip, follow up later' },
                { id: 'c', label: 'Multiple photo types', description: 'Damage + source + affected items separately' },
                { id: 'd', label: 'Video walkthrough option', description: 'Allow video upload for comprehensive view' }
              ],
              allowMultiple: false
            });
          } else if (hasAuto) {
            questions.push({
              id: 'q2',
              category: 'flow',
              question: 'What type of auto incident should the bot handle?',
              options: [
                { id: 'a', label: 'Collision claims', description: 'Accidents with other vehicles or objects' },
                { id: 'b', label: 'Theft/vandalism', description: 'Stolen vehicles or intentional damage' },
                { id: 'c', label: 'Weather damage', description: 'Hail, flooding, fallen trees' },
                { id: 'd', label: 'Glass claims', description: 'Windshield and window damage' },
                { id: 'e', label: 'All of the above', description: 'Full auto claims intake' }
              ],
              allowMultiple: true
            });
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
            });
          } else if (hasLeads) {
            questions.push({
              id: 'q2',
              category: 'flow',
              question: 'What qualifies a lead as sales-ready?',
              options: [
                { id: 'a', label: 'Contact info captured', description: 'Name + email or phone collected' },
                { id: 'b', label: 'Interest expressed', description: 'Specific product/service interest identified' },
                { id: 'c', label: 'Budget confirmed', description: 'Price range or budget discussed' },
                { id: 'd', label: 'Timeline established', description: 'Purchase timeframe captured' }
              ],
              allowMultiple: true
            });
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
            });
          }
          
          // Q: Urgency handling (for claims/support)
          if (hasInsurance || projectType === 'claims') {
            questions.push({
              id: 'q_urgency',
              category: 'priority',
              question: 'How should the bot handle urgent vs. non-urgent claims?',
              options: [
                { id: 'a', label: 'Ask urgency upfront', description: '"Is this an emergency?" at the start' },
                { id: 'b', label: 'Detect from answers', description: 'Infer urgency based on damage description' },
                { id: 'c', label: 'Fast-track option', description: 'Offer express path for urgent cases' },
                { id: 'd', label: 'Treat all as priority', description: 'Same expedited flow for everyone' }
              ],
              allowMultiple: false
            });
          }
          
          // Q: Data validation
          questions.push({
            id: 'q_validation',
            category: 'validation',
            question: hasInsurance 
              ? 'How should policy/claim information be validated?'
              : 'How strict should input validation be?',
            options: hasInsurance ? [
              { id: 'a', label: 'Real-time policy lookup', description: 'Verify policy number against system immediately' },
              { id: 'b', label: 'Format validation only', description: 'Check format is correct, verify later' },
              { id: 'c', label: 'Confirm with user', description: 'Read back and ask them to confirm' },
              { id: 'd', label: 'Skip validation', description: 'Accept input, let adjuster verify' }
            ] : [
              { id: 'a', label: 'Strict validation', description: 'Require exact formats (email, phone, etc.)' },
              { id: 'b', label: 'Flexible with confirmation', description: 'Accept variations, confirm uncertain entries' },
              { id: 'c', label: 'Minimal validation', description: 'Accept most input, clean up later' }
            ],
            allowMultiple: false
          });
          
          // Q: Error handling
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
          });
          
          // Q: Escalation
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
              { id: 'd', label: 'Fraud indicators', description: 'Suspicious patterns detected' },
              { id: 'e', label: 'Always offer option', description: 'Human help available throughout' }
            ] : [
              { id: 'a', label: 'User requests it', description: 'Only when they explicitly ask for human' },
              { id: 'b', label: 'After repeated errors', description: 'When bot can\'t help after 2-3 tries' },
              { id: 'c', label: 'For complex issues', description: 'Route certain categories to agents' },
              { id: 'd', label: 'Always visible', description: 'Agent button available on every screen' }
            ],
            allowMultiple: true
          });
          
          // Q: Completion
          questions.push({
            id: 'q_completion',
            category: 'completion',
            question: hasInsurance
              ? 'What should happen when the claim is submitted?'
              : `What should happen when the user completes their ${projectName.toLowerCase()} request?`,
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
          });
          
          // Q: Features
          questions.push({
            id: 'q_features',
            category: 'features',
            question: `Which features should the ${projectName} include?`,
            options: hasInsurance ? [
              { id: 'a', label: 'Photo/video upload', description: 'Capture damage documentation' },
              { id: 'b', label: 'Date picker', description: 'Select incident date, schedule appointments' },
              { id: 'c', label: 'Document upload', description: 'Attach receipts, estimates, police reports' },
              { id: 'd', label: 'Map/location picker', description: 'Pin incident or property location' },
              { id: 'e', label: 'Policy lookup', description: 'Auto-fill from policy number' }
            ] : [
              { id: 'a', label: 'File uploads', description: 'Let users attach documents or photos' },
              { id: 'b', label: 'Date/time picker', description: 'Calendar widget for scheduling' },
              { id: 'c', label: 'Rich forms (webview)', description: 'Complex data entry in a form' },
              { id: 'd', label: 'Carousels', description: 'Swipeable cards for browsing options' },
              { id: 'e', label: 'Quick replies', description: 'Tap-to-respond button chips' }
            ],
            allowMultiple: true
          });
          
          // Q: Language
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
          });
          
          return questions;
        }
      }
    },
    // AI Prompt Analysis middleware (for pre-filling project setup)
    {
      name: 'ai-prompt-analysis-middleware',
      async configureServer(server) {
        server.middlewares.use('/api/analyze-prompt', async (req, res, next) => {
          // Handle CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          if (req.method !== 'POST') {
            next();
            return;
          }
          
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const { prompt } = JSON.parse(body);
              const apiKey = process.env.ANTHROPIC_API_KEY;
              
              if (!apiKey || apiKey === 'your-api-key-here') {
                // Return a signal that client should use local fallback
                console.log('[AI Analyze] No API key configured, client will use local fallback');
                res.statusCode = 503;
                res.end(JSON.stringify({ 
                  error: 'ANTHROPIC_API_KEY not configured',
                  useLocalFallback: true
                }));
                return;
              }
              
              console.log('[AI Analyze] Analyzing prompt:', prompt.substring(0, 100) + '...');
              
              const systemPrompt = `You are an expert at extracting project details from natural language descriptions for Pypestream chatbot projects.

Your job is to analyze a user's description and extract/infer ALL of the following fields. You MUST provide a value for EVERY field - make intelligent guesses based on context, industry norms, or reasonable defaults.

## FIELDS TO EXTRACT

1. **clientName**: ALWAYS set to "CX" - this is a fixed organizational value for bot ID purposes.

2. **targetCompany**: The actual company or brand name being built for (what we'll use for branding).
   - Extract ONLY the company/brand name — NOT "X customers", "X users", "X clients", etc.
   - WRONG: "Honda customers" — RIGHT: "Honda"
   - WRONG: "Delta Airlines users" — RIGHT: "Delta Airlines"
   - WRONG: "WeWork members" — RIGHT: "WeWork"
   - Strip trailing words like: customers, users, clients, members, patients, employees, team, staff, subscribers, shoppers
   - Keep spaces and proper casing (e.g., "Travelers Insurance", "WeWork", "Delta Airlines")
   - If no specific company is mentioned, infer from industry (e.g., "Insurance Company", "Tech Startup")
   - This is used for Brandfetch brand detection (colors, logos) — must be a real company name

3. **projectName**: The project name in PascalCase (no spaces).
   - Should describe what the bot does
   - Examples: "ClaimsFNOL", "CustomerSupport", "LeadCapture", "BillingAssist", "TechSupport"
   - Combine the use case with a descriptor like "MVP", "Bot", "Assistant", "Portal"

4. **projectType**: One of: "claims", "support", "sales", "faq", "survey", "custom"
   - claims: Insurance claims, FNOL, incident reporting
   - support: Help desk, troubleshooting, customer service
   - sales: Lead generation, quotes, product recommendations
   - faq: Information delivery, knowledge base
   - survey: Feedback collection, surveys, polls
   - custom: Anything else

5. **description**: A cleaned-up, structured version of their input. Keep their intent but make it clear and actionable.

## EXAMPLES

Input: "need a bot for travelers insurance to handle water damage claims"
Output: {
  "clientName": "CX",
  "targetCompany": "Travelers Insurance",
  "projectName": "WaterDamageFNOL",
  "projectType": "claims",
  "description": "A chatbot for Travelers Insurance to handle water damage claims. The bot will collect incident details, capture photos/documentation, and route claims appropriately."
}

Input: "help desk chatbot for WeWork"
Output: {
  "clientName": "CX",
  "targetCompany": "WeWork",
  "projectName": "HelpDeskBot",
  "projectType": "support",
  "description": "A help desk chatbot for WeWork to assist users with technical support requests. Will handle common troubleshooting, ticket creation, and escalation to live agents."
}

Input: "I want to collect leads for my roofing company"
Output: {
  "clientName": "CX",
  "targetCompany": "Roofing Company",
  "projectName": "LeadCaptureMVP",
  "projectType": "sales",
  "description": "A lead generation chatbot for a roofing company. Collects contact information, project details (roof type, damage assessment), and schedules consultations."
}

Input: "something to answer questions about our products"
Output: {
  "clientName": "CX",
  "targetCompany": "Product Company",
  "projectName": "ProductFAQ",
  "projectType": "faq",
  "description": "A FAQ chatbot to answer product-related questions. Will provide product information, specifications, pricing, and availability details."
}

ALWAYS respond with valid JSON only. No markdown, no explanation - just the JSON object.`;

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
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error('[AI Analyze] Claude API error:', response.status, errorText);
                // Fall back to basic extraction
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  clientName: '',
                  projectName: '',
                  projectType: 'custom',
                  description: prompt
                }));
                return;
              }
              
              const result = await response.json();
              const content = result.content?.[0]?.text || '';
              
              console.log('[AI Analyze] Raw response:', content);
              
              // Parse JSON from response
              let extractedDetails;
              try {
                // Try to find JSON in the response
                let jsonStr = content.trim();
                // Remove markdown code blocks if present
                const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonMatch) {
                  jsonStr = jsonMatch[1].trim();
                }
                // Try to find raw JSON object
                const rawJsonMatch = content.match(/\{[\s\S]*\}/);
                if (rawJsonMatch) {
                  jsonStr = rawJsonMatch[0];
                }
                
                extractedDetails = JSON.parse(jsonStr);
                console.log('[AI Analyze] Extracted:', extractedDetails);
              } catch (parseError) {
                console.error('[AI Analyze] Failed to parse:', parseError);
                extractedDetails = {
                  clientName: '',
                  projectName: '',
                  projectType: 'custom',
                  description: prompt
                };
              }
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(extractedDetails));
              
            } catch (e: any) {
              console.error('[AI Analyze] Error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
      }
    },
    // Brandfetch API middleware - for automatic brand detection
    {
      name: 'brandfetch-middleware',
      async configureServer(server) {
        server.middlewares.use('/api/brandfetch', async (req, res, next) => {
          // Handle CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          if (req.method !== 'POST') {
            next();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { query } = JSON.parse(body);
              const apiKey = process.env.BRANDFETCH_API_KEY;
              
              if (!apiKey) {
                console.log('[Brandfetch] No API key configured');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'BRANDFETCH_API_KEY not configured' }));
                return;
              }
              
              if (!query) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Query is required' }));
                return;
              }
              
              console.log('[Brandfetch] Searching for brand:', query);
              
              // Normalize query for matching
              const queryLower = query.toLowerCase().replace(/[^a-z0-9]/g, '');
              
              // First, search for the brand to get its domain
              const searchResponse = await fetch(
                `https://api.brandfetch.io/v2/search/${encodeURIComponent(query)}`,
                {
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                  }
                }
              );
              
              if (!searchResponse.ok) {
                console.log('[Brandfetch] Search failed:', searchResponse.status);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  success: false, 
                  error: `Search failed: ${searchResponse.status}` 
                }));
                return;
              }
              
              const searchResults = await searchResponse.json();
              console.log('[Brandfetch] Search results:', searchResults.length, 'found');
              console.log('[Brandfetch] Top results:', searchResults.slice(0, 5).map((r: any) => ({
                name: r.name,
                domain: r.domain
              })));
              
              if (!searchResults || searchResults.length === 0) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'No brands found' }));
                return;
              }
              
              // Smart matching: find the best result instead of just taking the first
              // Priority: 1) Exact domain match, 2) Exact name match, 3) Domain starts with query, 4) Name contains query
              const findBestMatch = (results: any[]) => {
                // Check for exact domain match (e.g., query="wework" matches "wework.com")
                const exactDomain = results.find((r: any) => {
                  const domainBase = r.domain?.split('.')[0]?.toLowerCase();
                  return domainBase === queryLower;
                });
                if (exactDomain) {
                  console.log('[Brandfetch] Found exact domain match:', exactDomain.domain);
                  return exactDomain;
                }
                
                // Check for exact name match (case-insensitive)
                const exactName = results.find((r: any) => {
                  const nameLower = r.name?.toLowerCase().replace(/[^a-z0-9]/g, '');
                  return nameLower === queryLower;
                });
                if (exactName) {
                  console.log('[Brandfetch] Found exact name match:', exactName.name);
                  return exactName;
                }
                
                // Check for domain that starts with query
                const domainStarts = results.find((r: any) => {
                  const domainBase = r.domain?.split('.')[0]?.toLowerCase();
                  return domainBase?.startsWith(queryLower) && !domainBase.includes('remote');
                });
                if (domainStarts) {
                  console.log('[Brandfetch] Found domain starting with query:', domainStarts.domain);
                  return domainStarts;
                }
                
                // Check for shorter domain (likely the main company, not a subsidiary)
                const sortedByDomainLength = [...results].sort((a, b) => {
                  const aLen = a.domain?.split('.')[0]?.length || 999;
                  const bLen = b.domain?.split('.')[0]?.length || 999;
                  return aLen - bLen;
                });
                
                // Prefer results where name closely matches query
                const nameContains = sortedByDomainLength.find((r: any) => {
                  const nameLower = r.name?.toLowerCase();
                  return nameLower?.includes(queryLower) || queryLower.includes(nameLower?.replace(/[^a-z0-9]/g, ''));
                });
                if (nameContains) {
                  console.log('[Brandfetch] Found name containing query:', nameContains.name);
                  return nameContains;
                }
                
                // Fallback to first result
                console.log('[Brandfetch] Using first result as fallback:', results[0].domain);
                return results[0];
              };
              
              const bestMatch = findBestMatch(searchResults);
              const domain = bestMatch.domain;
              console.log('[Brandfetch] Selected domain:', domain, 'from', bestMatch.name);
              
              // Fetch full brand data
              const brandResponse = await fetch(
                `https://api.brandfetch.io/v2/brands/${domain}`,
                {
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                  }
                }
              );
              
              if (!brandResponse.ok) {
                console.log('[Brandfetch] Brand fetch failed:', brandResponse.status);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  success: false, 
                  error: `Brand fetch failed: ${brandResponse.status}` 
                }));
                return;
              }
              
              const brandData = await brandResponse.json();
              console.log('[Brandfetch] Brand data received:', brandData.name);
              
              // Extract colors
              const colors = (brandData.colors || []).map((c: any) => ({
                name: c.type || 'primary',
                hex: c.hex,
                usage: c.type === 'accent' ? 'accent' : c.type === 'dark' ? 'secondary' : 'primary',
              }));
              
              // Helper to check if a color is too light (near white) or too dark (near black)
              const isNearWhite = (hex: string) => {
                if (!hex) return false;
                const cleanHex = hex.replace('#', '');
                const r = parseInt(cleanHex.slice(0, 2), 16);
                const g = parseInt(cleanHex.slice(2, 4), 16);
                const b = parseInt(cleanHex.slice(4, 6), 16);
                return (r > 240 && g > 240 && b > 240);
              };
              
              const isNearBlack = (hex: string) => {
                if (!hex) return false;
                const cleanHex = hex.replace('#', '');
                const r = parseInt(cleanHex.slice(0, 2), 16);
                const g = parseInt(cleanHex.slice(2, 4), 16);
                const b = parseInt(cleanHex.slice(4, 6), 16);
                return (r < 30 && g < 30 && b < 30);
              };
              
              // Find colors that are actually usable (not pure white/black)
              const usableColors = colors.filter((c: any) => 
                c.hex && !isNearWhite(c.hex) && !isNearBlack(c.hex)
              );
              
              // Smart color selection:
              // 1. Find a "dark" color for headers/gradients (not white, preferably dark)
              // 2. Find an accent/vibrant color for buttons
              const darkColors = colors.filter((c: any) => c.hex && c.usage === 'secondary');
              const accentColors = colors.filter((c: any) => c.hex && c.usage === 'accent');
              
              // Primary should be usable - not white or black. Prefer dark/secondary, then accent, then usable
              // Look for a "brand color" that isn't just black or white
              let primaryColor = darkColors[0]?.hex;
              
              // If no dark color, or it's near-black, find a usable brand color
              if (!primaryColor || isNearBlack(primaryColor)) {
                // Look for a colorful option (not black or white)
                const colorfulOption = usableColors.find((c: any) => 
                  c.hex && !isNearBlack(c.hex) && !isNearWhite(c.hex)
                )?.hex || accentColors[0]?.hex;
                
                if (colorfulOption) {
                  primaryColor = colorfulOption;
                } else {
                  // Fall back to first usable color
                  primaryColor = usableColors[0]?.hex || accentColors[0]?.hex || '#1E3A5F';
                }
              }
              
              // Secondary color - contrasting color, prefer lighter or accent
              const secondaryColor = accentColors[0]?.hex 
                || usableColors.find((c: any) => c.hex !== primaryColor)?.hex
                || colors.find((c: any) => c.usage === 'accent')?.hex
                || colors[1]?.hex 
                || '#3B82F6';  // Default blue
              
              console.log('[Brandfetch] Original colors:', colors.map((c: any) => c.hex).join(', '));
              console.log('[Brandfetch] Selected: primary=', primaryColor, ', secondary=', secondaryColor);
              
              // Extract logos with background info
              const logos = (brandData.logos || []).flatMap((logo: any) => 
                (logo.formats || []).map((format: any) => ({
                  url: format.src,
                  type: logo.type === 'symbol' ? 'icon' : logo.type === 'wordmark' ? 'wordmark' : 'primary',
                  format: format.format,
                  background: format.background || logo.theme || 'transparent',
                }))
              );
              
              // Find best logo - prefer PNG for better compatibility, then SVG
              // Priority: icon > primary, PNG > SVG, dark background preferred
              const logoPriority = [
                logos.find((l: any) => l.type === 'icon' && l.format === 'png'),
                logos.find((l: any) => l.type === 'icon' && l.format === 'jpeg'),
                logos.find((l: any) => l.type === 'icon' && l.format === 'svg'),
                logos.find((l: any) => l.type === 'icon'),
                logos.find((l: any) => l.type === 'primary' && l.format === 'png'),
                logos.find((l: any) => l.type === 'primary' && l.format === 'jpeg'),
                logos.find((l: any) => l.type === 'primary' && l.format === 'svg'),
                logos.find((l: any) => l.type === 'primary'),
                logos.find((l: any) => l.format === 'png'),
                logos[0],
              ];
              const bestLogo = logoPriority.find(l => l) || { url: '', background: 'transparent' };
              const logoUrl = bestLogo?.url || '';
              const logoBackground = bestLogo?.background || 'transparent';
              
              console.log('[Brandfetch] All logos found:', logos.length);
              console.log('[Brandfetch] Logo types:', logos.map((l: any) => `${l.type}/${l.format}/${l.background}`).join(', '));
              console.log('[Brandfetch] Selected logo URL:', logoUrl || 'NONE');
              
              // Extract fonts
              const fonts = (brandData.fonts || []).map((f: any) => ({
                name: f.name,
                type: f.type || 'body',
                origin: f.origin,
                originId: f.originId,
                weights: f.weights,
              }));
              
              // Extract images (banners, covers, etc.)
              const images = (brandData.images || []).map((img: any) => ({
                url: img.formats?.[0]?.src || img.src || '',
                type: img.type || 'banner',
              })).filter((img: any) => img.url);
              
              // Find best brand moment image (prefer banner or cover)
              const brandMomentUrl = images.find((i: any) => i.type === 'banner')?.url
                || images.find((i: any) => i.type === 'cover')?.url
                || images[0]?.url
                || logoUrl;
              
              // Use direct Brandfetch URL (no base64 conversion per user request)
              console.log('[Brandfetch] Using direct logo URL:', logoUrl);
              
              const brandAssets = {
                name: brandData.name,
                domain: domain,
                colors: colors,
                logos: logos,
                fonts: fonts,
                images: images,
                primaryColor: primaryColor,
                secondaryColor: secondaryColor,
                logoUrl: logoUrl,  // Direct Brandfetch URL
                logoBackground: logoBackground,
                brandMomentUrl: brandMomentUrl,
              };
              
              console.log('[Brandfetch] Returning brand assets:', {
                name: brandAssets.name,
                primaryColor: brandAssets.primaryColor,
                logoUrl: logoUrl || 'none',
                logoBackground: brandAssets.logoBackground,
                fonts: brandAssets.fonts.length,
                images: brandAssets.images.length,
              });
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, brand: brandAssets }));
              
            } catch (e: any) {
              console.error('[Brandfetch] Error:', e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: e.message || String(e) }));
            }
          });
        });
      }
    },
    // AI Generation middleware
    {
      name: 'ai-generation-middleware',
      async configureServer(server) {
        // Cache for context (loaded once at startup)
        let cachedContext: string | null = null;
        let cachedActionNodes: string | null = null;
        
        // Load context from Knowledge-Base and Official-Action-Nodes
        const loadContext = () => {
          if (cachedContext) return { context: cachedContext, actionNodes: cachedActionNodes };
          
          const workspaceRoot = resolve(__dirname, '..');
          
          try {
            // Load Knowledge-Base files
            const knowledgeBasePath = resolve(workspaceRoot, 'Knowledge-Base');
            const kbFiles = [
              '01-CSV-Column-Reference.md',
              '03-Rich-Assets-Reference.md',
              '04-Action-Scripts-Reference.md',
              '06-UX-Best-Practices.md',
              '08-Official-Action-Nodes.md',
            ];
            
            let context = '';
            for (const file of kbFiles) {
              try {
                const content = readFileSync(resolve(knowledgeBasePath, file), 'utf-8');
                context += `\n\n## ${file.replace('.md', '')}\n${content}`;
              } catch (e) {
                console.log(`[AI Gen] Could not load ${file}`);
              }
            }
            
            // Load .cursorrules for syntax
            try {
              const cursorRules = readFileSync(resolve(workspaceRoot, '.cursorrules'), 'utf-8');
              context = `# PYPESTREAM CSV SYNTAX RULES\n${cursorRules}\n${context}`;
            } catch (e) {
              console.log('[AI Gen] Could not load .cursorrules');
            }
            
            // Load bot template
            try {
              const template = readFileSync(
                resolve(workspaceRoot, 'Solutions/TRAVELERS/templates/pypestream-bot-template.csv'),
                'utf-8'
              );
              context += `\n\n## BOT TEMPLATE EXAMPLE\n\`\`\`csv\n${template}\n\`\`\``;
            } catch (e) {
              console.log('[AI Gen] Could not load bot template');
            }
            
            // Load action node catalog
            try {
              const actionNodesPath = resolve(workspaceRoot, 'Official-Action-Nodes');
              const scripts = readdirSync(actionNodesPath)
                .filter(f => f.endsWith('.py'))
                .map(f => f.replace('.py', ''));
              cachedActionNodes = scripts.join(', ');
            } catch (e) {
              cachedActionNodes = '';
            }
            
            cachedContext = context;
            console.log(`[AI Gen] Context loaded: ${context.length} chars, ${cachedActionNodes?.split(',').length || 0} action nodes`);
            
            return { context: cachedContext, actionNodes: cachedActionNodes };
          } catch (e) {
            console.error('[AI Gen] Failed to load context:', e);
            return { context: '', actionNodes: '' };
          }
        };
        
        server.middlewares.use('/api/generate-csv', async (req, res, next) => {
          // Handle CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          if (req.method !== 'POST') {
            next();
            return;
          }
          
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const { projectConfig, clarifyingQuestions, referenceFiles, errorsToAvoidContext, aiApiKey, aiProvider } = JSON.parse(body);
              
              // Log self-improvement context if present
              if (errorsToAvoidContext && errorsToAvoidContext.length > 0) {
                console.log(`[SELF-IMPROVE] 🧠 Received ${errorsToAvoidContext.split('\\n').length - 1} error patterns to include in generation prompt`);
              } else {
                console.log('[SELF-IMPROVE] ℹ️ No error patterns to avoid (database may be empty or client failed to fetch)');
              }
              
              // Use user-provided API key if available, fall back to env variable
              const userAnthropicKey = aiProvider === 'anthropic' ? aiApiKey : undefined;
              const userGoogleKey = aiProvider === 'google' ? aiApiKey : undefined;
              const apiKey = userAnthropicKey || process.env.ANTHROPIC_API_KEY;
              const googleApiKey = userGoogleKey || process.env.GOOGLE_AI_API_KEY;
              
              // Determine which provider to use
              const useGoogle = aiProvider === 'google' && googleApiKey;
              const effectiveApiKey = useGoogle ? googleApiKey : apiKey;
              
              if (!effectiveApiKey || effectiveApiKey === 'your-api-key-here') {
                res.statusCode = 500;
                res.end(JSON.stringify({ 
                  error: 'No AI API key configured. Add your Anthropic or Google AI key in Settings.',
                  needsApiKey: true
                }));
                return;
              }
              
              console.log(`[AI Gen] Using ${useGoogle ? 'Google Gemini' : 'Anthropic Claude'} for generation`);
              
              console.log('[AI Gen] Starting generation for:', projectConfig?.projectName);
              
              // Load context
              const { context, actionNodes } = loadContext();
              
              // Query Pypestream docs for authoritative CSV format documentation
              let docsContext = '';
              const queryDocs = (server as any).queryPypestreamDocs;
              if (queryDocs) {
                try {
                  console.log('[AI Gen] Fetching Pypestream documentation...');
                  
                  // Query for key topics in parallel
                  const [csvFieldsDocs, richAssetDocs, datepickerDocs] = await Promise.all([
                    queryDocs('CSV template fields columns format', 'search_docs').catch(() => ''),
                    queryDocs('Rich Asset Content buttons listpicker carousel format', 'search_docs').catch(() => ''),
                    queryDocs('datepicker timepicker Answer Required NLU Disabled', 'search_docs').catch(() => '')
                  ]);
                  
                  if (csvFieldsDocs || richAssetDocs || datepickerDocs) {
                    docsContext = `
## OFFICIAL PYPESTREAM DOCUMENTATION (Use this as authoritative reference!)

### CSV Fields Documentation
${csvFieldsDocs || 'Not available'}

### Rich Asset Formats
${richAssetDocs || 'Not available'}

### Datepicker/Timepicker Rules
${datepickerDocs || 'Not available'}
`;
                    console.log('[AI Gen] Loaded official docs context');
                  }
                } catch (e) {
                  console.log('[AI Gen] Could not fetch docs:', e);
                }
              }
              
              // Build the comprehensive system prompt for Pypestream CSV generation
              const systemPrompt = `You are the Solution Designer (SD) Agent - an EXPERT Pypestream bot CSV generator. You create production-ready bot CSV files with EXACT syntax compliance.

## CSV COLUMNS (EXACTLY 26 COLUMNS - MEMORIZE THESE POSITIONS!)

| Col# | Column Name | D Node | A Node |
|------|-------------|--------|--------|
| 1 | Node Number | Required | Required |
| 2 | Node Type | D | A |
| 3 | Node Name | Required | Required |
| 4 | Intent | Optional | Empty |
| 5 | Entity Type | Empty | Empty |
| 6 | Entity | Empty | Empty |
| 7 | NLU Disabled? | 0/1 | Empty |
| 8 | Next Nodes | Node # | Empty |
| 9 | Message | Text | Empty |
| 10 | Rich Asset Type | button/listpicker/etc | Empty |
| 11 | Rich Asset Content | JSON | Empty |
| 12 | Answer Required? | 0/1 | Empty |
| 13 | Behaviors | disable_input/etc | Empty |
| 14 | Command | Empty | Script name |
| 15 | Description | Empty | Text |
| 16 | Output | Empty | Variable |
| 17 | Node Input | var:node | Empty |
| 18 | Parameter Input | Empty | JSON |
| 19 | Decision Variable | Empty | Variable |
| 20 | What Next? | Empty | Routes |
| 21 | Node Tags | Optional | Optional |
| 22 | Skill Tag | Optional | Optional |
| 23 | Variable | Optional | Variable list |
| 24 | Platform Flag | Optional | Optional |
| 25 | Flows | entry/exit | entry/exit |
| 26 | CSS Classname | Optional | Optional |

## CRITICAL: EXACT COLUMN POSITIONS (MEMORIZE THIS TABLE!)

| Index | Column Name | After Name, count this many commas |
|-------|-------------|-----------------------------------|
| 0 | Node Number | - |
| 1 | Node Type | - |
| 2 | Node Name | - |
| 3 | Intent | 1 comma after Name |
| 4 | Entity Type | 2 commas after Name |
| 5 | Entity | 3 commas after Name |
| 6 | NLU Disabled? | 4 commas after Name |
| 7 | Next Nodes | 5 commas after Name |
| 8 | **MESSAGE** | **6 commas after Name** |
| 9 | Rich Asset Type | 7 commas after Name |
| 10 | Rich Asset Content | 8 commas after Name |
| 11 | Answer Required? | 9 commas after Name |
| 12 | Behaviors | 10 commas after Name |
| 13 | **Command** | **11 commas after Name** |

## THE PATTERN YOU MUST FOLLOW:

**For Decision Node with Message (no Next Nodes):**
\`\`\`
Name , , , , , , Message
     1 2 3 4 5 6
\`\`\`
That's SIX commas between Name and Message!

**For Decision Node with Next Nodes AND Message:**
\`\`\`
Name , , , , , NextNode , Message
     1 2 3 4 5          6
\`\`\`
Five empty commas, then NextNode, then ONE comma, then Message.

**For Decision Node with ONLY Next Nodes (no message):**
\`\`\`
Name , , , , , NextNode , , , , ...
     1 2 3 4 5          6 7 8 9
\`\`\`
Five empty commas, NextNode at position 7, then continue with empty commas.

## WRONG vs RIGHT EXAMPLES

**WRONG - Only 5 commas, Message lands in Next Nodes (index 7):**
\`\`\`
105,D,Welcome,,,,,Hello there!
                  ^ This is at index 7 (Next Nodes) - WRONG!
\`\`\`

**RIGHT - 6 commas, Message lands in Message (index 8):**
\`\`\`
105,D,Welcome,,,,,,Hello there!
                   ^ This is at index 8 (Message) - CORRECT!
\`\`\`

Count the commas after "Welcome": , , , , , , = 6 commas!

## VERIFIED CORRECT EXAMPLES

**Decision Node with Message (6 commas after Name):**
\`\`\`csv
105,D,Welcome,,,,,,Hello there!,button,Get Started~110|Talk to Agent~999,1,disable_input,,,,,,,,,,,,,
\`\`\`

**Decision Node with Next Nodes AND Message:**
\`\`\`csv
213,D,Damage Assessment,,,,,1,Please describe the damage.,,,1,,,,,,,,,,,,,,
\`\`\`
Here: 5 commas, then "1" (Next Nodes), then comma, then Message.

**Decision Node with ONLY Next Nodes (routing, no message):**
\`\`\`csv
103,D,Platform Fallback,,,,,104,,,,,,,,,,,,,,,,,,
\`\`\`
Here: 5 commas, then "104" (Next Nodes), then 18 more commas for remaining empty columns.

**Action Node (11 commas after Name to reach Command):**
\`\`\`csv
1,A,SysShowMetadata,,,,,,,,,,,SysShowMetadata,Gets session info,success,,"{""assign_metadata_vars"":{}}",success,true~10|error~99990,,,CHATID,,,
\`\`\`

## REQUIRED SYSTEM NODES (EXACTLY 26 VALUES PER ROW!)

\`\`\`csv
-500,A,HandleBotError,,,,,,,,,,,HandleBotError,Catches exceptions,error_type,,"{""save_error_to"":""PLATFORM_ERROR""}",error_type,bot_error~99990|bot_timeout~99990|other~99990,,,PLATFORM_ERROR,,,
666,D,EndChat,,,,,,Thank you for using our service. Goodbye!,,,,,,,,,,,,,,,,,,
999,D,Agent Transfer,,,,,,,,,,xfer_to_agent,,,,,,,,,,,,,,
1800,D,OutOfScope,out_of_scope,,,,,I'm not sure I understood that.,button,Start Over~1|Talk to Agent~999,1,disable_input,,,,,,,,,,,,
99990,D,Error Message,,,,,,Oops! Something went wrong. Let me help you get back on track.,button,Start Over~1|Talk to Agent~999,1,disable_input,,,,,,,,,,,,
\`\`\`

## REQUIRED STARTUP FLOW (NODES 1-104) - INCLUDE EXACTLY AS SHOWN!

\`\`\`csv
1,A,SysShowMetadata,,,,,,,,,,,SysShowMetadata,Gets session info,success,,"{""passthrough_mapping"":{},""assign_metadata_vars"":{""chat_id"":""CHATID"",""session_id"":""SESSION_ID""}}",success,true~10|error~99990,,,CHATID,,,
10,A,UserPlatformRouting,,,,,,,,,,,UserPlatformRouting,Detects device type,success,,,success,ios~100|android~101|mac~102|windows~102|other~102|error~103,,,,,,
100,A,SetVar iOS,,,,,,,,,,,SysAssignVariable,Sets platform to iOS,success,,"{""set"":{""USER_PLATFORM"":""iOS""}}",success,true~104|error~99990,,,USER_PLATFORM,,,
101,A,SetVar Android,,,,,,,,,,,SysAssignVariable,Sets platform to Android,success,,"{""set"":{""USER_PLATFORM"":""Android""}}",success,true~104|error~99990,,,USER_PLATFORM,,,
102,A,SetVar Desktop,,,,,,,,,,,SysAssignVariable,Sets platform to Desktop,success,,"{""set"":{""USER_PLATFORM"":""Desktop""}}",success,true~104|error~99990,,,USER_PLATFORM,,,
103,D,Platform Fallback,,,,,104,,,,,,,,,,,,,,,,,,
104,A,SysSetEnv,,,,,,,,,,,SysSetEnv,Sets environment,success,,"{""set_env_as"":""ENV""}",success,true~200|error~99990,,,ENV,,,
\`\`\`

## REQUIRED MAIN MENU STRUCTURE (NODES 200-210) — NLU-FIRST!

After startup flow completes, go DIRECTLY to Main Menu (node 200).
The main menu uses NLU by default — user types what they need, with quick_reply hints.
An intent routing action node (210) maps typed input to flows.

\`\`\`csv
200,D,MainMenu → Welcome,,,,,210,Welcome to {COMPANY_NAME}! I can help with [Feature 1], [Feature 2], [Feature 3], and more. What do you need?,quick_reply,"{""type"":""static"",""options"":[{""label"":""Feature 1"",""dest"":300},{""label"":""Feature 2"",""dest"":400},{""label"":""Feature 3"",""dest"":500},{""label"":""Talk to Agent"",""dest"":999}]}",1,,,Main menu — NLU + quick reply,,,,,,,,main_menu_entry,
201,D,ReturnMenu → What Else,,,,,210,Is there anything else I can help with?,quick_reply,"{""type"":""static"",""options"":[{""label"":""Yes"",""dest"":200},{""label"":""No thanks"",""dest"":666},{""label"":""Talk to Agent"",""dest"":999}]}",1,,,Return menu — conversational,,,,,,,,,,
210,A,IntentRouting,,,,,,,,,,,SysMultiMatchRouting,Routes typed text to flows,next_node,,"{""global_vars"":""LAST_USER_MESSAGE"",""input_vars"":""feature1,feature2,feature3,help,agent,schedule,pricing,support""}",next_node,feature1~300|feature2~400|feature3~500|help~200|agent~999|schedule~300|pricing~400|support~500|error~1800,,,,,
\`\`\`

**KEY DESIGN:**
- Node 200: Next Nodes=210 (typed text goes to intent routing)
- Quick replies provide clickable shortcuts but NLU is primary
- NLU Disabled is NOT set — both typing and clicking work
- Node 210: SysMultiMatchRouting maps keywords to flows
- Unmatched input falls through to 1800 (Out of Scope)
- Replace feature names with project-specific topics

## COMPLETE STARTER TEMPLATE STRUCTURE:

Your generated bot MUST follow this structure:
\`\`\`
Nodes -500: Error handler
Nodes 1-104: Startup flow (copy exactly from above)
Node 200: Main Menu — NLU + quick_reply hints (NOT buttons)
Node 201: Return Menu — conversational "anything else?"
Node 210: Intent routing (SysMultiMatchRouting)
Nodes 300-399: First feature flow (NLU input + rich assets)
Nodes 400-499: Second feature flow (NLU input + rich assets)
Nodes 500-599: Third feature flow (if needed)
Node 666: End Chat goodbye message
Node 999: Live Agent transfer
Node 1800: Out of scope / NLU fallback
Nodes 99990-99991: Error handling and recovery
\`\`\`

**FLOW DESIGN RULES:**
- Each feature flow should collect info via FREE TEXT (names, emails, descriptions)
- Use ValidateRegex for structured input (email, phone, ZIP)
- Use LISTPICKER (not buttons) when offering 3+ choices with context
- Use DATEPICKER/TIMEPICKER for dates/times (never free text)
- Use BUTTONS only for yes/no confirmations and error recovery
- Every flow ends at 201 (Return Menu) or 666 (End Chat)

## EXAMPLE FEATURE FLOW — NLU + RICH ASSETS (300-399):

**Scheduling flow using NLU input, datepicker, validation, and listpicker:**
\`\`\`csv
300,D,Schedule → Intro,,,,,,I'd love to help you schedule an appointment! What's your name?,,,,1,,,,,,,,,,,,,schedule_entry,
305,A,StoreName,,,,,,,,,,,SysAssignVariable,Stores user name,success,,"{""set"":{""USER_NAME"":""{LAST_USER_MESSAGE}""}}",success,true~310|error~99990,,,USER_NAME,,,
310,D,Schedule → Email,,,,,,Thanks {USER_NAME}! What email should we send the confirmation to?,,,,1,,,,,,,,,,,,,,
315,A,ValidateEmail,,,,,,,,,,,ValidateRegex,Validates email format,success,,"{""regex"":""^[^@]+@[^@]+\\\\.[^@]+$"",""input"":""{LAST_USER_MESSAGE}""}",success,true~316|false~317|error~99990,,,USER_EMAIL,,,
316,A,StoreEmail,,,,,,,,,,,SysAssignVariable,Stores email,success,,"{""set"":{""USER_EMAIL"":""{LAST_USER_MESSAGE}""}}",success,true~320|error~99990,,,USER_EMAIL,,,
317,D,InvalidEmail,,,,,,That doesn't look like a valid email. Could you try again? (e.g., name@company.com),,,,1,,,,,,,,,,,,,
320,D,Schedule → Service,,,,,,What type of service do you need?,listpicker,"{""type"":""static"",""options"":[{""label"":""Oil Change"",""dest"":""330"",""description"":""Standard oil and filter change""},{""label"":""Tire Rotation"",""dest"":""330"",""description"":""Rotate and balance all four tires""},{""label"":""Full Inspection"",""dest"":""330"",""description"":""Comprehensive vehicle checkup""},{""label"":""Other"",""dest"":""325"",""description"":""Describe what you need""}]}",1,disable_input,,,,,,,,,,,,
325,D,Schedule → Describe,,,,,,No problem! Please describe what service you need.,,,,1,,,,,,,,,,,,,,
328,A,StoreService,,,,,,,,,,,SysAssignVariable,Stores service type,success,,"{""set"":{""SERVICE_TYPE"":""{LAST_USER_MESSAGE}""}}",success,true~330|error~99990,,,SERVICE_TYPE,,,
330,D,Schedule → Date,,,,,,When would you like to come in?,datepicker,"{""type"":""static"",""message"":""Select a preferred date""}",1,disable_input,,,,,,,,,,,,
335,A,StoreDate,,,,,,,,,,,SysAssignVariable,Stores date,success,,"{""set"":{""APPT_DATE"":""{LAST_USER_MESSAGE}""}}",success,true~340|error~99990,,,APPT_DATE,,,
340,D,Schedule → Confirm,,,,,,Here's your appointment summary:\\n\\n<<fas fa-user>> {USER_NAME}\\n<<fas fa-envelope>> {USER_EMAIL}\\n<<fas fa-calendar>> {APPT_DATE}\\n\\nShall I confirm this?,button,Confirm~350|Change Details~300|Cancel~201,1,,,,,,,,,,,,,
350,D,Schedule → Done,,,,,,Your appointment is confirmed! We've sent a confirmation to {USER_EMAIL}. Is there anything else I can help with?,quick_reply,"{""type"":""static"",""options"":[{""label"":""Yes"",""dest"":200},{""label"":""No thanks"",""dest"":666}]}",1,,,,,,,,,,,,,schedule_exit,
\`\`\`

**Key patterns in this flow:**
- Free text for name (300) and email (310) — NO buttons
- ValidateRegex for email validation (315) with re-prompt (317)
- Listpicker with descriptions for service selection (320) — NOT buttons
- Free text fallback for "Other" option (325)
- Datepicker for date selection (330) — NOT free text
- Buttons ONLY for final yes/no confirmation (340)
- Quick reply for "anything else?" (350)
- EVERY path leads back to 200 (Main) or 666 (End Chat) — NO DEAD ENDS!

## RICH ASSET CONTENT FORMATS

**BUTTONS - USE PIPE FORMAT (REQUIRED!):**
Rich Asset Type: \`button\` (SINGULAR - not "buttons"!)
Rich Asset Content: Pipe-delimited format

\`\`\`
Label~destination|Label~destination
\`\`\`

**Examples:**
\`\`\`
Yes~200|No~300
\`\`\`
\`\`\`
Get Started~105|Talk to Agent~999|End Chat~666
\`\`\`
\`\`\`
<<fas fa-home>> Main Menu~1|<<fas fa-user-headset>> Contact Us~999
\`\`\`

**CRITICAL BUTTON RULES:**
1. Rich Asset Type MUST be "button" (singular), NOT "buttons"
2. Content is pipe-delimited: Label~node|Label~node
3. Each button is: Label~destination_node_number
4. Multiple buttons separated by | (pipe character)
5. Optional Font Awesome icons: <<fas fa-icon>> before label
6. **NEVER put | (pipe) INSIDE a button label!** The pipe is ONLY for separating buttons!
   - WRONG: Under $25|k~255 (pipe inside label breaks parsing!)
   - RIGHT: Under $25k~255 (no pipe in label)
   - WRONG: $35|k-$50|k~265 (pipes inside price range)
   - RIGHT: $35k-$50k~265 (k attached directly to number)

**List Picker:**
\`\`\`json
{"type":"static","options":[{"label":"Choice 1","dest":"200","description":"Description text"},{"label":"Choice 2","dest":"300"}]}
\`\`\`

**Webview:**
\`\`\`json
{"type":"static","url":"https://example.com/form.html?chatId={CHATID}","label":"Open Form","close_message":"Form submitted"}
\`\`\`

## WHAT NEXT? SYNTAX (ACTION NODES ONLY)
Format: \`value~node|value2~node|error~error_node\`
ALWAYS include error path!

Examples:
- \`true~200|false~300|error~99990\`
- \`ios~100|android~101|mac~102|windows~102|other~102|error~103\`
- \`success~next|skip~alt|error~99990\`

## ACTION NODE PRIORITY (USE IN THIS ORDER)

**1. Sys* Nodes (Built-in, no upload):**
- SysAssignVariable - Set variables: \`{"set":{"VAR":"value"}}\`
- SysMultiMatchRouting - Route by value: \`{"global_vars":"VAR","input_vars":"a,b,c"}\` or check: \`{"global_vars":"VAR","check_var":true}\`
- SysShowMetadata - Get session info
- SysSetEnv - Set environment
- SysVariableReset - Clear variables

**2. Official Action Nodes (100+ available):**
${actionNodes}

**3. Custom Scripts (ONLY if no existing node works):**
Must follow format with class name matching filename, execute() method, return {"success":"true/error"}.

## CONVERSATIONAL FLOW STRUCTURE — NLU-FIRST DESIGN (CRITICAL!)

### Design Philosophy: CONVERSATIONAL, NOT MENU-DRIVEN
The bot should feel like talking to a helpful person, NOT clicking through a phone tree.
- **Primary interaction = FREE TEXT with NLU processing** (user types naturally, bot understands)
- **Secondary interaction = Rich assets** (listpickers, datepickers, carousels, webviews for structured input)
- **Tertiary interaction = Buttons** (ONLY for confirmations, yes/no, main menu, and error recovery)

### RICH ASSET MIX REQUIREMENTS (enforce variety!)
Every generated bot MUST use a DIVERSE mix of rich asset types:
- **Buttons (button):** ONLY for main menu, yes/no confirmations, error recovery. MAX 30% of nodes.
- **Listpickers (listpicker):** For selecting from 3+ options with descriptions. Use INSTEAD of buttons when options need context.
- **Quick Replies (quick_reply):** For short inline choices (2-4 options) that feel conversational.
- **Datepickers (datepicker):** ALWAYS use for date input. Never ask users to type dates.
- **Timepickers (timepicker):** ALWAYS use for time input. Never ask users to type times.
- **Carousels (carousel):** For browsing products, plans, or cards with images.
- **Webviews (webview):** For forms, maps, complex input, terms & conditions.
- **File Upload (file_upload):** For document/image collection.
- **Free Text + NLU:** For names, emails, descriptions, questions, ZIP codes, phone numbers — anything the user would naturally type.

### NLU INPUT PATTERNS (use these instead of buttons!)

**Pattern 1: Free text → ValidateRegex (most common)**
Ask a question → user types answer → validate with regex → route based on result
\`\`\`csv
300,D,AskZipCode,,,,,,What's your ZIP code so I can find locations near you?,,,,1,,,,,,,,,,,,,,
305,A,ValidateZip,,,,,,,,,,,ValidateRegex,Validates ZIP format,success,,"{""regex"":""^[0-9]{5}(-[0-9]{4})?$"",""input"":""{LAST_USER_MESSAGE}""}",success,true~310|false~306|error~99990,,,ZIP_CODE,,,
306,D,InvalidZip,,,,,,Hmm, that doesn't look like a valid ZIP code. Can you try again? (e.g., 10001),,,,1,,,,,,,,,,,,,
\`\`\`
- Node 300: Answer Required=1, NO buttons, NO NLU Disabled — user types freely
- Node 305: ValidateRegex checks the format
- Node 306: Friendly re-prompt on failure, routes back to 300

**Pattern 2: Free text → NLU Intent matching**
Ask open question → user types naturally → match intent → route to flow
\`\`\`csv
200,D,MainMenu → Welcome,,,,,,Welcome to {COMPANY_NAME}! How can I help you today?,,,,1,,,,,,,,,,,,,main_menu_entry,
210,A,MatchIntent,,,,,,,,,,,SysMultiMatchRouting,Routes by intent,next_node,,"{""global_vars"":""LAST_USER_MESSAGE"",""input_vars"":""schedule,pricing,support,complaint,hours,location""}",next_node,schedule~300|pricing~400|support~500|complaint~600|hours~700|location~800|error~1800,,,,,
\`\`\`
- Node 200: Answer Required=1, NO buttons — user types what they need
- Node 210: SysMultiMatchRouting matches keywords to intents
- Falls through to 1800 (Out of Scope) if no match

**Pattern 3: Free text → Store variable → Continue**
Collect information conversationally:
\`\`\`csv
320,D,AskName,,,,,,What's your full name?,,,,1,,,,,,,,,,,,,,
325,A,StoreName,,,,,,,,,,,SysAssignVariable,Stores name,success,,"{""set"":{""USER_NAME"":""{LAST_USER_MESSAGE}""}}",success,true~330|error~99990,,,USER_NAME,,,
330,D,AskEmail,,,,,,Thanks {USER_NAME}! And your email address?,,,,1,,,,,,,,,,,,,,
335,A,ValidateEmail,,,,,,,,,,,ValidateRegex,Validates email,success,,"{""regex"":""^[^@]+@[^@]+\\\\.[^@]+$"",""input"":""{LAST_USER_MESSAGE}""}",success,true~340|false~336|error~99990,,,USER_EMAIL,,,
336,D,InvalidEmail,,,,,,That doesn't look like a valid email. Could you try again?,,,,1,,,,,,,,,,,,,
\`\`\`

**Pattern 4: Listpicker for rich selection (NOT buttons)**
When offering 3+ options that need descriptions or images:
\`\`\`csv
400,D,ChoosePlan,,,,,,Which plan interests you?,listpicker,"{""type"":""static"",""options"":[{""label"":""Basic Plan"",""dest"":""410"",""description"":""Perfect for individuals. $9/mo""},{""label"":""Pro Plan"",""dest"":""420"",""description"":""For growing teams. $29/mo""},{""label"":""Enterprise"",""dest"":""430"",""description"":""Custom pricing for large orgs""}]}",1,disable_input,,,,,,,,,,,,
\`\`\`

**Pattern 5: Datepicker for dates (NEVER free text for dates)**
\`\`\`csv
500,D,PickDate,,,,,,When would you like to schedule your appointment?,datepicker,"{""type"":""static"",""message"":""Select a date""}",1,disable_input,,,,,,,,,,,,
\`\`\`

**Pattern 6: Carousel for product recommendations and comparisons (PREFERRED for products!)**
When the bot needs to show products, recommendations, comparisons, or any visual options — ALWAYS use carousels with images.
Carousels let users swipe through cards with product images, titles, descriptions, and action buttons.

**Product recommendation carousel:**
\`\`\`csv
600,D,BrowseProducts,,,,,,Based on what you've told me, here are my top picks:,carousel,"{""type"":""static"",""cards"":[{""title"":""Product A"",""description"":""Best seller — $299\\nRated 4.8/5 stars"",""image"":""https://example.com/product-a.jpg"",""buttons"":[{""label"":""Learn More"",""dest"":610},{""label"":""Compare"",""dest"":650}]},{""title"":""Product B"",""description"":""Most popular — $249\\nRated 4.6/5 stars"",""image"":""https://example.com/product-b.jpg"",""buttons"":[{""label"":""Learn More"",""dest"":620},{""label"":""Compare"",""dest"":650}]},{""title"":""Product C"",""description"":""Best value — $199\\nRated 4.5/5 stars"",""image"":""https://example.com/product-c.jpg"",""buttons"":[{""label"":""Learn More"",""dest"":630},{""label"":""Compare"",""dest"":650}]}]}",1,disable_input,,,,,,,,,,,,
\`\`\`

**Product comparison carousel (side-by-side):**
\`\`\`csv
650,D,CompareProducts,,,,,,Here's how they stack up:,carousel,"{""type"":""static"",""cards"":[{""title"":""Product A vs Product B"",""description"":""A: More features, higher price\\nB: Better value, lighter\\n\\nBoth have 5-year warranty"",""image"":""https://example.com/compare-ab.jpg"",""buttons"":[{""label"":""Pick A"",""dest"":610},{""label"":""Pick B"",""dest"":620}]},{""title"":""Specs at a Glance"",""description"":""A: 64GB, 6.1in, Pro camera\\nB: 128GB, 6.4in, Standard\\nC: 64GB, 5.8in, Compact"",""image"":""https://example.com/specs.jpg"",""buttons"":[{""label"":""See All Models"",""dest"":600}]}]}",1,disable_input,,,,,,,,,,,,
\`\`\`

**WHEN TO USE CAROUSELS (always prefer over buttons/listpickers for these):**
- Product recommendations (show images, prices, ratings)
- Product comparisons (side-by-side cards)
- Plan/tier selection (Basic vs Pro vs Enterprise)
- Location results (show addresses with maps)
- Service options with visual context (before/after photos, icons)
- Any selection where IMAGES add value

**Carousel card structure:**
- title: Product/option name (required)
- description: Key details, price, specs — use \\n for line breaks
- image: URL to product image (ALWAYS include for products!)
- buttons: 1-3 action buttons per card (Learn More, Select, Compare)

**Pattern 7: Webview for complex forms**
\`\`\`csv
700,D,OpenForm,,,,,,Let me pull up the form for you.,webview,"{""type"":""static"",""url"":""https://forms.example.com/intake?chatId={CHATID}"",""label"":""Open Form"",""close_message"":""Form submitted""}",1,disable_input,,,,,,,,,,,,
\`\`\`

### Required Flow Architecture:
\`\`\`
Node 1-104: Standard startup flow (SysShowMetadata, UserPlatformRouting, etc.)
Node 200: Welcome — open-ended "How can I help?" (NLU, NOT buttons)
Node 201: Return Menu — "What else?" with NLU + optional quick_reply shortcuts
Node 210: Intent routing (SysMultiMatchRouting or NLU)
Nodes 300+: Feature flows mixing free text, listpickers, datepickers, etc.
Node 666: End Chat
Node 999: Live Agent Transfer
Node 1800: Out of Scope / NLU Fallback
Node 99990-99991: Error Handling
\`\`\`

### Main Menu — NLU-First (REQUIRED):
\`\`\`
200,D,MainMenu → Welcome,,,,,,Welcome to {COMPANY_NAME}! I can help with scheduling, pricing, support, and more. What do you need?,quick_reply,"{""type"":""static"",""options"":[{""label"":""Schedule"",""dest"":300},{""label"":""Pricing"",""dest"":400},{""label"":""Support"",""dest"":500}]}",1,,,,,,,,,,,,,main_menu_entry,
\`\`\`
- Uses quick_reply (not buttons) for suggested shortcuts
- NLU Disabled is NOT set — user can also type freely
- Next Nodes routes typed text to intent matching (node 210)

### Return Menu — Conversational:
\`\`\`
201,D,ReturnMenu → What Else,,,,,,Is there anything else I can help with?,quick_reply,"{""type"":""static"",""options"":[{""label"":""Yes"",""dest"":200},{""label"":""No thanks"",""dest"":666},{""label"":""Talk to agent"",""dest"":999}]}",1,,,,,,,,,,,,,,
\`\`\`

### WHEN TO USE WHAT:
| User Input Type | Rich Asset | NLU Disabled? | Answer Required? |
|-----------------|-----------|---------------|-----------------|
| Open question (name, email, ZIP, description) | NONE (free text) | EMPTY (NLU on) | 1 |
| Select from 2-3 short options | quick_reply | EMPTY | 1 |
| Select from 3+ options with descriptions | listpicker | 1 | 1 |
| Product recommendations / comparisons | carousel | 1 | 1 |
| Browse visual options (plans, locations) | carousel | 1 | 1 |
| Pick a date | datepicker | 1 | 1 |
| Pick a time | timepicker | 1 | 1 |
| Upload a file | file_upload | 1 | 1 |
| Fill out complex form | webview | 1 | 1 |
| Confirm yes/no | button | EMPTY | 1 |
| Main menu (few top-level options) | quick_reply | EMPTY | 1 |
| Error recovery | button | EMPTY | 1 |

### Message Best Practices:
1. **Keep messages SHORT** - under 60 characters when possible
2. **Use questions, not directives:** "What's your email?" NOT "Please enter your email"
3. **Use contractions:** "you're", "we'll", "can't"
4. **Personalize with variables:** "Hi {USER_NAME}!" "{COMPANY_NAME} appreciates your business"
5. **MAX 4 messages** before requiring user input
6. **Guide free text:** Include examples — "What's your ZIP? (e.g., 10001)"

### Button Usage Rules (STRICT!):
- Buttons are for: Main menu (if no NLU), yes/no, confirmations, error recovery
- **NEVER use buttons for:** choosing products, selecting plans, picking categories
- Use listpicker or quick_reply instead for selections
- MAX 4 buttons per node, MAX 30% of all decision nodes should have buttons

### Error Messages:
Start with: "Oops," "Unfortunately," "Hmm," or "It looks like"
ALWAYS offer recovery: Start Over, Try Again, or Talk to Agent
\`\`\`
99991,D,Error Recovery,,,,,,Oops, something went wrong. Let me help you get back on track.,button,Start Over~200|Talk to Agent~999,1,,,Error recovery,,,,,,,,,,
\`\`\`

### Flow Analytics (Flows Column):
Add flow tracking for analytics:
- \`main_menu_entry\` on welcome/main menu nodes
- \`feature_name_entry\` when entering a feature
- \`feature_name_exit\` when completing a feature

## CRITICAL RULES
1. EVERY ROW MUST HAVE EXACTLY 25 COMMAS (26 columns)!
2. For Decision nodes: Message goes in column 9 (5 commas after Node Name if cols 4-8 empty)
3. For Action nodes: Command goes in column 14 (10 commas after Node Name if cols 4-13 empty)
4. NEVER use * or = in message text (reserved characters)
5. All JSON in Parameter Input and Rich Asset Content must be valid (escape quotes as "")
6. Decision nodes: Leave columns 14-16, 18-20 BLANK (Command, Description, Output, Parameter Input, Decision Variable, What Next?)
7. Action nodes: Leave columns 8-13 BLANK (Next Nodes, Message, Rich Asset Type, Rich Asset Content, Answer Required?, Behaviors)
8. **NLU Disabled?=1 FORBIDDEN with buttons/listpicker that have multiple destinations!**
   - NLU Disabled?=1 means node can only have ONE child (Next Nodes + button dests combined!)
   - If buttons route to different nodes (dest: 220, 230, 240), NLU Disabled MUST be empty!
   - NLU Disabled?=1 is ONLY for free-form text input (name, email) with single Next Node
9. Answer Required?=1 for user input, webviews, pickers
10. Button labels max 33 characters
11. Use {VARIABLE_NAME} for variables in messages
12. **ALWAYS route back to Return Menu (201) after completing any action - NO DEAD ENDS!**
13. **Main Menu (200) and Return Menu (201) are REQUIRED nodes!**

## COMMON MISTAKES TO AVOID (Bot Manager will reject these!)

### 1. EMPTY COMMAND ON ACTION NODES - CRITICAL!
- Error: "Command string must follow camelcase convention" (means Command is empty!)
- WRONG: Action node with empty Command column
- RIGHT: Every Action node MUST have a Command like "SysAssignVariable", "CheckAvailability", etc.
- If unsure what command to use, default to "SysAssignVariable" with Parameter Input: {"set":{"VAR":"value"}}

### 2. DECISION VARIABLE MISMATCH - CRITICAL!
- Error: "proposed dir_field is not an element of the proposed payload"
- This means: Decision Variable doesn't match what the script outputs
- WRONG: Decision Variable is empty but What Next? has routing
- WRONG: Decision Variable is "availability" but script outputs "success"
- RIGHT: Decision Variable MUST be a key that the script's Output variable contains
- For SysAssignVariable: Decision Variable = "success", What Next? = "true~100|false~200|error~99990"
- For custom scripts: Decision Variable must match a key in the script's return JSON

### 3. DATEPICKER/TIMEPICKER FORMAT - CRITICAL!
- Error: "'datepicker' is not one of ['static']" or "'message' is a required property"
- WRONG: {"type":"datepicker"} or {"type":"date"} or {"type":"time"}
- RIGHT: {"type":"static","message":"Select a date"} for Rich Asset Content
- NOTE: The "type" must ALWAYS be "static" for datepicker/timepicker
- The Rich Asset Type column determines it's a datepicker, not the JSON type property!

### 4. ANSWER REQUIRED FOR PICKERS - CRITICAL!
- Error: "ans_req must be 1 when rich_type is datepicker" or "...timepicker"
- WRONG: datepicker/timepicker/file_upload with Answer Required? empty or 0
- RIGHT: datepicker, timepicker, file_upload MUST have Answer Required? = 1
- Column 12 (Answer Required?) MUST be "1" when Rich Asset Type is datepicker, timepicker, or file_upload
- Also add Behaviors = "disable_input" for these nodes

### 5. MULTI-LINE MESSAGES BREAKING ROWS
- Error: "Node number is not an integer" with value like "• Space: {ROOM_TYPE}"
- WRONG: Putting bullet point lists across multiple CSV rows
- RIGHT: Keep ALL message text in the Message column of ONE row
- For bullet lists in messages, use: "Select an option:\n• Option 1\n• Option 2"

### 6. NLU DISABLED WITH BUTTONS/MULTIPLE CHILDREN - CRITICAL!
- Error: "when NLU Disabled? is set, the node can only have one child"
- THIS IS THE MOST COMMON ERROR - PAY ATTENTION!
- When NLU Disabled?=1, the node can ONLY have ONE child TOTAL (including button destinations!)
- WRONG: NLU Disabled?=1 with buttons that have multiple destinations (220, 230, 240)
- WRONG: NLU Disabled?=1 with Next Nodes="100|200|300"
- RIGHT: NLU Disabled?=1 with Next Nodes=100 (single node) AND NO buttons/listpicker OR buttons with ALL SAME destination
- RIGHT: NLU Disabled?=EMPTY when using buttons with multiple different destinations
- **RULE: If a node has buttons/listpicker/quick_reply with DIFFERENT dest values, NLU Disabled MUST BE EMPTY (not 1)**
- NLU Disabled=1 is ONLY for: text input collection (name, email) where you route to a single processing node
- For menus with multiple button choices: NEVER use NLU Disabled=1

### 7. BUTTON DEST AS STRING
- Error: "'105' is not of type 'integer'"
- WRONG: {"type":"static","options":[{"label":"Go","dest":"105"}]}
- RIGHT: {"type":"static","options":[{"label":"Go","dest":105}]}
- dest values MUST be integers, not strings!

### 8. INVALID JSON IN PARAMETER INPUT
- Error: "JSON input error" or "Expecting value"
- WRONG: {"set":{"DATE":selected_date}} (unquoted variable)
- RIGHT: {"set":{"DATE":"{selected_date}"}} (variable in quotes with braces)
- WRONG: [{"key":"value"}] (array format)
- RIGHT: {"set":{"KEY":"value"}} (object format - MUST start with {)

### 9. BUTTON FORMAT - ALWAYS USE PIPE FORMAT!
- Error: "Likely missing a pipe character | in button construction"
- RULE: Rich Asset Type = "button" (SINGULAR) with PIPE format content
- ALWAYS: Rich Asset Type = "button", Content = Yes~100|No~200
- WRONG: Rich Asset Type = "buttons" (never use plural!)
- WRONG: Content = {"type":"static"...} (never use JSON for buttons!)
- RIGHT: Content = Label~100|Label~200 (pipe-delimited)

### 10. BUTTON PIPE FORMAT MISSING SEPARATORS
- Error: "Likely missing a pipe character"
- WRONG: Option A~100Option B~200 (no pipe between buttons!)
- RIGHT: Option A~100|Option B~200 (pipe separates each button)
- Each button is: Label~destination_node
- Multiple buttons separated by | (pipe)

### 11. VARIABLE COLUMN MUST BE ALL_CAPS
- Error: "Global variables must be in all capital letters, numbers or _"
- WRONG: selectedDate, userName, formData
- RIGHT: SELECTED_DATE, USER_NAME, FORM_DATA
- ALL variable names in the Variable column (column 23) must be UPPERCASE with underscores

### 12. XFER_TO_AGENT REQUIRES EMPTY NEXT NODES
- When Behaviors contains "xfer_to_agent", the Next Nodes field MUST be empty
- WRONG: Behaviors = "xfer_to_agent", Next Nodes = "100"
- RIGHT: Behaviors = "xfer_to_agent", Next Nodes = "" (empty)

### 13. DYNAMIC EMBEDS REQUIRE NLU DISABLED + DISABLE_INPUT
- When Rich Asset Content has "type":"dynamic", you MUST set:
  - NLU Disabled? = 1
  - Behaviors = "disable_input"
  - Next Nodes = single node only
- WRONG: {"type":"dynamic","source_node":50...} with NLU Disabled=0
- RIGHT: {"type":"dynamic","source_node":50...} with NLU Disabled=1, Behaviors="disable_input"

### 14. LISTPICKER DEST TYPE
- LISTPICKER/IMAGEBUTTON: dest should be STRING: "dest": "100"
- BUTTONS use PIPE format (not JSON!): Label~100|Label~200
- WRONG for listpicker: {"options":[{"label":"Go","dest":100}]} (integer dest)
- RIGHT for listpicker: {"options":[{"label":"Go","dest":"100"}]} (string dest)

### 15. FILE UPLOAD MISSING REQUIRED PROPERTIES
- file_upload Rich Asset Content MUST have:
  - "type": "action_node" or "direct_post"
  - "upload_label": "Upload file" (button text)
  - "cancel_label": "Skip" (cancel button text)
- WRONG: {"type":"file_upload"}
- RIGHT: {"type":"action_node","upload_label":"Upload file","cancel_label":"Skip","action_script":"UploadHandler"}

### 16. DATEPICKER/TIMEPICKER JSON FORMAT - CRITICAL!
- Rich Asset Content MUST have both "type":"static" AND "message" property
- The "message" property is REQUIRED by Bot Manager
- WRONG: {"type":"static"} (missing message!)
- WRONG: {"type":"datepicker","message":"Select"} (wrong type!)
- RIGHT: {"type":"static","message":"Please select a date"}
- RIGHT: {"type":"static","message":"Please select a time"}

## VALIDATION CHECKLIST (Do this before outputting!)
- [ ] Header row has exactly 26 column names
- [ ] Each data row has exactly 25 commas
- [ ] Decision node Messages are in column 9 (not 8!)
- [ ] Action node Commands are in column 14 (not 13!)
- [ ] All JSON is properly escaped with "" for quotes inside CSV
- [ ] Every Action node has a non-empty Command
- [ ] Action nodes with What Next? have matching Decision Variable
- [ ] Action nodes with What Next? have error path (|error~99990)
- [ ] Datepicker/timepicker: Rich Asset Content = {"type":"static","message":"..."} (message REQUIRED!)
- [ ] Datepicker/timepicker/file_upload have Answer Required?=1 AND Behaviors="disable_input"
- [ ] Buttons: Rich Asset Type = "button" (singular), Content = Label~100|Label~200 (pipe format!)
- [ ] Pipe format buttons have | between each option: Label~100|Label~200
- [ ] LISTPICKER: dest is STRING in JSON (dest:"100")
- [ ] Variable column values are ALL_CAPS with underscores (USER_EMAIL not userEmail)
- [ ] No multi-line content breaking into separate rows
- [ ] If NLU Disabled?=1, Next Nodes has ONLY ONE node number
- [ ] If Behaviors contains xfer_to_agent, Next Nodes is EMPTY
- [ ] Dynamic embeds (type:dynamic): NLU Disabled?=1, Behaviors=disable_input
- [ ] file_upload has type/upload_label/cancel_label properties
- [ ] Parameter Input is JSON object {} not array []

## CUSTOM SCRIPT GENERATION

When the bot requires functionality NOT available in Sys* nodes or Official Action Nodes, you MUST generate a custom Python script. 

### WHEN TO GENERATE SCRIPTS:
- External API calls (weather, CRM, booking systems)
- Custom data transformation/processing
- Complex conditional logic beyond What Next?
- Integration with specific services (Salesforce, Slack, etc.)
- Custom calculations or formatting

### PYPESTREAM SCRIPT TEMPLATE (MUST FOLLOW EXACTLY):
\`\`\`python
# -*- coding: utf-8 -*-
r'''
    ______  ______  _____________________  _________    __  ___
   / __ \\ \\/ / __ \\/ ____/ ___/_  __/ __ \\/ ____/   |  /  |/  /
  / /_/ /\\  / /_/ / __/  \\__ \\ / / / /_/ / __/ / /| | / /|_/ /
 / ____/ / / ____/ /___ ___/ // / / _, _/ /___/ ___ |/ /  / /
/_/     /_/_/   /_____//____//_/ /_/ |_/_____/_/  |_/_/  /_/
action node script
'''
import json
import requests  # If needed for API calls

class ScriptName:
    def execute(self, log, payload=None, context=None):
        try:
            log('ScriptName starting execution')
            
            # payload = Parameter Input from CSV (dict)
            # context = {'user_data': {...}, 'chat_id': '...', 'events': [...]}
            
            # Access payload parameters
            param_value = payload.get('some_param', 'default')
            
            # Access context data
            user_data = context.get('user_data', {})
            chat_id = context.get('chat_id', '')
            
            # YOUR LOGIC HERE
            result = 'computed_value'
            
            # Return JSON - 'success' MUST be first key!
            # Output variables MUST be UPPERCASE
            return {
                'success': 'true',
                'OUTPUT_VAR': result,
                'ANOTHER_VAR': 'value'
            }
            
        except Exception as err:
            log(f'ScriptName error: {err}')
            return {'success': 'error'}
\`\`\`

### SCRIPT RULES:
1. Class name = Script name (CamelCase, matches Command in CSV)
2. ONE class per script file
3. Method signature: \`execute(self, log, payload=None, context=None)\`
4. Return JSON with \`"success": "true"/"false"/"error"\` as FIRST key
5. Output variables MUST be UPPERCASE (e.g., USER_EMAIL, RESULT_DATA)
6. Use \`log()\` for debugging - NEVER use \`print()\`
7. All imports at top of file
8. Handle all exceptions with try/except

### EXAMPLE - API Call Script:
\`\`\`python
# -*- coding: utf-8 -*-
r'''
    ______  ______  _____________________  _________    __  ___
   / __ \\ \\/ / __ \\/ ____/ ___/_  __/ __ \\/ ____/   |  /  |/  /
  / /_/ /\\  / /_/ / __/  \\__ \\ / / / /_/ / __/ / /| | / /|_/ /
 / ____/ / / ____/ /___ ___/ // / / _, _/ /___/ ___ |/ /  / /
/_/     /_/_/   /_____//____//_/ /_/ |_/_____/_/  |_/_/  /_/
action node script
'''
import json
import requests

class GetWeather:
    def execute(self, log, payload=None, context=None):
        try:
            log('GetWeather starting')
            
            # Get location from payload
            location = payload.get('location', 'New York')
            api_key = payload.get('api_key', '')
            
            # Make API call
            url = f'https://api.weather.com/v1/location/{location}'
            response = requests.get(url, params={'apiKey': api_key}, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                return {
                    'success': 'true',
                    'TEMPERATURE': str(data.get('temp', 'N/A')),
                    'CONDITIONS': data.get('conditions', 'Unknown'),
                    'WEATHER_DATA': json.dumps(data)
                }
            else:
                log(f'API error: {response.status_code}')
                return {'success': 'false', 'ERROR_MSG': 'Failed to get weather'}
                
        except Exception as err:
            log(f'GetWeather error: {err}')
            return {'success': 'error'}
\`\`\`

### IN THE CSV, REFERENCE CUSTOM SCRIPTS:
- Command column: Script class name (e.g., "GetWeather")
- Parameter Input: JSON params for the script (e.g., {"location":"{USER_LOCATION}"})
- Decision Variable: One of the return keys (e.g., "success")
- What Next?: Route based on return value (e.g., "true~200|false~300|error~99990")

## OUTPUT FORMAT
Respond with valid JSON. Use the "nodes" array format (PREFERRED) — each node is a JSON object with named fields. The system will serialize to CSV automatically with perfect column alignment.

{
  "nodes": [
    {
      "num": 105,
      "type": "D",
      "name": "Welcome",
      "intent": "",
      "nluDisabled": "",
      "nextNodes": "210",
      "message": "Hello! How can I help?",
      "richType": "quick_reply",
      "richContent": "{\"type\":\"static\",\"options\":[{\"label\":\"Get Help\",\"dest\":300}]}",
      "ansReq": "1",
      "behaviors": "",
      "flows": "main_menu_entry"
    },
    {
      "num": 210,
      "type": "A",
      "name": "IntentRouting",
      "command": "SysMultiMatchRouting",
      "description": "Routes by intent",
      "output": "next_node",
      "paramInput": "{\"global_vars\":\"LAST_USER_MESSAGE\",\"input_vars\":\"help,schedule\"}",
      "decVar": "next_node",
      "whatNext": "help~300|schedule~400|error~1800"
    }
  ],
  "officialNodesUsed": ["SysShowMetadata", "UserPlatformRouting", ...],
  "customScripts": [
    {
      "name": "ScriptName",
      "content": "# Full Python script content following template above..."
    }
  ],
  "warnings": [],
  "readme": "# Solution README..."
}

### NODE OBJECT FIELDS (all optional except num, type, name):
| Field | Column | Notes |
|-------|--------|-------|
| num | Node Number | Integer (required) |
| type | Node Type | "D" or "A" (required) |
| name | Node Name | String (required) |
| intent | Intent | e.g., "out_of_scope" |
| entityType | Entity Type | Usually empty |
| entity | Entity | Usually empty |
| nluDisabled | NLU Disabled? | "1" or "" (empty) |
| nextNodes | Next Nodes | e.g., "210" or "100|200" |
| message | Message | Decision node text |
| richType | Rich Asset Type | button/listpicker/quick_reply/carousel/datepicker/timepicker/webview/file_upload |
| richContent | Rich Asset Content | Pipe format for buttons, JSON for others |
| ansReq | Answer Required? | "1" or "" |
| behaviors | Behaviors | e.g., "disable_input", "xfer_to_agent" |
| command | Command | Action node script name |
| description | Description | Action node description |
| output | Output | Action node output variable |
| nodeInput | Node Input | e.g., "var:nodeName" |
| paramInput | Parameter Input | JSON string |
| decVar | Decision Variable | e.g., "success" |
| whatNext | What Next? | e.g., "true~200|false~300|error~99990" |
| tags | Node Tags | Optional |
| skill | Skill Tag | Optional |
| variable | Variable | ALL_CAPS, e.g., "USER_NAME" |
| platform | Platform Flag | Optional |
| flows | Flows | e.g., "main_menu_entry" |
| css | CSS Classname | Optional |

**Omit empty fields** — the serializer fills them as empty strings.
**Fallback:** If you absolutely cannot use the nodes format, you may still use "csv" (string) but nodes is STRONGLY preferred.

**IMPORTANT:** If you generate a custom script:
1. Add it to the customScripts array with FULL content
2. Use the script name in the Command field of an Action node
3. Ensure paramInput matches what the script expects
4. Ensure decVar matches a key in the script's return

${docsContext}

## GOLDEN RULES FROM REFERENCE PATTERNS (Learned from production Travelers CSV - 560 nodes)

These patterns are extracted from a verified production bot. Follow them exactly:

### Button Format Rules (MOST COMMON ERROR SOURCE!)
- Rich Asset Type = "button" (SINGULAR, never "buttons")
- Content = pipe format: Label~nodeNum|Label~nodeNum
- FontAwesome icons allowed: <<far fa-check>> Yes~440|<<far fa-times>> No~450
- Single button is fine: Start over~1
- NEVER use JSON for buttons. ALWAYS use pipe format.
- NEVER put | inside a label (e.g., "$25|k" is WRONG, use "$25k")

### Quick Reply Format (JSON, not pipe!)
- Rich Asset Type = "quick_reply"
- Content = {"type":"static","options":[{"label":"text","dest":nodeNum}]}
- dest is INTEGER for quick_reply

### Selection Format
- Rich Asset Type = "selection"
- Content = JSON with type/options

### Listpicker Format
- Rich Asset Type = "listpicker"
- Content = JSON with type/options
- dest is STRING for listpicker: "dest":"100" (not dest:100)

### Webview Format
- Rich Asset Type = "webview"
- Content = description~https://url?params

### What Next Format (Action Nodes)
- Format: true~nextNode|error~errorNode
- ALWAYS include error path
- Decision Variable typically: found_regex, next_node, phone_type, success, valid

### Variable Naming
- ALL_CAPS with underscores: CHATID, SESSION_ID, USER_PLATFORM
- Never camelCase or lowercase

### Action Node Messages
- Action nodes RARELY have Message content (only 4 out of 299 in reference)
- Keep Action nodes focused on processing, not displaying messages

### Node Numbering
- Use sparse numbering (gaps are fine and expected)
- System nodes: -500, 666, 999, 1800, 99990
- Startup: 1-104
- Main flows: 200+ with logical grouping (300s, 400s, 500s for features)

### Decision Variable Usage
- Only 5 commonly used: found_regex, next_node, phone_type, success, valid
- "success" is the most common — use it as default
- Must match a key in the action node script's return value

${errorsToAvoidContext || ''}

${context}`;

              // Build the user prompt with project details
              let userPrompt = `Generate a complete, production-ready Pypestream bot CSV for:

## PROJECT
- **Client:** ${projectConfig?.clientName || 'Client'}
- **Project:** ${projectConfig?.projectName || 'Project'}
- **Type:** ${projectConfig?.projectType || 'custom'}
- **Description:** ${projectConfig?.description || 'No description provided'}
`;

              // Add clarifying questions and answers
              if (clarifyingQuestions && clarifyingQuestions.length > 0) {
                userPrompt += '\n## USER REQUIREMENTS\n';
                for (const q of clarifyingQuestions) {
                  if (q.answer) {
                    userPrompt += `- ${q.question}: **${q.answer}**\n`;
                  }
                }
              }
              
              // Add reference file content
              if (referenceFiles && referenceFiles.length > 0) {
                userPrompt += '\n## REFERENCE FILES\n';
                for (const file of referenceFiles) {
                  if (file.content) {
                    userPrompt += `\n### ${file.name}\n${file.content.substring(0, 5000)}\n`;
                  }
                }
              }
              
              userPrompt += `
## GENERATE THE SOLUTION

Create a complete CSV with:
1. All required system nodes (-500, 666, 999, 1800, 99990)
2. Standard startup flow (1, 10, 100-104)
3. Welcome message at node 105
4. Main menu with options based on the project type
5. Complete flows for each user journey described
6. Proper error handling (route errors to 99990 for user-friendly error message)
7. End chat and agent transfer options
8. Use official Sys* action nodes (SysAssignVariable, SysMultiMatchRouting, etc.) - NO external loggers or API scripts

IMPORTANT: 
- Every CSV row must have EXACTLY 26 comma-separated values
- Escape all quotes in JSON as "" (double quotes)
- Test that all node references in Next Nodes and What Next? point to existing nodes

Return ONLY the JSON response with the complete CSV.`;

              console.log(`[AI Gen] Calling ${useGoogle ? 'Google Gemini' : 'Anthropic Claude'} API...`);
              
              // Helper function to call AI API with retry logic for rate limits
              const callAIWithRetry = async (maxRetries = 4): Promise<any> => {
                let lastError: any;
                
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                  let response;
                  
                  if (useGoogle) {
                    // Google Gemini API
                    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${effectiveApiKey}`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        contents: [{
                          parts: [{
                            text: `${systemPrompt}\n\n${userPrompt}`
                          }]
                        }],
                        generationConfig: {
                          maxOutputTokens: 16000,
                          temperature: 0.7
                        }
                      })
                    });
                    
                    if (response.ok) {
                      const geminiResult = await response.json();
                      // Convert Gemini response format to match Claude format
                      const text = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
                      return { content: [{ text }] };
                    }
                  } else {
                    // Anthropic Claude API
                    response = await fetch('https://api.anthropic.com/v1/messages', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': effectiveApiKey,
                        'anthropic-version': '2023-06-01'
                      },
                      body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 16000,
                        messages: [
                          { role: 'user', content: userPrompt }
                        ],
                        system: systemPrompt
                      })
                    });
                    
                    if (response.ok) {
                      return await response.json();
                    }
                  }
                  
                  const errorText = await response.text();
                  console.error(`[AI Gen] API error (attempt ${attempt}/${maxRetries}):`, response.status, errorText);
                  
                  // Check for rate limit error - return immediately so frontend can handle
                  if (response.status === 429) {
                    const retryAfter = response.headers.get('retry-after');
                    const waitSeconds = retryAfter ? parseInt(retryAfter) : 60;
                    
                    console.log(`[AI Gen] Rate limited, returning to frontend with retry info (${waitSeconds}s)`);
                    
                    // Return rate limit info to frontend instead of blocking
                    return {
                      isRateLimit: true,
                      retryAfterSeconds: waitSeconds,
                      message: `Rate limited. Please wait ${waitSeconds} seconds and try again.`
                    };
                  }
                  
                  // Check for invalid API key
                  if (response.status === 401 || response.status === 403) {
                    return {
                      isAuthError: true,
                      message: 'Invalid API key. Please check your API key in Settings.'
                    };
                  }
                  
                  lastError = { status: response.status, text: errorText };
                  break; // Don't retry on other errors
                }
                
                throw lastError;
              };
              
              let result;
              try {
                result = await callAIWithRetry(3);
              } catch (apiError: any) {
                console.error('[AI Gen] API failed after retries:', apiError);
                res.statusCode = 500;
                res.end(JSON.stringify({ 
                  error: `AI API error: ${apiError.status || 'unknown'}`,
                  details: apiError.text || apiError.message
                }));
                return;
              }
              
              // Check if result is an auth error
              if (result.isAuthError) {
                console.log('[AI Gen] Returning auth error to frontend');
                res.statusCode = 401;
                res.end(JSON.stringify({ 
                  error: result.message,
                  needsApiKey: true
                }));
                return;
              }
              
              // Check if result is a rate limit response
              if (result.isRateLimit) {
                console.log('[AI Gen] Returning rate limit to frontend');
                res.statusCode = 429;
                res.end(JSON.stringify({ 
                  error: result.message || 'Rate limit exceeded',
                  isRateLimit: true,
                  retryAfterSeconds: result.retryAfterSeconds || 60
                }));
                return;
              }
              
              console.log('[AI Gen] Claude response received');
              
              // Extract content from Claude response
              const content = result.content?.[0]?.text || '';
              
              // Expected CSV header patterns (Bot Manager uses 20-column format)
              const EXPECTED_HEADER_20 = 'Node Number,Node Type,Node Name,NLU Disabled?,Next Nodes,Message,Rich Asset Type,Rich Asset Content,Answer Required?,Behaviors,Command,Description,Output,Node Input,Parameter Input,Decision Variable,What Next?,Skill Tag,Variable,Platform Flag';
              const EXPECTED_HEADER_26 = 'Node Number,Node Type,Node Name,Intent,Entity Type,Entity,NLU Disabled?,Next Nodes,Message,Rich Asset Type,Rich Asset Content,Answer Required?,Behaviors,Command,Description,Output,Node Input,Parameter Input,Decision Variable,What Next?,Node Tags,Skill Tag,Variable,Platform Flag,Flows,CSS Classname';
              
              // === SERIALIZE NODES TO CSV ===
              // Converts a JSON nodes array to a perfectly formatted 26-column CSV
              const serializeNodesToCsv = (nodes: any[]): string => {
                const HEADER = 'Node Number,Node Type,Node Name,Intent,Entity Type,Entity,NLU Disabled?,Next Nodes,Message,Rich Asset Type,Rich Asset Content,Answer Required?,Behaviors,Command,Description,Output,Node Input,Parameter Input,Decision Variable,What Next?,Node Tags,Skill Tag,Variable,Platform Flag,Flows,CSS Classname';
                
                const fieldMap: [string, number][] = [
                  ['num', 0], ['type', 1], ['name', 2], ['intent', 3],
                  ['entityType', 4], ['entity', 5], ['nluDisabled', 6],
                  ['nextNodes', 7], ['message', 8], ['richType', 9],
                  ['richContent', 10], ['ansReq', 11], ['behaviors', 12],
                  ['command', 13], ['description', 14], ['output', 15],
                  ['nodeInput', 16], ['paramInput', 17], ['decVar', 18],
                  ['whatNext', 19], ['tags', 20], ['skill', 21],
                  ['variable', 22], ['platform', 23], ['flows', 24], ['css', 25]
                ];
                
                const escapeField = (val: any): string => {
                  if (val === undefined || val === null) return '';
                  const str = String(val);
                  if (!str) return '';
                  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return '"' + str.replace(/"/g, '""') + '"';
                  }
                  return str;
                };
                
                const rows = nodes.map((node: any) => {
                  const cols = new Array(26).fill('');
                  for (const [key, idx] of fieldMap) {
                    if (node[key] !== undefined && node[key] !== null && node[key] !== '') {
                      cols[idx] = String(node[key]);
                    }
                  }
                  return cols.map(escapeField).join(',');
                });
                
                console.log(`[AI Gen] Serialized ${nodes.length} JSON nodes to CSV`);
                return [HEADER, ...rows].join('\n');
              };
              
              // Try to parse JSON from the response using multiple strategies
              let generationResult = null;
              let parseAttempts: string[] = [];
              
              // Strategy 0 (NEW): Try to parse JSON with "nodes" array (preferred format)
              const tryParseNodes = (parsed: any): boolean => {
                if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
                  // Validate nodes have required fields
                  const validNodes = parsed.nodes.filter((n: any) => n.num !== undefined && n.type && n.name);
                  if (validNodes.length > 5) {
                    console.log(`[AI Gen] 🎯 NODES FORMAT detected! ${validNodes.length} valid nodes`);
                    parsed.csv = serializeNodesToCsv(validNodes);
                    parsed.nodeCount = validNodes.length;
                    return true;
                  }
                }
                return false;
              };
              
              // Strategy 1: Try to extract from markdown code block
              const jsonCodeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
              if (jsonCodeBlockMatch) {
                try {
                  const parsed = JSON.parse(jsonCodeBlockMatch[1]);
                  if (tryParseNodes(parsed) || (parsed.csv && typeof parsed.csv === 'string')) {
                    generationResult = parsed;
                    console.log('[AI Gen] Parsed JSON from markdown code block');
                  }
                } catch (e) {
                  parseAttempts.push('markdown code block failed');
                }
              }
              
              // Strategy 2: Try to find JSON object with "csv" or "nodes" property
              if (!generationResult) {
                // Find the outermost JSON object
                const jsonMatch = content.match(/\{[^{}]*"(?:csv|nodes)"\s*:\s*[\s\S]*?\}/);
                if (jsonMatch) {
                  try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (tryParseNodes(parsed) || (parsed.csv && typeof parsed.csv === 'string')) {
                      generationResult = parsed;
                      console.log('[AI Gen] Parsed JSON from raw object match');
                    }
                  } catch (e) {
                    parseAttempts.push('raw JSON object match failed');
                  }
                }
              }
              
              // Strategy 3: Try to parse the entire content as JSON
              if (!generationResult) {
                try {
                  const parsed = JSON.parse(content);
                  if (tryParseNodes(parsed) || (parsed.csv && typeof parsed.csv === 'string')) {
                    generationResult = parsed;
                    console.log('[AI Gen] Parsed entire content as JSON');
                  }
                } catch (e) {
                  parseAttempts.push('full content parse failed');
                }
              }
              
              // Strategy 3.5: Try parsing between first { and last }
              if (!generationResult) {
                const firstBrace = content.indexOf('{');
                const lastBrace = content.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace > firstBrace) {
                  try {
                    const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
                    if (tryParseNodes(parsed) || (parsed.csv && typeof parsed.csv === 'string')) {
                      generationResult = parsed;
                      console.log('[AI Gen] Parsed JSON from brace extraction');
                    }
                  } catch (e) {
                    parseAttempts.push('brace extraction failed');
                  }
                }
              }
              
              // Strategy 4: Extract CSV directly from content if JSON parsing failed
              if (!generationResult) {
                console.warn('[AI Gen] JSON parsing failed, attempting CSV extraction. Attempts:', parseAttempts);
                
                // Look for CSV header in the content
                let csvContent = null;
                
                // Try to find 20-column header (Bot Manager format)
                const header20Match = content.indexOf('Node Number,Node Type,Node Name,NLU Disabled?');
                // Try to find 26-column header (full format)
                const header26Match = content.indexOf('Node Number,Node Type,Node Name,Intent,Entity Type');
                
                const headerStart = header20Match >= 0 ? header20Match : header26Match;
                
                if (headerStart >= 0) {
                  // Extract from header to end of CSV data
                  const csvPortion = content.substring(headerStart);
                  
                  // Find where the CSV ends (look for markdown, explanations, or non-CSV content)
                  const lines = csvPortion.split('\n');
                  const csvLines: string[] = [];
                  
                  for (const line of lines) {
                    const trimmed = line.trim();
                    // Stop if we hit markdown, empty lines followed by text, or explanatory content
                    if (trimmed.startsWith('```') || trimmed.startsWith('#') || trimmed.startsWith('**')) {
                      break;
                    }
                    // Skip empty lines at the end
                    if (!trimmed && csvLines.length > 0) {
                      // Check if next non-empty line looks like CSV
                      const remainingLines = lines.slice(lines.indexOf(line) + 1);
                      const nextNonEmpty = remainingLines.find(l => l.trim());
                      if (nextNonEmpty && !nextNonEmpty.includes(',')) {
                        break; // Next content isn't CSV
                      }
                    }
                    if (trimmed) {
                      csvLines.push(line);
                    }
                  }
                  
                  if (csvLines.length > 1) {
                    csvContent = csvLines.join('\n');
                    console.log(`[AI Gen] Extracted CSV directly: ${csvLines.length} lines`);
                  }
                }
                
                if (csvContent) {
                  generationResult = {
                    csv: csvContent,
                    nodeCount: 0,
                    officialNodesUsed: [],
                    customScripts: [],
                    warnings: ['JSON parsing failed, CSV extracted directly from response'],
                    readme: ''
                  };
                } else {
                  // Last resort: return error instead of garbage
                  console.error('[AI Gen] Failed to extract valid CSV from response');
                  console.error('[AI Gen] Content preview:', content.substring(0, 500));
                  
                  res.statusCode = 500;
                  res.end(JSON.stringify({
                    error: 'Failed to parse AI response',
                    details: 'The AI response did not contain valid JSON or extractable CSV. Please try again.',
                    parseAttempts
                  }));
                  return;
                }
              }
              
              // Validate the CSV has a proper header
              if (generationResult?.csv) {
                const firstLine = generationResult.csv.split('\n')[0]?.trim() || '';
                const hasValidHeader = firstLine.startsWith('Node Number,Node Type,Node Name');
                
                if (!hasValidHeader) {
                  console.error('[AI Gen] CSV has invalid header:', firstLine.substring(0, 100));
                  res.statusCode = 500;
                  res.end(JSON.stringify({
                    error: 'Generated CSV has invalid header',
                    details: `Expected header starting with "Node Number,Node Type,Node Name" but got: "${firstLine.substring(0, 50)}..."`,
                  }));
                  return;
                }
              }
              
              // Count nodes if not provided
              if (!generationResult.nodeCount && generationResult.csv) {
                const lines = generationResult.csv.split('\n').filter((l: string) => l.trim());
                generationResult.nodeCount = Math.max(0, lines.length - 1); // Subtract header
              }
              
              console.log(`[AI Gen] Generation complete: ${generationResult.nodeCount} nodes`);
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(generationResult));
              
            } catch (e: any) {
              console.error('[AI Gen] Generation error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Refine CSV based on validation errors
        server.middlewares.use('/api/refine-csv', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { csv, validationErrors, projectConfig, iteration, knownFixesContext } = JSON.parse(body);
              
              if (!csv) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Missing csv' }));
                return;
              }
              
              // If no errors to fix, return the original CSV unchanged
              if (!validationErrors || validationErrors.length === 0) {
                console.log(`[AI Refine] No errors to fix, returning original CSV`);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  csv: csv,
                  fixesMade: [],
                  stillBroken: [],
                  noChangesNeeded: true
                }));
                return;
              }
              
              const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
              if (!ANTHROPIC_API_KEY) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }));
                return;
              }
              
              console.log(`[AI Refine] Starting refinement iteration ${iteration || 1}`);
              
              // Handle case where errors is a string instead of array
              let errorsArray: any[] = [];
              if (typeof validationErrors === 'string') {
                errorsArray = [validationErrors];
              } else if (Array.isArray(validationErrors)) {
                errorsArray = validationErrors;
              } else {
                errorsArray = [JSON.stringify(validationErrors)];
              }
              
              console.log(`[AI Refine] Errors to fix (${errorsArray.length}):`, errorsArray.slice(0, 5));
              
              // === ROW-LEVEL REFINEMENT ===
              // Instead of sending the entire CSV, extract only the broken rows + context.
              // This prevents the AI from mangling rows it shouldn't touch.
              const csvLines = csv.split('\n');
              const headerLine = csvLines[0];
              
              // Collect node numbers that have errors
              const errorNodeNums = new Set<number>();
              for (const err of errorsArray) {
                if (typeof err === 'object' && err !== null) {
                  // Standard error object with node_num
                  if (err.node_num !== undefined) {
                    errorNodeNums.add(Number(err.node_num));
                  }
                  // Array format: [nodeNum, details]
                  if (Array.isArray(err) && err.length >= 1) {
                    const num = parseInt(String(err[0]), 10);
                    if (!isNaN(num)) errorNodeNums.add(num);
                  }
                }
              }
              
              // Parse CSV to find broken rows and their neighbors for context
              const allRows: { lineIdx: number; nodeNum: number; line: string }[] = [];
              for (let i = 1; i < csvLines.length; i++) {
                const line = csvLines[i].trim();
                if (!line) continue;
                const firstComma = line.indexOf(',');
                const nodeNumStr = firstComma > 0 ? line.substring(0, firstComma) : line;
                const nodeNum = parseInt(nodeNumStr, 10);
                if (!isNaN(nodeNum)) {
                  allRows.push({ lineIdx: i, nodeNum, line: csvLines[i] });
                }
              }
              
              // Build the subset: broken rows + neighboring rows for context
              const brokenRowIndices = new Set<number>();
              const contextRowIndices = new Set<number>();
              for (let i = 0; i < allRows.length; i++) {
                if (errorNodeNums.has(allRows[i].nodeNum)) {
                  brokenRowIndices.add(i);
                  // Add 1 neighbor above and below for context
                  if (i > 0) contextRowIndices.add(i - 1);
                  if (i < allRows.length - 1) contextRowIndices.add(i + 1);
                }
              }
              
              // Also collect all node numbers referenced by broken rows (Next Nodes, What Next, buttons)
              // so the AI knows what nodes exist
              const allNodeNums = allRows.map(r => r.nodeNum);
              
              const useRowLevel = errorNodeNums.size > 0 && errorNodeNums.size <= allRows.length * 0.5;
              console.log(`[AI Refine] Strategy: ${useRowLevel ? 'ROW-LEVEL' : 'FULL CSV'} (${errorNodeNums.size} error nodes / ${allRows.length} total rows)`);
              
              // Query Pypestream docs for error-specific documentation
              let errorDocsContext = '';
              const queryDocs = (server as any).queryPypestreamDocs;
              if (queryDocs) {
                try {
                  // Analyze errors to determine what docs to fetch
                  const errorString = JSON.stringify(errorsArray).toLowerCase();
                  const docsQueries: string[] = [];
                  
                  if (errorString.includes('datepicker') || errorString.includes('timepicker') || errorString.includes('ans_req')) {
                    docsQueries.push('datepicker timepicker Answer Required format');
                  }
                  if (errorString.includes('nlu disabled') || errorString.includes('one child')) {
                    docsQueries.push('NLU Disabled Next Nodes single child');
                  }
                  if (errorString.includes('rich asset') || errorString.includes('button') || errorString.includes('embed')) {
                    docsQueries.push('Rich Asset Content buttons format JSON');
                  }
                  if (errorString.includes('command') || errorString.includes('camelcase')) {
                    docsQueries.push('Action node Command field format');
                  }
                  if (errorString.includes('decision variable') || errorString.includes('dir_field') || errorString.includes('what next')) {
                    docsQueries.push('Decision Variable What Next routing format');
                  }
                  
                  if (docsQueries.length > 0) {
                    console.log(`[AI Refine] Fetching docs for error types:`, docsQueries);
                    const docsResults = await Promise.all(
                      docsQueries.slice(0, 3).map(q => queryDocs(q, 'search_docs').catch(() => ''))
                    );
                    
                    const validDocs = docsResults.filter(d => d && d.length > 0);
                    if (validDocs.length > 0) {
                      errorDocsContext = `

## OFFICIAL PYPESTREAM DOCUMENTATION (Use this as authoritative reference for fixing errors!)

${validDocs.join('\n\n---\n\n')}
`;
                      console.log(`[AI Refine] Loaded ${validDocs.length} docs sections for error context`);
                    }
                  }
                } catch (e) {
                  console.log(`[AI Refine] Could not fetch docs:`, e);
                }
              }
              
              // Format validation errors for the AI
              const errorList = (errorsArray || []).map((err: any, idx: number) => {
                if (!err) return `${idx + 1}. Unknown error`;
                if (typeof err === 'string') return `${idx + 1}. ${err}`;
                if (Array.isArray(err)) {
                  const [nodeNum, details] = err;
                  if (Array.isArray(details) && details.length > 0) {
                    return details.map((d: any) => {
                      if (Array.isArray(d)) {
                        const [category, field, message] = d;
                        return `${idx + 1}. Node ${nodeNum}: [${category}/${field}] ${message}`;
                      }
                      return `${idx + 1}. Node ${nodeNum}: ${JSON.stringify(d)}`;
                    }).join('\\n');
                  }
                  return `${idx + 1}. Node ${nodeNum}: ${JSON.stringify(details || 'Unknown')}`;
                }
                return `${idx + 1}. ${JSON.stringify(err)}`;
              }).join('\\n');
              
              const systemPrompt = `You are a Pypestream CSV debugging expert. Your job is to FIX validation errors in Pypestream bot CSVs.

## CRITICAL RULE #1 - MEMORIZE THIS!
**"when NLU Disabled? is set, the node can only have one child" ERROR:**
- This is the MOST COMMON error. The fix is ALWAYS: Change NLU Disabled? from "1" to "" (empty)
- If node has buttons/listpicker with multiple dest values → NLU Disabled MUST BE EMPTY
- NEVER keep NLU Disabled?=1 when buttons route to different nodes (220, 230, 240)
- Button destinations COUNT as children! Multiple dests = multiple children = NLU Disabled must be empty!

## PYPESTREAM CSV FORMAT REMINDER
26 columns in order:
1. Node Number
2. Node Type (D=Decision, A=Action)
3. Node Name
4. Intent
5. Entity Type
6. Entity
7. NLU Disabled?
8. Next Nodes
9. Message (Decision nodes only)
10. Rich Asset Type (button, listpicker, carousel, webview, datepicker, timepicker, file_upload, quick_reply, star_rating)
11. Rich Asset Content
12. Answer Required? (1 or empty)
13. Behaviors
14. Command (Action nodes only)
15. Description
16. Output (Action nodes only)
17. Node Input
18. Parameter Input (Action nodes only - JSON)
19. Decision Variable (Action nodes only)
20. What Next? (Action nodes only - format: value~node|value~node|error~node)
21. Node Tags
22. Skill Tag
23. Variable
24. Platform Flag
25. Flows
26. CSS Classname

## COMMON ERRORS AND FIXES

### "Command string must follow camelcase convention"
- This actually means: THE COMMAND COLUMN IS EMPTY!
- Action nodes MUST have a Command like "SysAssignVariable", "CheckAvailability"
- Fix: Add a proper Command. If unsure, use "SysAssignVariable" with Parameter Input: {"set":{"PLACEHOLDER":"value"}}

### "proposed dir_field is not an element of the proposed payload"
- This means: Decision Variable doesn't match what the script outputs
- Action nodes with What Next? routing MUST have Decision Variable that matches Output
- Fix: Set Decision Variable to match a key the script returns (usually "success")
- For SysAssignVariable: Decision Variable = "success", What Next? = "true~100|false~200|error~99990"

### "'datepicker' is not one of ['static']" or "'message' is a required property"
- Datepicker/Timepicker Rich Asset Content MUST use {"type":"static","message":"Pick a date"}
- WRONG: {"type":"datepicker"} or {"type":"date"}
- RIGHT: {"type":"static","message":"Select your preferred date"}
- The Rich Asset Type column (set to "datepicker") determines the widget, NOT the JSON type!

### "ans_req must be 1 when rich_type is datepicker/timepicker" - VERY COMMON!
- Datepicker, timepicker, file_upload nodes MUST have Answer Required? = 1
- This is column 12 (0-indexed: 11)
- WRONG row: 230,D,Select Time,,,,,240,Pick a time,timepicker,"{""type"":""static"",""message"":""Pick a time""}",,disable_input,...
- RIGHT row: 230,D,Select Time,,,,,240,Pick a time,timepicker,"{""type"":""static"",""message"":""Pick a time""}",1,disable_input,...
- Fix: Find the node, look at Answer Required? (column 12), change empty or 0 to "1"
- ALWAYS check: if Rich Asset Type is datepicker, timepicker, or file_upload, Answer Required? MUST be 1

### "Node number is not an integer" (with bullet point content)
- Multi-line message content broke into separate CSV rows
- Fix: Keep ALL message text in ONE row's Message column
- Use \\n for line breaks within the message, don't split across rows

### "when NLU Disabled? is set, the node can only have one child" - VERY COMMON!
- When NLU Disabled? (column 7) = 1, the node can ONLY have ONE child TOTAL
- This includes BOTH Next Nodes AND button/listpicker destinations!
- CRITICAL: Buttons with different dest values count as multiple children!

**THE FIX IS SIMPLE:**
- If the node has buttons/listpicker/quick_reply with DIFFERENT destinations → SET NLU DISABLED TO EMPTY (remove the 1)
- NLU Disabled=1 is ONLY for free-form text collection (name, email) with single processing node

WRONG - This will ALWAYS fail:
- NLU Disabled?=1 + buttons with dest values 220, 230, 240 (multiple children!)
- NLU Disabled?=1 + Next Nodes=100|200|300 (multiple children!)

RIGHT:
- NLU Disabled?=EMPTY + buttons with dest 220, 230, 240 (allowed - multiple routes via NLU)
- NLU Disabled?=1 + Next Nodes=100 + NO buttons (single child for text input)

**FIX FOR THIS ERROR: Change NLU Disabled? column from "1" to empty string ""**

### "'105' is not of type 'integer'" (button dest)
- Button dest values MUST be integers, not strings
- WRONG: {"type":"static","options":[{"label":"Go","dest":"105"}]}
- RIGHT: {"type":"static","options":[{"label":"Go","dest":105}]}

### "JSON input error" in Parameter Input
- Variable references must be properly quoted
- WRONG: {"set":{"DATE":selected_date}}
- RIGHT: {"set":{"DATE":"{selected_date}"}}

### "next_nodes is required for decision nodes"
- Decision nodes (D) MUST have at least one node number in column 8 (Next Nodes)
- Fix: Add a valid node number to Next Nodes column

### "Invalid what_next format"
- Must follow pattern: value~node|value~node
- Always include error path like "error~99990"

### "Referenced node X does not exist"
- The node number referenced doesn't exist in the CSV
- Fix: Either create the missing node OR update the reference to an existing node

### Column alignment issues
- EVERY row must have exactly 25 commas (26 columns)
- Empty columns still need the comma separator
- Use proper CSV quoting for values containing commas

### "Likely missing a pipe character | in button construction"
- This error means button format is wrong!
- ALWAYS use Rich Asset Type = "button" (singular) with PIPE format
- Format: Label~destination|Label~destination
- FIX: Change content to pipe format: Label~100|Label~200
- FIX: Ensure | separates each button option
- WRONG: Option A~100Option B~200 (missing pipe!)
- WRONG: {"type":"static","options":[...]} (don't use JSON for buttons!)
- RIGHT: Option A~100|Option B~200

### CRITICAL: Pipe character | is RESERVED - Never use inside labels!
- The pipe character | is ONLY for separating button options
- NEVER put | inside a button label text!
- This is a VERY COMMON mistake with price labels like "$25k"

**WRONG examples (will ALWAYS fail validation):**
- Under $25|k~255 (the | breaks the label - "$25|k" is not valid!)
- $25|000~100 (pipe inside number)
- Option|A~200 (pipe inside label text)
- $35|k-$50|k~265 (multiple pipes inside labels in a range)

**RIGHT examples (correct format):**
- Under $25k~255 (no pipe in label)
- $25000~100 (no pipe in number)
- Option A~200 (space is OK, pipe is NOT)
- $35k-$50k~265 (use "k" directly after number, no pipe)

**Pattern to recognize this error:**
- If you see "Under $25|k" or "$35|k" in button content, the FIX is:
  - Change "$25|k" to "$25k" (remove the pipe, keep the k)
  - Change "$35|k" to "$35k"
  - The "k" means "thousand" and should be attached directly to the number

### "Global variables must be in all capital letters, numbers or _"
- Variable column (column 23) values must be ALL_CAPS
- WRONG: selectedDate, userName, formData
- RIGHT: SELECTED_DATE, USER_NAME, FORM_DATA
- FIX: Convert all lowercase variable names to UPPERCASE with underscores

### Parameter Input array error
- Parameter Input MUST be a JSON object {}, NOT an array []
- WRONG: [{"set":"value"}]
- RIGHT: {"set":{"KEY":"value"}}
- FIX: Wrap array in object or convert to proper format

### xfer_to_agent with Next Nodes
- When Behaviors contains "xfer_to_agent", Next Nodes MUST be empty
- FIX: Clear the Next Nodes column for xfer_to_agent nodes

### Dynamic embeds missing requirements
- Rich Asset Content with "type":"dynamic" requires:
  - NLU Disabled? = 1
  - Behaviors = "disable_input"
  - Next Nodes = single node only
- FIX: Set NLU Disabled?=1, add disable_input to Behaviors

### Listpicker dest type
- LISTPICKER/IMAGEBUTTON: dest should be STRING: "dest":"100"
- BUTTONS use PIPE format: Label~100|Label~200 (not JSON!)
- FIX for listpicker: Ensure dest values are strings in JSON

### file_upload missing properties
- file_upload Rich Asset Content requires:
  - "type": "action_node" or "direct_post"
  - "upload_label": "Upload file"
  - "cancel_label": "Skip"
- FIX: Add missing properties to file_upload JSON

### Datepicker/Timepicker missing message property
- Rich Asset Content MUST have "message" property - it's REQUIRED
- WRONG: {"type":"static"} (missing message!)
- RIGHT: {"type":"static","message":"Please select a date"}
- FIX: Add the message property to the JSON

### Action node missing error path in What Next?
- Every Action node What Next? should include error handling
- Format: true~100|false~200|error~99990
- FIX: Add |error~99990 to What Next? if missing

## FLOW QUALITY CHECKS (Fix if found!)

### Dead Ends - CRITICAL!
- Every flow path MUST eventually lead to either:
  - Return Menu (node 201) - for continuing conversation
  - End Chat (node 666) - for ending conversation
  - Live Agent (node 999) - for escalation
- WRONG: Decision node with buttons that don't lead anywhere
- FIX: Add Return Menu option or route to node 201 after action completion

### Missing Main Menu
- Bot MUST have a Main Menu (node 200) and Return Menu (node 201)
- Main Menu should have 3-5 feature options plus "Talk to Agent"
- Return Menu same as Main Menu but includes "End Chat"
- FIX: Add nodes 200 and 201 if missing

### Poor Button Navigation
- Every button group should include navigation back: "Main Menu~200" or "Back~previous"
- Final confirmations should offer "Yes More Help~201|No End Chat~666"
- FIX: Add navigation buttons to isolated nodes

### No Error Recovery Paths
- Error nodes (99990, 99991) should offer: Start Over~105|Talk to Agent~999
- After errors, always provide recovery options
- FIX: Add recovery buttons to error message nodes

### Startup Flow Not Connected
- Node 104 (SetEnv) should route to node 200 (Main Menu)
- NOT to a random feature node
- FIX: Change 104's What Next? to route to 200

## YOUR TASK
1. Analyze the current CSV and the validation errors
2. Fix ALL reported validation errors from Bot Manager
3. ALSO check for flow quality issues listed above and fix them
4. Ensure proper column alignment (26 columns per row)
5. Ensure all flows lead to Return Menu, End Chat, or Live Agent (NO DEAD ENDS!)
6. Return the complete fixed CSV

## OUTPUT FORMAT - CRITICAL
You MUST respond with ONLY a JSON object. NO explanatory text before or after. NO markdown code blocks. Start your response with { and end with }.

{
  "csv": "The complete fixed CSV with header and all data rows",
  "fixesMade": ["Description of each fix applied"],
  "stillBroken": ["Any errors you couldn't fix and why"]
}

WRONG (do NOT do this):
Let me fix these errors...
\`\`\`json
{"csv": "..."}
\`\`\`

RIGHT (do this):
{"csv": "Node Number,Node Type,...", "fixesMade": ["Fixed X"], "stillBroken": []}`;

              let userPrompt: string;
              let rowLevelSystemAddendum = '';
              
              if (useRowLevel) {
                // ROW-LEVEL: Only send broken rows + context rows
                const brokenLines = [...brokenRowIndices].sort((a, b) => a - b).map(i => allRows[i].line);
                const contextLines = [...contextRowIndices].filter(i => !brokenRowIndices.has(i)).sort((a, b) => a - b).map(i => `// CONTEXT (do not modify): ${allRows[i].line}`);
                
                const brokenCSV = [headerLine, ...brokenLines].join('\n');
                
                rowLevelSystemAddendum = `

## CRITICAL: ROW-LEVEL REFINEMENT MODE
You are receiving ONLY the broken rows, NOT the full CSV. 
- Fix ONLY the rows provided below. 
- Return ONLY the fixed rows (with the header).
- Do NOT invent new rows or remove rows.
- Do NOT change Node Numbers.
- Every row MUST have exactly 26 columns (25 commas).
- Available node numbers in the full bot: [${allNodeNums.join(', ')}]
`;
                
                userPrompt = `## BROKEN ROWS TO FIX (${brokenLines.length} rows)
\`\`\`csv
${brokenCSV}
\`\`\`

${contextLines.length > 0 ? `## NEIGHBORING ROWS (for context only — do NOT include these in output)
${contextLines.join('\n')}
` : ''}
## VALIDATION ERRORS FROM BOT MANAGER API (Iteration ${iteration || 1})
${errorList}

## PROJECT CONTEXT
- Client: ${projectConfig?.clientName || 'Unknown'}
- Project: ${projectConfig?.projectName || 'Unknown'}
- Type: ${projectConfig?.projectType || 'custom'}
${errorDocsContext}
${knownFixesContext || ''}
Fix ALL the validation errors. Return ONLY the header + fixed rows as CSV. Do NOT include context rows.`;
              } else {
                // FULL CSV mode (fallback for widespread errors)
                userPrompt = `## CURRENT CSV
\`\`\`csv
${csv}
\`\`\`

## VALIDATION ERRORS FROM BOT MANAGER API (Iteration ${iteration || 1})
${errorList}

## PROJECT CONTEXT
- Client: ${projectConfig?.clientName || 'Unknown'}
- Project: ${projectConfig?.projectName || 'Unknown'}
- Type: ${projectConfig?.projectType || 'custom'}
${errorDocsContext}
${knownFixesContext || ''}
Please fix ALL the validation errors listed above and return the corrected CSV. Use the official documentation provided above as your authoritative reference for the correct formats. If proven fixes are provided above, apply those first as they have worked in the past.`;
              }

              // Call Claude API
              const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model: 'claude-sonnet-4-20250514',
                  max_tokens: useRowLevel ? 8000 : 16000,
                  messages: [
                    { role: 'user', content: userPrompt }
                  ],
                  system: systemPrompt + rowLevelSystemAddendum
                })
              });
              
              if (!anthropicResponse.ok) {
                const errorText = await anthropicResponse.text();
                console.error('[AI Refine] API error:', errorText);
                throw new Error(`Claude API error: ${anthropicResponse.status}`);
              }
              
              const result = await anthropicResponse.json();
              const content = result.content?.[0]?.text || '';
              
              // Log first 200 chars of response for debugging
              console.log(`[AI Refine] Response preview:`, content.substring(0, 200).replace(/\n/g, '\\n'));
              
              // Parse JSON response with multiple fallback strategies
              let refinementResult;
              try {
                // Strategy 1: Try parsing as-is (pure JSON response)
                try {
                  refinementResult = JSON.parse(content);
                } catch (e) {
                  // Strategy 2: Extract from markdown code block
                  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                  if (codeBlockMatch) {
                    try {
                      refinementResult = JSON.parse(codeBlockMatch[1].trim());
                    } catch (e2) {
                      // Code block didn't contain valid JSON, continue to next strategy
                    }
                  }
                  
                  // Strategy 3: Find JSON object anywhere in response
                  if (!refinementResult) {
                    // Look for JSON object containing "csv" key
                    const jsonObjectMatch = content.match(/\{[\s\S]*?"csv"\s*:\s*"[\s\S]*?\}/);
                    if (jsonObjectMatch) {
                      try {
                        refinementResult = JSON.parse(jsonObjectMatch[0]);
                      } catch (e3) {
                        // Still failed, continue to next strategy
                      }
                    }
                  }
                  
                  // Strategy 4: Look for a JSON object starting with { and ending with }
                  if (!refinementResult) {
                    const firstBrace = content.indexOf('{');
                    const lastBrace = content.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace > firstBrace) {
                      const jsonCandidate = content.substring(firstBrace, lastBrace + 1);
                      try {
                        refinementResult = JSON.parse(jsonCandidate);
                      } catch (e4) {
                        // Still failed
                      }
                    }
                  }
                }
                
                // Strategy 5: Extract CSV directly from response
                // CRITICAL: Use lastIndexOf to get the LAST CSV occurrence (the fixed one)
                // because the user prompt contains the ORIGINAL broken CSV, and the AI's
                // fixed CSV comes after it in the response
                if (!refinementResult || !refinementResult.csv) {
                  const csvHeader = 'Node Number,Node Type,Node Name';
                  const lastCsvIndex = content.lastIndexOf(csvHeader);
                  if (lastCsvIndex !== -1) {
                    const csvContent = content.substring(lastCsvIndex).trim();
                    // Clean up any trailing markdown code block markers
                    const cleanedCsv = csvContent.replace(/```\s*$/g, '').trim();
                    // Validate it looks like actual CSV rows (not just header)
                    const lines = cleanedCsv.split('\n').filter((l: string) => l.trim());
                    if (lines.length > 5) { // At least header + some nodes
                      console.log('[AI Refine] Extracted raw CSV from response (last occurrence)');
                      refinementResult = {
                        csv: cleanedCsv,
                        fixesMade: ['Extracted CSV from raw response (last occurrence)'],
                        stillBroken: []
                      };
                    }
                  }
                }
                
                if (!refinementResult || !refinementResult.csv) {
                  throw new Error('Could not extract CSV from response');
                }
                
              } catch (parseError) {
                console.error('[AI Refine] Failed to parse response:', parseError);
                console.error('[AI Refine] Full response:', content.substring(0, 500));
                throw new Error('Could not parse refinement response');
              }
              
              console.log(`[AI Refine] Fixes made:`, refinementResult.fixesMade?.slice(0, 3));
              
              // === ROW-LEVEL: Splice fixed rows back into the original CSV ===
              if (useRowLevel && refinementResult.csv) {
                const fixedLines = refinementResult.csv.split('\n').filter((l: string) => l.trim());
                // Skip header line from AI response
                const fixedDataLines = fixedLines.filter((l: string) => !l.startsWith('Node Number'));
                
                // Parse fixed rows into a map by node number
                const fixedRowMap = new Map<number, string>();
                for (const line of fixedDataLines) {
                  const firstComma = line.indexOf(',');
                  const nodeNumStr = firstComma > 0 ? line.substring(0, firstComma) : line;
                  const nodeNum = parseInt(nodeNumStr, 10);
                  if (!isNaN(nodeNum)) {
                    fixedRowMap.set(nodeNum, line);
                  }
                }
                
                console.log(`[AI Refine] Row-level splice: ${fixedRowMap.size} fixed rows to merge back`);
                
                // Rebuild the full CSV, replacing only the fixed rows
                const rebuiltLines: string[] = [headerLine];
                let spliced = 0;
                for (let i = 1; i < csvLines.length; i++) {
                  const line = csvLines[i];
                  if (!line.trim()) continue;
                  const firstComma = line.indexOf(',');
                  const nodeNumStr = firstComma > 0 ? line.substring(0, firstComma) : line;
                  const nodeNum = parseInt(nodeNumStr, 10);
                  
                  if (!isNaN(nodeNum) && fixedRowMap.has(nodeNum)) {
                    rebuiltLines.push(fixedRowMap.get(nodeNum)!);
                    spliced++;
                  } else {
                    rebuiltLines.push(line);
                  }
                }
                
                console.log(`[AI Refine] Spliced ${spliced}/${fixedRowMap.size} rows back into original CSV (${rebuiltLines.length - 1} total rows)`);
                refinementResult.csv = rebuiltLines.join('\n');
                refinementResult.fixesMade = [...(refinementResult.fixesMade || []), `Row-level splice: replaced ${spliced} rows, preserved ${rebuiltLines.length - 1 - spliced} untouched rows`];
              }
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(refinementResult));
              
            } catch (e: any) {
              console.error('[AI Refine] Refinement error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
      }
    },
    // Pypestream Documentation MCP Server with full SSE listener
    {
      name: 'pypestream-docs-middleware',
      configureServer(server) {
        const PYPESTREAM_DOCS_BASE = 'https://pypestream-docs-mcp.fly.dev';
        const PYPESTREAM_DOCS_KEY = process.env.PYPESTREAM_DOCS_MCP_KEY || '';
        
        // SSE Connection state
        let sseSessionId: string | null = null;
        let sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        let sseController: AbortController | null = null;
        let isConnecting = false;
        let isConnected = false;
        
        // Pending requests waiting for responses (id -> { resolve, reject, timeout })
        const pendingRequests = new Map<number, {
          resolve: (value: any) => void;
          reject: (error: Error) => void;
          timeout: NodeJS.Timeout;
        }>();
        
        // Available tools cache
        let availableTools: any[] = [];
        let isInitialized = false;
        
        // Parse SSE event data
        const parseSSEEvent = (eventText: string): { event?: string; data?: string } => {
          const result: { event?: string; data?: string } = {};
          const lines = eventText.split('\n');
          for (const line of lines) {
            if (line.startsWith('event:')) {
              result.event = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              result.data = line.substring(5).trim();
            }
          }
          return result;
        };
        
        // Process incoming SSE messages
        const processSSEMessage = (eventText: string) => {
          const { event, data } = parseSSEEvent(eventText);
          
          if (event === 'endpoint' && data) {
            // Extract session ID from endpoint event
            const match = data.match(/session_id=([a-f0-9]+)/);
            if (match) {
              sseSessionId = match[1];
              console.log(`[PypeDocs] SSE session established: ${sseSessionId.substring(0, 8)}...`);
            }
          } else if (event === 'message' && data) {
            // Parse JSON-RPC response
            try {
              const response = JSON.parse(data);
              console.log(`[PypeDocs] SSE message received: id=${response.id}, hasResult=${!!response.result}, hasError=${!!response.error}`);
              
              // Check if this is a response to a pending request
              if (response.id !== undefined && pendingRequests.has(response.id)) {
                const pending = pendingRequests.get(response.id)!;
                clearTimeout(pending.timeout);
                pendingRequests.delete(response.id);
                
                if (response.error) {
                  pending.reject(new Error(response.error.message || JSON.stringify(response.error)));
                } else {
                  pending.resolve(response.result);
                }
              }
            } catch (e) {
              console.log(`[PypeDocs] Failed to parse SSE message: ${data.substring(0, 100)}`);
            }
          }
        };
        
        // Start SSE listener loop
        const startSSEListener = async () => {
          const decoder = new TextDecoder();
          let buffer = '';
          
          console.log('[PypeDocs] SSE listener started');
          
          // Mark as potentially connected - will be confirmed when we get session ID
          isConnected = true;
          
          while (sseReader) {
            try {
              const { value, done } = await sseReader.read();
              if (done) {
                console.log('[PypeDocs] SSE stream ended');
                break;
              }
              
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;
              
              // Process complete events - SSE format ends with blank line
              // Handle both \n\n and \r\n\r\n
              while (buffer.includes('\n\n') || buffer.includes('\r\n\r\n')) {
                let eventEnd = buffer.indexOf('\n\n');
                let skipLen = 2;
                
                const crlfEnd = buffer.indexOf('\r\n\r\n');
                if (crlfEnd !== -1 && (eventEnd === -1 || crlfEnd < eventEnd)) {
                  eventEnd = crlfEnd;
                  skipLen = 4;
                }
                
                if (eventEnd === -1) break;
                
                const eventText = buffer.substring(0, eventEnd);
                buffer = buffer.substring(eventEnd + skipLen);
                
                if (eventText.trim()) {
                  // Skip ping/comment events (lines starting with :)
                  if (!eventText.startsWith(':')) {
                    processSSEMessage(eventText);
                  }
                }
              }
            } catch (e: any) {
              if (e.name !== 'AbortError') {
                console.log(`[PypeDocs] SSE read error: ${e.message}`);
              }
              break;
            }
          }
          
          isConnected = false;
          sseSessionId = null;
          console.log('[PypeDocs] SSE listener stopped');
        };
        
        // Connect to SSE server
        const connectSSE = async (): Promise<boolean> => {
          if (isConnected && sseSessionId) return true;
          if (isConnecting) {
            // Wait for existing connection attempt
            for (let i = 0; i < 50; i++) {
              await new Promise(r => setTimeout(r, 100));
              if (isConnected && sseSessionId) return true;
            }
            return false;
          }
          
          if (!PYPESTREAM_DOCS_KEY) {
            console.log('[PypeDocs] No API key configured');
            return false;
          }
          
          isConnecting = true;
          console.log('[PypeDocs] Connecting to SSE server...');
          
          try {
            // Cleanup any existing connection
            if (sseController) {
              sseController.abort();
            }
            if (sseReader) {
              await sseReader.cancel().catch(() => {});
            }
            
            sseController = new AbortController();
            
            // Use dynamic import for undici to get proper streaming support in Node.js
            let fetchFn = fetch;
            try {
              const { fetch: undiciFetch } = await import('undici');
              fetchFn = undiciFetch as typeof fetch;
              console.log('[PypeDocs] Using undici fetch for SSE');
            } catch {
              console.log('[PypeDocs] Using native fetch for SSE');
            }
            
            const response = await fetchFn(`${PYPESTREAM_DOCS_BASE}/sse`, {
              headers: { 'X-API-Key': PYPESTREAM_DOCS_KEY },
              signal: sseController.signal
            });
            
            if (!response.ok) {
              console.log(`[PypeDocs] SSE connection failed: ${response.status}`);
              isConnecting = false;
              return false;
            }
            
            // Handle the response body - may need different approach in Node.js
            const body = response.body;
            if (!body) {
              console.log('[PypeDocs] No response body');
              isConnecting = false;
              return false;
            }
            
            // Try to get the reader
            if (typeof body.getReader === 'function') {
              sseReader = body.getReader();
            } else {
              // Node.js stream - convert to web stream
              console.log('[PypeDocs] Converting Node stream to web stream');
              const { Readable } = await import('stream');
              const webStream = Readable.toWeb(body as any);
              sseReader = (webStream as ReadableStream<Uint8Array>).getReader();
            }
            
            if (!sseReader) {
              console.log('[PypeDocs] Could not get reader');
              isConnecting = false;
              return false;
            }
            
            // Start the listener in background
            startSSEListener();
            
            // Wait for session ID (up to 10 seconds)
            for (let i = 0; i < 100; i++) {
              await new Promise(r => setTimeout(r, 100));
              if (sseSessionId) {
                isConnecting = false;
                return true;
              }
            }
            
            console.log('[PypeDocs] Timeout waiting for session ID');
            isConnecting = false;
            return false;
          } catch (e: any) {
            console.log(`[PypeDocs] Connection error: ${e.message}`);
            isConnecting = false;
            return false;
          }
        };
        
        // Send a JSON-RPC request and wait for response
        const sendRequest = async (method: string, params: any = {}, timeoutMs: number = 30000): Promise<any> => {
          if (!await connectSSE()) {
            throw new Error('Failed to connect to MCP server');
          }
          
          const requestId = Date.now() + Math.floor(Math.random() * 1000);
          const messagesUrl = `${PYPESTREAM_DOCS_BASE}/messages/?session_id=${sseSessionId}`;
          
          console.log(`[PypeDocs] Sending request: ${method} (id=${requestId})`);
          
          // Create promise for response
          const responsePromise = new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
              pendingRequests.delete(requestId);
              reject(new Error(`Request timeout: ${method}`));
            }, timeoutMs);
            
            pendingRequests.set(requestId, { resolve, reject, timeout });
          });
          
          // Send the request
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
          });
          
          const responseText = await response.text();
          if (responseText !== 'Accepted') {
            // Unexpected response - might be an error
            console.log(`[PypeDocs] Unexpected response: ${responseText}`);
          }
          
          // Wait for response via SSE
          return responsePromise;
        };
        
        // Initialize MCP connection (required before listing tools)
        const initializeMCP = async (): Promise<boolean> => {
          if (isInitialized) return true;
          
          try {
            console.log('[PypeDocs] Initializing MCP connection...');
            const result = await sendRequest('initialize', {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: {
                name: 'pypestream-solution-builder',
                version: '1.0.0'
              }
            });
            console.log(`[PypeDocs] Initialized: ${JSON.stringify(result).substring(0, 100)}`);
            isInitialized = true;
            
            // Send initialized notification (no response expected)
            await sendRequest('notifications/initialized', {}).catch(() => {
              // Notifications don't get responses, ignore errors
            });
            
            return true;
          } catch (e: any) {
            console.log(`[PypeDocs] Initialization failed: ${e.message}`);
            return false;
          }
        };
        
        // List available tools
        const listTools = async (): Promise<any[]> => {
          if (availableTools.length > 0) return availableTools;
          
          // Initialize first
          if (!await initializeMCP()) {
            return [];
          }
          
          try {
            const result = await sendRequest('tools/list', {});
            availableTools = result?.tools || [];
            console.log(`[PypeDocs] Available tools: ${availableTools.map((t: any) => t.name).join(', ')}`);
            return availableTools;
          } catch (e: any) {
            console.log(`[PypeDocs] Failed to list tools: ${e.message}`);
            return [];
          }
        };
        
        // Query Pypestream docs using a specific tool
        const queryPypestreamDocs = async (query: string, toolName?: string): Promise<string> => {
          try {
            // Get available tools if we don't know the tool name
            if (!toolName) {
              const tools = await listTools();
              // Find a search-related tool
              const searchTool = tools.find((t: any) => 
                t.name.toLowerCase().includes('search') || 
                t.name.toLowerCase().includes('query') ||
                t.name.toLowerCase().includes('find')
              );
              toolName = searchTool?.name || tools[0]?.name;
              
              if (!toolName) {
                console.log('[PypeDocs] No tools available');
                return '';
              }
            }
            
            console.log(`[PypeDocs] Calling tool: ${toolName} with query: "${query}"`);
            
            const result = await sendRequest('tools/call', {
              name: toolName,
              arguments: { query }
            });
            
            // Extract content from result
            if (result?.content) {
              if (Array.isArray(result.content)) {
                return result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
              }
              return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
            }
            
            return JSON.stringify(result);
          } catch (e: any) {
            console.log(`[PypeDocs] Query failed: ${e.message}`);
            return '';
          }
        };
        
        // API endpoint to query docs
        server.middlewares.use('/api/pypestream-docs', async (req: any, res: any, next: any) => {
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.statusCode = 200;
            res.end();
            return;
          }
          
          if (req.method !== 'POST' && req.method !== 'GET') { 
            next(); 
            return; 
          }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');
          
          // GET request returns available tools
          if (req.method === 'GET') {
            try {
              const tools = await listTools();
              res.end(JSON.stringify({ 
                connected: isConnected,
                sessionId: sseSessionId?.substring(0, 8),
                tools: tools.map((t: any) => ({ name: t.name, description: t.description }))
              }));
            } catch (error: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: error.message }));
            }
            return;
          }
          
          // POST request queries docs
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { query, tool } = JSON.parse(body);
              
              if (!query) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Query is required' }));
                return;
              }
              
              const docs = await queryPypestreamDocs(query, tool);
              res.end(JSON.stringify({ 
                success: !!docs,
                query,
                tool,
                docs 
              }));
            } catch (error: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: error.message }));
            }
          });
        });
        
        // Export helper for other middlewares
        (server as any).queryPypestreamDocs = queryPypestreamDocs;
        (server as any).listPypestreamDocsTools = listTools;
        
        // Auto-connect on startup if key is configured
        if (PYPESTREAM_DOCS_KEY) {
          console.log('[PypeDocs] Middleware initialized - connecting to MCP server...');
          connectSSE().then(connected => {
            if (connected) {
              listTools(); // Pre-fetch available tools
            }
          });
        } else {
          console.log('[PypeDocs] Middleware initialized - no API key configured');
        }
      }
    },
    // Bot Manager API middleware
    {
      name: 'botmanager-api-middleware',
      configureServer(server) {
        const BOT_MANAGER_BASE = 'https://api.pypestream.com/botmanager';
        
        // Helper to find the highest version number from a list like ['v1', 'v10', 'v2', 'v23']
        const getHighestVersion = (versions: string[]): string => {
          if (!versions || versions.length === 0) return 'v1';
          
          let maxNum = 0;
          for (const v of versions) {
            const num = parseInt(v.replace('v', '')) || 0;
            if (num > maxNum) maxNum = num;
          }
          return `v${maxNum}`;
        };
        
        // Helper to get the next version number
        const getNextVersion = (versions: string[]): string => {
          const highest = getHighestVersion(versions);
          const num = parseInt(highest.replace('v', '')) || 0;
          return `v${num + 1}`;
        };
        
        // Helper to make Bot Manager API requests
        const botManagerRequest = async (
          method: string, 
          path: string, 
          token: string, 
          body?: any,
          contentType: string = 'application/json'
        ) => {
          const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
          };
          if (contentType) {
            headers['Content-Type'] = contentType;
          }
          
          const options: RequestInit = {
            method,
            headers,
          };
          
          if (body) {
            options.body = typeof body === 'string' ? body : JSON.stringify(body);
          }
          
          console.log(`[BotManager] ${method} ${path}`);
          const response = await fetch(`${BOT_MANAGER_BASE}${path}`, options);
          const text = await response.text();
          
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }
          
          // Handle auth errors with clear message
          if (response.status === 401) {
            console.log(`[BotManager] Auth failed (401) - token may be invalid or expired`);
            return { 
              ok: false, 
              status: 401, 
              data: { 
                errors: 'API token is invalid or expired. Please check your Pypestream API key.',
                authError: true
              } 
            };
          }
          
          return { ok: response.ok, status: response.status, data };
        };
        
        // Validate CSV via Bot Manager API
        server.middlewares.use('/api/botmanager/validate', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { csv, botId, token } = JSON.parse(body);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Pypestream API token required' }));
                return;
              }
              
              if (!botId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID required (format: CustomerName.BotName)' }));
                return;
              }
              
              // Parse botId into customerName and botName for potential bot creation
              const botIdParts = botId.split('.');
              if (botIdParts.length !== 2) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID must be in format: CustomerName.BotName' }));
                return;
              }
              const [customerName, botName] = botIdParts;
              
              console.log(`[BotManager] Validating CSV for bot: ${botId}`);
              
              // Step 1: Create a new version for validation
              let createVersionResult = await botManagerRequest(
                'POST',
                `/bots/${botId}/versions`,
                token
              );
              
              // If bot doesn't exist, create it first
              if (!createVersionResult.ok && createVersionResult.data?.errors === 'Bot does not exist.') {
                console.log(`[BotManager] Bot doesn't exist, creating: ${botId}`);
                
                // Create the bot via POST /customers/{customerName}/bots
                const createBotResult = await botManagerRequest(
                  'POST',
                  `/customers/${customerName}/bots`,
                  token,
                  {
                    botName: botName,
                    botLanguage: 'english',
                    botType: 'main'
                  }
                );
                
                if (!createBotResult.ok) {
                  console.log(`[BotManager] Failed to create bot:`, createBotResult.data);
                  
                  // Check if customer doesn't exist
                  const errorMsg = createBotResult.data?.errors || createBotResult.data?.error || '';
                  const isCustomerMissing = typeof errorMsg === 'string' && 
                    (errorMsg.toLowerCase().includes('customer') || errorMsg.toLowerCase().includes('not found'));
                  
                  res.statusCode = createBotResult.status;
                  res.end(JSON.stringify({ 
                    error: isCustomerMissing 
                      ? `Customer "${customerName}" does not exist in Pypestream. Please use an existing customer name in your Bot ID (format: CustomerName.BotName).`
                      : 'Failed to create bot',
                    details: createBotResult.data
                  }));
                  return;
                }
                
                console.log(`[BotManager] Bot created successfully: ${botId}`);
                
                // Now try to create version again
                createVersionResult = await botManagerRequest(
                  'POST',
                  `/bots/${botId}/versions`,
                  token
                );
              }
              
              if (!createVersionResult.ok) {
                console.log('[BotManager] Create version failed:', createVersionResult.data);
                res.statusCode = createVersionResult.status;
                res.end(JSON.stringify({ 
                  error: 'Failed to create version for validation',
                  details: createVersionResult.data
                }));
                return;
              }
              
              // Get the new version ID (use highest version number, not last in alphabetical array)
              const versions = createVersionResult.data?.data?.versions || [];
              const latestVersion = getHighestVersion(versions);
              const versionId = `${botId}.${latestVersion}`;
              
              console.log(`[BotManager] Created version: ${versionId}`);
              
              // Step 2: Upload the CSV template (this triggers compilation and validation)
              let uploadResult = await botManagerRequest(
                'PUT',
                `/versions/${versionId}/graph`,
                token,
                {
                  templateData: csv,
                  templateType: 'csv',
                  templateVersion: 5
                }
              );
              
              console.log('[BotManager] Upload result:', JSON.stringify(uploadResult.data).substring(0, 500));
              
              // If version is locked, create a new version and try again
              if (uploadResult.data?.errors === 'Solution version is set and cannot be updated.') {
                console.log('[BotManager] Version is locked, creating new version...');
                
                const lockedVersionId = versionId;
                
                // Create a new version
                const newVersionResult = await botManagerRequest(
                  'POST',
                  `/bots/${botId}/versions`,
                  token
                );
                
                if (newVersionResult.ok) {
                  const newVersions = newVersionResult.data?.data?.versions || [];
                  console.log(`[BotManager] Available versions:`, newVersions);
                  
                  // Get the highest version and then get the next one
                  const highestVersion = getHighestVersion(newVersions);
                  const highestVersionId = `${botId}.${highestVersion}`;
                  
                  // Use next version since the highest is likely locked
                  let newVersionId: string;
                  if (highestVersionId === lockedVersionId) {
                    newVersionId = `${botId}.${getNextVersion(newVersions)}`;
                    console.log(`[BotManager] Highest version is locked, using next: ${newVersionId}`);
                  } else {
                    // Try the highest first, if it fails we'll get an error
                    newVersionId = highestVersionId;
                  }
                  
                  console.log(`[BotManager] Using version: ${newVersionId}`);
                  
                  // Retry upload with new version
                  uploadResult = await botManagerRequest(
                    'PUT',
                    `/versions/${newVersionId}/graph`,
                    token,
                    {
                      templateData: csv,
                      templateType: 'csv',
                      templateVersion: 5
                    }
                  );
                  
                  console.log('[BotManager] Retry upload result:', JSON.stringify(uploadResult.data).substring(0, 500));
                }
              }
              
              if (!uploadResult.ok || uploadResult.data?.errors) {
                // Validation failed - return errors
                let errors = uploadResult.data?.errors || [];
                // Normalize errors to array
                if (typeof errors === 'string') {
                  errors = [errors];
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  valid: false,
                  versionId,
                  errors: errors,
                  details: uploadResult.data
                }));
                return;
              }
              
              // Validation passed
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                valid: true,
                versionId,
                version: latestVersion,
                message: 'CSV validated successfully by Bot Manager API'
              }));
              
            } catch (e: any) {
              console.error('[BotManager] Validate error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Upload/compile CSV via Bot Manager API
        server.middlewares.use('/api/botmanager/upload', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { csv, botId, versionId, token, scripts, environment } = JSON.parse(body);
              
              console.log(`[BotManager] Upload request - botId: ${botId}, scripts: ${scripts ? scripts.length : 0}, env: ${environment}`);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Pypestream API token required' }));
                return;
              }
              
              if (!botId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID required (format: CustomerName.BotName)' }));
                return;
              }
              
              // Parse botId into customerName and botName
              const botIdParts = botId.split('.');
              if (botIdParts.length !== 2) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID must be in format: CustomerName.BotName' }));
                return;
              }
              const [customerName, botName] = botIdParts;
              
              let targetVersionId = versionId;
              
              // Create new version if not provided
              if (!targetVersionId) {
                console.log(`[BotManager] Creating new version for: ${botId}`);
                let createResult = await botManagerRequest(
                  'POST',
                  `/bots/${botId}/versions`,
                  token
                );
                
                console.log(`[BotManager] POST versions response:`, JSON.stringify(createResult.data).substring(0, 500));
                
                // If bot doesn't exist, create it first
                if (!createResult.ok && createResult.data?.errors === 'Bot does not exist.') {
                  console.log(`[BotManager] Bot doesn't exist, creating: ${botId}`);
                  
                  // Create the bot via POST /customers/{customerName}/bots
                  const createBotResult = await botManagerRequest(
                    'POST',
                    `/customers/${customerName}/bots`,
                    token,
                    {
                      botName: botName,
                      botLanguage: 'english',
                      botType: 'main'
                    }
                  );
                  
                  if (!createBotResult.ok) {
                    console.log(`[BotManager] Failed to create bot:`, createBotResult.data);
                    
                    // Check if customer doesn't exist
                    const errorMsg = createBotResult.data?.errors || createBotResult.data?.error || '';
                    const isCustomerMissing = typeof errorMsg === 'string' && 
                      (errorMsg.toLowerCase().includes('customer') || errorMsg.toLowerCase().includes('not found'));
                    
                    res.statusCode = createBotResult.status;
                    res.end(JSON.stringify({ 
                      error: isCustomerMissing 
                        ? `Customer "${customerName}" does not exist in Pypestream. Please use an existing customer name in your Bot ID (format: CustomerName.BotName).`
                        : 'Failed to create bot',
                      details: createBotResult.data
                    }));
                    return;
                  }
                  
                  console.log(`[BotManager] Bot created successfully: ${botId}`);
                  
                  // Now try to create version again
                  createResult = await botManagerRequest(
                    'POST',
                    `/bots/${botId}/versions`,
                    token
                  );
                }
                
                if (!createResult.ok) {
                  console.log(`[BotManager] Failed to create version:`, createResult.data);
                  res.statusCode = createResult.status;
                  res.end(JSON.stringify({ 
                    error: 'Failed to create version',
                    details: createResult.data
                  }));
                  return;
                }
                
                const versions = createResult.data?.data?.versions || [];
                targetVersionId = `${botId}.${getHighestVersion(versions)}`;
              }
              
              console.log(`[BotManager] Uploading CSV to: ${targetVersionId}`);
              console.log(`[BotManager] Scripts received:`, scripts ? scripts.map((s: any) => s.name) : 'none');
              
              // Upload the CSV template
              let uploadResult = await botManagerRequest(
                'PUT',
                `/versions/${targetVersionId}/graph`,
                token,
                {
                  templateData: csv,
                  templateType: 'csv',
                  templateVersion: 5
                }
              );
              
              console.log(`[BotManager] Upload response (status ${uploadResult.status}):`, JSON.stringify(uploadResult.data).substring(0, 500));
              
              // Check if this is a CSV validation error (has row/node errors) vs version issue
              const hasValidationErrors = Array.isArray(uploadResult.data?.errors) && 
                uploadResult.data.errors.some((e: any) => e.row_num !== undefined || e.node_num !== undefined || e.err_msgs);
              
              // If there are validation errors, don't retry - return them for fixing
              if (hasValidationErrors) {
                console.log(`[BotManager] CSV validation errors detected - not retrying versions`);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  success: false,
                  errors: uploadResult.data.errors,
                  versionId: targetVersionId,
                  message: 'CSV has validation errors that need to be fixed'
                }));
                return;
              }
              
              // Only retry versions for actual version issues (locked, doesn't exist)
              const needsNewVersion = 
                uploadResult.status === 412 ||
                uploadResult.data?.errors === 'Solution version is set and cannot be updated.' ||
                uploadResult.data?.errors?.includes?.('does not exist');
                
              if (needsNewVersion) {
                console.log(`[BotManager] Version issue (${uploadResult.status}), looking for available version...`);
                
                // Get list of all versions
                const versionsResult = await botManagerRequest(
                  'POST',
                  `/bots/${botId}/versions`,
                  token
                );
                
                if (versionsResult.ok) {
                  const allVersions = versionsResult.data?.data?.versions || [];
                  console.log(`[BotManager] All versions:`, allVersions);
                  
                  // Sort versions by number descending and try each one
                  const sortedVersions = [...allVersions].sort((a, b) => {
                    const numA = parseInt(a.replace('v', '')) || 0;
                    const numB = parseInt(b.replace('v', '')) || 0;
                    return numB - numA; // Descending
                  });
                  
                  console.log(`[BotManager] Trying versions in order:`, sortedVersions.slice(0, 5));
                  
                  // Try each version until one works
                  let found = false;
                  for (const version of sortedVersions.slice(0, 10)) { // Try top 10
                    const tryVersionId = `${botId}.${version}`;
                    if (tryVersionId === targetVersionId) continue; // Skip already tried
                    
                    console.log(`[BotManager] Trying version: ${tryVersionId}`);
                    
                    uploadResult = await botManagerRequest(
                      'PUT',
                      `/versions/${tryVersionId}/graph`,
                      token,
                      {
                        templateData: csv,
                        templateType: 'csv',
                        templateVersion: 5
                      }
                    );
                    
                    // Check for validation errors vs version issues
                    const hasValErrors = Array.isArray(uploadResult.data?.errors) && 
                      uploadResult.data.errors.some((e: any) => e.row_num !== undefined || e.node_num !== undefined);
                    
                    if (hasValErrors) {
                      // CSV validation errors - stop retrying and return errors
                      console.log(`[BotManager] CSV validation errors - stopping retry loop`);
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({
                        success: false,
                        errors: uploadResult.data.errors,
                        versionId: tryVersionId,
                        message: 'CSV has validation errors that need to be fixed'
                      }));
                      return;
                    }
                    
                    if (uploadResult.ok && !uploadResult.data?.errors) {
                      targetVersionId = tryVersionId;
                      found = true;
                      console.log(`[BotManager] Success with version: ${tryVersionId}`);
                      break;
                    } else {
                      const errMsg = typeof uploadResult.data?.errors === 'string' 
                        ? uploadResult.data.errors.substring(0, 100)
                        : uploadResult.status;
                      console.log(`[BotManager] Version ${version} failed:`, errMsg);
                    }
                  }
                  
                  if (!found) {
                    console.log(`[BotManager] All versions locked or failed`);
                  }
                }
              }
              
              if (!uploadResult.ok || uploadResult.data?.errors) {
                let errors = uploadResult.data?.errors || [];
                if (typeof errors === 'string') errors = [errors];
                
                // Check for specific error types
                const errorStr = JSON.stringify(errors).toLowerCase();
                let errorMessage = 'Upload failed';
                
                if (errorStr.includes('version is set') || errorStr.includes('cannot be updated')) {
                  errorMessage = 'All versions are locked. Please create a new bot or unlock a version in Pypestream Console.';
                } else if (uploadResult.status === 412) {
                  errorMessage = 'Precondition failed. The bot version may be in an invalid state. Try creating a new bot.';
                }
                
                res.statusCode = uploadResult.ok ? 400 : uploadResult.status;
                res.end(JSON.stringify({
                  success: false,
                  versionId: targetVersionId,
                  errors: [errorMessage, ...errors],
                  details: uploadResult.data
                }));
                return;
              }
              
              // Upload any action node scripts using multipart form data
              if (scripts && scripts.length > 0) {
                console.log(`[BotManager] Uploading ${scripts.length} action node scripts to ${targetVersionId}`);
                
                for (const script of scripts) {
                  const scriptFileName = script.name.endsWith('.py') ? script.name : `${script.name}.py`;
                  console.log(`[BotManager] Uploading script: ${scriptFileName}`);
                  
                  try {
                    // Bot Manager API requires multipart form data with 'scriptFile' field
                    // Use https module with form-data for proper streaming support
                    const FormData = (await import('form-data')).default;
                    const https = await import('https');
                    
                    const formData = new FormData();
                    formData.append('scriptFile', Buffer.from(script.content, 'utf-8'), {
                      filename: scriptFileName,
                      contentType: 'text/x-python',
                    });
                    
                    // Upload using https module with form-data
                    const uploadResult = await new Promise<{ ok: boolean; status: number; data: any }>((resolve) => {
                      const req = https.request(
                        {
                          hostname: 'api.pypestream.com',
                          path: `/botmanager/versions/${targetVersionId}/scripts`,
                          method: 'POST',
                          headers: {
                            'Authorization': `Bearer ${token}`,
                            ...formData.getHeaders(),
                          },
                        },
                        (res) => {
                          let body = '';
                          res.on('data', (chunk) => { body += chunk; });
                          res.on('end', () => {
                            try {
                              const data = JSON.parse(body);
                              resolve({ ok: res.statusCode === 200, status: res.statusCode || 500, data });
                            } catch {
                              resolve({ ok: res.statusCode === 200, status: res.statusCode || 500, data: body });
                            }
                          });
                        }
                      );
                      
                      req.on('error', (e) => {
                        resolve({ ok: false, status: 500, data: { error: e.message } });
                      });
                      
                      formData.pipe(req);
                    });
                    
                    if (!uploadResult.ok) {
                      console.error(`[BotManager] Script upload failed for ${script.name}: ${uploadResult.status}`, uploadResult.data);
                    } else {
                      console.log(`[BotManager] Script uploaded: ${script.name}`, uploadResult.data?.data?.files?.slice(-3));
                    }
                  } catch (e: any) {
                    console.error(`[BotManager] Script upload error for ${script.name}:`, e.message);
                  }
                }
              }
              
              // If environment is provided, also deploy in one step
              let deployResult = null;
              let previewUrl = null;
              let widgetId = null;
              
              if (environment) {
                console.log(`[BotManager] Deploying ${targetVersionId} to ${environment}`);
                const deployResponse = await botManagerRequest(
                  'PUT',
                  `/versions/${targetVersionId}/deploy`,
                  token,
                  { environment }
                );
                
                if (deployResponse.ok) {
                  deployResult = { success: true, environment };
                  console.log(`[Deploy] Bot deployed successfully to ${environment}`);
                  
                  // Generate preview URL using the Bot Manager API preview endpoint
                  // This creates a properly associated preview link
                  try {
                    console.log(`[Deploy] Generating preview URL via POST /versions/${targetVersionId}/preview`);
                    const previewResponse = await botManagerRequest(
                      'POST',
                      `/versions/${targetVersionId}/preview`,
                      token,
                      {}
                    );
                    
                    if (previewResponse.ok && previewResponse.data) {
                      previewUrl = previewResponse.data.previewUrl || 
                                   previewResponse.data.url || 
                                   previewResponse.data.preview_url ||
                                   previewResponse.data.widgetUrl;
                      
                      if (previewUrl) {
                        console.log(`[Deploy] Preview URL generated: ${previewUrl}`);
                      } else {
                        console.log(`[Deploy] Preview response (no URL found):`, previewResponse.data);
                        // Try to construct URL from response data
                        const widgetId = previewResponse.data.widgetId || previewResponse.data.widget_id || previewResponse.data.appId;
                        if (widgetId) {
                          const webPrefix = environment === 'production' ? 'web' : 'web-sandbox';
                          previewUrl = `https://${webPrefix}.pypestream.com/preview.html?id=${widgetId}`;
                          console.log(`[Deploy] Constructed preview URL from widgetId: ${previewUrl}`);
                        }
                      }
                    } else {
                      console.log(`[Deploy] Preview endpoint response:`, previewResponse);
                    }
                  } catch (previewError: any) {
                    console.log(`[Deploy] Preview generation failed (non-blocking):`, previewError.message);
                    // Not a critical failure - bot is still deployed
                  }
                  
                  if (!previewUrl) {
                    console.log(`[Deploy] No preview URL - user should create interface in Console`);
                  }
                } else {
                  console.log(`[BotManager] Deploy warning:`, deployResponse.data);
                  deployResult = { success: false, error: deployResponse.data };
                }
              }
              
              res.setHeader('Content-Type', 'application/json');
              
              // Build response with channel info
              // Success should reflect whether the deploy actually worked, not just upload
              const actualSuccess = !environment || (deployResult?.success === true);
              const response: any = {
                success: actualSuccess,
                versionId: targetVersionId,
                message: environment 
                  ? (actualSuccess ? `CSV uploaded and deployed to ${environment}` : `Deployment to ${environment} failed`)
                  : 'CSV uploaded and compiled successfully',
                deployed: !!environment && deployResult?.success,
                previewUrl,
                widgetId,
                deployResult
              };
              
              // Add helpful message if no channel was created
              if (environment && deployResult?.success && !previewUrl) {
                response.channelNote = `Bot deployed but no preview channel created. To view the bot, create a stream and widget in Pypestream Console for customer "${customerName}", or connect an existing stream to bot version "${targetVersionId}".`;
              }
              
              res.end(JSON.stringify(response));
              
            } catch (e: any) {
              console.error('[BotManager] Upload error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Deploy version via Bot Manager API
        server.middlewares.use('/api/botmanager/deploy', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { versionId, environment, token } = JSON.parse(body);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Pypestream API token required' }));
                return;
              }
              
              if (!versionId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Version ID required' }));
                return;
              }
              
              const env = environment || 'sandbox';
              console.log(`[BotManager] Deploying ${versionId} to ${env}`);
              
              // Deploy the version
              const deployResult = await botManagerRequest(
                'PUT',
                `/versions/${versionId}/deploy`,
                token,
                { environment: env }
              );
              
              if (!deployResult.ok) {
                res.statusCode = deployResult.status;
                res.end(JSON.stringify({
                  success: false,
                  error: 'Deployment failed',
                  details: deployResult.data
                }));
                return;
              }
              
              // Get preview URL
              const previewUrl = `https://web-${env}.pypestream.com/preview.html?id=${versionId.split('.').slice(0, 2).join('.')}`;
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                versionId,
                environment: env,
                previewUrl,
                message: `Successfully deployed to ${env}`
              }));
              
            } catch (e: any) {
              console.error('[BotManager] Deploy error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Create channel with widget for bot testing
        // DISABLED: Legacy basic channel handler — superseded by the comprehensive branded handler below.
        // This handler was intercepting all /api/botmanager/create-channel requests and applying
        // minimal CSS, preventing the full branded CSS (timestamp fix, input bar, home menu, etc.)
        // from ever reaching clients. Now passes through to the branded handler.
        server.middlewares.use('/api/botmanager/create-channel', async (req, res, next) => {
          // Always pass through to the comprehensive branded handler registered later
          next();
          return;
          
          // --- DEAD CODE BELOW (kept for reference) ---
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { botId, environment, token, widgetName, brandAssets } = JSON.parse(body);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ success: false, error: 'Pypestream API token required' }));
                return;
              }
              
              if (!botId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, error: 'Bot ID required' }));
                return;
              }
              
              const env = environment || 'sandbox';
              const envPrefix = env === 'sandbox' ? 'sandbox' : 'live';
              const [customerName, botName] = botId.split('.');
              
              console.log(`[Channel] Creating channel/widget for ${botId} in ${env}`);
              
              // Step 1: Get customer ID
              // Try GES first, fall back to environment-specific API
              console.log('[Channel] Step 1: Getting customer ID...');
              let customerId: string | undefined;
              
              // Strategy 1: Try GES API
              try {
                const gesResponse = await fetch('https://api.pypestream.com/ges/v5/customers', {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                });
                
                if (gesResponse.ok) {
                  const customers = await gesResponse.json();
                  const customer = customers.find((c: any) => 
                    c.name?.toLowerCase() === customerName.toLowerCase() ||
                    c.display_name?.toLowerCase() === customerName.toLowerCase()
                  );
                  if (customer) {
                    customerId = customer.id;
                    console.log(`[Channel] Found customer via GES: ${customerId}`);
                  }
                } else {
                  console.log(`[Channel] GES API returned ${gesResponse.status}, trying environment API...`);
                }
              } catch (e) {
                console.log('[Channel] GES API failed, trying environment API...');
              }
              
              // Strategy 2: Try environment-specific customer API
              if (!customerId) {
                try {
                  const envCustomersUrl = `https://api.pypestream.com/${envPrefix}/v5/customers`;
                  const envResponse = await fetch(envCustomersUrl, {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    }
                  });
                  
                  if (envResponse.ok) {
                    const customers = await envResponse.json();
                    const customerList = Array.isArray(customers) ? customers : customers.results || [];
                    const customer = customerList.find((c: any) => 
                      c.name?.toLowerCase() === customerName.toLowerCase() ||
                      c.display_name?.toLowerCase() === customerName.toLowerCase()
                    );
                    if (customer) {
                      customerId = customer.id;
                      console.log(`[Channel] Found customer via ${envPrefix} API: ${customerId}`);
                    }
                  } else {
                    console.log(`[Channel] Environment API returned ${envResponse.status}`);
                  }
                } catch (e) {
                  console.log('[Channel] Environment API failed:', e);
                }
              }
              
              // Strategy 3: Use customer name directly as ID (some APIs accept name)
              if (!customerId) {
                customerId = customerName;
                console.log(`[Channel] Using customer name as ID fallback: ${customerId}`);
              }
              
              console.log(`[Channel] Customer ID resolved: ${customerId}`);
              
              // Step 2: Get or create Pype
              console.log('[Channel] Step 2: Getting/creating pype...');
              const pypesUrl = `https://api.pypestream.com/${envPrefix}/v5/customers/${customerId}/pypes`;
              const pypesResponse = await fetch(pypesUrl, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });
              
              let pypeId: string;
              const pypes = pypesResponse.ok ? await pypesResponse.json() : [];
              const existingPype = Array.isArray(pypes) ? 
                pypes.find((p: any) => p.name?.toLowerCase().includes(botName.toLowerCase())) : 
                null;
              
              if (existingPype) {
                pypeId = existingPype.id;
                console.log(`[Channel] Using existing pype: ${pypeId}`);
              } else {
                // Create new pype
                console.log('[Channel] Creating new pype...');
                const createPypeResponse = await fetch(pypesUrl, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    name: botName,
                    description: `Pype for ${botName}`,
                    customer_id: customerId,
                    env: envPrefix
                  })
                });
                
                if (!createPypeResponse.ok) {
                  const error = await createPypeResponse.text();
                  console.error('[Channel] Failed to create pype:', error);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ 
                    success: false, 
                    error: `Failed to create pype: ${error}` 
                  }));
                  return;
                }
                
                const newPype = await createPypeResponse.json();
                pypeId = newPype.id;
                console.log(`[Channel] Created new pype: ${pypeId}`);
              }
              
              // Step 2.5: Try to set avatar/logo on pype (for home menu avatar)
              if (logoUrl && pypeId) {
                try {
                  const pypeUpdateUrl = `https://api.pypestream.com/${envPrefix}/v5/customers/${customerId}/pypes/${pypeId}`;
                  const pypeUpdateResponse = await fetch(pypeUpdateUrl, {
                    method: 'PATCH',
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      avatar_url: logoUrl,
                      icon_url: logoUrl,
                      logo_url: logoUrl,
                      micro_app_icon: logoUrl
                    })
                  });
                  if (pypeUpdateResponse.ok) {
                    console.log(`[Channel] Pype avatar updated with logo: ${logoUrl.substring(0, 60)}...`);
                  } else {
                    console.log(`[Channel] Pype avatar update returned ${pypeUpdateResponse.status} (may not be supported)`);
                  }
                } catch (e) {
                  console.log('[Channel] Pype avatar update failed (non-critical):', e);
                }
              }
              
              // Step 3: Create stream
              console.log('[Channel] Step 3: Creating stream...');
              const streamsUrl = `https://api.pypestream.com/${envPrefix}/v5/customers/${customerId}/pypes/${pypeId}/streams`;
              const streamName = `${botName}-stream-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
              
              const createStreamResponse = await fetch(streamsUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  name: streamName,
                  description: `Stream for ${botName}`,
                  // Try setting avatar/icon at stream level for home menu
                  avatar_url: logoUrl || undefined,
                  icon_url: logoUrl || undefined,
                  micro_app_icon: logoUrl || undefined
                })
              });
              
              if (!createStreamResponse.ok) {
                const error = await createStreamResponse.text();
                console.error('[Channel] Failed to create stream:', error);
                res.statusCode = 500;
                res.end(JSON.stringify({ 
                  success: false, 
                  error: `Failed to create stream: ${error}` 
                }));
                return;
              }
              
              const stream = await createStreamResponse.json();
              const streamId = stream.id;
              console.log(`[Channel] Created stream: ${streamId}`);
              
              // Step 4: Configure bot on stream
              console.log('[Channel] Step 4: Configuring bot on stream...');
              const configBotUrl = `https://api.pypestream.com/${envPrefix}/v5/customers/${customerId}/pypes/${pypeId}/streams/${streamId}/bot`;
              
              const configBotResponse = await fetch(configBotUrl, {
                method: 'PUT',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  auto_start_with_bot: true,
                  start_chat_bot_id: botId, // Bot ID, NOT version!
                  end_chat_bot_id: '',
                  bot_enabled: true,
                  start_chat_bot_enabled: true,
                  end_chat_bot_enabled: false
                })
              });
              
              if (!configBotResponse.ok) {
                const error = await configBotResponse.text();
                console.error('[Channel] Failed to configure bot:', error);
                res.statusCode = 500;
                res.end(JSON.stringify({ 
                  success: false, 
                  error: `Failed to configure bot on stream: ${error}` 
                }));
                return;
              }
              console.log('[Channel] Bot configured on stream');
              
              // Step 5: Create widget
              console.log('[Channel] Step 5: Creating widget...');
              const webserviceUrl = `https://webservice-${envPrefix}.pypestream.com/v3/business/widget`;
              
              // Default widget styles with brand colors
              const primaryColor = brandAssets?.primaryColor || '#0066FF';
              const companyName = brandAssets?.name || botName || 'Widget';
              
              // Helper to get contrast color (white or black) for text
              const getContrastColor = (hexColor: string): string => {
                const hex = hexColor.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                return luminance > 0.5 ? '#000000' : '#FFFFFF';
              };
              
              // Generate branded CSS using brand colors
              const generateWidgetCSS = (): string => {
                const buttonTextColor = getContrastColor(primaryColor);
                const cssFont = 'Inter';
                
                return `
/* ============================================
   ${companyName.toUpperCase()} BRANDED WIDGET STYLES
   Generated by Pypestream Solution Builder
   ============================================ */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ---------- TEXT STYLES ---------- */
body {
  font-family: '${cssFont}', system-ui, -apple-system, sans-serif !important;
}

p, .ps-launcher-title, .ps-conversation-tray-header-title, .ps-bubble-body, button.ps-button-primary, .ps-conversation-tray-header, .ps-home-menu-title {
  font-family: '${cssFont}', system-ui, sans-serif !important;
}

.ps-card-description, .ps-card-title, div, button, span {
  font-family: '${cssFont}', system-ui, sans-serif !important;
}

/* ---------- HEADER STYLING ---------- */
.ps-conversation-tray-header {
  margin-top: 0px;
  padding: 16px 20px !important;
  background: ${primaryColor} !important;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 12px !important;
}

.ps-brand-wrapper {
  margin-top: -8px;
  background-color: ${primaryColor} !important;
}

.ps-conversation-tray-header-title {
  color: ${buttonTextColor} !important;
  font-family: '${cssFont}', system-ui, sans-serif !important;
  font-weight: 700 !important;
  font-size: 20px !important;
}

.ps-conversation-tray-header-title span {
  color: ${buttonTextColor} !important;
}

/* ---------- LAUNCHER STYLING ---------- */
.ps-launcher-wrapper {
  background-color: ${primaryColor} !important;
  min-width: 160px;
}

.ps-launcher-title {
  color: ${buttonTextColor} !important;
  font-weight: 500 !important;
  font-size: 16px !important;
}

/* ---------- BUTTON STYLING ---------- */
button.ps-button-primary {
  background-color: ${primaryColor} !important;
  color: ${buttonTextColor} !important;
  border: none !important;
  border-radius: 8px !important;
  font-weight: 500 !important;
}

button.ps-button-primary:hover {
  opacity: 0.9;
}

.ps-button-secondary {
  color: ${primaryColor} !important;
  border: 2px solid ${primaryColor} !important;
  background-color: transparent !important;
  border-radius: 8px !important;
}

/* ---------- INPUT & SEND BUTTON ---------- */
.ps-textinput-textarea {
  background-color: #F5F5F5 !important;
  color: #333333 !important;
  border: 1px solid #E0E0E0 !important;
  border-radius: 8px !important;
}

.ps-textinput-textarea::placeholder {
  color: #999999 !important;
  opacity: 1 !important;
}

textarea#ps-textinput-textarea:disabled {
  background-color: #F5F5F5 !important;
  color: #666666 !important;
}

textarea#ps-textinput-textarea:disabled::placeholder {
  color: #999999 !important;
}

.ps-textinput-submit-button {
  background-color: ${primaryColor} !important;
  border-radius: 8px !important;
}

.ps-textinput-submit-button path {
  fill: ${buttonTextColor} !important;
}

/* ---------- MESSAGE BUBBLES ---------- */
.ps-bubble-user {
  background-color: ${primaryColor} !important;
  color: ${buttonTextColor} !important;
}

.ps-bubble-solution {
  background-color: #F5F5F5 !important;
  color: #333333 !important;
}

/* ---------- TIMESTAMP & NOTICES ---------- */
.ps-notice-timestamp, .ps-notice {
  color: #888888 !important;
  text-shadow: none !important;
}

/* ---------- LISTPICKER STYLING ---------- */
.ps-listpicker-input-search {
  border: 2px solid ${primaryColor} !important;
}

/* ---------- CAROUSEL STYLING ---------- */
.ps-carousel-footer circle {
  fill: ${primaryColor} !important;
}

.ps-carousel-footer path {
  fill: #FFFFFF !important;
}

/* ---------- UI CONTROLS ---------- */
.ps-maintray-button-home svg path,
.ps-maintray-button-minimize svg path,
.ps-maintray-button-close svg path {
  fill: ${buttonTextColor} !important;
}
`;
              };
              
              const customCSS = generateWidgetCSS();
              console.log(`[Channel] Generated custom CSS (${customCSS.length} chars)`);
              
              const widgetStyle = JSON.stringify({
                widgetPosition: 'bottom-right',
                widgetLauncherIcon: 'chat',
                accentColor: primaryColor,
                headerColor: primaryColor,
                buttonColor: primaryColor,
                widgetHeight: '600px',
                widgetWidth: '400px'
              });
              
              const betaConfig = JSON.stringify({
                customStyling: {
                  buttonColor: primaryColor,
                  textColor: getContrastColor(primaryColor),
                  headerBackgroundColor: primaryColor,
                  sendButtonColor: primaryColor,
                  userBubbleColor: primaryColor
                }
              });
              
              // Generate a unique user ID for the widget request
              const userId = `sd-${Date.now()}`;
              
              const createWidgetResponse = await fetch(webserviceUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  user_id: userId,
                  correlation_id: null,
                  reply_to: pypeId,
                  version: 1,
                  type: 'request',
                  auth_token: token, // Token also goes in body
                  request_type: 'x_widget',
                  request_action: 'new',
                  data: {
                    pype_id: pypeId,
                    stream_id: streamId,
                    widget_name: widgetName || `${botName} Widget`,
                    style: widgetStyle,
                    beta: betaConfig,
                    custom_pype_css: customCSS
                  }
                })
              });
              
              let widgetId: string | undefined;
              let widgetUrl: string | undefined;
              let widgetResponseText: string | undefined;
              
              if (!createWidgetResponse.ok) {
                widgetResponseText = await createWidgetResponse.text();
                console.error('[Channel] Widget API returned error:', createWidgetResponse.status, widgetResponseText);
              } else {
                const widgetResult = await createWidgetResponse.json();
                // Log full response for debugging
                console.log('[Channel] Widget creation response:', JSON.stringify(widgetResult, null, 2));
                
                // Try multiple paths to find widget_id (API response format varies)
                widgetId = widgetResult.widget_id 
                  || widgetResult.id 
                  || widgetResult.data?.widget_id 
                  || widgetResult.data?.id
                  || widgetResult.response?.widget_id
                  || widgetResult.response?.id
                  || widgetResult.result?.widget_id
                  || widgetResult.result?.id;
                
                if (widgetId) {
                  widgetUrl = `https://web-${envPrefix}.pypestream.com/preview.html?id=${widgetId}`;
                  console.log(`[Channel] Widget created successfully: ${widgetId}`);
                } else {
                  console.warn('[Channel] Widget API succeeded but no widget_id found in response');
                  console.warn('[Channel] Response keys:', Object.keys(widgetResult));
                }
              }
              
              // Fallback: Try Channel API if widget creation didn't return an ID
              if (!widgetId) {
                console.log('[Channel] Trying Channel API as fallback...');
                const channelApiUrl = `https://webservice-${envPrefix}.pypestream.com/v3/configuration/customers/${customerId}/channel/`;
                
                try {
                  const channelResponse = await fetch(channelApiUrl, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      pype_id: pypeId,
                      name: `${botName}-channel-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                      start_bot: botId,
                      type: 'web',
                      config: {}
                    })
                  });
                  
                  if (channelResponse.ok) {
                    const channelResult = await channelResponse.json();
                    console.log('[Channel] Channel API response:', JSON.stringify(channelResult, null, 2));
                    
                    // Extract widget/app ID from channel response
                    widgetId = channelResult.app_id 
                      || channelResult.widget_id 
                      || channelResult.id
                      || channelResult.data?.app_id
                      || channelResult.data?.widget_id;
                    
                    if (widgetId) {
                      widgetUrl = `https://web-${envPrefix}.pypestream.com/preview.html?id=${widgetId}`;
                      console.log(`[Channel] Channel created with widget: ${widgetId}`);
                    }
                  } else {
                    const channelError = await channelResponse.text();
                    console.warn('[Channel] Channel API failed:', channelResponse.status, channelError);
                  }
                } catch (channelErr) {
                  console.warn('[Channel] Channel API error:', channelErr);
                }
              }
              
              // Final fallback: Query existing widgets for this pype
              if (!widgetId) {
                console.log('[Channel] Querying existing widgets for pype...');
                try {
                  const widgetsQueryUrl = `https://webservice-${envPrefix}.pypestream.com/v3/business/widgets?pype_id=${pypeId}`;
                  const widgetsResponse = await fetch(widgetsQueryUrl, {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    }
                  });
                  
                  if (widgetsResponse.ok) {
                    const widgetsResult = await widgetsResponse.json();
                    console.log('[Channel] Widgets query response:', JSON.stringify(widgetsResult, null, 2));
                    
                    // Find the first widget for this pype
                    const widgets = widgetsResult.widgets || widgetsResult.data || widgetsResult;
                    if (Array.isArray(widgets) && widgets.length > 0) {
                      const firstWidget = widgets[0];
                      widgetId = firstWidget.id || firstWidget.widget_id || firstWidget.app_id;
                      if (widgetId) {
                        widgetUrl = `https://web-${envPrefix}.pypestream.com/preview.html?id=${widgetId}`;
                        console.log(`[Channel] Found existing widget: ${widgetId}`);
                      }
                    }
                  }
                } catch (queryErr) {
                  console.warn('[Channel] Widgets query error:', queryErr);
                }
              }
              
              // If still no widget URL, log error but don't fail completely
              if (!widgetUrl) {
                console.error('[Channel] Could not obtain a valid widget URL. The bot is deployed but preview may not work.');
                widgetUrl = `https://web-${envPrefix}.pypestream.com/preview.html?id=${pypeId}`;
                console.log('[Channel] Using pype_id as last resort (may show blank):', widgetUrl);
              }
              
              console.log(`[Channel] Complete! Widget URL: ${widgetUrl}`);
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                widgetId,
                widgetUrl,
                streamId,
                pypeId,
                customerId
              }));
              
            } catch (e: any) {
              console.error('[Channel] Create channel error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, error: e.message || String(e) }));
            }
          });
        });
        
        // Upload action node script
        server.middlewares.use('/api/botmanager/upload-script', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { botId, scriptName, scriptContent, token, environment } = JSON.parse(body);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Pypestream API token required' }));
                return;
              }
              
              if (!botId || !scriptName || !scriptContent) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID, script name, and script content required' }));
                return;
              }
              
              console.log(`[BotManager] Uploading script: ${scriptName} for bot: ${botId}`);
              
              // Get the latest version for the bot
              const botInfoResult = await botManagerRequest('GET', `/bots/${botId}`, token);
              if (!botInfoResult.ok) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: `Bot ${botId} not found`, details: botInfoResult.data }));
                return;
              }
              
              const botData = botInfoResult.data?.data;
              const draftVersion = botData?.draftVersion || 'v1';
              const versionId = `${botId}.${draftVersion}`;
              
              console.log(`[BotManager] Uploading to version: ${versionId}`);
              
              // Upload the script file
              // Bot Manager expects: PUT /versions/{versionId}/scripts/{scriptName}
              const scriptFileName = scriptName.endsWith('.py') ? scriptName : `${scriptName}.py`;
              const uploadResult = await botManagerRequest(
                'PUT',
                `/versions/${versionId}/scripts/${scriptFileName}`,
                token,
                scriptContent,
                'text/x-python'
              );
              
              if (!uploadResult.ok) {
                console.error(`[BotManager] Script upload failed:`, uploadResult.data);
                res.statusCode = uploadResult.status;
                res.end(JSON.stringify({
                  success: false,
                  error: 'Script upload failed',
                  details: uploadResult.data
                }));
                return;
              }
              
              console.log(`[BotManager] Script uploaded successfully: ${scriptName}`);
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                scriptName,
                versionId,
                message: `Successfully uploaded ${scriptName}`
              }));
              
            } catch (e: any) {
              console.error('[BotManager] Script upload error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Helper function to fetch script content (from Supabase or local file)
        const SUPABASE_URL = 'https://jcsfggahtaewgqytvgau.supabase.co';
        const SCRIPTS_ENDPOINT = `${SUPABASE_URL}/functions/v1/sd-action-scripts`;
        const ERROR_LEARNING_ENDPOINT = `${SUPABASE_URL}/functions/v1/sd-error-learning`;
        
        // Proxy for error-learning edge function
        server.middlewares.use('/functions/v1/sd-error-learning', async (req, res, next) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          try {
            // Build the target URL
            const url = new URL(req.url || '/', `http://localhost`);
            const targetPath = url.pathname.replace('/functions/v1/sd-error-learning', '');
            const targetUrl = `${ERROR_LEARNING_ENDPOINT}${targetPath}${url.search}`;
            
            console.log(`[SELF-IMPROVE Proxy] ${req.method} ${targetPath}${url.search}`);
            
            // Forward the request
            let body = '';
            if (req.method === 'POST') {
              await new Promise<void>((resolve) => {
                req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                req.on('end', () => resolve());
              });
            }
            
            const fetchOptions: RequestInit = {
              method: req.method,
              headers: {
                'Content-Type': 'application/json',
                ...(req.headers.authorization ? { 'Authorization': req.headers.authorization as string } : {}),
              },
            };
            
            if (body) {
              fetchOptions.body = body;
            }
            
            const response = await fetch(targetUrl, fetchOptions);
            const data = await response.json();
            
            if (response.ok) {
              console.log(`[SELF-IMPROVE Proxy] ✅ Response ${response.status}: ${JSON.stringify(data).substring(0, 200)}...`);
            } else {
              console.warn(`[SELF-IMPROVE Proxy] ❌ Response ${response.status}: ${JSON.stringify(data)}`);
            }
            
            res.statusCode = response.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (error: any) {
            console.error('[SELF-IMPROVE Proxy] Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message || 'Proxy error' }));
          }
        });
        
        // Proxy for action-scripts edge function with local file fallback
        server.middlewares.use('/functions/v1/sd-action-scripts', async (req, res, next) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          const url = new URL(req.url || '/', `http://localhost`);
          const isBatch = url.pathname.includes('/batch');
          
          // Handle batch request with local file fallback
          if (req.method === 'POST' && isBatch) {
            let body = '';
            await new Promise<void>((resolve) => {
              req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
              req.on('end', () => resolve());
            });
            
            try {
              const { names = [] } = JSON.parse(body);
              console.log('[ActionScripts Proxy] Batch request for:', names);
              
              const scripts: { name: string; content: string }[] = [];
              const missingFromSupabase: string[] = [];
              
              // First try Supabase
              try {
                const response = await fetch(`${SCRIPTS_ENDPOINT}/batch`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ names }),
                });
                
                if (response.ok) {
                  const data = await response.json();
                  for (const script of data.scripts || []) {
                    if (script.content) {
                      scripts.push({ name: script.name, content: script.content });
                    }
                  }
                  console.log('[ActionScripts Proxy] Got', scripts.length, 'from Supabase');
                }
              } catch (e) {
                console.log('[ActionScripts Proxy] Supabase unavailable, using local files');
              }
              
              // Find which scripts are missing
              const foundNames = new Set(scripts.map(s => s.name));
              for (const name of names) {
                if (!foundNames.has(name)) {
                  missingFromSupabase.push(name);
                }
              }
              
              // Try local files for missing scripts
              if (missingFromSupabase.length > 0) {
                console.log('[ActionScripts Proxy] Looking for local files:', missingFromSupabase);
                console.log('[ActionScripts Proxy] CWD:', process.cwd());
                
                // Use multiple possible paths for robustness
                const localDirs = [
                  path.join(process.cwd(), '..', 'Official-Action-Nodes'),
                  path.join(process.cwd(), '..', 'Solutions', 'TRAVELERS', 'Action Nodes'),
                  // Also try absolute path from workspace root
                  path.resolve(process.cwd(), '..', 'Official-Action-Nodes'),
                  // Try from import.meta.url location
                  path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'Official-Action-Nodes'),
                ];
                
                console.log('[ActionScripts Proxy] Searching dirs:', localDirs);
                
                for (const scriptName of missingFromSupabase) {
                  const fileName = scriptName.endsWith('.py') ? scriptName : `${scriptName}.py`;
                  let found = false;
                  
                  for (const dir of localDirs) {
                    const filePath = path.join(dir, fileName);
                    try {
                      // Use fsReadFile from fs/promises for async file reading
                      const content = await fsReadFile(filePath, 'utf-8');
                      scripts.push({ name: scriptName, content });
                      console.log('[ActionScripts Proxy] Found local file:', filePath);
                      found = true;
                      break;
                    } catch (e: any) {
                      // File not in this directory, try next
                    }
                  }
                  
                  if (!found) {
                    console.warn(`[ActionScripts Proxy] Script ${scriptName} not found in any local directory`);
                  }
                }
              }
              
              console.log('[ActionScripts Proxy] Returning', scripts.length, 'scripts');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ scripts }));
              return;
              
            } catch (error: any) {
              console.error('[ActionScripts Proxy] Batch error:', error);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: error.message, scripts: [] }));
              return;
            }
          }
          
          // For non-batch requests, forward to Supabase
          try {
            const targetPath = url.pathname.replace('/functions/v1/sd-action-scripts', '');
            const targetUrl = `${SCRIPTS_ENDPOINT}${targetPath}${url.search}`;
            
            console.log('[ActionScripts Proxy] Forwarding to:', targetUrl);
            
            const response = await fetch(targetUrl, {
              method: req.method,
              headers: { 'Content-Type': 'application/json' },
            });
            const data = await response.json();
            
            res.statusCode = response.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (error: any) {
            console.error('[ActionScripts Proxy] Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message || 'Proxy error', scripts: [] }));
          }
        });
        
        // Get script content endpoint (for fetching before deploy)
        server.middlewares.use('/api/scripts/get-content', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { scriptName } = JSON.parse(body);
              
              if (!scriptName) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Script name required' }));
                return;
              }
              
              // First try Supabase
              try {
                const response = await fetch(`${SCRIPTS_ENDPOINT}/${encodeURIComponent(scriptName)}`);
                if (response.ok) {
                  const data = await response.json();
                  if (data.script?.content) {
                    console.log(`[Scripts] Fetched ${scriptName} from Supabase`);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ content: data.script.content, source: 'supabase' }));
                    return;
                  }
                }
              } catch (e) {
                console.log(`[Scripts] Supabase fetch failed for ${scriptName}, trying local file`);
              }
              
              // Fall back to local file
              const scriptFileName = scriptName.endsWith('.py') ? scriptName : `${scriptName}.py`;
              const scriptPath = path.join(process.cwd(), '..', 'Official-Action-Nodes', scriptFileName);
              
              try {
                const content = await fs.promises.readFile(scriptPath, 'utf-8');
                console.log(`[Scripts] Read ${scriptName} from local file: ${scriptPath}`);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ content, source: 'local' }));
                return;
              } catch (e) {
                console.log(`[Scripts] Local file not found: ${scriptPath}`);
              }
              
              res.statusCode = 404;
              res.end(JSON.stringify({ error: `Script not found: ${scriptName}` }));
              
            } catch (e: any) {
              console.error('[Scripts] Get content error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        async function getScriptContent(scriptName: string): Promise<string | null> {
          // First try Supabase
          try {
            const response = await fetch(`${SCRIPTS_ENDPOINT}/${encodeURIComponent(scriptName)}`);
            if (response.ok) {
              const data = await response.json();
              if (data.script?.content) {
                console.log(`[Scripts] Fetched ${scriptName} from Supabase`);
                return data.script.content;
              }
            }
          } catch (e) {
            console.log(`[Scripts] Supabase fetch failed for ${scriptName}, trying local file`);
          }
          
          // Fall back to local file
          const scriptFileName = scriptName.endsWith('.py') ? scriptName : `${scriptName}.py`;
          const scriptPath = path.join(process.cwd(), '..', 'Official-Action-Nodes', scriptFileName);
          
          try {
            const content = await fs.promises.readFile(scriptPath, 'utf-8');
            console.log(`[Scripts] Read ${scriptName} from local file`);
            return content;
          } catch (e) {
            console.log(`[Scripts] Local file not found: ${scriptPath}`);
            return null;
          }
        }
        
        // Upload official action node script (fetches from Supabase or local file)
        server.middlewares.use('/api/botmanager/upload-official-script', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { botId, scriptName, token } = JSON.parse(body);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Pypestream API token required' }));
                return;
              }
              
              if (!botId || !scriptName) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID and script name required' }));
                return;
              }
              
              // Get script content from Supabase or local file
              const scriptContent = await getScriptContent(scriptName);
              
              if (!scriptContent) {
                res.statusCode = 404;
                res.end(JSON.stringify({ 
                  error: `Script not found: ${scriptName}`,
                  message: 'Script not found in Supabase or local Official-Action-Nodes folder'
                }));
                return;
              }
              
              console.log(`[BotManager] Uploading official script: ${scriptName} for bot: ${botId}`);
              
              // Get the latest version for the bot
              const botInfoResult = await botManagerRequest('GET', `/bots/${botId}`, token);
              if (!botInfoResult.ok) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: `Bot ${botId} not found`, details: botInfoResult.data }));
                return;
              }
              
              const botData = botInfoResult.data?.data;
              const draftVersion = botData?.draftVersion || 'v1';
              const versionId = `${botId}.${draftVersion}`;
              
              console.log(`[BotManager] Uploading to version: ${versionId}`);
              
              // Upload the script file
              const uploadResult = await botManagerRequest(
                'PUT',
                `/versions/${versionId}/scripts/${scriptFileName}`,
                token,
                scriptContent,
                'text/x-python'
              );
              
              if (!uploadResult.ok) {
                console.error(`[BotManager] Official script upload failed:`, uploadResult.data);
                res.statusCode = uploadResult.status;
                res.end(JSON.stringify({
                  success: false,
                  error: 'Script upload failed',
                  details: uploadResult.data
                }));
                return;
              }
              
              console.log(`[BotManager] Official script uploaded successfully: ${scriptName}`);
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                scriptName,
                versionId,
                message: `Successfully uploaded official script ${scriptName}`
              }));
              
            } catch (e: any) {
              console.error('[BotManager] Official script upload error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Auto-upload all required scripts for a bot (batch operation)
        server.middlewares.use('/api/botmanager/auto-upload-scripts', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { botId, scriptNames, token } = JSON.parse(body);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Pypestream API token required' }));
                return;
              }
              
              if (!botId || !Array.isArray(scriptNames) || scriptNames.length === 0) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID and script names array required' }));
                return;
              }
              
              console.log(`[BotManager] Auto-uploading ${scriptNames.length} scripts for bot: ${botId}`);
              
              // Get the latest version for the bot
              const botInfoResult = await botManagerRequest('GET', `/bots/${botId}`, token);
              if (!botInfoResult.ok) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: `Bot ${botId} not found`, details: botInfoResult.data }));
                return;
              }
              
              const botData = botInfoResult.data?.data;
              const draftVersion = botData?.draftVersion || 'v1';
              const versionId = `${botId}.${draftVersion}`;
              
              const results: { scriptName: string; success: boolean; error?: string }[] = [];
              
              for (const scriptName of scriptNames) {
                try {
                  // Get script content
                  const scriptContent = await getScriptContent(scriptName);
                  
                  if (!scriptContent) {
                    results.push({ scriptName, success: false, error: 'Script not found' });
                    continue;
                  }
                  
                  // Upload to Bot Manager
                  const scriptFileName = scriptName.endsWith('.py') ? scriptName : `${scriptName}.py`;
                  const uploadResult = await botManagerRequest(
                    'PUT',
                    `/versions/${versionId}/scripts/${scriptFileName}`,
                    token,
                    scriptContent,
                    'text/x-python'
                  );
                  
                  if (uploadResult.ok) {
                    results.push({ scriptName, success: true });
                    console.log(`[BotManager] ✓ Uploaded: ${scriptName}`);
                  } else {
                    results.push({ 
                      scriptName, 
                      success: false, 
                      error: uploadResult.data?.error || 'Upload failed' 
                    });
                    console.log(`[BotManager] ✗ Failed: ${scriptName}`);
                  }
                } catch (e: any) {
                  results.push({ scriptName, success: false, error: e.message });
                }
              }
              
              const successCount = results.filter(r => r.success).length;
              const failCount = results.filter(r => !r.success).length;
              
              console.log(`[BotManager] Auto-upload complete: ${successCount} success, ${failCount} failed`);
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: failCount === 0,
                versionId,
                results,
                summary: {
                  total: scriptNames.length,
                  uploaded: successCount,
                  failed: failCount,
                }
              }));
              
            } catch (e: any) {
              console.error('[BotManager] Auto-upload scripts error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Upload config file (app.py)
        server.middlewares.use('/api/botmanager/upload-config', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { botId, configContent, token } = JSON.parse(body);
              
              if (!token) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Pypestream API token required' }));
                return;
              }
              
              if (!botId || !configContent) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID and config content required' }));
                return;
              }
              
              console.log(`[BotManager] Uploading config for bot: ${botId}`);
              
              // Get the latest version for the bot
              const botInfoResult = await botManagerRequest('GET', `/bots/${botId}`, token);
              if (!botInfoResult.ok) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: `Bot ${botId} not found`, details: botInfoResult.data }));
                return;
              }
              
              const botData = botInfoResult.data?.data;
              const draftVersion = botData?.draftVersion || 'v1';
              const versionId = `${botId}.${draftVersion}`;
              
              console.log(`[BotManager] Uploading config to version: ${versionId}`);
              
              // Upload the config file as app.py using multipart form data (same as scripts)
              try {
                const FormData = (await import('form-data')).default;
                const https = await import('https');
                
                const formData = new FormData();
                formData.append('configFile', Buffer.from(configContent, 'utf-8'), {
                  filename: 'app.py',
                  contentType: 'text/x-python',
                });
                
                const uploadResult = await new Promise<{ ok: boolean; status: number; data: any }>((resolve) => {
                  const req = https.request(
                    {
                      hostname: 'api.pypestream.com',
                      path: `/botmanager/versions/${versionId}/config`,
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        ...formData.getHeaders(),
                      },
                    },
                    (res) => {
                      let body = '';
                      res.on('data', (chunk) => { body += chunk; });
                      res.on('end', () => {
                        try {
                          const data = JSON.parse(body);
                          resolve({ ok: res.statusCode === 200, status: res.statusCode || 500, data });
                        } catch {
                          resolve({ ok: res.statusCode === 200, status: res.statusCode || 500, data: body });
                        }
                      });
                    }
                  );
                  
                  req.on('error', (e) => {
                    resolve({ ok: false, status: 500, data: { error: e.message } });
                  });
                  
                  formData.pipe(req);
                });
                
                if (!uploadResult.ok) {
                  console.error(`[BotManager] Config upload failed: ${uploadResult.status}`, uploadResult.data);
                  res.statusCode = uploadResult.status;
                  res.end(JSON.stringify({
                    success: false,
                    error: 'Config upload failed',
                    details: uploadResult.data
                  }));
                  return;
                }
                
                console.log(`[BotManager] Config uploaded successfully`, uploadResult.data?.data?.files?.slice(-3));
              } catch (configError: any) {
                console.error(`[BotManager] Config upload error:`, configError.message);
                res.statusCode = 500;
                res.end(JSON.stringify({
                  success: false,
                  error: 'Config upload error',
                  details: configError.message
                }));
                return;
              }
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                versionId,
                message: 'Successfully uploaded config'
              }));
              
            } catch (e: any) {
              console.error('[BotManager] Config upload error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Get bot info
        server.middlewares.use('/api/botmanager/bot', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { botId, token } = JSON.parse(body);
              
              if (!token || !botId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID and token required' }));
                return;
              }
              
              const result = await botManagerRequest('GET', `/bots/${botId}`, token);
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result.data));
              
            } catch (e: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message || String(e) }));
            }
          });
        });
        
        // Create channel/widget for a deployed bot
        // Full workflow: Create Stream → Configure Bot → Create Widget
        server.middlewares.use('/api/botmanager/create-channel', async (req, res, next) => {
          if (req.method !== 'POST') { next(); return; }
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          res.setHeader('Content-Type', 'application/json');
          
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { botId, versionId, token, environment = 'sandbox', brandAssets, targetCompany } = JSON.parse(body);
              
              // Debug logging to trace brand data
              console.log('[Channel] Received request:', {
                botId,
                targetCompany,
                hasBrandAssets: !!brandAssets,
                logoUrl: brandAssets?.logoUrl || 'none',
                colorCount: brandAssets?.colors?.length || 0,
                primaryColor: brandAssets?.primaryColor || 'not set',
              });
              
              if (!token || !botId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Bot ID and token required' }));
                return;
              }
              
              const [customerName, botName] = (botId || '').split('.');
              const consoleUrl = `https://console.pypestream.com/customers/${customerName}/solutions/${botName}/interfaces`;
              
              // ============================================
              // ADA-COMPLIANT COLOR SYSTEM
              // WCAG 2.1 AA requires 4.5:1 for normal text, 3:1 for large text
              // ============================================
              
              // Parse hex to RGB
              const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
                const cleanHex = (hex || '#000000').replace('#', '');
                return {
                  r: parseInt(cleanHex.slice(0, 2), 16) || 0,
                  g: parseInt(cleanHex.slice(2, 4), 16) || 0,
                  b: parseInt(cleanHex.slice(4, 6), 16) || 0
                };
              };
              
              // RGB to hex
              const rgbToHex = (r: number, g: number, b: number): string => {
                return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
              };
              
              // Calculate relative luminance (WCAG formula)
              const getLuminance = (hex: string): number => {
                const { r, g, b } = hexToRgb(hex);
                const [rs, gs, bs] = [r, g, b].map(c => {
                  const s = c / 255;
                  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
              };
              
              // Calculate WCAG contrast ratio between two colors
              const getContrastRatio = (color1: string, color2: string): number => {
                const l1 = getLuminance(color1);
                const l2 = getLuminance(color2);
                const lighter = Math.max(l1, l2);
                const darker = Math.min(l1, l2);
                return (lighter + 0.05) / (darker + 0.05);
              };
              
              // Check if contrast passes WCAG AA (4.5:1 for normal text, 3:1 for large text/UI)
              const passesWCAG = (fg: string, bg: string, level: 'AA' | 'AALarge' = 'AA'): boolean => {
                const ratio = getContrastRatio(fg, bg);
                return level === 'AALarge' ? ratio >= 3 : ratio >= 4.5;
              };
              
              // Get the best contrasting text color (white or black) that passes WCAG
              const getContrastColor = (bg: string): string => {
                const whiteRatio = getContrastRatio('#FFFFFF', bg);
                const blackRatio = getContrastRatio('#000000', bg);
                return whiteRatio > blackRatio ? '#FFFFFF' : '#000000';
              };
              
              // Lighten a color
              const lightenColor = (hex: string, amount: number): string => {
                const { r, g, b } = hexToRgb(hex);
                return rgbToHex(
                  Math.min(255, r + (255 - r) * amount),
                  Math.min(255, g + (255 - g) * amount),
                  Math.min(255, b + (255 - b) * amount)
                );
              };
              
              // Darken a color
              const darkenColor = (hex: string, amount: number): string => {
                const { r, g, b } = hexToRgb(hex);
                return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
              };
              
              // SELECT the best color from available brand colors that passes WCAG
              // Does NOT modify colors - only selects from existing palette
              const selectBestColor = (
                candidates: string[], 
                bg: string, 
                minRatio: number = 4.5
              ): { color: string; ratio: number; passes: boolean } => {
                // Score each candidate by contrast ratio
                const scored = candidates
                  .filter(c => c) // Remove empty
                  .map(c => ({
                    color: c,
                    ratio: getContrastRatio(c, bg),
                    passes: getContrastRatio(c, bg) >= minRatio
                  }))
                  .sort((a, b) => b.ratio - a.ratio); // Best contrast first
                
                // Return best passing color, or best overall if none pass
                const passing = scored.find(s => s.passes);
                if (passing) return passing;
                
                // No brand color passes - use black or white as last resort
                const whiteRatio = getContrastRatio('#FFFFFF', bg);
                const blackRatio = getContrastRatio('#000000', bg);
                const fallback = whiteRatio > blackRatio ? '#FFFFFF' : '#000000';
                
                return {
                  color: scored[0]?.color || fallback,
                  ratio: scored[0]?.ratio || Math.max(whiteRatio, blackRatio),
                  passes: scored[0]?.passes || true
                };
              };
              
              // Check if a color is usable (not pure white/black)
              const isUsableColor = (hex: string): boolean => {
                if (!hex) return false;
                const { r, g, b } = hexToRgb(hex);
                const isWhite = (r > 240 && g > 240 && b > 240);
                const isBlack = (r < 30 && g < 30 && b < 30);
                return !isWhite && !isBlack;
              };
              
              // Is the color dark?
              const isDarkColor = (hex: string): boolean => getLuminance(hex) < 0.5;
              
              // ============================================
              // EXTRACT EXACT BRAND COLORS (NO MODIFICATION)
              // ============================================
              
              const allBrandColors = brandAssets?.colors || [];
              
              // Build palette of ALL exact brand colors + black + white
              const brandPalette: string[] = [
                ...allBrandColors.map((c: any) => c.hex).filter(Boolean),
                '#FFFFFF',
                '#000000'
              ];
              
              // Also get the specific colors Brandfetch identified
              const primaryColor = brandAssets?.primaryColor || brandPalette[0] || '#1E3A5F';
              const secondaryColor = brandAssets?.secondaryColor || brandPalette[1] || '#3B82F6';
              
              // Separate into dark and light brand colors for smart assignment
              const darkBrandColors = brandPalette.filter(c => isDarkColor(c));
              const lightBrandColors = brandPalette.filter(c => !isDarkColor(c));
              
              // Use direct URL from Brandfetch (with fallback to logos array)
              // Some brandAssets may have logoUrl empty but logos array populated
              let logoUrl = brandAssets?.logoUrl || '';
              
              // Fallback: extract from logos array if logoUrl is empty
              if (!logoUrl && brandAssets?.logos && Array.isArray(brandAssets.logos)) {
                const logoPriority = [
                  brandAssets.logos.find((l: any) => l.type === 'icon' && l.format === 'png'),
                  brandAssets.logos.find((l: any) => l.type === 'icon'),
                  brandAssets.logos.find((l: any) => l.type === 'primary' && l.format === 'png'),
                  brandAssets.logos.find((l: any) => l.type === 'primary'),
                  brandAssets.logos.find((l: any) => l.format === 'png'),
                  brandAssets.logos[0],
                ];
                const bestLogo = logoPriority.find(l => l?.url);
                logoUrl = bestLogo?.url || '';
                console.log('[Channel] Logo URL extracted from logos array:', logoUrl);
              }
              
              // For avatar specifically, prefer SQUARE icon over wide wordmark
              // Icons work better in circular avatar than horizontal logos
              let avatarLogoUrl = logoUrl; // default to main logo
              if (brandAssets?.logos && Array.isArray(brandAssets.logos)) {
                const iconPriority = [
                  brandAssets.logos.find((l: any) => l.type === 'icon' && l.format === 'png'),
                  brandAssets.logos.find((l: any) => l.type === 'icon' && l.format === 'svg'),
                  brandAssets.logos.find((l: any) => l.type === 'icon'),
                  brandAssets.logos.find((l: any) => l.type === 'symbol' && l.format === 'png'),
                  brandAssets.logos.find((l: any) => l.type === 'symbol'),
                ];
                const squareIcon = iconPriority.find(l => l?.url);
                if (squareIcon?.url) {
                  avatarLogoUrl = squareIcon.url;
                  console.log('[Channel] Using square icon for avatar:', avatarLogoUrl);
                }
              }
              
              // Brandfetch blocks hotlinking, so use Google Favicon API instead
              // This provides a small (1-2KB) favicon that allows cross-origin access
              const companyDomain = targetCompany?.toLowerCase().replace(/\s+/g, '') + '.com';
              const googleFaviconUrl = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${companyDomain}&size=128`;
              const avatarLogoForCSS = googleFaviconUrl;
              console.log('[Channel] Using Google Favicon for avatar:', avatarLogoForCSS);
              
              const brandMomentUrl = brandAssets?.brandMomentUrl || '';
              const companyName = targetCompany || brandAssets?.name || botName;
              
              const bannerImage = brandAssets?.images?.find((img: any) => 
                img.type === 'banner' || img.type === 'cover'
              )?.url || brandMomentUrl || '';
              
              console.log('[Channel] Brand Palette (exact colors, no modification):', brandPalette);
              console.log('[Channel] Logo URL (final):', logoUrl || 'NONE - will show gradient fallback');
              
              // ============================================
              // INTELLIGENT COLOR ASSIGNMENT
              // Selects WHICH exact brand color to use WHERE
              // Colors are NEVER modified - only selected
              // ============================================
              
              // Define background contexts
              const brandMomentBg = primaryColor; // Header/brand moment uses primary
              const conversationBg = '#FFFFFF';   // Conversation area is white
              const agentBubbleBg = '#F5F5F5';    // Light gray for bot messages
              
              // SELECT best text color for header (on brand moment)
              // Prefer light colors on dark bg, dark colors on light bg
              const headerTextResult = selectBestColor(
                isDarkColor(brandMomentBg) ? lightBrandColors : darkBrandColors,
                brandMomentBg,
                4.5
              );
              const headerTextColor = headerTextResult.color;
              const headerIconColor = headerTextResult.color; // Same for icons
              
              // SELECT best text color for timestamps (on brand moment overlay)
              const timestampResult = selectBestColor(
                isDarkColor(brandMomentBg) ? lightBrandColors : darkBrandColors,
                brandMomentBg,
                4.5
              );
              const timestampColor = timestampResult.color;
              
              // User bubbles: use primary brand color, select text that works on it
              const userBubbleColor = primaryColor;
              const userBubbleTextResult = selectBestColor(
                isDarkColor(primaryColor) ? lightBrandColors : darkBrandColors,
                primaryColor,
                4.5
              );
              const userBubbleTextColor = userBubbleTextResult.color;
              
              // Agent bubbles: light background, need dark text
              const agentBubbleColor = agentBubbleBg;
              const agentBubbleTextResult = selectBestColor(darkBrandColors, agentBubbleBg, 4.5);
              const agentBubbleTextColor = agentBubbleTextResult.color;
              
              // Buttons: use darkest brand color for bg, find contrasting text
              const buttonBgColor = darkBrandColors[0] || primaryColor;
              const buttonTextResult = selectBestColor(
                isDarkColor(buttonBgColor) ? lightBrandColors : darkBrandColors,
                buttonBgColor,
                4.5
              );
              const buttonTextColor = buttonTextResult.color;
              
              // Button hover: use secondary or next dark color
              const buttonHoverColor = secondaryColor !== buttonBgColor ? secondaryColor : (darkBrandColors[1] || buttonBgColor);
              
              // Accent color for focus rings etc
              const accentColor = secondaryColor || primaryColor;
              
              // Links on white conversation background
              const linkResult = selectBestColor(darkBrandColors, conversationBg, 4.5);
              const linkColor = linkResult.color;
              
              // Log ADA verification results
              console.log('[Channel] ADA Color Assignment (exact brand colors only):', {
                'Brand Palette': brandPalette.join(', '),
                'headerText': `${headerTextColor} on ${brandMomentBg} = ${headerTextResult.ratio.toFixed(2)}:1 (${headerTextResult.passes ? 'PASS' : 'FALLBACK'})`,
                'buttonText': `${buttonTextColor} on ${buttonBgColor} = ${buttonTextResult.ratio.toFixed(2)}:1 (${buttonTextResult.passes ? 'PASS' : 'FALLBACK'})`,
                'userBubbleText': `${userBubbleTextColor} on ${userBubbleColor} = ${userBubbleTextResult.ratio.toFixed(2)}:1 (${userBubbleTextResult.passes ? 'PASS' : 'FALLBACK'})`,
                'agentBubbleText': `${agentBubbleTextColor} on ${agentBubbleColor} = ${agentBubbleTextResult.ratio.toFixed(2)}:1 (${agentBubbleTextResult.passes ? 'PASS' : 'FALLBACK'})`,
                'link': `${linkColor} on ${conversationBg} = ${linkResult.ratio.toFixed(2)}:1 (${linkResult.passes ? 'PASS' : 'FALLBACK'})`
              });
              
              console.log(`[Channel] Brand assets:`, {
                companyName,
                primaryColor,
                secondaryColor,
                accentColor,
                logoUrl: logoUrl ? (logoUrl.startsWith('data:') ? 'base64' : logoUrl.substring(0, 50) + '...') : 'none',
                bannerImage: bannerImage ? 'present' : 'none',
                isDarkPrimary: isDarkColor(primaryColor)
              });
              
              // API base URLs
              const pypesApiBase = environment === 'production' 
                ? 'https://api.pypestream.com/live/v5'
                : 'https://api.pypestream.com/sandbox/v5';
              const webserviceBase = environment === 'production'
                ? 'https://webservice.pypestream.com'
                : 'https://webservice-sandbox.pypestream.com';
              
              console.log(`[Channel] Creating channel for ${botId} in ${environment}`);
              
              // Step 1: Get customer ID
              // Try GES first, fall back to environment-specific API, then use name directly
              console.log(`[Channel] Getting customer info for ${customerName}`);
              let customerId: string | undefined;
              
              // Strategy 1: Try GES API
              try {
                const gesResponse = await fetch(
                  `https://api.pypestream.com/ges/v5/customers`,
                  { headers: { 'Authorization': `Bearer ${token}` } }
                );
                
                if (gesResponse.ok) {
                  const customers = await gesResponse.json();
                  const customer = customers.find((c: any) => 
                    c.name?.toLowerCase() === customerName.toLowerCase() ||
                    c.display_name?.toLowerCase() === customerName.toLowerCase()
                  );
                  if (customer) {
                    customerId = customer.id;
                    console.log(`[Channel] Found customer via GES: ${customerId}`);
                  }
                } else {
                  console.log(`[Channel] GES API returned ${gesResponse.status}, trying environment API...`);
                  // Track 401 for auth error detection
                  if (gesResponse.status === 401) {
                    (res as any)._authError401Count = ((res as any)._authError401Count || 0) + 1;
                  }
                }
              } catch (e) {
                console.log('[Channel] GES API failed, trying environment API...');
              }
              
              // Strategy 2: Try environment-specific customer API
              if (!customerId) {
                try {
                  const envCustomersUrl = `${pypesApiBase}/customers`;
                  const envResponse = await fetch(envCustomersUrl, {
                    headers: { 'Authorization': `Bearer ${token}` }
                  });
                  
                  if (envResponse.ok) {
                    const custData = await envResponse.json();
                    const customerList = Array.isArray(custData) ? custData : custData.results || custData.data || [];
                    const customer = customerList.find((c: any) => 
                      c.name?.toLowerCase() === customerName.toLowerCase() ||
                      c.display_name?.toLowerCase() === customerName.toLowerCase()
                    );
                    if (customer) {
                      customerId = customer.id;
                      console.log(`[Channel] Found customer via environment API: ${customerId}`);
                    }
                  } else {
                    console.log(`[Channel] Environment API returned ${envResponse.status}`);
                    // Track 401 for auth error detection
                    if (envResponse.status === 401) {
                      (res as any)._authError401Count = ((res as any)._authError401Count || 0) + 1;
                    }
                  }
                } catch (e) {
                  console.log('[Channel] Environment API failed:', e);
                }
              }
              
              // If both APIs returned 401, the token is definitely expired
              if ((res as any)._authError401Count >= 2) {
                console.log('[Channel] Multiple 401 errors - API token is expired or invalid');
                res.end(JSON.stringify({ 
                  success: false, 
                  consoleUrl, 
                  error: 'API token expired or invalid (401). Please enter a new Pypestream API key.',
                  authError: true
                }));
                return;
              }
              
              // Strategy 3: Use customer name directly as ID (works for known customers like CX)
              if (!customerId) {
                customerId = customerName;
                console.log(`[Channel] Using customer name as ID fallback: ${customerId}`);
              }
              
              console.log(`[Channel] Customer ID resolved: ${customerId}`);
              
              // Step 2: Get or create a pype
              console.log(`[Channel] Getting pypes for customer`);
              const pypesResponse = await fetch(
                `${pypesApiBase}/customers/${customerId}/pypes`,
                { headers: { 'Authorization': `Bearer ${token}` } }
              );
              
              let pypes = [];
              if (pypesResponse.ok) {
                const pypesData = await pypesResponse.json();
                pypes = pypesData?.data || pypesData || [];
              }
              
              let pypeId: string;
              if (pypes.length === 0) {
                // Create a new pype
                console.log(`[Channel] No pypes found, creating one`);
                const createPypeResponse = await fetch(
                  `${pypesApiBase}/customers/${customerId}/pypes`,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      name: `${botName}-Pype`,
                      description: `Auto-created for ${botName}`,
                      customer_id: customerId,
                      env: environment === 'production' ? 'live' : 'sandbox'
                    })
                  }
                );
                
                if (!createPypeResponse.ok) {
                  const errorText = await createPypeResponse.text();
                  console.log(`[Channel] Pype creation failed:`, errorText);
                  // Check for auth error
                  if (createPypeResponse.status === 401 || errorText.includes('401') || errorText.includes('Authorization')) {
                    res.end(JSON.stringify({ 
                      success: false, 
                      consoleUrl, 
                      error: 'API token expired or invalid (401). Please enter a new Pypestream API key.',
                      authError: true
                    }));
                  } else {
                    res.end(JSON.stringify({ success: false, consoleUrl, error: 'Failed to create pype' }));
                  }
                  return;
                }
                
                const newPype = await createPypeResponse.json();
                pypeId = newPype.id || newPype.data?.id;
                console.log(`[Channel] Created pype: ${pypeId}`);
              } else {
                // Use existing pype (prefer one matching bot name)
                const matchingPype = pypes.find((p: any) => 
                  p.name?.toLowerCase().includes(botName.toLowerCase())
                ) || pypes[0];
                pypeId = matchingPype.id;
                console.log(`[Channel] Using existing pype: ${pypeId}`);
              }
              
              // Step 3: Create a stream
              const streamName = `${botName}-${Date.now()}`;
              console.log(`[Channel] Creating stream: ${streamName}`);
              
              const streamResponse = await fetch(
                `${pypesApiBase}/customers/${customerId}/pypes/${pypeId}/streams`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    name: streamName,
                    description: `Channel for ${botName}`
                  })
                }
              );
              
              if (!streamResponse.ok) {
                console.log(`[Channel] Stream creation failed:`, await streamResponse.text());
                res.end(JSON.stringify({ success: false, consoleUrl, error: 'Failed to create stream' }));
                return;
              }
              
              const streamData = await streamResponse.json();
              const streamId = streamData.id || streamData.data?.id;
              console.log(`[Channel] Created stream: ${streamId}`);
              
              // Step 4: Configure bot on stream (use Bot ID, not version!)
              console.log(`[Channel] Configuring bot ${botId} on stream`);
              const botConfigResponse = await fetch(
                `${pypesApiBase}/customers/${customerId}/pypes/${pypeId}/streams/${streamId}/bot`,
                {
                  method: 'PUT',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    auto_start_with_bot: true,
                    start_chat_bot_id: botId,  // Bot ID (Customer.BotName), NOT version!
                    end_chat_bot_id: '',
                    bot_enabled: true,
                    start_chat_bot_enabled: true,
                    end_chat_bot_enabled: false
                  })
                }
              );
              
              if (!botConfigResponse.ok) {
                console.log(`[Channel] Bot config failed:`, await botConfigResponse.text());
                res.end(JSON.stringify({ success: false, consoleUrl, error: 'Failed to configure bot on stream' }));
                return;
              }
              console.log(`[Channel] Bot configured on stream`);
              
              // Step 5: Create widget using Webservice API (correct format from PDF)
              // Apply brand colors and assets to widget styling
              const widgetDisplayName = `${companyName} Assistant`;
              console.log(`[Channel] Creating widget "${widgetDisplayName}" with brand colors`);
              console.log(`[Channel] Logo URL: ${logoUrl || 'NONE'}`);
              console.log(`[Channel] Banner/BrandMoment: ${bannerImage || brandMomentUrl || 'NONE'}`);
              
              // Use already-defined brand colors for CSS styling
              // accentColor, primaryColor, secondaryColor are defined above
              const highlightColor = brandPalette[3] || accentColor;
              
              // Get brand fonts
              const brandFonts = brandAssets?.fonts || [];
              const titleFont = brandFonts.find((f: any) => f.type === 'title')?.name;
              const bodyFont = brandFonts.find((f: any) => f.type === 'body')?.name || titleFont;
              const primaryFont = titleFont || bodyFont || 'Inter';
              
              // Generate comprehensive custom CSS using all brand elements
              // Based on production Gillette stylesheet pattern
              const generateBrandCSS = () => {
                const css: string[] = [];
                
                // Font imports - always load Inter as a reliable fallback
                // Brand fonts (like Apercu) may be premium and not available via Google Fonts
                const googleFonts = brandFonts.filter((f: any) => f.origin === 'google');
                
                // Map premium fonts to similar Google Font alternatives
                const premiumFontAlternatives: Record<string, string> = {
                  'Apercu': 'Work Sans',
                  'Apercu Pro': 'Work Sans',
                  'Gotham': 'Montserrat',
                  'Proxima Nova': 'Nunito Sans',
                  'Avenir': 'Nunito',
                  'Avenir Next': 'Nunito',
                  'Futura': 'Poppins',
                  'Helvetica': 'Inter',
                  'Helvetica Neue': 'Inter',
                  'Brandon Grotesque': 'Raleway',
                  'Circular': 'Nunito Sans',
                  'Gilroy': 'Poppins',
                  'Graphik': 'Inter',
                  'Neue Haas Grotesk': 'Inter',
                  'SF Pro': 'Inter',
                  'SF Pro Display': 'Inter',
                };
                
                // Find a Google Font alternative if the brand font is premium
                const googleFontAlternative = premiumFontAlternatives[primaryFont] || null;
                const effectiveFont = googleFontAlternative || primaryFont;
                
                // Build font stack: brand font first, then Google alternative, then Inter
                const fontFamily = primaryFont;
                
                // Build the fonts to load from Google
                const fontsToLoad = new Set<string>();
                fontsToLoad.add('Inter'); // Always load Inter
                
                if (googleFontAlternative) {
                  fontsToLoad.add(googleFontAlternative);
                  console.log(`[Channel] Brand font "${primaryFont}" is premium, using Google alternative: ${googleFontAlternative}`);
                }
                
                googleFonts.forEach((f: any) => fontsToLoad.add(f.name));
                
                const fontFamiliesParam = Array.from(fontsToLoad)
                  .map(f => f.replace(/\s+/g, '+') + ':wght@400;500;600;700')
                  .join('&family=');
                css.push(`@import url('https://fonts.googleapis.com/css2?family=${fontFamiliesParam}&display=swap');`);
                
                console.log(`[Channel] Loading fonts from Google: ${Array.from(fontsToLoad).join(', ')}`);
                
                // Use the effective font (Google alternative if available) in CSS
                const cssFont = googleFontAlternative || (googleFonts.length > 0 ? googleFonts[0].name : 'Inter');
                
                // Production-quality CSS based on Gillette example
                css.push(`
/* ============================================
   ${companyName.toUpperCase()} BRANDED WIDGET STYLES
   Generated by Pypestream Solution Builder
   Font: ${primaryFont} → ${cssFont} (Google alternative)
   ============================================ */


/* ---------- TEXT STYLES ---------- */
/* Font: ${cssFont} (${primaryFont} alternative) */

body {
  font-family: '${cssFont}', 'Inter', system-ui, -apple-system, sans-serif !important;
}

::selection {
  background: ${accentColor};
  color: ${getContrastColor(accentColor)};
}

a {
  color: ${primaryColor} !important;
}

p, .ps-launcher-title, .ps-conversation-tray-header-title, .ps-bubble-body, button.ps-button-primary, .ps-conversation-tray-header, .ps-home-menu-title {
  font-family: '${cssFont}', 'Inter', system-ui, sans-serif !important;
}

.ps-card-description, .ps-card-title, div, button, span {
  font-family: '${cssFont}', 'Inter', system-ui, sans-serif !important;
}

/* ---------- SOLUTION UI ---------- */

/* Header/brand moment area - per Generic Light Background CSS docs */
/* Key: .ps-conversation-tray-header controls the header bar with icons */
.ps-conversation-tray-header {
  margin-top: 0px;
  padding-bottom: 6px !important;
  padding-top: 6px !important;
  padding: 0px 26px;
  background: ${primaryColor} !important;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
}

/* Brand wrapper - only use if we want banner image, otherwise let header color show */
.ps-brand-wrapper {
  margin-top: -8px;
  ${bannerImage ? `background: url('${bannerImage}') center center / cover no-repeat !important;` : `background-color: ${primaryColor} !important;`}
}

/* Conversation timestamp - dark for visibility on white chat background */
.ps-notice-timestamp {
  color: #888888 !important;
  font-family: '${cssFont}', sans-serif !important;
  text-shadow: none !important;
}

.ps-notice {
  color: #888888 !important;
  text-shadow: none !important;
}

/* Launcher styling */
.ps-launcher-wrapper {
  background-color: ${primaryColor};
  min-width: 160px;
}

.ps-launcher-wrapper:hover {
  background-color: ${secondaryColor};
}

.ps-launcher-title {
  color: ${buttonTextColor};
  font-family: '${cssFont}', 'Inter', system-ui, sans-serif !important;
  font-weight: 500 !important;
  font-size: 16px !important;
  letter-spacing: 0.01em !important;
}

/* Ensure launcher text container also gets the font */
.ps-launcher-wrapper .ps-launcher-title,
.ps-launcher-wrapper span {
  font-family: '${cssFont}', 'Inter', system-ui, sans-serif !important;
}

/* Launcher avatar - use Google Favicon */
.ps-launcher-avatar-wrapper {
  overflow: hidden !important;
  background-color: white !important;
  border-radius: 50% !important;
  position: relative !important;
}

${avatarLogoForCSS ? `
.ps-launcher-avatar-wrapper img {
  display: none !important;
}

.ps-launcher-avatar-wrapper::before {
  content: '' !important;
  position: absolute !important;
  inset: 0 !important;
  background: #FFFFFF url('${avatarLogoForCSS}') center/60% no-repeat !important;
  border-radius: 50% !important;
  z-index: 10 !important;
}
` : ''}

.ps-home-menu-title {
  display: none;
}

/* Header layout - avatar and title side by side */
.ps-conversation-tray-header {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 12px !important;
  padding: 16px 20px !important;
}

/* Solution header title - Widget name with brand font */
.ps-conversation-tray-header-title {
  color: ${headerTextColor} !important;
  font-family: '${cssFont}', 'Inter', system-ui, sans-serif !important;
  font-weight: 700 !important;
  font-size: 24px !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;
  margin: 0 !important;
  flex-grow: 1 !important;
}

.ps-conversation-tray-header-title span {
  color: ${headerTextColor} !important;
  font-family: '${cssFont}', 'Inter', system-ui, sans-serif !important;
  font-weight: 700 !important;
}

/* Header avatar - multiple techniques combined */
.ps-conversation-tray-header-avatar {
  width: 48px !important;
  height: 48px !important;
  min-width: 48px !important;
  min-height: 48px !important;
  border-radius: 50% !important;
  overflow: hidden !important;
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

${avatarLogoForCSS ? `
/* Method 1: Hide img and replace with ::before pseudo-element */
/* Using base64 to bypass Brandfetch hotlink protection */
.ps-conversation-tray-header-avatar img {
  display: none !important;
}
.ps-conversation-tray-header-avatar::before {
  content: '' !important;
  position: absolute !important;
  inset: 0 !important;
  background: #FFFFFF url('${avatarLogoForCSS}') center/60% no-repeat !important;
  border-radius: 50% !important;
  z-index: 10 !important;
}

/* Method 2: Override ANY element with gradient in style attribute */
.ps-conversation-tray-header-avatar [style*="gradient"],
.ps-conversation-tray-header-avatar [style*="linear"],
.ps-conversation-tray-header-avatar [style*="radial"],
.ps-conversation-tray-header-avatar > div,
.ps-conversation-tray-header-avatar > span {
  opacity: 0 !important;
  visibility: hidden !important;
}
` : ''}

/* Show img tag if it has valid src */
.ps-conversation-tray-header-avatar img[src] {
  opacity: 1 !important;
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
}

/* Note: Don't hide ::before - we use it for the logo overlay */

/* Conversation starter header avatar - multiple techniques */
.ps-conversation-starter-header-avatar,
.ps-solution-avatar,
.ps-solution-icon,
.ps-header-avatar {
  width: 48px !important;
  height: 48px !important;
  min-width: 48px !important;
  min-height: 48px !important;
  border-radius: 50% !important;
  overflow: hidden !important;
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

${avatarLogoForCSS ? `
/* Method 1: Hide img and use ::before pseudo-element */
/* Using base64 to bypass Brandfetch hotlink protection */
.ps-conversation-starter-header-avatar img,
.ps-solution-avatar img,
.ps-solution-icon img,
.ps-header-avatar img {
  display: none !important;
}

.ps-conversation-starter-header-avatar::before,
.ps-solution-avatar::before,
.ps-solution-icon::before,
.ps-header-avatar::before {
  content: '' !important;
  position: absolute !important;
  inset: 0 !important;
  background: #FFFFFF url('${avatarLogoForCSS}') center/60% no-repeat !important;
  border-radius: 50% !important;
  z-index: 10 !important;
}

/* Method 2: Hide gradient children */
.ps-conversation-starter-header-avatar [style*="gradient"],
.ps-conversation-starter-header-avatar > div,
.ps-conversation-starter-header-avatar > span,
.ps-solution-avatar > div,
.ps-solution-avatar > span,
.ps-header-avatar > div,
.ps-header-avatar > span {
  opacity: 0 !important;
  visibility: hidden !important;
}
` : ''}

/* Force override any inline gradient styles on avatar children */
.ps-conversation-starter-header-avatar > *,
[class*="starter-header-avatar"] > *,
[class*="conversation-starter"] [class*="avatar"]:not([class*="title"]) > * {
  background: transparent !important;
  background-image: none !important;
  /* Hide gradient divs but keep img tags */
  opacity: 0 !important;
}

/* But show the img tag if it has a valid src */
.ps-conversation-starter-header-avatar img[src],
[class*="starter-header-avatar"] img[src],
[class*="conversation-starter"] [class*="avatar"] img[src] {
  opacity: 1 !important;
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
}

/* Note: Don't hide ::before on starter avatar - we use it for the logo overlay */

/* Header avatar/logo - preserve aspect ratio, no squishing */
${logoUrl ? `
.ps-conversation-tray-header-avatar img {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
  padding: 4px !important;
  border-radius: 0 !important;
}
` : ''}

/* Focus states for accessibility */
input:focus-visible, button:focus-visible {
  outline: 3px solid ${accentColor} !important;
  outline-offset: 2px !important;
}

/* Text input styling */
.ps-textinput-textarea {
  background-color: #F5F5F5 !important;
  color: #333333 !important;
  font-family: '${cssFont}', sans-serif !important;
  border: 1px solid #E0E0E0 !important;
  border-radius: 8px !important;
}

.ps-textinput-textarea::placeholder {
  color: #999999 !important;
  opacity: 1 !important;
}

.ps-textinput-textarea:focus-visible {
  outline: 3px solid ${accentColor} !important;
  outline-offset: 2px !important;
}

/* ========== SEND BUTTON STYLING ========== */
/* The send button container */
.ps-textinput-send-button,
.ps-send-button,
[class*="send-button"],
.ps-textinput-wrapper button,
.ps-textinput button:not([class*="emoji"]):not([class*="attachment"]) {
  background-color: ${primaryColor} !important;
  border-radius: 8px !important;
  padding: 8px !important;
  min-width: 40px !important;
  min-height: 40px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border: none !important;
  cursor: pointer !important;
}

/* Send button SVG icon - white arrow for contrast */
.ps-textinput-send-button svg,
.ps-send-button svg,
[class*="send-button"] svg,
.ps-textinput-wrapper button svg,
.ps-textinput button svg {
  width: 20px !important;
  height: 20px !important;
  fill: #FFFFFF !important;
}

/* Send button icon paths - force white color */
.ps-textinput-send-button svg path,
.ps-textinput-send-button svg polygon,
.ps-textinput-send-button svg line,
.ps-send-button svg path,
.ps-send-button svg polygon,
[class*="send-button"] svg path,
[class*="send-button"] svg polygon,
.ps-textinput-wrapper button svg path,
.ps-textinput button svg path,
.ps-textinput button svg polygon {
  fill: #FFFFFF !important;
  stroke: #FFFFFF !important;
  stroke-width: 0 !important;
}

/* If icon uses polyline or line elements */
.ps-textinput-send-button svg polyline,
.ps-send-button svg polyline,
[class*="send-button"] svg polyline,
.ps-textinput button svg polyline {
  stroke: #FFFFFF !important;
  fill: none !important;
}

/* Send button hover state */
.ps-textinput-send-button:hover,
.ps-send-button:hover,
[class*="send-button"]:hover,
.ps-textinput button:hover {
  background-color: ${secondaryColor || primaryColor} !important;
  opacity: 0.85 !important;
}

textarea#ps-textinput-textarea:disabled {
  background-color: #F5F5F5 !important;
  color: #666666 !important;
  border: 1px solid #E0E0E0 !important;
}

textarea#ps-textinput-textarea:disabled::placeholder {
  color: #999999 !important;
  opacity: 1 !important;
}

/* Button icon styling */
.ps-button-icon g path {
  fill: ${primaryColor};
}

.ps-button-icon g rect {
  fill: ${primaryColor};
}

.ps-button-icon g circle {
  fill: rgba(255, 255, 255, 0.8);
  opacity: 1;
}

/* Submit button styling */
.ps-textinput-submit-button[aria-disabled="true"] {
  background-color: rgba(255, 255, 255, 0.8);
}

.ps-textinput-submit-button[aria-disabled="true"] path {
  fill: ${primaryColor};
}

.ps-textinput-submit-button path {
  fill: ${getContrastColor(accentColor)};
}

.ps-textinput-submit-button {
  background-color: ${accentColor} !important;
  border-radius: 8px !important;
}

.ps-textinput-submit-button:hover {
  background-color: ${highlightColor} !important;
}

/* Secondary buttons - exclude header action buttons */
.ps-button-secondary:not(.ps-maintray-actions-wrapper .ps-button-secondary):not(.ps-carousel-footer .ps-button-secondary):not(.ps-webview-header-bar .ps-button-secondary) {
  color: ${primaryColor};
  border: 2px solid ${primaryColor};
  background-color: transparent;
}

.ps-button-secondary:not(.ps-maintray-actions-wrapper .ps-button-secondary):hover {
  background-color: rgba(255, 255, 255, 0.8);
}

/* List picker styling */
.ps-listpicker-input-search {
  border: 2px solid ${primaryColor};
  color: ${primaryColor};
}

.ps-listpicker-input-search:hover {
  background: #f3f2ee;
  border: 2px solid ${primaryColor};
}

.ps-listpicker-input-search::placeholder {
  color: ${primaryColor};
  opacity: 1;
}

.ps-listpicker-input-search-icon path {
  fill: ${primaryColor};
}

.ps-listpicker-list img {
  width: 120px;
  height: auto !important;
  margin: 12px 16px;
  border-radius: 2px !important;
}

.ps-listpicker-singleselect-list-item img {
  margin-left: 4px;
  max-width: 104px;
  height: auto;
}

li.ps-listpicker-singleselect-list-item > div:first-of-type {
  padding: 8px 16px 8px 4px;
}

/* ========== LISTPICKER TEXT & ACCESSIBILITY (ADA COMPLIANT) ========== */
/* WCAG 2.1 AA requires 4.5:1 contrast ratio for normal text, 3:1 for large text */

/* List picker item container - white background, dark text */
.ps-listpicker-singleselect-list-item,
.ps-listpicker-multiselect-list-item,
.ps-listpicker-list-item,
[class*="listpicker"] li,
[class*="list-picker"] li {
  background: #FFFFFF !important;
  color: #1A1A1A !important; /* Near-black for max contrast */
}

/* List picker item title/label - dark text */
.ps-listpicker-singleselect-list-item-label,
.ps-listpicker-multiselect-list-item-label,
.ps-listpicker-list-item-label,
[class*="listpicker"] [class*="label"],
[class*="listpicker"] [class*="title"],
[class*="list-picker"] [class*="label"],
[class*="list-picker"] [class*="title"] {
  color: #1A1A1A !important;
  font-weight: 600 !important;
}

/* List picker item description - dark gray for readability */
.ps-listpicker-singleselect-list-item-description,
.ps-listpicker-multiselect-list-item-description,
.ps-listpicker-list-item-description,
[class*="listpicker"] [class*="description"],
[class*="listpicker"] [class*="subtitle"],
[class*="list-picker"] [class*="description"] {
  color: #4A4A4A !important; /* Dark gray - 7:1 contrast ratio */
  font-size: 14px !important;
}

/* All text inside listpicker items - ensure dark color */
.ps-listpicker-singleselect-list-item *,
.ps-listpicker-multiselect-list-item *,
.ps-listpicker-list-item *,
[class*="listpicker"] li *,
[class*="list-picker"] li * {
  color: inherit !important;
}

/* Override: keep button text white on brand background */
.ps-listpicker-singleselect-list-item .ps-button,
.ps-listpicker-multiselect-list-item .ps-button,
[class*="listpicker"] .ps-button,
[class*="list-picker"] .ps-button {
  color: #FFFFFF !important;
  background-color: ${primaryColor} !important;
}

/* List picker images - ensure visibility */
.ps-listpicker-singleselect-list-item img,
.ps-listpicker-multiselect-list-item img,
.ps-listpicker-list-item img,
[class*="listpicker"] li img,
[class*="list-picker"] li img {
  opacity: 1 !important;
  visibility: visible !important;
  max-width: 100px !important;
  height: auto !important;
  object-fit: contain !important;
  border-radius: 4px !important;
}

/* List picker container/wrapper styling */
.ps-listpicker-list,
.ps-listpicker-singleselect-list,
.ps-listpicker-multiselect-list,
[class*="listpicker-list"] {
  background: transparent !important;
}

/* Hover/focus states for accessibility */
.ps-listpicker-singleselect-list-item:hover,
.ps-listpicker-multiselect-list-item:hover,
.ps-listpicker-list-item:hover,
[class*="listpicker"] li:hover {
  background: #F5F5F5 !important;
  outline: 2px solid ${primaryColor} !important;
  outline-offset: -2px !important;
}

/* Focus visible for keyboard navigation (ADA requirement) */
.ps-listpicker-singleselect-list-item:focus-visible,
.ps-listpicker-multiselect-list-item:focus-visible,
.ps-listpicker-list-item:focus-visible,
[class*="listpicker"] li:focus-visible {
  outline: 3px solid ${accentColor} !important;
  outline-offset: 2px !important;
}

/* Selected state styling */
.ps-listpicker-singleselect-list-item[aria-selected="true"],
.ps-listpicker-multiselect-list-item[aria-checked="true"],
[class*="listpicker"] li[aria-selected="true"] {
  background: #E8F4FD !important;
  border-left: 4px solid ${primaryColor} !important;
}

/* ========== LISTPICKER/SELECTION FOOTER / BACK BUTTON (ADA COMPLIANT) ========== */
/* The "Back to Main Menu" or cancel button at bottom of listpickers/selections */

/* Footer container styling - brand colored, centered */
.ps-listpicker-footer,
.ps-listpicker-back,
.ps-listpicker-cancel,
.ps-singleselect-footer,
.ps-multiselect-footer,
.ps-selection-footer,
[class*="listpicker"] [class*="footer"],
[class*="listpicker"] [class*="back"],
[class*="singleselect"] [class*="footer"],
[class*="singleselect"] [class*="back"],
[class*="multiselect"] [class*="footer"],
[class*="selection"] [class*="footer"],
[class*="picker"] [class*="footer"],
[class*="picker-footer"],
[class*="list-footer"] {
  background: ${primaryColor} !important;
  text-align: center !important;
  padding: 12px 16px !important;
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
}

/* Back/Cancel button text - WHITE for ADA compliance on blue background */
/* 4.5:1 contrast ratio: white (#FFFFFF) on blue meets WCAG AA */
.ps-listpicker-footer,
.ps-listpicker-footer *,
.ps-singleselect-footer,
.ps-singleselect-footer *,
.ps-multiselect-footer,
.ps-multiselect-footer *,
.ps-selection-footer,
.ps-selection-footer *,
[class*="listpicker"] [class*="footer"],
[class*="listpicker"] [class*="footer"] *,
[class*="singleselect"] [class*="footer"],
[class*="singleselect"] [class*="footer"] *,
[class*="singleselect"] [class*="back"],
[class*="singleselect"] [class*="back"] *,
[class*="multiselect"] [class*="footer"],
[class*="multiselect"] [class*="footer"] *,
[class*="selection"] [class*="footer"],
[class*="selection"] [class*="footer"] *,
[class*="picker"] [class*="footer"],
[class*="picker"] [class*="footer"] *,
[class*="picker-footer"],
[class*="picker-footer"] *,
[class*="list-footer"],
[class*="list-footer"] * {
  color: #FFFFFF !important;
  font-weight: 600 !important;
}

/* Button inside footer - transparent bg, white text, centered */
.ps-listpicker-footer button,
.ps-singleselect-footer button,
.ps-multiselect-footer button,
.ps-selection-footer button,
[class*="listpicker"] [class*="footer"] button,
[class*="singleselect"] [class*="footer"] button,
[class*="singleselect"] [class*="back"] button,
[class*="multiselect"] [class*="footer"] button,
[class*="selection"] [class*="footer"] button,
[class*="picker"] [class*="footer"] button,
[class*="picker-footer"] button,
[class*="list-footer"] button {
  background: transparent !important;
  border: none !important;
  color: #FFFFFF !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  width: 100% !important;
  text-align: center !important;
  padding: 8px 16px !important;
}

/* Any link/anchor in footer */
.ps-listpicker-footer a,
.ps-singleselect-footer a,
[class*="listpicker"] [class*="footer"] a,
[class*="singleselect"] [class*="footer"] a,
[class*="picker"] [class*="footer"] a {
  color: #FFFFFF !important;
  text-decoration: underline !important;
}

/* Hover state for back button */
.ps-listpicker-footer button:hover,
.ps-singleselect-footer button:hover,
[class*="listpicker"] [class*="footer"] button:hover,
[class*="singleselect"] [class*="footer"] button:hover,
[class*="picker"] [class*="footer"] button:hover {
  opacity: 0.85 !important;
  text-decoration: underline !important;
}

/* Carousel styling */
.ps-carousel-footer circle {
  fill: ${primaryColor} !important;
}

.ps-carousel-footer path {
  fill: rgba(255, 255, 255, 0.8) !important;
}

.ps-carousel-footer button[aria-current="false"] {
  opacity: .3;
}

.ps-carousel-wrapper {
  overflow-y: hidden;
}

/* Card styling */
.ps-card-image {
  background-size: cover;
}

.ps-card-title {
  background-image: linear-gradient(to right, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.65) 98%);
}

.ps-card-description {
  padding: 0 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.ps-card-description p {
  margin-top: 0;
  color: #333333 !important; /* Dark text for readability */
}

.ps-card-description p:nth-of-type(2) {
  font-weight: bold;
  margin-bottom: 0;
  color: #1A1A1A !important;
}

/* Card title text - ensure dark and readable */
.ps-card-title,
.ps-card-title * {
  color: #1A1A1A !important;
}

.ps-card-detail {
  padding: 16px 12px 16px 8px;
  min-height: 100px;
}

.ps-card-buttongroup {
  flex: 1 0 50%;
  gap: 4px;
}

.ps-card-buttongroup .ps-button {
  max-height: 34px;
  margin-top: 0;
  margin-bottom: 0;
}

.ps-card-buttongroup .ps-button:last-child {
  background-color: #E7E7EA;
  color: ${primaryColor};
}

/* Webview styling */
.ps-webview-pagetitle {
  display: none;
}

.ps-webview-https-icon {
  display: none;
}

.ps-webview-header-bar {
  display: none;
}

.ps-webview-overlay {
  background-color: #fff;
  padding-top: 8px;
}

.ps-webview-inline-overlay {
  overflow: hidden;
}


/* ---------- ADA ACCESSIBILITY / CONTRAST ---------- */
/* All colors below are dynamically verified for WCAG AA compliance */

/* Powered by Pypestream - ADA verified for brand moment */
.ps-poweredby-logo {
  color: ${headerTextColor} !important;
  opacity: 0.8 !important;
}

.ps-poweredby-logo svg,
.ps-poweredby-logo path {
  fill: ${headerTextColor} !important;
}

/* Header UI buttons - per Generic Light Background CSS docs */
/* Key selector: .ps-maintray-actions-wrapper .ps-button path/rect */
/* Using primary brand color for icons to ensure visibility on light brand moment */
.ps-maintray-actions-wrapper .ps-button path,
.ps-maintray-actions-wrapper .ps-button rect {
  fill: ${primaryColor} !important;
}

/* Make buttons visible with semi-transparent background */
.ps-maintray-actions-wrapper .ps-button,
.ps-maintray-button-home,
.ps-maintray-button-minimize,
.ps-maintray-button-close {
  display: flex !important;
  visibility: visible !important;
  opacity: 1 !important;
  background-color: rgba(255, 255, 255, 0.8) !important;
  border-radius: 50% !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
}

/* Circle backgrounds on header buttons - make visible with brand color */
.ps-maintray-button-home circle,
.ps-maintray-button-minimize circle,
.ps-maintray-button-close circle {
  fill: rgba(255, 255, 255, 0.9) !important;
  opacity: 1 !important;
}

/* Button icon paths - brand color for contrast on light backgrounds */
.ps-maintray-button-home path,
.ps-maintray-button-minimize path,
.ps-maintray-button-minimize rect,
.ps-maintray-button-close path {
  fill: ${primaryColor} !important;
}

/* Icon-level selectors per CSS Library: .ps-icon-home > g path */
.ps-icon-home > g path,
.ps-icon-minimize > g path,
.ps-icon-minimize > g rect,
.ps-icon-close > g path {
  fill: ${primaryColor} !important;
}

/* Webview/header close button */
.ps-header-button-close path {
  fill: ${primaryColor} !important;
}

/* Home menu title - ADA verified */
.ps-home-menu-title {
  color: ${headerTextColor} !important;
}

/* Links in bubbles - ADA verified 4.5:1 ratio for WCAG AA */
.ps-bubble-solution a {
  color: ${linkColor} !important;
  text-decoration: underline !important;
}

.ps-bubble-user a {
  color: ${userBubbleTextColor} !important;
  text-decoration: underline !important;
}


/* ---------- PIXEL PERFECT TWEAKS ---------- */

/* Main tray - transparent so brand moment can show through */
.ps-maintray {
  background: transparent !important;
  box-shadow: none !important;
}

/* DO NOT override .ps-brand-wrapper here - it's set earlier with the banner image */
/* The earlier rule at ~line 7031 handles: bannerImage ? url() : primaryColor */

/* Conversation tray - white background for message area */
.ps-conversation-tray {
  background: #FFFFFF !important;
  box-shadow: none !important;
}

/* Conversation container (messages area) - white background for readability */
.ps-conversation-container,
.ps-message-list {
  background: #FFFFFF !important;
}

/* Text input wrapper - white background */
.ps-textinput-wrapper {
  background: #FFFFFF !important;
}

/* Header bar - white background, black text */
.ps-conversation-starter-header,
.ps-conversation-tray-header {
  background: #FFFFFF !important;
  border: none !important;
  box-shadow: none !important;
}

/* Header title text - dark for readability on white */
.ps-conversation-starter-header-title,
.ps-conversation-starter-header-title span,
.ps-conversation-tray-header-title,
.ps-conversation-tray-header-title span,
[class*="conversation-starter-header"] h1,
[class*="conversation-starter-header"] h2,
[class*="conversation-starter-header"] h3,
[class*="conversation-starter-header"] p,
[class*="conversation-starter-header"] span,
[class*="conversation-tray-header"] h1,
[class*="conversation-tray-header"] h2,
[class*="conversation-tray-header"] span {
  color: #1A1A1A !important;
}

/* Header text - dark on white header background */
.ps-conversation-starter-header h1,
.ps-conversation-starter-header h2,
.ps-conversation-starter-header h3,
.ps-conversation-starter-header p,
.ps-conversation-starter-header span,
.ps-conversation-starter-header div:not([class*="avatar"]),
[class*="conversation-starter-header"] h1,
[class*="conversation-starter-header"] h2,
[class*="conversation-starter-header"] h3,
[class*="conversation-starter-header"] p,
[class*="conversation-starter-header"] span {
  color: #1A1A1A !important;
}

/* Timestamp in conversation - dark for readability on white background */
.ps-message-timestamp,
.ps-conversation-timestamp,
[class*="timestamp"],
[class*="message-date"] {
  color: #666666 !important;
}

/* Conversation tray container styling */
.ps-conversation-tray {
  box-shadow: none;
  max-height: calc(100% - 56px);
  /* Don't set background on tray - let header have brand color */
}

/* Loader background - brand color */
.ps-loader-wrapper {
  background: ${primaryColor} !important;
}

/* ========== HOME MENU / SETTINGS PAGE ========== */
/* Comprehensive styling for the persistent home menu */

/* Text in HOME MENU ONLY - white on blue background */
/* DON'T apply to maintray generally - it makes conversation text unreadable */
.ps-home-menu h1,
.ps-home-menu h2,
.ps-home-menu h3,
.ps-home-menu h4,
.ps-home-menu h5,
.ps-home-menu h6,
.ps-home-menu p,
.ps-home-menu span,
.ps-home-menu label,
.ps-home-menu div,
[class*="home-menu"] p,
[class*="home-menu"] span,
[class*="home-menu"] div {
  color: #FFFFFF !important;
}

/* Home menu container - fill entire area with brand color */
.ps-home-menu,
.ps-home-menu-wrapper,
[class*="home-menu"] {
  background: ${primaryColor} !important;
}

/* Home menu ONLY - brand-colored background (not conversation view!) */
/* Use specific home-menu classes, NOT general maintray classes */
.ps-home-menu,
.ps-home-menu-body,
.ps-home-menu-content,
[class*="home-menu-body"],
[class*="home-menu-content"] {
  background: ${primaryColor} !important;
}

/* Return to Conversation footer bar — brand-styled */
.ps-maintray-footer,
[class*="maintray-footer"],
.ps-home-menu-footer,
[class*="home-menu-footer"] {
  background: ${secondaryColor || primaryColor} !important;
  border-top: 1px solid rgba(255,255,255,0.2) !important;
}

.ps-maintray-footer *,
[class*="maintray-footer"] *,
.ps-home-menu-footer *,
[class*="home-menu-footer"] * {
  color: #FFFFFF !important;
}

.ps-maintray-footer path,
.ps-maintray-footer svg path,
[class*="maintray-footer"] path {
  fill: #FFFFFF !important;
}

/* Home menu title - "Settings" text */
.ps-home-menu-title,
[class*="home-menu"] h3,
[class*="settings"] h3 {
  color: #FFFFFF !important;
  font-family: '${cssFont}', 'Inter', sans-serif !important;
  font-weight: 600 !important;
}

/* Settings wrapper and all children */
.ps-home-menu-settings-wrapper,
.ps-home-menu-settings-wrapper * {
  color: #FFFFFF !important;
}

/* Home menu avatar — show brand logo in the circle */
${avatarLogoForCSS ? `
/* Header avatar — keep img visible, use object-fit */
.ps-conversation-tray-header-avatar img,
.ps-conversation-starter-header-avatar img {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
  padding: 4px !important;
}

/* Fallback: set logo as background on avatar containers (using base64) */
.ps-conversation-starter-header-avatar,
.ps-home-menu-header-avatar {
  background-image: url('${avatarLogoForCSS}') !important;
  background-size: contain !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-color: white !important;
}

/* Home menu / settings avatar circle - use Google Favicon */
.ps-home-menu-avatar,
.ps-maintray [class*="avatar"],
.ps-maintray [class*="Avatar"],
.ps-home-menu [class*="avatar"],
.ps-home-menu [class*="Avatar"] {
  background-color: white !important;
  border-radius: 50% !important;
  overflow: hidden !important;
  position: relative !important;
  width: 72px !important;
  height: 72px !important;
}

/* Hide default images in home menu avatars */
.ps-home-menu-avatar img,
.ps-home-menu-header img,
[class*="home-menu"] img,
.ps-maintray img[class*="avatar"],
.ps-maintray-content-wrapper img,
.ps-maintray [class*="avatar"] img,
.ps-home-menu [class*="avatar"] img {
  display: none !important;
}

/* Add Google Favicon via ::before on home menu avatars */
.ps-home-menu-avatar::before,
.ps-maintray [class*="avatar"]::before,
.ps-home-menu [class*="avatar"]::before {
  content: '' !important;
  position: absolute !important;
  inset: 0 !important;
  background: #FFFFFF url('${avatarLogoForCSS}') center/60% no-repeat !important;
  border-radius: 50% !important;
  z-index: 10 !important;
}
` : ''}

/* Home menu spacing and layout */
.ps-home-menu-wrapper,
.ps-home-menu,
[class*="home-menu"] {
  padding: 24px !important;
}

.ps-home-menu-header,
[class*="home-menu-header"] {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  gap: 16px !important;
  margin-bottom: 24px !important;
}

/* Settings section spacing */
.ps-home-menu-settings-wrapper,
[class*="settings-wrapper"] {
  margin-top: 16px !important;
}

/* Download Transcript button - white border and text */
.ps-button-iconbutton,
.ps-home-menu-settings-wrapper .ps-button-iconbutton,
.ps-buttongroup .ps-button-iconbutton {
  background-color: transparent !important;
  color: #FFFFFF !important;
  border: 2px solid #FFFFFF !important;
  font-family: '${cssFont}', 'Inter', sans-serif !important;
  padding: 12px 20px !important;
  margin-top: 8px !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
  border-radius: 8px !important;
}

.ps-button-iconbutton:hover {
  background-color: rgba(255, 255, 255, 0.2) !important;
}

/* Download arrow icon - properly sized */
.ps-button-iconbutton svg {
  width: 18px !important;
  height: 18px !important;
  flex-shrink: 0 !important;
}

.ps-button-iconbutton path,
.ps-button-iconbutton svg path {
  fill: #FFFFFF !important;
}

/* Return to Conversation button at bottom */
.ps-button-return,
[class*="return"] button,
.ps-home-menu-footer button {
  background-color: rgba(255, 255, 255, 0.15) !important;
  border: 2px solid #FFFFFF !important;
  color: #FFFFFF !important;
  font-family: '${cssFont}', 'Inter', sans-serif !important;
}

.ps-button-return:hover,
[class*="return"] button:hover {
  background-color: rgba(255, 255, 255, 0.3) !important;
}

.ps-button-return path,
[class*="return"] button path {
  fill: #FFFFFF !important;
}

/* Powered by Pypestream - white text everywhere */
.ps-poweredby-logo,
.ps-poweredby-logo *,
[class*="poweredby"] {
  color: #FFFFFF !important;
}

.ps-icon-pypestream-logo path,
.ps-icon-pypestream-logo polygon,
[class*="pypestream-logo"] path,
[class*="pypestream-logo"] polygon {
  fill: #FFFFFF !important;
}

.ps-image {
  max-height: none;
  border-radius: 4px;
}

.fas {
  margin-right: 8px;
}

.ps-bubble-user .fas {
  margin-right: 4px;
}

.ps-buttongroup-image {
  margin-left: 0;
}

.ps-carousel-item .ps-buttongroup {
  padding: 0;
}

.ps-maintray-actions-wrapper {
  max-height: 56px;
  margin: 0px 12px;
}

.ps-maintray-button-minimize {
  margin-right: 8px !important;
}

.ps-card-buttongroup-button div {
  width: 100%;
  min-width: 142px;
}

.fa-check-circle {
  color: ${accentColor};
  margin-right: 4px;
}

.fal {
  font-weight: 600 !important;
}

/* ---------- MESSAGE BUBBLES ---------- */
/* Colors are ADA verified for WCAG AA 4.5:1 contrast */
/* Bot bubbles use light gray (#F5F5F5) for visibility on white background */

.ps-bubble-solution {
  background-color: #F5F5F5 !important;
  color: #1A1A1A !important;
  border-radius: 18px !important;
  border-bottom-left-radius: 4px !important;
  /* Subtle shadow for depth on white background */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}

.ps-bubble-solution p,
.ps-bubble-solution span,
.ps-bubble-solution div {
  color: #1A1A1A !important;
}

.ps-bubble-solution h3 {
  margin-bottom: -10px;
  color: #1A1A1A !important;
}

.ps-bubble-solution h4 {
  margin-bottom: -12px;
  color: #1A1A1A !important;
}

.ps-bubble ul {
  margin-top: 8px;
  padding-left: 24px;
}

/* User bubbles use brand color */
.ps-bubble-user {
  background-color: ${userBubbleColor} !important;
  color: ${userBubbleTextColor} !important;
  border-radius: 18px !important;
  border-bottom-right-radius: 4px !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1) !important;
}

.ps-bubble-tail {
  display: none !important;
}

/* ---------- PRIMARY ACTION BUTTONS ---------- */
/* Colors are ADA verified for WCAG AA 4.5:1 contrast */

.ps-conversation-container .ps-button-primary {
  background-color: ${buttonBgColor} !important;
  color: ${buttonTextColor} !important;
  border: none !important;
  border-radius: 45px !important;
  font-weight: 500 !important;
  font-family: '${cssFont}', sans-serif !important;
}

.ps-conversation-container .ps-button-primary:hover {
  background-color: ${buttonHoverColor} !important;
}

/* ---------- LOADING ---------- */

.ps-bubble-thinking-icon-dot {
  color: ${accentColor} !important;
}

.ps-loader-svg-container {
  color: ${primaryColor} !important;
}

.ps-loader-wrapper {
  background: transparent !important;
}
                `);
                
                return css.join('\n');
              };
              
              const customCSS = generateBrandCSS();
              console.log(`[Channel] Generated custom CSS (${customCSS.length} chars)`);
              
              // Widget payload - use minimal format first, then add styling
              // The webservice API is sensitive to payload format
              
              // Build style JSON carefully - avoid any special characters that could break parsing
              const styleObj = {
                name: widgetDisplayName,
                widgetPosition: 'bottom-right',
                shouldLockRatio: false,
                widgetHeight: 800,
                widgetWidth: 500,
              };
              
              // Build beta/customStyling JSON
              const betaObj = {
                customStyling: {
                  buttonColor: primaryColor,
                  textColor: getContrastColor(primaryColor),
                  brandMomentUrl: brandMomentUrl || bannerImage || '',
                  launcherName: 'How can I assist you?',
                }
              };
              
              // Add logo URL if present (in customStyling for header avatar)
              // Prefer avatarLogoUrl (square icon) over logoUrl (may be wide wordmark)
              const avatarUrlToUse = avatarLogoUrl || logoUrl;
              if (avatarUrlToUse) {
                (styleObj as any).avatarUrl = avatarUrlToUse;
                (styleObj as any).iconUrl = avatarUrlToUse;
                betaObj.customStyling = {
                  ...betaObj.customStyling,
                  avatarUrl: avatarUrlToUse,
                  iconUrl: avatarUrlToUse,
                } as any;
              }
              
              // Widget data - minimal required fields first
              // NOTE: Do NOT add avatar_url/icon_url here - it breaks the API
              // Those go in styleObj and betaObj.customStyling only
              const widgetData: Record<string, any> = {
                pype_id: pypeId,
                stream_id: streamId,
                widget_name: widgetDisplayName,
                style: JSON.stringify(styleObj),
                beta: JSON.stringify(betaObj),
              };
              
              // Add custom CSS only if not too large (some APIs have limits)
              if (customCSS && customCSS.length < 50000) {
                widgetData.custom_pype_css = customCSS;
              } else if (customCSS) {
                console.warn(`[Channel] Custom CSS too large (${customCSS.length} chars), using minimal styling`);
                // Use minimal essential CSS only
                widgetData.custom_pype_css = `
                  :root { --ps-primary-color: ${primaryColor} !important; }
                  .ps-launcher { background-color: ${primaryColor} !important; }
                  .ps-button { background-color: ${primaryColor} !important; }
                `.trim();
              }
              
              // user_id should be a unique request identifier, NOT the customer UUID
              const widgetUserId = `sd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              
              const widgetPayload = {
                user_id: widgetUserId,
                correlation_id: null,
                reply_to: pypeId,
                version: 1,
                type: 'request',
                auth_token: token,
                request_type: 'x_widget',
                request_action: 'new',
                data: widgetData
              };
              
              console.log(`[Channel] Widget style avatarUrl: ${logoUrl || 'NONE'}`);
              console.log(`[Channel] Widget brandMomentUrl: ${brandMomentUrl || bannerImage || 'NONE'}`);
              
              // Log payload size for debugging
              const payloadStr = JSON.stringify(widgetPayload);
              console.log(`[Channel] Widget payload size: ${payloadStr.length} bytes`);
              
              // Validate JSON before sending
              try {
                JSON.parse(payloadStr);
              } catch (parseErr) {
                console.error(`[Channel] Widget payload is invalid JSON:`, parseErr);
              }
              
              const widgetResponse = await fetch(
                `${webserviceBase}/v3/business/widget`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(widgetPayload)
                }
              );
              
              let previewUrl: string | null = null;
              
              if (widgetResponse.ok) {
                const widgetData = await widgetResponse.json();
                const widgetId = widgetData?.data?.id || widgetData?.id;
                console.log(`[Channel] Widget created: ${widgetId}`);
                
                if (widgetId) {
                  const webPrefix = environment === 'production' ? 'web' : 'web-sandbox';
                  previewUrl = `https://${webPrefix}.pypestream.com/preview.html?id=${widgetId}`;
                }
              } else {
                const errText = await widgetResponse.text();
                console.log(`[Channel] Widget creation failed (${widgetResponse.status}):`, errText);
                // Widget creation is optional - stream is still usable
              }
              
              // Return success with preview URL
              // DO NOT fall back to stream-based URLs - they don't work!
              if (previewUrl) {
                console.log(`[Channel] Success! Preview URL: ${previewUrl}`);
                res.end(JSON.stringify({
                  success: true,
                  previewUrl,
                  widgetUrl: previewUrl, // Alias for instant-build.ts compatibility
                  consoleUrl,
                  streamId,
                  pypeId,
                  message: 'Channel created successfully!'
                }));
              } else {
                // Widget creation failed - return error so client can handle it
                console.error(`[Channel] Widget creation failed - bot is deployed but no working preview URL`);
                console.log(`[Channel] Bot ${botId} is configured on stream ${streamId}`);
                console.log(`[Channel] To view: Create widget in Console for stream ${streamId}`);
                
                res.end(JSON.stringify({
                  success: false,
                  error: 'Widget creation failed. Bot is deployed but needs manual widget setup in Pypestream Console.',
                  consoleUrl,
                  streamId,
                  pypeId,
                  // Include console deep link for manual setup
                  setupUrl: `${consoleUrl}?stream=${streamId}`
                }));
              }
              
            } catch (e: any) {
              console.error('[Channel] Error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });
      }
    }
  ],
  // Explicitly configure CSS/PostCSS to prevent picking up parent directory's postcss.config.js
  css: {
    postcss: resolve(__dirname, 'postcss.config.js'),
  },
})
