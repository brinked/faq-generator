# Missing Environment Variables on Render

Based on your current configuration, you need to add these environment variables:

## Critical for OAuth:
- **BASE_URL**: `https://faq-generator-web.onrender.com` (your production URL)

## Required for Token Storage:
- **ENCRYPTION_KEY**: Generate a 32-character random string (e.g., `abcdef0123456789abcdef0123456789`)

## Required for AI Features:
- **OPENAI_API_KEY**: Your OpenAI API key

## Optional but Recommended:
- **NODE_ENV**: `production`
- **OUTLOOK_CLIENT_ID**: Your Outlook/Azure app client ID
- **OUTLOOK_CLIENT_SECRET**: Your Outlook/Azure app client secret
- **OUTLOOK_TENANT_ID**: `common` (or your specific tenant ID)

## How to Add:
1. Go to your Render dashboard
2. Navigate to your service
3. Go to Environment tab
4. Add each variable with its value
5. Save changes (this will trigger a redeploy)

## Generate Encryption Key:
You can generate a secure 32-character key using:
```
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"