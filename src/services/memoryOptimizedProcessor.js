const logger = require('../utils/logger');
const db = require('../config/database');

/**
 * Memory-optimized email processor for Render's 2GB memory constraint
 * Addresses the core memory exhaustion issues causing 502 errors
 */
class MemoryOptimizedProcessor {
  constructor(aiService, emailService, faqService) {
    this.aiService = aiService;
    this.emailService = emailService;
    this.faqService = faqService;
    
    // Memory management settings optimized for Render
    this.maxBatchSize = 2; // Reduced from 3 to prevent memory spikes
    this.maxConcurrentProcessing = 1; // Sequential processing only
    this.memoryThreshold = 1.5 * 1024 * 1024 * 1024; // 1.5GB threshold (75% of 2GB)
    this.gcInterval = 5; // Force garbage collection every 5 batches
    this.processingTimeout = 25000; // 25 second timeout per email
    
    // Circuit breaker settings
    this.maxConsecutiveErrors = 10;
    this.maxTotalErrors = 25;
    this.consecutiveErrors = 0;
    this.totalErrors = 0;
    
    // Processing statistics
    this.stats = {
      processed: 0,
      questionsFound: 0,
      errors: 0,
      memoryPeaks: [],
      startTime: null,
      lastGC: null
    };
  }

  /**
   * Check memory usage and trigger garbage collection if needed
   */
  checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapUsed = memUsage.heapUsed;
    const heapTotal = memUsage.heapTotal;
    
    this.stats.memoryPeaks.push({
      timestamp: new Date(),
      heapUsed: Math.round(heapUsed / 1024 / 1024),
      heapTotal: Math.round(heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    });
    
    logger.info(`💾 Memory usage: ${Math.round(heapUsed / 1024 / 1024)}MB / ${Math.round(heapTotal / 1024 / 1024)}MB`);
    
    // Force garbage collection if approaching threshold
    if (heapUsed > this.memoryThreshold && global.gc) {
      logger.warn('⚠️  Memory threshold exceeded, forcing garbage collection');
      global.gc();
      this.stats.lastGC = new Date();
      
      // Give GC time to complete
      return new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return Promise.resolve();
  }

  /**
   * Process a single email with comprehensive error handling and memory management
   */
  async processEmailSafely(email, batchIndex, emailIndex) {
    const emailId = email.id;
    const globalIndex = batchIndex * this.maxBatchSize + emailIndex + 1;
    
    try {
      logger.info(`📧 Processing email ${globalIndex}: ${email.subject || 'No subject'}`);
      
      // Check if already processed
      const existingQuestions = await db.query(
        'SELECT COUNT(*) as count FROM questions WHERE email_id = $1',
        [emailId]
      );
      
      if (existingQuestions.rows[0].count > 0) {
        logger.info(`✅ Email ${emailId} already processed, skipping`);
        this.stats.processed++;
        return { emailId, status: 'skipped', reason: 'already_processed' };
      }
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Processing timeout')), this.processingTimeout);
      });
      
      // Prepare email data with memory limits
      const limitedEmail = {
        id: email.id,
        subject: email.subject,
        body_text: (email.body_text || '').substring(0, 8000), // Reduced from 10000
        sender_email: email.sender_email,
        sender_name: email.sender_name
      };
      
      // Process with timeout
      const processingPromise = this.aiService.detectQuestions(
        limitedEmail.body_text,
        limitedEmail.subject,
        [] // No thread context to reduce memory usage
      );
      
      const result = await Promise.race([processingPromise, timeoutPromise]);
      
      // Store questions if found
      if (result.hasQuestions && result.questions.length > 0) {
        await this.storeQuestionsOptimized(emailId, result.questions, limitedEmail);
        this.stats.questionsFound += result.questions.length;
      }
      
      // Mark email as processed (with column check)
      try {
        await db.query(
          'UPDATE emails SET processed_for_faq = true, processed_at = NOW() WHERE id = $1',
          [emailId]
        );
      } catch (updateError) {
        if (updateError.message.includes('column') && updateError.message.includes('does not exist')) {
          logger.warn('Missing database columns, skipping processed_for_faq update');
          // Try alternative update without the missing columns
          await db.query(
            'UPDATE emails SET updated_at = NOW() WHERE id = $1',
            [emailId]
          );
        } else {
          throw updateError;
        }
      }
      
      this.stats.processed++;
      this.consecutiveErrors = 0; // Reset consecutive error counter
      
      logger.info(`✅ Successfully processed email ${emailId}: ${result.questions.length} questions found`);
      
      return {
        emailId,
        status: 'success',
        questionsFound: result.questions.length,
        hasQuestions: result.hasQuestions
      };
      
    } catch (error) {
      this.stats.errors++;
      this.consecutiveErrors++;
      this.totalErrors++;
      
      logger.error(`❌ Error processing email ${emailId}:`, {
        error: error.message,
        stack: error.stack,
        consecutiveErrors: this.consecutiveErrors,
        totalErrors: this.totalErrors
      });
      
      // Mark as processed with error (with column check)
      try {
        await db.query(
          `UPDATE emails
           SET processed_for_faq = true,
               processed_at = NOW(),
               processing_error = $2
           WHERE id = $1`,
          [emailId, error.message]
        );
      } catch (updateError) {
        if (updateError.message.includes('column') && updateError.message.includes('does not exist')) {
          logger.warn('Missing database columns, skipping error update');
          // Try alternative update
          await db.query(
            'UPDATE emails SET updated_at = NOW() WHERE id = $1',
            [emailId]
          );
        } else {
          throw updateError;
        }
      }
      
      // Check circuit breaker
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        throw new Error(`Circuit breaker triggered: ${this.consecutiveErrors} consecutive errors`);
      }
      
