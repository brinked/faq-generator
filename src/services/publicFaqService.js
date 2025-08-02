const db = require('../config/database');
const logger = require('../utils/logger');

class PublicFaqService {
  /**
   * Sync internal FAQ groups to public FAQs
   */
  async syncFromInternalFAQs() {
    try {
      logger.info('Starting sync from internal FAQ groups to public FAQs...');
      
      // Get all published internal FAQ groups
      const internalFaqs = await db.query(`
        SELECT 
          id, title, representative_question, consolidated_answer,
          category, tags, frequency_score, avg_confidence
        FROM faq_groups 
        WHERE is_published = true
        ORDER BY frequency_score DESC, avg_confidence DESC
      `);
      
      let synced = 0;
      let updated = 0;
      
      for (const internalFaq of internalFaqs.rows) {
        // Check if public FAQ already exists for this internal FAQ
        const existingPublicFaq = await db.query(`
          SELECT id FROM public_faqs 
          WHERE title = $1 AND question = $2
        `, [internalFaq.title, internalFaq.representative_question]);
        
        if (existingPublicFaq.rows.length === 0) {
          // Create new public FAQ
          await db.query(`
            INSERT INTO public_faqs (
              title, question, answer, category, tags, 
              is_published, sort_order, search_keywords
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            internalFaq.title,
            internalFaq.representative_question,
            internalFaq.consolidated_answer,
            internalFaq.category,
            internalFaq.tags || [],
            true,
            Math.floor(internalFaq.frequency_score * 10), // Use frequency as sort order
            this.generateSearchKeywords(internalFaq.title, internalFaq.representative_question)
          ]);
          synced++;
        } else {
          // Update existing public FAQ
          await db.query(`
            UPDATE public_faqs 
            SET 
              answer = $1,
              category = $2,
              tags = $3,
              sort_order = $4,
              search_keywords = $5,
              updated_at = NOW()
            WHERE id = $6
          `, [
            internalFaq.consolidated_answer,
            internalFaq.category,
            internalFaq.tags || [],
            Math.floor(internalFaq.frequency_score * 10),
            this.generateSearchKeywords(internalFaq.title, internalFaq.representative_question),
            existingPublicFaq.rows[0].id
          ]);
          updated++;
        }
      }
      
      logger.info(`Public FAQ sync completed: ${synced} created, ${updated} updated`);
      return { synced, updated };
      
    } catch (error) {
      logger.error('Public FAQ sync failed:', error);
      throw error;
    }
  }
  
  /**
   * Generate search keywords from title and question
   */
  generateSearchKeywords(title, question) {
    const text = `${title} ${question}`.toLowerCase();
    const words = text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .slice(0, 10); // Limit to 10 keywords
    return words;
  }
  
  /**
   * Get public FAQs with filtering and pagination
   */
  async getPublicFAQs(options = {}) {
    try {
      const {
        search = '',
        category = '',
        page = 1,
        limit = 20,
        sort = 'sort_order'
      } = options;
      
      const offset = (page - 1) * limit;
      
      // Build query conditions
      let whereConditions = ['is_published = true'];
      let queryParams = [];
      let paramIndex = 1;
      
      // Add search condition
      if (search.trim()) {
        whereConditions.push(`(
          to_tsvector('english', title || ' ' || question || ' ' || answer) @@ plainto_tsquery('english', $${paramIndex}) OR
          title ILIKE $${paramIndex + 1} OR
          question ILIKE $${paramIndex + 1} OR
          answer ILIKE $${paramIndex + 1}
        )`);
        queryParams.push(search, `%${search}%`);
        paramIndex += 2;
      }
      
      // Add category filter
      if (category.trim()) {
        whereConditions.push(`category = $${paramIndex}`);
        queryParams.push(category);
        paramIndex++;
      }
      
      const whereClause = whereConditions.join(' AND ');
      
      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM public_faqs
        WHERE ${whereClause}
      `;
      
      const countResult = await db.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);
      
      // Get FAQs with pagination
      const faqsQuery = `
        SELECT 
          id, title, question, answer, category, tags,
          view_count, helpful_count, not_helpful_count,
          sort_order, created_at, updated_at
        FROM public_faqs
        WHERE ${whereClause}
        ORDER BY ${sort === 'recent' ? 'created_at DESC' : 'sort_order ASC, created_at DESC'}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      queryParams.push(limit, offset);
      const faqsResult = await db.query(faqsQuery, queryParams);
      
      return {
        faqs: faqsResult.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
      
    } catch (error) {
      logger.error('Get public FAQs error:', error);
      throw error;
    }
  }
  
  /**
   * Create or update public FAQ
   */
  async upsertPublicFAQ(faqData) {
    try {
      const {
        title,
        question,
        answer,
        category = null,
        tags = [],
        is_published = true,
        sort_order = 0
      } = faqData;
      
      // Check if FAQ already exists
      const existingFaq = await db.query(`
        SELECT id FROM public_faqs 
        WHERE title = $1 AND question = $2
      `, [title, question]);
      
      if (existingFaq.rows.length === 0) {
        // Create new FAQ
        const result = await db.query(`
          INSERT INTO public_faqs (
            title, question, answer, category, tags,
            is_published, sort_order, search_keywords
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          title, question, answer, category, tags,
          is_published, sort_order,
          this.generateSearchKeywords(title, question)
        ]);
        
        logger.info(`Created public FAQ: ${title}`);
        return result.rows[0];
      } else {
        // Update existing FAQ
        const result = await db.query(`
          UPDATE public_faqs 
          SET 
            answer = $1,
            category = $2,
            tags = $3,
            is_published = $4,
            sort_order = $5,
            search_keywords = $6,
            updated_at = NOW()
          WHERE id = $7
          RETURNING *
        `, [
          answer, category, tags, is_published, sort_order,
          this.generateSearchKeywords(title, question),
          existingFaq.rows[0].id
        ]);
        
        logger.info(`Updated public FAQ: ${title}`);
        return result.rows[0];
      }
      
    } catch (error) {
      logger.error('Upsert public FAQ error:', error);
      throw error;
    }
  }
  
  /**
   * Delete public FAQ
   */
  async deletePublicFAQ(id) {
    try {
      const result = await db.query(`
        DELETE FROM public_faqs 
        WHERE id = $1
        RETURNING title
      `, [id]);
      
      if (result.rows.length > 0) {
        logger.info(`Deleted public FAQ: ${result.rows[0].title}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Delete public FAQ error:', error);
      throw error;
    }
  }
  
  /**
   * Get public FAQ statistics
   */
  async getPublicFAQStats() {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_faqs,
          COUNT(DISTINCT category) as total_categories,
          SUM(view_count) as total_views,
          SUM(helpful_count) as total_helpful,
          SUM(not_helpful_count) as total_not_helpful
        FROM public_faqs
        WHERE is_published = true
      `);
      
      const stats = result.rows[0];
      return {
        totalFaqs: parseInt(stats.total_faqs),
        totalCategories: parseInt(stats.total_categories),
        totalViews: parseInt(stats.total_views || 0),
        totalHelpful: parseInt(stats.total_helpful || 0),
        totalNotHelpful: parseInt(stats.total_not_helpful || 0)
      };
    } catch (error) {
      logger.error('Get public FAQ stats error:', error);
      throw error;
    }
  }
}

module.exports = PublicFaqService; 