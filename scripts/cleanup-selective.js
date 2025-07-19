require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

/**
 * Selective cleanup script for FAQ Generator
 * 
 * This script allows for targeted cleanup of specific accounts, old data,
 * or specific data types while preserving other data.
 * 
 * Usage: 
 *   node scripts/cleanup-selective.js --help
 *   node scripts/cleanup-selective.js --account email@example.com
 *   node scripts/cleanup-selective.js --older-than 30
 *   node scripts/cleanup-selective.js --failed-jobs
 *   node scripts/cleanup-selective.js --orphaned-data
 */

const args = process.argv.slice(2);

async function selectiveCleanup() {
  try {
    // Parse command line arguments
    const options = parseArguments(args);
    
    if (options.help) {
      showHelp();
      return;
    }
    
    if (Object.keys(options).length === 0) {
      logger.error('No cleanup options specified. Use --help for usage information.');
      return;
    }
    
    logger.info('Starting selective cleanup...');
    
    const cleanupResults = {};
    
    // Clean up specific account
    if (options.account) {
      cleanupResults.account = await cleanupAccount(options.account);
    }
    
    // Clean up old data
    if (options.olderThan) {
      cleanupResults.oldData = await cleanupOldData(options.olderThan);
    }
    
    // Clean up failed jobs
    if (options.failedJobs) {
      cleanupResults.failedJobs = await cleanupFailedJobs();
    }
    
    // Clean up orphaned data
    if (options.orphanedData) {
      cleanupResults.orphanedData = await cleanupOrphanedData();
    }
    
    // Clean up old metrics
    if (options.oldMetrics) {
      cleanupResults.oldMetrics = await cleanupOldMetrics(options.oldMetrics);
    }
    
    // Clean up processed emails (keep account and recent data)
    if (options.processedEmails) {
      cleanupResults.processedEmails = await cleanupProcessedEmails(options.processedEmails);
    }
    
    // Update database statistics
    logger.info('Updating database statistics...');
    await db.query('ANALYZE');
    
    // Log results
    logger.info('\n🎉 Selective cleanup completed!');
    Object.entries(cleanupResults).forEach(([type, result]) => {
      if (result && typeof result === 'object') {
        logger.info(`${type}:`);
        Object.entries(result).forEach(([key, value]) => {
          logger.info(`  • ${key}: ${value} records`);
        });
      }
    });
    
  } catch (error) {
    logger.error('❌ Error during selective cleanup:', error);
    throw error;
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
        options.account = args[++i];
        break;
        
      case '--older-than':
        options.olderThan = parseInt(args[++i]);
        break;
        
      case '--failed-jobs':
        options.failedJobs = true;
        break;
        
      case '--orphaned-data':
        options.orphanedData = true;
        break;
        
      case '--old-metrics':
        options.oldMetrics = parseInt(args[++i]) || 90;
        break;
        
      case '--processed-emails':
        options.processedEmails = parseInt(args[++i]) || 30;
        break;
        
      default:
        logger.warn(`Unknown argument: ${arg}`);
    }
  }
  
  return options;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
FAQ Generator Selective Cleanup Script

Usage: node scripts/cleanup-selective.js [options]

Options:
  --help, -h                    Show this help message
  --account <email>             Clean up specific email account and all its data
  --older-than <days>           Clean up data older than specified days
  --failed-jobs                 Clean up failed processing jobs
  --orphaned-data               Clean up orphaned data (questions without emails, etc.)
  --old-metrics <days>          Clean up system metrics older than specified days (default: 90)
  --processed-emails <days>     Clean up processed emails older than specified days (default: 30)

Examples:
  node scripts/cleanup-selective.js --account user@example.com
  node scripts/cleanup-selective.js --older-than 60
  node scripts/cleanup-selective.js --failed-jobs --orphaned-data
  node scripts/cleanup-selective.js --old-metrics 30 --processed-emails 14
