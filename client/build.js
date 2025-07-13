const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Building FAQ Generator Frontend...\n');

try {
  // Check if node_modules exists
  if (!fs.existsSync('node_modules')) {
    console.log('📦 Installing dependencies...');
    execSync('npm install', { stdio: 'inherit' });
  }

  // Build the React app
  console.log('🔨 Building React application...');
  execSync('npm run build', { stdio: 'inherit' });

  // Check if build was successful
  const buildPath = path.join(__dirname, 'build');
  if (fs.existsSync(buildPath)) {
    console.log('✅ Frontend build completed successfully!');
    console.log(`📁 Build files are in: ${buildPath}`);
    
    // List build contents
    const buildContents = fs.readdirSync(buildPath);
    console.log('📋 Build contents:');
    buildContents.forEach(file => {
      console.log(`   - ${file}`);
    });
  } else {
    throw new Error('Build directory not found');
  }

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}