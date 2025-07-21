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
    
    // Keep only last 10 memory readings
    if (this.stats.memoryPeaks.length > 10) {
      this.stats.memoryPeaks = this.stats.memoryPeaks.slice(-10);
    }
    
    // Force garbage collection if memory usage is high
    if (heapUsed > this.memoryThreshold) {
      logger.warn(`High memory usage detected: ${Math.round(heapUsed / 1024 / 1024)}MB. Forcing garbage collection.`);
      this.forceGarbageCollection();
      return true;
    }
    
    return false;
  }

  /**
   * Force garbage collection and log results
   */
  forceGarbageCollection() {
    const beforeGC = process.memoryUsage();
    
    if (global.gc) {
      global.gc();
      const afterGC = process.memoryUsage();
      
      const freedMemory = beforeGC.heapUsed - afterGC.heapUsed;
      logger.info(`Garbage collection completed. Freed ${Math.round(freedMemory / 1024 / 1024)}MB`, {
        before: Math.round(beforeGC.heapUsed / 1024 / 1024),
        after: Math.round(afterGC.heapUsed / 1024 / 1024)
      });
      
      this.stats.lastGC = new Date();
    } else {
      logger.warn('Garbage collection not available. Start server with --expose-gc flag.');
    }
  }

  /**
   * Process a single email with comprehensive error handling and memory management
   */
  async processEmailSafely(email, batchIndex, emailIndex) {
    const emailId = email.id;
    let result = null;
    
    try {
      // Check memory before processing
      this.checkMemoryUsage();
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Email processing timeout')), this.processingTimeout);
      });
      
      // Limit email content to prevent memory issues
      const limitedEmail = {
        id: email.id,
        subject: (email.subject || '').substring(0, 300),
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
      
      result = await Promise.race([processingPromise, timeoutPromise]);
      
      // Store questions if found
      if (result.hasQuestions && result.questions.length > 0) {
        await this.storeQuestionsOptimized(emailId, result.questions, limitedEmail);
        this.stats.questionsFound += result.questions.length;
      }
      
      // Mark email as processed
      await this.emailService.markEmailProcessed(emailId, 'completed');
      
      this.stats.processed++;
      this.consecutiveErrors = 0; // Reset consecutive error counter
      
      logger.info(`✅ Email ${emailIndex + 1} processed successfully. Questions: ${result.questions?.length || 0}`);
      
      return {
        success: true,
        emailId,
        questionsFound: result.questions?.length || 0
      };
      
    } catch (error) {
      this.consecutiveErrors++;
      this.totalErrors++;
      this.stats.errors++;
      
      logger.error(`❌ Error processing email ${emailId}:`, {
        error: error.message,
        consecutiveErrors: this.consecutiveErrors,
        totalErrors: this.totalErrors,
        batchIndex,
        emailIndex
      });
      
      // Mark email as failed
      try {
        await this.emailService.markEmailProcessed(emailId, 'failed', error.message);
      } catch (markError) {
        logger.error('Failed to mark email as failed:', markError);
      }
      
      return {
        success: false,
        emailId,
        error: error.message
      };
    } finally {
      // Clear references to help garbage collection
      result = null;
      email = null;
    }
  }

  /**
   * Store questions with optimized memory usage
   */
  async storeQuestionsOptimized(emailId, questions, emailData) {
    const batchSize = 5; // Process questions in small batches
    
    for (let i = 0; i < questions.length; i += batchSize) {
      const questionBatch = questions.slice(i, i + batchSize);
      
      // Generate embeddings for batch (if needed)
      const questionTexts = questionBatch.map(q => q.question);
      let embeddings = [];
      
      try {
        if (questionTexts.length > 0) {
          embeddings = await this.aiService.generateEmbeddingsBatch(questionTexts);
        }
      } catch (embeddingError) {
        logger.warn('Embedding generation failed, storing without embeddings:', embeddingError.message);
        embeddings = new Array(questionTexts.length).fill(null);
      }
      
      // Insert questions
      const values = [];
      const placeholders = [];
      
      questionBatch.forEach((question, index) => {
        const baseIndex = values.length;
        placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9})`);
        values.push(
          emailId,
          question.question,
          question.answer || '',
          question.confidence || 0.8,
          index + 1,
          embeddings[index] ? JSON.stringify(embeddings[index]) : null,
          true, // is_customer_question
          emailData.sender_email,
          emailData.subject
        );
      });
      
      if (values.length > 0) {
        const insertQuery = `
          INSERT INTO questions (
            email_id, question_text, answer_text, confidence_score, 
            position_in_email, embedding_vector, is_customer_question,
            sender_email, email_subject
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (email_id, question_text) DO NOTHING
        `;
        
        await db.query(insertQuery, values);
      }
      
      // Clear references
      questionBatch.length = 0;
      embeddings.length = 0;
    }
  }

  /**
   * Check if processing should continue based on circuit breaker logic
   */
  shouldContinueProcessing() {
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      logger.error(`🚨 Circuit breaker: ${this.consecutiveErrors} consecutive errors. Stopping to prevent server crash.`);
      return false;
    }
    
    if (this.totalErrors >= this.maxTotalErrors) {
      logger.error(`🚨 Circuit breaker: ${this.totalErrors} total errors. Stopping to prevent server crash.`);
      return false;
    }
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > this.memoryThreshold) {
      logger.error(`🚨 Memory threshold exceeded: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB. Stopping processing.`);
      return false;
    }
    
    return true;
  }

  /**
   * Main processing method optimized for memory constraints
   */
  async processEmails(emails, io = null) {
    this.stats.startTime = new Date();
    logger.info(`🚀 Starting memory-optimized processing of ${emails.length} emails`);
    
    const totalBatches = Math.ceil(emails.length / this.maxBatchSize);
    let processedEmails = [];
    
    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        // Check if we should continue processing
        if (!this.shouldContinueProcessing()) {
          break;
        }
        
        const batchStart = batchIndex * this.maxBatchSize;
        const batchEnd = Math.min(batchStart + this.maxBatchSize, emails.length);
        const emailBatch = emails.slice(batchStart, batchEnd);
        
        logger.info(`📦 Processing batch ${batchIndex + 1}/${totalBatches} (${emailBatch.length} emails)`);
        
        // Process emails in batch sequentially
        for (let emailIndex = 0; emailIndex < emailBatch.length; emailIndex++) {
          const email = emailBatch[emailIndex];
          const result = await this.processEmailSafely(email, batchIndex, emailIndex);
          processedEmails.push(result);
          
          // Emit progress update
          if (io) {
            io.emit('faq_processing_progress', {
              processed: this.stats.processed,
              total: emails.length,
              questionsFound: this.stats.questionsFound,
              errors: this.stats.errors,
              currentBatch: batchIndex + 1,
              totalBatches
            });
          }
          
          // Small delay to prevent overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Force garbage collection every few batches
        if ((batchIndex + 1) % this.gcInterval === 0) {
          this.forceGarbageCollection();
        }
        
        // Longer delay between batches to allow system recovery
        if (batchIndex < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Clear batch references
        emailBatch.length = 0;
      }
      
      // Final statistics
      const duration = Date.now() - this.stats.startTime.getTime();
      const finalStats = {
        ...this.stats,
        duration: `${Math.round(duration / 1000)}s`,
        successRate: this.stats.processed > 0 ? Math.round((this.stats.processed / (this.stats.processed + this.stats.errors)) * 100) : 0,
        avgQuestionsPerEmail: this.stats.processed > 0 ? Math.round(this.stats.questionsFound / this.stats.processed * 100) / 100 : 0
      };
      
      logger.info('🎉 Memory-optimized processing completed:', finalStats);
      
      if (io) {
        io.emit('faq_processing_complete', finalStats);
      }
      
      return finalStats;
      
    } catch (error) {
      logger.error('❌ Fatal error in memory-optimized processing:', error);
      
      if (io) {
        io.emit('faq_processing_error', {
          error: error.message,
          stats: this.stats
        });
      }
      
      throw error;
    } finally {
      // Final cleanup
      processedEmails = null;
      emails = null;
      this.forceGarbageCollection();
    }
  }
}

module.exports = MemoryOptimizedProcessor;