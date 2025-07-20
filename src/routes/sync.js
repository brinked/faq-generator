const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EmailService = require('../services/emailService');

const emailService = new EmailService();

/**
 * Get sync status and statistics
 */
router.get('/status', async (req, res) => {
  try {
    const db = require('../config/database');
    
    // Get all accounts with sync status
    const accountsQuery = `
      SELECT 
        id, email_address, provider, status, last_sync_at, created_at,
        (
          SELECT COUNT(*) FROM emails 
          WHERE account_id = email_accounts.id
        ) as total_emails,
        (
          SELECT COUNT(*) FROM emails 
          WHERE account_id = email_accounts.id AND is_processed = false
        ) as pending_emails
      FROM email_accounts 
      ORDER BY created_at DESC
    `;
    
    const accountsResult = await db.query(accountsQuery);
    
    // Get recent sync metrics
    const metricsQuery = `
      SELECT metric_name, metric_value, metadata, created_at
      FROM system_metrics 
      WHERE metric_name LIKE '%email%' OR metric_name LIKE '%sync%'
      ORDER BY created_at DESC 
      LIMIT 10
    `;
    
    const metricsResult = await db.query(metricsQuery);
    
    // Calculate overall statistics
    const totalAccounts = accountsResult.rows.length;
    const activeAccounts = accountsResult.rows.filter(a => a.status === 'active').length;
    const totalEmails = accountsResult.rows.reduce((sum, a) => sum + parseInt(a.total_emails), 0);
    const pendingEmails = accountsResult.rows.reduce((sum, a) => sum + parseInt(a.pending_emails), 0);
    
    res.json({
      success: true,
      status: {
        total_accounts: totalAccounts,
        active_accounts: activeAccounts,
        total_emails: totalEmails,
        pending_emails: pendingEmails,
        last_sync: accountsResult.rows.length > 0 ? 
          Math.max(...accountsResult.rows.map(a => new Date(a.last_sync_at || 0).getTime())) : null
      },
      accounts: accountsResult.rows,
      recent_metrics: metricsResult.rows
    });
    
  } catch (error) {
    logger.error('Error getting sync status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status'
    });
  }
});

/**
 * Trigger manual sync for all accounts
 */
router.post('/trigger', async (req, res) => {
  try {
    const { maxEmails = 100 } = req.body;
    
    logger.info('Manual sync triggered via API', { maxEmails });
    
    // Start sync in background
    const syncPromise = emailService.syncAllAccounts({ maxEmails });
    
    // Don't wait for completion, return immediately
    res.json({
      success: true,
      message: 'Email sync started',
      maxEmails,
      note: 'Sync is running in background. Check /api/sync/status for progress.'
    });
    
    // Handle sync completion/failure in background
    syncPromise
      .then(result => {
        logger.info('Manual sync completed via API', result);
      })
      .catch(error => {
        logger.error('Manual sync failed via API', error);
      });
    
  } catch (error) {
    logger.error('Error triggering manual sync:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger sync'
    });
  }
});

/**
 * Trigger sync for specific account
 */
router.post('/trigger/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { maxEmails = 100 } = req.body;
    
    logger.info('Manual account sync triggered via API', { accountId, maxEmails });
    
    // Get account info first
    const account = await emailService.getAccount(accountId);
    
    // Start sync in background
    const syncPromise = emailService.syncAccount(accountId, { maxEmails });
    
    // Don't wait for completion, return immediately
    res.json({
      success: true,
      message: `Email sync started for ${account.email_address}`,
      accountId,
      maxEmails,
      note: 'Sync is running in background. Check /api/sync/status for progress.'
    });
    
    // Handle sync completion/failure in background
    syncPromise
      .then(result => {
        logger.info('Manual account sync completed via API', { accountId, result });
      })
      .catch(error => {
        logger.error('Manual account sync failed via API', { accountId, error: error.message });
      });
    
  } catch (error) {
    logger.error('Error triggering account sync:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to trigger account sync'
    });
  }
});

/**
 * Test account connection
 */
router.post('/test/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    logger.info('Testing account connection via API', { accountId });
    
    const testResult = await emailService.testAccountConnection(accountId);
    
    res.json({
      success: true,
      accountId,
      connectionTest: testResult
    });
    
  } catch (error) {
    logger.error('Error testing account connection:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to test connection'
    });
  }
});

