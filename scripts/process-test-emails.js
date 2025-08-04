const AIService = require('../src/services/aiService');
const EmailService = require('../src/services/emailService');
const FAQService = require('../src/services/faqService');
const db = require('../src/config/database');
const logger = require('../src/utils/logger');
require('dotenv').config();

async function processTestEmails() {
  try {
    console.log('🔧 Processing test emails for FAQ generation...');
    
          // Get any available emails (preferring those with questions)
      const result = await db.query(`
        SELECT e.id, e.subject, e.body_text, e.sender_email, e.thread_id
        FROM emails e 
        WHERE e.body_text IS NOT NULL 
        AND e.body_text != ''
        AND LENGTH(e.body_text) > 20
        AND (e.processed_for_faq IS NULL OR e.processed_for_faq = false)
        ORDER BY 
          CASE 
            WHEN e.subject ILIKE '%password%' OR e.subject ILIKE '%reset%' THEN 1
            WHEN e.subject ILIKE '%upgrade%' OR e.subject ILIKE '%plan%' THEN 2  
            WHEN e.subject ILIKE '%secure%' OR e.subject ILIKE '%data%' THEN 3
            WHEN e.subject ILIKE '%refund%' OR e.subject ILIKE '%money%' THEN 4
            WHEN e.subject ILIKE '%billing%' OR e.subject ILIKE '%payment%' THEN 5
            WHEN e.subject ILIKE '%API%' OR e.subject ILIKE '%integration%' THEN 6
            ELSE 10
          END,
          e.received_at DESC
        LIMIT 10
      `);
    
    console.log(`Found ${result.rows.length} emails to process`);
    
    if (result.rows.length === 0) {
      console.log('❌ No emails found that meet the criteria');
      console.log('   - Checking if any emails exist...');
      const totalEmails = await db.query('SELECT COUNT(*) as count FROM emails');
      console.log(`   - Total emails in database: ${totalEmails.rows[0].count}`);
      
      const emailsWithBody = await db.query('SELECT COUNT(*) as count FROM emails WHERE body_text IS NOT NULL AND body_text != \'\'');
      console.log(`   - Emails with body text: ${emailsWithBody.rows[0].count}`);
      return;
    }
    
    const aiService = new AIService();
    const emailService = new EmailService();
    const faqService = new FAQService();
    
    let questionsExtracted = 0;
    
    for (const email of result.rows) {
      console.log(`\n📧 Processing: ${email.subject}`);
      
      try {
        // Extract questions from email
        console.log(`   📝 Body preview: ${email.body_text.substring(0, 100)}...`);
        const result = await aiService.detectQuestions(email.body_text, email.subject);
        const questions = result.questions || [];
        
        console.log(`   🤖 AI result:`, JSON.stringify(result, null, 2));
        
        if (questions && questions.length > 0) {
          console.log(`✅ Extracted ${questions.length} questions`);
          
                      // Store questions
            for (const question of questions) {
              console.log(`   💾 Storing question: ${question.question}`);
              await db.query(`
                INSERT INTO questions (
                  email_id, question_text, answer_text, confidence_score, 
                  is_customer_question
                ) VALUES ($1, $2, $3, $4, $5)
              `, [
                email.id,
                question.question,
                question.answer || '',
                question.confidence || 0.8,
                true
              ]);
            
            questionsExtracted++;
          }
          
          // Mark email as processed
          await db.query(`
            UPDATE emails 
            SET processed_for_faq = true
            WHERE id = $1
          `, [email.id]);
          
        } else {
          console.log('❌ No questions extracted from AI service');
        }
        
      } catch (error) {
        console.error(`❌ Error processing email ${email.id}:`, error);
        console.error(`   Full error details:`, error.stack);
      }
    }
    
    console.log(`\n🎉 Processing complete! Extracted ${questionsExtracted} questions`);
    
    // Show next steps instead of trying to generate FAQs
    console.log('\n📋 Next steps:');
    console.log('  1. Run: node scripts/create-simple-faqs.js');
    console.log('  2. Run: node scripts/check-faq-status.js');
    console.log('  3. Publish FAQs in admin dashboard or run:');
    console.log('     node -e "const db=require(\'./src/config/database\'); db.query(\'UPDATE faq_groups SET is_published=true\').then(()=>process.exit())"');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await db.end();
  }
}

processTestEmails(); 