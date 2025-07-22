#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function diagnoseAndFix() {
  try {
    console.log('🔍 FAQ Generator Production Diagnosis & Fix\n');
    console.log('============================================\n');

    // Step 1: Check database state
    console.log('📊 Step 1: Checking database state...\n');
    
    // Check questions count
    const questionsResult = await db.query('SELECT COUNT(*) as count FROM questions');
    console.log(`   ✓ Questions in database: ${questionsResult.rows[0].count}`);
    
    // Check FAQ groups count
    const faqGroupsResult = await db.query('SELECT COUNT(*) as count FROM faq_groups');
    console.log(`   ✓ FAQ groups in database: ${faqGroupsResult.rows[0].count}`);
    
    // Check published FAQs
    const publishedResult = await db.query('SELECT COUNT(*) as count FROM faq_groups WHERE is_published = true');
    console.log(`   ✓ Published FAQs: ${publishedResult.rows[0].count}`);
    
    // Check if update_faq_group_stats function exists
    const functionCheck = await db.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' 
        AND p.proname = 'update_faq_group_stats'
      ) as function_exists;
    `);
    
    const functionExists = functionCheck.rows[0].function_exists;
    console.log(`   ${functionExists ? '✓' : '❌'} update_faq_group_stats function exists: ${functionExists}`);
    
    // Step 2: Fix missing database function if needed
    if (!functionExists) {
      console.log('\n🔧 Step 2: Creating missing database function...\n');
      
      const createFunctionSQL = `
        CREATE OR REPLACE FUNCTION update_faq_group_stats(p_group_id UUID)
        RETURNS VOID AS $$
        BEGIN
          UPDATE faq_groups
          SET 
            question_count = (
              SELECT COUNT(*) 
              FROM question_groups 
              WHERE group_id = p_group_id
            ),
            frequency_score = (
              SELECT COALESCE(SUM(q.confidence_score), 0)
              FROM question_groups qg
              JOIN questions q ON qg.question_id = q.id
              WHERE qg.group_id = p_group_id
            ),
            avg_confidence = (
              SELECT COALESCE(AVG(q.confidence_score), 0)
              FROM question_groups qg
              JOIN questions q ON qg.question_id = q.id
              WHERE qg.group_id = p_group_id
            ),
            updated_at = NOW()
          WHERE id = p_group_id;
        END;
        $$ LANGUAGE plpgsql;
      `;
      
      await db.query(createFunctionSQL);
      console.log('   ✓ Database function created successfully');
    } else {
      console.log('\n✓ Step 2: Database function already exists, skipping...');
    }
    
    // Step 3: Check for unprocessed questions
    console.log('\n🔍 Step 3: Checking for unprocessed questions...\n');
    
    const unprocessedQuery = `
      SELECT COUNT(*) as count
      FROM questions q
      WHERE NOT EXISTS (
        SELECT 1 FROM question_groups qg 
        WHERE qg.question_id = q.id
      )
      AND q.is_customer_question = true
      AND q.confidence_score >= 0.7
    `;
    
    const unprocessedResult = await db.query(unprocessedQuery);
    const unprocessedCount = parseInt(unprocessedResult.rows[0].count);
    
    console.log(`   Found ${unprocessedCount} questions not yet grouped into FAQs`);
    
    // Step 4: Generate FAQs if needed
    if (unprocessedCount > 0 || faqGroupsResult.rows[0].count === 0) {
      console.log('\n🚀 Step 4: Generating FAQs from questions...\n');
      
      // Import FAQ Service
      const FAQService = require('../src/services/faqService');
      const faqService = new FAQService();
      
      try {
        const result = await faqService.generateFAQs({
          minQuestionCount: 1, // Lower threshold for production fix
          maxFAQs: 100,
          forceRegenerate: false
        });
        
        console.log(`   ✓ FAQ generation complete:`);
        console.log(`     - Processed ${result.processed} questions`);
        console.log(`     - Created ${result.generated} new FAQ groups`);
        console.log(`     - Updated ${result.updated} existing FAQ groups`);
      } catch (error) {
        console.error('   ❌ Error generating FAQs:', error.message);
        console.log('   Continuing with next steps...');
      }
    } else {
      console.log('\n✓ Step 4: All questions already grouped into FAQs, skipping...');
    }
    
    // Step 5: Check and publish FAQs
    console.log('\n📢 Step 5: Publishing FAQs...\n');
    
    const unpublishedQuery = `
      SELECT COUNT(*) as count 
      FROM faq_groups 
      WHERE is_published = false OR is_published IS NULL
    `;
    
    const unpublishedResult = await db.query(unpublishedQuery);
    const unpublishedCount = parseInt(unpublishedResult.rows[0].count);
    
    if (unpublishedCount > 0) {
      console.log(`   Found ${unpublishedCount} unpublished FAQs`);
      
      const publishResult = await db.query(`
        UPDATE faq_groups 
        SET is_published = true, updated_at = NOW() 
        WHERE is_published = false OR is_published IS NULL
        RETURNING id, title
      `);
      
      console.log(`   ✓ Published ${publishResult.rowCount} FAQs`);
    } else {
      console.log('   ✓ All FAQs are already published');
    }
    
    // Final status
    console.log('\n============================================');
    console.log('📊 FINAL STATUS:\n');
    
    const finalStats = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM questions) as total_questions,
        (SELECT COUNT(*) FROM questions WHERE is_customer_question = true) as customer_questions,
        (SELECT COUNT(*) FROM faq_groups) as total_faqs,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `);
    
    const stats = finalStats.rows[0];
    console.log(`   Total Questions: ${stats.total_questions}`);
    console.log(`   Customer Questions: ${stats.customer_questions}`);
    console.log(`   Total FAQs: ${stats.total_faqs}`);
    console.log(`   Published FAQs: ${stats.published_faqs}`);
    
    console.log('\n✅ Production fix complete!');
    console.log('\n🎯 Next steps:');
    console.log('   1. Refresh your FAQ generator app in the browser');
    console.log('   2. Navigate to the FAQ display section');
    console.log('   3. Your FAQs should now be visible');
    
    if (stats.published_faqs === 0) {
      console.log('\n⚠️  WARNING: No FAQs were created. This might mean:');
      console.log('   - The questions didn\'t meet the similarity threshold for grouping');
      console.log('   - There was an error in the FAQ generation process');
      console.log('   - Check the logs above for any error messages');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during diagnosis/fix:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the diagnosis and fix
diagnoseAndFix().catch(console.error);