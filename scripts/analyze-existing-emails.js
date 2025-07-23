#!/usr/bin/env node

/**
 * Analyze Existing Emails Script
 * This script analyzes all existing emails to populate the new filtering fields
 * 
 * Usage: node scripts/analyze-existing-emails.js
 */

const { Pool } = require('pg');
require('dotenv').config();

// Create a new pool using the DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function analyzeExistingEmails() {
  console.log('🔍 Starting Email Analysis...\n');
  
  try {
    // Test connection
    console.log('📡 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully!\n');
    
    // Get all connected email accounts
    console.log('📧 Fetching connected email accounts...');
    const accountsResult = await pool.query(`
      SELECT id, email_address, status 
      FROM email_accounts 
      WHERE status = 'active'
    `);
    const connectedAccounts = accountsResult.rows;
    const accountEmails = connectedAccounts.map(acc => acc.email_address.toLowerCase());
    console.log(`Found ${connectedAccounts.length} active accounts:`, accountEmails.join(', '));
    
    // Step 1: Mark all emails from connected accounts as outbound
    console.log('\n🔄 Step 1: Marking outbound emails...');
    const outboundResult = await pool.query(`
      UPDATE emails 
      SET direction = 'outbound'
      WHERE LOWER(sender_email) = ANY($1::text[])
      AND direction IS NULL OR direction = 'inbound'
    `, [accountEmails]);
    console.log(`✅ Marked ${outboundResult.rowCount} emails as outbound\n`);
    
    // Step 2: Ensure all other emails are marked as inbound
    console.log('🔄 Step 2: Marking inbound emails...');
    const inboundResult = await pool.query(`
      UPDATE emails 
      SET direction = 'inbound'
      WHERE direction IS NULL
    `);
    console.log(`✅ Marked ${inboundResult.rowCount} emails as inbound\n`);
    
    // Step 3: Analyze threads to find responses
    console.log('🔄 Step 3: Analyzing email threads for responses...');
    
    // Get all unique threads
    const threadsResult = await pool.query(`
      SELECT DISTINCT thread_id 
      FROM emails 
      WHERE thread_id IS NOT NULL
    `);
    
    let threadsWithResponses = 0;
    let emailsMarkedWithResponse = 0;
    
    for (const thread of threadsResult.rows) {
      // Get all emails in this thread ordered by date
      const threadEmails = await pool.query(`
        SELECT id, sender_email, direction, received_at, subject
        FROM emails 
        WHERE thread_id = $1
        ORDER BY received_at ASC
      `, [thread.thread_id]);
      
      // Check if there's at least one inbound and one outbound email
      const hasInbound = threadEmails.rows.some(e => e.direction === 'inbound');
      const hasOutbound = threadEmails.rows.some(e => e.direction === 'outbound');
      
      if (hasInbound && hasOutbound) {
        threadsWithResponses++;
        
        // Mark all inbound emails in this thread as having responses
        const updateResult = await pool.query(`
          UPDATE emails 
          SET has_response = true
          WHERE thread_id = $1 
          AND direction = 'inbound'
          AND (has_response IS NULL OR has_response = false)
        `, [thread.thread_id]);
        
        emailsMarkedWithResponse += updateResult.rowCount;
      }
    }
    
    console.log(`✅ Found ${threadsWithResponses} threads with responses`);
    console.log(`✅ Marked ${emailsMarkedWithResponse} customer emails as having responses\n`);
    
    // Step 4: For emails without thread_id, try to match by subject
    console.log('🔄 Step 4: Analyzing emails without thread IDs...');
    
    // Get inbound emails without responses and without thread_id
    const orphanEmails = await pool.query(`
      SELECT id, subject, sender_email, received_at
      FROM emails 
      WHERE direction = 'inbound' 
      AND (has_response IS NULL OR has_response = false)
      AND thread_id IS NULL
    `);
    
    let orphansWithResponses = 0;
    
    for (const email of orphanEmails.rows) {
      // Clean subject for matching (remove Re:, Fwd:, etc.)
      const cleanSubject = email.subject
        .replace(/^(Re:|Fwd:|Fw:)\s*/gi, '')
        .trim()
        .toLowerCase();
      
      // Look for outbound emails with similar subject
      const responseCheck = await pool.query(`
        SELECT COUNT(*) as response_count
        FROM emails 
        WHERE direction = 'outbound'
        AND LOWER(REGEXP_REPLACE(subject, '^(Re:|Fwd:|Fw:)\\s*', '', 'gi')) = $1
        AND received_at > $2
      `, [cleanSubject, email.received_at]);
      
      if (parseInt(responseCheck.rows[0].response_count) > 0) {
        await pool.query(`
          UPDATE emails 
          SET has_response = true
          WHERE id = $1
        `, [email.id]);
        orphansWithResponses++;
      }
    }
    
    console.log(`✅ Found ${orphansWithResponses} additional emails with responses\n`);
    
    // Step 5: Update filtering status for all emails
    console.log('🔄 Step 5: Updating filtering status...');
    
    // Mark emails from business accounts as filtered out
    await pool.query(`
      UPDATE emails 
      SET filtering_status = 'filtered_out',
          filtering_reason = 'Email from connected business account'
      WHERE direction = 'outbound'
      AND (filtering_status IS NULL OR filtering_status = 'pending')
    `);
    
    // Mark customer emails without responses as filtered out
    await pool.query(`
      UPDATE emails 
      SET filtering_status = 'filtered_out',
          filtering_reason = 'No response from business'
      WHERE direction = 'inbound'
      AND (has_response IS NULL OR has_response = false)
      AND (filtering_status IS NULL OR filtering_status = 'pending')
    `);
    
    // Mark customer emails with responses as qualified
    const qualifiedResult = await pool.query(`
      UPDATE emails 
      SET filtering_status = 'qualified'
      WHERE direction = 'inbound'
      AND has_response = true
      AND (filtering_status IS NULL OR filtering_status = 'pending')
    `);
    
    console.log(`✅ Marked ${qualifiedResult.rowCount} emails as qualified for FAQ generation\n`);
    
    // Final statistics
    console.log('📊 Final Statistics:');
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_emails,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_emails,
        COUNT(*) FILTER (WHERE has_response = true) as emails_with_responses,
        COUNT(*) FILTER (WHERE filtering_status = 'qualified') as qualified_emails,
        COUNT(*) FILTER (WHERE filtering_status = 'filtered_out') as filtered_emails
      FROM emails
    `);
    
    const finalStats = stats.rows[0];
    console.log(`
    Total Emails: ${finalStats.total_emails}
    Inbound: ${finalStats.inbound_emails}
    Outbound: ${finalStats.outbound_emails}
    With Responses: ${finalStats.emails_with_responses}
    Qualified for FAQ: ${finalStats.qualified_emails}
    Filtered Out: ${finalStats.filtered_emails}
    `);
    
    console.log('🎉 Email analysis completed successfully!');
    console.log('\n📌 Next: Check https://faq-generator-web.onrender.com/api/filtering-stats');
    console.log('Your FAQ Processing Center should now show questions from qualified emails.');
    
  } catch (error) {
    console.error('\n❌ Analysis failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
  
  process.exit(0);
}

// Run the analysis
analyzeExistingEmails();