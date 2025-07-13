const db = require('../config/database');
const logger = require('../utils/logger');
const AIService = require('./aiService');
const SimilarityService = require('./similarityService');

class FAQService {
  constructor() {
    this.aiService = new AIService();
    this.similarityService = new SimilarityService();
    this.autoPublishThreshold = parseInt(process.env.FAQ_AUTO_PUBLISH_THRESHOLD) || 5;
  }

  /**
   * Generate FAQs from processed questions
   */
  async generateFAQs(options = {}) {
    try {
      const {
        minQuestionCount = 2,
        maxFAQs = 100,
        forceRegenerate = false
      } = options;

      logger.info('Starting FAQ generation process...');
      const startTime = Date.now();

      // Get unprocessed questions with embeddings
      const questions = await this.getQuestionsForFAQGeneration();
      
      if (questions.length === 0) {
        logger.info('No questions available for FAQ generation');
        return { generated: 0, updated: 0 };
      }

      logger.info(`Processing ${questions.length} questions for FAQ generation`);

      // Cluster similar questions
      const questionIds = questions.map(q => q.id);
      const clusters = await this.similarityService.clusterSimilarQuestions(questionIds);

      // Filter clusters by minimum question count
      const validClusters = clusters.filter(cluster => cluster.questions.length >= minQuestionCount);
      
      logger.info(`Created ${validClusters.length} valid clusters from ${clusters.length} total clusters`);

      let generated = 0;
      let updated = 0;

      // Process each cluster to create/update FAQs
      for (const cluster of validClusters.slice(0, maxFAQs)) {
        try {
          const result = await this.processClusterToFAQ(cluster, questions, forceRegenerate);
          if (result.isNew) {
            generated++;
          } else if (result.isUpdated) {
            updated++;
          }
        } catch (error) {
          logger.error(`Error processing cluster ${cluster.id}:`, error);
        }
      }

      // Update question group associations
      await this.updateQuestionGroupAssociations();

      // Update FAQ statistics
      await this.updateFAQStatistics();

      const duration = Date.now() - startTime;
      logger.logFaqGeneration(questions.length, generated + updated, duration);

      return {
        processed: questions.length,
        clusters: validClusters.length,
        generated,
        updated,
        duration
      };

    } catch (error) {
      logger.error('Error generating FAQs:', error);
      throw error;
    }
  }

  /**
   * Get questions that are ready for FAQ generation
   */
  async getQuestionsForFAQGeneration() {
    try {
      const query = `
        SELECT q.*, e.subject as email_subject
        FROM questions q
        JOIN emails e ON q.email_id = e.id
        WHERE q.embedding IS NOT NULL
          AND q.is_customer_question = true
          AND q.confidence_score >= $1
        ORDER BY q.confidence_score DESC, q.created_at DESC
      `;

      const minConfidence = parseFloat(process.env.QUESTION_CONFIDENCE_THRESHOLD) || 0.7;
      const result = await db.query(query, [minConfidence]);
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting questions for FAQ generation:', error);
      throw error;
    }
  }

  /**
   * Process a cluster of similar questions into a FAQ
   */
  async processClusterToFAQ(cluster, allQuestions, forceRegenerate = false) {
    try {
      // Get questions in this cluster
      const clusterQuestions = allQuestions.filter(q => cluster.questions.includes(q.id));
      
      // Find representative question
      const representative = await this.similarityService.findRepresentativeQuestion(cluster.questions);
      
      // Check if FAQ already exists for this cluster
      const existingFAQ = await this.findExistingFAQForCluster(cluster.questions);
      
      if (existingFAQ && !forceRegenerate) {
        // Update existing FAQ with new questions
        return await this.updateExistingFAQ(existingFAQ, clusterQuestions, representative);
      }

      // Create new FAQ
      return await this.createNewFAQ(clusterQuestions, representative);

    } catch (error) {
      logger.error('Error processing cluster to FAQ:', error);
      throw error;
    }
  }

  /**
   * Find existing FAQ that might match this cluster
   */
  async findExistingFAQForCluster(questionIds) {
    try {
      const query = `
        SELECT fg.*, COUNT(qg.question_id) as matching_questions
        FROM faq_groups fg
        JOIN question_groups qg ON fg.id = qg.group_id
        WHERE qg.question_id = ANY($1::uuid[])
        GROUP BY fg.id
        ORDER BY matching_questions DESC
        LIMIT 1
      `;

      const result = await db.query(query, [questionIds]);
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error finding existing FAQ for cluster:', error);
      return null;
    }
  }

