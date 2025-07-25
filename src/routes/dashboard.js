const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EmailService = require('../services/emailService');
const FAQService = require('../services/faqService');
const AIService = require('../services/aiService');
const SimilarityService = require('../services/similarityService');

const emailService = new EmailService();
const faqService = new FAQService();
const aiService = new AIService();
const similarityService = new SimilarityService();

/**
 * Get dashboard overview statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const db = require('../config/database');
    
    // Get account statistics
    const accountStatsQuery = `
      SELECT 
        COUNT(*) as total_accounts,
        COUNT(*) FILTER (WHERE status = 'active') as active_accounts,
        COUNT(*) FILTER (WHERE status = 'error') as error_accounts,
        COUNT(*) FILTER (WHERE last_sync_at IS NOT NULL) as synced_accounts
      FROM email_accounts
    `;
    const accountStats = await db.query(accountStatsQuery);
    
    // Get email statistics
    const emailStatsQuery = `
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE is_processed = true) as processed_emails,
        COUNT(*) FILTER (WHERE is_processed = false) as pending_emails,
        COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours') as emails_today,
        COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '7 days') as emails_this_week
      FROM emails
    `;
    const emailStats = await db.query(emailStatsQuery);
    
    // Get question statistics
    const questionStatsQuery = `
      SELECT 
        COUNT(*) as total_questions,
        COUNT(*) FILTER (WHERE is_customer_question = true) as customer_questions,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) as questions_with_embeddings,
        AVG(confidence_score) as avg_confidence,
        COUNT(*) FILTER (WHERE confidence_score >= 0.8) as high_confidence_questions
      FROM questions
    `;
    const questionStats = await db.query(questionStatsQuery);
    
    // Get FAQ statistics
    const faqStats = await faqService.getFAQStats();
    
    // Get processing job statistics
    const jobStatsQuery = `
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
        COUNT(*) FILTER (WHERE status = 'processing') as running_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as jobs_today
      FROM processing_jobs
    `;
    const jobStats = await db.query(jobStatsQuery);
    
    // Get recent activity
    const recentActivityQuery = `
      SELECT 
        'email_sync' as activity_type,
        'Email sync completed for ' || ea.email_address as description,
        pj.completed_at as timestamp
      FROM processing_jobs pj
      JOIN email_accounts ea ON pj.account_id = ea.id
      WHERE pj.job_type = 'email_sync' 
        AND pj.status = 'completed'
        AND pj.completed_at >= NOW() - INTERVAL '7 days'
      
      UNION ALL
      
      SELECT 
        'faq_created' as activity_type,
        'FAQ created: ' || title as description,
        created_at as timestamp
      FROM faq_groups
      WHERE created_at >= NOW() - INTERVAL '7 days'
      
      ORDER BY timestamp DESC
      LIMIT 10
    `;
    const recentActivity = await db.query(recentActivityQuery);
    
    res.json({
      success: true,
      stats: {
        accounts: accountStats.rows[0],
        emails: emailStats.rows[0],
        questions: questionStats.rows[0],
        faqs: faqStats,
        jobs: jobStats.rows[0]
      },
      recentActivity: recentActivity.rows
    });
    
  } catch (error) {
    logger.error('Error getting dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard statistics'
    });
  }
});

/**
 * Get processing status for all accounts
 */
router.get('/processing-status', async (req, res) => {
  try {
    const db = require('../config/database');
    
    const query = `
      SELECT 
        ea.id,
        ea.email_address,
        ea.provider,
        ea.status as account_status,
        ea.last_sync_at,
        pj.id as job_id,
        pj.job_type,
        pj.status as job_status,
        pj.progress,
        pj.total_items,
        pj.processed_items,
        pj.started_at,
        pj.error_message
      FROM email_accounts ea
      LEFT JOIN LATERAL (
        SELECT *
        FROM processing_jobs
        WHERE account_id = ea.id
        ORDER BY created_at DESC
        LIMIT 1
      ) pj ON true
      ORDER BY ea.created_at DESC
    `;
    
    const result = await db.query(query);
    
    res.json({
      success: true,
      accounts: result.rows
    });
    
  } catch (error) {
    logger.error('Error getting processing status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get processing status'
    });
  }
});

/**
 * Get system health status
 */
router.get('/health', async (req, res) => {
  try {
    const db = require('../config/database');
    const redisClient = require('../config/redis');
    
    const health = {
      timestamp: new Date().toISOString(),
      services: {}
    };
    
    // Check database
    try {
      await db.query('SELECT 1');
      health.services.database = { status: 'healthy', message: 'Connected' };
    } catch (error) {
      health.services.database = { status: 'unhealthy', message: error.message };
    }
    
    // Check Redis
    try {
      await redisClient.ping();
      health.services.redis = { status: 'healthy', message: 'Connected' };
    } catch (error) {
      health.services.redis = { status: 'unhealthy', message: error.message };
    }
    
    // Check AI service
    try {
      const aiHealth = await aiService.healthCheck();
      health.services.ai = aiHealth;
    } catch (error) {
      health.services.ai = { status: 'unhealthy', error: error.message };
    }
    
    // Overall health status
    const allHealthy = Object.values(health.services).every(service => 
      service.status === 'healthy'
    );
    
    health.overall = allHealthy ? 'healthy' : 'degraded';
    
    const statusCode = allHealthy ? 200 : 503;
    
    res.status(statusCode).json({
      success: allHealthy,
      health
    });
    
  } catch (error) {
    logger.error('Error checking system health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check system health'
    });
  }
});

