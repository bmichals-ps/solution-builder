/**
 * Upload Official Action Node Scripts to Supabase
 * 
 * Run this script to populate the Supabase database with all official scripts
 * from the Official-Action-Nodes folder.
 * 
 * Usage: npx tsx scripts/upload-official-scripts.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
config();

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://jcsfggahtaewgqytvgau.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_KEY not found in .env file');
  console.error('Add SUPABASE_SERVICE_KEY=your-service-role-key to your .env file');
  process.exit(1);
}

console.log(`Using Supabase URL: ${SUPABASE_URL}`);

// Create Supabase client with service role key for admin access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function uploadScript(name: string, content: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('action_scripts')
      .upsert({
        name,
        content,
        category: 'official',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'name' });

    if (error) {
      console.error(`Failed to upload ${name}:`, error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error uploading ${name}:`, error);
    return false;
  }
}

async function main() {
  const scriptsDir = path.join(__dirname, '..', '..', 'Official-Action-Nodes');
  
  if (!fs.existsSync(scriptsDir)) {
    console.error(`Scripts directory not found: ${scriptsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.py'));
  console.log(`Found ${files.length} Python scripts to upload\n`);

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const scriptName = file.replace('.py', '');
    const scriptPath = path.join(scriptsDir, file);
    const content = fs.readFileSync(scriptPath, 'utf-8');

    process.stdout.write(`Uploading ${scriptName}... `);
    const success = await uploadScript(scriptName, content);
    
    if (success) {
      console.log('✓');
      successCount++;
    } else {
      console.log('✗');
      failCount++;
    }
  }

  console.log(`\nDone: ${successCount} uploaded, ${failCount} failed`);
}

main().catch(console.error);
