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
    
    // Get filtered emails for processing (only valid conversation emails)
    const emails = await emailService.getEmailsForProcessing(limit, 0);
    
    // If accountId is specified, filter further
    const filteredEmails = accountId
      ? emails.filter(email => email.account_id === accountId)
      : emails;
    
    if (filteredEmails.length === 0) {
      return res.json({
        success: true,
        message: 'No valid emails found for processing (all emails filtered out or already processed)',
        processed: 0,
        questionsFound: 0
      });
    }
    
    // Start processing in background
    const processingPromise = processEmailsForFAQs(filteredEmails, aiService, emailService, faqService, req.io);
    
    // Don't wait for completion, return immediately
    res.json({
      success: true,
      message: `Started processing ${filteredEmails.length} filtered emails (${emails.length - filteredEmails.length} emails filtered out)`,
      emailCount: filteredEmails.length,
      totalEmails: emails.length,
      filteredOut: emails.length - filteredEmails.length,
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
 * Get FAQ processing status - uses same filtering logic as statistics
 */
router.get('/faq-status', async (req, res) => {
  try {
    const db = require('../config/database');
    
    // Get processing statistics using the same filtering logic as the statistics endpoint
    const statsQuery = `
      WITH connected_emails AS (
        SELECT DISTINCT ea.email_address
        FROM email_accounts ea
        WHERE ea.status = 'active'
      ),
      conversation_threads AS (
        SELECT DISTINCT e1.thread_id
        FROM emails e1
        JOIN emails e2 ON e1.thread_id = e2.thread_id
        JOIN connected_emails ce ON e2.sender_email = ce.email_address
        WHERE e1.thread_id IS NOT NULL
          AND e1.thread_id != ''
          AND e1.sender_email != e2.sender_email
      ),
      email_stats AS (
        SELECT
          COUNT(*) as total_emails,
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
        JOIN email_accounts ea ON e.account_id = ea.id
      )
      SELECT * FROM email_stats
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
        pending_emails: parseInt(stats.valid_for_processing), // Use filtered pending count
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
 * Process a single email with timeout to prevent hanging
 */
async function processEmailWithTimeout(email, aiService, timeout = 30000) {
  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Email processing timeout after ${timeout}ms`));
    }, timeout);

    try {
      // Limit email content size to prevent memory issues
      const limitedEmail = {
        ...email,
        body_text: email.body_text ? email.body_text.substring(0, 10000) : '',
        body_html: email.body_html ? email.body_html.substring(0, 10000) : '',
        subject: email.subject ? email.subject.substring(0, 500) : ''
      };

      const result = await aiService.detectQuestions(
        limitedEmail.body_text || limitedEmail.body_html || '',
        limitedEmail.subject || '',
        [] // No thread emails for now to reduce complexity
      );

      clearTimeout(timeoutId);
      resolve({
        success: true,
        questions: result.questions || [],
        confidence: result.overallConfidence || 0
      });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

/**
 * Process emails for FAQs (background function) - Ultra-conservative with circuit breaker
 */
async function processEmailsForFAQs(emails, aiService, emailService, faqService, io) {
  let processedCount = 0;
  let questionsFound = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 15; // Increased from 5 to 15 - more resilient
  
  // Add memory monitoring
  const startMemory = process.memoryUsage();
  logger.info(`Starting optimized email processing. Initial memory: ${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`);
  
  // More balanced batch size - increased from 1 to 3 for better throughput
  const batchSize = parseInt(process.env.EMAIL_BATCH_SIZE) || 3;
  const totalBatches = Math.ceil(emails.length / batchSize);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    // Circuit breaker: stop processing if too many consecutive errors
    if (consecutiveErrors >= maxConsecutiveErrors) {
      logger.error(`Circuit breaker triggered: ${consecutiveErrors} consecutive errors. Stopping processing to prevent server crash.`);
      if (io) {
        io.emit('faq_processing_error', {
          error: `Processing stopped due to ${consecutiveErrors} consecutive errors to prevent server crash`
        });
      }
      break;
    }
    
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, emails.length);
    const emailBatch = emails.slice(batchStart, batchEnd);
    
    logger.info(`Processing batch ${batchIndex + 1}/${totalBatches} (${emailBatch.length} emails) - Consecutive errors: ${consecutiveErrors}`);
    
    try {
      // Process emails sequentially instead of concurrently to reduce memory pressure
      const batchResults = [];
      for (const email of emailBatch) {
        try {
          const result = await processEmailWithTimeout(email, aiService);
          batchResults.push({ status: 'fulfilled', value: result });
          consecutiveErrors = 0; // Reset on success
        } catch (error) {
          logger.error(`Error processing email ${email.id}:`, error.message);
          batchResults.push({ status: 'rejected', reason: error });
          consecutiveErrors++;
          
          // Skip problematic emails after 3 attempts
          if (consecutiveErrors >= 3) {
            logger.warn(`Skipping problematic email ${email.id} after 3 consecutive errors to prevent system crash`);
            // Mark as failed and continue
            try {
              await emailService.markEmailProcessed(email.id, 'failed', `Skipped after 3 consecutive errors: ${error.message}`);
            } catch (markError) {
              logger.error(`Failed to mark email ${email.id} as failed:`, markError.message);
            }
          }
        }
        
        // Reduced delay between emails for better throughput
        await new Promise(resolve => setTimeout(resolve, 200)); // Reduced from 1000ms to 200ms
      }
      
      // Collect all questions from successful results
      const allQuestions = [];
      const emailUpdates = [];
      
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const email = emailBatch[i];
        
        if (result.status === 'fulfilled' && result.value.success) {
          const { questions } = result.value;
          
          // Get connected email addresses to filter out business questions
          const db = require('../config/database');
          const connectedEmailsQuery = 'SELECT email_address FROM email_accounts WHERE status = $1';
          const connectedEmailsResult = await db.query(connectedEmailsQuery, ['active']);
          const connectedEmails = connectedEmailsResult.rows.map(row => row.email_address.toLowerCase());
          
          // Filter out questions from connected email accounts (business emails)
          const customerQuestions = questions.filter(question => {
            // Check if the email sender is from a connected account
            const senderEmail = email.sender_email?.toLowerCase() || '';
            const isFromConnectedAccount = connectedEmails.some(connectedEmail =>
              senderEmail.includes(connectedEmail.toLowerCase())
            );
            
            // Only include questions from external customers, not from business accounts
            return !isFromConnectedAccount && question.isFromCustomer !== false;
          });
          
          // Add email context to filtered customer questions
          customerQuestions.forEach(question => {
            allQuestions.push({
              email_id: email.id,
              question_text: question.question,
              answer_text: question.answer || '',
              confidence_score: question.confidence || 0.8,
              is_customer_question: true,
              sender_email: email.sender_email,
              sender_name: email.sender_name,
              email_subject: email.subject,
              received_at: email.received_at
            });
          });
          
          emailUpdates.push({ id: email.id, status: 'completed', error: null });
          processedCount++;
          questionsFound += questions.length;
          consecutiveErrors = 0; // Reset consecutive errors on success
        } else {
          const errorMsg = result.status === 'rejected' ? result.reason.message : 'Processing failed';
          emailUpdates.push({ id: email.id, status: 'failed', error: errorMsg });
          logger.error(`Error processing email ${email.id}:`, errorMsg);
          errors++;
          consecutiveErrors++; // Increment consecutive errors
        }
      }
      
      // Generate embeddings and batch insert questions if any were found
      if (allQuestions.length > 0) {
        await batchInsertQuestionsWithEmbeddings(allQuestions, aiService);
      }
      
      // Batch update email statuses
      await batchUpdateEmailStatuses(emailUpdates, emailService);
      
      // Enhanced memory management and progress reporting
      const currentMemory = process.memoryUsage();
      const memoryUsedMB = Math.round(currentMemory.heapUsed / 1024 / 1024);
      logger.info(`Batch ${batchIndex + 1}/${totalBatches} completed. Memory: ${memoryUsedMB}MB, Processed: ${processedCount}, Questions: ${questionsFound}, Errors: ${errors}`);
      
      // Force garbage collection more aggressively to prevent memory issues
      if (memoryUsedMB > 400 && global.gc) {
        global.gc();
        const afterGC = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        logger.info(`Forced garbage collection: ${memoryUsedMB}MB -> ${afterGC}MB`);
      }
      
      // Emit progress update after every batch
      if (io) {
        io.emit('faq_processing_progress', {
          current: batchEnd,
          total: emails.length,
          processed: processedCount,
          questions: questionsFound,
          errors: errors,
          currentBatch: batchIndex + 1,
          totalBatches: totalBatches,
          memoryUsage: memoryUsedMB
        });
      }
      
      // Optimized pause between batches
      if (batchIndex < totalBatches - 1) { // Don't pause after the last batch
        await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 2000ms to 500ms
      }
      
    } catch (batchError) {
      logger.error(`Error processing batch ${batchIndex + 1}:`, batchError);
      
      // Mark all emails in failed batch as failed
      for (const email of emailBatch) {
        try {
          await emailService.markEmailProcessed(email.id, 'failed', batchError.message);
          errors++;
        } catch (updateError) {
          logger.error(`Failed to mark email ${email.id} as failed:`, updateError);
        }
      }
    }
  }
  
  // Generate FAQ groups with better error handling
  let faqResult = { groupsCreated: 0, questionsGrouped: 0 };
  try {
    logger.info('Starting FAQ generation process...');
    faqResult = await faqService.generateFAQs();
    logger.info(`FAQ generation completed: ${faqResult.generated || 0} generated, ${faqResult.updated || 0} updated`);
  } catch (faqError) {
    logger.error('FAQ generation failed:', faqError);
    
    // Check if it's a database function error
    if (faqError.message && faqError.message.includes('update_faq_group_stats')) {
      logger.error('❌ Missing database function: update_faq_group_stats - Run migration: npm run migrate');
      if (io) {
        io.emit('faq_processing_error', {
          error: 'Database migration required: Missing update_faq_group_stats function. Please run: npm run migrate'
        });
      }
    }
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

/**
 * Process a single email with timeout - optimized version
 */
async function processEmailWithTimeout(email, aiService) {
  try {
    // Reduce timeout to 10s to prevent long-running processes that crash the server
    const timeoutMs = 10000;
    
    const result = await Promise.race([
      aiService.detectQuestions(
        // Limit email content size to prevent memory issues
        (email.body_text || email.body_html || '').substring(0, 8000), // Reduced from 10000
        (email.subject || '').substring(0, 500) // Limit subject length too
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI processing timeout after 15s')), timeoutMs)
      )
    ]);
    
    return {
      success: true,
      questions: result && result.hasQuestions ? result.questions : []
    };
  } catch (error) {
    // Log error but don't let it crash the batch
    logger.error(`Error processing email ${email.id}:`, error.message);
    return {
      success: false,
      error: error.message,
      questions: []
    };
  }
}

/**
 * Batch insert questions into database
 */
async function batchInsertQuestions(questions) {
  if (questions.length === 0) return;
  
  try {
    const db = require('../config/database');
    
    // Build batch insert query
    const values = [];
    const placeholders = [];
    
    questions.forEach((question, index) => {
      const baseIndex = index * 5;
      placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`);
      values.push(
        question.email_id,
        question.question_text,
        question.answer_text,
        question.confidence_score,
        question.is_customer_question
      );
    });
    
    const query = `
      INSERT INTO questions (
        email_id, question_text, answer_text, confidence_score, is_customer_question
      ) VALUES ${placeholders.join(', ')}
    `;
    
    await db.query(query, values);
    logger.info(`Batch inserted ${questions.length} questions`);
    
  } catch (error) {
    logger.error('Error in batch insert questions:', error);
    
    // Fallback to individual inserts if batch fails
    for (const question of questions) {
      try {
        const db = require('../config/database');
        await db.query(`
          INSERT INTO questions (
            email_id, question_text, answer_text, confidence_score, is_customer_question
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          question.email_id,
          question.question_text,
          question.answer_text,
          question.confidence_score,
          question.is_customer_question
        ]);
      } catch (individualError) {
        logger.warn(`Failed to insert individual question:`, individualError);
      }
    }
  }
}

/**
 * Batch insert questions with embeddings
 */
async function batchInsertQuestionsWithEmbeddings(questions, aiService) {
  if (questions.length === 0) return;
  
  try {
    const db = require('../config/database');
    
    // Generate embeddings for all questions in batch
    const questionTexts = questions.map(q => q.question_text);
    let embeddings = [];
    
    try {
      embeddings = await aiService.generateEmbeddingsBatch(questionTexts);
      logger.info(`Generated ${embeddings.length} embeddings for questions`);
    } catch (embeddingError) {
      logger.warn('Batch embedding generation failed, falling back to individual:', embeddingError);
      // Fallback to individual embedding generation
      embeddings = await Promise.allSettled(
        questionTexts.map(text => aiService.generateEmbedding(text))
      );
      embeddings = embeddings.map(result =>
        result.status === 'fulfilled' ? result.value : null
      );
    }
    
    // Build batch insert query with embeddings
    const values = [];
    const placeholders = [];
    
    questions.forEach((question, index) => {
      const baseIndex = index * 9;
      placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9})`);
      values.push(
        question.email_id,
        question.question_text,
        question.answer_text,
        question.confidence_score,
        question.is_customer_question,
        embeddings[index] ? JSON.stringify(embeddings[index]) : null,
        question.sender_email || null,
        question.sender_name || null,
        question.email_subject || null
      );
    });
    
    const query = `
      INSERT INTO questions (
        email_id, question_text, answer_text, confidence_score, is_customer_question, embedding, sender_email, sender_name, email_subject
      ) VALUES ${placeholders.join(', ')}
    `;
    
    await db.query(query, values);
    logger.info(`Batch inserted ${questions.length} questions with embeddings`);
    
  } catch (error) {
    logger.error('Error in batch insert questions with embeddings:', error);
    
    // Fallback to individual inserts without embeddings
    for (const question of questions) {
      try {
        const db = require('../config/database');
        await db.query(`
          INSERT INTO questions (
            email_id, question_text, answer_text, confidence_score, is_customer_question
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          question.email_id,
          question.question_text,
          question.answer_text,
          question.confidence_score,
          question.is_customer_question
        ]);
      } catch (individualError) {
        logger.warn(`Failed to insert individual question:`, individualError);
      }
    }
  }
}

/**
 * Batch update email processing statuses
 */
async function batchUpdateEmailStatuses(emailUpdates, emailService) {
  if (emailUpdates.length === 0) return;
  
  try {
    // Process updates concurrently but with limited concurrency
    const concurrency = 3;
    for (let i = 0; i < emailUpdates.length; i += concurrency) {
      const batch = emailUpdates.slice(i, i + concurrency);
      await Promise.allSettled(
        batch.map(update =>
          emailService.markEmailProcessed(update.id, update.status, update.error)
        )
      );
    }
    
    logger.info(`Batch updated ${emailUpdates.length} email statuses`);
    
  } catch (error) {
    logger.error('Error in batch update email statuses:', error);
  }
}

module.exports = router;