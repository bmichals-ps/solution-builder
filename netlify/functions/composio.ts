import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

// Map our integration IDs to Composio toolkit slugs
const TOOLKIT_SLUGS: Record<string, string> = {
  'google-sheets': 'googlesheets',
  'figma': 'figma',
  'github': 'github',
  'google-drive': 'googledrive',
};

// Cache for auth config IDs
const authConfigCache: Record<string, string> = {};

// Parse CSV content into rows, handling quoted fields with commas
function parseCSVToRows(csvContent: string): string[][] {
  const rows: string[][] = [];
  const lines = csvContent.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const cells: string[] = [];
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
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  
  return rows;
}

// Get or create an auth config for a toolkit
async function getOrCreateAuthConfig(toolkitSlug: string, apiKey: string): Promise<string> {
  if (authConfigCache[toolkitSlug]) {
    return authConfigCache[toolkitSlug];
  }
  
  console.log(`[Composio] Looking for existing auth config for ${toolkitSlug}...`);
  
  const listResponse = await fetch(
    `https://backend.composio.dev/api/v3/auth_configs?toolkit_slugs=${toolkitSlug}`,
    { headers: { 'x-api-key': apiKey } }
  );
  
  if (listResponse.ok) {
    const listData = await listResponse.json();
    const configs = listData.items || listData.data || listData;
    
    if (Array.isArray(configs) && configs.length > 0) {
      const matchingConfig = configs.find((c: any) => 
        c.toolkit?.slug === toolkitSlug || 
        c.toolkit?.slug?.toLowerCase() === toolkitSlug.toLowerCase()
      );
      
      if (matchingConfig) {
        const configId = matchingConfig.id || matchingConfig.auth_config_id || matchingConfig.auth_config?.id;
        console.log(`[Composio] Found matching auth config: ${configId}`);
        authConfigCache[toolkitSlug] = configId;
        return configId;
      }
    }
  }
  
  // Create new auth config
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
      })
    }
  );
  
  if (!createResponse.ok) {
    throw new Error(`Failed to create auth config: ${createResponse.status}`);
  }
  
  const createData = await createResponse.json();
  const configId = createData.id || createData.auth_config_id;
  authConfigCache[toolkitSlug] = configId;
  return configId;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const apiKey = process.env.VITE_COMPOSIO_API_KEY;
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'VITE_COMPOSIO_API_KEY not configured' }),
    };
  }
  
  const path = event.path.replace('/.netlify/functions/composio', '').replace('/api/composio', '');
  
  try {
    // POST /connect - Initiate OAuth connection
    if (event.httpMethod === 'POST' && path === '/connect') {
      const { integrationId, userId, redirectUrl } = JSON.parse(event.body || '{}');
      const toolkitSlug = TOOLKIT_SLUGS[integrationId] || integrationId;
      
      console.log(`[Composio] Connecting ${integrationId} (toolkit: ${toolkitSlug})`);
      
      const authConfigId = await getOrCreateAuthConfig(toolkitSlug, apiKey);
      
      // Create connection link via API
      const linkResponse = await fetch(
        'https://backend.composio.dev/api/v1/connectedAccounts/link',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            user_uuid: userId || `user_${Date.now()}`,
            auth_config_id: authConfigId,
            callback_url: redirectUrl,
          }),
        }
      );
      
      if (!linkResponse.ok) {
        throw new Error(`Failed to create connection link: ${linkResponse.status}`);
      }
      
      const linkData = await linkResponse.json();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          redirectUrl: linkData.redirectUrl || linkData.redirect_url,
          connectionId: linkData.id || linkData.connection_id,
        }),
      };
    }
    
    // GET /status/:id - Check connection status
    if (event.httpMethod === 'GET' && path.startsWith('/status/')) {
      const connectionId = path.replace('/status/', '');
      
      const response = await fetch(
        `https://backend.composio.dev/api/v1/connectedAccounts/${connectionId}`,
        { headers: { 'x-api-key': apiKey } }
      );
      
      if (!response.ok) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Connection not found' }),
        };
      }
      
      const account = await response.json();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: account.status,
          connectionId: account.id,
        }),
      };
    }
    
    // POST /export-sheet - Export CSV to Google Sheets
    if (event.httpMethod === 'POST' && path === '/export-sheet') {
      const { csvContent, fileName, userId } = JSON.parse(event.body || '{}');
      
      console.log(`[Composio] Exporting to Google Sheets: ${fileName}`);
      
      // Get connected accounts
      const accountsResponse = await fetch(
        `https://backend.composio.dev/api/v1/connectedAccounts?user_uuid=${encodeURIComponent(userId)}&showActiveOnly=true`,
        { headers: { 'x-api-key': apiKey } }
      );
      
      if (!accountsResponse.ok) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Failed to fetch connected accounts' }),
        };
      }
      
      const accountsData = await accountsResponse.json();
      const accounts = accountsData.items || accountsData;
      
      const sheetsAccount = accounts.find((acc: any) => 
        acc.appName?.toLowerCase() === 'googlesheets' ||
        acc.appUniqueId?.toLowerCase().includes('googlesheets')
      );
      
      if (!sheetsAccount) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No Google Sheets account connected' }),
        };
      }
      
      console.log(`[Composio] Found Sheets account: ${sheetsAccount.id}`);
      
      const normalizedCSV = csvContent.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = parseCSVToRows(normalizedCSV);
      
      console.log(`[Composio] Parsed ${lines.length} CSV rows`);
      
      // Create a new spreadsheet
      const createResponse = await fetch(
        'https://backend.composio.dev/api/v2/actions/GOOGLESHEETS_CREATE_GOOGLE_SHEET1/execute',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            connectedAccountId: sheetsAccount.id,
            input: {
              title: fileName || 'Pypestream Bot Export',
            },
          }),
        }
      );
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.log('[Composio] Create sheet failed:', createResponse.status, errorText);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to create spreadsheet' }),
        };
      }
      
      const createResult = await createResponse.json();
      console.log('[Composio] Create result:', JSON.stringify(createResult, null, 2));
      
      // Extract spreadsheet ID - try multiple response formats
      let spreadsheetId: string | null = null;
      let spreadsheetUrl: string | null = null;
      
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
      
      // Try properties object
      if (!spreadsheetId) {
        const props = createResult.data?.response_data?.properties || 
                     createResult.response_data?.properties ||
                     createResult.properties;
        if (props) {
          spreadsheetId = props.spreadsheetId;
        }
      }
      
      if (spreadsheetId && !spreadsheetUrl) {
        spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      }
      
      if (!spreadsheetId) {
        console.log('[Composio] Could not find spreadsheet ID in response:', JSON.stringify(createResult, null, 2));
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to get spreadsheet ID', response: createResult }),
        };
      }
      
      console.log(`[Composio] Created spreadsheet: ${spreadsheetId}`);
      
      console.log(`[Composio] Writing ${lines.length} rows to spreadsheet`);
      
      // Ensure all rows have 26 columns (pad with empty strings)
      const paddedLines = lines.map(row => {
        const padded = [...row];
        while (padded.length < 26) {
          padded.push('');
        }
        return padded.slice(0, 26);
      });
      
      const batchResponse = await fetch(
        'https://backend.composio.dev/api/v2/actions/GOOGLESHEETS_BATCH_UPDATE/execute',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            connectedAccountId: sheetsAccount.id,
            input: {
              spreadsheet_id: spreadsheetId,
              sheet_name: 'Sheet1',
              first_cell_location: 'A1',
              values: paddedLines,
              valueInputOption: 'RAW',
            },
          }),
        }
      );
      
      const batchResult = await batchResponse.json().catch(() => ({}));
      console.log('[Composio] Batch update response:', JSON.stringify(batchResult).substring(0, 500));
      
      if (!batchResponse.ok) {
        console.log('[Composio] Batch update HTTP failed:', batchResponse.status);
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          spreadsheetId,
          spreadsheetUrl,
          rowsWritten: lines.length,
        }),
      };
    }
    
    // POST /update-sheet - Update existing Google Sheet with new CSV content
    if (event.httpMethod === 'POST' && path === '/update-sheet') {
      const { spreadsheetId, csvContent, userId } = JSON.parse(event.body || '{}');
      
      if (!spreadsheetId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'spreadsheetId is required' }),
        };
      }
      
      if (!csvContent) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'csvContent is required' }),
        };
      }
      
      console.log(`[Composio] Updating spreadsheet: ${spreadsheetId}`);
      
      // Get connected accounts
      const accountsResponse = await fetch(
        `https://backend.composio.dev/api/v1/connectedAccounts?user_uuid=${encodeURIComponent(userId || 'default')}&showActiveOnly=true`,
        { headers: { 'x-api-key': apiKey } }
      );
      
      if (!accountsResponse.ok) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Failed to fetch connected accounts' }),
        };
      }
      
      const accountsData = await accountsResponse.json();
      const accounts = accountsData.items || accountsData;
      
      const sheetsAccount = accounts.find((acc: any) => 
        acc.appName?.toLowerCase() === 'googlesheets' ||
        acc.appUniqueId?.toLowerCase().includes('googlesheets')
      );
      
      if (!sheetsAccount) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No Google Sheets account connected' }),
        };
      }
      
      const normalizedCSV = csvContent.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = parseCSVToRows(normalizedCSV);
      
      // Ensure all rows have 26 columns
      const paddedLines = lines.map(row => {
        const padded = [...row];
        while (padded.length < 26) {
          padded.push('');
        }
        return padded.slice(0, 26);
      });
      
      console.log(`[Composio] Updating with ${paddedLines.length} rows`);
      
      const updateResponse = await fetch(
        'https://backend.composio.dev/api/v2/actions/GOOGLESHEETS_BATCH_UPDATE/execute',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            connectedAccountId: sheetsAccount.id,
            input: {
              spreadsheet_id: spreadsheetId,
              sheet_name: 'Sheet1',
              first_cell_location: 'A1',
              values: paddedLines,
              valueInputOption: 'RAW',
            },
          }),
        }
      );
      
      const updateResult = await updateResponse.json().catch(() => ({}));
      console.log('[Composio] Update response:', JSON.stringify(updateResult).substring(0, 500));
      
      if (!updateResponse.ok) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to update spreadsheet', details: updateResult }),
        };
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };
    }
    
    // Unknown route
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' }),
    };
    
  } catch (error: any) {
    console.error('[Composio] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || String(error) }),
    };
  }
};

export { handler };
