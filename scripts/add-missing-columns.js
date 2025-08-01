#!/usr/bin/env node

require('dotenv').config();
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function addMissingColumns() {
  try {
    logger.info('🔧 Adding missing columns to database...');

    // Add missing columns to emails table
    const emailColumns = [
      {
        name: 'direction',
        type: 'VARCHAR(20) DEFAULT \'inbound\'',
        description: 'Email direction (inbound/outbound)'
      },
      {
        name: 'has_response',
        type: 'BOOLEAN DEFAULT false',
        description: 'Whether email has responses'
      },
      {
        name: 'filtering_status',
        type: 'VARCHAR(20) DEFAULT \'pending\'',
        description: 'Email filtering status'
      },
      {
        name: 'filtering_reason',
        type: 'TEXT',
        description: 'Reason for email filtering decision'
      }
    ];

    for (const column of emailColumns) {
      try {
        await db.query(`
          ALTER TABLE emails 
          ADD COLUMN ${column.name} ${column.type}
        `);
        logger.info(`✅ Added column: emails.${column.name} - ${column.description}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.info(`ℹ️  Column already exists: emails.${column.name}`);
        } else {
          logger.error(`❌ Error adding column emails.${column.name}:`, error.message);
        }
      }
    }

    // Add missing columns to questions table
    const questionColumns = [
      {
        name: 'embedding_vector',
        type: 'TEXT',
        description: 'Text representation of embedding vector'
      },
      {
        name: 'confidence',
        type: 'NUMERIC(3,2) DEFAULT 0.5',
        description: 'Confidence score for question detection'
      },
      {
        name: 'category',
        type: 'VARCHAR(100) DEFAULT \'general\'',
        description: 'Question category'
      },
      {
        name: 'detected_at',
        type: 'TIMESTAMP WITH TIME ZONE DEFAULT now()',
        description: 'When question was detected'
      },
      {
        name: 'metadata',
        type: 'JSONB',
        description: 'Additional metadata for question'
      }
    ];

    for (const column of questionColumns) {
      try {
        await db.query(`
          ALTER TABLE questions 
          ADD COLUMN ${column.name} ${column.type}
        `);
        logger.info(`✅ Added column: questions.${column.name} - ${column.description}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.info(`ℹ️  Column already exists: questions.${column.name}`);
        } else {
          logger.error(`❌ Error adding column questions.${column.name}:`, error.message);
        }
      }
    }

    // Add missing columns to system_metrics table
    try {
      await db.query(`
        ALTER TABLE system_metrics 
        ADD COLUMN metric_value TEXT
      `);
      logger.info('✅ Added column: system_metrics.metric_value');
    } catch (error) {
      if (error.message.includes('already exists')) {
        logger.info('ℹ️  Column already exists: system_metrics.metric_value');
      } else {
        logger.error('❌ Error adding column system_metrics.metric_value:', error.message);
      }
    }

    logger.info('🎉 Database schema update completed!');

  } catch (error) {
    logger.error('❌ Error updating database schema:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the migration if this file is executed directly
if (require.main === module) {
  addMissingColumns()
    .then(() => {
      console.log('\n🎉 Database schema update completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Database schema update failed:', error.message);
      process.exit(1);
    });
}

module.exports = { addMissingColumns }; 