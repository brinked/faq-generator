#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const AIService = require('../src/services/aiService');
const SimilarityService = require('../src/services/similarityService');

async function fixEmbeddingIssues() {
  try {
    console.log('🔧 EMBEDDING ISSUES FIX SCRIPT');
    console.log('==============================\n');

    // Step 1: Ensure vector extension is available
    console.log('📊 Step 1: Setting up Vector Extension...\n');
    
    try {
      await db.query('CREATE EXTENSION IF NOT EXISTS "vector"');
      console.log('   ✅ Vector extension enabled');
    } catch (vectorError) {
      console.log('   ⚠️  Vector extension not available, using TEXT storage');
      console.log('   This is okay - embeddings will be stored as JSON strings');
    }

    // Step 2: Check and fix questions without embeddings
    console.log('\n🤖 Step 2: Generating Missing Embeddings...\n');
    
    const aiService = new AIService();
    const similarityService = new SimilarityService();
    
    // Check if we have API key
    if (!process.env.OPENAI_API_KEY) {
      console.log('   ❌ OpenAI API key not found');
      console.log('   Please set OPENAI_API_KEY environment variable');
      return;
    }

    // Get questions without embeddings
    const missingEmbeddingsQuery = `
      SELECT id, question_text 
      FROM questions 
      WHERE embedding IS NULL 
      AND is_customer_question = true
      AND confidence_score >= 0.7
      ORDER BY created_at DESC
      LIMIT 100;
    `;
    
    const missingResult = await db.query(missingEmbeddingsQuery);
    const questionsNeedingEmbeddings = missingResult.rows;
    
    console.log(`   Found ${questionsNeedingEmbeddings.length} questions needing embeddings`);
    
    if (questionsNeedingEmbeddings.length > 0) {
      console.log('   Generating embeddings in batches...');
      
      const batchSize = 20; // Process in smaller batches to avoid rate limits
      let processed = 0;
      let successful = 0;
      
      for (let i = 0; i < questionsNeedingEmbeddings.length; i += batchSize) {
        const batch = questionsNeedingEmbeddings.slice(i, i + batchSize);
        console.log(`   Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(questionsNeedingEmbeddings.length/batchSize)}...`);
        
        for (const question of batch) {
          try {
            // Generate embedding
            const embedding = await aiService.generateEmbedding(question.question_text);
            
            // Update question with embedding
            const updateQuery = `
              UPDATE questions 
              SET embedding = $1, updated_at = NOW()
              WHERE id = $2
            `;
            
            await db.query(updateQuery, [JSON.stringify(embedding), question.id]);
            successful++;
            
            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (embeddingError) {
            console.log(`   ⚠️  Failed to generate embedding for question ${question.id}: ${embeddingError.message}`);
          }
          
          processed++;
          if (processed % 10 === 0) {
            console.log(`   Progress: ${processed}/${questionsNeedingEmbeddings.length} processed`);
          }
        }
      }
      
      console.log(`   ✅ Generated embeddings for ${successful}/${questionsNeedingEmbeddings.length} questions`);
    } else {
      console.log('   ✅ All eligible questions already have embeddings');
    }

    // Step 3: Test FAQ generation with lower thresholds
    console.log('\n🎯 Step 3: Testing FAQ Generation with Optimized Settings...\n');
    
    // Check current eligible questions
    const eligibleQuery = `
      SELECT COUNT(*) as count
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      WHERE q.embedding IS NOT NULL
        AND q.is_customer_question = true
        AND q.confidence_score >= 0.7;
    `;
    
    const eligibleResult = await db.query(eligibleQuery);
    const eligibleCount = parseInt(eligibleResult.rows[0].count);
    
    console.log(`   Questions eligible for FAQ generation: ${eligibleCount}`);
    
    if (eligibleCount >= 2) {
      console.log('   Attempting FAQ generation with optimized settings...');
      
      const FAQService = require('../src/services/faqService');
      const faqService = new FAQService();
      
      try {
        // Try with very permissive settings first
        const result = await faqService.generateFAQs({
          minQuestionCount: 1, // Allow single-question FAQs
          maxFAQs: 50,
          forceRegenerate: false
        });
        
        console.log(`   ✅ FAQ Generation Results:`);
        console.log(`     - Processed: ${result.processed} questions`);
        console.log(`     - Generated: ${result.generated} new FAQs`);
        console.log(`     - Updated: ${result.updated} existing FAQs`);
        console.log(`     - Clusters: ${result.clusters} created`);
        
        if (result.generated === 0 && result.updated === 0) {
          console.log('\n   🔍 No FAQs generated. Checking similarity thresholds...');
          
          // Test with even lower similarity threshold
          const originalThreshold = process.env.SIMILARITY_THRESHOLD;
          process.env.SIMILARITY_THRESHOLD = '0.6'; // Lower threshold
          
          console.log('   Retrying with lower similarity threshold (0.6)...');
          
          const retryResult = await faqService.generateFAQs({
            minQuestionCount: 1,
            maxFAQs: 50,
            forceRegenerate: false
          });
          
          console.log(`   Retry Results:`);
          console.log(`     - Generated: ${retryResult.generated} new FAQs`);
          console.log(`     - Updated: ${retryResult.updated} existing FAQs`);
          
          // Restore original threshold
          if (originalThreshold) {
            process.env.SIMILARITY_THRESHOLD = originalThreshold;
          }
        }
        
      } catch (faqError) {
        console.log(`   ❌ FAQ Generation failed: ${faqError.message}`);
        console.log(`   Stack: ${faqError.stack}`);
      }
    } else {
      console.log('   ⚠️  Not enough eligible questions for FAQ generation');
    }

    // Step 4: Create individual FAQs if clustering fails
    console.log('\n📝 Step 4: Creating Individual FAQs as Fallback...\n');
    
    const individualFAQsQuery = `
      SELECT q.id, q.question_text, q.answer_text, q.confidence_score
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      WHERE q.embedding IS NOT NULL
        AND q.is_customer_question = true
        AND q.confidence_score >= 0.8
        AND q.answer_text IS NOT NULL
        AND LENGTH(q.answer_text) > 20
        AND NOT EXISTS (
          SELECT 1 FROM question_groups qg WHERE qg.question_id = q.id
        )
      ORDER BY q.confidence_score DESC
      LIMIT 10;
    `;
    
    const individualResult = await db.query(individualFAQsQuery);
    const individualQuestions = individualResult.rows;
    
    console.log(`   Found ${individualQuestions.length} high-quality questions for individual FAQs`);
    
    let createdIndividual = 0;
    for (const question of individualQuestions) {
      try {
        // Create individual FAQ
        const embedding = await aiService.generateEmbedding(question.question_text);
        const category = await aiService.categorizeQuestion(question.question_text);
        const tags = await aiService.extractTags(question.question_text);
        
        const insertQuery = `
          INSERT INTO faq_groups (
            title, representative_question, consolidated_answer, question_count,
            frequency_score, avg_confidence, representative_embedding,
            is_published, category, tags, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
          RETURNING id
        `;
        
        const title = question.question_text.length > 100 
          ? question.question_text.substring(0, 97) + '...'
          : question.question_text;
        
        const result = await db.query(insertQuery, [
          title,
          question.question_text,
          question.answer_text,
          1,
          question.confidence_score,
          question.confidence_score,
          JSON.stringify(embedding),
          true, // Auto-publish individual FAQs
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
        
        createdIndividual++;
        console.log(`   ✅ Created individual FAQ: "${title.substring(0, 50)}..."`);
        
      } catch (individualError) {
        console.log(`   ⚠️  Failed to create individual FAQ: ${individualError.message}`);
      }
    }
    
    console.log(`   Created ${createdIndividual} individual FAQs`);

    // Step 5: Final status check
    console.log('\n📊 Step 5: Final Status Check...\n');
    
    const finalStatsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM questions) as total_questions,
        (SELECT COUNT(*) FROM questions WHERE embedding IS NOT NULL) as questions_with_embeddings,
        (SELECT COUNT(*) FROM faq_groups) as total_faqs,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `;
    
    const finalStats = await db.query(finalStatsQuery);
    const stats = finalStats.rows[0];
    
    console.log(`   Total Questions: ${stats.total_questions}`);
    console.log(`   Questions with Embeddings: ${stats.questions_with_embeddings}`);
    console.log(`   Total FAQs: ${stats.total_faqs}`);
    console.log(`   Published FAQs: ${stats.published_faqs}`);

    // Summary
    console.log('\n==============================');
    console.log('✅ FIX COMPLETE!');
    console.log('==============================\n');
    
    if (parseInt(stats.published_faqs) > 0) {
      console.log('🎉 SUCCESS! FAQs have been created and published.');
      console.log('\n📋 Next Steps:');
      console.log('   1. Refresh your FAQ generator app');
      console.log('   2. Check the FAQ display section');
      console.log('   3. Your FAQs should now be visible');
    } else {
      console.log('⚠️  No FAQs were created. This might mean:');
      console.log('   - Questions are too dissimilar to group');
      console.log('   - No questions have sufficient answers');
      console.log('   - Confidence scores are too low');
      console.log('\n💡 Try running the diagnosis script for more details:');
      console.log('   node scripts/diagnose-embedding-issues.js');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during fix:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the fix
fixEmbeddingIssues().catch(console.error);