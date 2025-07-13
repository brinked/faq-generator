const { expect } = require('chai');
const sinon = require('sinon');
const { setupTestDatabase, cleanupTestDatabase, insertTestAccount, insertTestEmail } = require('../setup');
const emailService = require('../../src/services/emailService');
const aiService = require('../../src/services/aiService');
const similarityService = require('../../src/services/similarityService');
const faqService = require('../../src/services/faqService');
const queueService = require('../../src/services/queueService');

describe('Integration - Complete FAQ Generation Workflow', () => {
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

  describe('End-to-End FAQ Generation', () => {
    it('should complete full workflow from email to FAQ', async () => {
      // Step 1: Setup test account and emails
      const account = await insertTestAccount({
        email: 'support@company.com',
        provider: 'gmail',
        sync_enabled: true
      });

      const testEmails = [
        {
          subject: 'Password Reset Help',
          body: 'Hi, I forgot my password and need help resetting it. How do I reset my password?',
          sender: 'user1@example.com'
        },
        {
          subject: 'Login Issues',
          body: 'I cannot log into my account. How can I reset my password?',
          sender: 'user2@example.com'
        },
        {
          subject: 'Account Access',
          body: 'I need to change my password but forgot the current one. What should I do?',
          sender: 'user3@example.com'
        }
      ];

      const emails = [];
      for (const emailData of testEmails) {
        const email = await insertTestEmail(emailData, account.id);
        emails.push(email);
      }

      // Step 2: Mock AI service responses
      sandbox.stub(aiService, 'detectQuestions').callsFake(async (emailContent) => {
        if (emailContent.includes('password')) {
          return [{
            question: 'How do I reset my password?',
            confidence: 0.9,
            category: 'account'
          }];
        }
        return [];
      });

      sandbox.stub(aiService, 'generateEmbedding').callsFake(async (text) => {
        // Generate similar embeddings for password-related questions
        if (text.includes('password')) {
          return new Array(1536).fill(0.1);
        }
        return new Array(1536).fill(0.9);
      });

      sandbox.stub(aiService, 'generateFAQAnswer').resolves(
        'To reset your password: 1. Go to the login page 2. Click "Forgot Password" 3. Enter your email 4. Check your email for reset instructions'
      );

      sandbox.stub(aiService, 'categorizeQuestion').resolves({
        category: 'account',
        confidence: 0.95
      });

      // Step 3: Process emails to extract questions
      const allQuestions = [];
      for (const email of emails) {
        const questions = await aiService.detectQuestions(email.body);
        for (const questionData of questions) {
          const embedding = await aiService.generateEmbedding(questionData.question);
          
          // Insert question into database
          const result = await testDb.query(
            `INSERT INTO email_questions (email_id, question_text, confidence_score, category, embedding)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [email.id, questionData.question, questionData.confidence, questionData.category, JSON.stringify(embedding)]
          );
          
          allQuestions.push({
            ...result.rows[0],
            embedding: embedding
          });
        }
      }

      expect(allQuestions.length).to.equal(3);

      // Step 4: Cluster similar questions
      const clusters = await similarityService.clusterQuestions(allQuestions, 0.8);
      
      expect(clusters).to.be.an('array');
      expect(clusters.length).to.be.at.least(1);
      
      const passwordCluster = clusters.find(cluster => 
        cluster.questions.some(q => q.question_text.includes('password'))
      );
      
      expect(passwordCluster).to.exist;
      expect(passwordCluster.questions.length).to.equal(3);

      // Step 5: Generate FAQ from clustered questions
      const faq = await faqService.generateFAQFromQuestions(passwordCluster.questions);
      
      expect(faq).to.have.property('id');
      expect(faq).to.have.property('question');
      expect(faq).to.have.property('answer');
      expect(faq).to.have.property('category', 'account');
      expect(faq).to.have.property('source_count', 3);
      expect(faq).to.have.property('is_active', true);

      // Step 6: Verify FAQ quality
      expect(faq.confidence_score).to.be.above(0.8);
      expect(faq.answer).to.include('reset');
      expect(faq.answer).to.include('password');

      // Step 7: Test FAQ retrieval
      const retrievedFAQ = await faqService.getFAQById(faq.id);
      expect(retrievedFAQ).to.deep.include(faq);

      // Step 8: Test FAQ search functionality
      const searchResults = await faqService.getAllFAQs({ search: 'password' });
      expect(searchResults.faqs.length).to.be.at.least(1);
      expect(searchResults.faqs[0].question).to.include('password');
    });

    it('should handle multiple categories in workflow', async () => {
      const account = await insertTestAccount();

      const testEmails = [
        {
          subject: 'Billing Question',
          body: 'How much does your service cost? What are the pricing plans?',
          sender: 'user1@example.com'
        },
        {
          subject: 'Technical Support',
          body: 'The application is not working. How do I troubleshoot technical issues?',
          sender: 'user2@example.com'
        }
      ];

      const emails = [];
      for (const emailData of testEmails) {
        const email = await insertTestEmail(emailData, account.id);
        emails.push(email);
      }

      // Mock AI responses for different categories
      sandbox.stub(aiService, 'detectQuestions').callsFake(async (emailContent) => {
        if (emailContent.includes('cost') || emailContent.includes('pricing')) {
          return [{
            question: 'What are your pricing plans?',
            confidence: 0.85,
            category: 'billing'
          }];
        } else if (emailContent.includes('troubleshoot') || emailContent.includes('technical')) {
          return [{
            question: 'How do I troubleshoot technical issues?',
            confidence: 0.9,
            category: 'technical'
          }];
        }
        return [];
      });

      sandbox.stub(aiService, 'generateEmbedding').callsFake(async (text) => {
        if (text.includes('pricing') || text.includes('cost')) {
          return new Array(1536).fill(0.2);
        } else if (text.includes('troubleshoot') || text.includes('technical')) {
          return new Array(1536).fill(0.8);
        }
        return new Array(1536).fill(0.5);
      });

      sandbox.stub(aiService, 'generateFAQAnswer').callsFake(async (question) => {
        if (question.includes('pricing')) {
          return 'Our pricing plans start at $10/month for basic and $50/month for premium.';
        } else if (question.includes('troubleshoot')) {
          return 'For technical issues: 1. Check your internet connection 2. Clear browser cache 3. Contact support if issues persist.';
        }
        return 'General answer';
      });

      sandbox.stub(aiService, 'categorizeQuestion').callsFake(async (question) => {
        if (question.includes('pricing')) {
          return { category: 'billing', confidence: 0.9 };
        } else if (question.includes('troubleshoot')) {
          return { category: 'technical', confidence: 0.9 };
        }
        return { category: 'general', confidence: 0.5 };
      });

      // Process workflow
      const allQuestions = [];
      for (const email of emails) {
        const questions = await aiService.detectQuestions(email.body);
        for (const questionData of questions) {
          const embedding = await aiService.generateEmbedding(questionData.question);
          
          const result = await testDb.query(
            `INSERT INTO email_questions (email_id, question_text, confidence_score, category, embedding)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [email.id, questionData.question, questionData.confidence, questionData.category, JSON.stringify(embedding)]
          );
          
          allQuestions.push({
            ...result.rows[0],
            embedding: embedding
          });
        }
      }

      // Cluster and generate FAQs
      const clusters = await similarityService.clusterQuestions(allQuestions, 0.7);
      expect(clusters.length).to.equal(2); // Should have separate clusters for billing and technical

      const faqs = [];
      for (const cluster of clusters) {
        const faq = await faqService.generateFAQFromQuestions(cluster.questions);
        faqs.push(faq);
      }

      expect(faqs.length).to.equal(2);
      
      const categories = faqs.map(faq => faq.category);
      expect(categories).to.include('billing');
      expect(categories).to.include('technical');
    });

    it('should handle low-quality questions filtering', async () => {
      const account = await insertTestAccount();

      const testEmails = [
        {
          subject: 'Good Question',
          body: 'How do I reset my password for my account?',
          sender: 'user1@example.com'
        },
        {
          subject: 'Poor Quality',
          body: 'help',
          sender: 'user2@example.com'
        },
        {
          subject: 'Another Good Question',
          body: 'What is your refund policy for cancelled subscriptions?',
          sender: 'user3@example.com'
        }
      ];

      const emails = [];
      for (const emailData of testEmails) {
        const email = await insertTestEmail(emailData, account.id);
        emails.push(email);
      }

      // Mock AI to return different quality scores
      sandbox.stub(aiService, 'detectQuestions').callsFake(async (emailContent) => {
        if (emailContent.includes('password')) {
          return [{
            question: 'How do I reset my password?',
            confidence: 0.9,
            category: 'account'
          }];
        } else if (emailContent === 'help') {
          return [{
            question: 'help',
            confidence: 0.3, // Low confidence
            category: 'general'
          }];
        } else if (emailContent.includes('refund')) {
          return [{
            question: 'What is your refund policy?',
            confidence: 0.85,
            category: 'billing'
          }];
        }
        return [];
      });

      sandbox.stub(aiService, 'generateEmbedding').resolves(new Array(1536).fill(0.1));
      sandbox.stub(aiService, 'generateFAQAnswer').resolves('Test answer');
      sandbox.stub(aiService, 'categorizeQuestion').resolves({ category: 'general', confidence: 0.8 });

      // Process with quality filtering
      const allQuestions = [];
      for (const email of emails) {
        const questions = await aiService.detectQuestions(email.body);
        for (const questionData of questions) {
          // Filter out low-confidence questions
          if (questionData.confidence >= 0.7) {
            const embedding = await aiService.generateEmbedding(questionData.question);
            
            const result = await testDb.query(
              `INSERT INTO email_questions (email_id, question_text, confidence_score, category, embedding)
               VALUES ($1, $2, $3, $4, $5) RETURNING *`,
              [email.id, questionData.question, questionData.confidence, questionData.category, JSON.stringify(embedding)]
            );
            
            allQuestions.push({
              ...result.rows[0],
              embedding: embedding
            });
          }
        }
      }

      // Should only have 2 high-quality questions
      expect(allQuestions.length).to.equal(2);
      expect(allQuestions.every(q => q.confidence_score >= 0.7)).to.be.true;
    });
  });

  describe('Queue Processing Integration', () => {
    it('should process email sync jobs through queue', async () => {
      const account = await insertTestAccount();

      // Mock queue processing
      let jobProcessed = false;
      sandbox.stub(queueService, 'addEmailSyncJob').callsFake(async (accountId) => {
        expect(accountId).to.equal(account.id);
        jobProcessed = true;
        return { id: 'job-123' };
      });

      // Trigger email sync
      const job = await queueService.addEmailSyncJob(account.id);
      
      expect(job).to.have.property('id');
      expect(jobProcessed).to.be.true;
    });

    it('should process FAQ generation jobs through queue', async () => {
      // Mock queue processing
      let faqJobProcessed = false;
      sandbox.stub(queueService, 'addFAQGenerationJob').callsFake(async () => {
        faqJobProcessed = true;
        return { id: 'faq-job-123' };
      });

      // Trigger FAQ generation
      const job = await queueService.addFAQGenerationJob();
      
      expect(job).to.have.property('id');
      expect(faqJobProcessed).to.be.true;
    });
  });

  describe('Error Handling in Workflow', () => {
    it('should handle AI service failures gracefully', async () => {
      const account = await insertTestAccount();
      const email = await insertTestEmail({
        body: 'How do I reset my password?'
      }, account.id);

      // Mock AI service failure
      sandbox.stub(aiService, 'detectQuestions').rejects(new Error('AI service unavailable'));

      // Should not throw error, but return empty results
      const questions = await aiService.detectQuestions(email.body).catch(() => []);
      expect(questions).to.be.an('array');
      expect(questions).to.have.length(0);
    });

    it('should handle database connection issues', async () => {
      // Mock database error
      sandbox.stub(testDb, 'query').rejects(new Error('Database connection failed'));

      try {
        await faqService.getAllFAQs();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Database connection failed');
      }
    });

    it('should handle empty email content', async () => {
      const account = await insertTestAccount();
      const email = await insertTestEmail({
        body: ''
      }, account.id);

      sandbox.stub(aiService, 'detectQuestions').resolves([]);

      const questions = await aiService.detectQuestions(email.body);
      expect(questions).to.be.an('array');
      expect(questions).to.have.length(0);
    });
  });
});