      if (this.totalErrors >= this.maxTotalErrors) {
        throw new Error(`Maximum error threshold reached: ${this.totalErrors} total errors`);
      }
      
      return {
        emailId,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Optimized question storage with minimal memory footprint
   */
  async storeQuestionsOptimized(emailId, questions, email) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      for (const q of questions) {
        // Store with minimal data
        await client.query(
          `INSERT INTO questions 
           (email_id, question_text, answer_text, confidence, category, 
            sender_email, sender_name, detected_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
           ON CONFLICT (email_id, question_text) DO UPDATE
           SET answer_text = EXCLUDED.answer_text,
               confidence = EXCLUDED.confidence,
               updated_at = NOW()`,
          [
            emailId,
            q.question.substring(0, 500), // Limit question length
            q.answer ? q.answer.substring(0, 2000) : null, // Limit answer length
            q.confidence || 0.5,
            q.category || 'general',
            email.sender_email,
            email.sender_name,
            JSON.stringify({
              context: q.context ? q.context.substring(0, 500) : null,
              isFromCustomer: q.isFromCustomer !== false
            })
          ]
        );
      }
      
      await client.query('COMMIT');
      logger.info(`💾 Stored ${questions.length} questions for email ${emailId}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to store questions:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Process emails in memory-optimized batches
   */
  async processEmails(emails, io = null) {
    logger.info(`🚀 Starting memory-optimized processing of ${emails.length} emails`);
    
    this.stats.startTime = new Date();
    const processedEmails = [];
    const totalBatches = Math.ceil(emails.length / this.maxBatchSize);
    
    try {
      // Process in small batches
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * this.maxBatchSize;
        const batchEnd = Math.min(batchStart + this.maxBatchSize, emails.length);
        const emailBatch = emails.slice(batchStart, batchEnd);
        
        logger.info(`📦 Processing batch ${batchIndex + 1}/${totalBatches} (${emailBatch.length} emails)`);
        
        // Process emails in batch sequentially
        for (let emailIndex = 0; emailIndex < emailBatch.length; emailIndex++) {
          const email = emailBatch[emailIndex];
          const result = await this.processEmailSafely(email, batchIndex, emailIndex);
          processedEmails.push(result);
          
          // Emit progress update with correct field names for frontend
          if (io) {
            io.emit('faq_processing_progress', {
              current: this.stats.processed,  // Changed from 'processed'
              total: emails.length,
              questions: this.stats.questionsFound,  // Changed from 'questionsFound'
              errors: this.stats.errors,
              currentEmail: email.subject || 'Processing...',
              currentBatch: batchIndex + 1,
              totalBatches
            });
          }
        }
        
        // Memory management between batches
        await this.checkMemoryUsage();
        
        // Force GC every N batches
        if ((batchIndex + 1) % this.gcInterval === 0 && global.gc) {
          logger.info('🧹 Scheduled garbage collection');
          global.gc();
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      // Final statistics
      const processingTime = new Date() - this.stats.startTime;
      const summary = {
        totalEmails: emails.length,
        processed: this.stats.processed,
        questionsFound: this.stats.questionsFound,
        errors: this.stats.errors,
        processingTimeMs: processingTime,
        processingTimeSec: Math.round(processingTime / 1000),
        avgTimePerEmail: Math.round(processingTime / emails.length),
        memoryPeaks: this.stats.memoryPeaks.slice(-5), // Last 5 peaks
        success: this.stats.errors === 0
      };
      
      logger.info('✅ Processing complete:', summary);
      
      // Emit completion event
      if (io) {
        io.emit('faq_processing_complete', summary);
      }
      
      return summary;
      
    } catch (error) {
      logger.error('❌ Fatal error during batch processing:', error);
      
      // Emit error event
      if (io) {
        io.emit('faq_processing_error', {
          error: error.message,
          processed: this.stats.processed,
          errors: this.stats.errors
        });
      }
      
      throw error;
    }
  }
}

module.exports = MemoryOptimizedProcessor;