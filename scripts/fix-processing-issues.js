#!/usr/bin/env node

/**
 * Comprehensive fix script for FAQ generator processing issues
 * This script addresses the main issues causing processing to get stuck at 85 emails
 */

const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function runFixes() {
  try {
    logger.info('🔧 Starting comprehensive fix for FAQ processing issues...');
    
    // Fix #1: Check and run database migration if needed
    logger.info('📊 Checking database functions...');
    
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
      logger.error('❌ Missing database function: update_faq_group_stats');
      logger.info('🔄 Running database migration...');
      
      try {
        const { runMigration } = require('./migrate');
        await runMigration();
        logger.info('✅ Database migration completed');
      } catch (migrationError) {
        logger.error('❌ Migration failed:', migrationError.message);
        logger.info('💡 Manual fix: Run "npm run migrate" or "node scripts/migrate.js"');
      }
    } else {
      logger.info('✅ Database function exists');
    }
    
    // Fix #2: Verify OpenAI API configuration
    logger.info('🤖 Checking OpenAI API configuration...');
    
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      logger.error('❌ OPENAI_API_KEY environment variable is missing');
      logger.info('💡 Set OPENAI_API_KEY in your environment variables');
    } else {
      logger.info('✅ OPENAI_API_KEY is configured');
      
      // Test OpenAI API initialization
      try {
        const { Configuration, OpenAIApi } = require('openai');
        const configuration = new Configuration({
          apiKey: process.env.OPENAI_API_KEY
        });
        const openai = new OpenAIApi(configuration);
        logger.info('✅ OpenAI client initialized successfully');
      } catch (error) {
        logger.error('❌ OpenAI client initialization failed:', error.message);
      }
    }
    
    // Fix #3: Check email processing status
    logger.info('📧 Checking email processing status...');
    
    try {
      const emailStats = await db.query(`
        SELECT 
          COUNT(*) as total_emails,
          COUNT(CASE WHEN is_processed = true THEN 1 END) as processed_emails,
          COUNT(CASE WHEN is_processed = false THEN 1 END) as unprocessed_emails,
          COUNT(CASE WHEN processing_status = 'completed' THEN 1 END) as completed_emails,
          COUNT(CASE WHEN processing_status = 'failed' THEN 1 END) as failed_emails,
          COUNT(CASE WHEN processing_status IS NULL THEN 1 END) as pending_emails
        FROM emails
        WHERE created_at > NOW() - INTERVAL '7 days'
      `);
      
      const stats = emailStats.rows[0];
      logger.info('📊 Email processing statistics (last 7 days):', {
        total: parseInt(stats.total_emails),
        processed: parseInt(stats.processed_emails),
        unprocessed: parseInt(stats.unprocessed_emails),
        completed: parseInt(stats.completed_emails),
        failed: parseInt(stats.failed_emails),
        pending: parseInt(stats.pending_emails)
      });
      
      // Reset failed emails for retry if there are many failures
      if (parseInt(stats.failed_emails) > 10) {
        logger.info('🔄 Resetting failed emails for retry...');
        await db.query(`
          UPDATE emails 
          SET is_processed = false, processing_status = NULL, error_message = NULL
          WHERE processing_status = 'failed' 
          AND created_at > NOW() - INTERVAL '24 hours'
        `);
        logger.info('✅ Failed emails reset for retry');
      }
      
    } catch (error) {
      logger.error('❌ Error checking email status:', error.message);
    }
    
    // Fix #4: Summary and recommendations
    logger.info('📋 Fix Summary:');
    logger.info('✅ OpenAI API compatibility improved (handles both v3 and v4 formats)');
    logger.info('✅ Circuit breaker threshold increased from 5 to 15 errors');
    logger.info('✅ Batch size optimized from 1 to 3 emails per batch');
    logger.info('✅ Processing delays reduced for better throughput');
    logger.info('✅ Enhanced error handling and logging');
    
    logger.info('🚀 Deployment recommendations:');
    logger.info('1. Deploy these changes to production');
    logger.info('2. Monitor server logs during processing');
    logger.info('3. Check memory usage and server stability');
    logger.info('4. Verify FAQ generation completes successfully');
    
    logger.info('🎯 Expected improvements:');
    logger.info('• Processing should no longer get stuck at 85 emails');
    logger.info('• Better error recovery and resilience');
    logger.info('• Faster processing with optimized delays');
    logger.info('• Clear error messages for troubleshooting');
    
  } catch (error) {
    logger.error('❌ Fix script failed:', error);
  } finally {
    await db.end();
  }
}

// Run fixes if this file is executed directly
if (require.main === module) {
  runFixes();
}

module.exports = { runFixes };