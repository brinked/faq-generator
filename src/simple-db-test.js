#!/usr/bin/env node

/**
 * Simple Database Test Script
 * Basic test without complex dependencies
 */

require('dotenv').config();
const { Pool } = require('pg');

async function testDatabase() {
  console.log('='.repeat(50));
  console.log('SIMPLE DATABASE TEST');
  console.log('='.repeat(50));
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    process.exit(1);
  }
  
  console.log('✅ DATABASE_URL is set');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  try {
    // Test basic connection
    console.log('Testing database connection...');
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    
    // Check tables
    console.log('Checking tables...');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('Found tables:', tables.rows.map(row => row.table_name));
    
    // Check expected tables
    const expectedTables = [
      'audit_logs',
      'email_accounts', 
      'emails',
      'faq_groups',
      'processing_jobs',
      'question_groups',
      'questions',
      'system_metrics',
      'system_settings'
    ];
    
    const foundTables = tables.rows.map(row => row.table_name);
    const missingTables = expectedTables.filter(table => !foundTables.includes(table));
    
    if (missingTables.length > 0) {
      console.log('❌ Missing tables:', missingTables);
    } else {
      console.log('✅ All expected tables found');
    }
    
    // Check extensions
    console.log('Checking extensions...');
    const extensions = await client.query(`
      SELECT extname 
      FROM pg_extension 
      ORDER BY extname
    `);
    
    console.log('Extensions:', extensions.rows.map(row => row.extname));
    
    // Check enum types
    console.log('Checking enum types...');
    const enums = await client.query(`
      SELECT typname 
      FROM pg_type 
      WHERE typtype = 'e' 
      ORDER BY typname
    `);
    
    console.log('Enum types:', enums.rows.map(row => row.typname));
    
    client.release();
    
    console.log('='.repeat(50));
    if (missingTables.length === 0) {
      console.log('🎉 DATABASE TEST PASSED - Schema is complete!');
    } else {
      console.log('⚠️  DATABASE TEST PARTIAL - Some tables missing');
    }
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testDatabase();