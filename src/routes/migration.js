const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Run database migrations via API
 * This allows running migrations on Render without SSH access
 */
router.post('/run', async (req, res) => {
  try {
    logger.info('🔧 Running database migrations via API...');
    
    // Security check - only allow in production with a secret key
    const migrationKey = req.headers['x-migration-key'];
    const expectedKey = process.env.MIGRATION_KEY || 'default-migration-key';
    
    if (process.env.NODE_ENV === 'production' && migrationKey !== expectedKey) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid migration key'
      });
    }
    
    const results = [];
    
    // Migration 1: Add processed_for_faq columns
    try {
      const migrationPath = path.join(__dirname, '../../database/migrations/add_processed_for_faq_column.sql');
      
      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        await db.query(migrationSQL);
        
        results.push({
          migration: 'add_processed_for_faq_column.sql',
          status: 'success',
          message: 'Added missing columns to emails table'
        });
      } else {
        // Fallback: ensure processed_for_faq and processed_at columns exist
        await db.query(`
          ALTER TABLE IF EXISTS public.emails
          ADD COLUMN IF NOT EXISTS processed_for_faq BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL,
          ADD COLUMN IF NOT EXISTS processing_error TEXT NULL
        `);
        results.push({
          migration: 'add_processed_for_faq_column.sql',
          status: 'fallback',
          message: 'Applied fallback to add processed_for_faq, processed_at, processing_error columns'
        });
      }
    } catch (error) {
      results.push({
        migration: 'add_processed_for_faq_column.sql',
        status: 'error',
        message: error.message
      });
    }
    
    // Migration 2: Add missing questions columns
    try {
      const migrationPath = path.join(__dirname, '../../database/migrations/add_missing_questions_columns.sql');
      
      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        await db.query(migrationSQL);
        
        results.push({
          migration: 'add_missing_questions_columns.sql',
          status: 'success',
          message: 'Added missing columns to questions table'
        });
      } else {
        results.push({
          migration: 'add_missing_questions_columns.sql',
          status: 'skipped',
          message: 'Migration file not found'
        });
      }
    } catch (error) {
      results.push({
        migration: 'add_missing_questions_columns.sql',
        status: 'error',
        message: error.message
      });
    }
    
    // Migration 3: Add FAQ group stats function
    try {
      const migrationPath = path.join(__dirname, '../../database/migrations/add_faq_group_stats_function.sql');
      
      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        await db.query(migrationSQL);
        
        results.push({
          migration: 'add_faq_group_stats_function.sql',
          status: 'success',
          message: 'Added FAQ group stats function'
        });
      } else {
        // Fallback: create the function inline
        const inlineSQL = `
          DROP FUNCTION IF EXISTS public.update_faq_group_stats(uuid);
          CREATE OR REPLACE FUNCTION public.update_faq_group_stats(group_uuid uuid)
          RETURNS void
          LANGUAGE plpgsql
          AS $$
          BEGIN
            UPDATE public.faq_groups
            SET
              question_count = (
                SELECT COUNT(*) FROM public.question_groups WHERE group_id = group_uuid
              ),
              avg_confidence = (
                SELECT AVG(q.confidence_score)
                FROM public.questions q
                JOIN public.question_groups qg ON q.id = qg.question_id
                WHERE qg.group_id = group_uuid
              ),
              frequency_score = (
                SELECT COUNT(*) * COALESCE(AVG(q.confidence_score), 0)
                FROM public.questions q
                JOIN public.question_groups qg ON q.id = qg.question_id
                WHERE qg.group_id = group_uuid
              ),
              updated_at = NOW()
            WHERE id = group_uuid;
          END;
          $$;
        `;
        await db.query(inlineSQL);
        results.push({
          migration: 'add_faq_group_stats_function.sql',
          status: 'fallback',
          message: 'Created update_faq_group_stats function via inline SQL'
        });
      }
    } catch (error) {
      results.push({
        migration: 'add_faq_group_stats_function.sql',
        status: 'error',
        message: error.message
      });
    }
    
    // Verify columns exist
    const columnCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'emails' 
      AND column_name IN ('processed_for_faq', 'processed_at', 'processing_error')
      ORDER BY column_name;
    `);
    
    // Get email stats
    let stats = null;
    try {
      const statsQuery = await db.query(`
        SELECT 
          COUNT(*) as total_emails,
          COUNT(*) FILTER (WHERE processed_for_faq = true) as processed,
          COUNT(*) FILTER (WHERE processed_for_faq = false) as unprocessed
        FROM emails;
      `);
      stats = statsQuery.rows[0];
    } catch (error) {
      // Column might not exist yet
      stats = { error: 'Could not get stats - columns may not exist yet' };
    }
    
    res.json({
      success: true,
      message: 'Migration process completed',
      results,
      verification: {
        columnsFound: columnCheck.rows.map(r => r.column_name),
        expectedColumns: ['processed_for_faq', 'processed_at', 'processing_error'],
        allColumnsExist: columnCheck.rows.length === 3
      },
      emailStats: stats
    });
    
  } catch (error) {
    logger.error('Migration API error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

/**
 * Check migration status
 */
router.get('/status', async (req, res) => {
  try {
    // Check if required columns exist
    const columnCheck = await db.query(`
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'emails' 
      AND column_name IN ('processed_for_faq', 'processed_at', 'processing_error')
      ORDER BY column_name;
    `);
    
    // Check if functions exist
    const functionCheck = await db.query(`
      SELECT 
        routine_name,
        routine_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      AND routine_name IN ('update_faq_group_stats', 'get_faq_group_stats');
    `);
    
    const requiredColumns = ['processed_for_faq', 'processed_at', 'processing_error'];
    const foundColumns = columnCheck.rows.map(r => r.column_name);
    const missingColumns = requiredColumns.filter(col => !foundColumns.includes(col));
    
    res.json({
      success: true,
      database: {
        columns: {
          required: requiredColumns,
          found: foundColumns,
          missing: missingColumns,
          details: columnCheck.rows
        },
        functions: {
          found: functionCheck.rows.map(r => r.routine_name),
          details: functionCheck.rows
        }
      },
      migrationNeeded: missingColumns.length > 0,
      message: missingColumns.length > 0 
        ? `Missing columns: ${missingColumns.join(', ')}. Run migration to fix.`
        : 'All required columns exist'
    });
    
  } catch (error) {
    logger.error('Migration status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;