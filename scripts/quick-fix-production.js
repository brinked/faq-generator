const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');

async function quickFix() {
  try {
    console.log('Running quick production fix...\n');
    
    // 1. Create missing function
    console.log('1. Creating database function...');
    await db.query(`
      CREATE OR REPLACE FUNCTION update_faq_group_stats(p_group_id UUID)
      RETURNS VOID AS $$
      BEGIN
        UPDATE faq_groups
        SET 
          question_count = (SELECT COUNT(*) FROM question_groups WHERE group_id = p_group_id),
          updated_at = NOW()
        WHERE id = p_group_id;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('   ✓ Done\n');
    
    // 2. Generate FAQs
    console.log('2. Generating FAQs from questions...');
    const FAQService = require('../src/services/faqService');
    const faqService = new FAQService();
    
    const result = await faqService.generateFAQs({
      minQuestionCount: 1,
      maxFAQs: 100
    });
    console.log(`   ✓ Generated ${result.generated} FAQs\n`);
    
    // 3. Publish all FAQs
    console.log('3. Publishing FAQs...');
    const publishResult = await db.query(`
      UPDATE faq_groups 
      SET is_published = true 
      WHERE is_published = false OR is_published IS NULL
    `);
    console.log(`   ✓ Published ${publishResult.rowCount} FAQs\n`);
    
    // 4. Show final count
    const countResult = await db.query('SELECT COUNT(*) as count FROM faq_groups WHERE is_published = true');
    console.log(`✅ Complete! ${countResult.rows[0].count} FAQs are now published and visible.`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.end();
  }
}

quickFix();