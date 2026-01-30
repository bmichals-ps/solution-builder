/**
 * Composio Integration Service
 * Handles OAuth authentication flows for third-party integrations
 * 
 * This service communicates with a backend API (/api/composio/*) which handles
 * the actual Composio SDK calls securely with the API key.
 * 
 * Setup: Just set VITE_COMPOSIO_API_KEY in .env - auth configs are created automatically!
 */

// Backend API base URL - in development, this is proxied through Vite
const API_BASE = '/api/composio';

// Supported integrations
const SUPPORTED_INTEGRATIONS = ['google-sheets', 'figma', 'github', 'google-drive'];

/**
 * Initialize OAuth flow via backend API
 * Opens a popup window for the user to authenticate
 */
export async function initiateComposioAuth(
  integrationId: string,
  userId?: string
): Promise<{ success: boolean; connectionId?: string; error?: string }> {
  if (!SUPPORTED_INTEGRATIONS.includes(integrationId)) {
    return { success: false, error: `Unknown integration: ${integrationId}` };
  }

  try {
    // Call backend to initiate OAuth connection
    // The backend will automatically create/get the auth config
    const response = await fetch(`${API_BASE}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        integrationId,
        userId: userId || `user_${Date.now()}`,
        redirectUrl: `${window.location.origin}/auth/callback`,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Failed to initiate auth: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Open OAuth popup with the redirect URL from Composio
    const popup = openAuthPopup(data.redirectUrl);
    
    if (!popup) {
      return { success: false, error: 'Popup was blocked. Please allow popups for this site.' };
    }

    // Wait for OAuth to complete
    const result = await waitForAuthCompletion(popup, data.connectionId);
    
    return result;
  } catch (error) {
    console.error('Auth error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Authentication failed' 
    };
  }
}

/**
 * Open OAuth popup window
 */
function openAuthPopup(url: string): Window | null {
  const width = 600;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  
  return window.open(
    url,
    'composio-auth',
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
  );
}

/**
 * Wait for OAuth popup to complete
 * Polls the popup to detect when it closes or redirects back to our callback
 */
function waitForAuthCompletion(
  popup: Window,
  connectionId: string
): Promise<{ success: boolean; connectionId?: string; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    let wasOnOurDomain = false;
    
    const checkInterval = setInterval(() => {
      if (resolved) return;
      
      try {
        // Try to read the popup URL (will throw if cross-origin)
        try {
          const popupUrl = popup.location.href;
          
          // Check if redirected back to our domain (callback page)
          if (popupUrl && popupUrl.includes(window.location.origin)) {
            wasOnOurDomain = true;
            clearInterval(checkInterval);
            
            // Parse URL for success/error params
            const url = new URL(popupUrl);
            const error = url.searchParams.get('error');
            
            popup.close();
            resolved = true;
            
            if (error) {
              resolve({ success: false, error: decodeURIComponent(error) });
            } else {
              // Successfully completed OAuth flow
              resolve({ success: true, connectionId });
            }
            return;
          }
        } catch (e) {
          // Cross-origin - popup is on external auth page (Google, Figma, Composio)
          // This is expected, continue polling
        }
        
        // Check if popup was closed by user
        if (popup.closed) {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            
            if (wasOnOurDomain) {
              // Popup was on our callback, OAuth completed
              resolve({ success: true, connectionId });
            } else {
              // User closed popup before completing OAuth
              resolve({ success: false, error: 'Authentication was cancelled' });
            }
          }
          return;
        }
      } catch (e) {
        // Popup might have been closed or blocked
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
      if (!resolved) {
        resolved = true;
        try {
          if (!popup.closed) {
            popup.close();
          }
        } catch (e) {}
        resolve({ success: false, error: 'Authentication timed out' });
      }
    }, 5 * 60 * 1000);
  });
}

interface ComposioConnectionStatus {
  connected: boolean;
  connectionId?: string;
}

/**
 * Check if a connection is still valid
 * Note: This calls through our backend API to avoid exposing the API key
 */
export async function checkConnectionStatus(
  connectionId: string
): Promise<ComposioConnectionStatus> {
  try {
    const response = await fetch(`${API_BASE}/status/${connectionId}`);

    if (!response.ok) {
      return { connected: false };
    }

    const data = await response.json();
    return { 
      connected: data.status === 'ACTIVE',
      connectionId: data.connectionId,
    };
  } catch (error) {
    console.error('Failed to check connection status:', error);
    return { connected: false };
  }
}

/**
 * Disconnect an integration
 * Note: For now, just returns true - user should disconnect via Composio dashboard
 */
export async function disconnectIntegration(
  connectionId: string
): Promise<boolean> {
  // TODO: Implement disconnect via backend API
  console.log('Disconnect requested for:', connectionId);
  return true;
}

interface ExportToSheetsResult {
  success: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  error?: string;
}

/**
 * Export CSV content to a new Google Sheet
 */
export async function exportToGoogleSheets(
  csvContent: string,
  fileName: string,
  userId: string
): Promise<ExportToSheetsResult> {
  try {
    const response = await fetch(`${API_BASE}/export-sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvContent,
        fileName,
        userId,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Export failed: ${response.status}`);
    }
    
    const data = await response.json();
    return {
      success: true,
      spreadsheetId: data.spreadsheetId,
      spreadsheetUrl: data.spreadsheetUrl,
    };
  } catch (error) {
    console.error('Export to Sheets error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    };
  }
}
