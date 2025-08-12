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
   * Process a single email safely with timeout and error handling
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
        logger.info(`✅ Email ${emailId} already processed, marking as processed`);
        
        // Mark email as processed since questions already exist
        try {
          await db.query(
            'UPDATE emails SET is_processed = true, processed_for_faq = true WHERE id = $1',
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
      const result = await Promise.race([this.aiService.detectQuestions(
        limitedEmail.body_text,
        limitedEmail.subject,
        [] // No thread context to reduce memory usage
      ), timeoutPromise]);
      
      // Store questions if found
      if (result.hasQuestions && result.questions.length > 0) {
        await this.storeQuestionsOptimized(emailId, result.questions, limitedEmail);
        this.stats.questionsFound += result.questions.length;
      }
      
      // Mark email as processed (with column check)
      try {
        await db.query(
          'UPDATE emails SET is_processed = true, processed_for_faq = true WHERE id = $1',
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
           SET is_processed = true,
               processed_for_faq = true,
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
        // Generate embedding for the question
        let embedding = null;
        try {
          const AIService = require('./aiService');
          const aiService = new AIService();
          embedding = await aiService.generateEmbedding(q.question);
        } catch (embeddingError) {
          logger.warn(`Failed to generate embedding for question: ${embeddingError.message}`);
        }

        await client.query(
          `INSERT INTO questions
           (email_id, question_text, answer_text, confidence_score, category,
            sender_email, sender_name, detected_at, metadata, embedding, is_customer_question)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10)
           ON CONFLICT (email_id, question_text) DO UPDATE
           SET answer_text = EXCLUDED.answer_text,
               confidence_score = EXCLUDED.confidence_score,
               embedding = EXCLUDED.embedding,
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
            }),
            embedding ? JSON.stringify(embedding) : null,
            q.isFromCustomer !== false
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
   * Process emails with memory optimization and real-time progress
   */
  async processEmails(emails, io = null) {
    try {
      logger.info(`🚀 Starting memory-optimized processing of ${emails.length} emails`);
      
      // Emit start event
      if (io) {
        io.emit('faq_processing_progress', {
          type: 'start',
          total: emails.length,
          processed: 0,
          message: `Starting processing of ${emails.length} emails...`
        });
      }
      
      this.stats = {
        total: emails.length,
        processed: 0,
        questionsFound: 0,
        errors: 0,
        totalErrors: 0,
        consecutiveErrors: 0
      };
      
      const batchSize = this.maxBatchSize;
      const results = [];
      
      for (let batchIndex = 0; batchIndex < emails.length; batchIndex += batchSize) {
        const batch = emails.slice(batchIndex, batchIndex + batchSize);
        logger.info(`📦 Processing batch ${Math.floor(batchIndex / batchSize) + 1}/${Math.ceil(emails.length / batchSize)} (${batch.length} emails)`);
        
        // Emit batch start event
        if (io) {
          io.emit('faq_processing_progress', {
            type: 'batch_start',
            batchIndex: Math.floor(batchIndex / batchSize) + 1,
            totalBatches: Math.ceil(emails.length / batchSize),
            batchSize: batch.length,
            message: `Processing batch ${Math.floor(batchIndex / batchSize) + 1}/${Math.ceil(emails.length / batchSize)}`
          });
        }
        
        const batchPromises = batch.map((email, emailIndex) => 
          this.processEmailSafely(email, batchIndex, emailIndex)
        );
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Process batch results
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
            
            // Update global stats for each processed email
            if (result.value.status === 'success' || result.value.status === 'skipped') {
              this.stats.processed = Math.min(this.stats.processed + 1, emails.length);
              if (result.value.questionsFound) {
                this.stats.questionsFound += result.value.questionsFound;
              }
            }
            
            // Emit individual email progress with updated counts
            if (io && (result.value.status === 'success' || result.value.status === 'skipped')) {
              io.emit('faq_processing_progress', {
                type: 'email_processed',
                emailId: result.value.emailId,
                questionsFound: result.value.questionsFound || 0,
                current: this.stats.processed,
                total: emails.length,
                percentage: Math.round((this.stats.processed / emails.length) * 100),
                message: `Processed email: ${result.value.questionsFound || 0} questions found`
              });
            }
          } else {
            logger.error('Batch processing error:', result.reason);
            this.stats.errors++;
            this.totalErrors++;
          }
        }
        
        // Emit batch complete event
        if (io) {
          io.emit('faq_processing_progress', {
            type: 'batch_complete',
            batchIndex: Math.floor(batchIndex / batchSize) + 1,
            totalBatches: Math.ceil(emails.length / batchSize),
            processed: Math.min(batchIndex + batchSize, emails.length),
            total: emails.length,
            message: `Completed batch ${Math.floor(batchIndex / batchSize) + 1}/${Math.ceil(emails.length / batchSize)}`
          });
        }
        
        // Memory cleanup between batches
        if (global.gc) {
          global.gc();
        }
        
        // Small delay between batches
        if (batchIndex + batchSize < emails.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Emit completion event
      if (io) {
        io.emit('faq_processing_complete', {
          total: emails.length,
          processed: this.stats.processed,
          questionsFound: this.stats.questionsFound,
          errors: this.stats.errors,
          message: `Processing completed: ${this.stats.processed} emails processed, ${this.stats.questionsFound} questions found`
        });
      }
      
      logger.info(`✅ Memory-optimized processing completed`, this.stats);
      return {
        success: true,
        ...this.stats,
        results
      };
      
    } catch (error) {
      logger.error('❌ Memory-optimized processing failed:', error);
      
      // Emit error event
      if (io) {
        io.emit('faq_processing_error', {
          error: error.message,
          message: 'Processing failed: ' + error.message
        });
      }
      
      throw error;
    }
  }
}

module.exports = MemoryOptimizedProcessor;