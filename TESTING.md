# Testing Guide

This document provides comprehensive information about the testing suite for the FAQ Generator application.

## Overview

The testing suite includes:
- **Unit Tests**: Testing individual components and services
- **Integration Tests**: Testing complete workflows and component interactions
- **API Tests**: Testing REST API endpoints and HTTP responses
- **Coverage Reports**: Code coverage analysis and reporting

## Test Structure

```
tests/
├── setup.js                    # Test environment setup and utilities
├── services/                   # Unit tests for services
│   ├── aiService.test.js       # AI/NLP service tests
│   ├── similarityService.test.js # Vector similarity tests
│   └── faqService.test.js      # FAQ management tests
├── routes/                     # API endpoint tests
│   └── api.test.js            # REST API integration tests
├── integration/                # End-to-end workflow tests
│   └── workflow.test.js       # Complete FAQ generation workflow
└── utils/                     # Testing utilities
    └── testRunner.js          # Custom test runner with reporting
```

## Running Tests

### Prerequisites

1. **Test Database**: Set up a separate test database
```bash
# Create test database
createdb faq_generator_test

# Set test environment variables
export TEST_DB_NAME=faq_generator_test
export TEST_DB_HOST=localhost
export TEST_DB_PORT=5432
export TEST_DB_USER=postgres
export TEST_DB_PASSWORD=your_password
```

2. **Test Redis**: Configure test Redis instance
```bash
# Set test Redis environment variables
export TEST_REDIS_HOST=localhost
export TEST_REDIS_PORT=6379
export TEST_REDIS_PASSWORD=your_password
```

### Test Commands

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run specific test file
npx mocha tests/services/aiService.test.js

# Run tests with custom test runner
node tests/utils/testRunner.js all
node tests/utils/testRunner.js watch
node tests/utils/testRunner.js file tests/services/aiService.test.js
```

## Test Categories

### 1. Unit Tests

#### AI Service Tests (`tests/services/aiService.test.js`)
- Question detection from email content
- Text embedding generation
- FAQ answer generation
- Question categorization
- Answer improvement
- Question quality validation

#### Similarity Service Tests (`tests/services/similarityService.test.js`)
- Cosine similarity calculations
- Vector similarity search
- Question clustering algorithms
- Duplicate question detection
- Cluster centroid calculations

#### FAQ Service Tests (`tests/services/faqService.test.js`)
- FAQ CRUD operations
- FAQ generation from questions
- Category-based filtering
- Priority management
- Status toggling
- Statistics generation

### 2. API Tests

#### REST API Tests (`tests/routes/api.test.js`)
- Dashboard statistics endpoints
- Account management APIs
- FAQ management endpoints
- Email processing APIs
- Export functionality
- Error handling
- Rate limiting
- Authentication

### 3. Integration Tests

#### Workflow Tests (`tests/integration/workflow.test.js`)
- Complete email-to-FAQ workflow
- Multi-category processing
- Quality filtering
- Queue processing
- Error handling scenarios

## Test Utilities

### Test Setup (`tests/setup.js`)
Provides utilities for:
- Test database setup and cleanup
- Test Redis configuration
- Mock data generation
- Test data insertion helpers

### Test Runner (`tests/utils/testRunner.js`)
Custom test runner with:
- Comprehensive test suite execution
- Coverage report generation
- Test result summarization
- Watch mode support
- Specific test file execution

## Mock Data

The test suite uses comprehensive mock data:

```javascript
// Mock email account
{
  email: 'test@example.com',
  provider: 'gmail',
  display_name: 'Test Account',
  is_active: true,
  sync_enabled: true
}

// Mock email
{
  subject: 'Test Email Subject',
  sender: 'user@example.com',
  body: 'Email content with questions',
  received_date: new Date()
}

// Mock question
{
  question_text: 'How do I reset my password?',
  confidence_score: 0.85,
  category: 'account',
  embedding: [/* 1536-dimensional vector */]
}

