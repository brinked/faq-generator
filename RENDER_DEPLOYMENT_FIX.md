# Render.com Deployment Fix - OAuth Redirect URI Issue

## Problem
The application was trying to connect to Gmail and Outlook using `localhost` URLs instead of the correct production URL when hosted on render.com.

## Root Cause
The `BASE_URL` environment variable was not set in production, causing the OAuth services to fall back to `http://localhost:3000` for redirect URIs.

## Solution Applied

### 1. Updated Gmail Service (`src/services/gmailService.js`)
- Removed localhost fallback
- Now requires `BASE_URL` environment variable to be set
- Throws clear error if `BASE_URL` is missing

### 2. Updated Outlook Service (`src/services/outlookService.js`)
- Removed localhost fallback
- Now requires `BASE_URL` environment variable to be set
- Throws clear error if `BASE_URL` is missing

### 3. Updated Auth Routes (`src/routes/auth.js`)
- Removed localhost fallback for OAuth redirects
- Now requires `BASE_URL` environment variable to be set

### 4. Updated Server Configuration (`server.js`)
- Added warning log when `BASE_URL` is not set in production

## Required Environment Variables for Render.com

Set the following environment variable in your Render.com dashboard:

```
BASE_URL=https://your-app-name.onrender.com
```

Replace `your-app-name` with your actual Render.com app name.

## OAuth Provider Configuration

### Gmail (Google Cloud Console)
1. Go to Google Cloud Console > APIs & Services > Credentials
2. Edit your OAuth 2.0 Client ID
3. Add the following to "Authorized redirect URIs":
   ```
   https://your-app-name.onrender.com/api/auth/gmail/callback
   ```

### Outlook (Azure App Registration)
1. Go to Azure Portal > App registrations
2. Select your app registration
3. Go to Authentication > Platform configurations
4. Add the following redirect URI:
   ```
   https://your-app-name.onrender.com/api/auth/outlook/callback
   ```

## Testing the Fix

After setting the `BASE_URL` environment variable and updating OAuth provider settings:

1. Restart your Render.com service
2. Try connecting a Gmail or Outlook account
3. Verify that the OAuth flow redirects to your production URL instead of localhost

## Additional Notes

- The application will now fail fast with clear error messages if `BASE_URL` is not set
- This prevents silent failures where OAuth would appear to work but redirect to localhost
- For local development, continue using `BASE_URL=http://localhost:3000`