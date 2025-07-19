require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

/**
 * Complete cleanup script for FAQ Generator
 * 
 * This script performs a comprehensive cleanup of all data while respecting
 * foreign key constraints and providing detailed logging.
 * 
 * Usage: node scripts/cleanup-complete.js
 */

async function cleanupComplete() {
  try {
    logger.info('Starting COMPLETE database cleanup...');
    
    // First, let's see what we have
    await logCurrentState();
    
    // Confirm before proceeding
    if (process.env.NODE_ENV === 'production' && !process.env.FORCE_CLEANUP) {
      logger.warn('⚠️  PRODUCTION ENVIRONMENT DETECTED');
      logger.warn('Set FORCE_CLEANUP=true environment variable to proceed with cleanup in production');
      return;
    }
    
    const cleanupResults = {};
    
    // Delete in correct order to respect foreign key constraints
    logger.info('\n🧹 Starting cleanup process...');
    
    // 1. Delete question_groups (junction table)
    logger.info('1. Cleaning up question-group relationships...');
    const questionGroupsResult = await db.query('DELETE FROM question_groups');
    cleanupResults.questionGroups = questionGroupsResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.questionGroups} question-group relationships`);
    
    // 2. Delete questions (depends on emails)
    logger.info('2. Cleaning up questions...');
    const questionsResult = await db.query('DELETE FROM questions');
    cleanupResults.questions = questionsResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.questions} questions`);
    
    // 3. Delete faq_groups
    logger.info('3. Cleaning up FAQ groups...');
    const faqGroupsResult = await db.query('DELETE FROM faq_groups');
    cleanupResults.faqGroups = faqGroupsResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.faqGroups} FAQ groups`);
    
    // 4. Delete emails (depends on email_accounts)
    logger.info('4. Cleaning up emails...');
    const emailsResult = await db.query('DELETE FROM emails');
    cleanupResults.emails = emailsResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.emails} emails`);
    
    // 5. Delete processing_jobs (depends on email_accounts)
    logger.info('5. Cleaning up processing jobs...');
    const jobsResult = await db.query('DELETE FROM processing_jobs');
    cleanupResults.processingJobs = jobsResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.processingJobs} processing jobs`);
    
    // 6. Delete audit_logs
    logger.info('6. Cleaning up audit logs...');
    const auditResult = await db.query('DELETE FROM audit_logs');
    cleanupResults.auditLogs = auditResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.auditLogs} audit log entries`);
    
    // 7. Delete system_metrics
    logger.info('7. Cleaning up system metrics...');
    const metricsResult = await db.query('DELETE FROM system_metrics');
    cleanupResults.systemMetrics = metricsResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.systemMetrics} system metrics`);
    
    // 8. Delete email_accounts (should be last due to CASCADE)
    logger.info('8. Cleaning up email accounts...');
    const accountsResult = await db.query('DELETE FROM email_accounts');
    cleanupResults.emailAccounts = accountsResult.rowCount || 0;
    logger.info(`   ✓ Deleted ${cleanupResults.emailAccounts} email accounts`);
    
    // 9. Reset sequences if needed (PostgreSQL specific)
    logger.info('9. Resetting database sequences...');
    await resetSequences();
    
    // 10. Update database statistics
    logger.info('10. Updating database statistics...');
    await db.query('ANALYZE');
    
    // Verify cleanup
    await verifyCleanup();
    
    // Log final results
    const totalDeleted = Object.values(cleanupResults).reduce((sum, count) => sum + count, 0);
    
    logger.info('\n🎉 CLEANUP COMPLETED SUCCESSFULLY!');
    logger.info('Summary of deleted records:');
    logger.info(`   • Email Accounts: ${cleanupResults.emailAccounts}`);
    logger.info(`   • Emails: ${cleanupResults.emails}`);
    logger.info(`   • Questions: ${cleanupResults.questions}`);
    logger.info(`   • FAQ Groups: ${cleanupResults.faqGroups}`);
    logger.info(`   • Question-Group Relations: ${cleanupResults.questionGroups}`);
    logger.info(`   • Processing Jobs: ${cleanupResults.processingJobs}`);
    logger.info(`   • Audit Logs: ${cleanupResults.auditLogs}`);
    logger.info(`   • System Metrics: ${cleanupResults.systemMetrics}`);
    logger.info(`   📊 Total Records Deleted: ${totalDeleted}`);
    logger.info('\n✅ Database is now clean and ready for fresh data!');
    
  } catch (error) {
    logger.error('❌ Error during complete cleanup:', error);
    throw error;
  } finally {
    await db.end();
  }
}

/**
 * Log current state of the database
 */
async function logCurrentState() {
  try {
    logger.info('📊 Current database state:');
    
    const tables = [
      'email_accounts',
      'emails', 
      'questions',
      'faq_groups',
      'question_groups',
      'processing_jobs',
      'audit_logs',
      'system_metrics'
    ];
    
    for (const table of tables) {
      try {
        const result = await db.query(`SELECT COUNT(*) FROM ${table}`);
        const count = parseInt(result.rows[0].count);
        logger.info(`   • ${table}: ${count} records`);
      } catch (err) {
        if (err.code === '42P01') {
          logger.info(`   • ${table}: Table does not exist`);
        } else {
          logger.warn(`   • ${table}: Error counting records - ${err.message}`);
        }
      }
    }
    
    // Show sample email accounts if any exist
    try {
      const accountsResult = await db.query(`
        SELECT id, email_address, provider, status, created_at
        FROM email_accounts
        ORDER BY created_at DESC
        LIMIT 5
      `);
      
      if (accountsResult.rows.length > 0) {
        logger.info('\n📧 Sample email accounts to be deleted:');
        accountsResult.rows.forEach(account => {
          logger.info(`   • ${account.email_address} (${account.provider}) - ${account.status}`);
        });
      }
    } catch (err) {
      // Ignore errors when showing sample accounts
    }
    
  } catch (error) {
    logger.warn('Could not log current database state:', error.message);
  }
}

/**
 * Reset database sequences (PostgreSQL specific)
 */
async function resetSequences() {
  try {
    // Note: UUID primary keys don't use sequences, but if we had any serial columns, we'd reset them here
    logger.info('   ✓ No sequences to reset (using UUIDs)');
  } catch (error) {
    logger.warn('Could not reset sequences:', error.message);
  }
}

/**
 * Verify that cleanup was successful
 */
async function verifyCleanup() {
  try {
    logger.info('\n🔍 Verifying cleanup...');
    
    const tables = [
      'email_accounts',
      'emails',
      'questions', 
      'faq_groups',
      'question_groups',
      'processing_jobs',
      'audit_logs',
      'system_metrics'
    ];
    
    let allClean = true;
    
    for (const table of tables) {
      try {
        const result = await db.query(`SELECT COUNT(*) FROM ${table}`);
        const count = parseInt(result.rows[0].count);
        
        if (count > 0) {
          logger.error(`   ❌ ${table}: ${count} records still remain!`);
          allClean = false;
        } else {
          logger.info(`   ✅ ${table}: Clean (0 records)`);
        }
      } catch (err) {
        if (err.code === '42P01') {
          logger.info(`   ✅ ${table}: Table does not exist`);
        } else {
          logger.error(`   ❌ ${table}: Error verifying - ${err.message}`);
          allClean = false;
        }
      }
    }
    
    if (!allClean) {
      throw new Error('Cleanup verification failed - some records still remain');
    }
    
    logger.info('   🎯 All tables verified clean!');
    
  } catch (error) {
    logger.error('Cleanup verification failed:', error);
    throw error;
  }
}

// Handle process signals gracefully
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down cleanup script');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down cleanup script');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in cleanup script:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in cleanup script:', { reason, promise });
  process.exit(1);
});

// Run the cleanup
if (require.main === module) {
  cleanupComplete().catch(error => {
    logger.error('Cleanup script failed:', error);
    process.exit(1);
  });
}

module.exports = { cleanupComplete };