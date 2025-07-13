const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Deploying FAQ Generator to Production...\n');

try {
  // Step 1: Build frontend
  console.log('📦 Building frontend...');
  execSync('npm run build:client', { stdio: 'inherit' });

  // Step 2: Verify build exists
  const buildPath = path.join(__dirname, 'client/build');
  if (!fs.existsSync(buildPath)) {
    throw new Error('Frontend build not found');
  }

  console.log('✅ Frontend build completed successfully!');
  
  // Step 3: Check build contents
  const buildContents = fs.readdirSync(buildPath);
  console.log('📋 Build contents:');
  buildContents.forEach(file => {
    const filePath = path.join(buildPath, file);
    const stats = fs.statSync(filePath);
    const size = stats.isDirectory() ? 'dir' : `${(stats.size / 1024).toFixed(1)}KB`;
    console.log(`   - ${file} (${size})`);
  });

  // Step 4: Set production environment
  console.log('\n🔧 Setting production environment...');
  process.env.NODE_ENV = 'production';

  console.log('\n✅ Deployment preparation complete!');
  console.log('\n📝 Next steps:');
  console.log('1. Commit and push changes to your repository');
  console.log('2. Trigger a new deployment on Render.com');
  console.log('3. The frontend will be served at your domain root');
  console.log('\n🌐 Your app will be available at: https://faq-generator-web.onrender.com');

} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
}