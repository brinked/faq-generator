const express = require('express');
const db = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get public FAQs with search and filtering (from faq_groups table)
 * GET /api/public/faqs
 */
router.get('/faqs', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', sort = 'recent', category = '' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'fg.is_published = true';
    let queryParams = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (fg.title ILIKE $${paramIndex} OR fg.representative_question ILIKE $${paramIndex} OR fg.consolidated_answer ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      whereClause += ` AND fg.category = $${paramIndex}`;
      queryParams.push(category);
      paramIndex++;
    }

    const faqsQuery = `
      SELECT
        fg.id,
        fg.title,
        fg.representative_question as question,
        fg.consolidated_answer as answer,
        fg.category,
        fg.tags,
        fg.view_count,
        fg.helpful_count,
        fg.not_helpful_count,
        fg.created_at,
        fg.updated_at
      FROM faq_groups fg
      WHERE ${whereClause}
      ORDER BY ${sort === 'popular' ? 'fg.view_count DESC, fg.helpful_count DESC' : 'fg.sort_order ASC, fg.created_at DESC'}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const faqsResult = await db.query(faqsQuery, [...queryParams, limit, offset]);

    const totalResult = await db.query(`SELECT COUNT(*) FROM faq_groups fg WHERE ${whereClause}`, queryParams);
    const total = parseInt(totalResult.rows[0].count, 10);

    res.json({
      success: true,
      faqs: faqsResult.rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Public FAQs route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch public FAQs'
    });
  }
});

/**
 * Get a single public FAQ by ID
 * GET /api/public/faqs/:id
 */
router.get('/faqs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const updateViewCountQuery = `
      UPDATE faq_groups
      SET view_count = view_count + 1,
          updated_at = NOW()
      WHERE id = $1 AND is_published = true;
    `;
    await db.query(updateViewCountQuery, [id]);

    const faqQuery = `
      SELECT 
        id, 
        title,
        representative_question as question,
        consolidated_answer as answer,
        category, 
        tags,
        view_count,
        helpful_count,
        not_helpful_count,
        created_at, 
        updated_at
      FROM faq_groups
      WHERE id = $1 AND is_published = true;
    `;
    const result = await db.query(faqQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found or not published.'
      });
    }

    res.json({
      success: true,
      faq: result.rows[0]
    });

  } catch (error) {
    logger.error('Get public FAQ by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQ.'
    });
  }
});

/**
 * Mark FAQ as helpful or not helpful
 * POST /api/public/faqs/:id/feedback
 */
router.post('/faqs/:id/feedback', async (req, res) => {
  try {
    const { id } = req.params;
    const { helpful } = req.body;

    if (typeof helpful !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Helpful field is required and must be a boolean.'
      });
    }

    const columnToUpdate = helpful ? 'helpful_count' : 'not_helpful_count';

    const updateQuery = `
      UPDATE faq_groups
      SET ${columnToUpdate} = ${columnToUpdate} + 1,
          updated_at = NOW()
      WHERE id = $1 AND is_published = true
      RETURNING helpful_count, not_helpful_count;
    `;

    const result = await db.query(updateQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found or not published.'
      });
    }

    res.json({
      success: true,
      message: 'Feedback recorded successfully.',
      feedback: result.rows[0]
    });

  } catch (error) {
    logger.error('Error recording FAQ feedback:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record feedback.'
    });
  }
});

/**
 * Search FAQs with semantic similarity
 * POST /api/public/faqs/search
 */
router.post('/faqs/search', async (req, res) => {
  try {
    const { query, limit = 10 } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Query is required'
      });
    }

    // Simple text search for now (can be enhanced with embeddings later)
    const searchQuery = `
      SELECT 
        id, title, question, answer, category, tags,
        view_count, helpful_count, not_helpful_count,
        sort_order, created_at, updated_at,
        ts_rank(to_tsvector('english', title || ' ' || question || ' ' || answer), plainto_tsquery('english', $1)) as rank
      FROM public_faqs
      WHERE is_published = true 
        AND to_tsvector('english', title || ' ' || question || ' ' || answer) @@ plainto_tsquery('english', $1)
      ORDER BY rank DESC, sort_order ASC
      LIMIT $2
    `;

    const result = await db.query(searchQuery, [query, limit]);

    res.json({
      success: true,
      faqs: result.rows,
      query,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('FAQ search route error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed'
    });
  }
});

/**
 * Get FAQ statistics
 * GET /api/public/faqs/stats
 */
router.get('/faqs/stats', async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_faqs,
        COUNT(DISTINCT category) as total_categories,
        SUM(view_count) as total_views,
        SUM(helpful_count) as total_helpful,
        SUM(not_helpful_count) as total_not_helpful
      FROM public_faqs
      WHERE is_published = true
    `;

    const result = await db.query(statsQuery);
    const stats = result.rows[0];

    res.json({
      success: true,
      stats: {
        totalFaqs: parseInt(stats.total_faqs),
        totalCategories: parseInt(stats.total_categories),
        totalViews: parseInt(stats.total_views || 0),
        totalHelpful: parseInt(stats.total_helpful || 0),
        totalNotHelpful: parseInt(stats.total_not_helpful || 0)
      }
    });

  } catch (error) {
    logger.error('FAQ stats route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load statistics'
    });
  }
});

module.exports = router; 