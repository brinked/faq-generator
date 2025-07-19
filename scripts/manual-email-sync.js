#!/usr/bin/env node

/**
 * Manual Email Sync Script
 * 
 * This script allows manual triggering of email synchronization
 * for debugging and testing purposes.
 * 
 * Usage: 
 *   node scripts/manual-email-sync.js                    # Sync all accounts
 *   node scripts/manual-email-sync.js --account <id>     # Sync specific account
 *   node scripts/manual-email-sync.js --max-emails 50   # Limit emails per account
 *   node scripts/manual-email-sync.js --help            # Show help
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const EmailService = require('../src/services/emailService');
const db = require('../src/config/database');

const args = process.argv.slice(2);

async function manualEmailSync() {
  try {
    // Parse command line arguments
    const options = parseArguments(args);
    
    if (options.help) {
      showHelp();
      return;
    }
    
    console.log('\n🔄 Manual Email Synchronization\n');
    
    const emailService = new EmailService();
    const startTime = Date.now();
    
    let results;
    
    if (options.accountId) {
      // Sync specific account
      console.log(`📧 Syncing specific account: ${options.accountId}`);
      
      try {
        // Get account info first
        const account = await emailService.getAccount(options.accountId);
        console.log(`   Account: ${account.email_address} (${account.provider})`);
        console.log(`   Status: ${account.status}`);
        console.log(`   Last sync: ${account.last_sync_at || 'Never'}`);
        
        const syncOptions = {
          maxEmails: options.maxEmails || 100
        };
        
        console.log(`   Max emails to sync: ${syncOptions.maxEmails}`);
        console.log('\n   Starting sync...');
        
        const syncResult = await emailService.syncAccount(options.accountId, syncOptions);
        
        results = {
          total: 1,
          successful: 1,
          failed: 0,
          results: [{
            accountId: options.accountId,
            success: true,
            ...syncResult
          }]
        };
        
      } catch (error) {
        results = {
          total: 1,
          successful: 0,
          failed: 1,
          results: [{
            accountId: options.accountId,
            success: false,
            error: error.message
          }]
        };
      }
      
    } else {
      // Sync all accounts
      console.log('📧 Syncing all active accounts...');
      
      const syncOptions = {
        maxEmails: options.maxEmails || 100
      };
      
      console.log(`   Max emails per account: ${syncOptions.maxEmails}`);
      console.log('\n   Starting sync...');
      
      results = await emailService.syncAllAccounts(syncOptions);
    }
    
    const duration = Date.now() - startTime;
    
    // Display results
    console.log('\n📊 Sync Results:');
    console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`   Total accounts: ${results.total}`);
    console.log(`   Successful: ${results.successful}`);
    console.log(`   Failed: ${results.failed}`);
    
    if (results.results && results.results.length > 0) {
      console.log('\n📋 Detailed Results:');
      
      results.results.forEach((result, index) => {
        console.log(`\n   Account ${index + 1}:`);
        console.log(`     ID: ${result.accountId}`);
        console.log(`     Success: ${result.success ? '✅' : '❌'}`);
        
        if (result.success) {
          console.log(`     Processed: ${result.processed || 0} emails`);
          console.log(`     Total available: ${result.total || 0} emails`);
          console.log(`     Stored: ${result.stored || 0} new emails`);
          console.log(`     Skipped: ${result.skipped || 0} duplicates`);
          
          if (result.messages && result.messages.length > 0) {
            console.log(`     Sample emails:`);
            result.messages.slice(0, 3).forEach(email => {
              console.log(`       • "${email.subject}" from ${email.from}`);
            });
          }
        } else {
          console.log(`     Error: ${result.error}`);
        }
      });
    }
    
    // Store metrics
    await storeMetrics('manual_email_sync', results, duration);
    
    // Summary
    if (results.successful > 0) {
      console.log('\n✅ Email sync completed successfully!');
      
      // Show next steps
      console.log('\n💡 Next Steps:');
      console.log('   • Check emails in the web interface');
      console.log('   • Run FAQ generation: node scripts/cron-faq-generation.js');
      console.log('   • Run diagnostics: node scripts/diagnose-email-sync.js');
    } else {
      console.log('\n❌ Email sync failed for all accounts');
      console.log('\n💡 Troubleshooting:');
      console.log('   • Run diagnostics: node scripts/diagnose-email-sync.js');
      console.log('   • Check account tokens and permissions');
      console.log('   • Verify environment variables');
    }
    
  } catch (error) {
    console.error('\n❌ Manual email sync failed:', error);
    logger.error('Manual email sync failed:', error);
  } finally {
    await db.end();
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(args) {
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
        
      case '--account':
      case '-a':
        options.accountId = args[++i];
        break;
        
      case '--max-emails':
      case '-m':
        options.maxEmails = parseInt(args[++i]);
        break;
        
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
        
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown argument: ${arg}`);
        }
    }
  }
  
  return options;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Manual Email Sync Script

Usage: node scripts/manual-email-sync.js [options]

Options:
  --help, -h                    Show this help message
  --account <id>, -a <id>       Sync specific account by ID
  --max-emails <num>, -m <num>  Maximum emails to sync per account (default: 100)
  --verbose, -v                 Enable verbose logging

Examples:
  node scripts/manual-email-sync.js
  node scripts/manual-email-sync.js --account abc123-def456-ghi789
  node scripts/manual-email-sync.js --max-emails 50
  node scripts/manual-email-sync.js --account abc123 --max-emails 20 --verbose

Notes:
  • This script syncs emails from connected Gmail/Outlook accounts
  • Use --account to sync a specific account (get ID from web interface)
  • Increase --max-emails for initial sync, decrease for regular maintenance
  • Run diagnostics first if you encounter issues: node scripts/diagnose-email-sync.js
`);
}

/**
 * Store metrics in the database
 */
async function storeMetrics(metricName, result, duration) {
  try {
    const query = `
      INSERT INTO system_metrics (
        metric_name, metric_value, metadata, created_at
      ) VALUES ($1, $2, $3, NOW())
    `;
    
    const totalEmails = result.results?.reduce((sum, r) => sum + (r.stored || 0), 0) || 0;
    const metadata = {
      duration,
      accounts_total: result.total || 0,
      accounts_successful: result.successful || 0,
      accounts_failed: result.failed || 0,
      total_emails_stored: totalEmails,
      timestamp: new Date().toISOString(),
      manual_trigger: true
    };
    
    await db.query(query, [metricName, totalEmails, JSON.stringify(metadata)]);
    
  } catch (error) {
    logger.error('Failed to store manual sync metrics:', error);
  }
}

// Handle process signals
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down manual sync');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down manual sync');
  process.exit(0);
});

// Run the sync
if (require.main === module) {
  manualEmailSync().catch(error => {
    console.error('Manual email sync script failed:', error);
    process.exit(1);
  });
}

module.exports = { manualEmailSync };