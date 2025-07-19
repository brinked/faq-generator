#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');

async function publishFAQs() {
  try {
    console.log('🔍 Publishing unpublished FAQs...\n');

    // Check current status
    const totalResult = await db.query('SELECT COUNT(*) as count FROM faq_groups');
    const publishedResult = await db.query('SELECT COUNT(*) as count FROM faq_groups WHERE is_published = true');
    const unpublishedResult = await db.query('SELECT COUNT(*) as count FROM faq_groups WHERE is_published = false OR is_published IS NULL');

    console.log(`📊 Current Status:`);
    console.log(`   Total FAQs: ${totalResult.rows[0].count}`);
    console.log(`   Published: ${publishedResult.rows[0].count}`);
    console.log(`   Unpublished: ${unpublishedResult.rows[0].count}`);

    if (unpublishedResult.rows[0].count > 0) {
      console.log('\n🔧 Publishing all FAQs...');
      
      // Update all FAQs to be published
      const updateResult = await db.query(`
        UPDATE faq_groups 
        SET is_published = true, updated_at = NOW() 
        WHERE is_published = false OR is_published IS NULL
        RETURNING id, title
      `);

      console.log(`✅ Published ${updateResult.rowCount} FAQs:`);
      updateResult.rows.forEach((faq, index) => {
        console.log(`   ${index + 1}. ${faq.title}`);
      });

      // Re-check status
      const newPublishedResult = await db.query('SELECT COUNT(*) as count FROM faq_groups WHERE is_published = true');
      console.log(`\n📊 New Status: ${newPublishedResult.rows[0].count} published FAQs`);
    } else {
      console.log('\n✅ All FAQs are already published!');
    }

    console.log('\n🎉 FAQ publishing complete!');

  } catch (error) {
    console.error('❌ Error publishing FAQs:', error);
  } finally {
    await db.end();
  }
}

publishFAQs().catch(console.error);