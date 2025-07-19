# FAQ Generator Cleanup Scripts

This directory contains various cleanup scripts for maintaining the FAQ Generator database and removing unwanted data.

## Available Scripts

### 1. `cleanup-accounts-only.js`
**Purpose**: Deletes only email accounts, leaving other data intact.

```bash
node scripts/cleanup-accounts-only.js
```

**What it does**:
- Lists all email accounts
- Deletes all records from `email_accounts` table
- Verifies cleanup completion

**Use case**: When you want to remove authentication data but keep processed emails, questions, and FAQs.

---

### 2. `cleanup-all-accounts.js`
**Purpose**: Comprehensive cleanup of all account-related data.

```bash
node scripts/cleanup-all-accounts.js
```

**What it does**:
- Deletes question-group relationships
- Deletes extracted questions
- Deletes FAQ groups
- Deletes processing jobs
- Deletes audit logs
- Deletes system metrics
- Deletes sync logs
- Deletes emails
- Deletes email accounts

**Use case**: Complete reset when you want to start fresh with new email accounts.

---

### 3. `cleanup-complete.js` ⭐ **Recommended**
**Purpose**: Most comprehensive and safe cleanup script with detailed logging and verification.

```bash
node scripts/cleanup-complete.js
```

**Features**:
- Production safety checks (requires `FORCE_CLEANUP=true` in production)
- Detailed logging of current database state
- Proper deletion order respecting foreign key constraints
- Comprehensive verification of cleanup
- Graceful error handling
- Summary of all deleted records

**What it does**:
- Shows current database state before cleanup
- Deletes all data in correct order:
  1. Question-group relationships
  2. Questions
  3. FAQ groups
  4. Emails
  5. Processing jobs
  6. Audit logs
  7. System metrics
  8. Email accounts
- Updates database statistics
- Verifies all tables are clean

**Use case**: Production-ready complete database reset with safety checks.

---

### 4. `cleanup-selective.js` 🎯 **Flexible**
**Purpose**: Targeted cleanup for specific accounts, old data, or maintenance tasks.

```bash
# Show help
node scripts/cleanup-selective.js --help

# Clean up specific account
node scripts/cleanup-selective.js --account user@example.com

# Clean up data older than 30 days
node scripts/cleanup-selective.js --older-than 30

# Clean up failed jobs
node scripts/cleanup-selective.js --failed-jobs

# Clean up orphaned data
node scripts/cleanup-selective.js --orphaned-data

# Clean up old metrics (older than 90 days)
node scripts/cleanup-selective.js --old-metrics 90

# Clean up processed emails (older than 14 days)
node scripts/cleanup-selective.js --processed-emails 14

# Combine multiple options
node scripts/cleanup-selective.js --failed-jobs --orphaned-data --old-metrics 30
```

**Options**:
- `--account <email>`: Clean up specific email account and all its data
- `--older-than <days>`: Clean up data older than specified days
- `--failed-jobs`: Clean up failed processing jobs
- `--orphaned-data`: Clean up orphaned data (questions without emails, etc.)
- `--old-metrics <days>`: Clean up system metrics older than specified days
- `--processed-emails <days>`: Clean up processed emails older than specified days

**Use case**: Maintenance tasks, cleaning specific accounts, or removing old data without full reset.

---

### 5. `cron-cleanup.js`
**Purpose**: Automated maintenance script designed for Render.com cron jobs.

```bash
node scripts/cron-cleanup.js
```

**Features**:
- Configurable retention periods via environment variables
- Timeout protection (10 minutes default)
- Metrics storage and alerting
- Weekend database vacuum
- Comprehensive error handling

**Environment Variables**:
- `CLEANUP_RETENTION_DAYS`: Days to keep processing jobs (default: 30)
- `METRICS_RETENTION_DAYS`: Days to keep system metrics (default: 90)
- `CRON_TIMEOUT_MS`: Timeout in milliseconds (default: 600000)
- `ENABLE_VACUUM`: Enable weekend database vacuum (default: false)
- `ALERT_WEBHOOK_URL`: Webhook URL for failure alerts

**Use case**: Automated daily/weekly maintenance on production systems.

---

## Database Schema Overview

The cleanup scripts work with these main tables in dependency order:

```
email_accounts (root)
├── emails
│   └── questions
│       └── question_groups ──┐
├── processing_jobs           │
├── audit_logs               │
└── system_metrics           │
                             │
faq_groups ←─────────────────┘
```

## Safety Considerations

### Production Safety
- `cleanup-complete.js` includes production safety checks
- Set `FORCE_CLEANUP=true` environment variable to run in production
- Always backup your database before running cleanup scripts

### Foreign Key Constraints
All scripts respect PostgreSQL foreign key constraints by deleting in the correct order:
1. Junction tables (`question_groups`)
2. Dependent tables (`questions`, `emails`, `processing_jobs`)
3. Parent tables (`email_accounts`, `faq_groups`)

### Verification
Most scripts include verification steps to ensure cleanup was successful.

## Troubleshooting

### Common Issues

1. **Table doesn't exist errors**: Scripts handle missing tables gracefully
2. **Foreign key constraint violations**: Scripts delete in correct order
3. **Permission errors**: Ensure database user has DELETE permissions
4. **Connection timeouts**: Scripts include proper connection cleanup

### Logs
All scripts use the application logger (`src/utils/logger.js`) for consistent logging.

### Recovery
If you need to recover data:
1. Restore from database backup
2. Re-run email sync to fetch emails again
3. Re-run FAQ generation to recreate questions and groups

## Best Practices

1. **Always backup** before running cleanup scripts
2. **Test in development** before running in production
3. **Use selective cleanup** for maintenance rather than complete cleanup
4. **Monitor logs** for any errors or warnings
5. **Set up alerts** for cron job failures

## Examples

### Complete Fresh Start
```bash
# Backup first
pg_dump your_database > backup.sql

# Complete cleanup
node scripts/cleanup-complete.js

# Re-authenticate and sync
# Visit your app to re-add email accounts
```

### Regular Maintenance
```bash
# Weekly maintenance
node scripts/cleanup-selective.js --failed-jobs --orphaned-data --old-metrics 90

# Monthly cleanup of old processed emails
node scripts/cleanup-selective.js --processed-emails 30
```

### Remove Specific Account
```bash
# Remove problematic account
node scripts/cleanup-selective.js --account problematic@example.com