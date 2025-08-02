const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Starting authentication migration...');
    
    // Read and execute the migration
    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.join(__dirname, '../database/migrations/add_auth_and_public_faqs.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.error('Migration file not found:', migrationPath);
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
        console.log(`Executing statement ${i + 1}/${statements.length}...`);
        await client.query(statement);
      }
    }
    
    console.log('✅ Authentication migration completed successfully!');
    
    // Initialize admin user if password is provided
    if (process.env.ADMIN_PASSWORD) {
      console.log('Setting up admin user...');
      
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@faqgenerator.com';
      
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
        console.log('✅ Admin user password updated successfully');
      }
    } else {
      console.log('⚠️  ADMIN_PASSWORD not set. You will need to set it manually or use the default password.');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runMigration().catch(console.error); 