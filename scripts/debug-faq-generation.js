#!/usr/bin/env node

/**
 * Debug FAQ Generation Issues
 * 
 * This script diagnoses why FAQ generation is failing despite finding questions.
 */

require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const FAQService = require('../src/services/faqService');
const SimilarityService = require('../src/services/similarityService');

async function debugFAQGeneration() {
  try {
    logger.info('🔍 Starting FAQ generation debugging...');
    
    // Step 1: Check questions in database
    logger.info('\n📊 Step 1: Checking questions in database...');
    const questionsQuery = `
      SELECT 
        COUNT(*) as total_questions,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) as questions_with_embeddings,
        COUNT(*) FILTER (WHERE is_customer_question = true) as customer_questions,
        COUNT(*) FILTER (WHERE confidence_score >= 0.7) as high_confidence_questions,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL AND is_customer_question = true AND confidence_score >= 0.7) as eligible_questions,
        AVG(confidence_score) as avg_confidence,
        MIN(confidence_score) as min_confidence,
        MAX(confidence_score) as max_confidence
      FROM questions
    `;
    
    const questionsResult = await db.query(questionsQuery);
    const stats = questionsResult.rows[0];
    
    logger.info('Questions Statistics:', {
      total_questions: parseInt(stats.total_questions),
      questions_with_embeddings: parseInt(stats.questions_with_embeddings),
      customer_questions: parseInt(stats.customer_questions),
      high_confidence_questions: parseInt(stats.high_confidence_questions),
      eligible_questions: parseInt(stats.eligible_questions),
      avg_confidence: parseFloat(stats.avg_confidence || 0).toFixed(3),
      min_confidence: parseFloat(stats.min_confidence || 0).toFixed(3),
      max_confidence: parseFloat(stats.max_confidence || 0).toFixed(3)
    });
    
    if (parseInt(stats.eligible_questions) === 0) {
      logger.error('❌ No eligible questions found for FAQ generation!');
      
      if (parseInt(stats.questions_with_embeddings) === 0) {
        logger.error('   - No questions have embeddings generated');
      }
      if (parseInt(stats.customer_questions) === 0) {
        logger.error('   - No questions marked as customer questions');
      }
      if (parseInt(stats.high_confidence_questions) === 0) {
        logger.error('   - No questions meet confidence threshold (0.7)');
      }
      
      // Show sample questions for debugging
      const sampleQuery = `
        SELECT id, question_text, confidence_score, is_customer_question, 
               CASE WHEN embedding IS NULL THEN 'NO' ELSE 'YES' END as has_embedding
        FROM questions 
        ORDER BY created_at DESC 
        LIMIT 5
      `;
      const sampleResult = await db.query(sampleQuery);
      logger.info('Sample questions:', sampleResult.rows);
      
      return;
    }
    
    // Step 2: Test FAQ service question retrieval
    logger.info('\n📋 Step 2: Testing FAQ service question retrieval...');
    const faqService = new FAQService();
    const questionsForFAQ = await faqService.getQuestionsForFAQGeneration();
    
    logger.info(`Found ${questionsForFAQ.length} questions for FAQ generation`);
    
    if (questionsForFAQ.length === 0) {
      logger.error('❌ FAQ service returned no questions!');
      
      // Check the specific query conditions
      const debugQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embeddings,
          COUNT(*) FILTER (WHERE is_customer_question = true) as customer_questions,
          COUNT(*) FILTER (WHERE confidence_score >= $1) as above_threshold
        FROM questions q
        JOIN emails e ON q.email_id = e.id
      `;
      
      const minConfidence = parseFloat(process.env.QUESTION_CONFIDENCE_THRESHOLD) || 0.7;
      const debugResult = await db.query(debugQuery, [minConfidence]);
      logger.info('Debug query results:', debugResult.rows[0]);
      
      return;
    }
    
    // Step 3: Test similarity clustering
    logger.info('\n🔗 Step 3: Testing similarity clustering...');
    const similarityService = new SimilarityService();
    const questionIds = questionsForFAQ.map(q => q.id);
    
    logger.info(`Attempting to cluster ${questionIds.length} questions...`);
    
    try {
      const clusters = await similarityService.clusterSimilarQuestions(questionIds);
      logger.info(`Created ${clusters.length} clusters`);
      
      // Show cluster details
      clusters.forEach((cluster, index) => {
        logger.info(`Cluster ${index + 1}: ${cluster.questions.length} questions`);
      });
      
      // Filter by minimum question count
      const minQuestionCount = 2;
      const validClusters = clusters.filter(cluster => cluster.questions.length >= minQuestionCount);
      logger.info(`Valid clusters (>= ${minQuestionCount} questions): ${validClusters.length}`);
      
      if (validClusters.length === 0) {
        logger.error('❌ No valid clusters found!');
        logger.info('This suggests questions are not similar enough to cluster together.');
        logger.info(`Current similarity threshold: ${similarityService.similarityThreshold}`);
        
        // Test with lower threshold
        logger.info('\n🔧 Testing with lower similarity threshold...');
        const lowerThresholdClusters = await similarityService.clusterSimilarQuestions(questionIds, 0.6);
        logger.info(`With 0.6 threshold: ${lowerThresholdClusters.length} clusters`);
        
        const validLowerClusters = lowerThresholdClusters.filter(cluster => cluster.questions.length >= minQuestionCount);
        logger.info(`Valid clusters with 0.6 threshold: ${validLowerClusters.length}`);
        
        return;
      }
      
      // Step 4: Test actual FAQ generation
      logger.info('\n🏗️ Step 4: Testing FAQ generation...');
      const result = await faqService.generateFAQs({
        minQuestionCount: 2,
        maxFAQs: 10,
        forceRegenerate: false
      });
      
      logger.info('FAQ Generation Result:', result);
      
      if (result.generated === 0 && result.updated === 0) {
        logger.error('❌ FAQ generation completed but created no FAQs!');
        
        // Check if FAQs already exist
        const existingFAQsQuery = 'SELECT COUNT(*) as count FROM faq_groups';
        const existingResult = await db.query(existingFAQsQuery);
        logger.info(`Existing FAQs in database: ${existingResult.rows[0].count}`);
        
      } else {
        logger.info('✅ FAQ generation successful!');
      }
      
    } catch (clusterError) {
      logger.error('❌ Clustering failed:', clusterError);
      
      // Check if it's a vector extension issue
      if (clusterError.message.includes('operator does not exist') || 
          clusterError.message.includes('vector') ||
          clusterError.message.includes('<=>')) {
        logger.error('🚨 Vector extension issue detected!');
        logger.info('The PostgreSQL vector extension may not be properly installed.');
        
        // Test vector extension
        try {
          await db.query("SELECT '1'::vector");
          logger.info('✅ Vector extension is available');
        } catch (vectorError) {
          logger.error('❌ Vector extension is NOT available:', vectorError.message);
          logger.info('💡 Solution: Install pgvector extension or use text-based similarity');
        }
      }
    }
    
  } catch (error) {
    logger.error('Debug script failed:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Handle process signals
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down debug script');
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down debug script');
  await db.end();
  process.exit(0);
});

// Run the debug script
debugFAQGeneration();