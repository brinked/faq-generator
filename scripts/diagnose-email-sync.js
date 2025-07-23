#!/usr/bin/env node

/**
 * Diagnose Email Sync Issues
 * This script helps identify why no customer emails are being synced
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function diagnoseEmailSync() {
  console.log('🔍 Diagnosing Email Sync Issues...\n');
  
  try {
    // Connect to database
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected\n');
    
    // 1. Check email distribution by sender
    console.log('📊 Email Distribution by Sender:');
    const senderStats = await pool.query(`
      SELECT 
        sender_email,
        COUNT(*) as email_count,
        MIN(received_at) as earliest_email,
        MAX(received_at) as latest_email
      FROM emails
      GROUP BY sender_email
      ORDER BY email_count DESC
      LIMIT 20
    `);
    
    console.log('Top 20 Senders:');
    senderStats.rows.forEach(row => {
      console.log(`  ${row.sender_email}: ${row.email_count} emails`);
    });
    
    // 2. Check unique sender domains
    console.log('\n📧 Unique Sender Domains:');
    const domainStats = await pool.query(`
      SELECT 
        SUBSTRING(sender_email FROM '@(.*)$') as domain,
        COUNT(DISTINCT sender_email) as unique_senders,
        COUNT(*) as total_emails
      FROM emails
      WHERE sender_email LIKE '%@%'
      GROUP BY domain
      ORDER BY total_emails DESC
      LIMIT 10
    `);
    
    domainStats.rows.forEach(row => {
      console.log(`  @${row.domain}: ${row.unique_senders} senders, ${row.total_emails} emails`);
    });
    
    // 3. Check email metadata
    console.log('\n📋 Email Metadata Analysis:');
    const metadataStats = await pool.query(`
      SELECT 
        COUNT(*) as total_emails,
        COUNT(DISTINCT message_id) as unique_messages,
        COUNT(DISTINCT thread_id) as unique_threads,
        COUNT(*) FILTER (WHERE thread_id IS NULL) as emails_without_thread,
        COUNT(*) FILTER (WHERE gmail_labels IS NOT NULL) as emails_with_labels
      FROM emails
    `);
    
    const stats = metadataStats.rows[0];
    console.log(`  Total Emails: ${stats.total_emails}`);
    console.log(`  Unique Messages: ${stats.unique_messages}`);
    console.log(`  Unique Threads: ${stats.unique_threads}`);
    console.log(`  Emails without Thread ID: ${stats.emails_without_thread}`);
    console.log(`  Emails with Gmail Labels: ${stats.emails_with_labels}`);
    
    // 4. Check Gmail labels
    console.log('\n🏷️  Gmail Label Analysis:');
    const labelQuery = await pool.query(`
      SELECT 
        gmail_labels,
        COUNT(*) as count
      FROM emails
      WHERE gmail_labels IS NOT NULL
      GROUP BY gmail_labels
      ORDER BY count DESC
      LIMIT 10
    `);
    
    if (labelQuery.rows.length > 0) {
      labelQuery.rows.forEach(row => {
        console.log(`  ${row.gmail_labels}: ${row.count} emails`);
      });
    } else {
      console.log('  No Gmail labels found');
    }
    
    // 5. Sample email subjects
    console.log('\n📝 Sample Email Subjects:');
    const subjectSample = await pool.query(`
      SELECT 
        subject,
        sender_email,
        received_at
      FROM emails
      ORDER BY received_at DESC
      LIMIT 10
    `);
    
    subjectSample.rows.forEach(row => {
      const date = new Date(row.received_at).toLocaleDateString();
      console.log(`  [${date}] ${row.sender_email}: "${row.subject}"`);
    });
    
    // 6. Check for any recipient information
    console.log('\n👥 Recipient Analysis:');
    const recipientCheck = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE recipient_emails IS NOT NULL) as has_recipients,
        COUNT(*) FILTER (WHERE recipient_emails IS NULL) as no_recipients
      FROM emails
    `);
    
    const recStats = recipientCheck.rows[0];
    console.log(`  Emails with recipients: ${recStats.has_recipients}`);
    console.log(`  Emails without recipients: ${recStats.no_recipients}`);
    
    // 7. Check sync configuration
    console.log('\n⚙️  Email Account Configuration:');
    const accountConfig = await pool.query(`
      SELECT 
        id,
        email_address,
        provider,
        status,
        last_sync_at,
        sync_enabled
      FROM email_accounts
    `);
    
    accountConfig.rows.forEach(acc => {
      console.log(`\n  Account: ${acc.email_address}`);
      console.log(`    Provider: ${acc.provider}`);
      console.log(`    Status: ${acc.status}`);
      console.log(`    Sync Enabled: ${acc.sync_enabled}`);
      console.log(`    Last Sync: ${acc.last_sync_at || 'Never'}`);
    });
    
    // Diagnosis
    console.log('\n\n🔍 DIAGNOSIS:');
    console.log('=====================================');
    
    if (senderStats.rows.length === 1 && senderStats.rows[0].sender_email.includes('extcabinets.com')) {
      console.log('❌ ISSUE: Only emails FROM your business account are being synced');
      console.log('\nPOSSIBLE CAUSES:');
      console.log('1. Gmail API might be configured to only sync SENT folder');
      console.log('2. Email sync query might be filtering by sender');
      console.log('3. OAuth scope might be limited to sent emails only');
      console.log('\nRECOMMENDED ACTIONS:');
      console.log('1. Check Gmail sync settings to include INBOX');
      console.log('2. Verify OAuth scopes include reading all emails');
      console.log('3. Review emailService.js sync logic');
    } else if (domainStats.rows.length === 1) {
      console.log('⚠️  WARNING: All emails are from a single domain');
    } else {
      console.log('✅ Email diversity looks normal');
    }
    
  } catch (error) {
    console.error('\n❌ Diagnosis failed:', error.message);
  } finally {
    await pool.end();
  }
}

// Run diagnosis
diagnoseEmailSync();