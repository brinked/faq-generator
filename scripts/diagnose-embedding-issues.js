#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');
const logger = require('../src/utils/logger');
const AIService = require('../src/services/aiService');

async function diagnoseEmbeddingIssues() {
  try {
    console.log('🔍 EMBEDDING DIAGNOSIS SCRIPT');
    console.log('============================\n');

    // Step 1: Check database vector extension
    console.log('📊 Step 1: Checking Vector Extension...\n');
    
    const vectorExtensionQuery = `
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) as vector_extension_exists;
    `;
    
    const vectorResult = await db.query(vectorExtensionQuery);
    const hasVectorExtension = vectorResult.rows[0].vector_extension_exists;
    console.log(`   Vector Extension Installed: ${hasVectorExtension ? '✅ YES' : '❌ NO'}`);

    // Step 2: Check questions table structure
    console.log('\n📋 Step 2: Checking Questions Table Structure...\n');
    
    const tableStructureQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'questions' 
      AND column_name IN ('embedding', 'question_text', 'confidence_score', 'is_customer_question')
      ORDER BY column_name;
    `;
    
    const structureResult = await db.query(tableStructureQuery);
    console.log('   Table Structure:');
    structureResult.rows.forEach(row => {
      console.log(`     ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    // Step 3: Check questions data
    console.log('\n📈 Step 3: Analyzing Questions Data...\n');
    
    const questionsAnalysisQuery = `
      SELECT 
        COUNT(*) as total_questions,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) as questions_with_embeddings,
        COUNT(*) FILTER (WHERE embedding IS NULL) as questions_without_embeddings,
        COUNT(*) FILTER (WHERE is_customer_question = true) as customer_questions,
        COUNT(*) FILTER (WHERE is_customer_question = true AND embedding IS NOT NULL) as customer_questions_with_embeddings,
        COUNT(*) FILTER (WHERE confidence_score >= 0.7) as high_confidence_questions,
        COUNT(*) FILTER (WHERE confidence_score >= 0.7 AND embedding IS NOT NULL) as high_confidence_with_embeddings
      FROM questions;
    `;
    
    const analysisResult = await db.query(questionsAnalysisQuery);
    const stats = analysisResult.rows[0];
    
    console.log(`   Total Questions: ${stats.total_questions}`);
    console.log(`   Questions with Embeddings: ${stats.questions_with_embeddings}`);
    console.log(`   Questions without Embeddings: ${stats.questions_without_embeddings}`);
    console.log(`   Customer Questions: ${stats.customer_questions}`);
    console.log(`   Customer Questions with Embeddings: ${stats.customer_questions_with_embeddings}`);
    console.log(`   High Confidence Questions (≥0.7): ${stats.high_confidence_questions}`);
    console.log(`   High Confidence with Embeddings: ${stats.high_confidence_with_embeddings}`);

    // Step 4: Check FAQ generation criteria
    console.log('\n🎯 Step 4: Checking FAQ Generation Criteria...\n');
    
    const minConfidence = parseFloat(process.env.QUESTION_CONFIDENCE_THRESHOLD) || 0.7;
    console.log(`   Confidence Threshold: ${minConfidence}`);
    
    const faqCriteriaQuery = `
      SELECT COUNT(*) as eligible_questions
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      WHERE q.embedding IS NOT NULL
        AND q.is_customer_question = true
        AND q.confidence_score >= $1;
    `;
    
    const criteriaResult = await db.query(faqCriteriaQuery, [minConfidence]);
    const eligibleQuestions = criteriaResult.rows[0].eligible_questions;
    console.log(`   Questions Eligible for FAQ Generation: ${eligibleQuestions}`);

    // Step 5: Test AI Service Configuration
    console.log('\n🤖 Step 5: Testing AI Service Configuration...\n');
    
    const aiService = new AIService();
    
    // Check OpenAI API Key
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    console.log(`   OpenAI API Key Present: ${hasApiKey ? '✅ YES' : '❌ NO'}`);
    
    if (hasApiKey) {
      console.log(`   API Key Length: ${process.env.OPENAI_API_KEY.length} characters`);
      console.log(`   API Key Prefix: ${process.env.OPENAI_API_KEY.substring(0, 7)}...`);
    }

    // Test embedding generation
    if (hasApiKey) {
      console.log('\n   Testing Embedding Generation...');
      try {
        const testEmbedding = await aiService.generateEmbedding('Test question for embedding generation');
        console.log(`   ✅ Embedding Generation: SUCCESS`);
        console.log(`   Embedding Dimensions: ${testEmbedding.length}`);
        console.log(`   Sample Values: [${testEmbedding.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);
      } catch (embeddingError) {
        console.log(`   ❌ Embedding Generation: FAILED`);
        console.log(`   Error: ${embeddingError.message}`);
      }
    }

    // Step 6: Check sample questions without embeddings
    console.log('\n📝 Step 6: Sample Questions Without Embeddings...\n');
    
    const sampleQuestionsQuery = `
      SELECT id, question_text, confidence_score, is_customer_question, created_at
      FROM questions 
      WHERE embedding IS NULL 
      ORDER BY created_at DESC 
      LIMIT 5;
    `;
    
    const sampleResult = await db.query(sampleQuestionsQuery);
    if (sampleResult.rows.length > 0) {
      console.log('   Sample Questions Missing Embeddings:');
      sampleResult.rows.forEach((q, index) => {
        console.log(`   ${index + 1}. ID: ${q.id}`);
        console.log(`      Text: "${q.question_text.substring(0, 100)}..."`);
        console.log(`      Confidence: ${q.confidence_score}`);
        console.log(`      Is Customer: ${q.is_customer_question}`);
        console.log(`      Created: ${q.created_at}`);
        console.log('');
      });
    } else {
      console.log('   ✅ All questions have embeddings');
    }

    // Step 7: Check similarity service functionality
    console.log('\n🔗 Step 7: Testing Similarity Service...\n');
    
    if (parseInt(stats.questions_with_embeddings) >= 2) {
      try {
        const SimilarityService = require('../src/services/similarityService');
        const similarityService = new SimilarityService();
        
        // Get two questions with embeddings
        const testQuestionsQuery = `
          SELECT id FROM questions 
          WHERE embedding IS NOT NULL 
          LIMIT 2;
        `;
        const testQuestionsResult = await db.query(testQuestionsQuery);
        
        if (testQuestionsResult.rows.length >= 2) {
          const questionIds = testQuestionsResult.rows.map(r => r.id);
          const similarityMatrix = await similarityService.calculateSimilarityMatrix(questionIds);
          console.log(`   ✅ Similarity Calculation: SUCCESS`);
          console.log(`   Matrix Keys: ${Object.keys(similarityMatrix).length}`);
        } else {
          console.log(`   ⚠️  Not enough questions with embeddings for similarity test`);
        }
      } catch (similarityError) {
        console.log(`   ❌ Similarity Calculation: FAILED`);
        console.log(`   Error: ${similarityError.message}`);
      }
    } else {
      console.log('   ⚠️  Not enough questions with embeddings for similarity test');
    }

    // Step 8: Diagnosis Summary
    console.log('\n============================');
    console.log('🎯 DIAGNOSIS SUMMARY');
    console.log('============================\n');

    const issues = [];
    const recommendations = [];

    if (!hasVectorExtension) {
      issues.push('❌ Vector extension not installed');
      recommendations.push('Install PostgreSQL vector extension');
    }

    if (!hasApiKey) {
      issues.push('❌ OpenAI API key missing');
      recommendations.push('Set OPENAI_API_KEY environment variable');
    }

    if (parseInt(stats.questions_without_embeddings) > 0) {
      issues.push(`❌ ${stats.questions_without_embeddings} questions missing embeddings`);
      recommendations.push('Run embedding generation for existing questions');
    }

    if (parseInt(eligibleQuestions) === 0) {
      issues.push('❌ No questions meet FAQ generation criteria');
      recommendations.push('Check confidence thresholds and question processing');
    }

    if (issues.length === 0) {
      console.log('✅ No major issues detected!');
      console.log('\nThe problem might be:');
      console.log('- Similarity threshold too high (current: 0.8)');
      console.log('- Questions are genuinely too dissimilar to cluster');
      console.log('- Minimum question count per cluster too high');
    } else {
      console.log('🚨 ISSUES FOUND:');
      issues.forEach(issue => console.log(`   ${issue}`));
      
      console.log('\n💡 RECOMMENDATIONS:');
      recommendations.forEach(rec => console.log(`   • ${rec}`));
    }

    console.log('\n🔧 NEXT STEPS:');
    console.log('   1. Address the issues listed above');
    console.log('   2. Run: node scripts/fix-embedding-issues.js');
    console.log('   3. Test FAQ generation again');

  } catch (error) {
    console.error('\n❌ Fatal error during diagnosis:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the diagnosis
diagnoseEmbeddingIssues().catch(console.error);