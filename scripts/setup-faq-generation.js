const db = require('../src/config/database');
const logger = require('../src/utils/logger');
require('dotenv').config();

async function setupFAQGeneration() {
  try {
    console.log('🔧 Setting up FAQ Generation Database Schema...');
    
    // Check if required columns exist
    const columnCheck = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'emails'
      AND column_name IN ('processed_for_faq', 'direction', 'filtering_status')
    `);
    
    const existingColumns = columnCheck.rows.map(row => row.column_name);
    const missingColumns = ['processed_for_faq', 'direction', 'filtering_status'].filter(col => !existingColumns.includes(col));
    
    if (missingColumns.length > 0) {
      console.log(`📝 Adding missing columns: ${missingColumns.join(', ')}`);
      
      // Add missing columns
      for (const column of missingColumns) {
        let sql = '';
        switch (column) {
          case 'processed_for_faq':
            sql = 'ALTER TABLE emails ADD COLUMN processed_for_faq BOOLEAN NOT NULL DEFAULT false';
            break;
          case 'direction':
            sql = 'ALTER TABLE emails ADD COLUMN direction VARCHAR(20) DEFAULT \'inbound\'';
            break;
          case 'filtering_status':
            sql = 'ALTER TABLE emails ADD COLUMN filtering_status VARCHAR(50) DEFAULT \'pending\'';
            break;
        }
        
        if (sql) {
          await db.query(sql);
          console.log(`✅ Added column: ${column}`);
        }
      }
      
      // Add additional FAQ generation columns
      const additionalColumns = [
        { name: 'filtering_reason', sql: 'ALTER TABLE emails ADD COLUMN filtering_reason TEXT' },
        { name: 'has_response', sql: 'ALTER TABLE emails ADD COLUMN has_response BOOLEAN DEFAULT false' },
        { name: 'response_count', sql: 'ALTER TABLE emails ADD COLUMN response_count INTEGER DEFAULT 0' },
        { name: 'is_automated', sql: 'ALTER TABLE emails ADD COLUMN is_automated BOOLEAN DEFAULT false' },
        { name: 'is_spam', sql: 'ALTER TABLE emails ADD COLUMN is_spam BOOLEAN DEFAULT false' },
        { name: 'quality_score', sql: 'ALTER TABLE emails ADD COLUMN quality_score DOUBLE PRECISION DEFAULT 0.0' },
        { name: 'filtering_metadata', sql: 'ALTER TABLE emails ADD COLUMN filtering_metadata JSONB' }
      ];
      
      for (const col of additionalColumns) {
        try {
          await db.query(col.sql);
          console.log(`✅ Added column: ${col.name}`);
        } catch (error) {
          if (error.code === '42701') { // Column already exists
            console.log(`ℹ️  Column already exists: ${col.name}`);
          } else {
            console.error(`❌ Error adding column ${col.name}:`, error.message);
          }
        }
      }
      
      // Create indexes for FAQ generation
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_emails_filtering_status ON emails USING btree (filtering_status)',
        'CREATE INDEX IF NOT EXISTS idx_emails_has_response ON emails USING btree (has_response)',
        'CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails USING btree (direction)'
      ];
      
      for (const indexSql of indexes) {
        try {
          await db.query(indexSql);
          console.log(`✅ Created index: ${indexSql.split(' ')[2]}`);
        } catch (error) {
          console.error(`❌ Error creating index:`, error.message);
        }
      }
      
    } else {
      console.log('✅ All required columns already exist');
    }
    
    // Check if update_faq_group_stats function exists
    const functionCheck = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' 
        AND p.proname = 'update_faq_group_stats'
      ) as function_exists
    `);
    
    if (!functionCheck.rows[0].function_exists) {
      console.log('📝 Creating update_faq_group_stats function...');
      await db.query(`
        CREATE OR REPLACE FUNCTION update_faq_group_stats(group_uuid uuid)
        RETURNS void
        LANGUAGE plpgsql
        AS $$
        BEGIN
          UPDATE faq_groups
          SET 
            question_count = (SELECT COUNT(*) FROM question_groups WHERE group_id = group_uuid),
            updated_at = NOW()
          WHERE id = group_uuid;
        END;
        $$
      `);
      console.log('✅ Created update_faq_group_stats function');
    } else {
      console.log('✅ update_faq_group_stats function already exists');
    }
    
    console.log('\n🎉 FAQ Generation setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Run email sync: node scripts/manual-email-sync.js');
    console.log('2. Process emails for FAQs: node scripts/process-test-emails.js');
    console.log('3. Generate FAQs: node scripts/create-simple-faqs.js');
    console.log('4. Check status: node scripts/check-faq-status.js');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  } finally {
    await db.end();
  }
}

setupFAQGeneration(); 