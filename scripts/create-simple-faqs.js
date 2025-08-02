const db = require('../src/config/database');
const logger = require('../src/utils/logger');
require('dotenv').config();

async function createSimpleFAQs() {
  try {
    console.log('🔧 Creating simple FAQs from extracted questions...');
    
    // Get all questions
    const result = await db.query(`
      SELECT id, question_text, answer_text, confidence_score
      FROM questions 
      WHERE is_customer_question = true
      ORDER BY confidence_score DESC
    `);
    
    console.log(`Found ${result.rows.length} questions`);
    
    if (result.rows.length === 0) {
      console.log('No questions found');
      return;
    }
    
    // Create FAQ groups manually
    const faqGroups = [
      {
        title: 'Account Management',
        questions: ['How can I reset my password?', 'Can I upgrade my plan?', 'Can I change my billing date?']
      },
      {
        title: 'Security & Privacy',
        questions: ['Before I upload sensitive files, can you confirm what security measures you have in place to protect user data?']
      },
      {
        title: 'Billing & Refunds',
        questions: ['Do you offer refunds?', 'What is the process for requesting a refund?']
      },
      {
        title: 'General Support',
        questions: ['Can you guide me on how to do this?']
      }
    ];
    
    let faqsCreated = 0;
    
    for (const group of faqGroups) {
      // Find questions that match this group
      const matchingQuestions = result.rows.filter(q => 
        group.questions.some(groupQ => 
          q.question_text.toLowerCase().includes(groupQ.toLowerCase().replace('?', '').replace('can you', '').trim())
        )
      );
      
      if (matchingQuestions.length > 0) {
        // Create FAQ group
        const faqResult = await db.query(`
          INSERT INTO faq_groups (
            title, representative_question, consolidated_answer, 
            question_count, frequency_score, avg_confidence
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [
          group.title,
          matchingQuestions[0].question_text,
          matchingQuestions[0].answer_text || 'Please contact our support team for assistance.',
          matchingQuestions.length,
          1.0,
          matchingQuestions.reduce((sum, q) => sum + q.confidence_score, 0) / matchingQuestions.length
        ]);
        
        const faqGroupId = faqResult.rows[0].id;
        
        // Link questions to this FAQ group
        for (const question of matchingQuestions) {
          await db.query(`
            INSERT INTO question_groups (
              question_id, group_id, similarity_score, is_representative
            ) VALUES ($1, $2, $3, $4)
          `, [
            question.id,
            faqGroupId,
            0.9,
            question.id === matchingQuestions[0].id
          ]);
        }
        
        faqsCreated++;
        console.log(`✅ Created FAQ group: ${group.title} with ${matchingQuestions.length} questions`);
      }
    }
    
    console.log(`\n🎉 Created ${faqsCreated} FAQ groups`);
    
    // Check final status
    const statusResult = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM questions) as questions,
        (SELECT COUNT(*) FROM faq_groups) as faq_groups,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `);
    
    console.log('\n📊 Final FAQ Status:');
    console.log(`   Questions: ${statusResult.rows[0].questions}`);
    console.log(`   FAQ Groups: ${statusResult.rows[0].faq_groups}`);
    console.log(`   Published FAQs: ${statusResult.rows[0].published_faqs}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await db.end();
  }
}

createSimpleFAQs(); 