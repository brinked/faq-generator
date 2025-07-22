#!/usr/bin/env node

/**
 * Test script to verify token refresh functionality
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');
const EmailService = require('../src/services/emailService');
const logger = require('../src/utils/logger');

async function testTokenRefresh() {
  try {
    console.log('🔍 Testing token refresh functionality...\n');
    
    // Get a Gmail account to test with
    const accountQuery = `
      SELECT id, email_address, provider, status, 
             access_token, refresh_token, token_expires_at
      FROM email_accounts 
      WHERE provider = 'gmail' 
      AND status IN ('active', 'expired')
      LIMIT 1
    `;
    
    const accountResult = await db.query(accountQuery);
    
    if (accountResult.rows.length === 0) {
      console.log('❌ No Gmail accounts found to test with');
      return;
    }
    
    const account = accountResult.rows[0];
    console.log(`📧 Testing with account: ${account.email_address}`);
    console.log(`📊 Current status: ${account.status}`);
    console.log(`⏰ Token expires: ${account.token_expires_at}\n`);
    
    // Test the email sync which should trigger token refresh if needed
    const emailService = new EmailService();
    
    console.log('🔄 Attempting email sync (this will test token refresh if needed)...');
    
    try {
      const result = await emailService.syncAccount(account.id, 10);
      console.log('✅ Sync successful!');
      console.log(`📨 Synced ${result.synced} emails\n`);
      
      // Check if account status was updated
      const updatedAccountResult = await db.query(
        'SELECT status, token_expires_at FROM email_accounts WHERE id = $1',
        [account.id]
      );
      
      const updatedAccount = updatedAccountResult.rows[0];
      console.log(`📊 Updated status: ${updatedAccount.status}`);
      console.log(`⏰ Updated token expires: ${updatedAccount.token_expires_at}`);
      
    } catch (error) {
      console.log('❌ Sync failed:', error.message);
      
      if (error.message.includes('token has expired')) {
        console.log('🔄 This indicates the refresh token itself has expired');
        console.log('👤 User needs to re-authenticate through the OAuth flow');
      } else if (error.message.includes('could not be refreshed')) {
        console.log('🔄 Token refresh was attempted but failed');
        console.log('👤 User needs to re-authenticate through the OAuth flow');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await db.end();
  }
}

// Run the test
if (require.main === module) {
  testTokenRefresh().catch(console.error);
}

module.exports = testTokenRefresh;