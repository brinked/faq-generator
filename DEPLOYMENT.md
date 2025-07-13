# FAQ Generator - Complete Deployment Guide

This guide covers deploying the full-stack FAQ Generator application with both backend API and frontend interface to Render.com.

## Overview

The application consists of:
- **Backend**: Node.js/Express API with PostgreSQL and Redis
- **Frontend**: React SPA served by the backend in production
- **Services**: Background workers for email processing

## Prerequisites

- Render.com account
- Gmail API credentials (Google Cloud Console)
- Outlook API credentials (Azure Portal)
- OpenAI API key

## Deployment Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Service   │    │   PostgreSQL    │    │     Redis       │
│  (Backend API   │◄──►│   Database      │    │    Cache        │
│  + Frontend)    │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ▲
         │
┌─────────────────┐
│ Background      │
│ Worker Service  │
│ (Email Proc.)   │
└─────────────────┘
```

## Step 1: Prepare the Application

### 1.1 Build Frontend
```bash
# From project root
cd client
npm install
npm run build
cd ..
```

### 1.2 Verify Build Structure
```
faq-generator/
├── client/build/          # React production build
├── src/                   # Backend source
├── server.js             # Main server file
└── package.json          # Backend dependencies
```

## Step 2: Deploy to Render.com

### 2.1 Create PostgreSQL Database

1. Go to Render Dashboard → New → PostgreSQL
2. Configure:
   - **Name**: `faq-generator-db`
   - **Database**: `faq_generator`
   - **User**: `faq_user`
   - **Region**: Choose closest to your users
   - **Plan**: Starter ($7/month) or higher

3. Save the connection details:
   - **Internal Database URL**: `postgresql://faq_user:password@hostname:5432/faq_generator`
   - **External Database URL**: For external connections

### 2.2 Create Redis Instance

1. Go to Render Dashboard → New → Redis
2. Configure:
   - **Name**: `faq-generator-redis`
   - **Plan**: Starter ($7/month) or higher
   - **Region**: Same as database

3. Save the Redis URL: `redis://hostname:port`

### 2.3 Deploy Web Service (Backend + Frontend)

1. Go to Render Dashboard → New → Web Service
2. Connect your GitHub repository
3. Configure:

**Basic Settings:**
- **Name**: `faq-generator-web`
- **Environment**: `Node`
- **Region**: Same as database/Redis
- **Branch**: `main`
- **Root Directory**: Leave empty
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`

**Environment Variables:**
```env
NODE_ENV=production
PORT=10000

# Database
DATABASE_URL=<your-postgresql-internal-url>

# Redis
REDIS_URL=<your-redis-url>

# OpenAI
OPENAI_API_KEY=<your-openai-api-key>

# Gmail OAuth
GMAIL_CLIENT_ID=286842204728-e90v2166rv1lsq9b924n6e5kdmus9mb4.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=<your-gmail-client-secret>
GMAIL_REDIRECT_URI=https://your-app-name.onrender.com/api/auth/gmail/callback

# Outlook OAuth
OUTLOOK_CLIENT_ID=928bc572-d6a0-4711-9b15-9c8e88ab5f78
OUTLOOK_CLIENT_SECRET=<your-outlook-client-secret>
OUTLOOK_REDIRECT_URI=https://your-app-name.onrender.com/api/auth/outlook/callback

# Security
JWT_SECRET=<generate-random-32-char-string>
ENCRYPTION_KEY=<generate-random-32-char-string>

# CORS
CORS_ORIGIN=https://your-app-name.onrender.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
```

### 2.4 Deploy Background Worker Service

1. Go to Render Dashboard → New → Background Worker
2. Connect same repository
3. Configure:

**Basic Settings:**
- **Name**: `faq-generator-worker`
- **Environment**: `Node`
- **Region**: Same as other services
- **Branch**: `main`
- **Build Command**: `npm install`
- **Start Command**: `node src/workers/emailProcessor.js`

**Environment Variables:** (Same as web service)

### 2.5 Deploy Cron Job (Optional)

1. Go to Render Dashboard → New → Cron Job
2. Configure:
   - **Name**: `faq-generator-sync`
   - **Command**: `node scripts/cron-email-sync.js`
   - **Schedule**: `0 */6 * * *` (every 6 hours)
   - **Environment Variables**: Same as web service

## Step 3: Configure OAuth Applications

### 3.1 Update Gmail OAuth Settings

1. Go to Google Cloud Console → APIs & Services → Credentials
2. Edit your OAuth 2.0 Client ID
3. Add to **Authorized redirect URIs**:
   ```
   https://your-app-name.onrender.com/api/auth/gmail/callback
   ```

### 3.2 Update Outlook OAuth Settings

1. Go to Azure Portal → App registrations
2. Select your application
3. Go to Authentication → Add platform → Web
4. Add redirect URI:
   ```
   https://your-app-name.onrender.com/api/auth/outlook/callback
   ```

## Step 4: Database Setup

### 4.1 Run Migrations

After deployment, run database migrations:

1. Go to your web service shell (Render Dashboard → Service → Shell)
2. Run:
```bash
npm run migrate
```

### 4.2 Verify Database Schema

Check that all tables are created:
```sql
\dt  -- List tables
```

Expected tables:
- `email_accounts`
- `emails`
- `questions`
- `faqs`
- `processing_jobs`

## Step 5: Verify Deployment

### 5.1 Health Check

Visit: `https://your-app-name.onrender.com/api/health`

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-13T...",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

