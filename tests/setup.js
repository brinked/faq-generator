const { Pool } = require('pg');
const Redis = require('redis');
const fs = require('fs').promises;
const path = require('path');

// Test database configuration
const testDbConfig = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: process.env.TEST_DB_PORT || 5432,
  database: process.env.TEST_DB_NAME || 'faq_generator_test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'password'
};

// Test Redis configuration
const testRedisConfig = {
  host: process.env.TEST_REDIS_HOST || 'localhost',
  port: process.env.TEST_REDIS_PORT || 6379,
  password: process.env.TEST_REDIS_PASSWORD || undefined
};

let testDb;
let testRedis;

async function setupTestDatabase() {
  try {
    // Create test database pool
    testDb = new Pool(testDbConfig);
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    
    // Split schema into individual statements and execute
    const statements = schema.split(';').filter(stmt => stmt.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await testDb.query(statement);
      }
    }
    
    console.log('Test database setup completed');
    return testDb;
  } catch (error) {
    console.error('Test database setup failed:', error);
    throw error;
  }
}

async function setupTestRedis() {
  try {
    testRedis = Redis.createClient(testRedisConfig);
    await testRedis.connect();
    
    // Clear test Redis database
    await testRedis.flushDb();
    
    console.log('Test Redis setup completed');
    return testRedis;
  } catch (error) {
    console.error('Test Redis setup failed:', error);
    throw error;
  }
}

async function cleanupTestDatabase() {
  if (testDb) {
    // Clean all tables
    const tables = [
      'system_metrics',
      'faq_questions',
      'faqs',
      'email_questions',
      'emails',
      'email_accounts'
    ];
    
    for (const table of tables) {
      await testDb.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
    
    await testDb.end();
    testDb = null;
  }
}

async function cleanupTestRedis() {
  if (testRedis) {
    await testRedis.flushDb();
    await testRedis.disconnect();
    testRedis = null;
  }
}

// Mock data generators
function generateMockEmail(overrides = {}) {
  return {
    message_id: `test-${Date.now()}-${Math.random()}`,
    subject: 'Test Email Subject',
    sender: 'test@example.com',
    recipient: 'support@company.com',
    body: 'This is a test email body with some content.',
    received_date: new Date(),
    thread_id: `thread-${Date.now()}`,
    labels: ['INBOX'],
    ...overrides
  };
}

function generateMockAccount(overrides = {}) {
  return {
    email: 'test@example.com',
    provider: 'gmail',
    display_name: 'Test Account',
    is_active: true,
    sync_enabled: true,
    last_sync: new Date(),
    ...overrides
  };
}

function generateMockQuestion(overrides = {}) {
  return {
    question_text: 'How do I reset my password?',
    confidence_score: 0.85,
    category: 'account',
    embedding: new Array(1536).fill(0.1),
    ...overrides
  };
}

function generateMockFAQ(overrides = {}) {
  return {
    question: 'How do I reset my password?',
    answer: 'To reset your password, click on the "Forgot Password" link on the login page.',
    category: 'account',
    priority: 1,
    is_active: true,
    confidence_score: 0.9,
    source_count: 5,
    ...overrides
  };
}

// Test utilities
async function insertTestAccount(accountData = {}) {
  const account = generateMockAccount(accountData);
  const result = await testDb.query(
    `INSERT INTO email_accounts (email, provider, display_name, is_active, sync_enabled, last_sync, encrypted_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      account.email,
      account.provider,
      account.display_name,
      account.is_active,
      account.sync_enabled,
      account.last_sync,
      JSON.stringify({ access_token: 'test_token' })
    ]
  );
  return result.rows[0];
}

async function insertTestEmail(emailData = {}, accountId) {
  const email = generateMockEmail(emailData);
  const result = await testDb.query(
    `INSERT INTO emails (account_id, message_id, subject, sender, recipient, body, received_date, thread_id, labels)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      accountId,
      email.message_id,
      email.subject,
      email.sender,
      email.recipient,
      email.body,
      email.received_date,
      email.thread_id,
      email.labels
    ]
  );
  return result.rows[0];
}

async function insertTestQuestion(questionData = {}, emailId) {
  const question = generateMockQuestion(questionData);
  const result = await testDb.query(
    `INSERT INTO email_questions (email_id, question_text, confidence_score, category, embedding)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      emailId,
      question.question_text,
      question.confidence_score,
      question.category,
      JSON.stringify(question.embedding)
    ]
  );
  return result.rows[0];
}

async function insertTestFAQ(faqData = {}) {
  const faq = generateMockFAQ(faqData);
  const result = await testDb.query(
    `INSERT INTO faqs (question, answer, category, priority, is_active, confidence_score, source_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      faq.question,
      faq.answer,
      faq.category,
      faq.priority,
      faq.is_active,
      faq.confidence_score,
      faq.source_count
    ]
  );
  return result.rows[0];
}

module.exports = {
  setupTestDatabase,
  setupTestRedis,
  cleanupTestDatabase,
  cleanupTestRedis,
  generateMockEmail,
  generateMockAccount,
  generateMockQuestion,
  generateMockFAQ,
  insertTestAccount,
  insertTestEmail,
  insertTestQuestion,
  insertTestFAQ,
  getTestDb: () => testDb,
  getTestRedis: () => testRedis
};