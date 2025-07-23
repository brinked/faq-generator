const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EmailFilteringService = require('../services/emailFilteringService');
const db = require('../config/database');

const filteringService = new EmailFilteringService();

/**
 * Get email filtering statistics
 */
router.get('/stats', async (req, res) => {
  try {
    // Get date range from query params
    const { startDate, endDate } = req.query;
    
    // Get overall filtering statistics
    const filteringStats = await filteringService.getFilteringStats(startDate, endDate);
    
    // Get detailed breakdown of filtering reasons
    const reasonsQuery = `
      SELECT 
        filtering_reason,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) as percentage
      FROM emails
      WHERE filtering_status = 'filtered_out'
        ${startDate ? 'AND received_at >= $1' : ''}
        ${endDate ? 'AND received_at <= $2' : ''}
      GROUP BY filtering_reason
      ORDER BY count DESC
    `;
    
    const params = [];
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    
    const reasonsResult = await db.query(reasonsQuery, params);
    
    // Get conversation statistics
    const conversationQuery = `
      SELECT 
        COUNT(DISTINCT thread_id) as total_conversations,
        COUNT(DISTINCT thread_id) FILTER (WHERE has_response = true) as conversations_with_responses,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_emails,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_emails,
        COUNT(*) FILTER (WHERE is_automated = true) as automated_emails,
        COUNT(*) FILTER (WHERE is_spam = true) as spam_emails
      FROM emails
      WHERE 1=1
        ${startDate ? 'AND received_at >= $1' : ''}
        ${endDate ? 'AND received_at <= $2' : ''}
    `;
    
    const conversationResult = await db.query(conversationQuery, params);
    
    // Get processing eligibility breakdown
    const eligibilityQuery = `
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE processed_for_faq = true) as processed_emails,
        COUNT(*) FILTER (WHERE processed_for_faq = false AND has_response = true) as pending_with_response,
        COUNT(*) FILTER (WHERE processed_for_faq = false AND has_response = false) as pending_no_response,
        COUNT(*) FILTER (WHERE filtering_status = 'qualified') as qualified_emails,
        COUNT(*) FILTER (WHERE filtering_status = 'filtered_out') as filtered_out_emails
      FROM emails
      WHERE 1=1
        ${startDate ? 'AND received_at >= $1' : ''}
        ${endDate ? 'AND received_at <= $2' : ''}
    `;
    
    const eligibilityResult = await db.query(eligibilityQuery, params);
    
    // Calculate filtering impact
    const eligibility = eligibilityResult.rows[0];
    const filteringImpact = {
      reductionPercentage: eligibility.total_emails > 0 
        ? Math.round((eligibility.filtered_out_emails / eligibility.total_emails) * 100)
        : 0,
      qualificationRate: eligibility.total_emails > 0
        ? Math.round((eligibility.qualified_emails / eligibility.total_emails) * 100)
        : 0,
      processingCostSavings: eligibility.filtered_out_emails * 0.002 // Estimated cost per email processing
    };
    
    res.json({
      success: true,
      stats: {
        overview: filteringStats,
        filteringReasons: reasonsResult.rows,
        conversations: conversationResult.rows[0],
        eligibility: eligibility,
        impact: filteringImpact,
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Error getting filtering statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get filtering statistics'
    });
  }
});

/**
 * Get real-time filtering preview
 */
router.post('/preview', async (req, res) => {
  try {
    const { limit = 10 } = req.body;
    
    // Get recent emails with their filtering status
    const query = `
      SELECT 
        e.id,
        e.subject,
        e.sender_email,
        e.received_at,
        e.has_response,
        e.is_automated,
        e.is_spam,
        e.filtering_status,
        e.filtering_reason,
        e.quality_score,
        ea.email_address as account_email
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      ORDER BY e.received_at DESC
      LIMIT $1
    `;
    
    const result = await db.query(query, [limit]);
    const emails = result.rows;
    
    // Get connected accounts
    const accountsResult = await db.query('SELECT id, email_address FROM email_accounts WHERE status = $1', ['active']);
    const connectedAccounts = accountsResult.rows;
    
    // Run filtering preview on each email
    const previews = [];
    for (const email of emails) {
      const qualification = await filteringService.doesEmailQualifyForFAQ(email, connectedAccounts);
      previews.push({
        email: {
          id: email.id,
          subject: email.subject,
          sender: email.sender_email,
          received: email.received_at,
          account: email.account_email
        },
        currentStatus: {
          filtering_status: email.filtering_status,
          filtering_reason: email.filtering_reason,
          has_response: email.has_response,
          is_automated: email.is_automated,
          is_spam: email.is_spam,
          quality_score: email.quality_score
        },
        newQualification: qualification
      });
    }
    
    res.json({
      success: true,
      previews,
      summary: {
        total: previews.length,
        qualified: previews.filter(p => p.newQualification.qualifies).length,
        disqualified: previews.filter(p => !p.newQualification.qualifies).length
      }
    });
    
  } catch (error) {
    logger.error('Error generating filtering preview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate filtering preview'
    });
  }
});

module.exports = router;