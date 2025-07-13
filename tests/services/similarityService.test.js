const { expect } = require('chai');
const sinon = require('sinon');
const similarityService = require('../../src/services/similarityService');
const { setupTestDatabase, cleanupTestDatabase, insertTestQuestion } = require('../setup');

describe('Similarity Service', () => {
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

  describe('calculateCosineSimilarity', () => {
    it('should calculate cosine similarity between vectors', () => {
      const vector1 = [1, 0, 1, 0];
      const vector2 = [0, 1, 1, 0];
      
      const similarity = similarityService.calculateCosineSimilarity(vector1, vector2);
      
      expect(similarity).to.be.a('number');
      expect(similarity).to.be.at.least(0);
      expect(similarity).to.be.at.most(1);
      expect(similarity).to.be.closeTo(0.5, 0.01);
    });

    it('should return 1 for identical vectors', () => {
      const vector1 = [1, 2, 3, 4];
      const vector2 = [1, 2, 3, 4];
      
      const similarity = similarityService.calculateCosineSimilarity(vector1, vector2);
      
      expect(similarity).to.be.closeTo(1, 0.001);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vector1 = [1, 0, 0, 0];
      const vector2 = [0, 1, 0, 0];
      
      const similarity = similarityService.calculateCosineSimilarity(vector1, vector2);
      
      expect(similarity).to.be.closeTo(0, 0.001);
    });

    it('should handle zero vectors', () => {
      const vector1 = [0, 0, 0, 0];
      const vector2 = [1, 2, 3, 4];
      
      const similarity = similarityService.calculateCosineSimilarity(vector1, vector2);
      
      expect(similarity).to.equal(0);
    });

    it('should handle different vector lengths', () => {
      const vector1 = [1, 2];
      const vector2 = [1, 2, 3, 4];
      
      expect(() => {
        similarityService.calculateCosineSimilarity(vector1, vector2);
      }).to.throw();
    });
  });

  describe('findSimilarQuestions', () => {
    it('should find similar questions based on embeddings', async () => {
      // Create test questions with embeddings
      const embedding1 = new Array(1536).fill(0.1);
      const embedding2 = new Array(1536).fill(0.2);
      const embedding3 = new Array(1536).fill(0.9); // Very different

      const question1 = await insertTestQuestion({
        question_text: 'How do I reset my password?',
        embedding: embedding1
      }, 1);

      const question2 = await insertTestQuestion({
        question_text: 'How can I change my password?',
        embedding: embedding2
      }, 1);

      const question3 = await insertTestQuestion({
        question_text: 'What is your return policy?',
        embedding: embedding3
      }, 1);

      const queryEmbedding = new Array(1536).fill(0.15); // Similar to embedding1 and embedding2
      const similarQuestions = await similarityService.findSimilarQuestions(queryEmbedding, 0.8, 10);

      expect(similarQuestions).to.be.an('array');
      expect(similarQuestions.length).to.be.at.least(1);
      expect(similarQuestions[0]).to.have.property('question_text');
      expect(similarQuestions[0]).to.have.property('similarity_score');
    });

    it('should respect similarity threshold', async () => {
      const embedding1 = new Array(1536).fill(0.1);
      const question1 = await insertTestQuestion({
        question_text: 'Test question',
        embedding: embedding1
      }, 1);

      const queryEmbedding = new Array(1536).fill(0.9); // Very different
      const similarQuestions = await similarityService.findSimilarQuestions(queryEmbedding, 0.9, 10);

      expect(similarQuestions).to.be.an('array');
      expect(similarQuestions).to.have.length(0);
    });

    it('should respect limit parameter', async () => {
      // Create multiple similar questions
      for (let i = 0; i < 5; i++) {
        const embedding = new Array(1536).fill(0.1 + i * 0.01);
        await insertTestQuestion({
          question_text: `Test question ${i}`,
          embedding: embedding
        }, 1);
      }

      const queryEmbedding = new Array(1536).fill(0.1);
      const similarQuestions = await similarityService.findSimilarQuestions(queryEmbedding, 0.5, 3);

      expect(similarQuestions).to.be.an('array');
      expect(similarQuestions.length).to.be.at.most(3);
    });
  });

  describe('clusterQuestions', () => {
    it('should cluster similar questions together', async () => {
      // Create test questions with similar embeddings
      const questions = [
        {
          id: 1,
          question_text: 'How do I reset my password?',
          embedding: new Array(1536).fill(0.1)
        },
        {
          id: 2,
          question_text: 'How can I change my password?',
          embedding: new Array(1536).fill(0.11)
        },
        {
          id: 3,
          question_text: 'What is your return policy?',
          embedding: new Array(1536).fill(0.9)
        }
      ];

      const clusters = await similarityService.clusterQuestions(questions, 0.8);

      expect(clusters).to.be.an('array');
      expect(clusters.length).to.be.at.least(1);
      
      // Check that similar questions are clustered together
      const passwordCluster = clusters.find(cluster => 
        cluster.questions.some(q => q.question_text.includes('password'))
      );
      
      expect(passwordCluster).to.exist;
      expect(passwordCluster.questions.length).to.equal(2);
    });

    it('should handle single question', async () => {
      const questions = [{
        id: 1,
        question_text: 'Test question',
        embedding: new Array(1536).fill(0.1)
      }];

      const clusters = await similarityService.clusterQuestions(questions, 0.8);

      expect(clusters).to.be.an('array');
      expect(clusters).to.have.length(1);
      expect(clusters[0].questions).to.have.length(1);
    });

    it('should handle empty questions array', async () => {
      const clusters = await similarityService.clusterQuestions([], 0.8);

      expect(clusters).to.be.an('array');
      expect(clusters).to.have.length(0);
    });
  });

  describe('calculateClusterCentroid', () => {
    it('should calculate centroid of question embeddings', () => {
      const questions = [
        { embedding: [1, 0, 1, 0] },
        { embedding: [0, 1, 0, 1] },
        { embedding: [1, 1, 1, 1] }
      ];

      const centroid = similarityService.calculateClusterCentroid(questions);

      expect(centroid).to.be.an('array');
      expect(centroid).to.have.length(4);
      expect(centroid[0]).to.be.closeTo(0.667, 0.01);
      expect(centroid[1]).to.be.closeTo(0.667, 0.01);
      expect(centroid[2]).to.be.closeTo(0.667, 0.01);
      expect(centroid[3]).to.be.closeTo(0.667, 0.01);
    });

    it('should handle single question', () => {
      const questions = [{ embedding: [1, 2, 3, 4] }];
      const centroid = similarityService.calculateClusterCentroid(questions);

      expect(centroid).to.deep.equal([1, 2, 3, 4]);
    });

    it('should handle empty questions array', () => {
      const centroid = similarityService.calculateClusterCentroid([]);
      expect(centroid).to.be.null;
    });
  });

  describe('findDuplicateQuestions', () => {
    it('should find duplicate questions with high similarity', async () => {
      // Create nearly identical questions
      const embedding1 = new Array(1536).fill(0.1);
      const embedding2 = new Array(1536).fill(0.101); // Very similar

      const question1 = await insertTestQuestion({
        question_text: 'How do I reset my password?',
        embedding: embedding1
      }, 1);

      const question2 = await insertTestQuestion({
        question_text: 'How do I reset my password?',
        embedding: embedding2
      }, 1);

      const duplicates = await similarityService.findDuplicateQuestions(0.95);

      expect(duplicates).to.be.an('array');
      expect(duplicates.length).to.be.at.least(1);
      expect(duplicates[0]).to.have.property('questions');
      expect(duplicates[0].questions).to.have.length.at.least(2);
    });

    it('should not find duplicates when similarity is low', async () => {
      const embedding1 = new Array(1536).fill(0.1);
      const embedding2 = new Array(1536).fill(0.9);

      await insertTestQuestion({
        question_text: 'How do I reset my password?',
        embedding: embedding1
      }, 1);

      await insertTestQuestion({
        question_text: 'What is your return policy?',
        embedding: embedding2
      }, 1);

      const duplicates = await similarityService.findDuplicateQuestions(0.95);

      expect(duplicates).to.be.an('array');
      expect(duplicates).to.have.length(0);
    });
  });
});