const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get all FAQs for admin management (from faq_groups table)
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
        to_tsvector('english', COALESCE(title, '') || ' ' || representative_question || ' ' || consolidated_answer) @@ plainto_tsquery('english', $${paramIndex}) OR
        COALESCE(title, '') ILIKE $${paramIndex + 1} OR
        representative_question ILIKE $${paramIndex + 1} OR
        consolidated_answer ILIKE $${paramIndex + 1}
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

    // Get total count from faq_groups
    const countQuery = `
      SELECT COUNT(*) as total
      FROM faq_groups
      WHERE ${whereClause}
    `;

    const countResult = await db.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get FAQs with pagination from faq_groups
    const faqsQuery = `
      SELECT 
        id, 
        title,
        representative_question as question,
        consolidated_answer as answer,
        category, 
        tags, 
        is_published, 
        0 as view_count,
        0 as helpful_count,
        0 as not_helpful_count,
        COALESCE(sort_order, 0) as sort_order,
        question_count,
        frequency_score,
        avg_confidence,
        created_at, 
        updated_at
      FROM faq_groups
      WHERE ${whereClause}
      ORDER BY sort_order ASC, created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const faqsResult = await db.query(faqsQuery, queryParams);

    // Get unique categories from faq_groups
    const categoriesQuery = `
      SELECT DISTINCT category
      FROM faq_groups
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
      categories: categoriesResult.rows.map(row => row.category),
      search,
      category
    });

  } catch (error) {
    logger.error('Admin FAQs route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQs'
    });
  }
});

/**
 * Create a new FAQ
 * POST /api/admin/faqs
 */
router.post('/faqs', requireAuth, [
  body('question').notEmpty().withMessage('Question is required'),
  body('answer').notEmpty().withMessage('Answer is required'),
  body('title').optional(),
  body('category').optional(),
  body('tags').optional().custom((value) => {
    if (value === null || value === undefined) return true;
    return Array.isArray(value);
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { question, answer, title, category, tags } = req.body;

    // Insert into faq_groups table
    const result = await db.query(`
      INSERT INTO faq_groups (title, representative_question, consolidated_answer, category, tags, is_published, sort_order)
      VALUES ($1, $2, $3, $4, $5, false, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM faq_groups))
      RETURNING *
    `, [title || question, question, answer, category, tags || []]);

    res.json({
      success: true,
      faq: result.rows[0],
      message: 'FAQ created successfully'
    });

  } catch (error) {
    logger.error('Create FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create FAQ'
    });
  }
});

/**
 * Reorder FAQs (must be before the parameterized route)
 * PUT /api/admin/faqs/reorder
 */
router.put('/faqs/reorder', requireAuth, [
  body('faqs').isArray().withMessage('FAQs array is required')
], async (req, res) => {
  try {
    console.log('🔧 Reorder endpoint called with:', req.body);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { faqs } = req.body;

    // Update sort_order for each FAQ in faq_groups
    for (let i = 0; i < faqs.length; i++) {
      const faq = faqs[i];
      console.log(`Updating FAQ ${faq.id} to sort_order ${faq.sort_order}`);

      await db.query(
        'UPDATE faq_groups SET sort_order = $1 WHERE id = $2',
        [faq.sort_order, faq.id]
      );
    }

    res.json({
      success: true,
      message: 'FAQ order updated successfully'
    });

  } catch (error) {
    logger.error('Reorder FAQs error:', error);
    console.error('Reorder error details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder FAQs'
    });
  }
});

/**
 * Update an existing FAQ
 * PUT /api/admin/faqs/:id
 */
router.put('/faqs/:id', requireAuth, [
  body('question').optional(),
  body('answer').optional(),
  body('title').optional(),
  body('category').optional(),
  body('tags').optional().custom((value) => {
    if (value === null || value === undefined) return true;
    return Array.isArray(value);
  }),
  body('is_published').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { question, answer, title, category, tags, is_published } = req.body;

    // Check if FAQ exists in faq_groups
    let result = await db.query('SELECT * FROM faq_groups WHERE id = $1', [id]);

    if (result.rows.length > 0) {
      // Update faq_groups
      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      if (question !== undefined) {
        updateFields.push(`representative_question = $${paramIndex++}`);
        values.push(question);
      }
      if (answer !== undefined) {
        updateFields.push(`consolidated_answer = $${paramIndex++}`);
        values.push(answer);
      }
      if (title !== undefined) {
        updateFields.push(`title = $${paramIndex++}`);
        values.push(title);
      }
      if (category !== undefined) {
        updateFields.push(`category = $${paramIndex++}`);
        values.push(category);
      }
      if (tags !== undefined) {
        updateFields.push(`tags = $${paramIndex++}`);
        values.push(tags);
      }
      if (is_published !== undefined) {
        updateFields.push(`is_published = $${paramIndex++}`);
        values.push(is_published);
      }

      updateFields.push(`updated_at = NOW()`);
      values.push(id);

      const updateQuery = `
        UPDATE faq_groups 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      result = await db.query(updateQuery, values);
    } else {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    res.json({
      success: true,
      faq: result.rows[0],
      message: 'FAQ updated successfully'
    });

  } catch (error) {
    logger.error('Update FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQ'
    });
  }
});

/**
 * Delete an FAQ
 * DELETE /api/admin/faqs/:id
 */
router.delete('/faqs/:id', requireAuth, async (req, res) => {
  try {
    console.log('Deleting FAQ with ID:', req.params.id);
    const { id } = req.params;

    // Start a transaction to ensure data consistency
    await db.query('BEGIN');

    try {
      // First, delete related question_groups records
      const deleteQuestionGroupsResult = await db.query(
        'DELETE FROM question_groups WHERE group_id = $1 RETURNING *',
        [id]
      );
      console.log(`Deleted ${deleteQuestionGroupsResult.rows.length} question_groups records`);

      // Then delete from faq_groups
      const deleteFaqGroupsResult = await db.query(
        'DELETE FROM faq_groups WHERE id = $1 RETURNING *',
        [id]
      );

      if (deleteFaqGroupsResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'FAQ not found'
        });
      }

      // Commit the transaction
      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'FAQ deleted successfully',
        deletedQuestionGroups: deleteQuestionGroupsResult.rows.length
      });

    } catch (error) {
      // Rollback on any error
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    logger.error('Delete FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete FAQ',
      error: error.message
    });
  }
});

module.exports = router;
