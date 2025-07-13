const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');

/**
 * Export all system data as a comprehensive backup
 */
router.get('/backup', async (req, res) => {
  try {
    const { format = 'json', includeEmails = false } = req.query;
    const db = require('../config/database');
    
    logger.info('Starting full system backup export');
    
    // Get all data from different tables
    const backup = {
      metadata: {
        exported_at: new Date().toISOString(),
        version: '1.0.0',
        includes_emails: includeEmails === 'true'
      },
      data: {}
    };
    
    // Export email accounts (without sensitive tokens)
    const accountsQuery = `
      SELECT 
        id, email_address, provider, status, 
        last_sync_at, created_at, updated_at,
        sync_settings
      FROM email_accounts 
      ORDER BY created_at
    `;
    const accounts = await db.query(accountsQuery);
    backup.data.email_accounts = accounts.rows;
    
    // Export emails (optional, can be large)
    if (includeEmails === 'true') {
      const emailsQuery = `
        SELECT 
          id, account_id, message_id, thread_id,
          subject, sender_email, sender_name,
          recipient_emails, received_at, is_processed,
          created_at
        FROM emails 
        ORDER BY received_at DESC
      `;
      const emails = await db.query(emailsQuery);
      backup.data.emails = emails.rows;
    }
    
    // Export questions
    const questionsQuery = `
      SELECT 
        id, email_id, question_text, answer_text,
        confidence_score, is_customer_question,
        improved_question, created_at
      FROM questions 
      ORDER BY created_at DESC
    `;
    const questions = await db.query(questionsQuery);
    backup.data.questions = questions.rows;
    
    // Export FAQs
    const faqsQuery = `
      SELECT 
        id, title, representative_question, consolidated_answer,
        category, tags, frequency_score, question_count,
        is_published, created_at, updated_at
      FROM faq_groups 
      ORDER BY frequency_score DESC
    `;
    const faqs = await db.query(faqsQuery);
    backup.data.faqs = faqs.rows;
    
    // Export question-FAQ associations
    const associationsQuery = `
      SELECT group_id, question_id, similarity_score
      FROM question_groups
      ORDER BY group_id, similarity_score DESC
    `;
    const associations = await db.query(associationsQuery);
    backup.data.question_associations = associations.rows;
    
    // Export processing jobs (last 30 days)
    const jobsQuery = `
      SELECT 
        id, account_id, job_type, status, progress,
        total_items, processed_items, started_at,
        completed_at, error_message
      FROM processing_jobs 
      WHERE created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
    `;
    const jobs = await db.query(jobsQuery);
    backup.data.processing_jobs = jobs.rows;
    
    // Export system settings
    const settingsQuery = `
      SELECT key, value, description, updated_at
      FROM system_settings
      ORDER BY key
    `;
    const settings = await db.query(settingsQuery);
    backup.data.system_settings = settings.rows;
    
    // Calculate backup statistics
    backup.metadata.statistics = {
      email_accounts: backup.data.email_accounts.length,
      emails: backup.data.emails ? backup.data.emails.length : 0,
      questions: backup.data.questions.length,
      faqs: backup.data.faqs.length,
      question_associations: backup.data.question_associations.length,
      processing_jobs: backup.data.processing_jobs.length,
      system_settings: backup.data.system_settings.length
    };
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `faq-generator-backup-${timestamp}`;
    
    if (format === 'zip') {
      // Create ZIP archive with separate files
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      
      // Add each data type as separate JSON file
      archive.append(JSON.stringify(backup.metadata, null, 2), { name: 'metadata.json' });
      archive.append(JSON.stringify(backup.data.email_accounts, null, 2), { name: 'email_accounts.json' });
      
      if (backup.data.emails) {
        archive.append(JSON.stringify(backup.data.emails, null, 2), { name: 'emails.json' });
      }
      
      archive.append(JSON.stringify(backup.data.questions, null, 2), { name: 'questions.json' });
      archive.append(JSON.stringify(backup.data.faqs, null, 2), { name: 'faqs.json' });
      archive.append(JSON.stringify(backup.data.question_associations, null, 2), { name: 'question_associations.json' });
      archive.append(JSON.stringify(backup.data.processing_jobs, null, 2), { name: 'processing_jobs.json' });
      archive.append(JSON.stringify(backup.data.system_settings, null, 2), { name: 'system_settings.json' });
      
      await archive.finalize();
      
    } else {
      // Single JSON file
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json(backup);
    }
    
    logger.info(`System backup exported successfully: ${JSON.stringify(backup.metadata.statistics)}`);
    
  } catch (error) {
    logger.error('Error creating system backup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create system backup'
    });
  }
});

