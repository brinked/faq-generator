const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

/**
 * Run the email filtering migration
 */
router.post('/email-filtering', async (req, res) => {
  try {
    // Check if migration has already been run
    const columnCheckQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'emails' 
      AND column_name = 'filtering_status'
    `;
    
    const checkResult = await db.query(columnCheckQuery);
    
    if (checkResult.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Migration already applied',
        status: 'completed'
      });
    }
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../../database/migrations/add_email_filtering_fields.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf8');
    
    // Run the migration
    await db.query(migrationSQL);
    
    logger.info('Email filtering migration completed successfully');
    
    res.json({
      success: true,
      message: 'Email filtering migration applied successfully',
      status: 'completed',
      fieldsAdded: [
        'direction',
        'has_response',
        'filtering_status',
        'filtering_reason',
        'filtering_metadata',
        'is_automated',
        'is_spam',
        'quality_score'
      ]
    });
    
  } catch (error) {
    logger.error('Error running email filtering migration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run migration',
      details: error.message
    });
  }
});

/**
 * Check migration status
 */
router.get('/status', async (req, res) => {
  try {
    const query = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'emails' 
      AND column_name IN ('direction', 'has_response', 'filtering_status', 'filtering_reason', 'is_automated', 'is_spam', 'quality_score')
    `;
    
    const result = await db.query(query);
    const existingColumns = result.rows.map(row => row.column_name);
    
    const requiredColumns = ['direction', 'has_response', 'filtering_status', 'filtering_reason', 'is_automated', 'is_spam', 'quality_score'];
    const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
    
    res.json({
      success: true,
      emailFilteringMigration: {
        status: missingColumns.length === 0 ? 'completed' : 'pending',
        existingColumns,
        missingColumns,
        progress: `${existingColumns.length}/${requiredColumns.length} columns`
      }
    });
    
  } catch (error) {
    logger.error('Error checking migration status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check migration status',
      details: error.message
    });
  }
});

module.exports = router;