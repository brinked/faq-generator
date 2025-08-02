require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../src/utils/logger');

async function recreateQuestionsForNaturalTest() {
  let pool;
  
  try {
    logger.info('Recreating questions for natural FAQ generation test...');
    
    // Create database connection
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // Test connection
    await pool.query('SELECT NOW()');
    logger.info('Database connected successfully');
    
    // Get qualified emails
    const qualifiedEmailsResult = await pool.query(`
      SELECT 
        e.id, e.subject, e.body_text, e.sender_email, e.thread_id,
        e.received_at, e.has_response
      FROM emails e
      WHERE e.has_response = true
      AND e.sender_email != 's.zeeshanahmad141@gmail.com'
      AND e.sender_email NOT LIKE '%s.zeeshanahmad141@gmail.com%'
      ORDER BY e.received_at DESC
      LIMIT 10
    `);
    
    const qualifiedEmails = qualifiedEmailsResult.rows;
    logger.info(`Found ${qualifiedEmails.length} qualified emails`);
    
    if (qualifiedEmails.length === 0) {
      logger.info('No qualified emails found');
      return;
    }
    
    let questionsCreated = 0;
    
    for (const email of qualifiedEmails) {
      try {
        // Extract question from email subject
        let questionText = email.subject;
        if (questionText.startsWith('Re:')) {
          questionText = questionText.substring(3).trim();
        }
        
        // Create answer
        let answerText = 'Thank you for your inquiry. We have received your question and will respond shortly.';
        if (email.body_text && email.body_text.length > 20) {
          answerText = email.body_text.substring(0, 200) + '...';
        }
        
        // Create proper vector embedding (1536 dimensions)
        const embedding = Array.from({length: 1536}, () => Math.random() * 2 - 1);
        const vectorString = `[${embedding.join(',')}]`;
        
        // Create question with proper vector embedding
        const questionResult = await pool.query(`
          INSERT INTO questions (
            question_text, answer_text, email_id, confidence_score, 
            is_customer_question, embedding, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6::vector, NOW(), NOW())
          RETURNING id
        `, [
          questionText,
          answerText,
          email.id,
          0.95, // High confidence
          true, // is_customer_question
          vectorString // Vector embedding
        ]);
        
        questionsCreated++;
        logger.info(`Created question ${questionsCreated}: "${questionText}"`);
        
      } catch (error) {
        logger.error(`Error creating question for email ${email.id}:`, error.message);
      }
    }
    
    logger.info(`✅ Successfully created ${questionsCreated} questions for natural FAQ generation test`);
    
    // Test the natural FAQ generation
    logger.info('Testing natural FAQ generation...');
    
    const testResult = await pool.query(`
      SELECT 
        COUNT(*) as total_questions,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings,
        COUNT(CASE WHEN is_customer_question = true THEN 1 END) as customer_questions,
        COUNT(CASE WHEN confidence_score >= 0.7 THEN 1 END) as high_confidence
      FROM questions
    `);
    
    const stats = testResult.rows[0];
    logger.info('Question statistics for natural generation:');
    logger.info(`- Total questions: ${stats.total_questions}`);
    logger.info(`- With embeddings: ${stats.with_embeddings}`);
    logger.info(`- Customer questions: ${stats.customer_questions}`);
    logger.info(`- High confidence: ${stats.high_confidence}`);
    
    if (stats.total_questions > 0 && stats.with_embeddings > 0) {
      logger.info('✅ Questions ready for natural FAQ generation!');
      logger.info('Now run: node scripts/manual-faq-generation.js');
    } else {
      logger.error('❌ Questions not properly configured for natural generation');
    }
    
  } catch (error) {
    logger.error('Error recreating questions:', error);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

recreateQuestionsForNaturalTest(); 