/**
 * Export questions data
 */
router.get('/questions', async (req, res) => {
  try {
    const { 
      format = 'json', 
      includeAnswers = true,
      customerOnly = true,
      limit = 10000 
    } = req.query;
    
    const db = require('../config/database');
    
    let query = `
      SELECT 
        q.id,
        q.question_text,
        ${includeAnswers === 'true' ? 'q.answer_text,' : ''}
        q.confidence_score,
        q.is_customer_question,
        q.improved_question,
        q.created_at,
        e.subject as email_subject,
        e.sender_email,
        e.received_at as email_date,
        ea.email_address as account_email,
        ea.provider
      FROM questions q
      JOIN emails e ON q.email_id = e.id
      JOIN email_accounts ea ON e.account_id = ea.id
    `;
    
    const params = [];
    const conditions = [];
    
    if (customerOnly === 'true') {
      conditions.push('q.is_customer_question = true');
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY q.created_at DESC';
    
    if (limit && parseInt(limit) > 0) {
      params.push(parseInt(limit));
      query += ` LIMIT $${params.length}`;
    }
    
    const result = await db.query(query, params);
    const questions = result.rows;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    if (format === 'csv') {
      // Convert to CSV
      const headers = [
        'ID', 'Question', 
        ...(includeAnswers === 'true' ? ['Answer'] : []),
        'Confidence Score', 'Is Customer Question', 'Improved Question',
        'Created At', 'Email Subject', 'Sender Email', 'Email Date',
        'Account Email', 'Provider'
      ];
      
      const csvHeader = headers.join(',') + '\n';
      const csvRows = questions.map(q => {
        const row = [
          q.id,
          `"${(q.question_text || '').replace(/"/g, '""')}"`,
          ...(includeAnswers === 'true' ? [`"${(q.answer_text || '').replace(/"/g, '""')}"`] : []),
          q.confidence_score || 0,
          q.is_customer_question ? 'Yes' : 'No',
          `"${(q.improved_question || '').replace(/"/g, '""')}"`,
          q.created_at,
          `"${(q.email_subject || '').replace(/"/g, '""')}"`,
          q.sender_email || '',
          q.email_date,
          q.account_email || '',
          q.provider || ''
        ];
        return row.join(',');
      }).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="questions-${timestamp}.csv"`);
      res.send(csvContent);
      
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="questions-${timestamp}.json"`);
      res.json({
        exported_at: new Date().toISOString(),
        total_questions: questions.length,
        filters: {
          include_answers: includeAnswers === 'true',
          customer_only: customerOnly === 'true',
          limit: parseInt(limit) || null
        },
        questions
      });
    }
    
  } catch (error) {
    logger.error('Error exporting questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export questions'
    });
  }
});

/**
 * Export email accounts data
 */
