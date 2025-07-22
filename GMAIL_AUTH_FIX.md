# Gmail Authentication Fix - Email Address Null Error

## Issue
When attempting to authenticate with Gmail, the system was throwing:
```
null value in column "email_address" of relation "email_accounts" violates not-null constraint
```

## Root Cause
The Gmail OAuth callback was not properly handling cases where the email address might be missing or in a different field in the Google userinfo response.

## Fix Applied

### 1. Enhanced Error Handling in auth.js
Added validation and logging to ensure email address is present:
```javascript
// Log the profile to debug
logger.info('Gmail profile received:', {
  profile,
  hasEmail: !!profile.email,
  hasName: !!profile.name,
  profileKeys: Object.keys(profile)
});

// Ensure we have an email address
if (!profile.email) {
  logger.error('No email address in Gmail profile:', profile);
  return res.redirect(`${corsOrigin}/?error=no_email&details=${encodeURIComponent('Gmail profile did not include email address')}`);
}
```

### 2. Enhanced Gmail Service getUserProfile()
Added comprehensive logging and fallback logic for email field:
```javascript
logger.info('Gmail userinfo response:', {
  data: response.data,
  status: response.status,
  headers: response.headers
});

// Ensure we have the email field
if (!response.data.email) {
  logger.error('Gmail userinfo missing email:', response.data);
  // Try to get email from 'verified_email' field or other possible fields
  if (response.data.verified_email) {
    response.data.email = response.data.verified_email;
  } else if (response.data.emailAddress) {
    response.data.email = response.data.emailAddress;
  }
}
```

### 3. Added Fallback for Display Name
In case the name is also missing:
```javascript
display_name: profile.name || profile.email, // Fallback to email if no name
```

## Files Modified
1. `src/routes/auth.js` - Added email validation and enhanced logging
2. `src/services/gmailService.js` - Added response logging and email field fallbacks

## Testing Steps
1. Clear browser cookies/cache for the application
2. Try Gmail authentication again
3. Check logs for "Gmail userinfo response" to see what fields are being returned
4. Verify email address is properly saved to database

## Deployment
These changes need to be deployed to Render for the fix to take effect.