  /**
   * Create a new FAQ from a cluster of questions
   */
  async createNewFAQ(questions, representative) {
    try {
      // Improve the representative question
      const improvedQuestion = await this.aiService.improveQuestionText(
        representative.question_text,
        representative.context_before || ''
      );

      // Collect all answers
      const answers = questions
        .map(q => q.answer_text)
        .filter(answer => answer && answer.trim().length > 0);

      // Generate consolidated answer
      const consolidatedAnswer = await this.aiService.generateConsolidatedAnswer(
        questions.map(q => q.question_text),
        answers
      );

      // Categorize the question
      const category = await this.aiService.categorizeQuestion(improvedQuestion);

      // Extract tags
      const tags = await this.aiService.extractTags(improvedQuestion);

      // Generate embedding for the representative question
      const embedding = await this.aiService.generateEmbedding(improvedQuestion);

      // Calculate frequency score
      const frequencyScore = questions.length * (questions.reduce((sum, q) => sum + q.confidence_score, 0) / questions.length);

      // Create FAQ group
      const insertQuery = `
        INSERT INTO faq_groups (
          title, representative_question, consolidated_answer, question_count,
          frequency_score, avg_confidence, representative_embedding,
          is_published, category, tags, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING *
      `;

      const title = this.generateFAQTitle(improvedQuestion);
      const avgConfidence = questions.reduce((sum, q) => sum + q.confidence_score, 0) / questions.length;
      const isPublished = questions.length >= this.autoPublishThreshold;

      const result = await db.query(insertQuery, [
        title,
        improvedQuestion,
        consolidatedAnswer,
        questions.length,
        frequencyScore,
        avgConfidence,
        JSON.stringify(embedding),
        isPublished,
        category,
        tags
      ]);

      const faqGroup = result.rows[0];

      // Associate questions with the FAQ group
      await this.associateQuestionsWithFAQ(faqGroup.id, questions, representative.id);

      logger.info(`Created new FAQ: "${title}" with ${questions.length} questions`);

      return {
        faq: faqGroup,
        isNew: true,
        isUpdated: false
      };

    } catch (error) {
      logger.error('Error creating new FAQ:', error);
      throw error;
    }
  }

  /**
   * Update an existing FAQ with new questions
   */
  async updateExistingFAQ(existingFAQ, newQuestions, representative) {
    try {
      // Get current questions in the FAQ
      const currentQuestionsQuery = `
        SELECT q.* FROM questions q
        JOIN question_groups qg ON q.id = qg.question_id
        WHERE qg.group_id = $1
      `;
      const currentResult = await db.query(currentQuestionsQuery, [existingFAQ.id]);
      const currentQuestions = currentResult.rows;

      // Combine current and new questions
      const allQuestions = [...currentQuestions];
      for (const newQ of newQuestions) {
        if (!allQuestions.find(q => q.id === newQ.id)) {
          allQuestions.push(newQ);
        }
      }

      // Check if update is needed
      if (allQuestions.length === currentQuestions.length) {
        return {
          faq: existingFAQ,
          isNew: false,
          isUpdated: false
        };
      }

      // Regenerate consolidated answer with all questions
      const answers = allQuestions
        .map(q => q.answer_text)
        .filter(answer => answer && answer.trim().length > 0);

      const consolidatedAnswer = await this.aiService.generateConsolidatedAnswer(
        allQuestions.map(q => q.question_text),
        answers
      );

      // Update FAQ statistics
      const avgConfidence = allQuestions.reduce((sum, q) => sum + q.confidence_score, 0) / allQuestions.length;
      const frequencyScore = allQuestions.length * avgConfidence;
      const isPublished = allQuestions.length >= this.autoPublishThreshold;

      // Update FAQ group
      const updateQuery = `
        UPDATE faq_groups 
        SET consolidated_answer = $1, question_count = $2, frequency_score = $3,
            avg_confidence = $4, is_published = $5, updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `;

      const result = await db.query(updateQuery, [
        consolidatedAnswer,
        allQuestions.length,
        frequencyScore,
        avgConfidence,
        isPublished,
        existingFAQ.id
      ]);

      // Associate new questions with the FAQ group
      const newQuestionIds = newQuestions.filter(nq => 
        !currentQuestions.find(cq => cq.id === nq.id)
      );
      
      if (newQuestionIds.length > 0) {
        await this.associateQuestionsWithFAQ(existingFAQ.id, newQuestionIds, representative.id);
      }

      logger.info(`Updated FAQ "${existingFAQ.title}" with ${newQuestionIds.length} new questions`);

      return {
        faq: result.rows[0],
        isNew: false,
        isUpdated: true
      };

    } catch (error) {
      logger.error('Error updating existing FAQ:', error);
      throw error;
    }
  }

