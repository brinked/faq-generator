require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function diagnoseEmailSources() {
  try {
    logger.info('Starting email sources diagnosis...');
    
    // Connect to database
    await db.connect();
    logger.info('Database connected successfully');
    
    // Check if tables exist
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('faq_groups', 'questions', 'question_groups', 'emails')
      ORDER BY table_name
    `;
    const tablesResult = await db.query(tablesQuery);
    logger.info('Existing tables:', tablesResult.rows.map(r => r.table_name));
    
    // Check FAQ groups
    const faqCountQuery = 'SELECT COUNT(*) as count FROM faq_groups';
    const faqCountResult = await db.query(faqCountQuery);
    logger.info(`Total FAQ groups: ${faqCountResult.rows[0].count}`);
    
    // Get sample FAQ with sources
    const sampleFaqQuery = `
      SELECT 
        fg.id,
        fg.title,
        fg.question_count,
        COUNT(DISTINCT qg.question_id) as actual_question_count
      FROM faq_groups fg
      LEFT JOIN question_groups qg ON fg.id = qg.group_id
      GROUP BY fg.id, fg.title, fg.question_count
      HAVING COUNT(DISTINCT qg.question_id) > 0
      ORDER BY fg.created_at DESC
      LIMIT 5
    `;
    const sampleFaqResult = await db.query(sampleFaqQuery);
    logger.info('Sample FAQs with questions:', sampleFaqResult.rows);
    
    if (sampleFaqResult.rows.length > 0) {
      const faqId = sampleFaqResult.rows[0].id;
      logger.info(`\nChecking email sources for FAQ ${faqId}...`);
      
      // Check question_groups entries
      const qgQuery = `
        SELECT COUNT(*) as count 
        FROM question_groups 
        WHERE group_id = $1
      `;
      const qgResult = await db.query(qgQuery, [faqId]);
      logger.info(`Question groups entries for FAQ ${faqId}: ${qgResult.rows[0].count}`);
      
      // Check if questions have email_id
      const emailCheckQuery = `
        SELECT 
          q.id,
          q.email_id,
          q.sender_email,
          q.email_subject,
          CASE WHEN e.id IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END as email_status
        FROM questions q
        JOIN question_groups qg ON q.id = qg.question_id
        LEFT JOIN emails e ON q.email_id = e.id
        WHERE qg.group_id = $1
        LIMIT 5
      `;
      const emailCheckResult = await db.query(emailCheckQuery, [faqId]);
      logger.info('Question email mapping:', emailCheckResult.rows);
      
      // Test the actual query used by the API
      const apiQuery = `
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
      
      try {
        const apiResult = await db.query(apiQuery, [faqId]);
        logger.info(`API query returned ${apiResult.rows.length} results for FAQ ${faqId}`);
        
        if (apiResult.rows.length > 0) {
          logger.info('Sample result:', {
            questionId: apiResult.rows[0].question_id,
            senderEmail: apiResult.rows[0].sender_email,
            emailSubject: apiResult.rows[0].email_subject,
            hasBodyText: !!apiResult.rows[0].body_text
          });
        }
      } catch (error) {
        logger.error('API query failed:', error.message);
      }
    }
    
    // Check for orphaned questions
    const orphanedQuery = `
      SELECT COUNT(*) as count
      FROM questions q
      WHERE NOT EXISTS (
        SELECT 1 FROM emails e WHERE e.id = q.email_id
      )
    `;
    const orphanedResult = await db.query(orphanedQuery);
    logger.info(`\nOrphaned questions (no matching email): ${orphanedResult.rows[0].count}`);
    
    // Check email sync status
    const emailStatsQuery = `
      SELECT 
        COUNT(*) as total_emails,
        COUNT(DISTINCT account_id) as accounts,
        MIN(received_at) as oldest_email,
        MAX(received_at) as newest_email
      FROM emails
    `;
    const emailStatsResult = await db.query(emailStatsQuery);
    logger.info('\nEmail statistics:', emailStatsResult.rows[0]);
    
    logger.info('\nDiagnosis complete!');
    
  } catch (error) {
    logger.error('Diagnosis failed:', error);
  } finally {
    await db.end();
  }
}

diagnoseEmailSources();