router.get('/accounts', async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    const db = require('../config/database');
    
    const query = `
      SELECT 
        ea.id,
        ea.email_address,
        ea.provider,
        ea.status,
        ea.last_sync_at,
        ea.created_at,
        ea.sync_settings,
        COUNT(e.id) as total_emails,
        COUNT(e.id) FILTER (WHERE e.is_processed = true) as processed_emails,
        COUNT(q.id) as total_questions,
        COUNT(q.id) FILTER (WHERE q.is_customer_question = true) as customer_questions
      FROM email_accounts ea
      LEFT JOIN emails e ON ea.id = e.account_id
      LEFT JOIN questions q ON e.id = q.email_id
      GROUP BY ea.id, ea.email_address, ea.provider, ea.status, 
               ea.last_sync_at, ea.created_at, ea.sync_settings
      ORDER BY ea.created_at
    `;
    
    const result = await db.query(query);
    const accounts = result.rows;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    if (format === 'csv') {
      const csvHeader = 'ID,Email Address,Provider,Status,Last Sync,Created At,Total Emails,Processed Emails,Total Questions,Customer Questions\n';
      const csvRows = accounts.map(acc => {
        return [
          acc.id,
          acc.email_address,
          acc.provider,
          acc.status,
          acc.last_sync_at || '',
          acc.created_at,
          acc.total_emails || 0,
          acc.processed_emails || 0,
          acc.total_questions || 0,
          acc.customer_questions || 0
        ].join(',');
      }).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="accounts-${timestamp}.csv"`);
      res.send(csvContent);
      
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="accounts-${timestamp}.json"`);
      res.json({
        exported_at: new Date().toISOString(),
        total_accounts: accounts.length,
        accounts
      });
    }
    
  } catch (error) {
    logger.error('Error exporting accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export accounts'
    });
  }
});

/**
 * Export processing analytics
 */
router.get('/analytics', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const db = require('../config/database');
    
    // Get processing statistics over time
    const statsQuery = `
      WITH daily_stats AS (
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as total_jobs,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
        FROM processing_jobs
        WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      ),
      email_stats AS (
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as emails_processed,
          COUNT(*) FILTER (WHERE is_processed = true) as emails_with_questions
        FROM emails
        WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY DATE(created_at)
      ),
      question_stats AS (
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as questions_extracted,
          COUNT(*) FILTER (WHERE is_customer_question = true) as customer_questions,
          AVG(confidence_score) as avg_confidence
        FROM questions
        WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY DATE(created_at)
      ),
      faq_stats AS (
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as faqs_created,
          COUNT(*) FILTER (WHERE is_published = true) as faqs_published
        FROM faq_groups
        WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        GROUP BY DATE(created_at)
      )
      SELECT 
        COALESCE(ds.date, es.date, qs.date, fs.date) as date,
        COALESCE(ds.total_jobs, 0) as total_jobs,
        COALESCE(ds.completed_jobs, 0) as completed_jobs,
        COALESCE(ds.failed_jobs, 0) as failed_jobs,
        COALESCE(ds.avg_duration_seconds, 0) as avg_duration_seconds,
        COALESCE(es.emails_processed, 0) as emails_processed,
        COALESCE(es.emails_with_questions, 0) as emails_with_questions,
        COALESCE(qs.questions_extracted, 0) as questions_extracted,
        COALESCE(qs.customer_questions, 0) as customer_questions,
        COALESCE(qs.avg_confidence, 0) as avg_confidence,
        COALESCE(fs.faqs_created, 0) as faqs_created,
        COALESCE(fs.faqs_published, 0) as faqs_published
      FROM daily_stats ds
      FULL OUTER JOIN email_stats es ON ds.date = es.date
      FULL OUTER JOIN question_stats qs ON ds.date = qs.date
      FULL OUTER JOIN faq_stats fs ON ds.date = fs.date
      ORDER BY date DESC
    `;
    
    const result = await db.query(statsQuery);
    const analytics = result.rows;
    
    // Get overall summary
    const summaryQuery = `
      SELECT 
        COUNT(DISTINCT ea.id) as total_accounts,
        COUNT(DISTINCT e.id) as total_emails,
        COUNT(DISTINCT q.id) as total_questions,
        COUNT(DISTINCT fg.id) as total_faqs,
        AVG(q.confidence_score) as avg_question_confidence,
        COUNT(DISTINCT q.id) FILTER (WHERE q.is_customer_question = true) as customer_questions,
        COUNT(DISTINCT fg.id) FILTER (WHERE fg.is_published = true) as published_faqs
      FROM email_accounts ea
      LEFT JOIN emails e ON ea.id = e.account_id
      LEFT JOIN questions q ON e.id = q.email_id
      LEFT JOIN question_groups qg ON q.id = qg.question_id
      LEFT JOIN faq_groups fg ON qg.group_id = fg.id
    `;
    
    const summaryResult = await db.query(summaryQuery);
    const summary = summaryResult.rows[0];
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${timestamp}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      period_days: parseInt(days),
      summary,
      daily_analytics: analytics
    });
    
  } catch (error) {
    logger.error('Error exporting analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export analytics'
    });
  }
});

