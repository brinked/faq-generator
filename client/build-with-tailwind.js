#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🎨 Building FAQ Generator with Tailwind CSS...\n');

// Check if Tailwind CSS is installed
try {
  require.resolve('tailwindcss');
  console.log('✅ Tailwind CSS found');
} catch (error) {
  console.log('📦 Installing Tailwind CSS...');
  execSync('npm install -D tailwindcss@^3.3.2', { stdio: 'inherit' });
  console.log('✅ Tailwind CSS installed');
}

// Ensure PostCSS config exists
const postcssConfigPath = path.join(__dirname, 'postcss.config.js');
if (!fs.existsSync(postcssConfigPath)) {
  console.log('📝 Creating PostCSS config...');
  const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;
  fs.writeFileSync(postcssConfigPath, postcssConfig);
  console.log('✅ PostCSS config created');
}

// Ensure Tailwind config exists
const tailwindConfigPath = path.join(__dirname, 'tailwind.config.js');
if (!fs.existsSync(tailwindConfigPath)) {
  console.log('📝 Creating Tailwind config...');
  execSync('npx tailwindcss init', { stdio: 'inherit' });
  console.log('✅ Tailwind config created');
}

// Build the application
console.log('🔨 Building application...');
try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build completed successfully!');
  
  // Check if build directory exists and has files
  const buildDir = path.join(__dirname, 'build');
  if (fs.existsSync(buildDir)) {
    const files = fs.readdirSync(buildDir);
    console.log(`📁 Build directory contains ${files.length} files/folders`);
    
    // Check for CSS files with Tailwind classes
    const staticDir = path.join(buildDir, 'static', 'css');
    if (fs.existsSync(staticDir)) {
      const cssFiles = fs.readdirSync(staticDir).filter(file => file.endsWith('.css'));
      console.log(`🎨 Found ${cssFiles.length} CSS file(s)`);
      
      // Check if Tailwind utilities are present
      if (cssFiles.length > 0) {
        const cssContent = fs.readFileSync(path.join(staticDir, cssFiles[0]), 'utf8');
        const hasTailwind = cssContent.includes('tailwind') || cssContent.includes('--tw-') || cssContent.includes('.bg-');
        console.log(hasTailwind ? '✅ Tailwind CSS utilities detected in build' : '⚠️  Tailwind CSS utilities not detected');
      }
    }
  }
  
  console.log('\n🎉 Build process completed!');
  console.log('📋 Next steps:');
  console.log('   1. Deploy the build folder to your hosting service');
  console.log('   2. Test the application in production');
  console.log('   3. Verify all Tailwind styles are working correctly');
  
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}