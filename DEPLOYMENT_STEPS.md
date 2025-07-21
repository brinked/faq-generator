# Step-by-Step Deployment Guide for FAQ Generator Fix

## Pre-Deployment Checklist
- [x] Local code has fix: `let content` at line 130 of aiService.js
- [ ] All changes committed to git
- [ ] GitHub repository is accessible
- [ ] Render dashboard access available

## Step 1: Commit and Push Changes

### 1.1 Check Git Status
```bash
cd faq-generator
git status
```

### 1.2 Add All Changes
```bash
git add .
```

### 1.3 Commit with Clear Message
```bash
git commit -m "URGENT FIX: Change const to let in aiService.js line 130 - fixes Assignment to constant variable error"
```

### 1.4 Push to GitHub
```bash
git push origin main
```

## Step 2: Trigger Render Deployment

### Option A: Automatic Trigger (Recommended)
The push to GitHub should automatically trigger Render deployment. Monitor at:
- https://dashboard.render.com
- Navigate to faq-generator-web service
- Check "Events" tab for new deployment

### Option B: Manual Deployment with Cache Clear
If automatic deployment doesn't start:
1. Log into Render Dashboard
2. Navigate to faq-generator-web service
3. Click "Manual Deploy"
4. Select "Clear build cache & deploy"
5. Confirm deployment

## Step 3: Monitor Deployment Progress

### 3.1 Watch Deployment Logs
In Render dashboard:
- Click on the active deployment
- Monitor logs for:
  - "Build successful"
  - "Deploy successful"
  - No error messages

### 3.2 Expected Deployment Time
- Build: 2-3 minutes
- Deploy: 1-2 minutes
- Total: ~5 minutes

## Step 4: Verify Deployment

### 4.1 Run Diagnostic Script
Once deployment is complete:
```bash
# Option 1: Run locally if you have API access
node scripts/check-deployed-code.js

# Option 2: Check via API endpoint (if implemented)
curl https://faq-generator-web.onrender.com/api/debug/check-code
```

### 4.2 Expected Diagnostic Output
```
✅ Fix is present: "let content" found at line 130
✅ OpenAI v3 import style detected
✅ Latest commit deployed
```

## Step 5: Test Email Processing

### 5.1 Trigger Processing
```bash
curl -X POST https://faq-generator-web.onrender.com/api/sync/process-faqs \
  -H "Content-Type: application/json"
```

### 5.2 Check Logs
Monitor for:
- No "Assignment to constant variable" errors
- Successful processing beyond 60 emails
- "Processing completed" messages

## Step 6: Monitor Production

### 6.1 Check Error Logs
```bash
# Via Render dashboard logs or API
curl https://faq-generator-web.onrender.com/api/health
```

### 6.2 Verify Processing Stats
- Email processing count increasing
- No stuck processes
- Memory usage within limits

## Troubleshooting

### If Deployment Fails
1. Check Render build logs for errors
2. Verify GitHub webhook is configured
3. Try manual deployment with cache clear

### If Error Persists After Deployment
1. SSH into Render instance (if available)
2. Manually check deployed file:
   ```bash
   cat /opt/render/project/src/src/services/aiService.js | grep -n "content ="
   ```
3. Check for multiple deployment instances

### Emergency Rollback
1. In Render dashboard, go to "Events"
2. Find previous successful deployment
3. Click "Rollback to this deploy"

## Success Criteria
- [ ] Deployment completed without errors
- [ ] Diagnostic confirms correct code deployed
- [ ] No "Assignment to constant variable" errors in logs
- [ ] Email processing works beyond 60 emails
- [ ] Health endpoint returns positive status

## Post-Deployment
1. Monitor for 30 minutes
2. Check processing metrics
3. Document any additional issues
4. Update team on deployment status

---
Last Updated: 2025-07-21 23:48 UTC
Deployment Guide Version: 2.0