# FAQ Generation Fix Guide

## Problem Description

The FAQ generator was processing emails and finding questions (64 questions found from 50 emails) but failing to create FAQ groups (0 FAQ groups created). This document explains the root causes and provides solutions.

## Root Causes Identified

### 1. **Vector Extension Issues** (Most Likely)
- The similarity clustering relies on PostgreSQL's `pgvector` extension
- Uses vector operations like `<=>` for cosine similarity calculations
- If the extension isn't properly installed, clustering fails silently

### 2. **Similarity Threshold Too High**
- Default threshold of 0.8 may be too strict for real-world questions
- Questions need to be very similar to cluster together
- Results in many single-question clusters that get filtered out

### 3. **Missing Embeddings**
- Questions without embeddings can't be clustered
- AI service might fail to generate embeddings for some questions
- Database stores NULL embeddings which are excluded from processing

### 4. **Minimum Question Count Filter**
- Default requires 2+ questions per cluster to create an FAQ
- If questions don't cluster well, all clusters are filtered out
- Results in 0 FAQ groups despite having valid questions

## Solution Scripts

### 1. Debug Script
```bash
node scripts/debug-faq-generation.js
```
**Purpose**: Diagnoses the exact issue by checking:
- Question statistics (embeddings, confidence scores)
- Vector extension availability
- Clustering behavior
- FAQ generation process

### 2. Fix Script
```bash
node scripts/fix-faq-generation.js
```
**Purpose**: Automatically fixes common issues:
- Generates missing embeddings
- Creates fallback similarity functions
- Implements vector-safe similarity service
- Tests FAQ generation with optimized settings

### 3. Manual Generation Script
```bash
node scripts/manual-faq-generation.js
```
**Purpose**: Tests FAQ generation with different configurations:
- Permissive settings (single questions)
- Standard settings (paired questions)
- Force regeneration mode

## Step-by-Step Fix Process

### Step 1: Run Diagnostics
```bash
cd faq-generator
node scripts/debug-faq-generation.js
```

This will show you:
- How many questions have embeddings
- Whether the vector extension is working
- If clustering is successful
- Where the process is failing

### Step 2: Apply Fixes
```bash
node scripts/fix-faq-generation.js
```

This will:
- Generate missing embeddings for questions
- Create fallback similarity functions if vector extension is missing
- Update the similarity service to handle both vector and non-vector environments
- Test FAQ generation with optimized settings

### Step 3: Test Manual Generation
```bash
node scripts/manual-faq-generation.js
```

This will test different configurations and show you which settings work best for your data.

### Step 4: Verify in Application
After running the fixes, test the FAQ generation through your application interface or API endpoints.

## Configuration Adjustments

### Environment Variables
Add or adjust these in your `.env` file:

```env
# Lower similarity threshold for better clustering
SIMILARITY_THRESHOLD=0.6

# Lower confidence threshold if needed
QUESTION_CONFIDENCE_THRESHOLD=0.6

# Allow single-question FAQs for testing
FAQ_AUTO_PUBLISH_THRESHOLD=1

# Increase processing limits
CRON_MAX_FAQS_PER_RUN=100
```

### Database Settings
If you have database admin access, ensure the vector extension is installed:

```sql
-- Check if vector extension is available
SELECT * FROM pg_available_extensions WHERE name = 'vector';

-- Install vector extension (requires superuser)
CREATE EXTENSION IF NOT EXISTS vector;

-- Test vector operations
SELECT '[1,2,3]'::vector <=> '[1,2,4]'::vector;
```

## Troubleshooting Common Issues

### Issue: "operator does not exist: vector <=> vector"
**Solution**: Vector extension not installed. The fix script creates fallback functions automatically.

### Issue: "No questions available for FAQ generation"
**Causes**:
- Questions don't have embeddings
- Confidence scores too low
- Questions not marked as customer questions

**Solution**: Run the fix script to generate missing embeddings and check confidence thresholds.

### Issue: "Created 0 clusters from X questions"
**Causes**:
- Similarity threshold too high
- Questions are too different to cluster
- Vector similarity calculations failing

**Solution**: Lower the similarity threshold or allow single-question FAQs.

### Issue: "Created X clusters but 0 FAQ groups"
**Causes**:
- All clusters have fewer than minimum required questions
- FAQ creation process failing
- Database constraints preventing insertion

**Solution**: Lower `minQuestionCount` to 1 or check database logs for errors.

## Monitoring and Maintenance

### Regular Checks
1. **Monitor embedding generation**: Ensure new questions get embeddings
2. **Check similarity thresholds**: Adjust based on your data characteristics
3. **Review FAQ quality**: Ensure generated FAQs are meaningful
4. **Database performance**: Monitor vector index performance

### Automated Fixes
The fix script can be run periodically to:
- Generate missing embeddings
- Update similarity calculations
- Optimize clustering parameters

### Logging
Enable detailed logging to monitor the FAQ generation process:
```env
LOG_LEVEL=debug
```

## Performance Optimization

### For Large Datasets
- Process questions in batches
- Use appropriate vector indexes (HNSW or IVFFlat)
- Consider similarity threshold based on data size
- Implement caching for embeddings

### For Production
- Run FAQ generation during off-peak hours
- Monitor API rate limits for embedding generation
- Use connection pooling for database operations
- Implement proper error handling and retries

## Support

If issues persist after following this guide:

1. Check the application logs for detailed error messages
2. Run the debug script and share the output
3. Verify your OpenAI API key and rate limits
4. Ensure database permissions are correct
5. Consider the data quality and question diversity

The scripts provided should resolve most common issues with FAQ generation. The key is identifying whether the problem is with embeddings, vector operations, clustering, or FAQ creation logic.