const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function diagnoseIssues() {
  try {
    logger.info('=== DIAGNOSTIC REPORT ===');
    
    // Check if database function exists
    try {
      const functionCheck = await db.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_proc p 
          JOIN pg_namespace n ON p.pronamespace = n.oid 
          WHERE n.nspname = 'public' 
          AND p.proname = 'update_faq_group_stats'
        ) as function_exists;
      `);
      
      logger.info('Database function check:', functionCheck.rows[0]);
      
      if (!functionCheck.rows[0].function_exists) {
        logger.error('❌ update_faq_group_stats function is missing - need to run migration');
      } else {
        logger.info('✅ update_faq_group_stats function exists');
      }
    } catch (error) {
      logger.error('Error checking database function:', error.message);
    }
    
    // Check OpenAI configuration
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      logger.error('❌ OPENAI_API_KEY environment variable is missing');
    } else {
      logger.info('✅ OPENAI_API_KEY is configured');
    }
    
    // Test OpenAI API (simple test)
    try {
      const { Configuration, OpenAIApi } = require('openai');
      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY
      });
      const openai = new OpenAIApi(configuration);
      
      logger.info('✅ OpenAI client initialized successfully with v3 syntax');
    } catch (error) {
      logger.error('❌ OpenAI client initialization failed:', error.message);
    }
    
    // Check recent emails for processing
    try {
      const emailCount = await db.query(`
        SELECT COUNT(*) as total_emails,
               COUNT(CASE WHEN is_processed = true THEN 1 END) as processed_emails,
               COUNT(CASE WHEN is_processed = false THEN 1 END) as unprocessed_emails,
               COUNT(CASE WHEN processing_status = 'completed' THEN 1 END) as completed_emails,
               COUNT(CASE WHEN processing_status = 'failed' THEN 1 END) as failed_emails
        FROM emails
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      
      logger.info('Email processing status (last 24h):', emailCount.rows[0]);
    } catch (error) {
      logger.error('Error checking email status:', error.message);
    }
    
    logger.info('=== END DIAGNOSTIC REPORT ===');
    
  } catch (error) {
    logger.error('Diagnostic failed:', error);
  } finally {
    await db.end();
  }
}

// Run diagnostic if this file is executed directly
if (require.main === module) {
  diagnoseIssues();
}

module.exports = { diagnoseIssues };