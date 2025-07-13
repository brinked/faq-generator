#!/usr/bin/env node

/**
 * Render Cron Job: Email Synchronization
 * 
 * This script is designed to run as a Render cron job to automatically
 * synchronize emails from all connected accounts.
 * 
 * Usage: node scripts/cron-email-sync.js
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const EmailService = require('../src/services/emailService');

async function runEmailSync() {
  const startTime = Date.now();
  
  try {
    logger.info('Starting scheduled email synchronization cron job');
    
    const emailService = new EmailService();
    
    // Configuration from environment variables
    const config = {
      maxEmails: parseInt(process.env.CRON_SYNC_MAX_EMAILS) || 500,
      skipRecentlyProcessed: true,
      timeout: parseInt(process.env.CRON_TIMEOUT_MS) || 10 * 60 * 1000 // 10 minutes
    };
    
    // Set timeout to prevent hanging cron jobs
    const timeoutId = setTimeout(() => {
      logger.error('Email sync cron job timed out');
      process.exit(1);
    }, config.timeout);
    
    // Run the synchronization
    const result = await emailService.syncAllAccounts(config);
    
    clearTimeout(timeoutId);
    
    const duration = Date.now() - startTime;
    
    // Log results
    logger.info('Email sync cron job completed successfully', {
      duration: `${duration}ms`,
      accounts_processed: result.accounts?.length || 0,
      total_emails: result.totalEmails || 0,
      new_emails: result.newEmails || 0,
      errors: result.errors?.length || 0
    });
    
    // Store metrics in database
    await storeMetrics('cron_email_sync', result, duration);
    
    // Exit successfully
    process.exit(0);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('Email sync cron job failed', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`
    });
    
    // Store error metrics
    await storeMetrics('cron_email_sync_error', { error: error.message }, duration);
    
    // Send alert if webhook is configured
    await sendAlert('email_sync_cron_failed', error);
    
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
    
    const metricValue = result.newEmails || result.totalEmails || 0;
    const metadata = {
      duration,
      accounts: result.accounts?.length || 0,
      total_emails: result.totalEmails || 0,
      new_emails: result.newEmails || 0,
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
  logger.info('Received SIGTERM, shutting down email sync cron job');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down email sync cron job');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in email sync cron job:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in email sync cron job:', { reason, promise });
  process.exit(1);
});

// Run the job
runEmailSync();