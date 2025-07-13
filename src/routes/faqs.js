const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const FAQService = require('../services/faqService');
const SimilarityService = require('../services/similarityService');

const faqService = new FAQService();
const similarityService = new SimilarityService();

/**
 * Get all FAQs with pagination and filtering
 */
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category = null,
      published = null,
      search = null,
      sortBy = 'frequency_score',
      sortOrder = 'DESC'
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      category,
      published: published !== null ? published === 'true' : null,
      search,
      sortBy,
      sortOrder
    };

    const result = await faqService.getFAQs(options);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Error getting FAQs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get FAQs'
    });
  }
});

/**
 * Get FAQ by ID
 */
router.get('/:faqId', async (req, res) => {
  try {
    const { faqId } = req.params;
    
    const faq = await faqService.getFAQById(faqId);
    
    res.json({
      success: true,
      faq
    });
    
  } catch (error) {
    logger.error(`Error getting FAQ ${req.params.faqId}:`, error);
    res.status(404).json({
      success: false,
      error: 'FAQ not found'
    });
  }
});

/**
 * Update FAQ
 */
router.put('/:faqId', async (req, res) => {
  try {
    const { faqId } = req.params;
    const updates = req.body;
    
    // Validate required fields
    const allowedFields = [
      'title', 'representative_question', 'consolidated_answer',
      'is_published', 'category', 'tags'
    ];
    
    const validUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        validUpdates[key] = value;
      }
    }
    
    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields provided for update'
      });
    }
    
    const updatedFAQ = await faqService.updateFAQ(faqId, validUpdates);
    
    res.json({
      success: true,
      faq: updatedFAQ
    });
    
  } catch (error) {
    logger.error(`Error updating FAQ ${req.params.faqId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Delete FAQ
 */
router.delete('/:faqId', async (req, res) => {
  try {
    const { faqId } = req.params;
    
    await faqService.deleteFAQ(faqId);
    
    res.json({
      success: true,
      message: 'FAQ deleted successfully'
    });
    
  } catch (error) {
    logger.error(`Error deleting FAQ ${req.params.faqId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete FAQ'
    });
  }
});

/**
 * Search FAQs by similarity to a question
 */
router.post('/search', async (req, res) => {
  try {
    const { question, limit = 10 } = req.body;
    
    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'Question is required for search'
      });
    }
    
    const results = await faqService.searchSimilarFAQs(question, parseInt(limit));
    
    res.json({
      success: true,
      query: question,
      results,
      count: results.length
    });
    
  } catch (error) {
    logger.error('Error searching FAQs:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

/**
 * Get FAQ categories
 */
router.get('/meta/categories', async (req, res) => {
  try {
    const db = require('../config/database');
    
    const query = `
      SELECT 
        category,
        COUNT(*) as faq_count,
        COUNT(*) FILTER (WHERE is_published = true) as published_count
      FROM faq_groups 
      WHERE category IS NOT NULL
      GROUP BY category
      ORDER BY faq_count DESC
    `;
    
    const result = await db.query(query);
    
    res.json({
      success: true,
      categories: result.rows
    });
    
  } catch (error) {
    logger.error('Error getting FAQ categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get categories'
    });
  }
});

/**
 * Get FAQ tags
 */
router.get('/meta/tags', async (req, res) => {
  try {
    const db = require('../config/database');
    
    const query = `
      SELECT 
        unnest(tags) as tag,
        COUNT(*) as usage_count
      FROM faq_groups 
      WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
      GROUP BY tag
      ORDER BY usage_count DESC
      LIMIT 50
    `;
    
    const result = await db.query(query);
    
    res.json({
      success: true,
      tags: result.rows
    });
    
  } catch (error) {
    logger.error('Error getting FAQ tags:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get tags'
    });
  }
});

/**
 * Bulk update FAQ status (publish/unpublish)
 */
router.patch('/bulk/status', async (req, res) => {
  try {
    const { faqIds, isPublished } = req.body;
    
    if (!Array.isArray(faqIds) || faqIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'FAQ IDs array is required'
      });
    }
    
    if (typeof isPublished !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isPublished must be a boolean'
      });
    }
    
    const db = require('../config/database');
    
    const query = `
      UPDATE faq_groups 
      SET is_published = $1, updated_at = NOW()
      WHERE id = ANY($2::uuid[])
      RETURNING id, title, is_published
    `;
    
    const result = await db.query(query, [isPublished, faqIds]);
    
    logger.info(`Bulk updated ${result.rows.length} FAQs to ${isPublished ? 'published' : 'unpublished'}`);
    
    res.json({
      success: true,
      updated: result.rows,
      count: result.rows.length
    });
    
  } catch (error) {
    logger.error('Error bulk updating FAQ status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update FAQ status'
    });
  }
});

/**
 * Bulk delete FAQs
 */
