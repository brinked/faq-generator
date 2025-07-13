const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

async function runMigration() {
  try {
    logger.info('Starting database migration...');
    
    // Read the schema file
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split the schema into individual statements, handling functions properly
    const statements = [];
    let currentStatement = '';
    let inFunction = false;
    
    const lines = schema.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip comments and empty lines
      if (trimmedLine.startsWith('--') || trimmedLine === '') {
        continue;
      }
      
      currentStatement += line + '\n';
      
      // Check if we're entering a function
      if (trimmedLine.includes('CREATE OR REPLACE FUNCTION') ||
          trimmedLine.includes('CREATE FUNCTION')) {
        inFunction = true;
      }
      
      // Check if we're ending a function
      if (inFunction && trimmedLine.includes('$$ LANGUAGE')) {
        inFunction = false;
        statements.push(currentStatement.trim());
        currentStatement = '';
        continue;
      }
      
      // For non-function statements, split on semicolon
      if (!inFunction && trimmedLine.endsWith(';')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    // Filter out empty statements
    const validStatements = statements.filter(stmt => stmt.length > 0);
    
    // Execute each statement
    for (let i = 0; i < validStatements.length; i++) {
      const statement = validStatements[i];
      if (statement) {
        try {
          logger.info(`Executing statement ${i + 1}/${validStatements.length}`);
          await db.query(statement);
        } catch (error) {
          // Some statements might fail if they already exist, which is okay
          if (error.message.includes('already exists')) {
            logger.warn(`Statement ${i + 1} skipped (already exists): ${error.message}`);
          } else {
            logger.error(`Error executing statement ${i + 1}:`, error);
            throw error;
          }
        }
      }
    }
    
    logger.info('Database migration completed successfully');
    
    // Verify the migration by checking if tables exist
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    logger.info('Created tables:', tables.rows.map(row => row.table_name));
    
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };