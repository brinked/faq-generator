const cron = require('node-cron');
const logger = require('../utils/logger');
const EmailService = require('./emailService');
const FAQService = require('./faqService');
const SimilarityService = require('./similarityService');

const emailService = new EmailService();
const faqService = new FAQService();
const similarityService = new SimilarityService();

class SchedulerService {
  constructor() {
    this.jobs = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize and start all scheduled jobs
   */
  async startScheduledJobs() {
    if (this.isInitialized) {
      logger.warn('Scheduler service already initialized');
      return;
    }

    try {
      logger.info('Starting scheduled jobs...');

      // Email synchronization - every 30 minutes
      this.scheduleEmailSync();

      // FAQ generation - every 2 hours
      this.scheduleFAQGeneration();

      // Embedding updates - every hour
      this.scheduleEmbeddingUpdates();

      // Cleanup old jobs - daily at 2 AM
      this.scheduleCleanup();

      // Health check - every 5 minutes
      this.scheduleHealthCheck();

      this.isInitialized = true;
      logger.info('All scheduled jobs started successfully');

    } catch (error) {
      logger.error('Error starting scheduled jobs:', error);
      throw error;
    }
  }

  /**
   * Schedule automatic email synchronization
   */
  scheduleEmailSync() {
    const cronExpression = process.env.EMAIL_SYNC_CRON || '*/30 * * * *'; // Every 30 minutes
    
    const job = cron.schedule(cronExpression, async () => {
      logger.info('Starting scheduled email synchronization');
      
      try {
        const startTime = Date.now();
        
        // Sync all active accounts
        const result = await emailService.syncAllAccounts({
          maxEmails: parseInt(process.env.SCHEDULED_SYNC_MAX_EMAILS) || 500,
          skipRecentlyProcessed: true
        });

        const duration = Date.now() - startTime;
        
        logger.info('Scheduled email sync completed', {
          duration: `${duration}ms`,
          accounts: result.accounts?.length || 0,
          totalEmails: result.totalEmails || 0,
          newEmails: result.newEmails || 0
        });

        // Update metrics
        await this.updateSyncMetrics(result, duration);

      } catch (error) {
        logger.error('Scheduled email sync failed:', error);
        
        // Send alert if configured
        await this.sendAlert('email_sync_failed', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    this.jobs.set('email_sync', job);
    job.start();
    
    logger.info(`Email sync scheduled: ${cronExpression}`);
  }

  /**
   * Schedule automatic FAQ generation
   */
  scheduleFAQGeneration() {
    const cronExpression = process.env.FAQ_GENERATION_CRON || '0 */2 * * *'; // Every 2 hours
    
    const job = cron.schedule(cronExpression, async () => {
      logger.info('Starting scheduled FAQ generation');
      
      try {
        const startTime = Date.now();
        
        // Generate FAQs from new questions
        const result = await faqService.generateFAQs({
          minQuestionCount: parseInt(process.env.MIN_QUESTION_COUNT) || 3,
          maxFAQs: parseInt(process.env.MAX_FAQS_PER_GENERATION) || 50,
          forceRegenerate: false,
          onlyNewQuestions: true
        });

        const duration = Date.now() - startTime;
        
        logger.info('Scheduled FAQ generation completed', {
          duration: `${duration}ms`,
          newFAQs: result.generated?.length || 0,
          updatedFAQs: result.updated?.length || 0
        });

        // Update metrics
        await this.updateFAQMetrics(result, duration);

      } catch (error) {
        logger.error('Scheduled FAQ generation failed:', error);
        await this.sendAlert('faq_generation_failed', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    this.jobs.set('faq_generation', job);
    job.start();
    
    logger.info(`FAQ generation scheduled: ${cronExpression}`);
  }

  /**
   * Schedule embedding updates for questions without embeddings
   */
  scheduleEmbeddingUpdates() {
    const cronExpression = process.env.EMBEDDING_UPDATE_CRON || '0 * * * *'; // Every hour
    
    const job = cron.schedule(cronExpression, async () => {
      logger.info('Starting scheduled embedding updates');
      
      try {
        const startTime = Date.now();
        
        // Update missing embeddings
        const result = await similarityService.updateMissingEmbeddings(
          parseInt(process.env.EMBEDDING_BATCH_SIZE) || 100
        );

        const duration = Date.now() - startTime;
        
        logger.info('Scheduled embedding updates completed', {
          duration: `${duration}ms`,
          updatedEmbeddings: result.updated || 0,
          remainingWithoutEmbeddings: result.remaining || 0
        });

      } catch (error) {
        logger.error('Scheduled embedding updates failed:', error);
        await this.sendAlert('embedding_update_failed', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    this.jobs.set('embedding_updates', job);
    job.start();
    
    logger.info(`Embedding updates scheduled: ${cronExpression}`);
  }

  /**
   * Schedule cleanup of old processing jobs and temporary data
   */
  scheduleCleanup() {
    const cronExpression = process.env.CLEANUP_CRON || '0 2 * * *'; // Daily at 2 AM
    
    const job = cron.schedule(cronExpression, async () => {
      logger.info('Starting scheduled cleanup');
      
      try {
        const startTime = Date.now();
        const db = require('../config/database');
        
        // Clean up old processing jobs (older than 30 days)
        const jobCleanupQuery = `
          DELETE FROM processing_jobs 
          WHERE created_at < NOW() - INTERVAL '30 days'
          AND status IN ('completed', 'failed')
        `;
        const jobResult = await db.query(jobCleanupQuery);
        
        // Clean up orphaned questions (questions without emails)
        const orphanedQuestionsQuery = `
          DELETE FROM questions 
          WHERE email_id NOT IN (SELECT id FROM emails)
        `;
        const questionsResult = await db.query(orphanedQuestionsQuery);
        
        // Clean up empty FAQ groups
        const emptyFAQsQuery = `
          DELETE FROM faq_groups 
          WHERE id NOT IN (SELECT DISTINCT group_id FROM question_groups)
        `;
        const faqResult = await db.query(emptyFAQsQuery);
        
        // Update statistics
        await db.query('ANALYZE');
        
        const duration = Date.now() - startTime;
        
        logger.info('Scheduled cleanup completed', {
          duration: `${duration}ms`,
          deletedJobs: jobResult.rowCount || 0,
          deletedQuestions: questionsResult.rowCount || 0,
          deletedFAQs: faqResult.rowCount || 0
        });

      } catch (error) {
        logger.error('Scheduled cleanup failed:', error);
        await this.sendAlert('cleanup_failed', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    this.jobs.set('cleanup', job);
    job.start();
    
    logger.info(`Cleanup scheduled: ${cronExpression}`);
  }

  /**
   * Schedule health checks
   */
  scheduleHealthCheck() {
    const cronExpression = process.env.HEALTH_CHECK_CRON || '*/5 * * * *'; // Every 5 minutes
    
    const job = cron.schedule(cronExpression, async () => {
      try {
        const db = require('../config/database');
        const redisClient = require('../config/redis');
        
        // Check database connection
        await db.query('SELECT 1');
        
        // Check Redis connection
        await redisClient.ping();
        
        // Check queue health
        const queueService = require('./queueService');
        const queueStats = await queueService.getQueueStats();
        
        // Log if there are issues
        if (queueStats.failed > 10) {
          logger.warn('High number of failed jobs detected', queueStats);
        }
        
        if (queueStats.waiting > 100) {
          logger.warn('High number of waiting jobs detected', queueStats);
        }

      } catch (error) {
        logger.error('Health check failed:', error);
        await this.sendAlert('health_check_failed', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    this.jobs.set('health_check', job);
    job.start();
    
    logger.info(`Health check scheduled: ${cronExpression}`);
  }

  /**
   * Update sync metrics in database
   */
  async updateSyncMetrics(result, duration) {
    try {
      const db = require('../config/database');
      
      const query = `
        INSERT INTO system_metrics (
          metric_name, metric_value, metadata, created_at
        ) VALUES ($1, $2, $3, NOW())
      `;
      
      await db.query(query, [
        'scheduled_email_sync',
        result.newEmails || 0,
        JSON.stringify({
          duration,
          accounts: result.accounts?.length || 0,
          totalEmails: result.totalEmails || 0,
          errors: result.errors || []
        })
      ]);
      
    } catch (error) {
      logger.error('Error updating sync metrics:', error);
    }
  }

  /**
   * Update FAQ generation metrics
   */
  async updateFAQMetrics(result, duration) {
    try {
      const db = require('../config/database');
      
      const query = `
        INSERT INTO system_metrics (
          metric_name, metric_value, metadata, created_at
        ) VALUES ($1, $2, $3, NOW())
      `;
      
      await db.query(query, [
        'scheduled_faq_generation',
        result.generated?.length || 0,
        JSON.stringify({
          duration,
          generated: result.generated?.length || 0,
          updated: result.updated?.length || 0,
          errors: result.errors || []
        })
      ]);
      
    } catch (error) {
      logger.error('Error updating FAQ metrics:', error);
    }
  }

  /**
   * Send alert notifications
   */
  async sendAlert(alertType, error) {
    try {
      // Log the alert
      logger.error(`ALERT: ${alertType}`, {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });

      // Here you could integrate with external alerting services
      // like Slack, Discord, email, PagerDuty, etc.
      
      // Example: Send to webhook if configured
      if (process.env.ALERT_WEBHOOK_URL) {
        const axios = require('axios');
        
        await axios.post(process.env.ALERT_WEBHOOK_URL, {
          alert_type: alertType,
          message: error.message,
          timestamp: new Date().toISOString(),
          service: 'faq-generator'
        });
      }

    } catch (alertError) {
      logger.error('Failed to send alert:', alertError);
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopAllJobs() {
    logger.info('Stopping all scheduled jobs...');
    
    for (const [name, job] of this.jobs) {
      try {
        job.stop();
        logger.info(`Stopped job: ${name}`);
      } catch (error) {
        logger.error(`Error stopping job ${name}:`, error);
      }
    }
    
    this.jobs.clear();
    this.isInitialized = false;
    
    logger.info('All scheduled jobs stopped');
  }

  /**
   * Get status of all scheduled jobs
   */
  getJobsStatus() {
    const status = {};
    
    for (const [name, job] of this.jobs) {
      status[name] = {
        running: job.running || false,
        scheduled: job.scheduled || false
      };
    }
    
    return {
      initialized: this.isInitialized,
      jobs: status,
      total_jobs: this.jobs.size
    };
  }

  /**
   * Manually trigger a specific job
   */
  async triggerJob(jobName) {
    if (!this.jobs.has(jobName)) {
      throw new Error(`Job '${jobName}' not found`);
    }

    logger.info(`Manually triggering job: ${jobName}`);
    
    try {
      switch (jobName) {
        case 'email_sync':
          return await emailService.syncAllAccounts();
        case 'faq_generation':
          return await faqService.generateFAQs();
        case 'embedding_updates':
          return await similarityService.updateMissingEmbeddings();
        case 'cleanup':
          // Trigger cleanup manually
          const db = require('../config/database');
          await db.query('DELETE FROM processing_jobs WHERE created_at < NOW() - INTERVAL \'30 days\'');
          return { message: 'Cleanup completed' };
        default:
          throw new Error(`Manual trigger not implemented for job: ${jobName}`);
      }
    } catch (error) {
      logger.error(`Error manually triggering job ${jobName}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
const schedulerService = new SchedulerService();

module.exports = {
  startScheduledJobs: () => schedulerService.startScheduledJobs(),
  stopAllJobs: () => schedulerService.stopAllJobs(),
  getJobsStatus: () => schedulerService.getJobsStatus(),
  triggerJob: (jobName) => schedulerService.triggerJob(jobName),
  schedulerService
};