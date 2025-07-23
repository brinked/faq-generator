# Email Filtering Improvements for FAQ Generator

## Overview

This document describes the enhanced email filtering system implemented to ensure only genuine customer emails with responses are processed for FAQ generation.

## Key Requirements

1. **Customer Emails Only**: Only process emails FROM customers, not from connected business accounts
2. **Response Required**: Only process emails that have received a response from connected accounts
3. **Spam/Automation Filtering**: Filter out spam, promotional, and automated emails
4. **Thread Analysis**: Analyze email threads to understand conversation flow

## Implementation Details

### 1. Email Filtering Service (`src/services/emailFilteringService.js`)

The new `EmailFilteringService` class provides comprehensive email filtering with the following checks:

#### Customer Email Validation
- Verifies sender is NOT from any connected business account
- Ensures email is genuinely from a customer

#### Automated Email Detection
- Filters emails from common automated addresses (noreply@, support@, etc.)
- Detects automated footers and headers
- Identifies auto-reply and out-of-office messages

#### Spam Detection
- Identifies promotional content
- Detects common spam patterns
- Filters emails with excessive formatting or suspicious content

#### Response Requirement
- Analyzes email threads to check for business responses
- Uses thread_id when available for accurate thread tracking
- Falls back to subject-based matching when thread_id is missing
- Only qualifies emails that have been responded to

### 2. Integration Points

#### Email Service (`src/services/emailService.js`)
- Modified `getEmailsForProcessing()` to use the filtering service
- Filters emails before returning them for processing
- Provides qualification metadata with each email

#### AI Service (`src/services/aiService.js`)
- Enhanced `detectQuestions()` to accept email metadata
- Considers response status when extracting questions
- Improved prompts to focus on customer questions with responses

#### Queue Service (`src/services/queueService.js`)
- Integrated filtering in the email processing pipeline
- Tracks qualified vs disqualified emails
- Only processes emails that pass all filtering criteria

### 3. Email Qualification Process

```javascript
// Example qualification check
const qualification = await filteringService.doesEmailQualifyForFAQ(email, connectedAccounts);

// Result structure:
{
  qualifies: boolean,
  reason: string,
  confidence: number,
  checks: {
    isFromCustomer: boolean,
    hasResponse: boolean,
    isNotSpam: boolean,
    isNotAutomated: boolean,
    threadAnalysis: object
  }
}
```

### 4. Thread Analysis

The system performs comprehensive thread analysis to:
- Track conversation flow
- Identify which emails are from customers vs business
- Determine if a customer email has been responded to
- Build context for better question extraction

## Usage

### Processing Emails

```javascript
const emailService = new EmailService();
const emails = await emailService.getEmailsForProcessing();
// Returns only emails that qualify for FAQ processing
```

### Manual Filtering Check

```javascript
const filteringService = new EmailFilteringService();
const connectedAccounts = await emailService.getAccounts();
const qualification = await filteringService.doesEmailQualifyForFAQ(email, connectedAccounts);

if (qualification.qualifies) {
  // Process for FAQ
} else {
  console.log(`Email disqualified: ${qualification.reason}`);
}
```

## Configuration

The filtering system uses several environment variables for fine-tuning:

- `QUESTION_CONFIDENCE_THRESHOLD`: Minimum confidence score for questions (default: 0.7)
- `MIN_QUESTION_LENGTH`: Minimum question length (default: 10)
- `MAX_QUESTION_LENGTH`: Maximum question length (default: 500)

## Benefits

1. **Higher Quality FAQs**: Only genuine customer questions are processed
2. **Reduced Noise**: Spam and automated emails are filtered out
3. **Better Context**: Thread analysis provides conversation context
4. **Efficiency**: Fewer irrelevant emails to process
5. **Accuracy**: Only questions that received responses are included

## Future Enhancements

1. **Machine Learning**: Train models to better identify customer emails
2. **Custom Rules**: Allow configuration of custom filtering rules
3. **Analytics**: Track filtering statistics and effectiveness
4. **Multi-language**: Support for filtering in multiple languages

## Deployment

To deploy these changes:

1. Ensure all modified files are uploaded to your server
2. Restart the application to load the new filtering service
3. Monitor logs to verify filtering is working correctly
4. Check FAQ generation quality improvements

## Monitoring

Monitor the following metrics:
- Total emails processed
- Emails qualified for FAQ
- Emails disqualified (by reason)
- FAQ quality scores

Use the `getFilteringStats()` method to get filtering statistics:

```javascript
const stats = await filteringService.getFilteringStats(startDate, endDate);