# FAQ Generator - Render.com Deployment Guide

This guide will walk you through deploying the FAQ Generator application to Render.com.

## Prerequisites

1. **GitHub Account**: Your code needs to be in a GitHub repository
2. **Render.com Account**: Sign up at [render.com](https://render.com)
3. **API Keys**: You'll need API keys for:
   - OpenAI API
   - Gmail API (Google Cloud Console)
   - Outlook API (Microsoft Azure)

## Step 1: Prepare Your Repository

### 1.1 Initialize Git Repository

```bash
cd faq-generator
git init
git add .
git commit -m "Initial commit: FAQ Generator application"
```

### 1.2 Create GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name it `faq-generator` (or your preferred name)
3. Don't initialize with README (we already have one)
4. Copy the repository URL

### 1.3 Push to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/faq-generator.git
git branch -M main
git push -u origin main
```

## Step 2: Set Up API Credentials

### 2.1 OpenAI API Key

1. Go to [OpenAI API](https://platform.openai.com/api-keys)
2. Create a new API key
3. Save it securely (you'll need it for Render environment variables)

### 2.2 Gmail API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Gmail API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `https://YOUR_APP_NAME.onrender.com/api/auth/gmail/callback`
5. Save the Client ID and Client Secret

### 2.3 Outlook API Setup

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to Azure Active Directory > App registrations
3. Create a new registration:
   - Name: FAQ Generator
   - Redirect URI: `https://YOUR_APP_NAME.onrender.com/api/auth/outlook/callback`
4. Note the Application (client) ID and Directory (tenant) ID
5. Create a client secret in "Certificates & secrets"

## Step 3: Deploy to Render.com

### 3.1 Connect Repository

1. Log in to [Render.com](https://render.com)
2. Click "New +" and select "Blueprint"
3. Connect your GitHub account
4. Select your `faq-generator` repository
5. Render will detect the `render.yaml` file

### 3.2 Configure Environment Variables

The blueprint will create all services, but you need to set these environment variables:

#### For Web Service (`faq-generator-web`):

**Required API Keys:**
```
OPENAI_API_KEY=your_openai_api_key_here
GMAIL_CLIENT_ID=your_gmail_client_id_here
GMAIL_CLIENT_SECRET=your_gmail_client_secret_here
OUTLOOK_CLIENT_ID=your_outlook_client_id_here
OUTLOOK_CLIENT_SECRET=your_outlook_client_secret_here
```

**Update Redirect URIs:**
```
GMAIL_REDIRECT_URI=https://YOUR_APP_NAME.onrender.com/api/auth/gmail/callback
OUTLOOK_REDIRECT_URI=https://YOUR_APP_NAME.onrender.com/api/auth/outlook/callback
CORS_ORIGIN=https://YOUR_APP_NAME.onrender.com
```

**Optional Configuration:**
```
ALERT_WEBHOOK_URL=your_slack_or_discord_webhook_url (optional)
```

#### For Worker Service (`faq-generator-worker`):
- Same API keys as web service
- Database and Redis URLs are auto-configured

#### For Cron Jobs:
- Same API keys as web service
- Database and Redis URLs are auto-configured

### 3.3 Deploy Services

1. Click "Apply" to deploy all services
2. Render will:
   - Create PostgreSQL database
   - Create Redis instance
   - Deploy web service
   - Deploy worker service
   - Set up cron jobs

### 3.4 Monitor Deployment

1. Watch the build logs for each service
2. Ensure all services start successfully
3. Check the web service health at: `https://YOUR_APP_NAME.onrender.com/api/health`

## Step 4: Post-Deployment Setup

### 4.1 Database Migration

The database will be automatically migrated on first deployment via the `render.yaml` configuration.

### 4.2 Test Email Integration

1. Go to your deployed application
2. Try connecting a Gmail or Outlook account
3. Verify the OAuth flow works correctly
4. Check that emails are being synchronized

### 4.3 Monitor Cron Jobs

1. In Render dashboard, check the cron job logs
2. Verify they're running on schedule:
   - Email sync: Every 30 minutes
   - FAQ generation: Every 2 hours
   - Cleanup: Daily at 2 AM

## Step 5: Troubleshooting

### Common Issues

#### 1. OAuth Redirect URI Mismatch
**Error**: `redirect_uri_mismatch`
**Solution**: Update redirect URIs in Google/Microsoft consoles to match your Render URL

#### 2. Database Connection Issues
**Error**: Database connection failed
**Solution**: Check that PostgreSQL service is running and environment variables are set

#### 3. Redis Connection Issues
**Error**: Redis connection failed
**Solution**: Verify Redis service is running and accessible

#### 4. OpenAI API Issues
**Error**: OpenAI API calls failing
**Solution**: 
- Check API key is valid
- Verify you have sufficient credits
- Check rate limits

#### 5. Cron Jobs Not Running
**Error**: Scheduled tasks not executing
**Solution**:
- Check cron job logs in Render dashboard
- Verify environment variables are set for cron services
- Check script permissions

### Debugging Steps

1. **Check Service Logs**:
   - Go to Render dashboard
   - Select each service
   - Review logs for errors

2. **Test API Endpoints**:
   ```bash
   curl https://YOUR_APP_NAME.onrender.com/api/health
   curl https://YOUR_APP_NAME.onrender.com/api/dashboard/stats
   ```

3. **Database Access**:
   - Use Render's database shell
   - Check table creation and data

4. **Redis Access**:
   - Use Redis CLI through Render
   - Check queue status

## Step 6: Scaling and Optimization

### 6.1 Upgrade Plans

For production use, consider upgrading:
- **Web Service**: Standard plan for better performance
- **Database**: Standard plan for more storage and connections
- **Redis**: Standard plan for more memory

### 6.2 Performance Monitoring

Monitor these metrics:
- Response times
- Database query performance
- Queue processing times
- Memory usage
- Error rates

### 6.3 Backup Strategy

1. **Database Backups**: Render provides automatic backups
2. **Data Export**: Use the built-in export functionality
3. **Code Backups**: Keep your Git repository updated

## Step 7: Maintenance

### Regular Tasks

1. **Monitor Logs**: Check for errors regularly
2. **Update Dependencies**: Keep packages updated
3. **API Key Rotation**: Rotate API keys periodically
4. **Database Cleanup**: Monitor storage usage
5. **Performance Review**: Check metrics monthly

### Updates and Deployments

1. Make changes to your local repository
2. Commit and push to GitHub
3. Render will automatically redeploy
4. Monitor deployment logs

## Security Considerations

1. **Environment Variables**: Never commit API keys to Git
2. **HTTPS Only**: Ensure all traffic uses HTTPS
3. **Rate Limiting**: Monitor API usage
4. **Access Logs**: Review access patterns
5. **Regular Updates**: Keep dependencies updated

## Support and Resources

- **Render Documentation**: [render.com/docs](https://render.com/docs)
- **Application Logs**: Available in Render dashboard
- **Health Check**: `https://YOUR_APP_NAME.onrender.com/api/health`
- **System Status**: `https://YOUR_APP_NAME.onrender.com/api/dashboard/health`

## Cost Estimation

**Starter Plan (Development)**:
- Web Service: $7/month
- Worker Service: $7/month
- PostgreSQL: $7/month
- Redis: $7/month
- Cron Jobs: $7/month each (3 jobs = $21/month)
- **Total**: ~$49/month

**Standard Plan (Production)**:
- Web Service: $25/month
- Worker Service: $25/month
- PostgreSQL: $20/month
- Redis: $20/month
- Cron Jobs: $25/month each (3 jobs = $75/month)
- **Total**: ~$165/month

Remember to replace `YOUR_APP_NAME` with your actual Render service name throughout this guide.