### 5.2 Frontend Access

Visit: `https://your-app-name.onrender.com`

You should see the React frontend with:
- FAQ Generator header
- Step-by-step wizard
- Email connection options

### 5.3 API Endpoints

Test key endpoints:
- `GET /api/accounts` - Should return empty array initially
- `GET /api/faqs` - Should return empty array initially
- `GET /api/auth/gmail` - Should redirect to Google OAuth

## Step 6: Monitoring and Maintenance

### 6.1 Logs

Monitor logs in Render Dashboard:
- **Web Service**: Application logs, HTTP requests
- **Worker Service**: Background job processing
- **Database**: Connection and query logs

### 6.2 Metrics

Monitor in Render Dashboard:
- **CPU Usage**: Should be < 80% normally
- **Memory Usage**: Should be < 80% of allocated
- **Response Times**: Should be < 2s for most requests

### 6.3 Scaling

For higher traffic:
1. Upgrade service plans
2. Add more worker instances
3. Consider database connection pooling
4. Implement caching strategies

## Troubleshooting

### Common Issues

1. **Build Failures**
   ```bash
   # Check build logs
   # Ensure all dependencies are in package.json
   # Verify Node.js version compatibility
   ```

2. **Database Connection Issues**
   ```bash
   # Verify DATABASE_URL format
   # Check database service status
   # Run migration manually
   ```

3. **Redis Connection Issues**
   ```bash
   # Verify REDIS_URL format
   # Check Redis service status
   # Test connection in shell
   ```

4. **OAuth Errors**
   ```bash
   # Verify redirect URIs match exactly
   # Check client IDs and secrets
   # Ensure HTTPS in production
   ```

5. **Frontend Not Loading**
   ```bash
   # Check if client/build directory exists
   # Verify NODE_ENV=production
   # Check static file serving in server.js
   ```

### Debug Commands

```bash
# Check environment variables
env | grep -E "(DATABASE|REDIS|OPENAI)"

# Test database connection
node -e "const db = require('./src/config/database'); db.query('SELECT 1').then(console.log).catch(console.error);"

# Test Redis connection
node -e "const redis = require('./src/config/redis'); redis.ping().then(console.log).catch(console.error);"

# Check build directory
ls -la client/build/
```

## Security Considerations

1. **Environment Variables**: Never commit secrets to repository
2. **HTTPS**: Always use HTTPS in production
3. **CORS**: Configure CORS_ORIGIN properly
4. **Rate Limiting**: Monitor and adjust rate limits
5. **Database**: Use connection pooling and prepared statements
6. **OAuth**: Validate redirect URIs and state parameters

## Performance Optimization

1. **Frontend**: Enable gzip compression, optimize images
2. **Backend**: Use Redis caching, optimize database queries
3. **Database**: Add indexes, use connection pooling
4. **Workers**: Scale based on email volume
5. **CDN**: Consider CDN for static assets

## Backup and Recovery

1. **Database**: Render provides automated backups
2. **Redis**: Consider persistence settings
3. **Code**: Use Git for version control
4. **Environment**: Document all environment variables

## Cost Optimization

**Starter Setup (~$21/month):**
- Web Service: Starter ($7)
- PostgreSQL: Starter ($7)
- Redis: Starter ($7)

**Production Setup (~$75/month):**
- Web Service: Standard ($25)
- PostgreSQL: Standard ($20)
- Redis: Standard ($15)
- Worker Service: Standard ($15)

## Support

For issues:
1. Check Render documentation
2. Review application logs
3. Test locally first
4. Contact Render support for platform issues

---

**Deployment Complete!** 🎉

Your FAQ Generator application is now live with:
- ✅ Beautiful React frontend
- ✅ Full-featured backend API
- ✅ Real-time processing
- ✅ Email integration
- ✅ Production-ready infrastructure