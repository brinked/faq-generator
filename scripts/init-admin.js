const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initAdmin() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Initializing FAQ Generator with Authentication System...');
    
    // Check if admin_users table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'admin_users'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('📋 Running authentication migration...');
      
      // Run the migration
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, '../database/migrations/add_auth_and_public_faqs.sql');
      
      if (!fs.existsSync(migrationPath)) {
        console.error('❌ Migration file not found:', migrationPath);
        return;
      }
      
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      
      // Split the SQL into individual statements
      const statements = migrationSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement.trim()) {
          console.log(`  Executing statement ${i + 1}/${statements.length}...`);
          await client.query(statement);
        }
      }
      
      console.log('✅ Authentication migration completed!');
    } else {
      console.log('✅ Authentication tables already exist');
    }
    
    // Set up admin user
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@faqgenerator.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    console.log('👤 Setting up admin user...');
    console.log(`  Username: ${adminUsername}`);
    console.log(`  Email: ${adminEmail}`);
    console.log(`  Password: ${adminPassword} (change this in production!)`);
    
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    
    // Check if admin user exists
    const existingUser = await client.query(
      'SELECT id FROM admin_users WHERE username = $1 OR email = $2',
      [adminUsername, adminEmail]
    );
    
    if (existingUser.rows.length === 0) {
      await client.query(
        'INSERT INTO admin_users (username, email, password_hash) VALUES ($1, $2, $3)',
        [adminUsername, adminEmail, passwordHash]
      );
      console.log('✅ Admin user created successfully');
    } else {
      await client.query(
        'UPDATE admin_users SET password_hash = $1 WHERE username = $2 OR email = $3',
        [passwordHash, adminUsername, adminEmail]
      );
      console.log('✅ Admin user password updated');
    }
    
    // Create some sample public FAQs
    console.log('📝 Creating sample public FAQs...');
    
    const sampleFaqs = [
      {
        title: 'How do I reset my password?',
        question: 'I forgot my password, how can I reset it?',
        answer: 'You can reset your password by clicking the "Forgot Password" link on the login page. You will receive an email with instructions to create a new password.',
        category: 'Account Management',
        tags: ['password', 'reset', 'login']
      },
      {
        title: 'What are your business hours?',
        question: 'When are you open for business?',
        answer: 'We are open Monday through Friday from 9:00 AM to 6:00 PM EST. We are closed on weekends and major holidays.',
        category: 'General',
        tags: ['hours', 'business', 'schedule']
      },
      {
        title: 'How do I contact customer support?',
        question: 'What\'s the best way to get help?',
        answer: 'You can contact our customer support team by email at support@example.com or by phone at 1-800-123-4567. We typically respond within 24 hours.',
        category: 'Support',
        tags: ['contact', 'support', 'help']
      }
    ];
    
    for (const faq of sampleFaqs) {
      const existingFaq = await client.query(
        'SELECT id FROM public_faqs WHERE title = $1',
        [faq.title]
      );
      
      if (existingFaq.rows.length === 0) {
        await client.query(`
          INSERT INTO public_faqs (
            title, question, answer, category, tags, 
            is_published, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          faq.title,
          faq.question,
          faq.answer,
          faq.category,
          faq.tags,
          true,
          1
        ]);
      }
    }
    
    console.log('✅ Sample FAQs created');
    
    console.log('\n🎉 FAQ Generator Authentication System is ready!');
    console.log('\n📋 Next steps:');
    console.log('  1. Start the server: npm start');
    console.log('  2. Visit the public site: http://localhost:3000');
    console.log('  3. Access admin panel: http://localhost:3000/admin/login');
    console.log('  4. Login with:');
    console.log(`     Username: ${adminUsername}`);
    console.log(`     Password: ${adminPassword}`);
    console.log('\n⚠️  Remember to change the admin password in production!');
    
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the initialization
initAdmin().catch(console.error); 