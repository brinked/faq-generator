const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const db = require('../config/database');

/**
 * Admin route to reset account data for testing
 * This allows testing the new filtering logic with fresh data
 */
router.post('/reset-account/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { confirmReset } = req.body;

    if (!confirmReset) {
      return res.status(400).json({
        success: false,
        error: 'Must confirm reset by setting confirmReset: true'
      });
    }

    logger.info(`Starting data reset for account ${accountId}`);

    await db.transaction(async (client) => {
      // Delete questions first (due to foreign key constraints)
      const questionsResult = await client.query(
        'DELETE FROM questions WHERE email_id IN (SELECT id FROM emails WHERE account_id = $1)',
        [accountId]
      );

      // Delete FAQ group associations
      await client.query(`
        DELETE FROM question_groups 
        WHERE question_id IN (
          SELECT q.id FROM questions q 
          JOIN emails e ON q.email_id = e.id 
          WHERE e.account_id = $1
        )
      `, [accountId]);

      // Delete emails
      const emailsResult = await client.query(
        'DELETE FROM emails WHERE account_id = $1',
        [accountId]
      );

      // Delete processing jobs
      const jobsResult = await client.query(
        'DELETE FROM processing_jobs WHERE account_id = $1',
        [accountId]
      );

      // Reset account sync status
      await client.query(
        'UPDATE email_accounts SET last_sync_at = NULL WHERE id = $1',
        [accountId]
      );

      logger.info(`Data reset completed for account ${accountId}`, {
        questionsDeleted: questionsResult.rowCount,
        emailsDeleted: emailsResult.rowCount,
        jobsDeleted: jobsResult.rowCount
      });
    });

    res.json({
      success: true,
      message: 'Account data reset successfully',
      accountId,
      resetItems: {
        emails: 'deleted',
        questions: 'deleted',
        processingJobs: 'deleted',
        lastSyncAt: 'reset'
      }
    });

  } catch (error) {
    logger.error(`Error resetting account data:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset account data'
    });
  }
});

/**
 * Get account information for admin testing
 */
router.get('/account-info/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;

    const query = `
      SELECT
        id,
        email_address,
        provider,
        display_name,
        status,
        created_at,
        last_sync_at,
        (SELECT COUNT(*) FROM emails WHERE account_id = $1) as total_emails,
        (SELECT COUNT(*) FROM emails WHERE account_id = $1 AND is_processed = false) as pending_emails,
        (SELECT COUNT(*) FROM questions WHERE email_id IN (SELECT id FROM emails WHERE account_id = $1)) as total_questions
      FROM email_accounts
      WHERE id = $1
    `;

    const result = await db.query(query, [accountId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }

    const account = result.rows[0];

    res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email_address,
        provider: account.provider,
        displayName: account.display_name,
        status: account.status,
        createdAt: account.created_at,
        lastSyncAt: account.last_sync_at,
        stats: {
          totalEmails: parseInt(account.total_emails),
          pendingEmails: parseInt(account.pending_emails),
          totalQuestions: parseInt(account.total_questions)
        }
      }
    });

  } catch (error) {
    logger.error(`Error getting account info:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get account information'
    });
  }
});

/**
 * Get filtering test statistics - compare before/after filtering
 */
