#!/usr/bin/env node

/**
 * Email Sync Diagnostic Script
 * 
 * This script helps diagnose why email synchronization isn't working
 * by checking all the components involved in the sync process.
 * 
 * Usage: node scripts/diagnose-email-sync.js
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const EmailService = require('../src/services/emailService');
const GmailService = require('../src/services/gmailService');
const db = require('../src/config/database');

async function diagnoseEmailSync() {
  try {
    console.log('\n🔍 FAQ Generator Email Sync Diagnostic\n');
    
    const emailService = new EmailService();
    const gmailService = new GmailService();
    
    // 1. Check database connection
    console.log('1. 📊 Checking database connection...');
    try {
      const dbResult = await db.query('SELECT NOW() as current_time');
      console.log(`   ✅ Database connected: ${dbResult.rows[0].current_time}`);
    } catch (dbError) {
      console.log(`   ❌ Database connection failed: ${dbError.message}`);
      return;
    }
    
    // 2. Check environment variables
    console.log('\n2. 🔧 Checking environment variables...');
    const requiredEnvVars = [
      'BASE_URL',
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'DATABASE_URL'
    ];
    
    let envIssues = 0;
    requiredEnvVars.forEach(envVar => {
      if (process.env[envVar]) {
        console.log(`   ✅ ${envVar}: Set`);
      } else {
        console.log(`   ❌ ${envVar}: Missing`);
        envIssues++;
      }
    });
    
    if (envIssues > 0) {
      console.log(`   ⚠️  ${envIssues} environment variables are missing`);
    }
    
    // 3. Check email accounts
    console.log('\n3. 📧 Checking email accounts...');
    const accounts = await emailService.getAllAccounts();
    
    if (accounts.length === 0) {
      console.log('   ❌ No email accounts found in database');
      console.log('   💡 Try connecting a Gmail account first');
      return;
    }
    
    console.log(`   ✅ Found ${accounts.length} email account(s):`);
    accounts.forEach(account => {
      console.log(`      • ${account.email_address} (${account.provider}) - Status: ${account.status}`);
      console.log(`        Last sync: ${account.last_sync_at || 'Never'}`);
      console.log(`        Created: ${account.created_at}`);
    });
    
    // 4. Test each account connection
    console.log('\n4. 🔗 Testing account connections...');
    for (const account of accounts) {
      console.log(`\n   Testing ${account.email_address}...`);
      
      try {
        // Get full account details with decrypted tokens
        const fullAccount = await emailService.getAccount(account.id);
        
        if (!fullAccount.access_token) {
          console.log(`   ❌ No access token found for ${account.email_address}`);
          continue;
        }
        
        // Test connection
        if (account.provider === 'gmail') {
          gmailService.setCredentials({
            access_token: fullAccount.access_token,
            refresh_token: fullAccount.refresh_token
          });
          
          const testResult = await gmailService.testConnection();
          
          if (testResult.success) {
            console.log(`   ✅ Gmail connection successful`);
            console.log(`      Email: ${testResult.email}`);
            console.log(`      Name: ${testResult.name}`);
            console.log(`      Estimated messages: ${testResult.messageCount}`);
          } else {
            console.log(`   ❌ Gmail connection failed: ${testResult.error}`);
          }
        }
        
      } catch (testError) {
        console.log(`   ❌ Connection test failed: ${testError.message}`);
      }
    }
    
    // 5. Check existing emails
    console.log('\n5. 📬 Checking existing emails in database...');
    const emailCountResult = await db.query(`
      SELECT 
        ea.email_address,
        ea.provider,
        COUNT(e.id) as email_count,
        COUNT(e.id) FILTER (WHERE e.is_processed = true) as processed_count,
        MAX(e.received_at) as latest_email
      FROM email_accounts ea
      LEFT JOIN emails e ON ea.id = e.account_id
      GROUP BY ea.id, ea.email_address, ea.provider
      ORDER BY ea.created_at DESC
    `);
    
    if (emailCountResult.rows.length === 0) {
      console.log('   ❌ No email data found');
    } else {
      emailCountResult.rows.forEach(row => {
        console.log(`   📧 ${row.email_address} (${row.provider}):`);
        console.log(`      Total emails: ${row.email_count}`);
        console.log(`      Processed: ${row.processed_count}`);
        console.log(`      Latest email: ${row.latest_email || 'None'}`);
      });
    }
    
    // 6. Test manual sync for first account
    if (accounts.length > 0) {
      console.log('\n6. 🔄 Testing manual email sync...');
      const testAccount = accounts[0];
      console.log(`   Testing sync for ${testAccount.email_address}...`);
      
      try {
        const syncResult = await emailService.syncAccount(testAccount.id, { maxEmails: 10 });
        
        console.log(`   ✅ Sync completed successfully:`);
        console.log(`      Processed: ${syncResult.processed || 0} emails`);
        console.log(`      Total available: ${syncResult.total || 0} emails`);
        console.log(`      Stored: ${syncResult.stored || 0} new emails`);
        console.log(`      Skipped: ${syncResult.skipped || 0} duplicates`);
        
      } catch (syncError) {
        console.log(`   ❌ Manual sync failed: ${syncError.message}`);
        console.log(`      Stack: ${syncError.stack}`);
      }
    }
    
    // 7. Check cron job configuration
    console.log('\n7. ⏰ Checking cron job configuration...');
    console.log('   Environment variables for cron jobs:');
    console.log(`   • CRON_SYNC_MAX_EMAILS: ${process.env.CRON_SYNC_MAX_EMAILS || 'Not set (default: 500)'}`);
    console.log(`   • CRON_TIMEOUT_MS: ${process.env.CRON_TIMEOUT_MS || 'Not set (default: 600000)'}`);
    console.log(`   • MAX_EMAILS_PER_SYNC: ${process.env.MAX_EMAILS_PER_SYNC || 'Not set (default: 1000)'}`);
    
    // 8. Check system metrics
    console.log('\n8. 📊 Checking recent system metrics...');
    const metricsResult = await db.query(`
      SELECT metric_name, metric_value, metadata, created_at
      FROM system_metrics 
      WHERE metric_name LIKE '%email%' OR metric_name LIKE '%sync%'
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    if (metricsResult.rows.length === 0) {
      console.log('   ❌ No email sync metrics found');
      console.log('   💡 This suggests cron jobs may not be running');
    } else {
      console.log('   📈 Recent email sync metrics:');
      metricsResult.rows.forEach(metric => {
        console.log(`      • ${metric.metric_name}: ${metric.metric_value} (${metric.created_at})`);
        if (metric.metadata) {
          const metadata = JSON.parse(metric.metadata);
          console.log(`        Duration: ${metadata.duration}ms, Accounts: ${metadata.accounts || 0}`);
        }
      });
    }
    
    // 9. Recommendations
    console.log('\n9. 💡 Recommendations:');
    
    if (accounts.length === 0) {
      console.log('   • Connect a Gmail account through the web interface');
    }
    
    if (envIssues > 0) {
      console.log('   • Fix missing environment variables');
    }
    
    const hasRecentMetrics = metricsResult.rows.some(m => 
      new Date(m.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    
    if (!hasRecentMetrics) {
      console.log('   • Check if cron jobs are configured and running on Render.com');
      console.log('   • Manually trigger email sync using: node scripts/manual-email-sync.js');
    }
    
    const unprocessedEmails = emailCountResult.rows.reduce((sum, row) => 
      sum + (parseInt(row.email_count) - parseInt(row.processed_count)), 0
    );
    
    if (unprocessedEmails > 0) {
      console.log(`   • Process ${unprocessedEmails} unprocessed emails using FAQ generation`);
    }
    
    console.log('\n✅ Diagnostic complete!');
    
  } catch (error) {
    console.error('\n❌ Diagnostic failed:', error);
    logger.error('Email sync diagnostic failed:', error);
  } finally {
    await db.end();
  }
}

// Handle process signals
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down diagnostic');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down diagnostic');
  process.exit(0);
});

// Run the diagnostic
if (require.main === module) {
  diagnoseEmailSync().catch(error => {
    console.error('Diagnostic script failed:', error);
    process.exit(1);
  });
}

module.exports = { diagnoseEmailSync };