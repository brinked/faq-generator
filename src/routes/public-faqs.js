const express = require('express');
const db = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get public FAQs with search and filtering
 * GET /api/public/faqs
 */
router.get('/faqs', async (req, res) => {
  try {
    const {
      search = '',
      category = '',
      page = 1,
      limit = 20,
      sort = 'sort_order'
    } = req.query;

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

    // Get unique categories for filtering
    const categoriesQuery = `
      SELECT DISTINCT category
      FROM public_faqs
      WHERE is_published = true AND category IS NOT NULL
      ORDER BY category
    `;
    const categoriesResult = await db.query(categoriesQuery);

    res.json({
      success: true,
      faqs: faqsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      categories: categoriesResult.rows.map(row => row.category),
      search,
      category
    });

  } catch (error) {
    logger.error('Public FAQs route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load FAQs'
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

    const query = `
      SELECT 
        id, title, question, answer, category, tags,
        view_count, helpful_count, not_helpful_count,
        sort_order, created_at, updated_at
      FROM public_faqs
      WHERE id = $1 AND is_published = true
    `;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    // Increment view count
    await db.query(
      'UPDATE public_faqs SET view_count = view_count + 1 WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      faq: result.rows[0]
    });

  } catch (error) {
    logger.error('Get public FAQ route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load FAQ'
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
        message: 'Helpful field is required and must be boolean'
      });
    }

    // Check if FAQ exists and is published
    const checkQuery = `
      SELECT id FROM public_faqs 
      WHERE id = $1 AND is_published = true
    `;
    const checkResult = await db.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    // Update feedback count
    const updateField = helpful ? 'helpful_count' : 'not_helpful_count';
    const updateQuery = `
      UPDATE public_faqs 
      SET ${updateField} = ${updateField} + 1 
      WHERE id = $1
    `;
    
    await db.query(updateQuery, [id]);

    res.json({
      success: true,
      message: 'Feedback recorded'
    });

  } catch (error) {
    logger.error('FAQ feedback route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record feedback'
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