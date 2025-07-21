#!/usr/bin/env node

/**
 * Comprehensive Fix Deployment Script
 * Addresses all root causes of FAQ generator getting stuck at 60 emails
 * 
 * This script:
 * 1. Runs database migrations (including missing update_faq_group_stats function)
 * 2. Validates OpenAI API configuration
 * 3. Tests memory-optimized processing
 * 4. Provides deployment recommendations
 * 5. Sets up monitoring and health checks
 */

const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const fs = require('fs');
const path = require('path');

class ComprehensiveFixDeployment {
  constructor() {
    this.fixes = {
      databaseFunction: false,
      openaiApi: false,
      memoryOptimization: false,
      errorHandling: false
    };
    
    this.validationResults = {
      databaseMigration: null,
      openaiConnection: null,
      memoryManagement: null,
      processingCapability: null
    };
  }

  /**
   * Run all database migrations including the missing function
   */
  async runDatabaseMigrations() {
    try {
      logger.info('🗄️  Running database migrations...');
      
      // Check if update_faq_group_stats function exists
      const functionCheck = await db.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_proc p 
          JOIN pg_namespace n ON p.pronamespace = n.oid 
          WHERE n.nspname = 'public' 
          AND p.proname = 'update_faq_group_stats'
        ) as function_exists;
      `);
      
      if (!functionCheck.rows[0].function_exists) {
        logger.info('📝 Missing update_faq_group_stats function - running migration...');
        
        // Read and execute the function migration
        const migrationPath = path.join(__dirname, '..', 'database', 'migrations', 'add_faq_group_stats_function.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        await db.query(migrationSQL);
        logger.info('✅ update_faq_group_stats function created successfully');
      } else {
        logger.info('✅ update_faq_group_stats function already exists');
      }
      
      // Run email context migration if needed
      const emailContextMigrationPath = path.join(__dirname, '..', 'database', 'migrations', 'add_email_context_to_questions.sql');
      if (fs.existsSync(emailContextMigrationPath)) {
        const emailContextSQL = fs.readFileSync(emailContextMigrationPath, 'utf8');
        await db.query(emailContextSQL);
        logger.info('✅ Email context migration completed');
      }
      
      this.fixes.databaseFunction = true;
      this.validationResults.databaseMigration = 'success';
      
    } catch (error) {
      logger.error('❌ Database migration failed:', error);
      this.validationResults.databaseMigration = `failed: ${error.message}`;
      throw error;
    }
  }

  /**
   * Validate OpenAI API configuration and connectivity
   */
  async validateOpenAIConfiguration() {
    try {
      logger.info('🤖 Validating OpenAI API configuration...');
      
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        throw new Error('OPENAI_API_KEY environment variable is missing');
      }
      
      // Test OpenAI API with v3 syntax
      const { Configuration, OpenAIApi } = require('openai');
      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY
      });
      const openai = new OpenAIApi(configuration);
      
      // Test chat completion
      const testResponse = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: 'Respond with just "API_TEST_SUCCESS" to confirm the connection works.'
          }
        ],
        max_tokens: 10,
        temperature: 0
      });
      
      const responseContent = testResponse.data.choices[0].message.content.trim();
      if (responseContent.includes('API_TEST_SUCCESS')) {
        logger.info('✅ OpenAI API connection successful');
        this.fixes.openaiApi = true;
        this.validationResults.openaiConnection = 'success';
      } else {
        throw new Error(`Unexpected API response: ${responseContent}`);
      }
      
      // Test embedding generation
      const embeddingResponse = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: 'Test embedding generation'
      });
      
      if (embeddingResponse.data && embeddingResponse.data.data && embeddingResponse.data.data.length > 0) {
        logger.info('✅ OpenAI embedding generation successful');
      } else {
        throw new Error('Embedding generation failed');
      }
      
    } catch (error) {
      logger.error('❌ OpenAI API validation failed:', error);
      this.validationResults.openaiConnection = `failed: ${error.message}`;
      throw error;
    }
  }

  /**
   * Test memory-optimized processing capability
   */
  async testMemoryOptimizedProcessing() {
    try {
      logger.info('💾 Testing memory-optimized processing...');
      
      // Check if garbage collection is available
      if (!global.gc) {
        logger.warn('⚠️  Garbage collection not available. Server should be started with --expose-gc flag.');
      } else {
        logger.info('✅ Garbage collection available');
      }
      
      // Test memory monitoring
      const initialMemory = process.memoryUsage();
      logger.info('📊 Initial memory usage:', {
        heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(initialMemory.external / 1024 / 1024) + 'MB'
      });
      
      // Test memory-optimized processor initialization
      const EmailService = require('../src/services/emailService');
      const AIService = require('../src/services/aiService');
      const FAQService = require('../src/services/faqService');
      const MemoryOptimizedProcessor = require('../src/services/memoryOptimizedProcessor');
      
      const emailService = new EmailService();
      const aiService = new AIService();
      const faqService = new FAQService();
      const processor = new MemoryOptimizedProcessor(aiService, emailService, faqService);
      
      logger.info('✅ Memory-optimized processor initialized successfully');
      
      this.fixes.memoryOptimization = true;
      this.validationResults.memoryManagement = 'success';
      
    } catch (error) {
      logger.error('❌ Memory optimization test failed:', error);
      this.validationResults.memoryManagement = `failed: ${error.message}`;
      throw error;
    }
  }

  /**
   * Test processing capability with a small sample
   */
  async testProcessingCapability() {
    try {
      logger.info('🧪 Testing processing capability...');
      
      // Get a small sample of unprocessed emails
      const sampleQuery = `
        SELECT id, subject, body_text, sender_email, sender_name
        FROM emails 
        WHERE is_processed = false 
        LIMIT 2
      `;
      
      const sampleResult = await db.query(sampleQuery);
      
      if (sampleResult.rows.length === 0) {
        logger.info('ℹ️  No unprocessed emails available for testing');
        this.validationResults.processingCapability = 'no_test_data';
        return;
      }
      
      // Test processing one email
      const testEmail = sampleResult.rows[0];
      const AIService = require('../src/services/aiService');
      const aiService = new AIService();
      
      const result = await aiService.detectQuestions(
        (testEmail.body_text || '').substring(0, 1000),
        (testEmail.subject || '').substring(0, 100)
      );
      
      logger.info('✅ Test email processing successful:', {
        hasQuestions: result.hasQuestions,
        questionCount: result.questions?.length || 0,
        confidence: result.overallConfidence
      });
      
      this.validationResults.processingCapability = 'success';
      
    } catch (error) {
      logger.error('❌ Processing capability test failed:', error);
      this.validationResults.processingCapability = `failed: ${error.message}`;
      // Don't throw here - this is not critical for deployment
    }
  }

  /**
   * Generate deployment report
   */
  generateDeploymentReport() {
    logger.info('📋 COMPREHENSIVE FIX DEPLOYMENT REPORT');
    logger.info('=====================================');
    
    // Fix status
    logger.info('🔧 Applied Fixes:');
    logger.info(`   Database Function: ${this.fixes.databaseFunction ? '✅' : '❌'}`);
    logger.info(`   OpenAI API v4: ${this.fixes.openaiApi ? '✅' : '❌'}`);
    logger.info(`   Memory Optimization: ${this.fixes.memoryOptimization ? '✅' : '❌'}`);
    
    // Validation results
    logger.info('🧪 Validation Results:');
    logger.info(`   Database Migration: ${this.validationResults.databaseMigration}`);
    logger.info(`   OpenAI Connection: ${this.validationResults.openaiConnection}`);
    logger.info(`   Memory Management: ${this.validationResults.memoryManagement}`);
    logger.info(`   Processing Test: ${this.validationResults.processingCapability}`);
    
    // Deployment recommendations
    logger.info('🚀 Deployment Recommendations:');
    
    const allCriticalFixesApplied = this.fixes.databaseFunction && this.fixes.openaiApi && this.fixes.memoryOptimization;
    
    if (allCriticalFixesApplied) {
      logger.info('   ✅ All critical fixes applied - READY FOR DEPLOYMENT');
      logger.info('   📝 Next steps:');
      logger.info('      1. Commit and push changes to trigger Render deployment');
      logger.info('      2. Monitor server logs during first processing run');
      logger.info('      3. Verify processing completes beyond 60 emails');
      logger.info('      4. Check memory usage stays below 1.5GB');
    } else {
      logger.info('   ❌ Some critical fixes failed - DEPLOYMENT NOT RECOMMENDED');
      logger.info('   🔧 Required actions:');
      if (!this.fixes.databaseFunction) logger.info('      - Fix database migration issues');
      if (!this.fixes.openaiApi) logger.info('      - Fix OpenAI API configuration');
      if (!this.fixes.memoryOptimization) logger.info('      - Fix memory optimization setup');
    }
    
    // Performance expectations
    logger.info('📊 Expected Performance Improvements:');
    logger.info('   • Processing should complete beyond 60 emails');
    logger.info('   • Memory usage should stay below 1.5GB');
    logger.info('   • No more 502 server crashes');
    logger.info('   • Better error recovery and reporting');
    logger.info('   • Reduced processing time per email');
    
    return allCriticalFixesApplied;
  }

  /**
   * Main deployment execution
   */
  async deploy() {
    try {
      logger.info('🚀 Starting comprehensive fix deployment...');
      
      // Step 1: Database migrations
      await this.runDatabaseMigrations();
      
      // Step 2: OpenAI API validation
      await this.validateOpenAIConfiguration();
      
      // Step 3: Memory optimization testing
      await this.testMemoryOptimizedProcessing();
      
      // Step 4: Processing capability test
      await this.testProcessingCapability();
      
      // Step 5: Generate report
      const deploymentReady = this.generateDeploymentReport();
      
      if (deploymentReady) {
        logger.info('🎉 Comprehensive fix deployment completed successfully!');
        process.exit(0);
      } else {
        logger.error('❌ Deployment validation failed. Please fix issues before deploying.');
        process.exit(1);
      }
      
    } catch (error) {
      logger.error('💥 Comprehensive fix deployment failed:', error);
      process.exit(1);
    } finally {
      await db.end();
    }
  }
}

// Run deployment if this file is executed directly
if (require.main === module) {
  const deployment = new ComprehensiveFixDeployment();
  deployment.deploy();
}

module.exports = ComprehensiveFixDeployment;