#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function fixConfidenceThresholdIssue() {
  try {
    console.log('🔧 CONFIDENCE THRESHOLD FIX SCRIPT');
    console.log('===================================\n');

    // Step 1: Analyze current confidence scores
    console.log('📊 Step 1: Analyzing Current Confidence Scores...\n');
    
    const confidenceAnalysisQuery = `
      SELECT 
        COUNT(*) as total_questions,
        MIN(confidence_score) as min_confidence,
        MAX(confidence_score) as max_confidence,
        AVG(confidence_score) as avg_confidence,
        COUNT(*) FILTER (WHERE confidence_score >= 0.9) as very_high,
        COUNT(*) FILTER (WHERE confidence_score >= 0.8) as high,
        COUNT(*) FILTER (WHERE confidence_score >= 0.7) as medium_high,
        COUNT(*) FILTER (WHERE confidence_score >= 0.6) as medium,
        COUNT(*) FILTER (WHERE confidence_score >= 0.5) as low_medium,
        COUNT(*) FILTER (WHERE confidence_score < 0.5) as low
      FROM questions
      WHERE is_customer_question = true;
    `;
    
    const analysisResult = await db.query(confidenceAnalysisQuery);
    const stats = analysisResult.rows[0];
    
    console.log(`   Total Customer Questions: ${stats.total_questions}`);
    console.log(`   Confidence Score Range: ${parseFloat(stats.min_confidence).toFixed(3)} - ${parseFloat(stats.max_confidence).toFixed(3)}`);
    console.log(`   Average Confidence: ${parseFloat(stats.avg_confidence).toFixed(3)}`);
    console.log('\n   Distribution:');
    console.log(`     ≥ 0.9 (Very High): ${stats.very_high}`);
    console.log(`     ≥ 0.8 (High): ${stats.high}`);
    console.log(`     ≥ 0.7 (Medium-High): ${stats.medium_high}`);
    console.log(`     ≥ 0.6 (Medium): ${stats.medium}`);
    console.log(`     ≥ 0.5 (Low-Medium): ${stats.low_medium}`);
    console.log(`     < 0.5 (Low): ${stats.low}`);

    // Step 2: Show sample questions with their confidence scores
    console.log('\n📝 Step 2: Sample Questions with Confidence Scores...\n');
    
    const sampleQuestionsQuery = `
      SELECT id, question_text, confidence_score, answer_text IS NOT NULL as has_answer
      FROM questions 
      WHERE is_customer_question = true
      ORDER BY confidence_score DESC
      LIMIT 10;
    `;
    
    const sampleResult = await db.query(sampleQuestionsQuery);
    console.log('   Top 10 Questions by Confidence:');
    sampleResult.rows.forEach((q, index) => {
      console.log(`   ${index + 1}. Score: ${parseFloat(q.confidence_score).toFixed(3)} | Has Answer: ${q.has_answer ? 'Yes' : 'No'}`);
      console.log(`      "${q.question_text.substring(0, 80)}..."`);
      console.log('');
    });

    // Step 3: Determine optimal threshold
    console.log('🎯 Step 3: Determining Optimal Threshold...\n');
    
    const currentThreshold = parseFloat(process.env.QUESTION_CONFIDENCE_THRESHOLD) || 0.7;
    console.log(`   Current Threshold: ${currentThreshold}`);
    
    // Find a threshold that would include at least some questions
    const thresholdOptions = [0.6, 0.5, 0.4, 0.3, 0.2];
    let recommendedThreshold = currentThreshold;
    
    for (const threshold of thresholdOptions) {
      const countQuery = `
        SELECT COUNT(*) as count
        FROM questions 
        WHERE is_customer_question = true 
        AND confidence_score >= $1
        AND embedding IS NOT NULL;
      `;
      
      const countResult = await db.query(countQuery, [threshold]);
      const eligibleCount = parseInt(countResult.rows[0].count);
      
      console.log(`   Threshold ${threshold}: ${eligibleCount} eligible questions`);
      
      if (eligibleCount >= 2 && recommendedThreshold === currentThreshold) {
        recommendedThreshold = threshold;
      }
    }
    
    console.log(`\n   Recommended Threshold: ${recommendedThreshold}`);

    // Step 4: Test FAQ generation with lower threshold
    console.log('\n🚀 Step 4: Testing FAQ Generation with Lower Threshold...\n');
    
    if (recommendedThreshold < currentThreshold) {
      console.log(`   Testing with threshold ${recommendedThreshold}...`);
      
      // Temporarily override the threshold
      const originalThreshold = process.env.QUESTION_CONFIDENCE_THRESHOLD;
      process.env.QUESTION_CONFIDENCE_THRESHOLD = recommendedThreshold.toString();
      
      try {
        const FAQService = require('../src/services/faqService');
        const faqService = new FAQService();
        
        const result = await faqService.generateFAQs({
          minQuestionCount: 1, // Allow single-question FAQs
          maxFAQs: 20,
          forceRegenerate: false
        });
        
        console.log(`   ✅ FAQ Generation Results with threshold ${recommendedThreshold}:`);
        console.log(`     - Processed: ${result.processed} questions`);
        console.log(`     - Generated: ${result.generated} new FAQs`);
        console.log(`     - Updated: ${result.updated} existing FAQs`);
        console.log(`     - Clusters: ${result.clusters} created`);
        
        if (result.generated > 0 || result.updated > 0) {
          console.log('\n   🎉 SUCCESS! FAQs were created with the lower threshold.');
          
          // Ask if user wants to make this permanent
          console.log('\n   💡 RECOMMENDATION:');
          console.log(`   Update your .env file to set:`);
          console.log(`   QUESTION_CONFIDENCE_THRESHOLD=${recommendedThreshold}`);
          console.log('\n   This will make the lower threshold permanent.');
        }
        
      } catch (faqError) {
        console.log(`   ❌ FAQ Generation failed: ${faqError.message}`);
      } finally {
        // Restore original threshold
        if (originalThreshold) {
          process.env.QUESTION_CONFIDENCE_THRESHOLD = originalThreshold;
        }
      }
    }

    // Step 5: Alternative approach - Create FAQs from best available questions
    console.log('\n📋 Step 5: Creating FAQs from Best Available Questions...\n');
    
    const bestQuestionsQuery = `
      SELECT q.id, q.question_text, q.answer_text, q.confidence_score
      FROM questions q
      WHERE q.is_customer_question = true
        AND q.embedding IS NOT NULL
        AND q.answer_text IS NOT NULL
        AND LENGTH(q.answer_text) > 20
        AND NOT EXISTS (
          SELECT 1 FROM question_groups qg WHERE qg.question_id = q.id
        )
      ORDER BY q.confidence_score DESC
      LIMIT 10;
    `;
    
    const bestQuestionsResult = await db.query(bestQuestionsQuery);
    const bestQuestions = bestQuestionsResult.rows;
    
    console.log(`   Found ${bestQuestions.length} questions with answers for individual FAQs`);
    
    if (bestQuestions.length > 0) {
      const AIService = require('../src/services/aiService');
      const aiService = new AIService();
      
      let createdFAQs = 0;
      
      for (const question of bestQuestions) {
        try {
          // Generate improved question and answer
          const improvedQuestion = await aiService.improveQuestionText(question.question_text);
          const category = await aiService.categorizeQuestion(question.question_text);
          const tags = await aiService.extractTags(question.question_text);
          const embedding = JSON.parse(question.embedding || '[]'); // Use existing embedding
          
          const insertQuery = `
            INSERT INTO faq_groups (
              title, representative_question, consolidated_answer, question_count,
              frequency_score, avg_confidence, representative_embedding,
              is_published, category, tags, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            RETURNING id
          `;
          
          const title = improvedQuestion.length > 100 
            ? improvedQuestion.substring(0, 97) + '...'
            : improvedQuestion;
          
          const result = await db.query(insertQuery, [
            title,
            improvedQuestion,
            question.answer_text,
            1,
            question.confidence_score,
            question.confidence_score,
            JSON.stringify(embedding),
            true, // Auto-publish
            category,
            tags
          ]);
          
          const faqId = result.rows[0].id;
          
          // Associate question with FAQ
          const associateQuery = `
            INSERT INTO question_groups (question_id, group_id, similarity_score, is_representative)
            VALUES ($1, $2, $3, $4)
          `;
          
          await db.query(associateQuery, [question.id, faqId, 1.0, true]);
          
          createdFAQs++;
          console.log(`   ✅ Created FAQ: "${title.substring(0, 60)}..." (Score: ${parseFloat(question.confidence_score).toFixed(3)})`);
          
          // Small delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (createError) {
          console.log(`   ⚠️  Failed to create FAQ for question ${question.id}: ${createError.message}`);
        }
      }
      
      console.log(`\n   Created ${createdFAQs} individual FAQs from best questions`);
    }

    // Step 6: Final status
    console.log('\n📊 Step 6: Final Status...\n');
    
    const finalStatsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM questions WHERE is_customer_question = true) as customer_questions,
        (SELECT COUNT(*) FROM faq_groups) as total_faqs,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `;
    
    const finalStats = await db.query(finalStatsQuery);
    const final = finalStats.rows[0];
    
    console.log(`   Customer Questions: ${final.customer_questions}`);
    console.log(`   Total FAQs: ${final.total_faqs}`);
    console.log(`   Published FAQs: ${final.published_faqs}`);

    // Summary
    console.log('\n===================================');
    console.log('✅ CONFIDENCE THRESHOLD FIX COMPLETE!');
    console.log('===================================\n');
    
    if (parseInt(final.published_faqs) > 0) {
      console.log('🎉 SUCCESS! FAQs have been created from your questions.');
      console.log('\n📋 What was done:');
      console.log('   - Analyzed confidence score distribution');
      console.log('   - Created FAQs from best available questions');
      console.log('   - Published FAQs for immediate use');
      
      console.log('\n🔧 Recommended Actions:');
      console.log(`   1. Update .env: QUESTION_CONFIDENCE_THRESHOLD=${recommendedThreshold}`);
      console.log('   2. Review the created FAQs in your application');
      console.log('   3. Consider improving question detection logic for higher confidence scores');
    } else {
      console.log('⚠️  Still no FAQs created. The questions may need manual review.');
      console.log('\n🔍 Next Steps:');
      console.log('   1. Review the sample questions above');
      console.log('   2. Check if the questions are actually customer questions');
      console.log('   3. Consider adjusting the AI question detection logic');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during confidence threshold fix:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the fix
fixConfidenceThresholdIssue().catch(console.error);