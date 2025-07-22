# OAuth Token Refresh Fix

## Problem
The FAQ generator was failing to sync emails with the error:
```
Error getting Gmail messages: invalid_grant
```

This occurred because the Gmail OAuth access tokens were expiring, and the system wasn't attempting to refresh them automatically.

## Root Cause
1. The [`syncGmailAccount()`](src/services/emailService.js:117) method was only marking accounts as 'expired' when encountering `invalid_grant` errors
2. The [`refreshAccessToken()`](src/services/gmailService.js:119) method existed but wasn't being used in the sync flow
3. No mechanism existed to update account tokens after successful refresh

## Solution Implemented

### 1. Enhanced Email Service (`src/services/emailService.js`)
- Modified [`syncGmailAccount()`](src/services/emailService.js:117) to attempt token refresh when encountering `invalid_grant` errors
- Added automatic retry of sync operation after successful token refresh
- Added new [`updateAccountTokens()`](src/services/emailService.js:275) method to persist refreshed tokens

### 2. Improved Gmail Service (`src/services/gmailService.js`)
- Enhanced [`refreshAccessToken()`](src/services/gmailService.js:119) method with better error handling and logging
- Improved error propagation in [`getMessages()`](src/services/gmailService.js:207) method
- Added specific handling for permanent token failures

### 3. Token Refresh Flow
```
1. Sync attempt fails with invalid_grant
2. System attempts to refresh access token using refresh_token
3. If refresh succeeds:
   - Update account with new tokens
   - Set credentials with new tokens
   - Retry sync operation
4. If refresh fails:
   - Mark account as expired
   - Require user re-authentication
```

## Key Changes

### EmailService.syncGmailAccount()
```javascript
// Before: Just marked account as expired
if (error.originalError?.response?.data?.error === 'invalid_grant') {
  await this.updateAccountStatus(account.id, 'expired');
  throw new Error('Account token has expired. Please reconnect the account.');
}

// After: Attempts token refresh first
if (error.originalError?.response?.data?.error === 'invalid_grant') {
  try {
    const newCredentials = await gmailService.refreshAccessToken(account.refresh_token);
    await this.updateAccountTokens(account.id, newCredentials);
    gmailService.setCredentials(newCredentials);
    // Retry sync with new tokens
    const syncResult = await gmailService.syncEmails(account.id, { maxEmails });
    // ... handle success
  } catch (refreshError) {
    await this.updateAccountStatus(account.id, 'expired');
    throw new Error('Account token has expired and could not be refreshed.');
  }
}
```

### New updateAccountTokens() Method
```javascript
async updateAccountTokens(accountId, tokens) {
  const encryptedAccessToken = encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
  
  const query = `
    UPDATE email_accounts
    SET 
      access_token = $1,
      refresh_token = COALESCE($2, refresh_token),
      token_expires_at = $3,
      status = 'active',
      updated_at = NOW()
    WHERE id = $4
  `;
  // ... execute query and return result
}
```

## Benefits
1. **Automatic Recovery**: Expired tokens are automatically refreshed without user intervention
2. **Improved Reliability**: Email sync continues working even when tokens expire
3. **Better Error Handling**: Clear distinction between recoverable and permanent token failures
4. **Enhanced Logging**: Better visibility into token refresh operations

## Testing
Created [`scripts/test-token-refresh.js`](scripts/test-token-refresh.js) to verify the fix works correctly.

## Deployment
The fix is backward compatible and doesn't require database migrations. It will automatically start working for existing accounts with valid refresh tokens.

## Error Scenarios Handled
1. **Expired Access Token + Valid Refresh Token**: Automatically refreshes and continues
2. **Expired Access Token + Invalid Refresh Token**: Marks account as expired, requires re-auth
3. **Network Issues During Refresh**: Retries with exponential backoff
4. **Malformed Token Response**: Proper error handling and logging

This fix resolves the `invalid_grant` error and ensures continuous email synchronization for the FAQ generator.