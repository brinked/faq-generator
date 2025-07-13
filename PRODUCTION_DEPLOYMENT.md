# Production Deployment Guide

This guide covers the environment variables and configuration needed to deploy the FAQ Generator to production environments like Render, Heroku, or other cloud platforms.

## Required Environment Variables

### Core Configuration

```bash
# Base URL of your deployed application (REQUIRED for OAuth)
BASE_URL=https://your-app-name.onrender.com

# Database connection
DATABASE_URL=postgresql://username:password@host:port/database_name

# Redis connection (if using Redis)
REDIS_URL=redis://host:port

# Server configuration
PORT=3000
NODE_ENV=production

# Security keys (generate secure random strings)
JWT_SECRET=your-super-secret-jwt-key-here
ENCRYPTION_KEY=your-32-character-encryption-key
SESSION_SECRET=your-session-secret-key
```

### OAuth Configuration

#### Gmail API
```bash
GMAIL_CLIENT_ID=your-gmail-client-id
GMAIL_CLIENT_SECRET=your-gmail-client-secret
# Note: GMAIL_REDIRECT_URI is automatically set to ${BASE_URL}/api/auth/gmail/callback
```

#### Outlook API
```bash
OUTLOOK_CLIENT_ID=your-outlook-client-id
OUTLOOK_CLIENT_SECRET=your-outlook-client-secret
OUTLOOK_TENANT_ID=common
# Note: OUTLOOK_REDIRECT_URI is automatically set to ${BASE_URL}/api/auth/outlook/callback
```

### AI Service
```bash
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=text-embedding-3-small
```

### Optional Configuration
```bash
# CORS origin (defaults to BASE_URL if not set)
CORS_ORIGIN=

# Email processing limits
MAX_EMAILS_PER_SYNC=1000
SIMILARITY_THRESHOLD=0.8
MIN_QUESTION_LENGTH=10
MAX_QUESTION_LENGTH=500

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# Background jobs
REDIS_QUEUE_NAME=email-processing
JOB_CONCURRENCY=5
```

## OAuth Setup Instructions

### 1. Gmail API Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Create OAuth 2.0 credentials
5. Add your production redirect URI: `https://your-app-name.onrender.com/api/auth/gmail/callback`
6. Copy the Client ID and Client Secret to your environment variables

### 2. Outlook API Setup

1. Go to the [Azure Portal](https://portal.azure.com/)
2. Navigate to Azure Active Directory > App registrations
3. Create a new registration
4. Add your production redirect URI: `https://your-app-name.onrender.com/api/auth/outlook/callback`
5. Generate a client secret
6. Copy the Application (client) ID and client secret to your environment variables

## Deployment Steps

### For Render.com

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Set the following:
   - **Build Command**: `npm install && cd client && npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node
4. Add all the environment variables listed above in the Render dashboard
5. Deploy the service
6. **Initialize the database** (one-time setup):
   - Create a new **Job** service in Render (not a Web Service)
   - Set **Build Command**: `npm install`
   - Set **Start Command**: `node scripts/init-production-db.js`
   - Add the same environment variables (especially DATABASE_URL)
   - Run this job once to create all database tables

### For Heroku

1. Install the Heroku CLI
2. Create a new Heroku app: `heroku create your-app-name`
3. Set environment variables: `heroku config:set BASE_URL=https://your-app-name.herokuapp.com`
4. Add all other environment variables using `heroku config:set`
5. Deploy: `git push heroku main`

### For Other Platforms

1. Ensure your platform supports Node.js applications
2. Set all the environment variables listed above
3. Configure the build process to install dependencies and build the client
4. Set the start command to `npm start`

## Important Notes

- **BASE_URL**: This is the most critical environment variable. It must match your production domain exactly
- **OAuth Redirect URIs**: Must be configured in both your OAuth provider (Google/Microsoft) and match the BASE_URL
- **Database**: Ensure your production database is properly configured and accessible
- **Database Initialization**: Run the database initialization job once before starting the main service
- **Security**: Use strong, unique values for all secret keys
- **HTTPS**: OAuth providers require HTTPS for production redirect URIs

## Troubleshooting

### OAuth Errors

If you're getting OAuth errors:

1. Verify BASE_URL matches your production domain exactly
2. Check that redirect URIs are configured correctly in Google/Microsoft consoles
3. Ensure the redirect URIs match the pattern: `${BASE_URL}/api/auth/{provider}/callback`

### Database Connection Issues

1. Verify DATABASE_URL is correct
2. Check that your database server allows connections from your deployment platform
3. Ensure the database exists and has the correct schema
4. **If you see "relation does not exist" errors**: Run the database initialization job

### Database Initialization

If you're getting errors like "relation 'email_accounts' does not exist":

1. Create a new **Job** service in Render
2. Use the same repository and environment variables
3. Set **Start Command**: `node scripts/init-production-db.js`
4. Run the job once to create all database tables
5. After successful completion, your main web service should work

### CORS Issues

1. Verify CORS_ORIGIN is set correctly (or left empty to use BASE_URL)
2. Check that your frontend is being served from the same domain as BASE_URL

### Still Showing Localhost

If OAuth is still redirecting to localhost:

1. Verify BASE_URL environment variable is set correctly in Render
2. Check that the latest code has been deployed (look for the commit with OAuth fixes)
3. Restart the web service after adding BASE_URL

## Environment Variable Template

Copy this template and fill in your values:

```bash
# Core Configuration
BASE_URL=https://your-app-name.onrender.com
DATABASE_URL=postgresql://username:password@host:port/database_name
REDIS_URL=redis://host:port
PORT=3000
NODE_ENV=production
JWT_SECRET=
ENCRYPTION_KEY=
SESSION_SECRET=

# OAuth Configuration
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
OUTLOOK_CLIENT_ID=
OUTLOOK_CLIENT_SECRET=
OUTLOOK_TENANT_ID=common

# AI Service
OPENAI_API_KEY=
OPENAI_MODEL=text-embedding-3-small

# Optional (can use defaults)
CORS_ORIGIN=
MAX_EMAILS_PER_SYNC=1000
SIMILARITY_THRESHOLD=0.8
MIN_QUESTION_LENGTH=10
MAX_QUESTION_LENGTH=500
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
LOG_FILE=logs/app.log
REDIS_QUEUE_NAME=email-processing
JOB_CONCURRENCY=5