const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EmailService = require('../services/emailService');
const AIService = require('../services/aiService');

const emailService = new EmailService();
const aiService = new AIService();

/**
 * Get emails with pagination and filtering
 */
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      accountId = null,
      processed = null,
      search = null,
      sortBy = 'received_at',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    // Build WHERE conditions
    if (accountId) {
      whereConditions.push(`e.account_id = $${paramIndex++}`);
      queryParams.push(accountId);
    }

    if (processed !== null) {
      whereConditions.push(`e.is_processed = $${paramIndex++}`);
      queryParams.push(processed === 'true');
    }

    if (search) {
      whereConditions.push(`(
        to_tsvector('english', COALESCE(e.subject, '') || ' ' || COALESCE(e.body_text, '')) 
        @@ plainto_tsquery('english', $${paramIndex++})
      )`);
      queryParams.push(search);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        e.id, e.subject, e.sender_email, e.sender_name, e.received_at,
        e.is_processed, e.processing_status, e.created_at,
        ea.email_address as account_email, ea.provider,
        COUNT(q.id) as question_count
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      LEFT JOIN questions q ON e.id = q.email_id
      ${whereClause}
      GROUP BY e.id, ea.email_address, ea.provider
      ORDER BY e.${sortBy} ${sortOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    queryParams.push(parseInt(limit), offset);

    const db = require('../config/database');
    const result = await db.query(query, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT e.id) as total
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      ${whereClause}
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
    logger.error('Error getting emails:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get emails'
    });
  }
});

/**
 * Get email by ID
 */
