const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EmailService = require('../services/emailService');

const emailService = new EmailService();

/**
 * Get all email accounts
 */
router.get('/', async (req, res) => {
  try {
    const accounts = await emailService.getAllAccounts();
    
    // Get statistics for each account
    const accountsWithStats = await Promise.all(
      accounts.map(async (account) => {
        try {
          const stats = await emailService.getAccountStats(account.id);
          return {
            ...account,
            stats
          };
        } catch (error) {
          logger.warn(`Error getting stats for account ${account.id}:`, error);
          return {
            ...account,
            stats: {
              total_emails: 0,
              processed_emails: 0,
              pending_emails: 0,
              latest_email: null,
              oldest_email: null
            }
          };
        }
      })
    );
    
    res.json({
      success: true,
      accounts: accountsWithStats,
      total: accounts.length
    });
    
  } catch (error) {
    logger.error('Error getting accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get accounts'
    });
  }
});

/**
 * Get account by ID
 */
router.get('/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const account = await emailService.getAccount(accountId);
    const stats = await emailService.getAccountStats(accountId);
    
    // Remove sensitive data
    delete account.access_token;
    delete account.refresh_token;
    
    res.json({
      success: true,
      account: {
        ...account,
        stats
      }
    });
    
  } catch (error) {
    logger.error(`Error getting account ${req.params.accountId}:`, error);
    res.status(404).json({
      success: false,
      error: 'Account not found'
    });
  }
});

/**
 * Update account settings
 */
