#!/usr/bin/env node

/**
 * Check deployed code status via API endpoint
 */

const https = require('https');

const checkDeployedCode = () => {
  console.log('🔍 Checking deployed code via API...\n');
  
  const options = {
    hostname: 'faq-generator-web.onrender.com',
    port: 443,
    path: '/api/debug/check-deployment',
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        
        console.log('📊 DEPLOYMENT STATUS');
        console.log('===================');
        console.log(`Timestamp: ${result.deployment?.timestamp || 'Unknown'}`);
        console.log(`Environment: ${result.deployment?.environment || 'Unknown'}`);
        console.log(`Render Instance: ${result.deployment?.renderInstance || 'Not on Render'}`);
        
        console.log('\n🔍 CODE CHECK');
        console.log('=============');
        console.log(`Line 130: ${result.codeCheck?.line130 || 'Not found'}`);
        console.log(`Has const issue: ${result.codeCheck?.hasConstIssue ? '❌ YES' : '✅ NO'}`);
        console.log(`Has let fix: ${result.codeCheck?.hasLetFix ? '✅ YES' : '❌ NO'}`);
        console.log(`Fix Applied: ${result.codeCheck?.fixApplied ? '✅ YES' : '❌ NO'}`);
        
        console.log('\n📦 GIT INFO');
        console.log('===========');
        console.log(`Commit: ${result.gitInfo?.commit?.substring(0, 7) || 'Unknown'}`);
        console.log(`Branch: ${result.gitInfo?.branch || 'Unknown'}`);
        
        console.log('\n💻 PROCESS INFO');
        console.log('===============');
        console.log(`Node Version: ${result.processInfo?.nodeVersion || 'Unknown'}`);
        console.log(`Uptime: ${Math.floor((result.processInfo?.uptime || 0) / 60)} minutes`);
        console.log(`Memory: ${Math.floor((result.processInfo?.memoryUsage?.heapUsed || 0) / 1024 / 1024)} MB`);
        
        console.log('\n🎯 DIAGNOSIS');
        console.log('============');
        if (result.codeCheck?.fixApplied) {
          console.log('✅ The fix has been successfully deployed!');
        } else if (result.codeCheck?.hasConstIssue) {
          console.log('❌ The old code is still deployed (const issue present)');
          console.log('   → Wait for deployment to complete or check Render dashboard');
        } else {
          console.log('⚠️  Unable to determine deployment status');
        }
        
      } catch (error) {
        console.error('❌ Error parsing response:', error.message);
        console.log('Raw response:', data);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Request failed:', error.message);
    console.log('\nPossible reasons:');
    console.log('1. Deployment is still in progress');
    console.log('2. The debug endpoint hasn\'t been deployed yet');
    console.log('3. Network connectivity issues');
  });

  req.end();
};

// Run the check
checkDeployedCode();

// Check every 30 seconds if --watch flag is provided
if (process.argv.includes('--watch')) {
  console.log('\n👀 Watching for changes (checking every 30 seconds)...\n');
  setInterval(checkDeployedCode, 30000);
}