`);
}

/**
 * Clean up specific account and all its data
 */
async function cleanupAccount(emailAddress) {
  logger.info(`🎯 Cleaning up account: ${emailAddress}`);
  
  // Find the account
  const accountResult = await db.query(
    'SELECT id, email_address, provider, status FROM email_accounts WHERE email_address = $1',
    [emailAddress]
  );
  
  if (accountResult.rows.length === 0) {
    logger.warn(`Account ${emailAddress} not found`);
    return { accounts: 0 };
  }
  
  const account = accountResult.rows[0];
  logger.info(`Found account: ${account.email_address} (${account.provider}) - ${account.status}`);
  
  const results = {};
  
  // Delete in correct order (CASCADE should handle most of this, but being explicit)
  const accountId = account.id;
  
  // Delete question_groups for questions related to this account's emails
  const questionGroupsResult = await db.query(`
    DELETE FROM question_groups 
    WHERE question_id IN (
      SELECT q.id FROM questions q 
      JOIN emails e ON q.email_id = e.id 
      WHERE e.account_id = $1
    )
  `, [accountId]);
  results.questionGroups = questionGroupsResult.rowCount || 0;
  
  // Delete questions for this account's emails
  const questionsResult = await db.query(`
    DELETE FROM questions 
    WHERE email_id IN (
      SELECT id FROM emails WHERE account_id = $1
    )
  `, [accountId]);
  results.questions = questionsResult.rowCount || 0;
  
  // Delete emails for this account
  const emailsResult = await db.query('DELETE FROM emails WHERE account_id = $1', [accountId]);
  results.emails = emailsResult.rowCount || 0;
  
  // Delete processing jobs for this account
  const jobsResult = await db.query('DELETE FROM processing_jobs WHERE account_id = $1', [accountId]);
  results.processingJobs = jobsResult.rowCount || 0;
  
  // Delete the account itself
  const accountDeleteResult = await db.query('DELETE FROM email_accounts WHERE id = $1', [accountId]);
  results.accounts = accountDeleteResult.rowCount || 0;
  
  logger.info(`✅ Account cleanup completed for ${emailAddress}`);
  return results;
}

/**
 * Clean up data older than specified days
 */
async function cleanupOldData(days) {
  logger.info(`🗓️ Cleaning up data older than ${days} days`);
  
  const results = {};
  
  // Delete old emails and their related data
  const oldEmailsResult = await db.query(`
    DELETE FROM emails 
    WHERE received_at < NOW() - INTERVAL '${days} days'
  `);
  results.emails = oldEmailsResult.rowCount || 0;
  
  // Delete old processing jobs
  const oldJobsResult = await db.query(`
    DELETE FROM processing_jobs 
    WHERE created_at < NOW() - INTERVAL '${days} days'
    AND status IN ('completed', 'failed')
  `);
  results.processingJobs = oldJobsResult.rowCount || 0;
  
  // Delete old audit logs
  const oldAuditResult = await db.query(`
    DELETE FROM audit_logs 
    WHERE created_at < NOW() - INTERVAL '${days} days'
  `);
  results.auditLogs = oldAuditResult.rowCount || 0;
  
  logger.info(`✅ Old data cleanup completed`);
  return results;
}

/**
 * Clean up failed processing jobs
 */
async function cleanupFailedJobs() {
  logger.info('❌ Cleaning up failed processing jobs');
  
  const failedJobsResult = await db.query(`
    DELETE FROM processing_jobs 
    WHERE status = 'failed' 
    AND created_at < NOW() - INTERVAL '1 day'
  `);
  
  const count = failedJobsResult.rowCount || 0;
  logger.info(`✅ Deleted ${count} failed processing jobs`);
  
  return { failedJobs: count };
}

/**
 * Clean up orphaned data
 */
async function cleanupOrphanedData() {
  logger.info('🧹 Cleaning up orphaned data');
  
  const results = {};
  
  // Delete questions without emails
  const orphanedQuestionsResult = await db.query(`
    DELETE FROM questions 
    WHERE email_id NOT IN (SELECT id FROM emails)
  `);
  results.orphanedQuestions = orphanedQuestionsResult.rowCount || 0;
  
  // Delete question_groups without questions or groups
  const orphanedGroupsResult = await db.query(`
    DELETE FROM question_groups 
    WHERE question_id NOT IN (SELECT id FROM questions)
    OR group_id NOT IN (SELECT id FROM faq_groups)
  `);
  results.orphanedQuestionGroups = orphanedGroupsResult.rowCount || 0;
  
  // Delete empty FAQ groups
  const emptyFAQsResult = await db.query(`
    DELETE FROM faq_groups 
    WHERE id NOT IN (SELECT DISTINCT group_id FROM question_groups WHERE group_id IS NOT NULL)
  `);
  results.emptyFAQGroups = emptyFAQsResult.rowCount || 0;
  
  // Delete processing jobs for non-existent accounts
  const orphanedJobsResult = await db.query(`
    DELETE FROM processing_jobs 
    WHERE account_id IS NOT NULL 
    AND account_id NOT IN (SELECT id FROM email_accounts)
  `);
  results.orphanedJobs = orphanedJobsResult.rowCount || 0;
  
  logger.info(`✅ Orphaned data cleanup completed`);
  return results;
}

/**
 * Clean up old system metrics
 */
async function cleanupOldMetrics(days) {
  logger.info(`📊 Cleaning up system metrics older than ${days} days`);
  
  const metricsResult = await db.query(`
    DELETE FROM system_metrics 
    WHERE created_at < NOW() - INTERVAL '${days} days'
  `);
  
  const count = metricsResult.rowCount || 0;
  logger.info(`✅ Deleted ${count} old system metrics`);
  
  return { systemMetrics: count };
}

/**
 * Clean up processed emails older than specified days
 */
async function cleanupProcessedEmails(days) {
  logger.info(`📧 Cleaning up processed emails older than ${days} days`);
  
  const processedEmailsResult = await db.query(`
    DELETE FROM emails 
    WHERE is_processed = true 
    AND processing_status = 'completed'
    AND received_at < NOW() - INTERVAL '${days} days'
  `);
  
  const count = processedEmailsResult.rowCount || 0;
  logger.info(`✅ Deleted ${count} old processed emails`);
  
  return { processedEmails: count };
}

// Handle process signals gracefully
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down selective cleanup script');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down selective cleanup script');
  process.exit(0);
});

// Run the cleanup
if (require.main === module) {
  selectiveCleanup().catch(error => {
    logger.error('Selective cleanup script failed:', error);
    process.exit(1);
  });
}

module.exports = { selectiveCleanup };