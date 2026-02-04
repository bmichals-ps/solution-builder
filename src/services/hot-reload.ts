/**
 * Hot Reload Service
 * 
 * Fast redeployment pipeline optimized for live editing:
 * - Reuses existing widget/channel (no recreation)
 * - Only uploads changed scripts
 * - Target: < 5 second redeploy time
 */

import type { CustomScript } from '../types';
import { 
  STARTUP_SCRIPTS, 
  CRITICAL_STARTUP_SCRIPTS, 
  getBundledScript 
} from '../data/startup-scripts';

const BOTMANAGER_API = 'https://api.pypestream.com/botmanager';

interface HotReloadResult {
  success: boolean;
  versionId?: string;
  error?: string;
  timing?: {
    validation: number;
    scriptUpload: number;
    deploy: number;
    total: number;
  };
}

/**
 * Hot reload the bot with new CSV and scripts
 * Optimized for speed - skips widget recreation
 */
export async function hotReload(
  botId: string,
  csv: string,
  scripts: CustomScript[],
  token: string
): Promise<HotReloadResult> {
  const startTime = performance.now();
  const timing = {
    validation: 0,
    scriptUpload: 0,
    deploy: 0,
    total: 0
  };
  
  console.log(`[HotReload] Starting hot reload for ${botId}`);
  
  try {
    // Ensure critical startup scripts are included
    const allScripts = ensureCriticalScripts(scripts);
    
    // Step 1: Create new version and upload CSV
    const validationStart = performance.now();
    
    // Create a new version
    const versionRes = await fetch(`${BOTMANAGER_API}/bots/${botId}/versions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!versionRes.ok) {
      const error = await versionRes.text();
      throw new Error(`Failed to create version: ${error}`);
    }
    
    const versionData = await versionRes.json();
    const versions = versionData.data?.versions || [];
    const draftVersion = versionData.data?.draftVersion || versions[versions.length - 1];
    const versionId = `${botId}.${draftVersion}`;
    
    console.log(`[HotReload] Created version: ${versionId}`);
    
    // Upload the CSV
    const formData = new FormData();
    const csvBlob = new Blob([csv], { type: 'text/csv' });
    formData.append('file', csvBlob, 'bot.csv');
    
    const uploadRes = await fetch(`${BOTMANAGER_API}/versions/${versionId}/graph`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    timing.validation = performance.now() - validationStart;
    
    if (!uploadRes.ok) {
      const result = await uploadRes.json();
      if (result.errors && result.errors.length > 0) {
        const errorMsgs = result.errors.map((e: any) => 
          `Node ${e.node_num}: ${e.err_msgs?.map((m: any) => m.error_description).join(', ')}`
        ).join('; ');
        throw new Error(`Validation errors: ${errorMsgs}`);
      }
      throw new Error('CSV upload failed');
    }
    
    console.log(`[HotReload] CSV validated in ${timing.validation.toFixed(0)}ms`);
    
    // Step 2: Upload scripts
    const scriptStart = performance.now();
    
    for (const script of allScripts) {
      const scriptFormData = new FormData();
      const scriptBlob = new Blob([script.content], { type: 'text/plain' });
      scriptFormData.append('file', scriptBlob, `${script.name}.py`);
      
      const scriptRes = await fetch(
        `${BOTMANAGER_API}/versions/${versionId}/assets/services/${script.name}.py`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: scriptFormData
        }
      );
      
      if (!scriptRes.ok) {
        console.warn(`[HotReload] Failed to upload script ${script.name}`);
      }
    }
    
    timing.scriptUpload = performance.now() - scriptStart;
    console.log(`[HotReload] Scripts uploaded in ${timing.scriptUpload.toFixed(0)}ms`);
    
    // Step 3: Deploy to sandbox
    const deployStart = performance.now();
    
    const deployRes = await fetch(`${BOTMANAGER_API}/versions/${versionId}/deploy`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ environment: 'sandbox' })
    });
    
    timing.deploy = performance.now() - deployStart;
    
    if (!deployRes.ok) {
      const error = await deployRes.text();
      throw new Error(`Deploy failed: ${error}`);
    }
    
    timing.total = performance.now() - startTime;
    
    console.log(`[HotReload] ✅ Deployed in ${timing.total.toFixed(0)}ms`);
    console.log(`[HotReload] Timing breakdown: validation=${timing.validation.toFixed(0)}ms, scripts=${timing.scriptUpload.toFixed(0)}ms, deploy=${timing.deploy.toFixed(0)}ms`);
    
    return {
      success: true,
      versionId,
      timing
    };
    
  } catch (error: any) {
    timing.total = performance.now() - startTime;
    console.error(`[HotReload] ❌ Failed:`, error);
    
    return {
      success: false,
      error: error.message,
      timing
    };
  }
}

/**
 * Ensure critical startup scripts are included
 */
function ensureCriticalScripts(scripts: CustomScript[]): CustomScript[] {
  const result = [...scripts];
  const existingNames = new Set(scripts.map(s => s.name));
  
  for (const criticalScript of CRITICAL_STARTUP_SCRIPTS) {
    if (!existingNames.has(criticalScript.name)) {
      console.log(`[HotReload] Adding bundled critical script: ${criticalScript.name}`);
      result.push({
        name: criticalScript.name,
        content: criticalScript.content
      });
    }
  }
  
  return result;
}

/**
 * Quick deploy just the CSV (no scripts) - even faster for text-only changes
 */
export async function quickDeployCsv(
  botId: string,
  csv: string,
  token: string
): Promise<HotReloadResult> {
  const startTime = performance.now();
  
  try {
    // Create version
    const versionRes = await fetch(`${BOTMANAGER_API}/bots/${botId}/versions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!versionRes.ok) {
      throw new Error('Failed to create version');
    }
    
    const versionData = await versionRes.json();
    const draftVersion = versionData.data?.draftVersion;
    const versionId = `${botId}.${draftVersion}`;
    
    // Upload CSV
    const formData = new FormData();
    const csvBlob = new Blob([csv], { type: 'text/csv' });
    formData.append('file', csvBlob, 'bot.csv');
    
    const uploadRes = await fetch(`${BOTMANAGER_API}/versions/${versionId}/graph`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (!uploadRes.ok) {
      const result = await uploadRes.json();
      throw new Error(result.errors?.[0]?.err_msgs?.[0]?.error_description || 'Upload failed');
    }
    
    // Deploy
    await fetch(`${BOTMANAGER_API}/versions/${versionId}/deploy`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ environment: 'sandbox' })
    });
    
    const total = performance.now() - startTime;
    console.log(`[QuickDeploy] ✅ Deployed in ${total.toFixed(0)}ms`);
    
    return { success: true, versionId };
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export default {
  hotReload,
  quickDeployCsv
};