router.delete('/bulk', async (req, res) => {
  try {
    const { faqIds } = req.body;
    
    if (!Array.isArray(faqIds) || faqIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'FAQ IDs array is required'
      });
    }
    
    const db = require('../config/database');
    
    await db.transaction(async (client) => {
      // Delete question associations
      await client.query('DELETE FROM question_groups WHERE group_id = ANY($1::uuid[])', [faqIds]);
      
      // Delete FAQs
      const result = await client.query('DELETE FROM faq_groups WHERE id = ANY($1::uuid[]) RETURNING id, title', [faqIds]);
      
      logger.info(`Bulk deleted ${result.rows.length} FAQs`);
      
      return result.rows;
    });
    
    res.json({
      success: true,
      message: `Successfully deleted ${faqIds.length} FAQs`
    });
    
  } catch (error) {
    logger.error('Error bulk deleting FAQs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete FAQs'
    });
  }
});

/**
 * Generate FAQs from questions
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      minQuestionCount = 2,
      maxFAQs = 100,
      forceRegenerate = false
    } = req.body;
    
    const result = await faqService.generateFAQs({
      minQuestionCount: parseInt(minQuestionCount),
      maxFAQs: parseInt(maxFAQs),
      forceRegenerate
    });
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    logger.error('Error generating FAQs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get FAQ statistics
 */
router.get('/meta/stats', async (req, res) => {
  try {
    const stats = await faqService.getFAQStats();
    
    res.json({
      success: true,
      stats
    });
    
  } catch (error) {
    logger.error('Error getting FAQ stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get FAQ statistics'
    });
  }
});

/**
 * Export FAQs
 */
router.get('/export', async (req, res) => {
  try {
    const { format = 'json', published = true } = req.query;
    
    const result = await faqService.getFAQs({
      published: published === 'true',
      limit: 1000, // Large limit for export
      sortBy: 'frequency_score',
      sortOrder: 'DESC'
    });
    
    const faqs = result.faqs;
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvHeader = 'Title,Question,Answer,Category,Frequency Score,Question Count,Published\n';
      const csvRows = faqs.map(faq => {
        const title = `"${(faq.title || '').replace(/"/g, '""')}"`;
        const question = `"${(faq.representative_question || '').replace(/"/g, '""')}"`;
        const answer = `"${(faq.consolidated_answer || '').replace(/"/g, '""')}"`;
        const category = `"${(faq.category || '').replace(/"/g, '""')}"`;
        const frequency = faq.frequency_score || 0;
        const questionCount = faq.question_count || 0;
        const published = faq.is_published ? 'Yes' : 'No';
        
        return `${title},${question},${answer},${category},${frequency},${questionCount},${published}`;
      }).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="faqs.csv"');
      res.send(csvContent);
      
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="faqs.json"');
      res.json({
        exported_at: new Date().toISOString(),
        total_faqs: faqs.length,
        faqs: faqs
      });
    }
    
  } catch (error) {
    logger.error('Error exporting FAQs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export FAQs'
    });
  }
});

/**
 * Get similar FAQs for a given FAQ
 */
router.get('/:faqId/similar', async (req, res) => {
  try {
    const { faqId } = req.params;
    const { limit = 5 } = req.query;
    
    // Get the FAQ first
    const faq = await faqService.getFAQById(faqId);
    
    // Find similar FAQs using the representative question
    const similarFAQs = await faqService.searchSimilarFAQs(
      faq.representative_question, 
      parseInt(limit) + 1 // +1 to exclude the current FAQ
    );
    
    // Filter out the current FAQ
    const filteredSimilar = similarFAQs.filter(similar => similar.id !== faqId);
    
    res.json({
      success: true,
      faqId,
      similar: filteredSimilar.slice(0, parseInt(limit))
    });
    
  } catch (error) {
    logger.error(`Error getting similar FAQs for ${req.params.faqId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get similar FAQs'
    });
  }
});

/**
 * Merge FAQs
 */
router.post('/merge', async (req, res) => {
  try {
    const { sourceFaqIds, targetFaqId } = req.body;
    
    if (!Array.isArray(sourceFaqIds) || sourceFaqIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Source FAQ IDs array is required'
      });
    }
    
    if (!targetFaqId) {
      return res.status(400).json({
        success: false,
        error: 'Target FAQ ID is required'
      });
    }
    
    const db = require('../config/database');
    
    await db.transaction(async (client) => {
      // Move all questions from source FAQs to target FAQ
      await client.query(`
        UPDATE question_groups 
        SET group_id = $1
        WHERE group_id = ANY($2::uuid[])
      `, [targetFaqId, sourceFaqIds]);
      
      // Delete source FAQs
      await client.query('DELETE FROM faq_groups WHERE id = ANY($1::uuid[])', [sourceFaqIds]);
      
      // Update target FAQ statistics
      await client.query('SELECT update_faq_group_stats($1)', [targetFaqId]);
    });
    
    logger.info(`Merged ${sourceFaqIds.length} FAQs into FAQ ${targetFaqId}`);
    
    res.json({
      success: true,
      message: `Successfully merged ${sourceFaqIds.length} FAQs`
    });
    
  } catch (error) {
    logger.error('Error merging FAQs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to merge FAQs'
    });
  }
});

module.exports = router;