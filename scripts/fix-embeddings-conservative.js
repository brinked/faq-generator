#!/usr/bin/env node

/**
 * Conservative Embedding Generation Script
 * 
 * This script generates embeddings with very conservative rate limiting
 * to avoid OpenAI API rate limits that can crash the Render instance.
 */

require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const { Configuration, OpenAIApi } = require('openai');

class ConservativeAIService {
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
      if (error.response?.status === 429) {
        logger.warn('Rate limit hit, waiting 60 seconds...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        throw new Error('Rate limit - retry needed');
      }
      logger.error('Error generating embedding:', error);
      throw error;
    }
  }
}

async function generateEmbeddingsConservatively() {
  try {
    logger.info('🐌 Starting CONSERVATIVE embedding generation...');
    logger.info('⚠️ This will be slow but safe to avoid rate limits');
    
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
    logger.info(`Estimated time: ${Math.ceil(missingCount * 10 / 60)} minutes`);
    
    const aiService = new ConservativeAIService();
    
    // Process ONE question at a time with long delays
    let processed = 0;
    let successful = 0;
    
    while (processed < missingCount) {
      const questionQuery = `
        SELECT id, question_text 
        FROM questions 
        WHERE embedding IS NULL AND question_text IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1 OFFSET $1
      `;
      
      const questionResult = await db.query(questionQuery, [processed]);
      const questions = questionResult.rows;
      
      if (questions.length === 0) break;
      
      const question = questions[0];
      
      try {
        logger.info(`[${processed + 1}/${missingCount}] Processing: "${question.question_text.substring(0, 50)}..."`);
        
        let retries = 0;
        let embedding = null;
        
        while (retries < 3 && !embedding) {
          try {
            embedding = await aiService.generateEmbedding(question.question_text);
          } catch (error) {
            if (error.message.includes('Rate limit')) {
              retries++;
              logger.warn(`Rate limit hit, retry ${retries}/3`);
              continue;
            }
            throw error;
          }
        }
        
        if (!embedding) {
          logger.error(`Failed to generate embedding after 3 retries for question ${question.id}`);
          processed++;
          continue;
        }
        
        const updateQuery = `
          UPDATE questions 
          SET embedding = $1, updated_at = NOW()
          WHERE id = $2
        `;
        
        await db.query(updateQuery, [JSON.stringify(embedding), question.id]);
        successful++;
        
        logger.info(`✅ Success! ${successful}/${missingCount} embeddings generated`);
        
      } catch (embeddingError) {
        logger.error(`❌ Failed to generate embedding for question ${question.id}:`, embeddingError.message);
      }
      
      processed++;
      
      // Very conservative delay: 10 seconds between each request
      if (processed < missingCount) {
        logger.info('Waiting 10 seconds before next request...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
    
    logger.info(`✅ Completed conservative embedding generation: ${successful}/${missingCount} successful`);
    
    if (successful > 0) {
      logger.info('\n🧪 Testing FAQ generation...');
      
      const FAQService = require('../src/services/faqService');
      const faqService = new FAQService();
      
      const result = await faqService.generateFAQs({
        minQuestionCount: 1, // Allow single-question FAQs
        maxFAQs: 10, // Start with fewer FAQs
        forceRegenerate: false
      });
      
      logger.info('FAQ Generation Result:', result);
      
      if (result.generated > 0 || result.updated > 0) {
        logger.info('🎉 FAQ generation is now working!');
      } else {
        logger.warn('⚠️ FAQ generation still not creating FAQs. May need to check similarity thresholds.');
      }
    }
    
  } catch (error) {
    logger.error('Conservative embedding generation failed:', error);
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

// Run the conservative fix
generateEmbeddingsConservatively();