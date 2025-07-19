#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');

async function checkFAQs() {
  try {
    console.log('🔍 Checking FAQ database...\n');

    // Check total FAQs
    const totalResult = await db.query('SELECT COUNT(*) as count FROM faqs');
    console.log(`📊 Total FAQs in database: ${totalResult.rows[0].count}`);

    // Check published FAQs
    const publishedResult = await db.query('SELECT COUNT(*) as count FROM faqs WHERE published = true');
    console.log(`✅ Published FAQs: ${publishedResult.rows[0].count}`);

    // Check unpublished FAQs
    const unpublishedResult = await db.query('SELECT COUNT(*) as count FROM faqs WHERE published = false OR published IS NULL');
    console.log(`❌ Unpublished FAQs: ${unpublishedResult.rows[0].count}`);

    // Show recent FAQs
    const recentResult = await db.query(`
      SELECT id, question, category, published, frequency_score, created_at 
      FROM faqs 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log('\n📝 Recent FAQs:');
    if (recentResult.rows.length === 0) {
      console.log('   No FAQs found');
    } else {
      recentResult.rows.forEach((faq, index) => {
        console.log(`   ${index + 1}. [${faq.published ? '✅' : '❌'}] ${faq.question.substring(0, 80)}...`);
        console.log(`      Category: ${faq.category || 'None'} | Score: ${faq.frequency_score} | Created: ${faq.created_at.toISOString()}`);
      });
    }

    // Check what the API endpoint would return
    console.log('\n🔍 Testing API query (what frontend gets):');
    const apiResult = await db.query(`
      SELECT id, question, answer, category, frequency_score as frequency, created_at
      FROM faqs 
      WHERE published = true OR published IS NULL
      ORDER BY frequency_score DESC
      LIMIT 20
    `);
    console.log(`   API would return: ${apiResult.rows.length} FAQs`);

    if (apiResult.rows.length > 0) {
      console.log('   Sample FAQ:');
      const sample = apiResult.rows[0];
      console.log(`   - Question: ${sample.question}`);
      console.log(`   - Answer: ${sample.answer.substring(0, 100)}...`);
      console.log(`   - Category: ${sample.category || 'None'}`);
      console.log(`   - Frequency: ${sample.frequency}`);
    }

    // Check if there are any FAQs that should be published
    if (totalResult.rows[0].count > 0 && publishedResult.rows[0].count === 0) {
      console.log('\n🔧 Found unpublished FAQs! Publishing them...');
      const updateResult = await db.query('UPDATE faqs SET published = true WHERE published IS NULL OR published = false');
      console.log(`   ✅ Published ${updateResult.rowCount} FAQs`);
      
      // Re-check
      const newPublishedResult = await db.query('SELECT COUNT(*) as count FROM faqs WHERE published = true');
      console.log(`   📊 Now have ${newPublishedResult.rows[0].count} published FAQs`);
    }

  } catch (error) {
    console.error('❌ Error checking FAQs:', error);
  } finally {
    await db.end();
  }
}

checkFAQs().catch(console.error);