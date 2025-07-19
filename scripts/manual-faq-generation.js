#!/usr/bin/env node

/**
 * Manual FAQ Generation Script
 * 
 * This script manually processes emails and generates FAQs from unprocessed emails.
 * 
 * Usage: 
 *   node scripts/manual-faq-generation.js                    # Process all unprocessed emails
 *   node scripts/manual-faq-generation.js --limit 50         # Process up to 50 emails
 *   node scripts/manual-faq-generation.js --account <id>     # Process emails for specific account
 *   node scripts/manual-faq-generation.js --help            # Show help
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const EmailService = require('../src/services/emailService');
const FAQService = require('../src/services/faqService');
const AIService = require('../src/services/aiService');
const db = require('../src/config/database');

const args = process.argv.slice(2);

async function manualFAQGeneration() {
  try {
    // Parse command line arguments
    const options = parseArguments(args);
    
    if (options.help) {
      showHelp();
      return;
    }
    
    console.log('\n🤖 Manual FAQ Generation\n');
    
    const emailService = new EmailService();
    const faqService = new FAQService();
    const aiService = new AIService();
    const startTime = Date.now();
    
    // 1. Get unprocessed emails
    console.log('1. 📧 Getting unprocessed emails...');
    
    let whereClause = 'WHERE e.is_processed = false';
    let queryParams = [];
    let paramIndex = 1;
    
    if (options.accountId) {
      whereClause += ` AND e.account_id = $${paramIndex++}`;
      queryParams.push(options.accountId);
    }
    
    const limit = options.limit || 100;
    const query = `
      SELECT e.*, ea.email_address, ea.provider
      FROM emails e
      JOIN email_accounts ea ON e.account_id = ea.id
      ${whereClause}
      ORDER BY e.received_at DESC
      LIMIT $${paramIndex}
    `;
    queryParams.push(limit);
    
    const emailsResult = await db.query(query, queryParams);
    const emails = emailsResult.rows;
    
    if (emails.length === 0) {
      console.log('   ✅ No unprocessed emails found!');
      return;
    }
    
    console.log(`   📬 Found ${emails.length} unprocessed emails to process`);
    
    // Show sample emails
    console.log('\n   Sample emails:');
    emails.slice(0, 5).forEach((email, index) => {
      console.log(`   ${index + 1}. "${email.subject}" from ${email.sender_email} (${email.received_at})`);
    });
    
    if (emails.length > 5) {
      console.log(`   ... and ${emails.length - 5} more emails`);
    }
    
    // 2. Process emails for questions
    console.log('\n2. 🔍 Processing emails for questions...');
    
    let processedCount = 0;
    let questionsFound = 0;
    let errors = 0;
    
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const progress = `[${i + 1}/${emails.length}]`;
      
      try {
        console.log(`   ${progress} Processing: "${email.subject}"`);
        
        // Detect questions from email using AI
        const result = await aiService.detectQuestions(
          email.body_text || email.body_html || '',
          email.subject || ''
        );
        
        if (result && result.hasQuestions && result.questions && result.questions.length > 0) {
          console.log(`   ${progress} ✅ Found ${result.questions.length} question(s) (confidence: ${result.overallConfidence})`);
          
          // Store questions in database
          for (const question of result.questions) {
            try {
              const questionQuery = `
                INSERT INTO questions (
                  email_id, question_text, answer_text, confidence_score,
                  is_customer_question, created_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
                RETURNING id
              `;
              
              await db.query(questionQuery, [
                email.id,
                question.question,
                question.answer || '',
                question.confidence || 0.8,
                true
              ]);
              
              questionsFound++;
            } catch (questionError) {
              console.log(`   ${progress} ⚠️  Failed to store question: ${questionError.message}`);
            }
          }
        } else {
          console.log(`   ${progress} ➖ No questions found (${result?.reasoning || 'No analysis available'})`);
        }
        
        // Mark email as processed
        await emailService.markEmailProcessed(email.id, 'completed');
        processedCount++;
        
      } catch (processError) {
        console.log(`   ${progress} ❌ Error processing email: ${processError.message}`);
        await emailService.markEmailProcessed(email.id, 'failed', processError.message);
        errors++;
      }
      
      // Show progress every 10 emails
      if ((i + 1) % 10 === 0) {
        console.log(`   📊 Progress: ${i + 1}/${emails.length} emails processed, ${questionsFound} questions found`);
      }
    }
    
    // 3. Generate FAQ groups
    console.log('\n3. 📚 Generating FAQ groups...');
    
    try {
      const faqResult = await faqService.generateFAQs();
      console.log(`   ✅ Generated ${faqResult.groupsCreated || 0} FAQ groups`);
      console.log(`   📊 Total questions grouped: ${faqResult.questionsGrouped || 0}`);
    } catch (faqError) {
      console.log(`   ❌ FAQ generation failed: ${faqError.message}`);
    }
    
    const duration = Date.now() - startTime;
    
    // 4. Results summary
    console.log('\n4. 📊 Processing Results:');
    console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`   Emails processed: ${processedCount}`);
    console.log(`   Questions extracted: ${questionsFound}`);
    console.log(`   Errors: ${errors}`);
    
    // 5. Check final status
    console.log('\n5. 📈 Final Status Check:');
    
    const statusQuery = `
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE is_processed = true) as processed_emails,
        COUNT(*) FILTER (WHERE is_processed = false) as pending_emails
      FROM emails
    `;
    
    const statusResult = await db.query(statusQuery);
    const status = statusResult.rows[0];
    
    console.log(`   Total emails in database: ${status.total_emails}`);
    console.log(`   Processed emails: ${status.processed_emails}`);
    console.log(`   Pending emails: ${status.pending_emails}`);
    
    // 6. FAQ summary
    const faqQuery = `
      SELECT COUNT(*) as total_faqs FROM faq_groups
    `;
    const faqResult = await db.query(faqQuery);
    const totalFAQs = faqResult.rows[0].total_faqs;
    
    console.log(`   Total FAQ groups: ${totalFAQs}`);
    
    if (processedCount > 0) {
      console.log('\n✅ FAQ generation completed successfully!');
      console.log('\n💡 Next Steps:');
      console.log('   • Check FAQs in the web interface');
      console.log('   • Review generated questions and answers');
      console.log('   • Set up automated processing with cron jobs');
    } else {
      console.log('\n⚠️  No emails were processed successfully');
      console.log('\n💡 Troubleshooting:');
      console.log('   • Check AI service configuration');
      console.log('   • Verify OpenAI API key is set');
      console.log('   • Check email content quality');
    }
    
  } catch (error) {
    console.error('\n❌ Manual FAQ generation failed:', error);
    logger.error('Manual FAQ generation failed:', error);
  } finally {
    await db.end();
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(args) {
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
        
      case '--account':
      case '-a':
        options.accountId = args[++i];
        break;
        
      case '--limit':
      case '-l':
        options.limit = parseInt(args[++i]);
        break;
        
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
        
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown argument: ${arg}`);
        }
    }
  }
  
  return options;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Manual FAQ Generation Script

Usage: node scripts/manual-faq-generation.js [options]

Options:
  --help, -h                    Show this help message
  --account <id>, -a <id>       Process emails for specific account only
  --limit <num>, -l <num>       Maximum emails to process (default: 100)
  --verbose, -v                 Enable verbose logging

Examples:
  node scripts/manual-faq-generation.js
  node scripts/manual-faq-generation.js --limit 50
  node scripts/manual-faq-generation.js --account abc123-def456-ghi789
  node scripts/manual-faq-generation.js --limit 20 --verbose

Notes:
  • This script processes unprocessed emails and extracts questions/answers
  • Uses AI service to identify customer questions and support responses
  • Groups similar questions into FAQ categories
  • Requires OpenAI API key to be configured
  • Run email sync first to ensure latest emails are available
`);
}

// Handle process signals
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down FAQ generation');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down FAQ generation');
  process.exit(0);
});

// Run the generation
if (require.main === module) {
  manualFAQGeneration().catch(error => {
    console.error('Manual FAQ generation script failed:', error);
    process.exit(1);
  });
}

module.exports = { manualFAQGeneration };