const { expect } = require('chai');
const sinon = require('sinon');
const aiService = require('../../src/services/aiService');
const { setupTestDatabase, cleanupTestDatabase } = require('../setup');

describe('AI Service', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('detectQuestions', () => {
    it('should detect questions from email content', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              questions: [
                {
                  question: "How do I reset my password?",
                  confidence: 0.9,
                  category: "account"
                }
              ]
            })
          }
        }]
      };

      sandbox.stub(aiService, 'callOpenAI').resolves(mockResponse);

      const emailContent = "Hi, I'm having trouble logging in. How do I reset my password?";
      const result = await aiService.detectQuestions(emailContent);

      expect(result).to.be.an('array');
      expect(result).to.have.length(1);
      expect(result[0]).to.have.property('question', "How do I reset my password?");
      expect(result[0]).to.have.property('confidence', 0.9);
      expect(result[0]).to.have.property('category', 'account');
    });

    it('should handle empty email content', async () => {
      const result = await aiService.detectQuestions('');
      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
    });

    it('should handle API errors gracefully', async () => {
      sandbox.stub(aiService, 'callOpenAI').rejects(new Error('API Error'));

      const emailContent = "Test email content";
      const result = await aiService.detectQuestions(emailContent);

      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings for text', async () => {
      const mockResponse = {
        data: [{
          embedding: new Array(1536).fill(0.1)
        }]
      };

      sandbox.stub(aiService, 'callOpenAI').resolves(mockResponse);

      const text = "How do I reset my password?";
      const result = await aiService.generateEmbedding(text);

      expect(result).to.be.an('array');
      expect(result).to.have.length(1536);
      expect(result[0]).to.equal(0.1);
    });

    it('should handle empty text', async () => {
      const result = await aiService.generateEmbedding('');
      expect(result).to.be.null;
    });

    it('should handle API errors', async () => {
      sandbox.stub(aiService, 'callOpenAI').rejects(new Error('API Error'));

      const text = "Test text";
      const result = await aiService.generateEmbedding(text);

      expect(result).to.be.null;
    });
  });

  describe('generateFAQAnswer', () => {
    it('should generate FAQ answers from questions', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: "To reset your password, click on the 'Forgot Password' link on the login page."
          }
        }]
      };

      sandbox.stub(aiService, 'callOpenAI').resolves(mockResponse);

      const question = "How do I reset my password?";
      const context = ["User forgot password", "Login issues"];
      const result = await aiService.generateFAQAnswer(question, context);

      expect(result).to.be.a('string');
      expect(result).to.include('reset your password');
    });

    it('should handle empty question', async () => {
      const result = await aiService.generateFAQAnswer('', []);
      expect(result).to.be.null;
    });

    it('should handle API errors', async () => {
      sandbox.stub(aiService, 'callOpenAI').rejects(new Error('API Error'));

      const question = "Test question";
      const result = await aiService.generateFAQAnswer(question, []);

      expect(result).to.be.null;
    });
  });

  describe('categorizeQuestion', () => {
    it('should categorize questions correctly', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              category: "account",
              confidence: 0.95
            })
          }
        }]
      };

      sandbox.stub(aiService, 'callOpenAI').resolves(mockResponse);

      const question = "How do I reset my password?";
      const result = await aiService.categorizeQuestion(question);

      expect(result).to.have.property('category', 'account');
      expect(result).to.have.property('confidence', 0.95);
    });

    it('should handle invalid JSON response', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: "Invalid JSON"
          }
        }]
      };

      sandbox.stub(aiService, 'callOpenAI').resolves(mockResponse);

      const question = "Test question";
      const result = await aiService.categorizeQuestion(question);

      expect(result).to.have.property('category', 'general');
      expect(result).to.have.property('confidence', 0.5);
    });
  });

  describe('improveAnswer', () => {
    it('should improve existing FAQ answers', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: "To reset your password, follow these steps: 1. Go to login page 2. Click 'Forgot Password' 3. Enter your email 4. Check your email for reset link"
          }
        }]
      };

      sandbox.stub(aiService, 'callOpenAI').resolves(mockResponse);

      const originalAnswer = "Click forgot password link";
      const additionalContext = ["Step by step instructions needed"];
      const result = await aiService.improveAnswer(originalAnswer, additionalContext);

      expect(result).to.be.a('string');
      expect(result).to.include('steps');
    });

    it('should handle empty original answer', async () => {
      const result = await aiService.improveAnswer('', []);
      expect(result).to.be.null;
    });
  });

  describe('validateQuestionQuality', () => {
    it('should validate high-quality questions', async () => {
      const question = "How do I reset my password for my account?";
      const result = await aiService.validateQuestionQuality(question);

      expect(result).to.have.property('isValid', true);
      expect(result).to.have.property('score');
      expect(result.score).to.be.above(0.7);
    });

    it('should reject low-quality questions', async () => {
      const question = "help";
      const result = await aiService.validateQuestionQuality(question);

      expect(result).to.have.property('isValid', false);
      expect(result).to.have.property('score');
      expect(result.score).to.be.below(0.5);
    });

    it('should handle empty questions', async () => {
      const result = await aiService.validateQuestionQuality('');
      expect(result).to.have.property('isValid', false);
      expect(result).to.have.property('score', 0);
    });
  });
});