#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

// Load environment variables from .env file
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runMigration } = require('./migrate');

async function main() {
  console.log('🔄 Starting database migration with environment variables...');
  
  // Check if required environment variables are set
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is required');
    console.log('Please set DATABASE_URL in your .env file or environment');
    console.log('Example: DATABASE_URL=postgresql://username:password@localhost:5432/database_name');
    process.exit(1);
  }
  
  console.log('✅ Environment variables loaded');
  console.log(`📊 Using database: ${process.env.DATABASE_URL.replace(/:([^@]+)@/, ':****@')}`);
  
  try {
    await runMigration();
    console.log('\n🎉 Migration completed successfully!');
    console.log('\n💡 You can now test the migration with:');
    console.log('   npm run test:migration');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

main(); 