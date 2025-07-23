#!/usr/bin/env node

/**
 * Fix Email Direction Script
 * Properly categorizes emails as inbound/outbound based on sender
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixEmailDirection() {
  console.log('🔧 Fixing Email Direction Classification...\n');
  
  try {
    // Connect to database
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected\n');
    
    // Get connected accounts
    console.log('📧 Fetching connected email accounts...');
    const accountsResult = await pool.query(`
      SELECT id, email_address 
      FROM email_accounts 
      WHERE status = 'active'
    `);
    const connectedAccounts = accountsResult.rows;
    console.log(`Found ${connectedAccounts.length} active accounts:`, 
      connectedAccounts.map(a => a.email_address).join(', '));
    
    // Reset all directions to inbound first
    console.log('\n🔄 Step 1: Resetting all emails to inbound...');
    await pool.query(`UPDATE emails SET direction = 'inbound'`);
    
    // Mark emails from business accounts as outbound
    console.log('\n🔄 Step 2: Identifying outbound emails...');
    let totalOutbound = 0;
    
    for (const account of connectedAccounts) {
      const email = account.email_address.toLowerCase();
      
      // Update emails where sender contains this email address
      const result = await pool.query(`
        UPDATE emails 
        SET direction = 'outbound'
        WHERE LOWER(sender_email) LIKE $1
        OR LOWER(sender_email) = $2
      `, [`%${email}%`, email]);
      
      console.log(`  ${email}: ${result.rowCount} emails marked as outbound`);
      totalOutbound += result.rowCount;
    }
    
    console.log(`\n✅ Total outbound emails: ${totalOutbound}`);
    
    // Get updated statistics
    const stats = await pool.query(`
      SELECT 
        direction,
        COUNT(*) as count
      FROM emails
      GROUP BY direction
    `);
    
    console.log('\n📊 Updated Email Distribution:');
    stats.rows.forEach(row => {
      console.log(`  ${row.direction}: ${row.count} emails`);
    });
    
    // Now analyze threads for responses
    console.log('\n🔄 Step 3: Analyzing email threads for responses...');
    
    // Get all unique threads
    const threadsResult = await pool.query(`
      SELECT DISTINCT thread_id 
      FROM emails 
      WHERE thread_id IS NOT NULL
    `);
    
    let threadsWithResponses = 0;
    let emailsMarkedWithResponse = 0;
    
    for (const thread of threadsResult.rows) {
      // Get all emails in this thread
      const threadEmails = await pool.query(`
        SELECT id, direction, received_at
        FROM emails 
        WHERE thread_id = $1
        ORDER BY received_at ASC
      `, [thread.thread_id]);
      
      const hasInbound = threadEmails.rows.some(e => e.direction === 'inbound');
      const hasOutbound = threadEmails.rows.some(e => e.direction === 'outbound');
      
      if (hasInbound && hasOutbound) {
        threadsWithResponses++;
        
        // Mark inbound emails as having responses
        const updateResult = await pool.query(`
          UPDATE emails 
          SET has_response = true
          WHERE thread_id = $1 
          AND direction = 'inbound'
        `, [thread.thread_id]);
        
        emailsMarkedWithResponse += updateResult.rowCount;
      }
    }
    
    console.log(`✅ Found ${threadsWithResponses} threads with responses`);
    console.log(`✅ Marked ${emailsMarkedWithResponse} customer emails as having responses`);
    
    // Update filtering status
    console.log('\n🔄 Step 4: Updating filtering status...');
    
    // Mark outbound emails as filtered
    await pool.query(`
      UPDATE emails 
      SET filtering_status = 'filtered_out',
          filtering_reason = 'Email from connected business account'
      WHERE direction = 'outbound'
    `);
    
    // Mark inbound without responses as filtered
    await pool.query(`
      UPDATE emails 
      SET filtering_status = 'filtered_out',
          filtering_reason = 'No response from business'
      WHERE direction = 'inbound'
      AND (has_response IS NULL OR has_response = false)
    `);
    
    // Mark inbound with responses as qualified
    const qualifiedResult = await pool.query(`
      UPDATE emails 
      SET filtering_status = 'qualified'
      WHERE direction = 'inbound'
      AND has_response = true
    `);
    
    console.log(`✅ Marked ${qualifiedResult.rowCount} emails as qualified for FAQ generation`);
    
    // Final statistics
    console.log('\n📊 Final Statistics:');
    const finalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_emails,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_emails,
        COUNT(*) FILTER (WHERE has_response = true) as emails_with_responses,
        COUNT(*) FILTER (WHERE filtering_status = 'qualified') as qualified_emails
      FROM emails
    `);
    
    const final = finalStats.rows[0];
    console.log(`
    Total Emails: ${final.total_emails}
    Inbound (Customer): ${final.inbound_emails}
    Outbound (Business): ${final.outbound_emails}
    With Responses: ${final.emails_with_responses}
    Qualified for FAQ: ${final.qualified_emails}
    `);
    
    console.log('🎉 Email direction fix completed successfully!');
    console.log('\n📌 Check https://faq-generator-web.onrender.com/api/filtering-stats');
    
  } catch (error) {
    console.error('\n❌ Fix failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixEmailDirection();