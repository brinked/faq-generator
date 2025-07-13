const request = require('supertest');
const { expect } = require('chai');
const sinon = require('sinon');
const app = require('../../server');
const { setupTestDatabase, cleanupTestDatabase, insertTestAccount, insertTestFAQ } = require('../setup');

describe('API Routes', () => {
  let testDb;
  let sandbox;

  before(async () => {
    testDb = await setupTestDatabase();
  });

  after(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Dashboard Routes', () => {
    describe('GET /api/dashboard/stats', () => {
      it('should return dashboard statistics', async () => {
        const response = await request(app)
          .get('/api/dashboard/stats')
          .expect(200);

        expect(response.body).to.have.property('accounts');
        expect(response.body).to.have.property('emails');
        expect(response.body).to.have.property('questions');
        expect(response.body).to.have.property('faqs');
        expect(response.body).to.have.property('processing');
      });
    });

    describe('GET /api/dashboard/recent-activity', () => {
      it('should return recent activity', async () => {
        const response = await request(app)
          .get('/api/dashboard/recent-activity')
          .expect(200);

        expect(response.body).to.be.an('array');
      });

      it('should limit results based on query parameter', async () => {
        const response = await request(app)
          .get('/api/dashboard/recent-activity?limit=5')
          .expect(200);

        expect(response.body).to.be.an('array');
        expect(response.body.length).to.be.at.most(5);
      });
    });
  });

  describe('Account Routes', () => {
    describe('GET /api/accounts', () => {
      it('should return list of email accounts', async () => {
        await insertTestAccount();

        const response = await request(app)
          .get('/api/accounts')
          .expect(200);

        expect(response.body).to.have.property('accounts');
        expect(response.body).to.have.property('total');
        expect(response.body.accounts).to.be.an('array');
      });

      it('should support pagination', async () => {
        const response = await request(app)
          .get('/api/accounts?page=1&limit=10')
          .expect(200);

        expect(response.body).to.have.property('page', 1);
        expect(response.body).to.have.property('limit', 10);
      });
    });

    describe('POST /api/accounts', () => {
      it('should create a new email account', async () => {
        const accountData = {
          email: 'test@example.com',
          provider: 'gmail',
          display_name: 'Test Account'
        };

        const response = await request(app)
          .post('/api/accounts')
          .send(accountData)
          .expect(201);

        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('email', accountData.email);
        expect(response.body).to.have.property('provider', accountData.provider);
      });

      it('should validate required fields', async () => {
        const accountData = {
          provider: 'gmail'
          // Missing email
        };

        const response = await request(app)
          .post('/api/accounts')
          .send(accountData)
          .expect(400);

        expect(response.body).to.have.property('error');
      });

      it('should prevent duplicate email accounts', async () => {
        const accountData = {
          email: 'duplicate@example.com',
          provider: 'gmail',
          display_name: 'Test Account'
        };

        // Create first account
        await request(app)
          .post('/api/accounts')
          .send(accountData)
          .expect(201);

        // Try to create duplicate
        const response = await request(app)
          .post('/api/accounts')
          .send(accountData)
          .expect(409);

        expect(response.body).to.have.property('error');
      });
    });

    describe('PUT /api/accounts/:id', () => {
      it('should update an existing account', async () => {
        const account = await insertTestAccount();

        const updateData = {
          display_name: 'Updated Account Name',
          sync_enabled: false
        };

        const response = await request(app)
          .put(`/api/accounts/${account.id}`)
          .send(updateData)
          .expect(200);

        expect(response.body).to.have.property('display_name', updateData.display_name);
        expect(response.body).to.have.property('sync_enabled', updateData.sync_enabled);
      });

      it('should handle non-existent account', async () => {
        const response = await request(app)
          .put('/api/accounts/99999')
          .send({ display_name: 'Test' })
          .expect(404);

        expect(response.body).to.have.property('error');
      });
    });

    describe('DELETE /api/accounts/:id', () => {
      it('should delete an account', async () => {
        const account = await insertTestAccount();

        await request(app)
          .delete(`/api/accounts/${account.id}`)
          .expect(200);

        // Verify account is deleted
        await request(app)
          .get(`/api/accounts/${account.id}`)
          .expect(404);
      });
    });
  });

  describe('FAQ Routes', () => {
    describe('GET /api/faqs', () => {
      it('should return list of FAQs', async () => {
        await insertTestFAQ();

        const response = await request(app)
          .get('/api/faqs')
          .expect(200);

        expect(response.body).to.have.property('faqs');
        expect(response.body).to.have.property('total');
        expect(response.body.faqs).to.be.an('array');
      });

      it('should filter by category', async () => {
        await insertTestFAQ({ category: 'account' });
        await insertTestFAQ({ category: 'billing' });

        const response = await request(app)
          .get('/api/faqs?category=account')
          .expect(200);

        expect(response.body.faqs).to.be.an('array');
        response.body.faqs.forEach(faq => {
          expect(faq).to.have.property('category', 'account');
        });
      });

      it('should search FAQs', async () => {
        await insertTestFAQ({ question: 'How to reset password?' });
        await insertTestFAQ({ question: 'How to change email?' });

        const response = await request(app)
          .get('/api/faqs?search=password')
          .expect(200);

        expect(response.body.faqs).to.be.an('array');
        expect(response.body.faqs.length).to.be.at.least(1);
        expect(response.body.faqs[0].question).to.include('password');
      });
    });

    describe('POST /api/faqs', () => {
      it('should create a new FAQ', async () => {
        const faqData = {
          question: 'How do I contact support?',
          answer: 'You can contact support via email at support@example.com',
          category: 'support',
          priority: 2
        };

        const response = await request(app)
          .post('/api/faqs')
          .send(faqData)
          .expect(201);

        expect(response.body).to.have.property('id');
        expect(response.body).to.have.property('question', faqData.question);
        expect(response.body).to.have.property('answer', faqData.answer);
        expect(response.body).to.have.property('category', faqData.category);
      });

      it('should validate required fields', async () => {
        const faqData = {
          question: 'Test question'
          // Missing answer
        };

        const response = await request(app)
          .post('/api/faqs')
          .send(faqData)
          .expect(400);

        expect(response.body).to.have.property('error');
      });
    });

    describe('PUT /api/faqs/:id', () => {
      it('should update an existing FAQ', async () => {
        const faq = await insertTestFAQ();

        const updateData = {
          answer: 'Updated answer with more details',
          priority: 1
        };

        const response = await request(app)
          .put(`/api/faqs/${faq.id}`)
          .send(updateData)
          .expect(200);

        expect(response.body).to.have.property('answer', updateData.answer);
        expect(response.body).to.have.property('priority', updateData.priority);
      });
    });

    describe('DELETE /api/faqs/:id', () => {
      it('should delete an FAQ', async () => {
        const faq = await insertTestFAQ();

        await request(app)
          .delete(`/api/faqs/${faq.id}`)
          .expect(200);

        // Verify FAQ is deleted
        await request(app)
          .get(`/api/faqs/${faq.id}`)
          .expect(404);
      });
    });

    describe('POST /api/faqs/:id/toggle', () => {
      it('should toggle FAQ active status', async () => {
        const faq = await insertTestFAQ({ is_active: true });

        const response = await request(app)
          .post(`/api/faqs/${faq.id}/toggle`)
          .expect(200);

        expect(response.body).to.have.property('is_active', false);
      });
    });
  });

  describe('Email Routes', () => {
    describe('GET /api/emails', () => {
      it('should return list of emails', async () => {
        const response = await request(app)
          .get('/api/emails')
          .expect(200);

        expect(response.body).to.have.property('emails');
        expect(response.body).to.have.property('total');
        expect(response.body.emails).to.be.an('array');
      });

      it('should filter by account', async () => {
        const account = await insertTestAccount();

        const response = await request(app)
          .get(`/api/emails?account_id=${account.id}`)
          .expect(200);

        expect(response.body.emails).to.be.an('array');
      });
    });

    describe('POST /api/emails/sync', () => {
      it('should trigger email synchronization', async () => {
        const account = await insertTestAccount();

        const response = await request(app)
          .post('/api/emails/sync')
          .send({ account_id: account.id })
          .expect(200);

        expect(response.body).to.have.property('message');
        expect(response.body).to.have.property('job_id');
      });

      it('should handle missing account_id', async () => {
        const response = await request(app)
          .post('/api/emails/sync')
          .send({})
          .expect(400);

        expect(response.body).to.have.property('error');
      });
    });
  });

  describe('Export Routes', () => {
    describe('GET /api/export/faqs', () => {
      it('should export FAQs in JSON format', async () => {
        await insertTestFAQ();

        const response = await request(app)
          .get('/api/export/faqs?format=json')
          .expect(200);

        expect(response.headers['content-type']).to.include('application/json');
        expect(response.body).to.be.an('array');
      });

      it('should export FAQs in CSV format', async () => {
        await insertTestFAQ();

        const response = await request(app)
          .get('/api/export/faqs?format=csv')
          .expect(200);

        expect(response.headers['content-type']).to.include('text/csv');
        expect(response.text).to.include('question,answer,category');
      });

      it('should handle invalid format', async () => {
        const response = await request(app)
          .get('/api/export/faqs?format=invalid')
          .expect(400);

        expect(response.body).to.have.property('error');
      });
    });

    describe('GET /api/export/backup', () => {
      it('should create system backup', async () => {
        const response = await request(app)
          .get('/api/export/backup')
          .expect(200);

        expect(response.headers['content-type']).to.include('application/zip');
        expect(response.headers['content-disposition']).to.include('attachment');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).to.have.property('error');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/faqs')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);

      expect(response.body).to.have.property('error');
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      const db = require('../../src/config/database');
      sandbox.stub(db, 'query').rejects(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/faqs')
        .expect(500);

      expect(response.body).to.have.property('error');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to API endpoints', async () => {
      // Make multiple rapid requests
      const promises = Array(20).fill().map(() => 
        request(app).get('/api/dashboard/stats')
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimited = responses.some(response => response.status === 429);
      expect(rateLimited).to.be.true;
    });
  });

  describe('Authentication', () => {
    it('should require authentication for protected routes', async () => {
      const response = await request(app)
        .post('/api/accounts')
        .send({ email: 'test@example.com', provider: 'gmail' })
        .expect(401);

      expect(response.body).to.have.property('error');
    });

    it('should accept valid authentication', async () => {
      // Mock authentication middleware
      const auth = require('../../src/middleware/auth');
      sandbox.stub(auth, 'authenticate').callsFake((req, res, next) => {
        req.user = { id: 1, email: 'admin@example.com' };
        next();
      });

      const response = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body).to.have.property('accounts');
    });
  });
});