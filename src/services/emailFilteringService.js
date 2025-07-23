const db = require('../config/database');
const logger = require('../utils/logger');

class EmailFilteringService {
  constructor() {
    // Common patterns for business/automated emails to exclude
    this.businessEmailPatterns = [
      /^(info|support|sales|admin|noreply|no-reply|donotreply|do-not-reply|notifications?|alerts?|system|automated|mailer-daemon|postmaster)@/i,
      /@(noreply|no-reply|donotreply|notifications?)\./i,
      /^.+\+.+@/i, // Plus addressing (e.g., user+tag@domain.com)
    ];

    // Common spam/promotional indicators
    this.spamIndicators = [
      /unsubscribe/i,
      /click here to view/i,
      /this email was sent to/i,
      /update your preferences/i,
      /promotional offer/i,
      /limited time offer/i,
      /act now/i,
      /free gift/i,
      /congratulations you've won/i,
      /verify your account/i,
      /suspended account/i,
    ];

    // Automated email headers/footers
    this.automatedFooterPatterns = [
      /this is an automated message/i,
      /please do not reply to this email/i,
      /this email was sent automatically/i,
      /sent from my (iphone|android|mobile)/i,
      /^sent from /im,
    ];
  }

  /**
   * Check if an email qualifies for FAQ processing
   * @param {Object} email - Email object from database
   * @param {Array} connectedAccounts - List of connected email accounts
   * @returns {Object} { qualifies: boolean, reason: string, confidence: number }
   */
  async doesEmailQualifyForFAQ(email, connectedAccounts) {
    try {
      const checks = {
        isFromCustomer: false,
        hasResponse: false,
        isNotSpam: true,
        isNotAutomated: true,
        threadAnalysis: null
      };

      // 1. Check if email is FROM a customer (not from connected accounts)
      const connectedEmails = connectedAccounts.map(acc => acc.email_address.toLowerCase());
      const senderEmail = (email.sender_email || '').toLowerCase();
      
      checks.isFromCustomer = !connectedEmails.includes(senderEmail);
      
      if (!checks.isFromCustomer) {
        return {
          qualifies: false,
          reason: 'Email is from a connected account, not a customer',
          confidence: 1.0,
          checks
        };
      }

      // 2. Check if it's not a business/automated email
      checks.isNotAutomated = !this.isAutomatedEmail(email);
      
      if (!checks.isNotAutomated) {
        return {
          qualifies: false,
          reason: 'Email appears to be automated or from a business system',
          confidence: 0.9,
          checks
        };
      }

      // 3. Check if it's not spam
      checks.isNotSpam = !this.isSpamEmail(email);
      
      if (!checks.isNotSpam) {
        return {
          qualifies: false,
          reason: 'Email appears to be spam or promotional',
          confidence: 0.8,
          checks
        };
      }

      // 4. Check if the email has a response from connected accounts
      const threadAnalysis = await this.analyzeEmailThread(email, connectedAccounts);
      checks.threadAnalysis = threadAnalysis;
      checks.hasResponse = threadAnalysis.hasResponseFromBusiness;

      if (!checks.hasResponse) {
        return {
          qualifies: false,
          reason: 'Email has not been responded to by any connected account',
          confidence: 0.95,
          checks
        };
      }

      // 5. Additional quality checks
      const qualityScore = this.assessEmailQuality(email);
      
      if (qualityScore < 0.5) {
        return {
          qualifies: false,
          reason: 'Email quality too low for FAQ generation',
          confidence: qualityScore,
          checks
        };
      }

      // Email qualifies!
      return {
        qualifies: true,
        reason: 'Email meets all criteria for FAQ processing',
        confidence: qualityScore,
        checks
      };

    } catch (error) {
      logger.error('Error checking email qualification:', error);
      return {
        qualifies: false,
        reason: 'Error during qualification check',
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * Check if email is automated/business email
   */
  isAutomatedEmail(email) {
    const senderEmail = (email.sender_email || '').toLowerCase();
    const bodyText = (email.body_text || '').toLowerCase();
    const subject = (email.subject || '').toLowerCase();

    // Check sender email patterns
    for (const pattern of this.businessEmailPatterns) {
      if (pattern.test(senderEmail)) {
        logger.debug(`Email from ${senderEmail} matches business pattern: ${pattern}`);
        return true;
      }
    }

    // Check for automated footers
    for (const pattern of this.automatedFooterPatterns) {
      if (pattern.test(bodyText)) {
        logger.debug(`Email contains automated footer pattern: ${pattern}`);
        return true;
      }
    }

    // Check if subject indicates automation
    const automatedSubjectPatterns = [
      /^auto:/i,
      /^automatic reply/i,
      /^out of office/i,
      /^delivery status notification/i,
      /^undeliverable/i,
      /^failure notice/i,
    ];

    for (const pattern of automatedSubjectPatterns) {
      if (pattern.test(subject)) {
        logger.debug(`Email subject matches automated pattern: ${pattern}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Check if email is spam/promotional
   */
  isSpamEmail(email) {
    const bodyText = (email.body_text || '').toLowerCase();
    const subject = (email.subject || '').toLowerCase();
    const fullText = `${subject} ${bodyText}`;

    let spamScore = 0;
    let maxScore = this.spamIndicators.length;

    for (const pattern of this.spamIndicators) {
      if (pattern.test(fullText)) {
        spamScore++;
        logger.debug(`Email matches spam pattern: ${pattern}`);
      }
    }

    // If more than 30% of spam indicators are present, consider it spam
    const spamRatio = spamScore / maxScore;
    return spamRatio > 0.3;
  }

  /**
   * Analyze email thread to check for responses
   */
  async analyzeEmailThread(email, connectedAccounts) {
    try {
      if (!email.thread_id) {
        // No thread ID, check if there are any responses to this specific email
        return await this.checkDirectResponses(email, connectedAccounts);
      }

      // Get all emails in the thread
      const threadQuery = `
        SELECT 
          id, sender_email, recipient_emails, cc_emails, 
          received_at, subject, body_text,
          CASE 
            WHEN sender_email = ANY($2::text[]) THEN 'outbound'
            ELSE 'inbound'
          END as direction
        FROM emails
        WHERE thread_id = $1
        ORDER BY received_at ASC
      `;

      const connectedEmails = connectedAccounts.map(acc => acc.email_address.toLowerCase());
      const result = await db.query(threadQuery, [email.thread_id, connectedEmails]);
      const threadEmails = result.rows;

      // Analyze the thread
      const analysis = {
        totalEmails: threadEmails.length,
        customerEmails: 0,
        businessResponses: 0,
        hasResponseFromBusiness: false,
        lastBusinessResponse: null,
        conversationFlow: []
      };

      let foundTargetEmail = false;
      let hasSubsequentBusinessResponse = false;

      for (const threadEmail of threadEmails) {
        const isFromBusiness = threadEmail.direction === 'outbound';
        
        if (threadEmail.id === email.id) {
          foundTargetEmail = true;
        }

        if (isFromBusiness) {
          analysis.businessResponses++;
          analysis.lastBusinessResponse = threadEmail;
          
          if (foundTargetEmail) {
            hasSubsequentBusinessResponse = true;
          }
        } else {
          analysis.customerEmails++;
        }

        analysis.conversationFlow.push({
          id: threadEmail.id,
          direction: threadEmail.direction,
          sender: threadEmail.sender_email,
          timestamp: threadEmail.received_at,
          isTargetEmail: threadEmail.id === email.id
        });
      }

      analysis.hasResponseFromBusiness = hasSubsequentBusinessResponse;

      logger.info(`Thread analysis for email ${email.id}:`, {
        threadId: email.thread_id,
        totalEmails: analysis.totalEmails,
        customerEmails: analysis.customerEmails,
        businessResponses: analysis.businessResponses,
        hasResponse: analysis.hasResponseFromBusiness
      });

      return analysis;

    } catch (error) {
      logger.error('Error analyzing email thread:', error);
      return {
        totalEmails: 1,
        customerEmails: 1,
        businessResponses: 0,
        hasResponseFromBusiness: false,
        error: error.message
      };
    }
  }

  /**
   * Check for direct responses when no thread ID is available
   */
  async checkDirectResponses(email, connectedAccounts) {
    try {
      const connectedEmails = connectedAccounts.map(acc => acc.email_address.toLowerCase());
      
      // Look for emails that might be responses based on subject and timing
      const responseQuery = `
        SELECT 
          id, sender_email, subject, received_at
        FROM emails
        WHERE 
          sender_email = ANY($1::text[])
          AND (
            subject ILIKE '%re:%' || $2 || '%'
            OR subject ILIKE '%reply:%' || $2 || '%'
            OR subject = $2
          )
          AND received_at > $3
          AND (
            $4 = ANY(recipient_emails)
            OR $4 = ANY(cc_emails)
          )
        ORDER BY received_at ASC
        LIMIT 5
      `;

      const emailSubject = (email.subject || '').replace(/^(re:|fwd:|reply:)\s*/i, '').trim();
      const result = await db.query(responseQuery, [
        connectedEmails,
        emailSubject,
        email.received_at,
        email.sender_email
      ]);

      const hasResponse = result.rows.length > 0;

      return {
        totalEmails: 1 + result.rows.length,
        customerEmails: 1,
        businessResponses: result.rows.length,
        hasResponseFromBusiness: hasResponse,
        lastBusinessResponse: hasResponse ? result.rows[0] : null,
        conversationFlow: [
          {
            id: email.id,
            direction: 'inbound',
            sender: email.sender_email,
            timestamp: email.received_at,
            isTargetEmail: true
          },
          ...result.rows.map(r => ({
            id: r.id,
            direction: 'outbound',
            sender: r.sender_email,
            timestamp: r.received_at,
            isTargetEmail: false
          }))
        ]
      };

    } catch (error) {
      logger.error('Error checking direct responses:', error);
      return {
        totalEmails: 1,
        customerEmails: 1,
        businessResponses: 0,
        hasResponseFromBusiness: false,
        error: error.message
      };
    }
  }

  /**
   * Assess overall email quality for FAQ generation
   */
  assessEmailQuality(email) {
    let qualityScore = 1.0;
    const bodyText = email.body_text || '';
    const subject = email.subject || '';

    // Check content length
    if (bodyText.length < 50) {
      qualityScore *= 0.5; // Too short
    } else if (bodyText.length > 10000) {
      qualityScore *= 0.8; // Too long
    }

    // Check if it has a meaningful subject
    if (!subject || subject.length < 5) {
      qualityScore *= 0.7;
    }

    // Check for excessive formatting/HTML remnants
    const htmlRemnants = /<[^>]+>|&[a-z]+;/gi;
    const htmlMatches = bodyText.match(htmlRemnants);
    if (htmlMatches && htmlMatches.length > 20) {
      qualityScore *= 0.8; // Too much HTML noise
    }

    // Check for repeated characters (spam indicator)
    const repeatedChars = /(.)\1{5,}/g;
    if (repeatedChars.test(bodyText)) {
      qualityScore *= 0.6;
    }

    // Check for ALL CAPS (spam/low quality indicator)
    const words = bodyText.split(/\s+/);
    const capsWords = words.filter(w => w.length > 3 && w === w.toUpperCase());
    if (capsWords.length / words.length > 0.3) {
      qualityScore *= 0.7;
    }

    return Math.max(0, Math.min(1, qualityScore));
  }

  /**
   * Get statistics about email filtering
   */
  async getFilteringStats(startDate = null, endDate = null) {
    try {
      let dateFilter = '';
      const params = [];
      
      if (startDate) {
        params.push(startDate);
        dateFilter += ` AND e.received_at >= $${params.length}`;
      }
      
      if (endDate) {
        params.push(endDate);
        dateFilter += ` AND e.received_at <= $${params.length}`;
      }

      const statsQuery = `
        SELECT 
          COUNT(*) as total_emails,
          COUNT(CASE WHEN e.processed_for_faq = true THEN 1 END) as processed_emails,
          COUNT(CASE WHEN q.id IS NOT NULL THEN 1 END) as emails_with_questions,
          COUNT(DISTINCT e.sender_email) as unique_senders,
          COUNT(DISTINCT e.thread_id) as unique_threads
        FROM emails e
        LEFT JOIN questions q ON q.email_id = e.id
        WHERE 1=1 ${dateFilter}
      `;

      const result = await db.query(statsQuery, params);
      return result.rows[0];

    } catch (error) {
      logger.error('Error getting filtering stats:', error);
      throw error;
    }
  }

  /**
   * Batch process emails for qualification
   */
  async batchQualifyEmails(emails, connectedAccounts) {
    const results = [];
    
    for (const email of emails) {
      const qualification = await this.doesEmailQualifyForFAQ(email, connectedAccounts);
      results.push({
        emailId: email.id,
        subject: email.subject,
        sender: email.sender_email,
        ...qualification
      });
    }

    const summary = {
      total: results.length,
      qualified: results.filter(r => r.qualifies).length,
      disqualified: results.filter(r => !r.qualifies).length,
      reasons: {}
    };

    // Count disqualification reasons
    results.filter(r => !r.qualifies).forEach(r => {
      summary.reasons[r.reason] = (summary.reasons[r.reason] || 0) + 1;
    });

    return {
      results,
      summary
    };
  }
}

module.exports = EmailFilteringService;