/**
 * Get sync history/logs
 */
router.get('/history', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const db = require('../config/database');
    
    const query = `
      SELECT 
        metric_name, metric_value, metadata, created_at
      FROM system_metrics 
      WHERE metric_name LIKE '%sync%' OR metric_name LIKE '%email%'
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `;
    
    const result = await db.query(query, [parseInt(limit), parseInt(offset)]);
    
    // Parse metadata for better display
    const history = result.rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    }));
    
    res.json({
      success: true,
      history,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: result.rows.length
      }
    });
    
  } catch (error) {
    logger.error('Error getting sync history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync history'
    });
  }
});

/**
 * Force refresh account tokens
 */
router.post('/refresh/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    logger.info('Refreshing account tokens via API', { accountId });
    
    const account = await emailService.refreshAccountToken(accountId);
    
    res.json({
      success: true,
      message: `Tokens refreshed for ${account.email_address}`,
      accountId,
      tokenExpiresAt: account.token_expires_at
    });
    
  } catch (error) {
    logger.error('Error refreshing account tokens:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to refresh tokens'
    });
  }
});

/**
 * Trigger FAQ generation for unprocessed emails
 */
router.post('/process-faqs', async (req, res) => {
  try {
    const { limit = 100, accountId = null } = req.body;
    
    logger.info('FAQ processing triggered via API', { limit, accountId });
    
    // Import services here to avoid circular dependencies
    const EmailService = require('../services/emailService');
    const AIService = require('../services/aiService');
    const FAQService = require('../services/faqService');
    const db = require('../config/database');
    
    const emailService = new EmailService();
    const aiService = new AIService();
    const faqService = new FAQService();
    
    // Get unprocessed emails
    let whereClause = 'WHERE e.is_processed = false';
    let queryParams = [];
    let paramIndex = 1;
    
    if (accountId) {
      whereClause += ` AND e.account_id = $${paramIndex++}`;
      queryParams.push(accountId);
    }
    
    const query = `
      SELECT e.*, ea.email_address, ea.provider
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      ${whereClause}
      ORDER BY e.received_at DESC
      LIMIT $${paramIndex}
    `;
    queryParams.push(limit);
    
    const emailsResult = await db.query(query, queryParams);
    const emails = emailsResult.rows;
    
    if (emails.length === 0) {
      return res.json({
        success: true,
        message: 'No unprocessed emails found',
        processed: 0,
        questionsFound: 0
      });
    }
    
    // Start processing in background
    const processingPromise = processEmailsForFAQs(emails, aiService, emailService, faqService, req.io);
    
    // Don't wait for completion, return immediately
    res.json({
      success: true,
      message: `Started processing ${emails.length} emails`,
      emailCount: emails.length,
      note: 'Processing is running in background. Check status for progress.'
    });
    
    // Handle processing completion/failure in background
    processingPromise
      .then(result => {
        logger.info('FAQ processing completed via API', result);
        if (req.io) {
          req.io.emit('faq_processing_complete', result);
        }
      })
      .catch(error => {
        logger.error('FAQ processing failed via API', error);
        if (req.io) {
          req.io.emit('faq_processing_error', { error: error.message });
        }
      });
    
  } catch (error) {
    logger.error('Error triggering FAQ processing:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to trigger FAQ processing'
    });
  }
});

/**
 * Get FAQ processing status
 */