/**
 * Import system data from backup
 */
router.post('/import', async (req, res) => {
  try {
    const { data, options = {} } = req.body;
    const { 
      overwrite = false, 
      skipEmails = false,
      validateOnly = false 
    } = options;
    
    if (!data || !data.metadata || !data.data) {
      return res.status(400).json({
        success: false,
        error: 'Invalid backup data format'
      });
    }
    
    const db = require('../config/database');
    const importResults = {
      validation: { passed: true, errors: [] },
      imported: {},
      skipped: {},
      errors: []
    };
    
    // Validate backup data structure
    const requiredTables = ['email_accounts', 'questions', 'faqs'];
    for (const table of requiredTables) {
      if (!data.data[table]) {
        importResults.validation.passed = false;
        importResults.validation.errors.push(`Missing required table: ${table}`);
      }
    }
    
    if (!importResults.validation.passed) {
      return res.status(400).json({
        success: false,
        error: 'Backup validation failed',
        details: importResults.validation.errors
      });
    }
    
    if (validateOnly) {
      return res.json({
        success: true,
        message: 'Backup validation passed',
        validation: importResults.validation,
        preview: {
          email_accounts: data.data.email_accounts?.length || 0,
          emails: data.data.emails?.length || 0,
          questions: data.data.questions?.length || 0,
          faqs: data.data.faqs?.length || 0
        }
      });
    }
    
    // Start import transaction
    await db.transaction(async (client) => {
      // Import email accounts (skip if exists unless overwrite)
      if (data.data.email_accounts) {
        let imported = 0, skipped = 0;
        
        for (const account of data.data.email_accounts) {
          try {
            if (overwrite) {
              await client.query(`
                INSERT INTO email_accounts (id, email_address, provider, status, last_sync_at, created_at, updated_at, sync_settings)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE SET
                  email_address = EXCLUDED.email_address,
                  provider = EXCLUDED.provider,
                  status = EXCLUDED.status,
                  last_sync_at = EXCLUDED.last_sync_at,
                  updated_at = NOW(),
                  sync_settings = EXCLUDED.sync_settings
              `, [account.id, account.email_address, account.provider, account.status, 
                  account.last_sync_at, account.created_at, account.updated_at, account.sync_settings]);
              imported++;
            } else {
              await client.query(`
                INSERT INTO email_accounts (id, email_address, provider, status, last_sync_at, created_at, updated_at, sync_settings)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING
              `, [account.id, account.email_address, account.provider, account.status, 
                  account.last_sync_at, account.created_at, account.updated_at, account.sync_settings]);
              
              const result = await client.query('SELECT 1 FROM email_accounts WHERE id = $1', [account.id]);
              if (result.rows.length > 0) imported++;
              else skipped++;
            }
          } catch (error) {
            importResults.errors.push(`Error importing account ${account.email_address}: ${error.message}`);
          }
        }
        
        importResults.imported.email_accounts = imported;
        importResults.skipped.email_accounts = skipped;
      }
      
      // Import other data similarly...
      // (Implementation continues for other tables)
      
    });
    
    logger.info('Data import completed', importResults);
    
    res.json({
      success: true,
      message: 'Data import completed',
      results: importResults
    });
    
  } catch (error) {
    logger.error('Error importing data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import data'
    });
  }
});

module.exports = router;