# OAuth Diagnostic Guide

## Current Issue
The OAuth popup is showing the main web app instead of processing the callback and closing.

## Diagnostic Steps

### 1. Test if Backend Receives OAuth Callbacks

Visit this URL in your browser (replace with your actual domain):
```
https://faq-generator-web.onrender.com/api/test/oauth/test-callback?code=test123&state=test
```

This should show a page confirming the backend received the request, NOT the React app.

### 2. Check Browser Network Tab

1. Open Developer Tools (F12)
2. Go to Network tab
3. Clear the network log
4. Click "Connect Gmail"
5. Complete the OAuth flow
6. Look for these requests:
   - Initial request to `/api/auth/gmail/url`
   - OAuth provider redirect to `/api/auth/gmail/callback?code=...`
   - Any subsequent redirects

### 3. Check Render Logs

In your Render dashboard:
1. Go to your service
2. Click on "Logs" tab
3. Look for entries containing:
   - "API Request: GET /api/auth/gmail/callback"
   - "OAuth callback reached middleware"
   - "Gmail OAuth callback received"

### 4. Test OAuth Flow with Manual Redirect

1. Get the OAuth URL by visiting:
   ```
   https://faq-generator-web.onrender.com/api/auth/gmail/url
   ```

2. Copy the `authUrl` from the response

3. Open it in a new tab (not a popup)

4. Complete authentication

5. Check where you get redirected

## Possible Issues and Solutions

### Issue 1: Callback Not Reaching Backend
If the test callback URL shows the React app:
- The routing is broken in production
- Check if Render is serving static files before API routes

### Issue 2: Backend Receives Callback but Redirects Incorrectly
If you see logs for the callback but still get the main page:
- The redirect after processing might be incorrect
- Check the `corsOrigin` value in the redirect

### Issue 3: Popup Detection Failing
The popup might not be detected correctly:
- Check if `window.opener` is available in the popup
- The popup might be opening with different parameters

## Quick Test URLs

1. **OAuth Config Check:**
   ```
   https://faq-generator-web.onrender.com/api/auth/debug/oauth-config
   ```

2. **Test Backend Routing:**
   ```
   https://faq-generator-web.onrender.com/api/test/oauth/test-callback
   ```

3. **API Health Check:**
   ```
   https://faq-generator-web.onrender.com/api/health
   ```

## Emergency Fix

If the OAuth flow is completely broken, you can temporarily change the redirect URI in Google Console to:
```
https://faq-generator-web.onrender.com/api/test/oauth/test-callback
```

This will help confirm if the backend routing is working at all.