router.get('/faq-status', async (req, res) => {
  try {
    const db = require('../config/database');
    
    // Get processing statistics
    const statsQuery = `
      SELECT
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE is_processed = true) as processed_emails,
        COUNT(*) FILTER (WHERE is_processed = false) as pending_emails
      FROM emails
    `;
    
    const questionsQuery = `
      SELECT COUNT(*) as total_questions FROM questions
    `;
    
    const faqsQuery = `
      SELECT COUNT(*) as total_faqs FROM faq_groups
    `;
    
    const [statsResult, questionsResult, faqsResult] = await Promise.all([
      db.query(statsQuery),
      db.query(questionsQuery),
      db.query(faqsQuery)
    ]);
    
    const stats = statsResult.rows[0];
    const questionCount = questionsResult.rows[0].total_questions;
    const faqCount = faqsResult.rows[0].total_faqs;
    
    res.json({
      success: true,
      status: {
        total_emails: parseInt(stats.total_emails),
        processed_emails: parseInt(stats.processed_emails),
        pending_emails: parseInt(stats.pending_emails),
        total_questions: parseInt(questionCount),
        total_faqs: parseInt(faqCount),
        processing_progress: stats.total_emails > 0 ?
          Math.round((stats.processed_emails / stats.total_emails) * 100) : 0
      }
    });
    
  } catch (error) {
    logger.error('Error getting FAQ processing status:', error);
    
    // Return safe defaults if database queries fail
    res.status(200).json({
      success: true,
      status: {
        total_emails: 0,
        processed_emails: 0,
        pending_emails: 0,
        total_questions: 0,
        total_faqs: 0,
        processing_progress: 0,
        error: 'Unable to fetch current status'
      }
    });
  }
});

/**
 * Process emails for FAQs (background function)
 */
async function processEmailsForFAQs(emails, aiService, emailService, faqService, io) {
  let processedCount = 0;
  let questionsFound = 0;
  let errors = 0;
  
  // Add memory monitoring
  const startMemory = process.memoryUsage();
  logger.info(`Starting email processing. Initial memory: ${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`);
  
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    
    try {
      // Memory check every 10 emails
      if (i % 10 === 0) {
        const currentMemory = process.memoryUsage();
        const memoryUsedMB = Math.round(currentMemory.heapUsed / 1024 / 1024);
        logger.info(`Processing email ${i + 1}/${emails.length}. Memory: ${memoryUsedMB}MB`);
        
        // If memory usage is too high, force garbage collection
        if (memoryUsedMB > 800) {
          if (global.gc) {
            global.gc();
            logger.info('Forced garbage collection');
          }
        }
        
        // If memory is critically high, stop processing
        if (memoryUsedMB > 900) {
          logger.error('Memory usage too high, stopping email processing');
          break;
        }
      }
      // Emit progress update every 5 emails
      if (io && i % 5 === 0) {
        io.emit('faq_processing_progress', {
          current: i + 1,
          total: emails.length,
          processed: processedCount,
          questions: questionsFound,
          errors: errors,
          currentEmail: email.subject
        });
      }
      
      // Detect questions from email using AI with timeout
      const result = await Promise.race([
        aiService.detectQuestions(
          email.body_text || email.body_html || '',
          email.subject || ''
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI processing timeout')), 30000)
        )
      ]);
      
      if (result && result.hasQuestions && result.questions && result.questions.length > 0) {
        // Store questions in database
        for (const question of result.questions) {
          try {
            const db = require('../config/database');
            const questionQuery = `
              INSERT INTO questions (
                email_id, question_text, answer_text, confidence_score,
                is_customer_question, created_at
              ) VALUES ($1, $2, $3, $4, $5, NOW())
              RETURNING id
            `;
            
            await db.query(questionQuery, [
              email.id,
              question.question,
              question.answer || '',
              question.confidence || 0.8,
              true
            ]);
            
            questionsFound++;
          } catch (questionError) {
            logger.warn(`Failed to store question for email ${email.id}:`, questionError);
          }
        }
      }
      
      // Mark email as processed
      await emailService.markEmailProcessed(email.id, 'completed');
      processedCount++;
      
    } catch (processError) {
      logger.error(`Error processing email ${email.id}:`, processError);
      await emailService.markEmailProcessed(email.id, 'failed', processError.message);
      errors++;
    }
  }
  
  // Generate FAQ groups
  let faqResult = { groupsCreated: 0, questionsGrouped: 0 };
  try {
    faqResult = await faqService.generateFAQs();
  } catch (faqError) {
    logger.error('FAQ generation failed:', faqError);
  }
  
  const result = {
    processed: processedCount,
    questionsFound: questionsFound,
    errors: errors,
    faqGroupsCreated: faqResult.groupsCreated || 0,
    questionsGrouped: faqResult.questionsGrouped || 0
  };
  
  // Emit final completion
  if (io) {
    io.emit('faq_processing_complete', result);
  }
  
  return result;
}

module.exports = router;