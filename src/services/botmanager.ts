/**
 * Pypestream Bot Manager API Service
 * 
 * Provides official validation, upload, and deployment via Bot Manager API
 */

export interface BotManagerValidationResult {
  valid: boolean;
  versionId?: string;
  version?: string;
  errors?: any[];
  message?: string;
  details?: any;
}

export interface BotManagerUploadResult {
  success: boolean;
  versionId?: string;
  errors?: any[];
  message?: string;
  details?: any;
  deployed?: boolean;
  previewUrl?: string;
  authError?: boolean;
  widgetId?: string;
  channelNote?: string;
  deployResult?: {
    success: boolean;
    error?: any;
  };
}

export interface BotManagerDeployResult {
  success: boolean;
  versionId?: string;
  environment?: string;
  previewUrl?: string;
  message?: string;
  error?: string;
  details?: any;
}

export interface BotInfo {
  id: string;
  customerName: string;
  botName: string;
  versions: string[];
  botLanguage?: string;
  botType?: string;
}

/**
 * Validate CSV using official Bot Manager API
 * This creates a temporary version and compiles the CSV to check for errors
 */
export async function validateWithBotManager(
  csv: string,
  botId: string,
  token: string
): Promise<BotManagerValidationResult> {
  const response = await fetch('/api/botmanager/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv, botId, token }),
  });

  const result = await response.json();
  
  if (!response.ok && !result.valid && !result.errors) {
    throw new Error(result.error || `Validation request failed: ${response.status}`);
  }

  return result;
}

/**
 * Upload CSV to Bot Manager API
 * Creates a new version and compiles the template
 * If environment is provided, also deploys in one step
 */
export async function uploadToBotManager(
  csv: string,
  botId: string,
  token: string,
  options?: {
    versionId?: string;
    scripts?: { name: string; content: string }[];
    environment?: 'sandbox' | 'production';
  }
): Promise<BotManagerUploadResult> {
  const response = await fetch('/api/botmanager/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      csv, 
      botId, 
      token,
      versionId: options?.versionId,
      scripts: options?.scripts,
      environment: options?.environment
    }),
  });

  const result = await response.json();
  
  // Don't throw for auth errors - return them so UI can show API key input
  if (result.authError) {
    return {
      success: false,
      authError: true,
      errors: [result.errors || result.error || 'API token is invalid or expired'],
      message: result.error || 'API token is invalid or expired. Please check your Pypestream API key.'
    };
  }
  
  if (!response.ok && !result.success) {
    throw new Error(result.error || `Upload failed: ${response.status}`);
  }

  return result;
}

/**
 * One-click deploy: Upload CSV and deploy in a single operation
 * Auto-creates the bot if it doesn't exist
 */
export async function oneClickDeploy(
  csv: string,
  botId: string,
  environment: 'sandbox' | 'production',
  token: string,
  scripts?: { name: string; content: string }[]
): Promise<BotManagerUploadResult> {
  return uploadToBotManager(csv, botId, token, {
    scripts,
    environment
  });
}

/**
 * Check if a bot exists
 */
export async function checkBotExists(
  botId: string,
  token: string
): Promise<boolean> {
  const botInfo = await getBotInfo(botId, token);
  return botInfo !== null;
}

/**
 * Create a new bot
 */
export async function createBot(
  customerName: string,
  botName: string,
  token: string,
  options?: {
    botLanguage?: 'english' | 'spanish';
    botType?: 'main' | 'survey';
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/botmanager/create-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        botName,
        botLanguage: options?.botLanguage || 'english',
        botType: options?.botType || 'main',
        token
      }),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to create bot' };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Validate Bot ID format
 */
