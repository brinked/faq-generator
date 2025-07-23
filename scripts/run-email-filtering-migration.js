#!/usr/bin/env node

/**
 * Email Filtering Migration Runner
 * Run this script from the Render web service shell to apply the email filtering migration
 * 
 * Usage: node scripts/run-email-filtering-migration.js
 */

const { Pool } = require('pg');
require('dotenv').config();

// Create a new pool using the DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  console.log('🚀 Starting Email Filtering Migration...\n');
  
  try {
    // Test connection
    console.log('📡 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully!\n');
    
    // Check current state
    console.log('🔍 Checking current database state...');
    const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'emails' 
      AND column_name IN ('direction', 'has_response', 'filtering_status', 'filtering_reason', 
                          'is_automated', 'is_spam', 'quality_score', 'filtering_metadata')
    `;
    
    const checkResult = await pool.query(checkQuery);
    const existingColumns = checkResult.rows.map(row => row.column_name);
    console.log(`Found ${existingColumns.length} existing columns: ${existingColumns.join(', ') || 'none'}\n`);
    
    // Run migrations for each column
    const migrations = [
      {
        name: 'direction',
        sql: `ALTER TABLE emails ADD COLUMN direction VARCHAR(20) DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound'))`
      },
      {
        name: 'filtering_status',
        sql: `ALTER TABLE emails ADD COLUMN filtering_status VARCHAR(50) DEFAULT 'pending'`
      },
      {
        name: 'filtering_reason',
        sql: `ALTER TABLE emails ADD COLUMN filtering_reason TEXT`
      },
      {
        name: 'has_response',
        sql: `ALTER TABLE emails ADD COLUMN has_response BOOLEAN DEFAULT false`
      },
      {
        name: 'response_count',
        sql: `ALTER TABLE emails ADD COLUMN response_count INTEGER DEFAULT 0`
      },
      {
        name: 'is_automated',
        sql: `ALTER TABLE emails ADD COLUMN is_automated BOOLEAN DEFAULT false`
      },
      {
        name: 'is_spam',
        sql: `ALTER TABLE emails ADD COLUMN is_spam BOOLEAN DEFAULT false`
      },
      {
        name: 'quality_score',
        sql: `ALTER TABLE emails ADD COLUMN quality_score DOUBLE PRECISION DEFAULT 1.0`
      },
      {
        name: 'filtering_metadata',
        sql: `ALTER TABLE emails ADD COLUMN filtering_metadata JSONB DEFAULT '{}'`
      }
    ];
    
    console.log('🔧 Running migrations...\n');
    let addedColumns = 0;
    
    for (const migration of migrations) {
      if (existingColumns.includes(migration.name)) {
        console.log(`⏭️  Skipping ${migration.name} - already exists`);
      } else {
        try {
          await pool.query(migration.sql);
          console.log(`✅ Added column: ${migration.name}`);
          addedColumns++;
        } catch (error) {
          console.error(`❌ Failed to add ${migration.name}: ${error.message}`);
        }
      }
    }
    
    console.log(`\n📊 Added ${addedColumns} new columns\n`);
    
    // Create indexes
    console.log('🔍 Creating indexes...\n');
    const indexes = [
      {
        name: 'idx_emails_filtering_status',
        sql: `CREATE INDEX IF NOT EXISTS idx_emails_filtering_status ON emails(filtering_status) WHERE filtering_status != 'completed'`
      },
      {
        name: 'idx_emails_has_response',
        sql: `CREATE INDEX IF NOT EXISTS idx_emails_has_response ON emails(has_response) WHERE has_response = true`
      },
      {
        name: 'idx_emails_direction',
        sql: `CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(direction)`
      },
      {
        name: 'idx_emails_filtering_composite',
        sql: `CREATE INDEX IF NOT EXISTS idx_emails_filtering_composite ON emails(account_id, processed_for_faq, has_response, is_automated, is_spam) WHERE processed_for_faq = false`
      }
    ];
    
    for (const index of indexes) {
      try {
        await pool.query(index.sql);
        console.log(`✅ Created index: ${index.name}`);
      } catch (error) {
        console.error(`❌ Failed to create ${index.name}: ${error.message}`);
      }
    }
    
    // Verify final state
    console.log('\n🔍 Verifying migration...');
    const verifyResult = await pool.query(checkQuery);
    const finalColumns = verifyResult.rows.map(row => row.column_name);
    console.log(`\n✅ Migration complete! Found ${finalColumns.length} columns:`);
    finalColumns.forEach(col => console.log(`   - ${col}`));
    
    // Test the filtering stats endpoint
    console.log('\n🧪 Testing filtering stats endpoint...');
    console.log('You can now test: https://faq-generator-web.onrender.com/api/filtering-stats');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
  
  console.log('\n🎉 Migration completed successfully!');
  process.exit(0);
}

// Run the migration
runMigration();