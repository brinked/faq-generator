#!/usr/bin/env node

/**
 * Render Cron Job: FAQ Generation
 * 
 * This script is designed to run as a Render cron job to automatically
 * generate FAQs from processed questions.
 * 
 * Usage: node scripts/cron-faq-generation.js
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const FAQService = require('../src/services/faqService');

async function runFAQGeneration() {
  const startTime = Date.now();
  
  try {
    logger.info('Starting scheduled FAQ generation cron job');
    
    const faqService = new FAQService();
    
    // Configuration from environment variables
    const config = {
      minQuestionCount: parseInt(process.env.CRON_MIN_QUESTION_COUNT) || 3,
      maxFAQs: parseInt(process.env.CRON_MAX_FAQS_PER_RUN) || 50,
      forceRegenerate: process.env.CRON_FORCE_REGENERATE === 'true',
      onlyNewQuestions: process.env.CRON_ONLY_NEW_QUESTIONS !== 'false',
      timeout: parseInt(process.env.CRON_TIMEOUT_MS) || 15 * 60 * 1000 // 15 minutes
    };
    
    // Set timeout to prevent hanging cron jobs
    const timeoutId = setTimeout(() => {
      logger.error('FAQ generation cron job timed out');
      process.exit(1);
    }, config.timeout);
    
    // Run the FAQ generation with auto-fix enabled
    const result = await faqService.generateFAQs({
      ...config,
      autoFix: true // Enable auto-fix for production
    });
    
    clearTimeout(timeoutId);
    
    const duration = Date.now() - startTime;
    
    // Log results
    logger.info('FAQ generation cron job completed successfully', {
      duration: `${duration}ms`,
      generated_faqs: result.generated?.length || 0,
      updated_faqs: result.updated?.length || 0,
      skipped_faqs: result.skipped?.length || 0,
      errors: result.errors?.length || 0
    });
    
    // Store metrics in database
    await storeMetrics('cron_faq_generation', result, duration);
    
    // Exit successfully
    process.exit(0);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('FAQ generation cron job failed', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`
    });
    
    // Store error metrics
    await storeMetrics('cron_faq_generation_error', { error: error.message }, duration);
    
    // Send alert if webhook is configured
    await sendAlert('faq_generation_cron_failed', error);
    
    // Exit with error code
    process.exit(1);
  }
}

/**
 * Store metrics in the database
 */
async function storeMetrics(metricName, result, duration) {
  try {
    const db = require('../src/config/database');
    
    const query = `
      INSERT INTO system_metrics (
        metric_name, metric_value, metadata, created_at
      ) VALUES ($1, $2, $3, NOW())
    `;
    
    const metricValue = result.generated?.length || 0;
    const metadata = {
      duration,
      generated: result.generated?.length || 0,
      updated: result.updated?.length || 0,
      skipped: result.skipped?.length || 0,
      errors: result.errors || [],
      timestamp: new Date().toISOString()
    };
    
    await db.query(query, [metricName, metricValue, JSON.stringify(metadata)]);
    
  } catch (error) {
    logger.error('Failed to store cron job metrics:', error);
  }
}

/**
 * Send alert notification
 */
async function sendAlert(alertType, error) {
  try {
    if (process.env.ALERT_WEBHOOK_URL) {
      const axios = require('axios');
      
      await axios.post(process.env.ALERT_WEBHOOK_URL, {
        alert_type: alertType,
        service: 'faq-generator',
        message: error.message,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production'
      }, {
        timeout: 5000
      });
    }
  } catch (alertError) {
    logger.error('Failed to send alert:', alertError);
  }
}

// Handle process signals
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down FAQ generation cron job');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down FAQ generation cron job');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in FAQ generation cron job:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in FAQ generation cron job:', { reason, promise });
  process.exit(1);
});

// Run the job
runFAQGeneration();