#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function runSimpleMigration() {
  try {
    logger.info('Starting simplified database migration...');
    
    // Read the simplified schema file
    const schemaPath = path.join(__dirname, '..', 'database', 'schema-simple.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Parse the schema into different statement types
    const lines = schema.split('\n');
    const enums = [];
    const tables = [];
    const primaryKeys = [];
    const uniqueConstraints = [];
    const foreignKeys = [];
    const indexes = [];
    
    let currentStatement = '';
    let inMultiLineStatement = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip comments and empty lines
      if (trimmedLine.startsWith('--') || trimmedLine === '') {
        continue;
      }
      
      currentStatement += line + '\n';
      
      // Check if this line ends a statement
      if (trimmedLine.endsWith(';')) {
        const statement = currentStatement.trim();
        currentStatement = '';
        
        if (statement.includes('CREATE TYPE')) {
          enums.push(statement);
        } else if (statement.includes('CREATE TABLE')) {
          tables.push(statement);
        } else if (statement.includes('ADD CONSTRAINT') && statement.includes('PRIMARY KEY')) {
          primaryKeys.push(statement);
        } else if (statement.includes('ADD CONSTRAINT') && statement.includes('UNIQUE')) {
          uniqueConstraints.push(statement);
        } else if (statement.includes('ADD CONSTRAINT') && statement.includes('FOREIGN KEY')) {
          foreignKeys.push(statement);
        } else if (statement.includes('CREATE INDEX')) {
          indexes.push(statement);
        }
      }
    }
    
    // First, ensure required extensions are created
    logger.info('Ensuring required extensions are installed...');
    try {
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
      logger.info('✅ uuid-ossp extension installed');
    } catch (error) {
      if (error.message.includes('already exists')) {
        logger.info('✅ uuid-ossp extension already exists');
      } else {
        logger.warn(`⚠️  Could not install uuid-ossp extension: ${error.message}`);
      }
    }

    // Execute ENUMS first
    logger.info('Creating ENUMs...');
    for (let i = 0; i < enums.length; i++) {
      try {
        logger.info(`Creating ENUM ${i + 1}/${enums.length}`);
        await db.query(enums[i]);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.warn(`ENUM ${i + 1} skipped: ${error.message}`);
        } else {
          logger.error(`Error creating ENUM ${i + 1}:`, error);
          throw error;
        }
      }
    }

    // Execute TABLE creation
    logger.info('Creating tables...');
    for (let i = 0; i < tables.length; i++) {
      try {
        logger.info(`Creating table ${i + 1}/${tables.length}`);
        await db.query(tables[i]);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.warn(`Table ${i + 1} skipped: ${error.message}`);
        } else {
          logger.error(`Error creating table ${i + 1}:`, error);
          throw error;
        }
      }
    }

    // Execute PRIMARY KEY constraints
    logger.info('Adding primary keys...');
    for (let i = 0; i < primaryKeys.length; i++) {
      try {
        logger.info(`Adding primary key ${i + 1}/${primaryKeys.length}`);
        await db.query(primaryKeys[i]);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.warn(`Primary key ${i + 1} skipped: ${error.message}`);
        } else {
          logger.error(`Error adding primary key ${i + 1}:`, error);
          throw error;
        }
      }
    }

    // Execute UNIQUE constraints
    logger.info('Adding unique constraints...');
    for (let i = 0; i < uniqueConstraints.length; i++) {
      try {
        logger.info(`Adding unique constraint ${i + 1}/${uniqueConstraints.length}`);
        await db.query(uniqueConstraints[i]);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.warn(`Unique constraint ${i + 1} skipped: ${error.message}`);
        } else {
          logger.error(`Error adding unique constraint ${i + 1}:`, error);
          throw error;
        }
      }
    }

    // Execute FOREIGN KEY constraints
    logger.info('Adding foreign keys...');
    for (let i = 0; i < foreignKeys.length; i++) {
      try {
        logger.info(`Adding foreign key ${i + 1}/${foreignKeys.length}`);
        await db.query(foreignKeys[i]);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.warn(`Foreign key ${i + 1} skipped: ${error.message}`);
        } else {
          logger.error(`Error adding foreign key ${i + 1}:`, error);
          throw error;
        }
      }
    }

    // Execute INDEXES last
    logger.info('Creating indexes...');
    for (let i = 0; i < indexes.length; i++) {
      try {
        logger.info(`Creating index ${i + 1}/${indexes.length}`);
        await db.query(indexes[i]);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.warn(`Index ${i + 1} skipped: ${error.message}`);
        } else {
          logger.error(`Error creating index ${i + 1}:`, error);
          throw error;
        }
      }
    }
    
    logger.info('✅ Simplified database migration completed successfully');
    
    // Verify the migration by checking if tables exist
    const tablesResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    logger.info(`📊 Found ${tablesResult.rows.length} tables in database`);
    tablesResult.rows.forEach(table => {
      logger.info(`   - ${table.table_name}`);
    });
    
  } catch (error) {
    logger.error('❌ Simplified migration failed:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the migration if this file is executed directly
if (require.main === module) {
  runSimpleMigration()
    .then(() => {
      console.log('\n🎉 Simplified migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Simplified migration failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runSimpleMigration }; 