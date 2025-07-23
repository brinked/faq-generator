#!/usr/bin/env node

/**
 * Test script for email filtering improvements
 * Tests the new filtering logic to ensure only qualified emails are processed
 */

require('dotenv').config();
const db = require('../src/config/database');
const EmailService = require('../src/services/emailService');
const EmailFilteringService = require('../src/services/emailFilteringService');
const logger = require('../src/utils/logger');

async function testEmailFiltering() {
  try {
    logger.info('Starting email filtering test...');
    
    // Initialize services
    const emailService = new EmailService();
    const filteringService = new EmailFilteringService();
    
    // Connect to database
    await db.connect();
    logger.info('Connected to database');
    
    // Get connected accounts
    const connectedAccounts = await emailService.getAccounts();
    logger.info(`Found ${connectedAccounts.length} connected accounts:`, 
      connectedAccounts.map(acc => acc.email_address)
    );
    
    // Get sample emails for testing
    const testEmailsQuery = `
      SELECT 
        e.id, e.subject, e.body_text, e.sender_email, 
        e.thread_id, e.received_at, e.recipient_emails, 
        e.cc_emails, e.account_id
      FROM emails e
      ORDER BY e.received_at DESC
      LIMIT 20
    `;
    
    const result = await db.query(testEmailsQuery);
    const testEmails = result.rows;
    
    logger.info(`\nTesting ${testEmails.length} emails...\n`);
    
    // Test each email
    const results = {
      total: testEmails.length,
      qualified: 0,
      disqualified: 0,
      reasons: {}
    };
    
    for (const email of testEmails) {
      logger.info(`\n${'='.repeat(80)}`);
      logger.info(`Testing email: ${email.subject || 'No subject'}`);
      logger.info(`From: ${email.sender_email}`);
      logger.info(`Thread ID: ${email.thread_id || 'None'}`);
      
      // Test qualification
      const qualification = await filteringService.doesEmailQualifyForFAQ(email, connectedAccounts);
      
      logger.info(`\nQualification Result:`);
      logger.info(`- Qualifies: ${qualification.qualifies ? '✅ YES' : '❌ NO'}`);
      logger.info(`- Reason: ${qualification.reason}`);
      logger.info(`- Confidence: ${(qualification.confidence * 100).toFixed(1)}%`);
      
      if (qualification.checks) {
        logger.info(`\nDetailed Checks:`);
        logger.info(`- Is from customer: ${qualification.checks.isFromCustomer ? '✅' : '❌'}`);
        logger.info(`- Has response: ${qualification.checks.hasResponse ? '✅' : '❌'}`);
        logger.info(`- Not spam: ${qualification.checks.isNotSpam ? '✅' : '❌'}`);
        logger.info(`- Not automated: ${qualification.checks.isNotAutomated ? '✅' : '❌'}`);
        
        if (qualification.checks.threadAnalysis) {
          const thread = qualification.checks.threadAnalysis;
          logger.info(`\nThread Analysis:`);
          logger.info(`- Total emails in thread: ${thread.totalEmails}`);
          logger.info(`- Customer emails: ${thread.customerEmails}`);
          logger.info(`- Business responses: ${thread.businessResponses}`);
          logger.info(`- Has business response: ${thread.hasResponseFromBusiness ? '✅' : '❌'}`);
        }
      }
      
      // Update statistics
      if (qualification.qualifies) {
        results.qualified++;
      } else {
        results.disqualified++;
        results.reasons[qualification.reason] = (results.reasons[qualification.reason] || 0) + 1;
      }
    }
    
    // Display summary
    logger.info(`\n${'='.repeat(80)}`);
    logger.info(`\nFILTERING TEST SUMMARY:`);
    logger.info(`- Total emails tested: ${results.total}`);
    logger.info(`- Qualified for FAQ: ${results.qualified} (${(results.qualified / results.total * 100).toFixed(1)}%)`);
    logger.info(`- Disqualified: ${results.disqualified} (${(results.disqualified / results.total * 100).toFixed(1)}%)`);
    
    if (results.disqualified > 0) {
      logger.info(`\nDisqualification Reasons:`);
      for (const [reason, count] of Object.entries(results.reasons)) {
        logger.info(`- ${reason}: ${count} emails`);
      }
    }
    
    // Test batch qualification
    logger.info(`\n${'='.repeat(80)}`);
    logger.info(`\nTesting batch qualification...`);
    
    const batchResult = await filteringService.batchQualifyEmails(testEmails.slice(0, 5), connectedAccounts);
    logger.info(`\nBatch Results:`);
    logger.info(`- Total: ${batchResult.summary.total}`);
    logger.info(`- Qualified: ${batchResult.summary.qualified}`);
    logger.info(`- Disqualified: ${batchResult.summary.disqualified}`);
    
    // Test filtering statistics
    logger.info(`\n${'='.repeat(80)}`);
    logger.info(`\nGetting filtering statistics...`);
    
    const stats = await filteringService.getFilteringStats();
    logger.info(`\nDatabase Statistics:`);
    logger.info(`- Total emails: ${stats.total_emails}`);
    logger.info(`- Processed emails: ${stats.processed_emails}`);
    logger.info(`- Emails with questions: ${stats.emails_with_questions}`);
    logger.info(`- Unique senders: ${stats.unique_senders}`);
    logger.info(`- Unique threads: ${stats.unique_threads}`);
    
    logger.info(`\n✅ Email filtering test completed successfully!`);
    
  } catch (error) {
    logger.error('Error during email filtering test:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run the test
testEmailFiltering().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});