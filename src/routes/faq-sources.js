const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const db = require('../config/database');

/**
 * Get email sources for a specific FAQ
 * Returns all emails where questions for this FAQ were found
 */
router.get('/:faqId/sources', async (req, res) => {
  try {
    const { faqId } = req.params;
    
    logger.info(`Getting email sources for FAQ ${faqId}`);
    
    // Get all questions associated with this FAQ group
    const query = `
      SELECT
        q.id as question_id,
        q.question_text,
        q.sender_email,
        q.sender_name,
        q.email_subject,
        q.confidence_score,
        q.created_at as question_created_at,
        e.received_at,
        e.sent_at,
        e.subject as full_subject,
        e.body_text,
        qg.similarity_score,
        qg.is_representative
      FROM questions q
      JOIN question_groups qg ON q.id = qg.question_id
      JOIN emails e ON q.email_id = e.id
      WHERE qg.group_id = $1
      ORDER BY qg.is_representative DESC, qg.similarity_score DESC, e.received_at DESC
    `;
    
    const result = await db.query(query, [faqId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'FAQ not found or no email sources available'
      });
    }
    
    // Group and format the email sources
    const emailSources = result.rows.map(row => ({
      questionId: row.question_id,
      questionText: row.question_text,
      senderEmail: row.sender_email,
      senderName: row.sender_name || 'Unknown',
      emailSubject: row.email_subject || row.full_subject || 'No Subject',
      confidenceScore: parseFloat(row.confidence_score || 0),
      similarityScore: parseFloat(row.similarity_score || 0),
      isRepresentative: row.is_representative,
      receivedAt: row.received_at,
      sentAt: row.sent_at,
      questionCreatedAt: row.question_created_at,
      emailPreview: row.body_text ? row.body_text.substring(0, 200) + '...' : 'No content',
      emailBodyText: row.body_text || 'No content available'
    }));
    
    // Get FAQ group info
    const faqQuery = `
      SELECT title, representative_question, question_count
      FROM faq_groups 
      WHERE id = $1
    `;
    const faqResult = await db.query(faqQuery, [faqId]);
    const faqInfo = faqResult.rows[0];
    
    res.json({
      success: true,
      faq: {
        id: faqId,
        title: faqInfo?.title || 'Unknown FAQ',
        representativeQuestion: faqInfo?.representative_question || '',
        questionCount: parseInt(faqInfo?.question_count || 0)
      },
      emailSources: emailSources,
      totalSources: emailSources.length,
      uniqueSenders: [...new Set(emailSources.map(s => s.senderEmail))].length
    });
    
  } catch (error) {
    logger.error('Error getting FAQ email sources:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get email sources'
    });
  }
});

/**
 * Get summary statistics for FAQ email sources
 */
router.get('/:faqId/sources/stats', async (req, res) => {
  try {
    const { faqId } = req.params;
    
    const query = `
      SELECT 
        COUNT(*) as total_questions,
        COUNT(DISTINCT q.sender_email) as unique_senders,
        COUNT(DISTINCT DATE(e.received_at)) as unique_days,
        MIN(e.received_at) as earliest_email,
        MAX(e.received_at) as latest_email,
        AVG(q.confidence_score) as avg_confidence
      FROM questions q
      JOIN question_groups qg ON q.id = qg.question_id
      JOIN emails e ON q.email_id = e.id
      WHERE qg.group_id = $1
    `;
    
    const result = await db.query(query, [faqId]);
    const stats = result.rows[0];
    
    res.json({
      success: true,
      stats: {
        totalQuestions: parseInt(stats.total_questions || 0),
        uniqueSenders: parseInt(stats.unique_senders || 0),
        uniqueDays: parseInt(stats.unique_days || 0),
        earliestEmail: stats.earliest_email,
        latestEmail: stats.latest_email,
        avgConfidence: parseFloat(stats.avg_confidence || 0).toFixed(2),
        timeSpan: stats.earliest_email && stats.latest_email ? 
          Math.ceil((new Date(stats.latest_email) - new Date(stats.earliest_email)) / (1000 * 60 * 60 * 24)) : 0
      }
    });
    
  } catch (error) {
    logger.error('Error getting FAQ source stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get source statistics'
    });
  }
});

module.exports = router;