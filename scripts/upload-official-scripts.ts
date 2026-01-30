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

const SUPABASE_URL = 'https://lkjxlgvqlcvlupyqjvpv.supabase.co';
const SCRIPTS_ENDPOINT = `${SUPABASE_URL}/functions/v1/sd-action-scripts`;

// Get admin key from environment
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_KEY environment variable is required');
  console.error('Usage: SUPABASE_SERVICE_KEY=your-key npx tsx scripts/upload-official-scripts.ts');
  process.exit(1);
}

async function uploadScript(name: string, content: string): Promise<boolean> {
  try {
    const response = await fetch(SCRIPTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ name, content }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error(`Failed to upload ${name}:`, error);
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