router.get('/:emailId', async (req, res) => {
  try {
    const { emailId } = req.params;

    const query = `
      SELECT 
        e.*,
        ea.email_address as account_email,
        ea.provider,
        ea.display_name as account_display_name
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      WHERE e.id = $1
    `;

    const db = require('../config/database');
    const result = await db.query(query, [emailId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }

    const email = result.rows[0];

    // Get questions for this email
    const questionsQuery = `
      SELECT 
        id, question_text, answer_text, confidence_score,
        is_customer_question, position_in_email, created_at
      FROM questions
      WHERE email_id = $1
      ORDER BY position_in_email ASC, confidence_score DESC
    `;

    const questionsResult = await db.query(questionsQuery, [emailId]);

    res.json({
      success: true,
      email: {
        ...email,
        questions: questionsResult.rows
      }
    });

  } catch (error) {
    logger.error(`Error getting email ${req.params.emailId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get email'
    });
  }
});

/**
 * Process email for question detection with conversation context
 */
router.post('/:emailId/process', async (req, res) => {
  try {
    const { emailId } = req.params;
    const { forceReprocess = false } = req.body;

    // Get email details
    const emailQuery = 'SELECT * FROM emails WHERE id = $1';
    const db = require('../config/database');
    const emailResult = await db.query(emailQuery, [emailId]);

    if (emailResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }

    const email = emailResult.rows[0];

    // Check if already processed
    if (email.is_processed && !forceReprocess) {
      return res.status(400).json({
        success: false,
        error: 'Email already processed. Use forceReprocess=true to reprocess.'
      });
    }

    // Get conversation thread context if available
    let threadEmails = [];
    if (email.thread_id) {
      const threadQuery = `
        SELECT id, sender_email, subject, body_text, sent_at
        FROM emails
        WHERE thread_id = $1 AND id != $2
        ORDER BY sent_at ASC
      `;
      const threadResult = await db.query(threadQuery, [email.thread_id, emailId]);
      threadEmails = threadResult.rows;
    }

    // Mark as processing
    await emailService.markEmailProcessed(emailId, 'processing');

    try {
      // Detect questions using AI with conversation context
      const detection = await aiService.detectQuestions(
        email.body_text || '',
        email.subject || '',
        threadEmails
      );

      if (detection.hasQuestions && detection.questions.length > 0) {
        // Store detected questions
        for (let i = 0; i < detection.questions.length; i++) {
          const question = detection.questions[i];

          // Generate embedding for the question
          const embedding = await aiService.generateEmbedding(question.question);

          const insertQuery = `
            INSERT INTO questions (
              email_id, question_text, answer_text, context_before, context_after,
              confidence_score, position_in_email, embedding, is_customer_question,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (email_id, question_text) DO NOTHING
          `;

          await db.query(insertQuery, [
            emailId,
            question.question,
            question.answer || null,
            question.context || '',
            '',
            question.confidence,
            i + 1,
            JSON.stringify(embedding),
            true
          ]);
        }
      }

      // Mark as completed
      await emailService.markEmailProcessed(emailId, 'completed');

      res.json({
        success: true,
        result: {
          emailId,
          questionsDetected: detection.questions.length,
          confidence: detection.overallConfidence,
          reasoning: detection.reasoning,
          threadContext: threadEmails.length > 0 ? `Used ${threadEmails.length} thread emails for context` : 'No thread context available'
        }
      });

    } catch (processingError) {
      // Mark as failed
      await emailService.markEmailProcessed(emailId, 'failed', processingError.message);
      throw processingError;
    }

  } catch (error) {
    logger.error(`Error processing email ${req.params.emailId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Bulk process emails
 */
router.post('/bulk/process', async (req, res) => {
  try {
    const { emailIds, forceReprocess = false } = req.body;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Email IDs array is required'
      });
    }

    const results = [];
    let processed = 0;
    let failed = 0;

    for (const emailId of emailIds) {
      try {
        // Process each email (simplified version of single email processing)
        const db = require('../config/database');
        const emailResult = await db.query('SELECT * FROM emails WHERE id = $1', [emailId]);

        if (emailResult.rows.length === 0) {
          results.push({ emailId, success: false, error: 'Email not found' });
          failed++;
          continue;
        }

        const email = emailResult.rows[0];

        if (email.is_processed && !forceReprocess) {
          results.push({ emailId, success: false, error: 'Already processed' });
          continue;
        }

        await emailService.markEmailProcessed(emailId, 'processing');

        // Get conversation thread context if available
        let threadEmails = [];
        if (email.thread_id) {
          const threadQuery = `
            SELECT id, sender_email, subject, body_text, sent_at
            FROM emails
            WHERE thread_id = $1 AND id != $2
            ORDER BY sent_at ASC
          `;
          const threadResult = await db.query(threadQuery, [email.thread_id, emailId]);
          threadEmails = threadResult.rows;
        }

        const detection = await aiService.detectQuestions(
          email.body_text || '',
          email.subject || '',
          threadEmails
        );

        if (detection.hasQuestions && detection.questions.length > 0) {
          for (let i = 0; i < detection.questions.length; i++) {
            const question = detection.questions[i];
            const embedding = await aiService.generateEmbedding(question.question);

            const insertQuery = `
              INSERT INTO questions (
                email_id, question_text, answer_text, confidence_score,
                position_in_email, embedding, is_customer_question, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
              ON CONFLICT (email_id, question_text) DO NOTHING
            `;

            await db.query(insertQuery, [
              emailId,
              question.question,
              question.answer || null,
              question.confidence,
              i + 1,
              JSON.stringify(embedding),
              true
            ]);
          }
        }

        await emailService.markEmailProcessed(emailId, 'completed');

        results.push({
          emailId,
          success: true,
          questionsDetected: detection.questions.length
        });
        processed++;

      } catch (error) {
        await emailService.markEmailProcessed(emailId, 'failed', error.message);
        results.push({ emailId, success: false, error: error.message });
        failed++;
      }
    }

    res.json({
      success: true,
      summary: {
        total: emailIds.length,
        processed,
        failed
      },
      results
    });

  } catch (error) {
    logger.error('Error bulk processing emails:', error);
    res.status(500).json({
      success: false,
      error: 'Bulk processing failed'
    });
  }
});

/**
 * Get unprocessed emails
 */
router.get('/unprocessed/list', async (req, res) => {
  try {
    const { limit = 100, accountId = null } = req.query;

    let whereCondition = 'WHERE e.is_processed = false';
    let queryParams = [parseInt(limit)];
    let paramIndex = 2;

    if (accountId) {
      whereCondition += ` AND e.account_id = $${paramIndex++}`;
      queryParams.push(accountId);
    }

    const query = `
      SELECT 
        e.id, e.subject, e.sender_email, e.received_at,
        ea.email_address as account_email, ea.provider
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      ${whereCondition}
      ORDER BY e.received_at DESC
      LIMIT $1
    `;

    const db = require('../config/database');
    const result = await db.query(query, queryParams);

    res.json({
      success: true,
      emails: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('Error getting unprocessed emails:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get unprocessed emails'
    });
  }
});

/**
 * Get email processing statistics
 */
router.get('/stats/processing', async (req, res) => {
  try {
    const { accountId = null } = req.query;

    let whereCondition = '';
    let queryParams = [];
    let paramIndex = 1;

    if (accountId) {
      whereCondition = 'WHERE account_id = $1';
      queryParams.push(accountId);
    }

    const query = `
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE is_processed = true) as processed_emails,
        COUNT(*) FILTER (WHERE is_processed = false) as pending_emails,
        COUNT(*) FILTER (WHERE processing_status = 'processing') as currently_processing,
        COUNT(*) FILTER (WHERE processing_status = 'failed') as failed_emails,
        AVG(
          CASE WHEN is_processed = true 
          THEN EXTRACT(EPOCH FROM (updated_at - created_at))
          ELSE NULL END
        ) as avg_processing_time_seconds
      FROM emails
      ${whereCondition}
    `;

    const db = require('../config/database');
    const result = await db.query(query, queryParams);

    const stats = result.rows[0];
    
    // Convert processing time to minutes
    if (stats.avg_processing_time_seconds) {
      stats.avg_processing_time_minutes = Math.round(stats.avg_processing_time_seconds / 60 * 100) / 100;
    }

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error('Error getting processing stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get processing statistics'
    });
  }
});

/**
 * Get email filtering statistics
 */
router.get('/stats/filtering', async (req, res) => {
  try {
    const { accountId = null } = req.query;

    let whereCondition = '';
    let queryParams = [];
    let paramIndex = 1;

    if (accountId) {
      whereCondition = 'WHERE e.account_id = $1';
      queryParams.push(accountId);
      paramIndex++;
    }

    const query = `
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
        JOIN email_accounts ea ON e.account_id = ea.id
        ${whereCondition}
      )
      SELECT
        *,
        CAST(ROUND((conversation_emails::NUMERIC / NULLIF(total_emails, 0)) * 100, 2) AS NUMERIC(5,2)) as conversation_percentage,
        CAST(ROUND((valid_for_processing::NUMERIC / NULLIF(pending_emails, 0)) * 100, 2) AS NUMERIC(5,2)) as valid_processing_percentage
      FROM email_stats
    `;

    const db = require('../config/database');
    const result = await db.query(query, queryParams);

    const stats = result.rows[0];

    res.json({
      success: true,
      stats: {
        total_emails: parseInt(stats.total_emails),
        conversation_emails: parseInt(stats.conversation_emails),
        standalone_emails: parseInt(stats.standalone_emails),
        processed_emails: parseInt(stats.processed_emails),
        pending_emails: parseInt(stats.pending_emails),
        valid_for_processing: parseInt(stats.valid_for_processing),
        conversation_percentage: parseFloat(stats.conversation_percentage) || 0,
        valid_processing_percentage: parseFloat(stats.valid_processing_percentage) || 0,
        filtering_impact: {
          emails_filtered_out: parseInt(stats.pending_emails) - parseInt(stats.valid_for_processing),
          spam_reduction_percentage: stats.pending_emails > 0 ?
            Math.round(((parseInt(stats.pending_emails) - parseInt(stats.valid_for_processing)) / parseInt(stats.pending_emails)) * 100) : 0
        }
      }
    });

  } catch (error) {
    logger.error('Error getting filtering stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get filtering statistics'
    });
  }
});

/**
 * Delete email and associated questions
 */
router.delete('/:emailId', async (req, res) => {
  try {
    const { emailId } = req.params;

    const db = require('../config/database');

    await db.transaction(async (client) => {
      // Delete questions first (due to foreign key constraints)
      await client.query('DELETE FROM questions WHERE email_id = $1', [emailId]);
      
      // Delete email
      const result = await client.query('DELETE FROM emails WHERE id = $1 RETURNING subject', [emailId]);
      
      if (result.rows.length === 0) {
        throw new Error('Email not found');
      }
    });

    res.json({
      success: true,
      message: 'Email deleted successfully'
    });

  } catch (error) {
    logger.error(`Error deleting email ${req.params.emailId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Search emails
 */
router.get('/search/query', async (req, res) => {
  try {
    const { q, limit = 20, accountId = null } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    let whereConditions = [`(
      to_tsvector('english', COALESCE(e.subject, '') || ' ' || COALESCE(e.body_text, '')) 
      @@ plainto_tsquery('english', $1)
    )`];
    let queryParams = [q];
    let paramIndex = 2;

    if (accountId) {
      whereConditions.push(`e.account_id = $${paramIndex++}`);
      queryParams.push(accountId);
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT 
        e.id, e.subject, e.sender_email, e.sender_name, e.received_at,
        e.is_processed, ea.email_address as account_email,
        ts_headline('english', COALESCE(e.subject, ''), plainto_tsquery('english', $1)) as highlighted_subject,
        ts_headline('english', COALESCE(e.body_text, ''), plainto_tsquery('english', $1)) as highlighted_body
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      WHERE ${whereClause}
      ORDER BY ts_rank(
        to_tsvector('english', COALESCE(e.subject, '') || ' ' || COALESCE(e.body_text, '')),
        plainto_tsquery('english', $1)
      ) DESC
      LIMIT $${paramIndex}
    `;

    queryParams.push(parseInt(limit));

    const db = require('../config/database');
    const result = await db.query(query, queryParams);

    res.json({
      success: true,
      query: q,
      results: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('Error searching emails:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

module.exports = router;