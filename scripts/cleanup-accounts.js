require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function cleanupAccounts() {
  try {
    logger.info('Starting account cleanup...');
    
    // First, let's see all accounts
    const listResult = await db.query(`
      SELECT id, email_address, provider, status, created_at, updated_at,
             CASE 
               WHEN refresh_token IS NOT NULL THEN 'Has token'
               ELSE 'No token'
             END as token_status
      FROM email_accounts
      ORDER BY created_at DESC
    `);
    
    logger.info(`Found ${listResult.rows.length} accounts:`);
    listResult.rows.forEach(account => {
      logger.info(`- ${account.email_address} (${account.id}): ${account.status}, ${account.token_status}, created: ${account.created_at}`);
    });
    
    // Find accounts with invalid tokens (those that have been failing)
    const invalidAccounts = await db.query(`
      SELECT id, email_address 
      FROM email_accounts 
      WHERE status = 'error' 
         OR id = '74f71191-fdeb-42ec-bf9e-318d64382ac2'
         OR updated_at < NOW() - INTERVAL '1 hour'
    `);
    
    if (invalidAccounts.rows.length > 0) {
      logger.info(`\nFound ${invalidAccounts.rows.length} accounts to clean up:`);
      
      for (const account of invalidAccounts.rows) {
        logger.info(`Deleting account ${account.id} (${account.email_address})...`);
        
        // Delete related records first
        await db.query('DELETE FROM email_sync_logs WHERE account_id = $1', [account.id]);
        await db.query('DELETE FROM emails WHERE account_id = $1', [account.id]);
        
        // Delete the account
        await db.query('DELETE FROM email_accounts WHERE id = $1', [account.id]);
        
        logger.info(`Deleted account ${account.id}`);
      }
    }
    
    // Show remaining accounts
    const remainingResult = await db.query(`
      SELECT id, email_address, provider, status, created_at
      FROM email_accounts
      ORDER BY created_at DESC
    `);
    
    logger.info(`\nRemaining accounts after cleanup: ${remainingResult.rows.length}`);
    remainingResult.rows.forEach(account => {
      logger.info(`- ${account.email_address} (${account.id}): ${account.status}`);
    });
    
    logger.info('\nCleanup completed successfully!');
    
  } catch (error) {
    logger.error('Error during cleanup:', error);
  } finally {
    await db.end();
  }
}

// Run the cleanup
cleanupAccounts();