# FAQ Generator

An AI-powered FAQ generation system that connects to business email accounts (Gmail and Outlook) to automatically extract customer questions and generate comprehensive FAQs using semantic similarity and machine learning.

## Features

### 🔗 Email Integration
- **Gmail API Integration**: Connect multiple Gmail accounts with OAuth 2.0
- **Outlook API Integration**: Connect multiple Outlook/Office 365 accounts
- **Incremental Sync**: Only fetch new emails since last synchronization
- **Multi-account Support**: Manage multiple email accounts per organization

### 🤖 AI-Powered Processing
- **Question Detection**: Advanced NLP to identify customer questions in emails
- **Semantic Similarity**: OpenAI embeddings for intelligent question grouping
- **Answer Extraction**: Automatically extract answers from email threads
- **Question Improvement**: AI-enhanced question text for better clarity

### 📊 FAQ Management
- **Automatic Generation**: Create FAQs from clustered similar questions
- **Frequency Ranking**: Order FAQs by question frequency and importance
- **Category Organization**: Automatic categorization of questions
- **Manual Editing**: Full CRUD operations for FAQ management
- **Bulk Operations**: Publish, unpublish, or delete multiple FAQs

### 🚀 Real-time Processing
- **Background Jobs**: Queue-based processing with Redis and Bull
- **Real-time Updates**: WebSocket notifications for processing status
- **Progress Tracking**: Live progress updates for long-running operations
- **Error Handling**: Comprehensive error tracking and recovery

### 🎨 User Interface
- **Step-by-Step Wizard**: Intuitive 3-step process for email connection and FAQ generation
- **Real-time Progress**: Live progress bars and status updates during processing
- **Beautiful Design**: Modern, responsive interface with smooth animations
- **Email Integration**: One-click OAuth authentication for Gmail and Outlook
- **FAQ Management**: Search, filter, edit, and export generated FAQs

### 📈 Analytics & Monitoring
- **Dashboard**: Comprehensive overview of system statistics
- **Processing Metrics**: Track email processing and FAQ generation
- **Health Monitoring**: System health checks and service status
- **Export Capabilities**: Export FAQs in JSON and CSV formats

## Technology Stack

### Frontend
- **React 18** with modern hooks and functional components
- **Tailwind CSS** for responsive, utility-first styling
- **Framer Motion** for smooth animations and transitions
- **Socket.IO Client** for real-time updates and notifications
- **React Toastify** for user-friendly notifications

### Backend
- **Node.js** with Express.js framework
- **PostgreSQL** with vector extensions for embeddings
- **Redis** for caching and job queues
- **Bull** for background job processing
- **Socket.IO** for real-time communications

### AI & ML
- **OpenAI API** for embeddings and text processing
- **Vector similarity search** using PostgreSQL pgvector
- **Hierarchical clustering** for question grouping
- **Natural language processing** for question detection

### Security
- **OAuth 2.0** for email account authentication
- **AES-256-GCM** encryption for sensitive data
- **Rate limiting** and request throttling
- **Input validation** and sanitization

### Deployment
- **Render.com** optimized deployment configuration
- **Docker** containerization support
- **Environment-based configuration**
- **Automated database migrations**

## Quick Start

### Prerequisites
- Node.js 18+ and npm 8+
- PostgreSQL 15+ with vector extension
- Redis 6+
- OpenAI API key
- Gmail and/or Outlook API credentials

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd faq-generator
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Run database migrations**
```bash
npm run migrate
```

5. **Start the development server**

For backend only:
```bash
npm run dev
```

For full-stack development (backend + frontend):
```bash
npm run dev:full
```

Or start them separately:
```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
npm run dev:client
```

The application will be available at:
- **Frontend**: http://localhost:3001 (React development server)
- **Backend API**: http://localhost:3000 (Express server)

The application will be available at `http://localhost:3000`

### Environment Configuration

Key environment variables to configure:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/faq_generator
REDIS_URL=redis://localhost:6379

# OpenAI
OPENAI_API_KEY=your-openai-api-key

# Gmail API
GMAIL_CLIENT_ID=your-gmail-client-id
GMAIL_CLIENT_SECRET=your-gmail-client-secret

# Outlook API
OUTLOOK_CLIENT_ID=your-outlook-client-id
OUTLOOK_CLIENT_SECRET=your-outlook-client-secret