export function validateBotId(botId: string): { valid: boolean; error?: string } {
  if (!botId) {
    return { valid: false, error: 'Bot ID is required' };
  }
  
  const parts = botId.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Bot ID must be in format: CustomerName.BotName' };
  }
  
  const [customerName, botName] = parts;
  
  if (!customerName || customerName.length < 1) {
    return { valid: false, error: 'Customer name is required' };
  }
  
  if (!botName || botName.length < 1) {
    return { valid: false, error: 'Bot name is required' };
  }
  
  // Bot name must start with uppercase letter
  if (!/^[A-Z]/.test(botName)) {
    return { valid: false, error: 'Bot name must start with an uppercase letter' };
  }
  
  // Only alphanumeric characters allowed
  if (!/^[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/.test(botId)) {
    return { valid: false, error: 'Bot ID can only contain letters and numbers' };
  }
  
  return { valid: true };
}

/**
 * Deploy a version to an environment
 */
export async function deployVersion(
  versionId: string,
  environment: 'sandbox' | 'production',
  token: string
): Promise<BotManagerDeployResult> {
  const response = await fetch('/api/botmanager/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId, environment, token }),
  });

  const result = await response.json();
  
  if (!response.ok && !result.success) {
    throw new Error(result.error || `Deployment failed: ${response.status}`);
  }

  return result;
}

/**
 * Get bot information
 */
export async function getBotInfo(
  botId: string,
  token: string
): Promise<BotInfo | null> {
  try {
    const response = await fetch('/api/botmanager/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId, token }),
    });

    if (!response.ok) return null;
    
    const result = await response.json();
    return result.data || result;
  } catch {
    return null;
  }
}

/**
 * Format Bot Manager API errors for display
 */
export function formatBotManagerErrors(errors: any[]): string[] {
  if (!errors || !Array.isArray(errors)) return [];
  
  return errors.map(err => {
    if (typeof err === 'string') return err;
    if (Array.isArray(err)) {
      // Bot Manager error format: [nodeNum, [[category, field, message]]]
      const [nodeNum, details] = err;
      if (Array.isArray(details) && details.length > 0) {
        return details.map((d: any) => {
          if (Array.isArray(d)) {
            const [category, field, message] = d;
            return `Node ${nodeNum || '?'}: ${message || d}`;
          }
          return String(d || 'Unknown');
        }).join('; ');
      }
      return `Node ${nodeNum || '?'}: ${JSON.stringify(details || 'Unknown')}`;
    }
    return JSON.stringify(err || 'Unknown error');
  }).filter(Boolean);
}

/**
 * Generate a valid Bot ID from project config
 */
export function generateBotId(clientName: string, projectName: string): string {
  // Remove special characters and spaces, capitalize first letter of each word
  const cleanClient = clientName
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^./, c => c.toUpperCase());
  
  const cleanProject = projectName
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^./, c => c.toUpperCase());
  
  return `${cleanClient}.${cleanProject}`;
}

// ============================================
// CHANNEL & WIDGET CREATION
// ============================================

export interface WidgetCreationResult {
  success: boolean;
  widgetId?: string;
  widgetUrl?: string;
  streamId?: string;
  pypeId?: string;
  error?: string;
  authError?: boolean;  // True if 401/token expired
}

export interface BrandAssets {
  name?: string;
  domain?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logos?: any[];
  // Full brand data from Brandfetch (used by branded channel handler)
  logoUrl?: string;
  brandMomentUrl?: string;
  colors?: any[];
  fonts?: any[];
  images?: any[];
  [key: string]: any;
}

/**
 * Create a complete channel with widget for testing the bot
 * This performs the full workflow: get customer -> get/create pype -> create stream -> configure bot -> create widget
 */
export async function createChannelWithWidget(
  botId: string,
  environment: 'sandbox' | 'production',
  token: string,
  options?: {
    widgetName?: string;
    brandAssets?: BrandAssets;
    targetCompany?: string;
  }
): Promise<WidgetCreationResult> {
  const response = await fetch('/api/botmanager/create-channel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      botId,
      environment,
      token,
      widgetName: options?.widgetName,
      brandAssets: options?.brandAssets,
      targetCompany: options?.targetCompany,
    }),
  });

  const result = await response.json();
  
  if (!response.ok) {
    return {
      success: false,
      error: result.error || `Channel creation failed: ${response.status}`,
    };
  }

  return result;
}
