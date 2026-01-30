/**
 * Action Scripts API Service
 * 
 * Handles fetching official action node scripts from Supabase
 * Uses local proxy in development (/functions/v1/sd-action-scripts)
 */

// Use local proxy in dev, direct Supabase URL in production
const SCRIPTS_ENDPOINT = '/functions/v1/sd-action-scripts';

export interface ActionScript {
  name: string;
  content: string;
  description?: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Fetch a single script by name
 */
export async function fetchScript(scriptName: string): Promise<ActionScript | null> {
  try {
    const response = await fetch(`${SCRIPTS_ENDPOINT}/${encodeURIComponent(scriptName)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error(`Failed to fetch script ${scriptName}:`, response.status);
      return null;
    }

    const data = await response.json();
    return data.script || null;
  } catch (error) {
    console.error(`Error fetching script ${scriptName}:`, error);
    return null;
  }
}

/**
 * Fetch multiple scripts by names
 */
export async function fetchScripts(scriptNames: string[]): Promise<Map<string, ActionScript>> {
  const scripts = new Map<string, ActionScript>();
  
  if (scriptNames.length === 0) {
    console.log('[ActionScriptsAPI] No scripts to fetch');
    return scripts;
  }
  
  console.log('[ActionScriptsAPI] Fetching scripts:', scriptNames);
  
  try {
    const response = await fetch(`${SCRIPTS_ENDPOINT}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: scriptNames }),
    });

    console.log('[ActionScriptsAPI] Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ActionScriptsAPI] Failed to fetch scripts batch:', response.status, errorText);
      return scripts;
    }

    const data = await response.json();
    console.log('[ActionScriptsAPI] Received', data.scripts?.length || 0, 'scripts');
    
    for (const script of data.scripts || []) {
      scripts.set(script.name, script);
      console.log('[ActionScriptsAPI] Got script:', script.name, '- length:', script.content?.length || 0);
    }
    return scripts;
  } catch (error) {
    console.error('[ActionScriptsAPI] Error fetching scripts batch:', error);
    return scripts;
  }
}

/**
 * List all available scripts
 */
export async function listScripts(): Promise<string[]> {
  try {
    const response = await fetch(SCRIPTS_ENDPOINT, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error('Failed to list scripts:', response.status);
      return [];
    }

    const data = await response.json();
    return data.scripts?.map((s: ActionScript) => s.name) || [];
  } catch (error) {
    console.error('Error listing scripts:', error);
    return [];
  }
}
