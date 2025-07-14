# OAuth Authentication Fix Guide

## Problem Summary

Your Gmail OAuth authentication is failing because the OAuth callback is being intercepted by the React frontend instead of being processed by the Express backend. This happens when the redirect URI doesn't include the `/api` prefix.

### What's Happening:
1. User clicks "Connect Gmail"
2. OAuth popup opens and user authenticates
3. Google redirects to your callback URL
4. **Issue**: If the callback URL lacks `/api` prefix, it goes to React app instead of Express
5. React app loads in the popup showing the main page
6. OAuth flow never completes

## Solution Steps

### Step 1: Verify Current Configuration

Run this command locally to check your current OAuth configuration:

```bash
cd faq-generator
node scripts/verify-oauth-config.js
```

### Step 2: Update Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** > **Credentials**
4. Click on your OAuth 2.0 Client ID
5. In the **Authorized redirect URIs** section:
   - **Remove** any URIs that don't have `/api` in them
   - **Add** this URI: `https://faq-generator-web.onrender.com/api/auth/gmail/callback`
   - Make sure there are no trailing slashes
6. Click **Save**

### Step 3: Update Render.com Environment Variables

1. Log in to [Render.com](https://render.com)
2. Go to your FAQ Generator service
3. Navigate to **Environment** tab
4. Update or add these variables:

```bash
BASE_URL=https://faq-generator-web.onrender.com
GMAIL_REDIRECT_URI=https://faq-generator-web.onrender.com/api/auth/gmail/callback
```

**Important**: 
- Replace `faq-generator-web` with your actual Render service name
- Do NOT include trailing slashes
- The `/api` prefix is REQUIRED

### Step 4: Verify the Fix

1. After updating environment variables, Render will automatically redeploy
2. Once deployed, visit: `https://faq-generator-web.onrender.com/api/auth/debug/oauth-config`
3. Verify that the Gmail redirect URI includes `/api/auth/gmail/callback`

### Step 5: Test OAuth Flow

1. Clear your browser cache and cookies
2. Visit your app: `https://faq-generator-web.onrender.com`
3. Click "Connect Gmail"
4. Complete the OAuth flow
5. The popup should close automatically and your account should be connected

## Debugging Tips

### Check Network Requests
1. Open Developer Tools (F12)
2. Go to Network tab
3. Try connecting Gmail
4. Look for the callback request - it should go to `/api/auth/gmail/callback`

### Check Server Logs
In Render.com dashboard:
1. Go to your service
2. Click on **Logs** tab
3. Look for entries like:
   - `OAuth callback request: GET /api/auth/gmail/callback`
   - `Gmail account connected: your-email@gmail.com`

### Common Issues

1. **Popup shows homepage instead of closing**
   - The redirect URI is missing `/api` prefix
   - Check both Google Console and environment variables

2. **"redirect_uri_mismatch" error**
   - The URI in Google Console doesn't exactly match what your app sends
   - Check for:
     - Missing `/api` prefix
     - HTTP vs HTTPS mismatch
     - Trailing slashes
     - Different domain names

3. **No logs appear for OAuth callback**
   - The callback is going to React instead of Express
   - Confirms the `/api` prefix is missing

## Quick Checklist

- [ ] BASE_URL environment variable is set correctly
- [ ] GMAIL_REDIRECT_URI includes `/api/auth/gmail/callback`
- [ ] Google Cloud Console redirect URI matches exactly
- [ ] No trailing slashes in any URIs
- [ ] Using HTTPS in production URIs

## Need More Help?

If you're still having issues:

1. Run the verification script and share the output
2. Check the browser's Network tab for the exact callback URL
3. Look for any error messages in Render logs
4. Verify your Google Cloud Console project is active and not in trial

Remember: The key is ensuring all redirect URIs include the `/api` prefix so Express handles the callback, not React.