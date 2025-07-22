const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');

async function quickFix() {
  try {
    console.log('Running quick production fix (v2)...\n');
    
    // 1. Drop existing function and recreate it
    console.log('1. Fixing database function...');
    try {
      // First drop the existing function
      await db.query('DROP FUNCTION IF EXISTS update_faq_group_stats(UUID)');
      console.log('   ✓ Dropped existing function');
      
      // Create the function with the correct parameter name
      await db.query(`
        CREATE OR REPLACE FUNCTION update_faq_group_stats(group_uuid UUID)
        RETURNS VOID AS $$
        BEGIN
          UPDATE faq_groups
          SET 
            question_count = (SELECT COUNT(*) FROM question_groups WHERE group_id = group_uuid),
            updated_at = NOW()
          WHERE id = group_uuid;
        END;
        $$ LANGUAGE plpgsql;
      `);
      console.log('   ✓ Created function with correct parameter name\n');
    } catch (funcError) {
      console.log('   ⚠️  Function already exists correctly, continuing...\n');
    }
    
    // 2. Check current status
    console.log('2. Checking current status...');
    const statusQuery = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM questions) as questions,
        (SELECT COUNT(*) FROM faq_groups) as faq_groups,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `);
    const status = statusQuery.rows[0];
    console.log(`   Questions: ${status.questions}`);
    console.log(`   FAQ Groups: ${status.faq_groups}`);
    console.log(`   Published FAQs: ${status.published_faqs}\n`);
    
    // 3. Generate FAQs if needed
    if (parseInt(status.questions) > 0 && parseInt(status.faq_groups) === 0) {
      console.log('3. Generating FAQs from questions...');
      const FAQService = require('../src/services/faqService');
      const faqService = new FAQService();
      
      try {
        const result = await faqService.generateFAQs({
          minQuestionCount: 1,
          maxFAQs: 100
        });
        console.log(`   ✓ Generated ${result.generated} new FAQs`);
        console.log(`   ✓ Updated ${result.updated} existing FAQs\n`);
      } catch (genError) {
        console.error('   ❌ Error generating FAQs:', genError.message);
        console.log('   Continuing to publishing step...\n');
      }
    } else if (parseInt(status.faq_groups) > 0) {
      console.log('3. FAQs already exist, skipping generation...\n');
    }
    
    // 4. Publish all FAQs
    console.log('4. Publishing FAQs...');
    const publishResult = await db.query(`
      UPDATE faq_groups 
      SET is_published = true 
      WHERE is_published = false OR is_published IS NULL
      RETURNING id
    `);
    console.log(`   ✓ Published ${publishResult.rowCount} FAQs\n`);
    
    // 5. Final status check
    const finalQuery = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM questions) as questions,
        (SELECT COUNT(*) FROM faq_groups) as faq_groups,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `);
    const final = finalQuery.rows[0];
    
    console.log('✅ Complete! Final status:');
    console.log(`   Total Questions: ${final.questions}`);
    console.log(`   Total FAQ Groups: ${final.faq_groups}`);
    console.log(`   Published FAQs: ${final.published_faqs}`);
    
    if (parseInt(final.published_faqs) === 0 && parseInt(final.questions) > 0) {
      console.log('\n⚠️  WARNING: No FAQs were created. This might be because:');
      console.log('   - Questions are too dissimilar to group together');
      console.log('   - Questions don\'t have proper embeddings');
      console.log('   - Try running: node scripts/production-fix.js for detailed diagnostics');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await db.end();
  }
}

quickFix();