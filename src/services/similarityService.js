const db = require('../config/database');
const logger = require('../utils/logger');
const AIService = require('./aiService');

class SimilarityService {
  constructor() {
    this.aiService = new AIService();
    this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.8;
  }

  /**
   * Find similar questions using vector similarity
   */
  async findSimilarQuestions(questionId, threshold = null) {
    try {
      threshold = threshold || this.similarityThreshold;

      const query = `
        SELECT 
          q2.id,
          q2.question_text,
          q2.answer_text,
          q2.confidence_score,
          1 - (q1.embedding <=> q2.embedding) as similarity_score
        FROM questions q1
        CROSS JOIN questions q2
        WHERE q1.id = $1 
          AND q2.id != $1
          AND q1.embedding IS NOT NULL 
          AND q2.embedding IS NOT NULL
          AND 1 - (q1.embedding <=> q2.embedding) >= $2
        ORDER BY similarity_score DESC
        LIMIT 50
      `;

      const result = await db.query(query, [questionId, threshold]);
      
      logger.info(`Found ${result.rows.length} similar questions for question ${questionId}`);
      return result.rows;

    } catch (error) {
      logger.error(`Error finding similar questions for ${questionId}:`, error);
      throw error;
    }
  }

  /**
   * Find similar questions using text embedding
   */
  async findSimilarQuestionsByText(questionText, threshold = null, limit = 20) {
    try {
      threshold = threshold || this.similarityThreshold;

      // Generate embedding for the input question
      const embedding = await this.aiService.generateEmbedding(questionText);

      const query = `
        SELECT 
          id,
          question_text,
          answer_text,
          confidence_score,
          1 - (embedding <=> $1::vector) as similarity_score
        FROM questions
        WHERE embedding IS NOT NULL
          AND 1 - (embedding <=> $1::vector) >= $2
        ORDER BY similarity_score DESC
        LIMIT $3
      `;

      const result = await db.query(query, [JSON.stringify(embedding), threshold, limit]);
      
      logger.info(`Found ${result.rows.length} similar questions for text: "${questionText.substring(0, 50)}..."`);
      return result.rows;

    } catch (error) {
      logger.error('Error finding similar questions by text:', error);
      throw error;
    }
  }

  /**
   * Calculate similarity matrix for a batch of questions
   */
  async calculateSimilarityMatrix(questionIds) {
    try {
      const query = `
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
      `;

      const result = await db.query(query, [questionIds]);
      
      // Organize results into a matrix format
      const matrix = {};
      for (const row of result.rows) {
        if (!matrix[row.question1_id]) {
          matrix[row.question1_id] = {};
        }
        matrix[row.question1_id][row.question2_id] = parseFloat(row.similarity_score);
      }

      logger.info(`Calculated similarity matrix for ${questionIds.length} questions`);
      return matrix;

    } catch (error) {
      logger.error('Error calculating similarity matrix:', error);
      throw error;
    }
  }

  /**
   * Cluster similar questions using hierarchical clustering
   */
  async clusterSimilarQuestions(questionIds, threshold = null) {
    try {
      threshold = threshold || this.similarityThreshold;

      // Get similarity matrix
      const similarityMatrix = await this.calculateSimilarityMatrix(questionIds);
      
      // Perform hierarchical clustering
      const clusters = this.performHierarchicalClustering(questionIds, similarityMatrix, threshold);
      
      logger.info(`Created ${clusters.length} clusters from ${questionIds.length} questions`);
      return clusters;

    } catch (error) {
      logger.error('Error clustering similar questions:', error);
      throw error;
    }
  }

  /**
   * Perform hierarchical clustering algorithm
   */
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

  /**
   * Calculate similarity between two clusters (average linkage)
   */
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

