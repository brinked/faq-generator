#!/usr/bin/env node

/**
 * Fix Invalid OAuth Tokens Script
 * 
 * This script identifies and fixes accounts with invalid OAuth tokens
 * that are causing "invalid_grant" errors.
 * 
 * Usage: node scripts/fix-invalid-tokens.js
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const EmailService = require('../src/services/emailService');
const GmailService = require('../src/services/gmailService');
const db = require('../src/config/database');

async function fixInvalidTokens() {
  try {
    console.log('\n🔧 Fixing Invalid OAuth Tokens\n');
    
    const emailService = new EmailService();
    const gmailService = new GmailService();
    
    // 1. Get all accounts
    console.log('1. 📋 Getting all email accounts...');
    const accounts = await emailService.getAllAccounts();
    
    if (accounts.length === 0) {
      console.log('   ❌ No email accounts found');
      return;
    }
    
    console.log(`   ✅ Found ${accounts.length} account(s):`);
    accounts.forEach(account => {
      console.log(`      • ${account.email_address} (${account.id}) - Status: ${account.status}`);
    });
    
    // 2. Test each account for invalid tokens
    console.log('\n2. 🔍 Testing accounts for invalid tokens...');
    const invalidAccounts = [];
    const validAccounts = [];
    
    for (const account of accounts) {
      console.log(`\n   Testing ${account.email_address}...`);
      
      try {
        // Get full account with decrypted tokens
        const fullAccount = await emailService.getAccount(account.id);
        
        if (!fullAccount.access_token || !fullAccount.refresh_token) {
          console.log(`   ❌ Missing tokens for ${account.email_address}`);
          invalidAccounts.push({ ...account, reason: 'missing_tokens' });
          continue;
        }
        
        // Test Gmail connection
        if (account.provider === 'gmail') {
          gmailService.setCredentials({
            access_token: fullAccount.access_token,
            refresh_token: fullAccount.refresh_token
          });
          
          try {
            // Try to get messages (this will trigger token refresh if needed)
            await gmailService.getMessages({ maxResults: 1 });
            console.log(`   ✅ ${account.email_address} - Tokens are valid`);
            validAccounts.push(account);
            
          } catch (gmailError) {
            if (gmailError.message.includes('invalid_grant') || 
                gmailError.message.includes('invalid_token') ||
                gmailError.message.includes('unauthorized_client')) {
              console.log(`   ❌ ${account.email_address} - Invalid tokens (${gmailError.message})`);
              invalidAccounts.push({ ...account, reason: 'invalid_grant', error: gmailError.message });
            } else {
              console.log(`   ⚠️  ${account.email_address} - Other error: ${gmailError.message}`);
              // Don't mark as invalid for other errors
              validAccounts.push(account);
            }
          }
        }
        
      } catch (testError) {
        console.log(`   ❌ ${account.email_address} - Test failed: ${testError.message}`);
        invalidAccounts.push({ ...account, reason: 'test_failed', error: testError.message });
      }
    }
    
    // 3. Report findings
    console.log('\n3. 📊 Results Summary:');
    console.log(`   ✅ Valid accounts: ${validAccounts.length}`);
    console.log(`   ❌ Invalid accounts: ${invalidAccounts.length}`);
    
    if (invalidAccounts.length === 0) {
      console.log('\n🎉 All accounts have valid tokens! No cleanup needed.');
      return;
    }
    
    // 4. Show invalid accounts
    console.log('\n4. ❌ Invalid Accounts Found:');
    invalidAccounts.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.email_address} (${account.id})`);
      console.log(`      Reason: ${account.reason}`);
      if (account.error) {
        console.log(`      Error: ${account.error}`);
      }
    });
    
    // 5. Ask for confirmation to clean up
    console.log('\n5. 🧹 Cleanup Options:');
    console.log('   These invalid accounts need to be removed and re-authenticated.');
    console.log('   The accounts will be deleted from the database, and users will need to');
    console.log('   reconnect their Gmail accounts through the web interface.');
    
    // For now, just show what would be done
    console.log('\n💡 To fix these issues:');
    console.log('   1. Run the cleanup script to remove invalid accounts:');
    console.log('      node scripts/cleanup-selective.js --account <account-id>');
    console.log('   2. Or clean up all invalid accounts at once:');
    console.log('      node scripts/fix-invalid-tokens.js --cleanup');
    console.log('   3. Then re-authenticate Gmail accounts through the web interface');
    
    // Check if cleanup flag is provided
    const shouldCleanup = process.argv.includes('--cleanup') || process.argv.includes('--fix');
    
    if (shouldCleanup) {
      console.log('\n6. 🗑️  Cleaning up invalid accounts...');
      
      for (const account of invalidAccounts) {
        try {
          console.log(`   Deleting ${account.email_address}...`);
          
          // Delete the account and all associated data
          await emailService.deleteAccount(account.id);
          
          console.log(`   ✅ Deleted ${account.email_address}`);
          
        } catch (deleteError) {
          console.log(`   ❌ Failed to delete ${account.email_address}: ${deleteError.message}`);
        }
      }
      
      console.log('\n✅ Cleanup completed!');
      console.log('\n💡 Next steps:');
      console.log('   • Visit your web interface');
      console.log('   • Re-authenticate Gmail accounts');
      console.log('   • Test email sync with: node scripts/manual-email-sync.js');
      
    } else {
      console.log('\n⚠️  No cleanup performed. Use --cleanup flag to remove invalid accounts.');
    }
    
    // 6. Update account statuses
    console.log('\n7. 📝 Updating account statuses...');
    
    for (const account of invalidAccounts) {
      try {
        await emailService.updateAccountStatus(account.id, 'error', 'Invalid OAuth tokens - requires re-authentication');
        console.log(`   Updated status for ${account.email_address} to 'error'`);
      } catch (updateError) {
        console.log(`   Failed to update status for ${account.email_address}: ${updateError.message}`);
      }
    }
    
    console.log('\n🎯 Summary:');
    console.log(`   • Found ${invalidAccounts.length} accounts with invalid tokens`);
    console.log(`   • ${validAccounts.length} accounts are working correctly`);
    console.log(`   • Invalid accounts marked with 'error' status`);
    
    if (!shouldCleanup && invalidAccounts.length > 0) {
      console.log('\n🔧 To fix the issues:');
      console.log(`   node scripts/fix-invalid-tokens.js --cleanup`);
    }
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    logger.error('Fix invalid tokens script failed:', error);
  } finally {
    await db.end();
  }
}

// Handle process signals
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down fix script');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down fix script');
  process.exit(0);
});

// Run the fix
if (require.main === module) {
  fixInvalidTokens().catch(error => {
    console.error('Fix invalid tokens script failed:', error);
    process.exit(1);
  });
}

module.exports = { fixInvalidTokens };