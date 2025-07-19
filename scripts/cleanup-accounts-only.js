require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function cleanupAccountsOnly() {
  try {
    logger.info('Starting account cleanup (accounts only)...');
    
    // First, let's see all accounts
    const listResult = await db.query(`
      SELECT id, email_address, provider, status, created_at
      FROM email_accounts
      ORDER BY created_at DESC
    `);
    
    logger.info(`Found ${listResult.rows.length} accounts:`);
    listResult.rows.forEach(account => {
      logger.info(`- ${account.email_address} (${account.id}): ${account.status}, created: ${account.created_at}`);
    });
    
    if (listResult.rows.length === 0) {
      logger.info('No accounts found. Database is already clean.');
      return;
    }
    
    // Delete all accounts
    logger.info('\nDeleting all email accounts...');
    const accountsResult = await db.query('DELETE FROM email_accounts');
    logger.info(`Deleted ${accountsResult.rowCount} email accounts`);
    
    // Verify cleanup
    const verifyResult = await db.query('SELECT COUNT(*) FROM email_accounts');
    const remainingAccounts = parseInt(verifyResult.rows[0].count);
    
    if (remainingAccounts === 0) {
      logger.info('\n✅ SUCCESS: All accounts have been deleted!');
      logger.info('You can now re-authenticate with Gmail to start fresh.');
    } else {
      logger.error(`\n❌ ERROR: ${remainingAccounts} accounts still remain in the database!`);
    }
    
  } catch (error) {
    logger.error('Error during cleanup:', error);
  } finally {
    await db.end();
  }
}

// Run the cleanup
cleanupAccountsOnly();