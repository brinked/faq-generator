const { Configuration, OpenAIApi } = require('openai');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');

class AIService {
  constructor() {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.openai = new OpenAIApi(configuration);
    
    this.embeddingModel = process.env.OPENAI_MODEL || 'text-embedding-ada-002';
    this.chatModel = 'gpt-3.5-turbo';
    
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
   * Detect if an email contains customer questions using AI - enhanced for conversation context
   */
  async detectQuestions(emailText, emailSubject = '', threadEmails = []) {
    try {
      const fullText = `Subject: ${emailSubject}\n\nBody: ${emailText}`;
      
      // Enhanced pattern-based check for customer service conversations
      const hasQuestionPatterns = this.questionPatterns.some(pattern => pattern.test(fullText));
      const hasCustomerContext = this.customerContextPatterns.some(pattern => pattern.test(fullText));
      
      // Check for conversation indicators
      const conversationIndicators = [
        /\b(re:|fwd:|reply|response|follow.?up)\b/gi,
        /\b(previous|earlier|last|original)\s+(email|message|conversation)\b/gi,
        /\b(as\s+discussed|as\s+mentioned|per\s+our)\b/gi
      ];
      const hasConversationContext = conversationIndicators.some(pattern => pattern.test(fullText));
      
      // If no indicators of customer service content, skip
      if (!hasQuestionPatterns && !hasCustomerContext && !hasConversationContext) {
        return {
          hasQuestions: false,
          questions: [],
          confidence: 0.1,
          reasoning: 'No question patterns, customer context, or conversation indicators detected'
        };
      }

      // Build conversation context if thread emails are provided
      let conversationContext = '';
      if (threadEmails && threadEmails.length > 0) {
        conversationContext = '\n\nConversation Thread Context:\n';
        threadEmails.slice(-3).forEach((email, index) => { // Last 3 emails for context
          conversationContext += `Email ${index + 1} (${email.sender_email}): ${email.subject}\n${email.body_text?.substring(0, 500) || ''}...\n\n`;
        });
      }

      // Use AI for more sophisticated detection with conversation context
      const prompt = `
Analyze the following email and identify any customer questions that would be suitable for a FAQ. This email is part of a customer service conversation.

Email:
${fullText}
${conversationContext}

Instructions:
1. ONLY extract questions from CUSTOMERS, not from business/company representatives
2. Focus on genuine customer questions that would be commonly asked by other customers
3. Extract the exact question text as it appears in the email
4. If there's a corresponding answer in this email or the conversation thread, extract that too
5. Prioritize questions about products, services, policies, procedures, or common issues
6. IGNORE completely:
   - Questions FROM business emails (like info@, support@, sales@, admin@, etc.)
   - Internal questions between staff
   - Business-to-customer questions (like "What's your address?", "When do you need this?")
   - Scheduling or appointment-specific requests
   - Very personal or account-specific details
   - Spam or promotional content
   - Questions already fully answered in the same email
7. Rate your confidence (0-1) for each question based on its FAQ suitability
8. Consider the conversation context to better understand if this is a customer asking a business

Respond in JSON format:
{
  "hasQuestions": boolean,
  "questions": [
    {
      "question": "exact question text",
      "answer": "answer if found in email thread, or null",
      "confidence": 0.0-1.0,
      "context": "surrounding context for the question",
      "category": "suggested category (e.g., billing, technical, general)",
      "isFromCustomer": true
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
            content: 'You are an expert at analyzing customer service email conversations to identify frequently asked questions. Focus on questions that would be valuable for a FAQ section and help other customers with similar issues.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 1200
      });

      // Use v3 API response format with error handling
      let content = response.data.choices[0].message.content.trim();
      
      // Log the raw content for debugging
      logger.debug('Raw AI response content:', content.substring(0, 200) + '...');
      
      // Remove markdown code block markers if present
      if (content.startsWith('```json')) {
        content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (content.startsWith('```')) {
        content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      // Additional cleanup for common AI response issues
      content = content.replace(/^[^{]*({.*})[^}]*$/s, '$1'); // Extract JSON object
      content = content.trim();
      
      let result;
      try {
        result = JSON.parse(content);
      } catch (parseError) {
        logger.error('JSON parse error in AI response:', {
          error: parseError.message,
          content: content.substring(0, 500),
          fullContent: content
        });
        
        // Try to extract JSON from the content more aggressively
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            result = JSON.parse(jsonMatch[0]);
            logger.info('Successfully recovered JSON from malformed response');
          } catch (secondParseError) {
            logger.error('Failed to recover JSON:', secondParseError.message);
            throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
          }
        } else {
          throw new Error(`No valid JSON found in AI response: ${content.substring(0, 200)}`);
        }
      }
      
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

      const response = await this.openai.createChatCompletion({
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

      return response.data.choices[0].message.content.trim();

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

      const response = await this.openai.createChatCompletion({
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

      return response.data.choices[0].message.content.trim();

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

      const response = await this.openai.createChatCompletion({
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

      return response.data.choices[0].message.content.trim();

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

      const response = await this.openai.createChatCompletion({
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

      const tags = response.data.choices[0].message.content
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