router.put('/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { display_name } = req.body;
    
    if (!display_name) {
      return res.status(400).json({
        success: false,
        error: 'Display name is required'
      });
    }
    
    const query = `
      UPDATE email_accounts 
      SET display_name = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, email_address, provider, display_name, status, last_sync_at, created_at, updated_at
    `;
    
    const db = require('../config/database');
    const result = await db.query(query, [display_name, accountId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    logger.info(`Account ${accountId} updated successfully`);
    
    res.json({
      success: true,
      account: result.rows[0]
    });
    
  } catch (error) {
    logger.error(`Error updating account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to update account'
    });
  }
});

/**
 * Sync account emails
 */
router.post('/:accountId/sync', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { maxEmails, sinceDate } = req.body;
    
    logger.info(`Starting email sync for account ${accountId}`, {
      maxEmails,
      sinceDate,
      body: req.body
    });
    
    const options = {};
    if (maxEmails) options.maxEmails = parseInt(maxEmails);
    if (sinceDate) options.sinceDate = new Date(sinceDate);
    
    // Start sync (this will run in background)
    const syncResult = await emailService.syncAccount(accountId, options);
    
    logger.info(`Email sync initiated for account ${accountId}`, {
      syncResult
    });
    
    res.json({
      success: true,
      result: syncResult
    });
    
  } catch (error) {
    logger.error(`Error syncing account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get account emails with pagination
 */
router.get('/:accountId/emails', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { 
      page = 1, 
      limit = 20, 
      processed = null,
      search = null 
    } = req.query;
    
    const offset = (page - 1) * limit;
    let whereConditions = ['account_id = $1'];
    let queryParams = [accountId];
    let paramIndex = 2;
    
    if (processed !== null) {
      whereConditions.push(`is_processed = $${paramIndex++}`);
      queryParams.push(processed === 'true');
    }
    
    if (search) {
      whereConditions.push(`(
        to_tsvector('english', COALESCE(subject, '') || ' ' || COALESCE(body_text, '')) 
        @@ plainto_tsquery('english', $${paramIndex++})
      )`);
      queryParams.push(search);
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    const query = `
      SELECT 
        id, subject, sender_email, sender_name, received_at, 
        is_processed, processing_status, created_at
      FROM emails 
      WHERE ${whereClause}
      ORDER BY received_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    queryParams.push(parseInt(limit), offset);
    
    const db = require('../config/database');
    const result = await db.query(query, queryParams);
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM emails 
      WHERE ${whereClause}
    `;
    
    const countResult = await db.query(countQuery, queryParams.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);
    
    res.json({
      success: true,
      emails: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    logger.error(`Error getting emails for account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get emails'
    });
  }
});

/**
 * Get account questions with pagination
 */
router.get('/:accountId/questions', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { 
      page = 1, 
      limit = 20,
      confidence = null 
    } = req.query;
    
    const offset = (page - 1) * limit;
    let whereConditions = ['e.account_id = $1'];
    let queryParams = [accountId];
    let paramIndex = 2;
    
    if (confidence) {
      whereConditions.push(`q.confidence_score >= $${paramIndex++}`);
      queryParams.push(parseFloat(confidence));
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    const query = `
      SELECT 
        q.id, q.question_text, q.answer_text, q.confidence_score,
        q.is_customer_question, q.created_at,
        e.subject as email_subject, e.sender_email
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      WHERE ${whereClause}
      ORDER BY q.confidence_score DESC, q.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    queryParams.push(parseInt(limit), offset);
    
    const db = require('../config/database');
    const result = await db.query(query, queryParams);
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      WHERE ${whereClause}
    `;
    
    const countResult = await db.query(countQuery, queryParams.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);
    
    res.json({
      success: true,
      questions: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    logger.error(`Error getting questions for account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get questions'
    });
  }
});

/**
 * Delete account
 */
router.delete('/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    await emailService.deleteAccount(accountId);
    
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
    
  } catch (error) {
    logger.error(`Error deleting account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
});

/**
 * Get account sync history
 */
router.get('/:accountId/sync-history', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { limit = 10 } = req.query;
    
    const query = `
      SELECT 
        id, job_type, status, progress, total_items, processed_items,
        error_message, started_at, completed_at, created_at
      FROM processing_jobs
      WHERE account_id = $1 AND job_type = 'email_sync'
      ORDER BY created_at DESC
      LIMIT $2
    `;
    
    const db = require('../config/database');
    const result = await db.query(query, [accountId, parseInt(limit)]);
    
    res.json({
      success: true,
      syncHistory: result.rows
    });
    
  } catch (error) {
    logger.error(`Error getting sync history for account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync history'
    });
  }
});

/**
 * Update account status
 */
router.patch('/:accountId/status', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['active', 'inactive', 'error', 'expired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }
    
    const account = await emailService.updateAccountStatus(accountId, status);
    
    res.json({
      success: true,
      account: {
        id: account.id,
        email_address: account.email_address,
        provider: account.provider,
        status: account.status,
        updated_at: account.updated_at
      }
    });
    
  } catch (error) {
    logger.error(`Error updating status for account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to update account status'
    });
  }
});

/**
 * Get current sync status for an account
 */
router.get('/:accountId/sync-status', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    // Get account info
    const accountQuery = `
      SELECT id, email_address, status, last_sync_at
      FROM email_accounts
      WHERE id = $1
    `;
    const accountResult = await db.query(accountQuery, [accountId]);
    
    if (accountResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const account = accountResult.rows[0];
    
    // Get latest sync job
    const jobQuery = `
      SELECT id, status, started_at, completed_at, error_message, metadata
      FROM processing_jobs
      WHERE account_id = $1 AND job_type = 'email_sync'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const jobResult = await db.query(jobQuery, [accountId]);
    
    // Get email count
    const emailCountQuery = `
      SELECT COUNT(*) as total_emails
      FROM emails
      WHERE account_id = $1
    `;
    const emailCountResult = await db.query(emailCountQuery, [accountId]);
    
    res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email_address,
        status: account.status,
        lastSyncAt: account.last_sync_at
      },
      currentSync: jobResult.rows.length > 0 ? jobResult.rows[0] : null,
      emailCount: parseInt(emailCountResult.rows[0].total_emails)
    });
    
  } catch (error) {
    logger.error(`Error getting sync status for account ${req.params.accountId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status'
    });
  }
});

module.exports = router;