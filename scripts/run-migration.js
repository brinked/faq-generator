#!/usr/bin/env node

/**
 * Database migration runner
 * Runs the email context migration for questions table
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function runMigration() {
  try {
    console.log('🔄 Running database migration: add_email_context_to_questions');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../database/migrations/add_email_context_to_questions.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await db.query(migrationSQL);
    
    console.log('✅ Migration completed successfully');
    console.log('📊 Added email context columns to questions table:');
    console.log('   - sender_email');
    console.log('   - sender_name'); 
    console.log('   - email_subject');
    console.log('🔍 Created indexes for faster lookups');
    console.log('📝 Updated existing questions with email context');
    
    // Verify the migration
    const result = await db.query(`
      SELECT COUNT(*) as total_questions,
             COUNT(sender_email) as questions_with_sender
      FROM questions
    `);
    
    const stats = result.rows[0];
    console.log(`\n📈 Migration Stats:`);
    console.log(`   Total questions: ${stats.total_questions}`);
    console.log(`   Questions with sender info: ${stats.questions_with_sender}`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };