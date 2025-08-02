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
      console.log('📋 Creating authentication tables...');
      
      // Create admin tables directly (more reliable than migration file)
      const authTableSQL = `
        -- Create admin_users table
        CREATE TABLE IF NOT EXISTS admin_users (
          id UUID NOT NULL DEFAULT uuid_generate_v4(),
          username VARCHAR(255) NOT NULL UNIQUE,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          is_active BOOLEAN DEFAULT true,
          last_login_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          CONSTRAINT admin_users_pkey PRIMARY KEY (id)
        );
        
        -- Create admin_sessions table
        CREATE TABLE IF NOT EXISTS admin_sessions (
          id UUID NOT NULL DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL,
          token_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          CONSTRAINT admin_sessions_pkey PRIMARY KEY (id),
          CONSTRAINT admin_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES admin_users (id)
        );
        
        -- Create indexes for admin tables
        CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (username);
        CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users (email);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions (token_hash);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions (user_id);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions (expires_at);
      `;
      
      // Split the SQL into individual statements
      const statements = authTableSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement.trim()) {
          console.log(`  Creating table ${i + 1}/${statements.length}...`);
          await client.query(statement);
        }
      }
      
      console.log('✅ Authentication tables created!');
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
    
    // Create some sample public FAQs (commented out for clean workflow)
    // Uncomment below for offline testing only
    /*
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
        'SELECT id FROM faq_groups WHERE title = $1',
        [faq.title]
      );
      
      if (existingFaq.rows.length === 0) {
        await client.query(`
          INSERT INTO faq_groups (
            title, representative_question, consolidated_answer, category, tags, 
            is_published, sort_order, question_count, frequency_score, avg_confidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          faq.title,
          faq.question,
          faq.answer,
          faq.category,
          faq.tags,
          true,
          1,
          1, // question_count
          1.0, // frequency_score
          0.95 // avg_confidence
        ]);
      }
    }
    
    console.log('✅ Sample FAQs created');
    */
    
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