// Mock FAQ
{
  question: 'How do I reset my password?',
  answer: 'To reset your password, follow these steps...',
  category: 'account',
  priority: 1,
  is_active: true
}
```

## Testing Best Practices

### 1. Test Isolation
- Each test is independent and can run in any order
- Database is cleaned between test suites
- Redis cache is flushed for each test group

### 2. Mocking External Services
- OpenAI API calls are mocked for consistent testing
- Email provider APIs (Gmail/Outlook) are stubbed
- Network requests are intercepted and mocked

### 3. Error Handling
- Tests cover both success and failure scenarios
- Network failures and API errors are simulated
- Database connection issues are tested

### 4. Performance Testing
- Tests include timeout configurations
- Large dataset processing is validated
- Memory usage is monitored

## Coverage Requirements

The project maintains high code coverage standards:

```json
{
  "lines": 80,
  "functions": 80,
  "branches": 80,
  "statements": 80
}
```

### Coverage Reports

Coverage reports are generated in multiple formats:
- **Text**: Console output during test runs
- **HTML**: Detailed browser-viewable reports in `coverage/` directory
- **LCOV**: Machine-readable format for CI/CD integration

## Continuous Integration

### GitHub Actions Integration

```yaml
# Example CI configuration
- name: Run Tests
  run: |
    npm install
    npm run migrate
    npm run test:coverage
    
- name: Upload Coverage
  uses: codecov/codecov-action@v1
  with:
    file: ./coverage/lcov.info
```

### Pre-commit Hooks

```bash
# Install pre-commit hooks
npm install husky --save-dev

# Add to package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "npm run lint && npm test"
    }
  }
}
```

## Debugging Tests

### Common Issues

1. **Database Connection Errors**
   - Ensure test database exists and is accessible
   - Check environment variables
   - Verify PostgreSQL is running

2. **Redis Connection Errors**
   - Ensure Redis server is running
   - Check Redis configuration
   - Verify network connectivity

3. **Timeout Errors**
   - Increase timeout in `.mocharc.json`
   - Check for infinite loops or blocking operations
   - Optimize test data size

### Debug Mode

```bash
# Run tests with debug output
DEBUG=* npm test

# Run specific test with debugging
DEBUG=faq-generator:* npx mocha tests/services/aiService.test.js
```

## Performance Benchmarks

### Expected Test Performance
- Unit tests: < 100ms per test
- Integration tests: < 2000ms per test
- Full test suite: < 30 seconds
- Coverage generation: < 60 seconds

### Optimization Tips
- Use `beforeEach` and `afterEach` for setup/cleanup
- Minimize database operations in tests
- Use transaction rollbacks for faster cleanup
- Cache mock data between tests

## Contributing to Tests

### Adding New Tests

1. **Create test file** in appropriate directory
2. **Follow naming convention**: `*.test.js`
3. **Include proper setup/teardown**
4. **Add comprehensive test cases**
5. **Update this documentation**

### Test Writing Guidelines

```javascript
describe('Service Name', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('method name', () => {
    it('should handle normal case', async () => {
      // Test implementation
    });

    it('should handle edge case', async () => {
      // Test implementation
    });

    it('should handle error case', async () => {
      // Test implementation
    });
  });
});
```

## Troubleshooting

### Common Test Failures

1. **Async/Await Issues**
   - Ensure all async operations are properly awaited
   - Use proper error handling with try/catch

2. **Mock/Stub Problems**
   - Verify mocks are restored after each test
   - Check mock call expectations

3. **Database State Issues**
   - Ensure proper cleanup between tests
   - Use transactions for test isolation

### Getting Help

- Check test output for specific error messages
- Review test logs in `logs/test.log`
- Use debug mode for detailed execution traces
- Consult the main README.md for setup issues

## Future Enhancements

- **Load Testing**: Add performance tests for high-volume scenarios
- **Security Testing**: Include security vulnerability tests
- **Browser Testing**: Add frontend testing with Selenium/Puppeteer
- **API Documentation Testing**: Validate OpenAPI specifications
- **Database Migration Testing**: Test schema changes and rollbacks