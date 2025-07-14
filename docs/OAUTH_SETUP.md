# OAuth Provider Configuration Guide

This guide explains how to configure OAuth providers (Google and Microsoft) for the FAQ Generator application.

## Important: Production Redirect URIs

When deploying to production, the OAuth redirect URIs **MUST** include the `/api` prefix because the Express backend handles these routes, not the React frontend.

## Google OAuth Setup (Gmail)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project or create a new one
3. Navigate to "APIs & Services" > "Credentials"
4. Click on your OAuth 2.0 Client ID or create a new one
5. In the "Authorized redirect URIs" section, add:
   - **Production**: `https://faq-generator-web.onrender.com/api/auth/gmail/callback`
   - **Development**: `http://localhost:3000/api/auth/gmail/callback`

### Required Scopes:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

## Microsoft OAuth Setup (Outlook)

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to "Azure Active Directory" > "App registrations"
3. Select your app or create a new one
4. Go to "Authentication" > "Platform configurations" > "Web"
5. In the "Redirect URIs" section, add:
   - **Production**: `https://faq-generator-web.onrender.com/api/auth/outlook/callback`
   - **Development**: `http://localhost:3000/api/auth/outlook/callback`

### Required API Permissions:
- Microsoft Graph:
  - `User.Read`
  - `Mail.Read`
  - `Mail.ReadBasic`

## Environment Variables

Ensure these environment variables are set in your Render.com dashboard:

```bash
# Base URL (required for production)
BASE_URL=https://faq-generator-web.onrender.com

# Gmail OAuth
GMAIL_CLIENT_ID=your-gmail-client-id
GMAIL_CLIENT_SECRET=your-gmail-client-secret
GMAIL_REDIRECT_URI=https://faq-generator-web.onrender.com/api/auth/gmail/callback

# Outlook OAuth
OUTLOOK_CLIENT_ID=your-outlook-client-id
OUTLOOK_CLIENT_SECRET=your-outlook-client-secret
OUTLOOK_TENANT_ID=common
OUTLOOK_REDIRECT_URI=https://faq-generator-web.onrender.com/api/auth/outlook/callback
```

## Troubleshooting

### OAuth Popup Shows Homepage
If the OAuth popup shows your homepage instead of processing the callback:
1. Verify the redirect URI in your OAuth provider includes `/api` prefix
2. Check that the redirect URI in your provider exactly matches the one in your environment variables
3. Ensure BASE_URL is set correctly in production

### No Server Logs Appearing
If you don't see server logs for OAuth callbacks:
1. The callback is likely being handled by the React app instead of Express
2. Verify your OAuth provider has the correct redirect URI with `/api` prefix
3. Check the Network tab in browser DevTools to see where the callback is actually going

### Testing OAuth Configuration
You can test your OAuth configuration by visiting:
- `https://faq-generator-web.onrender.com/api/auth/debug/oauth-config`

This will show you the current OAuth configuration being used by the server.

## OAuth Flow Diagram

```
1. User clicks "Connect Gmail/Outlook"
2. Frontend calls /api/auth/gmail/url or /api/auth/outlook/url
3. Backend generates OAuth URL with redirect_uri
4. Frontend opens OAuth URL in popup
5. User authorizes in OAuth provider
6. Provider redirects to /api/auth/[provider]/callback with auth code
7. Backend exchanges code for tokens
8. Backend redirects popup to frontend with success parameters
9. Frontend detects success and closes popup
```

## Common Issues

### Issue: "redirect_uri_mismatch" Error
**Solution**: The redirect URI in your OAuth provider must exactly match the one being sent by your application. Check for:
- Missing `/api` prefix
- HTTP vs HTTPS mismatch
- Trailing slashes
- Port numbers (should not include port in production)

### Issue: Callback Goes to React App
**Solution**: This happens when the redirect URI doesn't include `/api`. The Express server only handles routes starting with `/api`, everything else goes to the React app.

### Issue: CORS Errors
**Solution**: Ensure CORS_ORIGIN environment variable matches your frontend URL:
- Production: `https://faq-generator-web.onrender.com`
- Development: `http://localhost:3001` (if React runs on port 3001)