  /**
   * Generate a unique cluster ID
   */
  generateClusterId() {
    return 'cluster_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Find the best representative question for a cluster
   */
  async findRepresentativeQuestion(questionIds) {
    try {
      if (questionIds.length === 1) {
        const query = 'SELECT * FROM questions WHERE id = $1';
        const result = await db.query(query, [questionIds[0]]);
        return result.rows[0];
      }

      // Calculate average similarity for each question to all others in the cluster
      const query = `
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
      `;

      const result = await db.query(query, [questionIds]);
      
      if (result.rows.length === 0) {
        // Fallback: return the question with highest confidence
        const fallbackQuery = `
          SELECT * FROM questions 
          WHERE id = ANY($1::uuid[])
          ORDER BY confidence_score DESC
          LIMIT 1
        `;
        const fallbackResult = await db.query(fallbackQuery, [questionIds]);
        return fallbackResult.rows[0];
      }

      return result.rows[0];

    } catch (error) {
      logger.error('Error finding representative question:', error);
      throw error;
    }
  }

  /**
   * Update question embeddings for questions without them
   */
  async updateMissingEmbeddings(batchSize = 50) {
    try {
      // Get questions without embeddings
      const query = `
        SELECT id, question_text 
        FROM questions 
        WHERE embedding IS NULL 
        ORDER BY created_at DESC
        LIMIT $1
      `;

      const result = await db.query(query, [batchSize]);
      const questions = result.rows;

      if (questions.length === 0) {
        logger.info('No questions need embedding updates');
        return { updated: 0 };
      }

      logger.info(`Updating embeddings for ${questions.length} questions`);

      // Generate embeddings in batch
      const texts = questions.map(q => q.question_text);
      const embeddings = await this.aiService.generateEmbeddingsBatch(texts);

      // Update database with embeddings
      let updated = 0;
      for (let i = 0; i < questions.length; i++) {
        try {
          const updateQuery = `
            UPDATE questions 
            SET embedding = $1::vector, updated_at = NOW()
            WHERE id = $2
          `;
          
          await db.query(updateQuery, [JSON.stringify(embeddings[i]), questions[i].id]);
          updated++;
        } catch (error) {
          logger.warn(`Failed to update embedding for question ${questions[i].id}:`, error);
        }
      }

      logger.info(`Updated embeddings for ${updated} questions`);
      return { updated };

    } catch (error) {
      logger.error('Error updating missing embeddings:', error);
      throw error;
    }
  }

  /**
   * Find duplicate questions (very high similarity)
   */
  async findDuplicateQuestions(threshold = 0.95) {
    try {
      const query = `
        SELECT 
          q1.id as question1_id,
          q1.question_text as question1_text,
          q2.id as question2_id,
          q2.question_text as question2_text,
          1 - (q1.embedding <=> q2.embedding) as similarity_score
        FROM questions q1
        CROSS JOIN questions q2
        WHERE q1.id < q2.id
          AND q1.embedding IS NOT NULL 
          AND q2.embedding IS NOT NULL
          AND 1 - (q1.embedding <=> q2.embedding) >= $1
        ORDER BY similarity_score DESC
      `;

      const result = await db.query(query, [threshold]);
      
      logger.info(`Found ${result.rows.length} potential duplicate question pairs`);
      return result.rows;

    } catch (error) {
      logger.error('Error finding duplicate questions:', error);
      throw error;
    }
  }

  /**
   * Get similarity statistics
   */
  async getSimilarityStats() {
    try {
      const stats = {};

      // Total questions with embeddings
      const totalQuery = `
        SELECT 
          COUNT(*) as total_questions,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL) as questions_with_embeddings
        FROM questions
      `;
      const totalResult = await db.query(totalQuery);
      stats.questions = totalResult.rows[0];

      // Average similarity distribution
      const distributionQuery = `
        SELECT 
          CASE 
            WHEN similarity >= 0.9 THEN '0.9-1.0'
            WHEN similarity >= 0.8 THEN '0.8-0.9'
            WHEN similarity >= 0.7 THEN '0.7-0.8'
            WHEN similarity >= 0.6 THEN '0.6-0.7'
            WHEN similarity >= 0.5 THEN '0.5-0.6'
            ELSE '0.0-0.5'
          END as similarity_range,
          COUNT(*) as count
        FROM (
          SELECT 1 - (q1.embedding <=> q2.embedding) as similarity
          FROM questions q1
          CROSS JOIN questions q2
          WHERE q1.id < q2.id
            AND q1.embedding IS NOT NULL 
            AND q2.embedding IS NOT NULL
          LIMIT 10000
        ) similarities
        GROUP BY similarity_range
        ORDER BY similarity_range DESC
      `;
      const distributionResult = await db.query(distributionQuery);
      stats.similarityDistribution = distributionResult.rows;

      return stats;

    } catch (error) {
      logger.error('Error getting similarity stats:', error);
      throw error;
    }
  }

  /**
   * Optimize similarity search performance
   */
  async optimizeSearchPerformance() {
    try {
      logger.info('Starting similarity search optimization...');

      // Create or refresh HNSW index for better vector search performance
      const indexQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_questions_embedding_hnsw_optimized 
        ON questions USING hnsw (embedding vector_cosine_ops) 
        WITH (m = 16, ef_construction = 64)
      `;

      await db.query(indexQuery);

      // Update table statistics
      await db.query('ANALYZE questions');

      logger.info('Similarity search optimization completed');
      return { success: true };

    } catch (error) {
      logger.error('Error optimizing similarity search:', error);
      throw error;
    }
  }
}

module.exports = SimilarityService;