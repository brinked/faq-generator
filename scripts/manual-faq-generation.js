#!/usr/bin/env node

/**
 * Manual FAQ Generation Script
 * 
 * This script manually triggers FAQ generation with various options for testing.
 */

require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const FAQService = require('../src/services/faqService');

async function manualFAQGeneration() {
  try {
    logger.info('🚀 Starting manual FAQ generation...');
    
    const faqService = new FAQService();
    
    // Get current stats
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM questions WHERE embedding IS NOT NULL AND is_customer_question = true AND confidence_score >= 0.7) as eligible_questions,
        (SELECT COUNT(*) FROM faq_groups) as existing_faqs
    `;
    
    const statsResult = await db.query(statsQuery);
    const stats = statsResult.rows[0];
    
    logger.info('Current Statistics:', {
      eligible_questions: parseInt(stats.eligible_questions),
      existing_faqs: parseInt(stats.existing_faqs)
    });
    
    if (parseInt(stats.eligible_questions) === 0) {
      logger.error('❌ No eligible questions found for FAQ generation!');
      logger.info('💡 Run the fix script first: node scripts/fix-faq-generation.js');
      return;
    }
    
    // Test different configurations
    const configurations = [
      {
        name: 'Auto-Fix with Permissive Settings',
        options: {
          minQuestionCount: 1,
          maxFAQs: 10,
          forceRegenerate: false,
          autoFix: true
        }
      },
      {
        name: 'Auto-Fix with Standard Settings',
        options: {
          minQuestionCount: 2,
          maxFAQs: 20,
          forceRegenerate: false,
          autoFix: true
        }
      },
      {
        name: 'Auto-Fix with Force Regenerate',
        options: {
          minQuestionCount: 1,
          maxFAQs: 50,
          forceRegenerate: true,
          autoFix: true
        }
      }
    ];
    
    for (const config of configurations) {
      logger.info(`\n🧪 Testing: ${config.name}`);
      logger.info('Options:', config.options);
      
      try {
        const startTime = Date.now();
        const result = await faqService.generateFAQs(config.options);
        const duration = Date.now() - startTime;
        
        logger.info(`✅ ${config.name} completed in ${duration}ms`);
        logger.info('Results:', {
          processed: result.processed || 0,
          clusters: result.clusters || 0,
          generated: result.generated || 0,
          updated: result.updated || 0
        });
        
        if (result.generated > 0 || result.updated > 0) {
          logger.info('🎉 FAQ generation successful!');
          
          // Show generated FAQs
          const faqsQuery = `
            SELECT id, title, representative_question, question_count, is_published, created_at
            FROM faq_groups 
            ORDER BY created_at DESC 
            LIMIT 5
          `;
          
          const faqsResult = await db.query(faqsQuery);
          logger.info('Recent FAQs:', faqsResult.rows);
          
          break; // Stop testing once we have success
        }
        
      } catch (configError) {
        logger.error(`❌ ${config.name} failed:`, configError.message);
      }
    }
    
    // Final stats
    const finalStatsResult = await db.query(statsQuery);
    const finalStats = finalStatsResult.rows[0];
    
    logger.info('\n📊 Final Statistics:', {
      eligible_questions: parseInt(finalStats.eligible_questions),
      total_faqs: parseInt(finalStats.existing_faqs),
      faqs_created: parseInt(finalStats.existing_faqs) - parseInt(stats.existing_faqs)
    });
    
    if (parseInt(finalStats.existing_faqs) > parseInt(stats.existing_faqs)) {
      logger.info('✅ FAQ generation is working! New FAQs have been created.');
    } else {
      logger.warn('⚠️ No new FAQs were created. Check the debug output above for issues.');
    }
    
  } catch (error) {
    logger.error('Manual FAQ generation failed:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Handle process signals
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down manual FAQ generation');
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down manual FAQ generation');
  await db.end();
  process.exit(0);
});

// Run the manual FAQ generation
manualFAQGeneration();