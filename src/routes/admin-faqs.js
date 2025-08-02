const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get all public FAQs for admin management
 * GET /api/admin/faqs
 */
router.get('/faqs', requireAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      category = '',
      status = ''
    } = req.query;

    const offset = (page - 1) * limit;
    
    // Build query conditions
    let whereConditions = ['1=1'];
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

    // Add status filter
    if (status === 'published') {
      whereConditions.push('is_published = true');
    } else if (status === 'draft') {
      whereConditions.push('is_published = false');
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
        is_published, view_count, helpful_count, not_helpful_count,
        sort_order, created_at, updated_at
      FROM public_faqs
      WHERE ${whereClause}
      ORDER BY sort_order ASC, created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    queryParams.push(limit, offset);
    const faqsResult = await db.query(faqsQuery, queryParams);

    // Get unique categories
    const categoriesQuery = `
      SELECT DISTINCT category
      FROM public_faqs
      WHERE category IS NOT NULL
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
      categories: categoriesResult.rows.map(row => row.category)
    });

  } catch (error) {
    logger.error('Admin FAQs route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load FAQs'
    });
  }
});

/**
 * Create new public FAQ
 * POST /api/admin/faqs
 */
router.post('/faqs', requireAuth, [
  body('title').notEmpty().withMessage('Title is required'),
  body('question').notEmpty().withMessage('Question is required'),
  body('answer').notEmpty().withMessage('Answer is required'),
  body('category').optional(),
  body('tags').optional().isArray(),
  body('is_published').optional().isBoolean(),
  body('sort_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      title,
      question,
      answer,
      category = null,
      tags = [],
      is_published = false,
      sort_order = 0
    } = req.body;

    const query = `
      INSERT INTO public_faqs (
        title, question, answer, category, tags, 
        is_published, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await db.query(query, [
      title, question, answer, category, tags, is_published, sort_order
    ]);

    logger.info(`Admin created FAQ: ${title}`);

    res.status(201).json({
      success: true,
      faq: result.rows[0],
      message: 'FAQ created successfully'
    });

  } catch (error) {
    logger.error('Create FAQ route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create FAQ'
    });
  }
});

/**
 * Update public FAQ
 * PUT /api/admin/faqs/:id
 */
router.put('/faqs/:id', requireAuth, [
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('question').optional().notEmpty().withMessage('Question cannot be empty'),
  body('answer').optional().notEmpty().withMessage('Answer cannot be empty'),
  body('category').optional(),
  body('tags').optional().isArray(),
  body('is_published').optional().isBoolean(),
  body('sort_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const updateFields = req.body;

    // Check if FAQ exists
    const checkQuery = 'SELECT id FROM public_faqs WHERE id = $1';
    const checkResult = await db.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    // Build update query dynamically
    const allowedFields = ['title', 'question', 'answer', 'category', 'tags', 'is_published', 'sort_order'];
    const updates = [];
    const values = [];
    let paramIndex = 1;

    for (const [field, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(field) && value !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    values.push(id);
    const updateQuery = `
      UPDATE public_faqs 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(updateQuery, values);

    logger.info(`Admin updated FAQ: ${result.rows[0].title}`);

    res.json({
      success: true,
      faq: result.rows[0],
      message: 'FAQ updated successfully'
    });

  } catch (error) {
    logger.error('Update FAQ route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQ'
    });
  }
});

/**
 * Delete public FAQ
 * DELETE /api/admin/faqs/:id
 */
router.delete('/faqs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if FAQ exists
    const checkQuery = 'SELECT title FROM public_faqs WHERE id = $1';
    const checkResult = await db.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    const title = checkResult.rows[0].title;

    // Delete FAQ
    await db.query('DELETE FROM public_faqs WHERE id = $1', [id]);

    logger.info(`Admin deleted FAQ: ${title}`);

    res.json({
      success: true,
      message: 'FAQ deleted successfully'
    });

  } catch (error) {
    logger.error('Delete FAQ route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete FAQ'
    });
  }
});

/**
 * Bulk update FAQ status
 * POST /api/admin/faqs/bulk-update
 */
router.post('/faqs/bulk-update', requireAuth, [
  body('ids').isArray().withMessage('IDs array is required'),
  body('action').isIn(['publish', 'unpublish', 'delete']).withMessage('Valid action is required')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { ids, action } = req.body;

    if (ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No IDs provided'
      });
    }

    let query;
    let message;

    switch (action) {
      case 'publish':
        query = 'UPDATE public_faqs SET is_published = true WHERE id = ANY($1)';
        message = 'FAQs published successfully';
        break;
      case 'unpublish':
        query = 'UPDATE public_faqs SET is_published = false WHERE id = ANY($1)';
        message = 'FAQs unpublished successfully';
        break;
      case 'delete':
        query = 'DELETE FROM public_faqs WHERE id = ANY($1)';
        message = 'FAQs deleted successfully';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action'
        });
    }

    const result = await db.query(query, [ids]);

    logger.info(`Admin bulk ${action} FAQs: ${result.rowCount} affected`);

    res.json({
      success: true,
      message,
      affected: result.rowCount
    });

  } catch (error) {
    logger.error('Bulk update FAQs route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQs'
    });
  }
});

/**
 * Get FAQ statistics for admin
 * GET /api/admin/faqs/stats
 */
router.get('/faqs/stats', requireAuth, async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_faqs,
        COUNT(CASE WHEN is_published = true THEN 1 END) as published_faqs,
        COUNT(CASE WHEN is_published = false THEN 1 END) as draft_faqs,
        COUNT(DISTINCT category) as total_categories,
        SUM(view_count) as total_views,
        SUM(helpful_count) as total_helpful,
        SUM(not_helpful_count) as total_not_helpful,
        AVG(view_count) as avg_views,
        MAX(view_count) as max_views
      FROM public_faqs
    `;

    const result = await db.query(statsQuery);
    const stats = result.rows[0];

    res.json({
      success: true,
      stats: {
        totalFaqs: parseInt(stats.total_faqs),
        publishedFaqs: parseInt(stats.published_faqs),
        draftFaqs: parseInt(stats.draft_faqs),
        totalCategories: parseInt(stats.total_categories),
        totalViews: parseInt(stats.total_views || 0),
        totalHelpful: parseInt(stats.total_helpful || 0),
        totalNotHelpful: parseInt(stats.total_not_helpful || 0),
        avgViews: parseFloat(stats.avg_views || 0),
        maxViews: parseInt(stats.max_views || 0)
      }
    });

  } catch (error) {
    logger.error('Admin FAQ stats route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load statistics'
    });
  }
});

module.exports = router; 