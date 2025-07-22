const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');

async function checkStatus() {
  try {
    const result = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM questions) as questions,
        (SELECT COUNT(*) FROM faq_groups) as faq_groups,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `);
    
    const stats = result.rows[0];
    console.log('📊 FAQ Generator Status:');
    console.log(`   Questions: ${stats.questions}`);
    console.log(`   FAQ Groups: ${stats.faq_groups}`);
    console.log(`   Published FAQs: ${stats.published_faqs}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.end();
  }
}

checkStatus();