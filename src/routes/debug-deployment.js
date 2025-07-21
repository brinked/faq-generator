const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Debug endpoint to check deployed code
router.get('/check-deployment', async (req, res) => {
  try {
    const aiServicePath = path.join(__dirname, '../services/aiService.js');
    
    if (!fs.existsSync(aiServicePath)) {
      return res.status(404).json({
        error: 'aiService.js not found',
        path: aiServicePath
      });
    }
    
    const content = fs.readFileSync(aiServicePath, 'utf8');
    const lines = content.split('\n');
    
    // Check critical lines
    const line130 = lines[129] || 'Line 130 not found';
    const line143 = lines[142] || 'Line 143 not found';
    
    // Check for const vs let
    const hasConstIssue = line130.includes('const content');
    const hasLetFix = line130.includes('let content');
    
    // Get git info if available
    let gitInfo = {};
    try {
      const { execSync } = require('child_process');
      gitInfo.commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      gitInfo.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch (e) {
      gitInfo.error = 'Git info not available';
    }
    
    res.json({
      status: 'ok',
      deployment: {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'not set',
        renderInstance: process.env.RENDER_INSTANCE_ID || 'not on Render'
      },
      codeCheck: {
        line130: line130.trim(),
        line143: line143.trim(),
        hasConstIssue,
        hasLetFix,
        fixApplied: hasLetFix && !hasConstIssue
      },
      gitInfo,
      processInfo: {
        nodeVersion: process.version,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      }
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check deployment',
      message: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;