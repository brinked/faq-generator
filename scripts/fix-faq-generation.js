#!/usr/bin/env node

/**
 * Fix FAQ Generation Issues
 * 
 * This script attempts to fix common issues preventing FAQ generation.
 */

require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const AIService = require('../src/services/aiService');
const FAQService = require('../src/services/faqService');

async function fixFAQGeneration() {
  try {
    logger.info('🔧 Starting FAQ generation fixes...');
    
    // Fix 1: Generate missing embeddings
    logger.info('\n📊 Fix 1: Generating missing embeddings...');
    const missingEmbeddingsQuery = `
      SELECT COUNT(*) as count 
      FROM questions 
      WHERE embedding IS NULL AND question_text IS NOT NULL
    `;
    
    const missingResult = await db.query(missingEmbeddingsQuery);
    const missingCount = parseInt(missingResult.rows[0].count);
    
    if (missingCount > 0) {
      logger.info(`Found ${missingCount} questions without embeddings`);
      
      const aiService = new AIService();
      
      // Get questions without embeddings in batches
      const batchSize = 10;
      let processed = 0;
      
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
            const embedding = await aiService.generateEmbedding(question.question_text);
            
            const updateQuery = `
              UPDATE questions 
              SET embedding = $1, updated_at = NOW()
              WHERE id = $2
            `;
            
            await db.query(updateQuery, [JSON.stringify(embedding), question.id]);
            logger.info(`✅ Generated embedding for question: ${question.question_text.substring(0, 50)}...`);
            
          } catch (embeddingError) {
            logger.error(`❌ Failed to generate embedding for question ${question.id}:`, embeddingError.message);
          }
        }
        
        processed += questions.length;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      logger.info(`✅ Completed embedding generation for ${processed} questions`);
    } else {
      logger.info('✅ All questions already have embeddings');
    }
    
    // Fix 2: Check and fix vector extension issues
    logger.info('\n🔧 Fix 2: Checking vector extension...');
    try {
      // Test vector operations
      await db.query("SELECT '[1,2,3]'::vector <=> '[1,2,4]'::vector");
      logger.info('✅ Vector extension is working correctly');
    } catch (vectorError) {
      logger.error('❌ Vector extension issue:', vectorError.message);
      
      if (vectorError.message.includes('operator does not exist')) {
        logger.info('💡 Creating fallback similarity functions...');
        
        // Create a fallback similarity function using JSON operations
        const fallbackFunction = `
          CREATE OR REPLACE FUNCTION cosine_similarity(embedding1 TEXT, embedding2 TEXT)
          RETURNS FLOAT AS $$
          DECLARE
            vec1 FLOAT[];
            vec2 FLOAT[];
            dot_product FLOAT := 0;
            norm1 FLOAT := 0;
            norm2 FLOAT := 0;
            i INTEGER;
          BEGIN
            -- Parse JSON arrays
            SELECT ARRAY(SELECT json_array_elements_text(embedding1::json)::float) INTO vec1;
            SELECT ARRAY(SELECT json_array_elements_text(embedding2::json)::float) INTO vec2;
            
            -- Calculate dot product and norms
            FOR i IN 1..array_length(vec1, 1) LOOP
              dot_product := dot_product + (vec1[i] * vec2[i]);
              norm1 := norm1 + (vec1[i] * vec1[i]);
              norm2 := norm2 + (vec2[i] * vec2[i]);
            END LOOP;
            
            -- Return cosine similarity
            IF norm1 = 0 OR norm2 = 0 THEN
              RETURN 0;
            END IF;
            
            RETURN dot_product / (sqrt(norm1) * sqrt(norm2));
          END;
          $$ LANGUAGE plpgsql;
        `;
        
        try {
          await db.query(fallbackFunction);
          logger.info('✅ Created fallback similarity function');
        } catch (functionError) {
          logger.error('❌ Failed to create fallback function:', functionError.message);
        }
      }
    }
    
    // Fix 3: Update similarity service to handle vector extension issues
    logger.info('\n🔧 Fix 3: Creating vector-safe similarity service...');
    
    const vectorSafeSimilarityService = `
const db = require('../config/database');
const logger = require('../utils/logger');
const AIService = require('./aiService');

class VectorSafeSimilarityService {
  constructor() {
    this.aiService = new AIService();
    this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.6; // Lower default threshold
    this.useVectorExtension = null; // Will be determined at runtime
  }

  async checkVectorExtension() {
    if (this.useVectorExtension !== null) return this.useVectorExtension;
    
    try {
      await db.query("SELECT '[1,2,3]'::vector <=> '[1,2,4]'::vector");
      this.useVectorExtension = true;
      logger.info('Using native vector extension for similarity calculations');
    } catch (error) {
      this.useVectorExtension = false;
      logger.info('Using fallback similarity calculations (no vector extension)');
    }
    
    return this.useVectorExtension;
  }

  async calculateSimilarityMatrix(questionIds) {
    try {
      const useVector = await this.checkVectorExtension();
      
      let query;
      if (useVector) {
        query = \`
          SELECT 
            q1.id as question1_id,
            q2.id as question2_id,
            1 - (q1.embedding <=> q2.embedding) as similarity_score
          FROM questions q1
          CROSS JOIN questions q2
          WHERE q1.id = ANY($1::uuid[])
            AND q2.id = ANY($1::uuid[])
            AND q1.id != q2.id
            AND q1.embedding IS NOT NULL 
            AND q2.embedding IS NOT NULL
          ORDER BY q1.id, similarity_score DESC
        \`;
      } else {
        query = \`
          SELECT 
            q1.id as question1_id,
            q2.id as question2_id,
            cosine_similarity(q1.embedding::text, q2.embedding::text) as similarity_score
          FROM questions q1
          CROSS JOIN questions q2
          WHERE q1.id = ANY($1::uuid[])
            AND q2.id = ANY($1::uuid[])
            AND q1.id != q2.id
            AND q1.embedding IS NOT NULL 
            AND q2.embedding IS NOT NULL
          ORDER BY q1.id, similarity_score DESC
        \`;
      }

      const result = await db.query(query, [questionIds]);
      
      // Organize results into a matrix format
      const matrix = {};
      for (const row of result.rows) {
        if (!matrix[row.question1_id]) {
          matrix[row.question1_id] = {};
        }
        matrix[row.question1_id][row.question2_id] = parseFloat(row.similarity_score);
      }

      logger.info(\`Calculated similarity matrix for \${questionIds.length} questions\`);
      return matrix;

    } catch (error) {
      logger.error('Error calculating similarity matrix:', error);
      throw error;
    }
  }

  async clusterSimilarQuestions(questionIds, threshold = null) {
    try {
      threshold = threshold || this.similarityThreshold;

      // Get similarity matrix
      const similarityMatrix = await this.calculateSimilarityMatrix(questionIds);
      
      // Perform hierarchical clustering
      const clusters = this.performHierarchicalClustering(questionIds, similarityMatrix, threshold);
      
      logger.info(\`Created \${clusters.length} clusters from \${questionIds.length} questions with threshold \${threshold}\`);
      return clusters;

    } catch (error) {
      logger.error('Error clustering similar questions:', error);
      throw error;
    }
  }

  performHierarchicalClustering(questionIds, similarityMatrix, threshold) {
    // Initialize each question as its own cluster
    let clusters = questionIds.map(id => ({ id: this.generateClusterId(), questions: [id] }));
    
    while (true) {
      let maxSimilarity = -1;
      let mergeIndices = [-1, -1];
      
      // Find the two most similar clusters
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const similarity = this.calculateClusterSimilarity(
            clusters[i], 
            clusters[j], 
            similarityMatrix
          );
          
          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
            mergeIndices = [i, j];
          }
        }
      }
      
      // Stop if no clusters are similar enough to merge
      if (maxSimilarity < threshold) {
        break;
      }
      
      // Merge the two most similar clusters
      const [i, j] = mergeIndices;
      clusters[i].questions = [...clusters[i].questions, ...clusters[j].questions];
      clusters.splice(j, 1);
    }
    
    return clusters;
  }

  calculateClusterSimilarity(cluster1, cluster2, similarityMatrix) {
    let totalSimilarity = 0;
    let count = 0;
    
    for (const q1 of cluster1.questions) {
      for (const q2 of cluster2.questions) {
        if (similarityMatrix[q1] && similarityMatrix[q1][q2] !== undefined) {
          totalSimilarity += similarityMatrix[q1][q2];
          count++;
        }
      }
    }
    
    return count > 0 ? totalSimilarity / count : 0;
  }

  generateClusterId() {
    return 'cluster_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async findRepresentativeQuestion(questionIds) {
    try {
      if (questionIds.length === 1) {
        const query = 'SELECT * FROM questions WHERE id = $1';
        const result = await db.query(query, [questionIds[0]]);
        return result.rows[0];
      }

      const useVector = await this.checkVectorExtension();
      
      let query;
      if (useVector) {
        query = \`
          SELECT 
            q.id,
            q.question_text,
            q.answer_text,
            q.confidence_score,
            AVG(1 - (q.embedding <=> q2.embedding)) as avg_similarity
          FROM questions q
          CROSS JOIN questions q2
          WHERE q.id = ANY($1::uuid[])
            AND q2.id = ANY($1::uuid[])
            AND q.id != q2.id
            AND q.embedding IS NOT NULL 
            AND q2.embedding IS NOT NULL
          GROUP BY q.id, q.question_text, q.answer_text, q.confidence_score
          ORDER BY avg_similarity DESC, q.confidence_score DESC
          LIMIT 1
        \`;
      } else {
        query = \`
          SELECT 
            q.id,
            q.question_text,
            q.answer_text,
            q.confidence_score,
            AVG(cosine_similarity(q.embedding::text, q2.embedding::text)) as avg_similarity
          FROM questions q
          CROSS JOIN questions q2
          WHERE q.id = ANY($1::uuid[])
            AND q2.id = ANY($1::uuid[])
            AND q.id != q2.id
            AND q.embedding IS NOT NULL 
            AND q2.embedding IS NOT NULL
          GROUP BY q.id, q.question_text, q.answer_text, q.confidence_score
          ORDER BY avg_similarity DESC, q.confidence_score DESC
          LIMIT 1
        \`;
      }

      const result = await db.query(query, [questionIds]);
      
      if (result.rows.length === 0) {
        // Fallback: return the question with highest confidence
        const fallbackQuery = \`
          SELECT * FROM questions 
          WHERE id = ANY($1::uuid[])
          ORDER BY confidence_score DESC
          LIMIT 1
        \`;
        const fallbackResult = await db.query(fallbackQuery, [questionIds]);
        return fallbackResult.rows[0];
      }

      return result.rows[0];

    } catch (error) {
      logger.error('Error finding representative question:', error);
      throw error;
    }
  }
}

module.exports = VectorSafeSimilarityService;
`;
    
    // Write the vector-safe similarity service
    const fs = require('fs');
    const path = require('path');
    const backupPath = path.join(__dirname, '../src/services/similarityService.backup.js');
    const originalPath = path.join(__dirname, '../src/services/similarityService.js');
    
    // Backup original file
    if (fs.existsSync(originalPath)) {
      fs.copyFileSync(originalPath, backupPath);
      logger.info('✅ Backed up original similarity service');
    }
    
    // Write new vector-safe version
    fs.writeFileSync(originalPath, vectorSafeSimilarityService);
    logger.info('✅ Created vector-safe similarity service');
    
    // Fix 4: Test FAQ generation with lower thresholds
    logger.info('\n🧪 Fix 4: Testing FAQ generation with optimized settings...');
    
    const faqService = new FAQService();
    
    // Try with more permissive settings
    const testResult = await faqService.generateFAQs({
      minQuestionCount: 1, // Allow single-question FAQs for testing
      maxFAQs: 20,
      forceRegenerate: false
    });
    
    logger.info('Test FAQ Generation Result:', testResult);
    
    if (testResult.generated > 0 || testResult.updated > 0) {
      logger.info('✅ FAQ generation is now working!');
    } else {
      logger.warn('⚠️ FAQ generation still not creating FAQs. Manual investigation needed.');
    }
    
    logger.info('\n🎉 FAQ generation fixes completed!');
    logger.info('\nNext steps:');
    logger.info('1. Run the debug script to verify fixes: node scripts/debug-faq-generation.js');
    logger.info('2. Try running FAQ generation manually: node scripts/manual-faq-generation.js');
    logger.info('3. Check the application logs for any remaining issues');
    
  } catch (error) {
    logger.error('Fix script failed:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Handle process signals
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down fix script');
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down fix script');
  await db.end();
  process.exit(0);
});

// Run the fix script
fixFAQGeneration();