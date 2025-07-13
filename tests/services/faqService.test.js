const { expect } = require('chai');
const sinon = require('sinon');
const faqService = require('../../src/services/faqService');
const { setupTestDatabase, cleanupTestDatabase, insertTestFAQ, insertTestQuestion, insertTestAccount, insertTestEmail } = require('../setup');

describe('FAQ Service', () => {
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

  describe('createFAQ', () => {
    it('should create a new FAQ', async () => {
      const faqData = {
        question: 'How do I reset my password?',
        answer: 'To reset your password, click on the "Forgot Password" link.',
        category: 'account',
        priority: 1,
        confidence_score: 0.9,
        source_count: 5
      };

      const faq = await faqService.createFAQ(faqData);

      expect(faq).to.have.property('id');
      expect(faq).to.have.property('question', faqData.question);
      expect(faq).to.have.property('answer', faqData.answer);
      expect(faq).to.have.property('category', faqData.category);
      expect(faq).to.have.property('is_active', true);
    });

    it('should handle missing required fields', async () => {
      const faqData = {
        question: 'Test question'
        // Missing answer
      };

      try {
        await faqService.createFAQ(faqData);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it('should set default values for optional fields', async () => {
      const faqData = {
        question: 'Test question?',
        answer: 'Test answer'
      };

      const faq = await faqService.createFAQ(faqData);

      expect(faq).to.have.property('category', 'general');
      expect(faq).to.have.property('priority', 5);
      expect(faq).to.have.property('is_active', true);
      expect(faq).to.have.property('confidence_score', 0.5);
      expect(faq).to.have.property('source_count', 1);
    });
  });

  describe('updateFAQ', () => {
    it('should update an existing FAQ', async () => {
      const faq = await insertTestFAQ();
      
      const updateData = {
        answer: 'Updated answer with more details',
        priority: 2
      };

      const updatedFAQ = await faqService.updateFAQ(faq.id, updateData);

      expect(updatedFAQ).to.have.property('id', faq.id);
      expect(updatedFAQ).to.have.property('answer', updateData.answer);
      expect(updatedFAQ).to.have.property('priority', updateData.priority);
      expect(updatedFAQ).to.have.property('question', faq.question); // Unchanged
    });

    it('should handle non-existent FAQ', async () => {
      const updateData = { answer: 'Updated answer' };

      try {
        await faqService.updateFAQ(99999, updateData);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it('should update updated_at timestamp', async () => {
      const faq = await insertTestFAQ();
      const originalUpdatedAt = faq.updated_at;

      // Wait a moment to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const updatedFAQ = await faqService.updateFAQ(faq.id, { answer: 'New answer' });

      expect(new Date(updatedFAQ.updated_at)).to.be.above(new Date(originalUpdatedAt));
    });
  });

  describe('deleteFAQ', () => {
    it('should delete an FAQ', async () => {
      const faq = await insertTestFAQ();

      const result = await faqService.deleteFAQ(faq.id);
      expect(result).to.be.true;

      // Verify FAQ is deleted
      try {
        await faqService.getFAQById(faq.id);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it('should handle non-existent FAQ', async () => {
      const result = await faqService.deleteFAQ(99999);
      expect(result).to.be.false;
    });
  });

  describe('getFAQById', () => {
    it('should retrieve FAQ by ID', async () => {
      const faq = await insertTestFAQ();

      const retrievedFAQ = await faqService.getFAQById(faq.id);

      expect(retrievedFAQ).to.have.property('id', faq.id);
      expect(retrievedFAQ).to.have.property('question', faq.question);
      expect(retrievedFAQ).to.have.property('answer', faq.answer);
    });

    it('should handle non-existent FAQ', async () => {
      try {
        await faqService.getFAQById(99999);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('getAllFAQs', () => {
    it('should retrieve all FAQs with pagination', async () => {
      // Create multiple FAQs
      await insertTestFAQ({ question: 'Question 1', priority: 1 });
      await insertTestFAQ({ question: 'Question 2', priority: 2 });
      await insertTestFAQ({ question: 'Question 3', priority: 3 });

      const result = await faqService.getAllFAQs({ page: 1, limit: 2 });

      expect(result).to.have.property('faqs');
      expect(result).to.have.property('total');
      expect(result).to.have.property('page', 1);
      expect(result).to.have.property('limit', 2);
      expect(result.faqs).to.be.an('array');
      expect(result.faqs.length).to.be.at.most(2);
      expect(result.total).to.be.at.least(3);
    });

    it('should filter by category', async () => {
      await insertTestFAQ({ question: 'Account question', category: 'account' });
      await insertTestFAQ({ question: 'Billing question', category: 'billing' });

      const result = await faqService.getAllFAQs({ category: 'account' });

      expect(result.faqs).to.be.an('array');
      expect(result.faqs.length).to.be.at.least(1);
      expect(result.faqs[0]).to.have.property('category', 'account');
    });

    it('should filter by active status', async () => {
      await insertTestFAQ({ question: 'Active FAQ', is_active: true });
      await insertTestFAQ({ question: 'Inactive FAQ', is_active: false });

      const result = await faqService.getAllFAQs({ is_active: true });

      expect(result.faqs).to.be.an('array');
      result.faqs.forEach(faq => {
        expect(faq).to.have.property('is_active', true);
      });
    });

    it('should search by question text', async () => {
      await insertTestFAQ({ question: 'How to reset password?' });
      await insertTestFAQ({ question: 'How to change email?' });

      const result = await faqService.getAllFAQs({ search: 'password' });

      expect(result.faqs).to.be.an('array');
      expect(result.faqs.length).to.be.at.least(1);
      expect(result.faqs[0].question).to.include('password');
    });
  });

  describe('generateFAQFromQuestions', () => {
    it('should generate FAQ from clustered questions', async () => {
      const account = await insertTestAccount();
      const email = await insertTestEmail({}, account.id);
      
      const questions = [
        await insertTestQuestion({
          question_text: 'How do I reset my password?',
          confidence_score: 0.9
        }, email.id),
        await insertTestQuestion({
          question_text: 'How can I change my password?',
          confidence_score: 0.85
        }, email.id)
      ];

      // Mock AI service
      const aiService = require('../../src/services/aiService');
      sandbox.stub(aiService, 'generateFAQAnswer').resolves('To reset your password, follow these steps...');
      sandbox.stub(aiService, 'categorizeQuestion').resolves({ category: 'account', confidence: 0.9 });

      const faq = await faqService.generateFAQFromQuestions(questions);

      expect(faq).to.have.property('id');
      expect(faq).to.have.property('question');
      expect(faq).to.have.property('answer');
      expect(faq).to.have.property('category', 'account');
      expect(faq).to.have.property('source_count', 2);
    });

    it('should handle empty questions array', async () => {
      const faq = await faqService.generateFAQFromQuestions([]);
      expect(faq).to.be.null;
    });

    it('should calculate confidence score from questions', async () => {
      const account = await insertTestAccount();
      const email = await insertTestEmail({}, account.id);
      
      const questions = [
        await insertTestQuestion({ confidence_score: 0.9 }, email.id),
        await insertTestQuestion({ confidence_score: 0.8 }, email.id)
      ];

      const aiService = require('../../src/services/aiService');
      sandbox.stub(aiService, 'generateFAQAnswer').resolves('Test answer');
      sandbox.stub(aiService, 'categorizeQuestion').resolves({ category: 'general', confidence: 0.8 });

      const faq = await faqService.generateFAQFromQuestions(questions);

      expect(faq).to.have.property('confidence_score');
      expect(faq.confidence_score).to.be.closeTo(0.85, 0.01); // Average of 0.9 and 0.8
    });
  });

  describe('getFAQsByCategory', () => {
    it('should retrieve FAQs by category', async () => {
      await insertTestFAQ({ category: 'account', question: 'Account question' });
      await insertTestFAQ({ category: 'billing', question: 'Billing question' });

      const accountFAQs = await faqService.getFAQsByCategory('account');

      expect(accountFAQs).to.be.an('array');
      expect(accountFAQs.length).to.be.at.least(1);
      expect(accountFAQs[0]).to.have.property('category', 'account');
    });

    it('should return empty array for non-existent category', async () => {
      const faqs = await faqService.getFAQsByCategory('nonexistent');
      expect(faqs).to.be.an('array');
      expect(faqs).to.have.length(0);
    });
  });

  describe('updateFAQPriority', () => {
    it('should update FAQ priority', async () => {
      const faq = await insertTestFAQ({ priority: 5 });

      const updatedFAQ = await faqService.updateFAQPriority(faq.id, 1);

      expect(updatedFAQ).to.have.property('priority', 1);
    });

    it('should validate priority range', async () => {
      const faq = await insertTestFAQ();

      try {
        await faqService.updateFAQPriority(faq.id, 0); // Invalid priority
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('toggleFAQStatus', () => {
    it('should toggle FAQ active status', async () => {
      const faq = await insertTestFAQ({ is_active: true });

      const updatedFAQ = await faqService.toggleFAQStatus(faq.id);

      expect(updatedFAQ).to.have.property('is_active', false);

      const toggledAgain = await faqService.toggleFAQStatus(faq.id);
      expect(toggledAgain).to.have.property('is_active', true);
    });
  });

  describe('getFAQStats', () => {
    it('should return FAQ statistics', async () => {
      await insertTestFAQ({ category: 'account', is_active: true });
      await insertTestFAQ({ category: 'billing', is_active: true });
      await insertTestFAQ({ category: 'account', is_active: false });

      const stats = await faqService.getFAQStats();

      expect(stats).to.have.property('total');
      expect(stats).to.have.property('active');
      expect(stats).to.have.property('inactive');
      expect(stats).to.have.property('by_category');
      expect(stats.total).to.be.at.least(3);
      expect(stats.active).to.be.at.least(2);
      expect(stats.inactive).to.be.at.least(1);
      expect(stats.by_category).to.be.an('object');
    });
  });
});