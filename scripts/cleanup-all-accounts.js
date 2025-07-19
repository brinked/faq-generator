require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function cleanupAllAccounts() {
  try {
    logger.info('Starting COMPLETE account cleanup...');
    
    // First, let's see all accounts
    const listResult = await db.query(`
      SELECT id, email_address, provider, status, created_at
      FROM email_accounts
      ORDER BY created_at DESC
    `);
    
    logger.info(`Found ${listResult.rows.length} accounts to delete:`);
    listResult.rows.forEach(account => {
      logger.info(`- ${account.email_address} (${account.id}): ${account.status}, created: ${account.created_at}`);
    });
    
    if (listResult.rows.length === 0) {
      logger.info('No accounts found. Database is already clean.');
      return;
    }
    
    // Delete ALL accounts and related data
    logger.info('\nDeleting all accounts and related data...');
    
    // Delete all sync logs (if table exists)
    try {
      const syncLogsResult = await db.query('DELETE FROM email_sync_logs');
      logger.info(`Deleted ${syncLogsResult.rowCount} sync log entries`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('email_sync_logs table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete all emails
    try {
      const emailsResult = await db.query('DELETE FROM emails');
      logger.info(`Deleted ${emailsResult.rowCount} email entries`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('emails table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete question_groups (junction table first)
    try {
      const questionGroupsResult = await db.query('DELETE FROM question_groups');
      logger.info(`Deleted ${questionGroupsResult.rowCount} question-group relationships`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('question_groups table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete questions
    try {
      const questionsResult = await db.query('DELETE FROM questions');
      logger.info(`Deleted ${questionsResult.rowCount} question entries`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('questions table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete all FAQ groups (correct table name)
    try {
      const faqGroupsResult = await db.query('DELETE FROM faq_groups');
      logger.info(`Deleted ${faqGroupsResult.rowCount} FAQ group entries`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('faq_groups table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete processing jobs
    try {
      const jobsResult = await db.query('DELETE FROM processing_jobs');
      logger.info(`Deleted ${jobsResult.rowCount} processing job entries`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('processing_jobs table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete audit logs
    try {
      const auditResult = await db.query('DELETE FROM audit_logs');
      logger.info(`Deleted ${auditResult.rowCount} audit log entries`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('audit_logs table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete system metrics
    try {
      const metricsResult = await db.query('DELETE FROM system_metrics');
      logger.info(`Deleted ${metricsResult.rowCount} system metric entries`);
    } catch (err) {
      if (err.code === '42P01') {
        logger.info('system_metrics table does not exist, skipping...');
      } else {
        throw err;
      }
    }
    
    // Delete all accounts
    const accountsResult = await db.query('DELETE FROM email_accounts');
    logger.info(`Deleted ${accountsResult.rowCount} email accounts`);
    
    // Verify cleanup
    const verifyResult = await db.query('SELECT COUNT(*) FROM email_accounts');
    const remainingAccounts = parseInt(verifyResult.rows[0].count);
    
    if (remainingAccounts === 0) {
      logger.info('\n✅ SUCCESS: All accounts have been deleted. Database is clean!');
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
cleanupAllAccounts();