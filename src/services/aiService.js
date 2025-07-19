const { Configuration, OpenAIApi } = require('openai');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');

class AIService {
  constructor() {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.openai = new OpenAIApi(configuration);
    
    this.embeddingModel = process.env.OPENAI_MODEL || 'text-embedding-3-small';
    this.chatModel = 'gpt-4o-mini';
    
    // Question detection patterns
    this.questionPatterns = [
      /\?/g, // Direct question marks
      /\b(how|what|when|where|why|who|which|can|could|would|should|will|is|are|do|does|did)\b.*\?/gi,
      /\b(help|assist|support|problem|issue|trouble|error)\b/gi,
      /\b(please|kindly|could you|can you|would you)\b/gi
    ];
    
    // Customer service context indicators
    this.customerContextPatterns = [
      /\b(customer|client|user|support|help|service)\b/gi,
      /\b(ticket|case|inquiry|request|complaint)\b/gi,
      /\b(thank you|thanks|regards|sincerely)\b/gi,
      /\b(dear|hello|hi|greetings)\b/gi
    ];
  }

  /**
   * Detect if an email contains customer questions using AI
   */
  async detectQuestions(emailText, emailSubject = '') {
    try {
      const fullText = `Subject: ${emailSubject}\n\nBody: ${emailText}`;
      
      // First, do a quick pattern-based check
      const hasQuestionPatterns = this.questionPatterns.some(pattern => pattern.test(fullText));
      const hasCustomerContext = this.customerContextPatterns.some(pattern => pattern.test(fullText));
      
      if (!hasQuestionPatterns && !hasCustomerContext) {
        return {
          hasQuestions: false,
          questions: [],
          confidence: 0.1,
          reasoning: 'No question patterns or customer context detected'
        };
      }

      // Use AI for more sophisticated detection
      const prompt = `
Analyze the following email and identify any customer questions that would be suitable for a FAQ.

Email:
${fullText}

Instructions:
1. Identify questions that customers are asking
2. Extract the exact question text
3. If there's a corresponding answer in the email, extract that too
4. Focus on questions that would be commonly asked by other customers
5. Ignore internal questions, scheduling, or very specific personal requests
6. Rate your confidence (0-1) for each question

Respond in JSON format:
{
  "hasQuestions": boolean,
  "questions": [
    {
      "question": "exact question text",
      "answer": "answer if found in email, or null",
      "confidence": 0.0-1.0,
      "context": "surrounding context for the question"
    }
  ],
  "overallConfidence": 0.0-1.0,
  "reasoning": "brief explanation of your analysis"
}
`;

      const response = await this.openai.createChatCompletion({
        model: this.chatModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing customer service emails to identify frequently asked questions. Be precise and focus on questions that would be valuable for a FAQ section.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 1000
      });

      // Clean the response content to handle markdown code blocks
      let content = response.data.choices[0].message.content.trim();
      
      // Remove markdown code block markers if present
      if (content.startsWith('```json')) {
        content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (content.startsWith('```')) {
        content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const result = JSON.parse(content);
      
      // Filter questions based on confidence and length
      const minConfidence = parseFloat(process.env.QUESTION_CONFIDENCE_THRESHOLD) || 0.7;
      const minLength = parseInt(process.env.MIN_QUESTION_LENGTH) || 10;
      const maxLength = parseInt(process.env.MAX_QUESTION_LENGTH) || 500;
      
      result.questions = result.questions.filter(q => 
        q.confidence >= minConfidence &&
        q.question.length >= minLength &&
        q.question.length <= maxLength
      );

      logger.info(`Detected ${result.questions.length} questions with confidence ${result.overallConfidence}`);
      
      return result;

    } catch (error) {
      logger.error('Error detecting questions:', error);
      
      // Fallback to pattern-based detection
      return this.fallbackQuestionDetection(emailText, emailSubject);
    }
  }

  /**
   * Fallback question detection using patterns
   */
  fallbackQuestionDetection(emailText, emailSubject = '') {
    const fullText = `${emailSubject} ${emailText}`;
    const questions = [];
    
    // Split into sentences and look for question patterns
    const sentences = fullText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    for (const sentence of sentences) {
      if (sentence.includes('?') || this.questionPatterns.some(pattern => pattern.test(sentence))) {
        if (sentence.length >= 10 && sentence.length <= 500) {
          questions.push({
            question: sentence + (sentence.includes('?') ? '' : '?'),
            answer: null,
            confidence: 0.6,
            context: sentence
          });
        }
      }
    }

    return {
      hasQuestions: questions.length > 0,
      questions,
      overallConfidence: questions.length > 0 ? 0.6 : 0.2,
      reasoning: 'Fallback pattern-based detection'
    };
  }

  /**
   * Generate embeddings for text
   */
  async generateEmbedding(text) {
    try {
      // Cache key for embeddings
      const cacheKey = `embedding:${Buffer.from(text).toString('base64').slice(0, 50)}`;
      
      // Check cache first
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const response = await this.openai.createEmbedding({
        model: this.embeddingModel,
        input: text
      });

      const embedding = response.data.data[0].embedding;
      
      // Cache the embedding for 24 hours
      await redisClient.set(cacheKey, JSON.stringify(embedding), { ttl: 86400 });
      
      return embedding;

    } catch (error) {
      logger.error('Error generating embedding:', error);
      throw new Error('Failed to generate embedding');
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddingsBatch(texts) {
    try {
      const embeddings = [];
      const batchSize = 100; // OpenAI batch limit
      
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        
        const response = await this.openai.createEmbedding({
          model: this.embeddingModel,
          input: batch
        });

        embeddings.push(...response.data.data.map(item => item.embedding));
      }

      return embeddings;

    } catch (error) {
      logger.error('Error generating embeddings batch:', error);
      throw new Error('Failed to generate embeddings batch');
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  calculateCosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }

  /**
   * Improve question text using AI
   */
  async improveQuestionText(question, context = '') {
    try {
      const prompt = `
Improve the following customer question to make it clearer and more suitable for a FAQ:

Original Question: ${question}
Context: ${context}

Instructions:
1. Make the question clear and grammatically correct
2. Ensure it's general enough to help other customers
3. Remove any personal or specific details
4. Keep the core meaning intact
5. Make it concise but complete

Respond with just the improved question text, nothing else.
`;

      const response = await this.openai.chat.completions.create({
        model: this.chatModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at improving customer service questions for FAQ sections. Focus on clarity and generalizability.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 200
      });

      return response.choices[0].message.content.trim();

    } catch (error) {
      logger.error('Error improving question text:', error);
      return question; // Return original if improvement fails
    }
  }

  /**
   * Generate a comprehensive answer from multiple similar questions and answers
   */
  async generateConsolidatedAnswer(questions, answers) {
    try {
      const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
      const answerList = answers.filter(a => a).map((a, i) => `${i + 1}. ${a}`).join('\n');

      const prompt = `
Create a comprehensive FAQ answer based on these similar customer questions and existing answers:

Questions:
${questionList}

Existing Answers:
${answerList}

Instructions:
1. Create one clear, comprehensive answer that addresses all the questions
2. Make it helpful and actionable for customers
3. Use a professional but friendly tone
4. Include relevant details from the existing answers
5. Structure it clearly with bullet points or steps if needed
6. Keep it concise but complete

Respond with just the consolidated answer, nothing else.
`;

      const response = await this.openai.chat.completions.create({
        model: this.chatModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at creating helpful FAQ answers that consolidate information from multiple customer interactions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      return response.choices[0].message.content.trim();

    } catch (error) {
      logger.error('Error generating consolidated answer:', error);
      return answers.find(a => a) || 'Please contact support for assistance with this question.';
    }
  }

  /**
   * Categorize a question into a topic category
   */
  async categorizeQuestion(question) {
    try {
      const prompt = `
Categorize the following customer question into one of these categories:

Categories:
- Account & Billing
- Technical Support
- Product Information
- Shipping & Delivery
- Returns & Refunds
- General Inquiry
- Other

Question: ${question}

Respond with just the category name, nothing else.
`;

      const response = await this.openai.chat.completions.create({
        model: this.chatModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at categorizing customer service questions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 50
      });

      return response.choices[0].message.content.trim();

    } catch (error) {
      logger.error('Error categorizing question:', error);
      return 'General Inquiry';
    }
  }

  /**
   * Extract keywords/tags from a question
   */
  async extractTags(question) {
    try {
      const prompt = `
Extract 3-5 relevant keywords/tags from this customer question that would help with searching and organization:

Question: ${question}

Instructions:
1. Focus on the main topics and concepts
2. Use single words or short phrases
3. Make them searchable and relevant
4. Avoid common words like "the", "and", etc.

Respond with a comma-separated list of tags, nothing else.
`;

      const response = await this.openai.chat.completions.create({
        model: this.chatModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting relevant keywords and tags from text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 100
      });

      const tags = response.choices[0].message.content
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0);

      return tags;

    } catch (error) {
      logger.error('Error extracting tags:', error);
      return [];
    }
  }

  /**
   * Check if the AI service is working properly
   */
  async healthCheck() {
    try {
      const testText = "How do I reset my password?";
      
      // Test embedding generation
      const embedding = await this.generateEmbedding(testText);
      
      // Test question detection
      const detection = await this.detectQuestions(testText);
      
      return {
        status: 'healthy',
        embeddingDimensions: embedding.length,
        questionDetection: detection.hasQuestions,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('AI service health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = AIService;