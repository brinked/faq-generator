#!/usr/bin/env node

/**
 * Render Cron Job: System Cleanup
 * 
 * This script is designed to run as a Render cron job to perform
 * system maintenance and cleanup tasks.
 * 
 * Usage: node scripts/cron-cleanup.js
 */

require('dotenv').config();
const logger = require('../src/utils/logger');

async function runCleanup() {
  const startTime = Date.now();
  
  try {
    logger.info('Starting scheduled cleanup cron job');
    
    const db = require('../src/config/database');
    const cleanupResults = {};
    
    // Configuration from environment variables
    const config = {
      retentionDays: parseInt(process.env.CLEANUP_RETENTION_DAYS) || 30,
      metricsRetentionDays: parseInt(process.env.METRICS_RETENTION_DAYS) || 90,
      timeout: parseInt(process.env.CRON_TIMEOUT_MS) || 10 * 60 * 1000 // 10 minutes
    };
    
    // Set timeout to prevent hanging cron jobs
    const timeoutId = setTimeout(() => {
      logger.error('Cleanup cron job timed out');
      process.exit(1);
    }, config.timeout);
    
    // 1. Clean up old processing jobs
    logger.info('Cleaning up old processing jobs...');
    const jobCleanupQuery = `
      DELETE FROM processing_jobs 
      WHERE created_at < NOW() - INTERVAL '${config.retentionDays} days'
      AND status IN ('completed', 'failed')
    `;
    const jobResult = await db.query(jobCleanupQuery);
    cleanupResults.deletedJobs = jobResult.rowCount || 0;
    
    // 2. Clean up old system metrics
    logger.info('Cleaning up old system metrics...');
    const metricsCleanupQuery = `
      DELETE FROM system_metrics 
      WHERE created_at < NOW() - INTERVAL '${config.metricsRetentionDays} days'
    `;
    const metricsResult = await db.query(metricsCleanupQuery);
    cleanupResults.deletedMetrics = metricsResult.rowCount || 0;
    
    // 3. Clean up orphaned questions (questions without emails)
    logger.info('Cleaning up orphaned questions...');
    const orphanedQuestionsQuery = `
      DELETE FROM questions 
      WHERE email_id NOT IN (SELECT id FROM emails)
    `;
    const questionsResult = await db.query(orphanedQuestionsQuery);
    cleanupResults.deletedQuestions = questionsResult.rowCount || 0;
    
    // 4. Clean up empty FAQ groups
    logger.info('Cleaning up empty FAQ groups...');
    const emptyFAQsQuery = `
      DELETE FROM faq_groups 
      WHERE id NOT IN (SELECT DISTINCT group_id FROM question_groups WHERE group_id IS NOT NULL)
    `;
    const faqResult = await db.query(emptyFAQsQuery);
    cleanupResults.deletedFAQs = faqResult.rowCount || 0;
    
    // 5. Clean up orphaned question_groups entries
    logger.info('Cleaning up orphaned question groups...');
    const orphanedGroupsQuery = `
      DELETE FROM question_groups 
      WHERE question_id NOT IN (SELECT id FROM questions)
      OR group_id NOT IN (SELECT id FROM faq_groups)
    `;
    const groupsResult = await db.query(orphanedGroupsQuery);
    cleanupResults.deletedGroups = groupsResult.rowCount || 0;
    
    // 6. Update database statistics
    logger.info('Updating database statistics...');
    await db.query('ANALYZE');
    
    // 7. Vacuum database if needed (only on weekends to avoid performance impact)
    const now = new Date();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6; // Sunday = 0, Saturday = 6
    
    if (isWeekend && process.env.ENABLE_VACUUM === 'true') {
      logger.info('Running database vacuum (weekend maintenance)...');
      await db.query('VACUUM');
      cleanupResults.vacuumRun = true;
    }
    
    clearTimeout(timeoutId);
    
    const duration = Date.now() - startTime;
    
    // Log results
    logger.info('Cleanup cron job completed successfully', {
      duration: `${duration}ms`,
      ...cleanupResults
    });
    
    // Store metrics in database
    await storeMetrics('cron_cleanup', cleanupResults, duration);
    
    // Exit successfully
    process.exit(0);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('Cleanup cron job failed', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`
    });
    
    // Store error metrics
    await storeMetrics('cron_cleanup_error', { error: error.message }, duration);
    
    // Send alert if webhook is configured
    await sendAlert('cleanup_cron_failed', error);
    
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
    
    const metricValue = result.deletedJobs || 0;
    const metadata = {
      duration,
      deleted_jobs: result.deletedJobs || 0,
      deleted_metrics: result.deletedMetrics || 0,
      deleted_questions: result.deletedQuestions || 0,
      deleted_faqs: result.deletedFAQs || 0,
      deleted_groups: result.deletedGroups || 0,
      vacuum_run: result.vacuumRun || false,
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
  logger.info('Received SIGTERM, shutting down cleanup cron job');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down cleanup cron job');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in cleanup cron job:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in cleanup cron job:', { reason, promise });
  process.exit(1);
});

// Run the job
runCleanup();