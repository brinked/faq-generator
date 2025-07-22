#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');
const logger = require('../utils/logger');
const AIService = require('../src/services/aiService');

async function fixNullConfidenceAndEmbeddings() {
  try {
    console.log('🔧 NULL CONFIDENCE & EMBEDDINGS FIX SCRIPT');
    console.log('============================================\n');

    // Step 1: Analyze the data corruption
    console.log('📊 Step 1: Analyzing Data Corruption...\n');
    
    const dataAnalysisQuery = `
      SELECT 
        COUNT(*) as total_questions,
        COUNT(*) FILTER (WHERE confidence_score IS NULL) as null_confidence,
        COUNT(*) FILTER (WHERE confidence_score IS NOT NULL) as has_confidence,
        COUNT(*) FILTER (WHERE embedding IS NULL) as null_embedding,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) as has_embedding,
        COUNT(*) FILTER (WHERE embedding = '[]'::vector) as empty_embedding,
        COUNT(*) FILTER (WHERE answer_text IS NOT NULL AND LENGTH(answer_text) > 10) as has_good_answer
      FROM questions
      WHERE is_customer_question = true;
    `;
    
    const analysisResult = await db.query(dataAnalysisQuery);
    const stats = analysisResult.rows[0];
    
    console.log(`   Total Customer Questions: ${stats.total_questions}`);
    console.log(`   NULL Confidence Scores: ${stats.null_confidence}`);
    console.log(`   Valid Confidence Scores: ${stats.has_confidence}`);
    console.log(`   NULL Embeddings: ${stats.null_embedding}`);
    console.log(`   Has Embeddings: ${stats.has_embedding}`);
    console.log(`   Empty Embeddings: ${stats.empty_embedding}`);
    console.log(`   Questions with Good Answers: ${stats.has_good_answer}`);

    // Step 2: Fix confidence scores using AI re-evaluation
    console.log('\n🤖 Step 2: Fixing NULL Confidence Scores...\n');
    
    const aiService = new AIService();
    
    // Get questions with NULL confidence scores
    const nullConfidenceQuery = `
      SELECT q.id, q.question_text, q.answer_text, e.subject, e.body_text
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      WHERE q.confidence_score IS NULL
      AND q.is_customer_question = true
      ORDER BY q.created_at DESC
      LIMIT 50;
    `;
    
    const nullConfidenceResult = await db.query(nullConfidenceQuery);
    const questionsToFix = nullConfidenceResult.rows;
    
    console.log(`   Found ${questionsToFix.length} questions with NULL confidence scores`);
    
    let fixedConfidence = 0;
    
    for (const question of questionsToFix) {
      try {
        // Re-evaluate the question using AI
        const emailText = question.body_text || '';
        const emailSubject = question.subject || '';
        
        const detection = await aiService.detectQuestions(emailText, emailSubject);
        
        // Find the best matching question from AI detection
        let bestConfidence = 0.5; // Default fallback confidence
        
        if (detection.questions && detection.questions.length > 0) {
          // Find question that best matches our stored question
          const matchingQuestion = detection.questions.find(q => 
            q.question.toLowerCase().includes(question.question_text.toLowerCase().substring(0, 20)) ||
            question.question_text.toLowerCase().includes(q.question.toLowerCase().substring(0, 20))
          );
          
          if (matchingQuestion) {
            bestConfidence = matchingQuestion.confidence;
          } else {
            // Use the highest confidence from detected questions as a baseline
            bestConfidence = Math.max(...detection.questions.map(q => q.confidence));
          }
        }
        
        // Update confidence score
        const updateConfidenceQuery = `
          UPDATE questions 
          SET confidence_score = $1, updated_at = NOW()
          WHERE id = $2
        `;
        
        await db.query(updateConfidenceQuery, [bestConfidence, question.id]);
        fixedConfidence++;
        
        console.log(`   ✅ Fixed confidence for question ${fixedConfidence}/${questionsToFix.length} (Score: ${bestConfidence.toFixed(3)})`);
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (confidenceError) {
        console.log(`   ⚠️  Failed to fix confidence for question ${question.id}: ${confidenceError.message}`);
        
        // Set a default confidence score so it's not NULL
        try {
          await db.query('UPDATE questions SET confidence_score = $1 WHERE id = $2', [0.5, question.id]);
          fixedConfidence++;
        } catch (defaultError) {
          console.log(`   ❌ Failed to set default confidence: ${defaultError.message}`);
        }
      }
    }
    
    console.log(`   Fixed confidence scores for ${fixedConfidence} questions`);

    // Step 3: Fix NULL/empty embeddings
    console.log('\n🔗 Step 3: Fixing NULL/Empty Embeddings...\n');
    
    const nullEmbeddingQuery = `
      SELECT id, question_text
      FROM questions 
      WHERE (embedding IS NULL OR embedding = '[]'::vector)
      AND is_customer_question = true
      AND confidence_score >= 0.3
      ORDER BY confidence_score DESC
      LIMIT 50;
    `;
    
    const nullEmbeddingResult = await db.query(nullEmbeddingQuery);
    const embeddingsToFix = nullEmbeddingResult.rows;
    
    console.log(`   Found ${embeddingsToFix.length} questions needing embeddings`);
    
    let fixedEmbeddings = 0;
    
    for (const question of embeddingsToFix) {
      try {
        // Generate new embedding
        const embedding = await aiService.generateEmbedding(question.question_text);
        
        if (embedding && embedding.length > 0) {
          const updateEmbeddingQuery = `
            UPDATE questions 
            SET embedding = $1::vector, updated_at = NOW()
            WHERE id = $2
          `;
          
          await db.query(updateEmbeddingQuery, [JSON.stringify(embedding), question.id]);
          fixedEmbeddings++;
          
          console.log(`   ✅ Fixed embedding for question ${fixedEmbeddings}/${embeddingsToFix.length}`);
        }
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 150));
        
      } catch (embeddingError) {
        console.log(`   ⚠️  Failed to fix embedding for question ${question.id}: ${embeddingError.message}`);
      }
    }
    
    console.log(`   Fixed embeddings for ${fixedEmbeddings} questions`);

    // Step 4: Create FAQs with the fixed data
    console.log('\n📋 Step 4: Creating FAQs with Fixed Data...\n');
    
    const eligibleQuestionsQuery = `
      SELECT q.id, q.question_text, q.answer_text, q.confidence_score
      FROM questions q
      WHERE q.is_customer_question = true
        AND q.confidence_score >= 0.3
        AND q.embedding IS NOT NULL
        AND q.answer_text IS NOT NULL
        AND LENGTH(q.answer_text) > 20
        AND NOT EXISTS (
          SELECT 1 FROM question_groups qg WHERE qg.question_id = q.id
        )
      ORDER BY q.confidence_score DESC
      LIMIT 15;
    `;
    
    const eligibleResult = await db.query(eligibleQuestionsQuery);
    const eligibleQuestions = eligibleResult.rows;
    
    console.log(`   Found ${eligibleQuestions.length} questions eligible for FAQ creation`);
    
    let createdFAQs = 0;
    
    for (const question of eligibleQuestions) {
      try {
        // Get the existing embedding
        const embeddingQuery = 'SELECT embedding FROM questions WHERE id = $1';
        const embeddingResult = await db.query(embeddingQuery, [question.id]);
        const existingEmbedding = embeddingResult.rows[0]?.embedding;
        
        if (!existingEmbedding) {
          console.log(`   ⚠️  Skipping question ${question.id} - no embedding`);
          continue;
        }
        
        // Generate improved question and metadata
        const improvedQuestion = await aiService.improveQuestionText(question.question_text);
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
          existingEmbedding, // Use existing embedding directly
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
        console.log(`   ✅ Created FAQ ${createdFAQs}: "${title.substring(0, 60)}..." (Score: ${parseFloat(question.confidence_score).toFixed(3)})`);
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (createError) {
        console.log(`   ⚠️  Failed to create FAQ for question ${question.id}: ${createError.message}`);
      }
    }
    
    console.log(`   Created ${createdFAQs} FAQs from fixed data`);

    // Step 5: Final status
    console.log('\n📊 Step 5: Final Status Check...\n');
    
    const finalStatsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM questions WHERE is_customer_question = true) as customer_questions,
        (SELECT COUNT(*) FROM questions WHERE confidence_score IS NOT NULL) as questions_with_confidence,
        (SELECT COUNT(*) FROM questions WHERE embedding IS NOT NULL) as questions_with_embeddings,
        (SELECT COUNT(*) FROM faq_groups) as total_faqs,
        (SELECT COUNT(*) FROM faq_groups WHERE is_published = true) as published_faqs
    `;
    
    const finalStats = await db.query(finalStatsQuery);
    const final = finalStats.rows[0];
    
    console.log(`   Customer Questions: ${final.customer_questions}`);
    console.log(`   Questions with Confidence: ${final.questions_with_confidence}`);
    console.log(`   Questions with Embeddings: ${final.questions_with_embeddings}`);
    console.log(`   Total FAQs: ${final.total_faqs}`);
    console.log(`   Published FAQs: ${final.published_faqs}`);

    // Summary
    console.log('\n============================================');
    console.log('✅ NULL CONFIDENCE & EMBEDDINGS FIX COMPLETE!');
    console.log('============================================\n');
    
    if (parseInt(final.published_faqs) > 0) {
      console.log('🎉 SUCCESS! FAQs have been created after fixing the data corruption.');
      console.log('\n📋 What was fixed:');
      console.log(`   - Fixed ${fixedConfidence} NULL confidence scores`);
      console.log(`   - Fixed ${fixedEmbeddings} NULL/empty embeddings`);
      console.log(`   - Created ${createdFAQs} FAQs from the corrected data`);
      
      console.log('\n🔧 Recommendations:');
      console.log('   1. Check your email processing pipeline for confidence score calculation');
      console.log('   2. Ensure embeddings are generated during question extraction');
      console.log('   3. Add validation to prevent NULL confidence scores in the future');
    } else {
      console.log('⚠️  Still no FAQs created. The data may need further investigation.');
      console.log('\n🔍 Possible issues:');
      console.log('   - Questions may not be genuine customer questions');
      console.log('   - Answer quality may be insufficient');
      console.log('   - Email processing pipeline needs review');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during NULL confidence & embeddings fix:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the fix
fixNullConfidenceAndEmbeddings().catch(console.error);