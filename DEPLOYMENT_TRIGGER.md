# Manual Deployment Instructions for Render

Since auto-deploy isn't triggering, here are the manual steps to deploy your email filtering improvements:

## Method 1: Manual Deploy via Render Dashboard (Recommended)

### Step 1: Access Render Dashboard
1. Go to https://dashboard.render.com
2. Log in to your account
3. Find your services (should be listed on the main dashboard)

### Step 2: Deploy Each Service Manually
You need to manually deploy these services in this order:

#### 1. Deploy Main Web Service
- Click on **`faq-generator-web`**
- Click the **"Manual Deploy"** button (usually in the top right)
- Select **"Deploy latest commit"**
- Wait for deployment to complete (usually 2-5 minutes)

#### 2. Deploy Worker Service
- Click on **`faq-generator-worker`**
- Click the **"Manual Deploy"** button
- Select **"Deploy latest commit"**
- Wait for deployment to complete

#### 3. Deploy Cron Services (if needed)
- Click on **`email-sync-cron`**
- Click the **"Manual Deploy"** button
- Select **"Deploy latest commit"**

- Click on **`faq-generation-cron`**
- Click the **"Manual Deploy"** button
- Select **"Deploy latest commit"**

- Click on **`cleanup-cron`**
- Click the **"Manual Deploy"** button
- Select **"Deploy latest commit"**

### Step 3: Verify Deployment
1. Check the **Logs** tab for each service to ensure they started successfully
2. Look for messages like "Server started on port 10000" for the web service
3. Test the application to ensure the new filtering features are working

## Method 2: Force Deploy with Package.json Change

If manual deploy doesn't work, try this:

1. Make a small change to trigger deployment
2. Commit and push the change
3. This should force Render to recognize the update

## Method 3: Render CLI (if you have it installed)

If you have Render CLI installed:

```bash
# Deploy web service
render deploy --service-id=<your-web-service-id>

# Deploy worker service  
render deploy --service-id=<your-worker-service-id>
```

## Troubleshooting

### If Services Won't Deploy:
1. **Check Build Logs**: Look for any build errors in the deployment logs
2. **Check Environment Variables**: Ensure all required env vars are set
3. **Check Service Status**: Make sure services aren't suspended due to billing issues

### If Auto-Deploy is Broken:
1. **Check Repository Connection**: Verify GitHub integration is working
2. **Check Branch Settings**: Ensure services are watching the correct branch (main)
3. **Check Webhook**: GitHub webhook might need to be reconnected

### Common Issues:
- **Build Failures**: Check for missing dependencies or build errors
- **Environment Variables**: Missing OPENAI_API_KEY, DATABASE_URL, etc.
- **Port Issues**: Ensure PORT is set to 10000 for web service
- **Database Connection**: Verify DATABASE_URL is correctly configured

## What the New Features Do:

Once deployed, you'll have:

✅ **Smart Email Filtering**: Only processes emails with replies from connected accounts
✅ **Spam Reduction**: Automatically filters out promotional/irrelevant emails  
✅ **Better AI Processing**: Uses conversation context for improved question detection
✅ **Filtering Statistics**: New UI component showing filtering impact
✅ **Improved FAQ Quality**: Higher quality FAQs from actual customer conversations

## Testing the Deployment:

1. **Access your app**: Go to your Render app URL
2. **Check Processing Status**: Look for the new "Email Filtering Statistics" section
3. **Process Some Emails**: Try processing emails to see the filtering in action
4. **Check FAQ Quality**: Generated FAQs should be more relevant and higher quality

## Need Help?

If you're still having issues:
1. Check the Render service logs for error messages
2. Verify all environment variables are properly set
3. Ensure your GitHub repository connection is working
4. Contact Render support if the platform itself seems to have issues

The manual deployment method should work even if auto-deploy is having issues.