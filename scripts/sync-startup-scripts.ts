#!/usr/bin/env npx tsx
/**
 * Sync Startup Scripts to Supabase
 * 
 * This script ensures that all bundled startup scripts are also
 * available in Supabase for any services that might need them.
 * 
 * Run with: npx tsx scripts/sync-startup-scripts.ts
 */

import { createClient } from '@supabase/supabase-js';
import { STARTUP_SCRIPTS, validateCriticalScripts, logScriptRegistry } from '../src/data/startup-scripts';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function syncScripts() {
  console.log('🔄 Syncing Startup Scripts to Supabase\n');
  
  // Validate bundled scripts
  const validation = validateCriticalScripts();
  if (!validation.valid) {
    console.error('❌ Critical scripts are corrupted in bundle:', validation.missing);
    process.exit(1);
  }
  
  // Log what we have
  logScriptRegistry();
  console.log('');
  
  let synced = 0;
  let errors = 0;
  
  for (const script of STARTUP_SCRIPTS) {
    console.log(`📤 Syncing: ${script.name}...`);
    
    try {
      // Upsert the script to Supabase
      const { data, error } = await supabase
        .from('action_scripts')
        .upsert(
          {
            name: script.name,
            content: script.content,
            description: script.description,
            is_critical: script.critical,
            used_by_nodes: script.usedByNodes,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'name' }
        )
        .select();
      
      if (error) {
        console.error(`  ❌ Failed: ${error.message}`);
        errors++;
      } else {
        console.log(`  ✅ Synced successfully`);
        synced++;
      }
    } catch (err: any) {
      console.error(`  ❌ Exception: ${err.message}`);
      errors++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Summary: ${synced} synced, ${errors} errors`);
  
  if (errors > 0) {
    console.log('\n⚠️  Some scripts failed to sync. They will still work because they are bundled.');
    console.log('   Supabase is a backup source only.');
  } else {
    console.log('\n✅ All scripts synced successfully!');
  }
}

// Run
syncScripts().catch(console.error);
