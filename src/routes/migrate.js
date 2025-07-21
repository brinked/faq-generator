const express = require('express');
const router = express.Router();
const db = require('../config/database');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Migration endpoint - should be secured in production
router.post('/run-migration', async (req, res) => {
  try {
    const { migrationName } = req.body;
    
    if (!migrationName) {
      return res.status(400).json({ error: 'Migration name is required' });
    }

    const migrationPath = path.join(__dirname, '../../database/migrations', `${migrationName}.sql`);
    
    if (!fs.existsSync(migrationPath)) {
      return res.status(404).json({ error: 'Migration file not found' });
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    logger.info(`Running migration: ${migrationName}`);
    
    await db.query(migrationSQL);
    
    logger.info(`Migration completed successfully: ${migrationName}`);
    
    res.json({ 
      success: true, 
      message: `Migration ${migrationName} completed successfully` 
    });
    
  } catch (error) {
    logger.error('Migration failed:', error);
    res.status(500).json({ 
      error: 'Migration failed', 
      details: error.message 
    });
  }
});

// List available migrations
router.get('/list', async (req, res) => {
  try {
    const migrationsDir = path.join(__dirname, '../../database/migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      return res.json({ migrations: [] });
    }
    
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .map(file => file.replace('.sql', ''));
    
    res.json({ migrations: files });
    
  } catch (error) {
    logger.error('Failed to list migrations:', error);
    res.status(500).json({ 
      error: 'Failed to list migrations', 
      details: error.message 
    });
  }
});

module.exports = router;