  /**
   * Associate questions with a FAQ group
   */
  async associateQuestionsWithFAQ(faqGroupId, questions, representativeQuestionId) {
    try {
      for (const question of questions) {
        const similarity = question.id === representativeQuestionId ? 1.0 : 0.85; // Approximate similarity
        const isRepresentative = question.id === representativeQuestionId;

        const query = `
          INSERT INTO question_groups (question_id, group_id, similarity_score, is_representative)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (question_id, group_id) 
          DO UPDATE SET similarity_score = EXCLUDED.similarity_score,
                       is_representative = EXCLUDED.is_representative
        `;

        await db.query(query, [question.id, faqGroupId, similarity, isRepresentative]);
      }
    } catch (error) {
      logger.error('Error associating questions with FAQ:', error);
      throw error;
    }
  }

  /**
   * Generate a concise title for the FAQ
   */
  generateFAQTitle(question) {
    // Remove question marks and truncate if too long
    let title = question.replace(/\?+$/, '').trim();
    
    if (title.length > 100) {
      title = title.substring(0, 97) + '...';
    }
    
    return title;
  }

  /**
   * Get all FAQs with pagination and filtering
   */
  async getFAQs(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        category = null,
        published = null,
        search = null,
        sortBy = 'frequency_score',
        sortOrder = 'DESC'
      } = options;

      const offset = (page - 1) * limit;
      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      // Build WHERE conditions
      if (category) {
        whereConditions.push(`category = $${paramIndex++}`);
        queryParams.push(category);
      }

      if (published !== null) {
        whereConditions.push(`is_published = $${paramIndex++}`);
        queryParams.push(published);
      }

