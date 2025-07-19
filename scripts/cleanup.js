#!/usr/bin/env node

/**
 * FAQ Generator Cleanup Script Runner
 * 
 * Interactive script to help choose and run the appropriate cleanup script
 * for your needs.
 * 
 * Usage: node scripts/cleanup.js
 */

require('dotenv').config();
const readline = require('readline');
const { spawn } = require('child_process');
const path = require('path');
const logger = require('../src/utils/logger');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n🧹 FAQ Generator Cleanup Script Runner\n');
  
  console.log('Available cleanup options:\n');
  console.log('1. 🎯 Selective Cleanup - Clean specific accounts or old data');
  console.log('2. 📧 Accounts Only - Remove email accounts but keep processed data');
  console.log('3. 🔄 All Accounts - Remove accounts and all related data');
  console.log('4. 🚀 Complete Cleanup - Comprehensive cleanup with safety checks (RECOMMENDED)');
  console.log('5. ❓ Help - Show detailed information about each option');
  console.log('6. ❌ Exit\n');
  
  const choice = await question('Select an option (1-6): ');
  
  switch (choice.trim()) {
    case '1':
      await runSelectiveCleanup();
      break;
    case '2':
      await runScript('cleanup-accounts-only.js', 'Accounts Only Cleanup');
      break;
    case '3':
      await runScript('cleanup-all-accounts.js', 'All Accounts Cleanup');
      break;
    case '4':
      await runCompleteCleanup();
      break;
    case '5':
      await showHelp();
      break;
    case '6':
      console.log('👋 Goodbye!');
      break;
    default:
      console.log('❌ Invalid option. Please try again.');
      await main();
  }
  
  rl.close();
}

async function runSelectiveCleanup() {
  console.log('\n🎯 Selective Cleanup Options:\n');
  console.log('1. Clean specific email account');
  console.log('2. Clean data older than X days');
  console.log('3. Clean failed processing jobs');
  console.log('4. Clean orphaned data');
  console.log('5. Clean old system metrics');
  console.log('6. Clean old processed emails');
  console.log('7. Custom command');
  console.log('8. Back to main menu\n');
  
  const choice = await question('Select selective cleanup option (1-8): ');
  
  let args = [];
  
  switch (choice.trim()) {
    case '1':
      const email = await question('Enter email address to clean up: ');
      args = ['--account', email];
      break;
    case '2':
      const days = await question('Enter number of days (data older than this will be deleted): ');
      args = ['--older-than', days];
      break;
    case '3':
      args = ['--failed-jobs'];
      break;
    case '4':
      args = ['--orphaned-data'];
      break;
    case '5':
      const metricDays = await question('Enter number of days to keep metrics (default 90): ');
      args = ['--old-metrics', metricDays || '90'];
      break;
    case '6':
      const emailDays = await question('Enter number of days to keep processed emails (default 30): ');
      args = ['--processed-emails', emailDays || '30'];
      break;
    case '7':
      const customArgs = await question('Enter custom arguments (e.g., --failed-jobs --orphaned-data): ');
      args = customArgs.split(' ').filter(arg => arg.trim());
      break;
    case '8':
      await main();
      return;
    default:
      console.log('❌ Invalid option. Please try again.');
      await runSelectiveCleanup();
      return;
  }
  
  await runScript('cleanup-selective.js', 'Selective Cleanup', args);
}

async function runCompleteCleanup() {
  console.log('\n🚀 Complete Cleanup\n');
  console.log('⚠️  WARNING: This will delete ALL data from the database!');
  console.log('This includes:');
  console.log('• All email accounts');
  console.log('• All emails');
  console.log('• All questions and answers');
  console.log('• All FAQ groups');
  console.log('• All processing jobs');
  console.log('• All audit logs');
  console.log('• All system metrics\n');
  
  const confirm1 = await question('Are you sure you want to proceed? (yes/no): ');
  if (confirm1.toLowerCase() !== 'yes') {
    console.log('❌ Cleanup cancelled.');
    await main();
    return;
  }
  
  const confirm2 = await question('Type "DELETE ALL DATA" to confirm: ');
  if (confirm2 !== 'DELETE ALL DATA') {
    console.log('❌ Cleanup cancelled - confirmation text did not match.');
    await main();
    return;
  }
  
  // Check if this is production
  if (process.env.NODE_ENV === 'production') {
    console.log('\n🚨 PRODUCTION ENVIRONMENT DETECTED');
    const prodConfirm = await question('Set FORCE_CLEANUP=true and type "PRODUCTION" to proceed: ');
    if (prodConfirm !== 'PRODUCTION') {
      console.log('❌ Production cleanup cancelled.');
      await main();
      return;
    }
    process.env.FORCE_CLEANUP = 'true';
  }
  
  await runScript('cleanup-complete.js', 'Complete Cleanup');
}

async function runScript(scriptName, displayName, args = []) {
  console.log(`\n🚀 Running ${displayName}...\n`);
  
  const scriptPath = path.join(__dirname, scriptName);
  const nodeArgs = ['node', scriptPath, ...args];
  
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${displayName} completed successfully!`);
        resolve();
      } else {
        console.log(`\n❌ ${displayName} failed with exit code ${code}`);
        reject(new Error(`Script failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      console.error(`\n❌ Failed to start ${displayName}:`, error);
      reject(error);
    });
  });
}

async function showHelp() {
  console.log('\n📚 Cleanup Script Help\n');
  
  console.log('🎯 SELECTIVE CLEANUP (cleanup-selective.js)');
  console.log('   Best for: Regular maintenance, cleaning specific accounts');
  console.log('   Features: Targeted cleanup, multiple options, safe for production');
  console.log('   Use when: You want to clean specific data without affecting everything\n');
  
  console.log('📧 ACCOUNTS ONLY (cleanup-accounts-only.js)');
  console.log('   Best for: Removing authentication data only');
  console.log('   Features: Keeps processed emails, questions, and FAQs');
  console.log('   Use when: You want to re-authenticate but keep processed data\n');
  
  console.log('🔄 ALL ACCOUNTS (cleanup-all-accounts.js)');
  console.log('   Best for: Removing accounts and related data');
  console.log('   Features: Removes accounts and most related data');
  console.log('   Use when: You want to start fresh but may have some data remnants\n');
  
  console.log('🚀 COMPLETE CLEANUP (cleanup-complete.js) - RECOMMENDED');
  console.log('   Best for: Complete database reset');
  console.log('   Features: Production safety, detailed logging, verification');
  console.log('   Use when: You want a complete fresh start with maximum safety\n');
  
  const backToMenu = await question('Press Enter to return to main menu...');
  await main();
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n\n👋 Cleanup cancelled by user');
  rl.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Cleanup terminated');
  rl.close();
  process.exit(0);
});

// Run the main function
if (require.main === module) {
  main().catch(error => {
    logger.error('Cleanup runner failed:', error);
    rl.close();
    process.exit(1);
  });
}