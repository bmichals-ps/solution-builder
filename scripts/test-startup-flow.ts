#!/usr/bin/env npx tsx
/**
 * Startup Flow Test Suite
 * 
 * Tests that all startup flow components are correctly configured:
 * 1. Node templates are valid
 * 2. Scripts are bundled
 * 3. Injection logic works
 * 4. Validation detects broken nodes
 * 
 * Run with: npx tsx scripts/test-startup-flow.ts
 */

import { 
  STARTUP_SCRIPTS, 
  CRITICAL_STARTUP_SCRIPTS, 
  validateCriticalScripts,
  getBundledScript,
  getScriptContent
} from '../src/data/startup-scripts';

import {
  SYSTEM_NODES,
  STARTUP_NODES,
  getTemplateContext
} from '../src/data/node-templates';

// Test results
let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  try {
    const result = fn();
    if (result) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.log(`❌ ${name}`);
      failed++;
    }
  } catch (err: any) {
    console.log(`❌ ${name} - Exception: ${err.message}`);
    failed++;
  }
}

console.log('🧪 Startup Flow Test Suite\n');
console.log('='.repeat(60) + '\n');

// ============================================
// Script Registry Tests
// ============================================
console.log('📦 Script Registry Tests\n');

test('Critical scripts are bundled', () => {
  const validation = validateCriticalScripts();
  return validation.valid;
});

test('HandleBotError script exists', () => {
  const script = getBundledScript('HandleBotError');
  return script !== undefined && script.content.length > 100;
});

test('UserPlatformRouting script exists', () => {
  const script = getBundledScript('UserPlatformRouting');
  return script !== undefined && script.content.length > 100;
});

test('HandleBotError is marked as critical', () => {
  const script = getBundledScript('HandleBotError');
  return script?.critical === true;
});

test('HandleBotError script is valid Python', () => {
  const content = getScriptContent('HandleBotError');
  if (!content) return false;
  // Check for class definition and execute method
  return content.includes('class HandleBotError') && 
         content.includes('def execute(self');
});

test('UserPlatformRouting script is valid Python', () => {
  const content = getScriptContent('UserPlatformRouting');
  if (!content) return false;
  return content.includes('class UserPlatformRouting') && 
         content.includes('def execute(self');
});

// ============================================
// Node Template Tests
// ============================================
console.log('\n📋 Node Template Tests\n');

test('System nodes include HandleBotError (-500)', () => {
  const node = SYSTEM_NODES.find(n => n.num === -500);
  return node !== undefined && node.command === 'HandleBotError';
});

test('System nodes include EndChat (666)', () => {
  const node = SYSTEM_NODES.find(n => n.num === 666);
  return node !== undefined;
});

test('System nodes include Error Message (99990)', () => {
  const node = SYSTEM_NODES.find(n => n.num === 99990);
  return node !== undefined && node.type === 'D';
});

test('Startup nodes include SysShowMetadata (1)', () => {
  const node = STARTUP_NODES.find(n => n.num === 1);
  return node !== undefined && node.command === 'SysShowMetadata';
});

test('Startup nodes include UserPlatformRouting (10)', () => {
  const node = STARTUP_NODES.find(n => n.num === 10);
  return node !== undefined && node.command === 'UserPlatformRouting';
});

test('Startup nodes include SysSetEnv (104)', () => {
  const node = STARTUP_NODES.find(n => n.num === 104);
  return node !== undefined && node.command === 'SysSetEnv';
});

test('Node -500 is Action type', () => {
  const node = SYSTEM_NODES.find(n => n.num === -500);
  return node?.type === 'A';
});

test('Node -500 has What Next routing', () => {
  const node = SYSTEM_NODES.find(n => n.num === -500);
  return node?.whatNext?.includes('~') === true;
});

test('Node 10 routes to platform-specific nodes', () => {
  const node = STARTUP_NODES.find(n => n.num === 10);
  return node?.whatNext?.includes('ios~100') === true;
});

// ============================================
// Template Context Tests
// ============================================
console.log('\n📄 Template Context Tests\n');

test('Template context includes system nodes', () => {
  const context = getTemplateContext();
  return context.includes('HandleBotError') && context.includes('-500');
});

test('Template context includes startup flow', () => {
  const context = getTemplateContext();
  return context.includes('UserPlatformRouting') && context.includes('SysShowMetadata');
});

// ============================================
// Consistency Tests
// ============================================
console.log('\n🔗 Consistency Tests\n');

test('All critical scripts have matching node templates', () => {
  // Each critical script should be used by a node in the templates
  for (const script of CRITICAL_STARTUP_SCRIPTS) {
    const usedInSystem = SYSTEM_NODES.some(n => n.command === script.name);
    const usedInStartup = STARTUP_NODES.some(n => n.command === script.name);
    if (!usedInSystem && !usedInStartup) {
      console.log(`    ⚠️ Script ${script.name} not found in node templates`);
      return false;
    }
  }
  return true;
});

test('All node template scripts have bundled versions', () => {
  const templateScripts = new Set<string>();
  
  // Collect all commands from templates
  for (const node of [...SYSTEM_NODES, ...STARTUP_NODES]) {
    if (node.command && !node.command.startsWith('Sys')) {
      templateScripts.add(node.command);
    }
  }
  
  // Check each has a bundled version
  for (const scriptName of templateScripts) {
    const bundled = getBundledScript(scriptName);
    if (!bundled) {
      console.log(`    ⚠️ Template command ${scriptName} not in bundled scripts`);
      return false;
    }
  }
  return true;
});

// ============================================
// Summary
// ============================================
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('✅ All tests passed! Startup flow is correctly configured.\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please fix the issues above.\n');
  process.exit(1);
}