# Security
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-32-character-encryption-key
```

## API Documentation

### Authentication Endpoints
- `GET /api/auth/gmail/url` - Get Gmail OAuth URL
- `GET /api/auth/gmail/callback` - Handle Gmail OAuth callback
- `GET /api/auth/outlook/url` - Get Outlook OAuth URL
- `GET /api/auth/outlook/callback` - Handle Outlook OAuth callback
- `GET /api/auth/status` - Get authentication status

### Account Management
- `GET /api/accounts` - List all email accounts
- `GET /api/accounts/:id` - Get account details
- `POST /api/accounts/:id/sync` - Sync account emails
- `DELETE /api/accounts/:id` - Delete account

### FAQ Management
- `GET /api/faqs` - List FAQs with pagination and filtering
- `GET /api/faqs/:id` - Get FAQ details
- `PUT /api/faqs/:id` - Update FAQ
- `DELETE /api/faqs/:id` - Delete FAQ
- `POST /api/faqs/search` - Search FAQs by similarity
- `POST /api/faqs/generate` - Generate new FAQs

### Dashboard & Analytics
- `GET /api/dashboard/stats` - Get system statistics
- `GET /api/dashboard/health` - System health check
- `POST /api/dashboard/sync-all` - Sync all accounts
- `POST /api/dashboard/generate-faqs` - Trigger FAQ generation

## Deployment

### Render.com Deployment

1. **Connect your repository** to Render.com

2. **Configure services** using the provided `render.yaml`:
   - Web service for the main application
   - Worker service for background processing
   - Cron service for scheduled tasks
   - PostgreSQL database
   - Redis instance

3. **Set environment variables** in Render dashboard

4. **Deploy** - Render will automatically build and deploy your application

### Manual Deployment

1. **Build the application**
```bash
npm run build
```

2. **Run database migrations**
```bash
npm run migrate
```

3. **Start the production server**
```bash
npm start
```

## Architecture

### System Overview
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Email APIs    │    │   Web Client    │    │   Admin Panel   │
│ (Gmail/Outlook) │    │                 │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express.js API Server                      │
├─────────────────────────────────────────────────────────────────┤
│  Auth Routes  │  Email Routes  │  FAQ Routes  │  Dashboard     │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Service Layer                              │
├─────────────────────────────────────────────────────────────────┤
│ EmailService │ AIService │ FAQService │ SimilarityService      │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Background Processing                        │
├─────────────────────────────────────────────────────────────────┤
│    Redis Queues    │    Bull Workers    │    Cron Jobs        │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                               │
├─────────────────────────────────────────────────────────────────┤
│   PostgreSQL DB    │    Redis Cache    │    Vector Storage    │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Email Synchronization**
   - OAuth authentication with email providers
   - Incremental email fetching
   - Storage in PostgreSQL with encryption

2. **Question Processing**
   - AI-powered question detection
   - Embedding generation using OpenAI
   - Vector storage for similarity search

3. **FAQ Generation**
   - Semantic clustering of similar questions
   - Answer consolidation and improvement
   - Automatic categorization and tagging

4. **Real-time Updates**
   - WebSocket notifications
   - Progress tracking
   - Status updates

## Configuration

### AI Processing Settings
- `SIMILARITY_THRESHOLD`: Minimum similarity for question grouping (default: 0.8)
- `QUESTION_CONFIDENCE_THRESHOLD`: Minimum confidence for question extraction (default: 0.7)
- `MIN_QUESTION_LENGTH`: Minimum question length (default: 10)
- `MAX_QUESTION_LENGTH`: Maximum question length (default: 500)

### Performance Settings
- `MAX_EMAILS_PER_SYNC`: Maximum emails per sync operation (default: 1000)
- `JOB_CONCURRENCY`: Background job concurrency (default: 5)
- `RATE_LIMIT_MAX_REQUESTS`: API rate limit (default: 100 per 15 minutes)

### Security Settings
- `JWT_SECRET`: Secret for JWT token signing
- `ENCRYPTION_KEY`: 32-character key for data encryption
- `SESSION_SECRET`: Secret for session management

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow ESLint configuration
- Write tests for new features
- Update documentation
- Use conventional commit messages

## Monitoring & Troubleshooting

### Health Checks
- `/api/health` - Overall system health
- `/api/dashboard/health` - Detailed service status

### Logging
- Structured logging with Winston
- Log levels: error, warn, info, debug
- Separate log files for errors and combined logs

### Common Issues
1. **Email sync failures**: Check OAuth token expiration
2. **AI processing errors**: Verify OpenAI API key and quotas
3. **Database connection issues**: Check PostgreSQL connection and vector extension
4. **Redis connection problems**: Verify Redis server status

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Create an issue in the GitHub repository
- Check the troubleshooting section in the documentation
- Review the API documentation for integration help

---

Built with ❤️ using Node.js, PostgreSQL, Redis, and OpenAI