/**
 * Trigger FAQ generation
 */
router.post('/generate-faqs', async (req, res) => {
  try {
    const { 
      minQuestionCount = 2, 
      maxFAQs = 100, 
      forceRegenerate = false 
    } = req.body;
    
    // Start FAQ generation (this runs in background)
    const result = await faqService.generateFAQs({
      minQuestionCount,
      maxFAQs,
      forceRegenerate
    });
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    logger.error('Error generating FAQs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Sync all accounts
 */
router.post('/sync-all', async (req, res) => {
  try {
    const { maxEmails } = req.body;
    
    const options = {};
    if (maxEmails) options.maxEmails = parseInt(maxEmails);
    
    // Start sync for all accounts
    const result = await emailService.syncAllAccounts(options);
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    logger.error('Error syncing all accounts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Update missing embeddings
 */
router.post('/update-embeddings', async (req, res) => {
  try {
    const { batchSize = 50 } = req.body;
    
    const result = await similarityService.updateMissingEmbeddings(batchSize);
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    logger.error('Error updating embeddings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get similarity statistics
 */
router.get('/similarity-stats', async (req, res) => {
  try {
    const stats = await similarityService.getSimilarityStats();
    
    res.json({
      success: true,
      stats
    });
    
  } catch (error) {
    logger.error('Error getting similarity stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get similarity statistics'
    });
  }
});

/**
 * Find duplicate questions
 */
router.get('/duplicates', async (req, res) => {
  try {
    const { threshold = 0.95 } = req.query;
    
    const duplicates = await similarityService.findDuplicateQuestions(parseFloat(threshold));
    
    res.json({
      success: true,
      duplicates,
      count: duplicates.length
    });
    
  } catch (error) {
    logger.error('Error finding duplicates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to find duplicate questions'
    });
  }
});

/**
 * Get recent questions
 */
router.get('/recent-questions', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const db = require('../config/database');
    const query = `
      SELECT 
        q.id,
        q.question_text,
        q.answer_text,
        q.confidence_score,
        q.created_at,
        e.subject as email_subject,
        e.sender_email,
        ea.email_address as account_email,
        ea.provider
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      JOIN email_accounts ea ON e.account_id = ea.id
      WHERE q.is_customer_question = true
      ORDER BY q.created_at DESC
      LIMIT $1
    `;
    
    const result = await db.query(query, [parseInt(limit)]);
    
    res.json({
      success: true,
      questions: result.rows
    });
    
  } catch (error) {
    logger.error('Error getting recent questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recent questions'
    });
  }
});

/**
 * Get top FAQs by frequency
 */
router.get('/top-faqs', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const result = await faqService.getFAQs({
      limit: parseInt(limit),
      published: true,
      sortBy: 'frequency_score',
      sortOrder: 'DESC'
    });
    
    res.json({
      success: true,
      faqs: result.faqs
    });
    
  } catch (error) {
    logger.error('Error getting top FAQs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get top FAQs'
    });
  }
});

/**
 * Search questions and FAQs
 */
router.get('/search', async (req, res) => {
  try {
    const { q, type = 'all', limit = 20 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }
    
    const results = {};
    
    if (type === 'all' || type === 'questions') {
      // Search questions
      const questionResults = await similarityService.findSimilarQuestionsByText(
        q, 
        0.7, 
        parseInt(limit)
      );
      results.questions = questionResults;
    }
    
    if (type === 'all' || type === 'faqs') {
      // Search FAQs
      const faqResults = await faqService.searchSimilarFAQs(q, parseInt(limit));
      results.faqs = faqResults;
    }
    
    res.json({
      success: true,
      query: q,
      results
    });
    
  } catch (error) {
    logger.error('Error searching:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

/**
 * Get system configuration
 */
router.get('/config', async (req, res) => {
  try {
    const db = require('../config/database');
    
    const query = 'SELECT key, value, description FROM system_settings ORDER BY key';
    const result = await db.query(query);
    
    const config = {};
    result.rows.forEach(row => {
      config[row.key] = {
        value: row.value,
        description: row.description
      };
    });
    
    res.json({
      success: true,
      config
    });
    
  } catch (error) {
    logger.error('Error getting system config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system configuration'
    });
  }
});

/**
 * Update system configuration
 */
router.put('/config', async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Settings object is required'
      });
    }
    
    const db = require('../config/database');
    
    for (const [key, value] of Object.entries(settings)) {
      const query = `
        UPDATE system_settings 
        SET value = $1, updated_at = NOW()
        WHERE key = $2
      `;
      
      await db.query(query, [JSON.stringify(value), key]);
    }
    
    logger.info('System configuration updated');
    
    res.json({
      success: true,
      message: 'Configuration updated successfully'
    });
    
  } catch (error) {
    logger.error('Error updating system config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update system configuration'
    });
  }
});

module.exports = router;