router.get('/filtering-test/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;

    const query = `
      WITH connected_emails AS (
        SELECT DISTINCT ea.email_address
        FROM email_accounts ea
        WHERE ea.status = 'active' AND ea.id = $1
      ),
      conversation_threads AS (
        SELECT DISTINCT e1.thread_id
        FROM emails e1
        JOIN emails e2 ON e1.thread_id = e2.thread_id
        JOIN connected_emails ce ON e2.sender_email = ce.email_address
        WHERE e1.thread_id IS NOT NULL 
          AND e1.thread_id != ''
          AND e1.sender_email != e2.sender_email
          AND e1.account_id = $1
      ),
      email_analysis AS (
        SELECT 
          COUNT(*) as total_emails,
          COUNT(*) FILTER (WHERE e.thread_id IN (SELECT thread_id FROM conversation_threads)) as conversation_emails,
          COUNT(*) FILTER (WHERE e.thread_id NOT IN (SELECT thread_id FROM conversation_threads) OR e.thread_id IS NULL) as standalone_emails,
          COUNT(*) FILTER (WHERE e.is_processed = true) as processed_emails,
          COUNT(*) FILTER (WHERE e.is_processed = false) as pending_emails,
          COUNT(*) FILTER (WHERE 
            e.is_processed = false AND 
            (e.thread_id IN (SELECT thread_id FROM conversation_threads) OR
             EXISTS (
               SELECT 1 FROM emails reply_email
               JOIN connected_emails ce ON reply_email.sender_email = ce.email_address
               WHERE reply_email.thread_id = e.thread_id
                 AND reply_email.id != e.id
                 AND reply_email.sent_at > e.sent_at
             ) OR
             EXISTS (
               SELECT 1 FROM emails original_email
               JOIN connected_emails ce ON original_email.sender_email = ce.email_address
               WHERE original_email.thread_id = e.thread_id
                 AND original_email.sent_at < e.sent_at
             ))
          ) as valid_for_processing
        FROM emails e
        WHERE e.account_id = $1
      )
      SELECT 
        *,
        CAST(ROUND((conversation_emails::float / NULLIF(total_emails, 0)) * 100, 2) AS NUMERIC(5,2)) as conversation_percentage,
        CAST(ROUND((valid_for_processing::float / NULLIF(pending_emails, 0)) * 100, 2) AS NUMERIC(5,2)) as valid_processing_percentage,
        (pending_emails - valid_for_processing) as emails_filtered_out,
        CASE 
          WHEN pending_emails > 0 THEN ROUND(((pending_emails - valid_for_processing)::float / pending_emails) * 100, 2)
          ELSE 0
        END as spam_reduction_percentage
      FROM email_analysis
    `;

    const result = await db.query(query, [accountId]);
    const stats = result.rows[0];

    // Get sample emails that would be filtered
    const sampleFilteredQuery = `
      WITH connected_emails AS (
        SELECT DISTINCT ea.email_address
        FROM email_accounts ea
        WHERE ea.status = 'active' AND ea.id = $1
      ),
      conversation_threads AS (
        SELECT DISTINCT e1.thread_id
        FROM emails e1
        JOIN emails e2 ON e1.thread_id = e2.thread_id
        JOIN connected_emails ce ON e2.sender_email = ce.email_address
        WHERE e1.thread_id IS NOT NULL 
          AND e1.thread_id != ''
          AND e1.sender_email != e2.sender_email
          AND e1.account_id = $1
      )
      SELECT 
        e.id, e.subject, e.sender_email, e.received_at,
        CASE 
          WHEN e.thread_id IN (SELECT thread_id FROM conversation_threads) THEN 'conversation'
          ELSE 'filtered'
        END as status
      FROM emails e
      WHERE e.account_id = $1 
        AND e.is_processed = false
        AND NOT (
          e.thread_id IN (SELECT thread_id FROM conversation_threads) OR
          EXISTS (
            SELECT 1 FROM emails reply_email
            JOIN connected_emails ce ON reply_email.sender_email = ce.email_address
            WHERE reply_email.thread_id = e.thread_id
              AND reply_email.id != e.id
              AND reply_email.sent_at > e.sent_at
          ) OR
          EXISTS (
            SELECT 1 FROM emails original_email
            JOIN connected_emails ce ON original_email.sender_email = ce.email_address
            WHERE original_email.thread_id = e.thread_id
              AND original_email.sent_at < e.sent_at
          )
        )
      ORDER BY e.received_at DESC
      LIMIT 10
    `;

    const sampleResult = await db.query(sampleFilteredQuery, [accountId]);

    res.json({
      success: true,
      accountId,
      filteringStats: {
        total_emails: parseInt(stats.total_emails),
        conversation_emails: parseInt(stats.conversation_emails),
        standalone_emails: parseInt(stats.standalone_emails),
        processed_emails: parseInt(stats.processed_emails),
        pending_emails: parseInt(stats.pending_emails),
        valid_for_processing: parseInt(stats.valid_for_processing),
        emails_filtered_out: parseInt(stats.emails_filtered_out),
        conversation_percentage: parseFloat(stats.conversation_percentage) || 0,
        valid_processing_percentage: parseFloat(stats.valid_processing_percentage) || 0,
        spam_reduction_percentage: parseFloat(stats.spam_reduction_percentage) || 0
      },
      sampleFilteredEmails: sampleResult.rows
    });

  } catch (error) {
    logger.error(`Error getting filtering test stats:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get filtering test statistics'
    });
  }
});

/**
 * Force re-sync emails for testing
 */
router.post('/force-sync/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { maxEmails = 100 } = req.body;

    const EmailService = require('../services/emailService');
    const emailService = new EmailService();

    logger.info(`Starting forced email sync for account ${accountId}`);

    const result = await emailService.syncAccount(accountId, {
      maxEmails,
      sinceDate: null // Force full sync
    });

    res.json({
      success: true,
      message: 'Forced email sync completed',
      accountId,
      result
    });

  } catch (error) {
    logger.error(`Error in forced sync:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to force sync emails'
    });
  }
});

/**
 * Test the new filtering logic without processing
 */
router.get('/test-filtering/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;

    const EmailService = require('../services/emailService');
    const emailService = new EmailService();

    // Get emails using old logic (all unprocessed)
    const allEmails = await emailService.getAllUnprocessedEmails(50, 0);
    
    // Get emails using new filtering logic
    const filteredEmails = await emailService.getEmailsForProcessing(50, 0);

    res.json({
      success: true,
      accountId,
      comparison: {
        oldLogic: {
          count: allEmails.length,
          emails: allEmails.map(e => ({
            id: e.id,
            subject: e.subject,
            sender: e.sender_email,
            received: e.received_at
          }))
        },
        newFiltering: {
          count: filteredEmails.length,
          emails: filteredEmails.map(e => ({
            id: e.id,
            subject: e.subject,
            sender: e.sender_email,
            received: e.received_at
          }))
        },
        improvement: {
          emailsFiltered: allEmails.length - filteredEmails.length,
          reductionPercentage: allEmails.length > 0 ? 
            Math.round(((allEmails.length - filteredEmails.length) / allEmails.length) * 100) : 0
        }
      }
    });

  } catch (error) {
    logger.error(`Error testing filtering logic:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to test filtering logic'
    });
  }
});

module.exports = router;