      if (search) {
        whereConditions.push(`(
          to_tsvector('english', title || ' ' || representative_question || ' ' || consolidated_answer) 
          @@ plainto_tsquery('english', $${paramIndex++})
        )`);
        queryParams.push(search);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Main query
      const query = `
        SELECT 
          fg.*,
          COUNT(qg.question_id) as actual_question_count
        FROM faq_groups fg
        LEFT JOIN question_groups qg ON fg.id = qg.group_id
        ${whereClause}
        GROUP BY fg.id
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      queryParams.push(limit, offset);

      const result = await db.query(query, queryParams);

      // Count total for pagination
      const countQuery = `
        SELECT COUNT(DISTINCT fg.id) as total
        FROM faq_groups fg
        LEFT JOIN question_groups qg ON fg.id = qg.group_id
        ${whereClause}
      `;

      const countResult = await db.query(countQuery, queryParams.slice(0, -2));
      const total = parseInt(countResult.rows[0].total);

      return {
        faqs: result.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      logger.error('Error getting FAQs:', error);
      throw error;
    }
  }

  /**
   * Get FAQ by ID with associated questions
   */
  async getFAQById(faqId) {
    try {
      // Get FAQ details
      const faqQuery = 'SELECT * FROM faq_groups WHERE id = $1';
      const faqResult = await db.query(faqQuery, [faqId]);
      
      if (faqResult.rows.length === 0) {
        throw new Error('FAQ not found');
      }

      const faq = faqResult.rows[0];

      // Get associated questions
      const questionsQuery = `
        SELECT q.*, qg.similarity_score, qg.is_representative, e.subject as email_subject
        FROM questions q
        JOIN question_groups qg ON q.id = qg.question_id
        JOIN emails e ON q.email_id = e.id
        WHERE qg.group_id = $1
        ORDER BY qg.is_representative DESC, qg.similarity_score DESC
      `;

      const questionsResult = await db.query(questionsQuery, [faqId]);

      return {
        ...faq,
        questions: questionsResult.rows
      };

    } catch (error) {
      logger.error(`Error getting FAQ ${faqId}:`, error);
      throw error;
    }
  }

  /**
   * Update FAQ manually
   */
  async updateFAQ(faqId, updates) {
    try {
      const allowedFields = [
        'title', 'representative_question', 'consolidated_answer',
        'is_published', 'category', 'tags'
      ];

      const updateFields = [];
      const queryParams = [];
      let paramIndex = 1;

      for (const [field, value] of Object.entries(updates)) {
        if (allowedFields.includes(field)) {
          updateFields.push(`${field} = $${paramIndex++}`);
          queryParams.push(value);
        }
      }

      if (updateFields.length === 0) {
        throw new Error('No valid fields to update');
      }

      updateFields.push(`updated_at = NOW()`);
      queryParams.push(faqId);

      const query = `
        UPDATE faq_groups 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await db.query(query, queryParams);
      
      if (result.rows.length === 0) {
        throw new Error('FAQ not found');
      }

      logger.info(`FAQ ${faqId} updated successfully`);
      return result.rows[0];

    } catch (error) {
      logger.error(`Error updating FAQ ${faqId}:`, error);
      throw error;
    }
  }

  /**
   * Delete FAQ and its associations
   */
  async deleteFAQ(faqId) {
    try {
      await db.transaction(async (client) => {
        // Delete question associations
        await client.query('DELETE FROM question_groups WHERE group_id = $1', [faqId]);
        
        // Delete FAQ
        await client.query('DELETE FROM faq_groups WHERE id = $1', [faqId]);
      });

      logger.info(`FAQ ${faqId} deleted successfully`);

    } catch (error) {
      logger.error(`Error deleting FAQ ${faqId}:`, error);
      throw error;
    }
  }

  /**
   * Update question group associations
   */
  async updateQuestionGroupAssociations() {
    try {
      // This function can be used to recalculate associations if needed
      const query = `
        SELECT fg.id, 
               array_agg(qg.question_id) as question_ids
        FROM faq_groups fg
        JOIN question_groups qg ON fg.id = qg.group_id
        GROUP BY fg.id
      `;

      const result = await db.query(query);
      
      for (const row of result.rows) {
        await db.query(
          'SELECT update_faq_group_stats($1)',
          [row.id]
        );
      }

      logger.info('Updated question group associations');

    } catch (error) {
      logger.error('Error updating question group associations:', error);
      throw error;
    }
  }

  /**
   * Update FAQ statistics
   */
  async updateFAQStatistics() {
    try {
      const query = `
        UPDATE faq_groups 
        SET question_count = (
          SELECT COUNT(*) 
          FROM question_groups 
          WHERE group_id = faq_groups.id
        ),
        avg_confidence = (
          SELECT AVG(q.confidence_score)
          FROM questions q
          JOIN question_groups qg ON q.id = qg.question_id
          WHERE qg.group_id = faq_groups.id
        ),
        frequency_score = (
          SELECT COUNT(*) * AVG(q.confidence_score)
          FROM questions q
          JOIN question_groups qg ON q.id = qg.question_id
          WHERE qg.group_id = faq_groups.id
        ),
        updated_at = NOW()
      `;

      await db.query(query);
      logger.info('Updated FAQ statistics');

    } catch (error) {
      logger.error('Error updating FAQ statistics:', error);
      throw error;
    }
  }

  /**
   * Get FAQ generation statistics
   */
  async getFAQStats() {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_faqs,
          COUNT(*) FILTER (WHERE is_published = true) as published_faqs,
          AVG(question_count) as avg_questions_per_faq,
          AVG(frequency_score) as avg_frequency_score,
          MAX(frequency_score) as max_frequency_score,
          COUNT(DISTINCT category) as categories_count
        FROM faq_groups
      `;

      const result = await db.query(query);
      return result.rows[0];

    } catch (error) {
      logger.error('Error getting FAQ stats:', error);
      throw error;
    }
  }

  /**
   * Search FAQs by similarity to a question
   */
  async searchSimilarFAQs(questionText, limit = 10) {
    try {
      // Generate embedding for the search query
      const embedding = await this.aiService.generateEmbedding(questionText);

      const query = `
        SELECT 
          fg.*,
          1 - (fg.representative_embedding <=> $1::vector) as similarity_score
        FROM faq_groups fg
        WHERE fg.representative_embedding IS NOT NULL
          AND fg.is_published = true
          AND 1 - (fg.representative_embedding <=> $1::vector) >= 0.7
        ORDER BY similarity_score DESC
        LIMIT $2
      `;

      const result = await db.query(query, [JSON.stringify(embedding), limit]);
      return result.rows;

    } catch (error) {
      logger.error('Error searching similar FAQs:', error);
      throw error;
    }
  }
}

module.exports = FAQService;