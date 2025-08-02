const db = require('../src/config/database');
require('dotenv').config();

async function showFAQs() {
  try {
    const result = await db.query(`
      SELECT fg.title, fg.representative_question, fg.consolidated_answer, fg.question_count 
      FROM faq_groups fg 
      ORDER BY fg.created_at DESC
    `);
    
    console.log('\n📋 Generated FAQs:');
    result.rows.forEach((row, index) => {
      console.log(`\n${index + 1}. ${row.title}`);
      console.log(`   Q: ${row.representative_question}`);
      console.log(`   A: ${row.consolidated_answer}`);
      console.log(`   Questions in group: ${row.question_count}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.end();
  }
}

showFAQs(); 