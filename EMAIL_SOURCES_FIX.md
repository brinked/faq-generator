# FAQ Email Sources Fix - Deployment Guide

## Issues Identified

1. **502 Bad Gateway Errors**: The server is crashing due to a missing method `syncAllAccounts` in the email service
2. **Email Sources Modal Not Working**: The modal loads but shows no data from the database

## Root Causes

1. **Missing Method**: The scheduler service is calling `emailService.syncAllAccounts()` but this method doesn't exist
2. **Potential Data Issues**: Email sources might not be properly linked in the database

## Fixes Applied

### 1. Added Missing `syncAllAccounts` Method

Added the missing method to `src/services/emailService.js`:

```javascript
/**
 * Sync all active accounts
 */
async syncAllAccounts(options = {}) {
  const { maxEmails = 100, skipRecentlyProcessed = false } = options;
  
  try {
    logger.info('Starting sync for all active accounts', { maxEmails, skipRecentlyProcessed });
    
    // Get all active accounts
    const accounts = await this.getAccounts();
    const activeAccounts = accounts.filter(acc => acc.status === 'active');
    
    logger.info(`Found ${activeAccounts.length} active accounts to sync`);
    
    const results = {
      accounts: [],
      totalSynced: 0,
      errors: []
    };
    
    // Sync each account
    for (const account of activeAccounts) {
      try {
        // Skip if recently synced and skipRecentlyProcessed is true
        if (skipRecentlyProcessed && account.last_sync_at) {
          const lastSync = new Date(account.last_sync_at);
          const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
          
          if (hoursSinceSync < 1) {
            logger.info(`Skipping account ${account.id} - synced ${hoursSinceSync.toFixed(2)} hours ago`);
            results.accounts.push({
              accountId: account.id,
              email: account.email_address,
              status: 'skipped',
              reason: 'recently_synced'
            });
            continue;
          }
        }
        
        logger.info(`Syncing account ${account.id} (${account.email_address})`);
        const syncResult = await this.syncAccount(account.id, { maxEmails });
        
        results.accounts.push({
          accountId: account.id,
          email: account.email_address,
          status: 'success',
          synced: syncResult.synced || 0
        });
        
        results.totalSynced += (syncResult.synced || 0);
        
        // Update last sync time
        await db.query(
          'UPDATE email_accounts SET last_sync_at = NOW() WHERE id = $1',
          [account.id]
        );
        
      } catch (error) {
        logger.error(`Error syncing account ${account.id}:`, error);
        results.errors.push({
          accountId: account.id,
          email: account.email_address,
          error: error.message
        });
        results.accounts.push({
          accountId: account.id,
          email: account.email_address,
          status: 'error',
          error: error.message
        });
      }
    }
    
    logger.info('Completed sync for all accounts', {
      totalAccounts: activeAccounts.length,
      totalSynced: results.totalSynced,
      errors: results.errors.length
    });
    
    return results;
    
  } catch (error) {
    logger.error('Error in syncAllAccounts:', error);
    throw error;
  }
}
```

### 2. Enhanced FAQ Sources Route Logging

Updated `src/routes/faq-sources.js` to add better error handling and logging:

- Added check to verify FAQ exists before querying sources
- Added detailed logging for debugging
- Improved error messages

## Deployment Steps

1. **Deploy the Updated Code**:
   ```bash
   git add -A
   git commit -m "Fix: Add missing syncAllAccounts method and enhance FAQ sources logging"
   git push origin main
   ```

2. **Run Diagnostics on Production**:
   ```bash
   # SSH into your Render instance or run via Render Shell
   node scripts/diagnose-email-sources.js
   ```

3. **Monitor Logs**:
   - Check for any `emailService.syncAllAccounts is not a function` errors (should be gone)
   - Look for FAQ sources query logs to see if data is being found

## Verification Steps

1. **Check Email Sync**:
   - The scheduled email sync should now run without errors
   - Check logs for "Starting sync for all active accounts"

2. **Test FAQ Sources Modal**:
   - Click on an FAQ to open the sources modal
   - Check browser console for any errors
   - Check server logs for the FAQ sources query results

## Additional Debugging

If the modal still shows no data after deployment:

1. **Run the diagnostic script** to check:
   - If FAQ groups exist in the database
   - If questions are properly linked to emails
   - If there are orphaned questions without email references

2. **Check the browser network tab**:
   - Look for the API call to `/api/faq-sources/{faqId}/sources`
   - Check the response to see if it contains data or an error

3. **Possible data issues to investigate**:
   - Questions might not have `email_id` set
   - Email records might be missing
   - Question groups might not be properly linked

## Emergency Rollback

If issues persist, you can temporarily disable the scheduler to prevent 502 errors:

In `src/services/schedulerService.js`, comment out the email sync schedule:
```javascript
// scheduleEmailSync() {
//   ...
// }
```

Then focus on fixing the data relationships for the FAQ sources.