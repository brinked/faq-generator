#!/usr/bin/env node

/**
 * Fix Redis Embedding Issues
 * 
 * This script generates embeddings without Redis caching to fix the FAQ generation issue.
 */

require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const { Configuration, OpenAIApi } = require('openai');

class RedisFreAIService {
  constructor() {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.openai = new OpenAIApi(configuration);
    this.embeddingModel = process.env.OPENAI_MODEL || 'text-embedding-3-small';
  }

  async generateEmbedding(text) {
    try {
      const response = await this.openai.createEmbedding({
        model: this.embeddingModel,
        input: text
      });

      return response.data.data[0].embedding;
    } catch (error) {
      logger.error('Error generating embedding:', error);
      throw new Error('Failed to generate embedding');
    }
  }
}

async function fixRedisEmbeddings() {
  try {
    logger.info('🔧 Starting Redis-free embedding generation...');
    
    // Check questions without embeddings
    const missingEmbeddingsQuery = `
      SELECT COUNT(*) as count 
      FROM questions 
      WHERE embedding IS NULL AND question_text IS NOT NULL
    `;
    
    const missingResult = await db.query(missingEmbeddingsQuery);
    const missingCount = parseInt(missingResult.rows[0].count);
    
    if (missingCount === 0) {
      logger.info('✅ All questions already have embeddings');
      return;
    }
    
    logger.info(`Found ${missingCount} questions without embeddings`);
    
    const aiService = new RedisFreAIService();
    
    // Process questions in small batches to avoid rate limits
    const batchSize = 5;
    let processed = 0;
    let successful = 0;
    
    while (processed < missingCount) {
      const questionsQuery = `
        SELECT id, question_text 
        FROM questions 
        WHERE embedding IS NULL AND question_text IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;
      
      const questionsResult = await db.query(questionsQuery, [batchSize, processed]);
      const questions = questionsResult.rows;
      
      if (questions.length === 0) break;
      
      logger.info(`Processing batch ${Math.floor(processed/batchSize) + 1}: ${questions.length} questions`);
      
      for (const question of questions) {
        try {
          logger.info(`Generating embedding for: "${question.question_text.substring(0, 50)}..."`);
          
          const embedding = await aiService.generateEmbedding(question.question_text);
          
          const updateQuery = `
            UPDATE questions 
            SET embedding = $1, updated_at = NOW()
            WHERE id = $2
          `;
          
          await db.query(updateQuery, [JSON.stringify(embedding), question.id]);
          successful++;
          
          logger.info(`✅ Generated embedding for question ${successful}/${missingCount}`);
          
          // Small delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (embeddingError) {
          logger.error(`❌ Failed to generate embedding for question ${question.id}:`, embeddingError.message);
        }
      }
      
      processed += questions.length;
      
      // Longer delay between batches
      if (processed < missingCount) {
        logger.info('Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    logger.info(`✅ Completed embedding generation: ${successful}/${missingCount} successful`);
    
    // Now test FAQ generation
    logger.info('\n🧪 Testing FAQ generation...');
    
    const FAQService = require('../src/services/faqService');
    const faqService = new FAQService();
    
    const result = await faqService.generateFAQs({
      minQuestionCount: 1, // Allow single-question FAQs
      maxFAQs: 20,
      forceRegenerate: false
    });
    
    logger.info('FAQ Generation Result:', result);
    
    if (result.generated > 0 || result.updated > 0) {
      logger.info('🎉 FAQ generation is now working!');
    } else {
      logger.warn('⚠️ FAQ generation still not creating FAQs. May need to check similarity thresholds.');
    }
    
  } catch (error) {
    logger.error('Redis-free embedding generation failed:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Handle process signals
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down embedding generation');
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down embedding generation');
  await db.end();
  process.exit(0);
});

// Run the fix
fixRedisEmbeddings();