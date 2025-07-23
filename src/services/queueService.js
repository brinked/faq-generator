const Queue = require('bull');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');
const EmailService = require('./emailService');
const AIService = require('./aiService');
const FAQService = require('./faqService');
const SimilarityService = require('./similarityService');

// Initialize services
const emailService = new EmailService();
const aiService = new AIService();
const faqService = new FAQService();
const similarityService = new SimilarityService();

// Queue configurations
const queueConfig = {
  redis: process.env.REDIS_URL || {
    port: process.env.REDIS_PORT || 6379,
    host: process.env.REDIS_HOST || 'localhost',
    password: process.env.REDIS_PASSWORD || undefined,
    db: 0
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
};

// Create queues
const emailSyncQueue = new Queue('email-sync', queueConfig);
const questionProcessingQueue = new Queue('question-processing', queueConfig);
const faqGenerationQueue = new Queue('faq-generation', queueConfig);
const embeddingQueue = new Queue('embedding-generation', queueConfig);

/**
 * Email Sync Queue Processor
 */
emailSyncQueue.process('sync-account', async (job) => {
  const { accountId, options = {} } = job.data;
  
  try {
    logger.info(`Starting email sync job for account ${accountId}`);
    
    // Update job progress
    job.progress(10);
    
    const result = await emailService.syncAccount(accountId, options);
    
    job.progress(80);
    
    // If emails were synced, queue them for question processing
    if (result.stored > 0) {
      await questionProcessingQueue.add('process-account-emails', {
        accountId,
        emailCount: result.stored
      }, {
        delay: 1000 // Small delay to ensure emails are committed
      });
    }
    
    job.progress(100);
    
    logger.info(`Email sync completed for account ${accountId}: ${result.stored} emails stored`);
    
    return result;
    
  } catch (error) {
    logger.error(`Email sync failed for account ${accountId}:`, error);
    throw error;
  }
});

/**
 * Question Processing Queue Processor
 */
questionProcessingQueue.process('process-account-emails', async (job) => {
  const { accountId, emailCount } = job.data;
  
  try {
    logger.info(`Starting question processing for account ${accountId}`);
    
    const db = require('../config/database');
    
    // Get unprocessed emails for this account
    const emailsQuery = `
      SELECT id, subject, body_text
      FROM emails 
      WHERE account_id = $1 AND is_processed = false
      ORDER BY received_at DESC
      LIMIT 100
    `;
    
    const emailsResult = await db.query(emailsQuery, [accountId]);
    const emails = emailsResult.rows;
    
    if (emails.length === 0) {
      logger.info(`No unprocessed emails found for account ${accountId}`);
      return { processed: 0 };
    }
    
    let processed = 0;
    const total = emails.length;
    
    // Process emails in batches for better performance
    const batchSize = 5;
    const totalBatches = Math.ceil(emails.length / batchSize);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, emails.length);
      const emailBatch = emails.slice(batchStart, batchEnd);
      
      try {
        // Update progress
        job.progress(Math.round((batchEnd / total) * 80));
        
        // Mark emails as processing
        await Promise.allSettled(
          emailBatch.map(email => emailService.markEmailProcessed(email.id, 'processing'))
        );
        
        // Detect questions for all emails in batch with metadata
        const detectionResults = await Promise.allSettled(
          emailBatch.map(async (email) => {
            // Check if this email has a response
            const threadAnalysis = await filteringService.analyzeEmailThread(email, connectedAccounts);
            
            return aiService.detectQuestions(
              (email.body_text || '').substring(0, 10000), // Limit content size
              email.subject || '',
              [], // Thread emails - could be populated if needed
              {
                senderEmail: email.sender_email,
                hasResponse: threadAnalysis.hasResponseFromBusiness,
                isFromConnectedAccount: connectedAccounts.some(acc =>
                  acc.email_address.toLowerCase() === (email.sender_email || '').toLowerCase()
                )
              }
            );
          })
        );
        
        // Collect all questions from successful detections
        const allQuestions = [];
        const questionTexts = [];
        const emailQuestionMap = new Map();
        
        for (let i = 0; i < detectionResults.length; i++) {
          const result = detectionResults[i];
          const email = emailBatch[i];
          
          if (result.status === 'fulfilled' && result.value.hasQuestions) {
            const questions = result.value.questions || [];
            emailQuestionMap.set(email.id, questions);
            
            questions.forEach((question, index) => {
              allQuestions.push({
                email_id: email.id,
                question_text: question.question,
                answer_text: question.answer || '',
                confidence_score: question.confidence || 0.8,
                position_in_email: index + 1,
                is_customer_question: true
              });
              questionTexts.push(question.question);
            });
          }
        }
        
        // Generate embeddings in batch if we have questions
        let embeddings = [];
        if (questionTexts.length > 0) {
          try {
            embeddings = await aiService.generateEmbeddingsBatch(questionTexts);
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
        }
        
        // Insert questions with embeddings in batch
        if (allQuestions.length > 0) {
          const values = [];
          const placeholders = [];
          
          allQuestions.forEach((question, index) => {
            const baseIndex = index * 7;
            placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7})`);
            values.push(
              question.email_id,
              question.question_text,
              question.answer_text,
              question.confidence_score,
              question.position_in_email,
              embeddings[index] ? JSON.stringify(embeddings[index]) : null,
              question.is_customer_question
            );
          });
          
          const insertQuery = `
            INSERT INTO questions (
              email_id, question_text, answer_text, confidence_score,
              position_in_email, embedding, is_customer_question
            ) VALUES ${placeholders.join(', ')}
            ON CONFLICT (email_id, question_text) DO NOTHING
          `;
          
          await db.query(insertQuery, values);
          logger.info(`Batch inserted ${allQuestions.length} questions with embeddings`);
        }
        
        // Mark emails as completed
        await Promise.allSettled(
          emailBatch.map(email => emailService.markEmailProcessed(email.id, 'completed'))
        );
        
        processed += emailBatch.length;
        
      } catch (batchError) {
        logger.error(`Error processing email batch ${batchIndex + 1}:`, batchError);
        
        // Mark all emails in failed batch as failed
        await Promise.allSettled(
          emailBatch.map(email =>
            emailService.markEmailProcessed(email.id, 'failed', batchError.message)
          )
        );
      }
    }
    
    job.progress(90);
    
    // If questions were processed, queue FAQ generation
    if (processed > 0) {
      await faqGenerationQueue.add('generate-faqs', {
        accountId,
        questionsProcessed: processed
      }, {
        delay: 5000 // Delay to allow questions to be committed
      });
    }
    
    job.progress(100);
    
    logger.info(`Question processing completed for account ${accountId}: ${processed} emails processed`);
    
    return {
      processed,
      total: emails.length,
      qualified: qualifiedEmails.length,
      disqualified: emails.length - qualifiedEmails.length
    };
    
  } catch (error) {
    logger.error(`Question processing failed for account ${accountId}:`, error);
    throw error;
  }
});

/**
 * FAQ Generation Queue Processor
 */
faqGenerationQueue.process('generate-faqs', async (job) => {
  const { accountId, questionsProcessed } = job.data;
  
  try {
    logger.info(`Starting FAQ generation (triggered by account ${accountId})`);
    
    job.progress(20);
    
    const result = await faqService.generateFAQs({
      minQuestionCount: 2,
      maxFAQs: 50
    });
    
    job.progress(100);
    
    logger.info(`FAQ generation completed: ${result.generated} new FAQs, ${result.updated} updated`);
    
    return result;
    
  } catch (error) {
    logger.error('FAQ generation failed:', error);
    throw error;
  }
});

/**
 * Embedding Generation Queue Processor
 */
embeddingQueue.process('update-missing-embeddings', async (job) => {
  const { batchSize = 50 } = job.data;
  
  try {
    logger.info('Starting embedding update job');
    
    job.progress(20);
    
    const result = await similarityService.updateMissingEmbeddings(batchSize);
    
    job.progress(100);
    
    logger.info(`Embedding update completed: ${result.updated} embeddings updated`);
    
    return result;
    
  } catch (error) {
    logger.error('Embedding update failed:', error);
    throw error;
  }
});

/**
 * Queue Event Handlers
 */
function setupQueueEventHandlers() {
  // Email Sync Queue Events
  emailSyncQueue.on('completed', (job, result) => {
    logger.info(`Email sync job ${job.id} completed:`, result);
    
    // Emit real-time update
    if (global.io) {
      global.io.emit('email-sync-completed', {
        jobId: job.id,
        accountId: job.data.accountId,
        result
      });
    }
  });
  
  emailSyncQueue.on('failed', (job, err) => {
    logger.error(`Email sync job ${job.id} failed:`, err);
    
    // Emit real-time update
    if (global.io) {
      global.io.emit('email-sync-failed', {
        jobId: job.id,
        accountId: job.data.accountId,
        error: err.message
      });
    }
  });
  
  emailSyncQueue.on('progress', (job, progress) => {
    // Emit real-time progress update
    if (global.io) {
      global.io.emit('email-sync-progress', {
        jobId: job.id,
        accountId: job.data.accountId,
        progress
      });
    }
  });
  
  // Question Processing Queue Events
  questionProcessingQueue.on('completed', (job, result) => {
    logger.info(`Question processing job ${job.id} completed:`, result);
    
    if (global.io) {
      global.io.emit('question-processing-completed', {
        jobId: job.id,
        accountId: job.data.accountId,
        result
      });
    }
  });
  
  questionProcessingQueue.on('failed', (job, err) => {
    logger.error(`Question processing job ${job.id} failed:`, err);
    
    if (global.io) {
      global.io.emit('question-processing-failed', {
        jobId: job.id,
        accountId: job.data.accountId,
        error: err.message
      });
    }
  });
  
  // FAQ Generation Queue Events
  faqGenerationQueue.on('completed', (job, result) => {
    logger.info(`FAQ generation job ${job.id} completed:`, result);
    
    if (global.io) {
      global.io.emit('faq-generation-completed', {
        jobId: job.id,
        result
      });
    }
  });
  
  faqGenerationQueue.on('failed', (job, err) => {
    logger.error(`FAQ generation job ${job.id} failed:`, err);
    
    if (global.io) {
      global.io.emit('faq-generation-failed', {
        jobId: job.id,
        error: err.message
      });
    }
  });
  
  // Embedding Queue Events
  embeddingQueue.on('completed', (job, result) => {
    logger.info(`Embedding job ${job.id} completed:`, result);
    
    if (global.io) {
      global.io.emit('embedding-update-completed', {
        jobId: job.id,
        result
      });
    }
  });
}

/**
 * Queue Management Functions
 */
async function addEmailSyncJob(accountId, options = {}) {
  const job = await emailSyncQueue.add('sync-account', {
    accountId,
    options
  }, {
    priority: 10,
    delay: 0
  });
  
  logger.info(`Email sync job ${job.id} queued for account ${accountId}`);
  return job;
}

async function addQuestionProcessingJob(accountId, emailCount) {
  const job = await questionProcessingQueue.add('process-account-emails', {
    accountId,
    emailCount
  }, {
    priority: 5,
    delay: 1000
  });
  
  logger.info(`Question processing job ${job.id} queued for account ${accountId}`);
  return job;
}

async function addFAQGenerationJob(options = {}) {
  const job = await faqGenerationQueue.add('generate-faqs', options, {
    priority: 3,
    delay: 5000
  });
  
  logger.info(`FAQ generation job ${job.id} queued`);
  return job;
}

async function addEmbeddingUpdateJob(batchSize = 50) {
  const job = await embeddingQueue.add('update-missing-embeddings', {
    batchSize
  }, {
    priority: 1,
    delay: 0
  });
  
  logger.info(`Embedding update job ${job.id} queued`);
  return job;
}

/**
 * Get queue statistics
 */
async function getQueueStats() {
  const stats = {};
  
  const queues = {
    emailSync: emailSyncQueue,
    questionProcessing: questionProcessingQueue,
    faqGeneration: faqGenerationQueue,
    embedding: embeddingQueue
  };
  
  for (const [name, queue] of Object.entries(queues)) {
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed()
    ]);
    
    stats[name] = {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length
    };
  }
  
  return stats;
}

/**
 * Clean old jobs
 */
async function cleanOldJobs() {
  const queues = [emailSyncQueue, questionProcessingQueue, faqGenerationQueue, embeddingQueue];
  
  for (const queue of queues) {
    await queue.clean(24 * 60 * 60 * 1000, 'completed'); // Remove completed jobs older than 24 hours
    await queue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // Remove failed jobs older than 7 days
  }
  
  logger.info('Old jobs cleaned from queues');
}

/**
 * Initialize queues
 */
async function initializeQueues() {
  try {
    // Setup event handlers
    setupQueueEventHandlers();
    
    // Clean old jobs on startup
    await cleanOldJobs();
    
    // Schedule periodic cleanup
    setInterval(cleanOldJobs, 60 * 60 * 1000); // Every hour
    
    logger.info('Queue service initialized successfully');
    
  } catch (error) {
    logger.error('Failed to initialize queue service:', error);
    throw error;
  }
}

/**
 * Graceful shutdown
 */
async function closeQueues() {
  const queues = [emailSyncQueue, questionProcessingQueue, faqGenerationQueue, embeddingQueue];
  
  await Promise.all(queues.map(queue => queue.close()));
  logger.info('All queues closed');
}

module.exports = {
  // Queues
  emailSyncQueue,
  questionProcessingQueue,
  faqGenerationQueue,
  embeddingQueue,
  
  // Job management
  addEmailSyncJob,
  addQuestionProcessingJob,
  addFAQGenerationJob,
  addEmbeddingUpdateJob,
  
  // Utilities
  getQueueStats,
  cleanOldJobs,
  initializeQueues,
  closeQueues
};