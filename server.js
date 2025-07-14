const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const logger = require('./src/utils/logger');
const db = require('./src/config/database');
const redisClient = require('./src/config/redis');
const authRoutes = require('./src/routes/auth');
const emailRoutes = require('./src/routes/emails');
const faqRoutes = require('./src/routes/faqs');
const accountRoutes = require('./src/routes/accounts');
const dashboardRoutes = require('./src/routes/dashboard');
const exportRoutes = require('./src/routes/export');
const debugOAuthRoutes = require('./src/routes/debug-oauth');
const { initializeQueues } = require('./src/services/queueService');
const { startScheduledJobs } = require('./src/services/schedulerService');

const app = express();
const server = http.createServer(app);

// Dynamic CORS origin configuration
const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const corsOrigin = process.env.CORS_ORIGIN || baseUrl;

// Log warning if BASE_URL is not set in production
if (process.env.NODE_ENV === 'production' && !process.env.BASE_URL) {
  console.warn('WARNING: BASE_URL environment variable not set in production. OAuth redirects may fail.');
}

const io = socketIo(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Compression and parsing middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  // Enhanced logging for OAuth callbacks
  if (req.path.includes('/auth/gmail/callback') || req.path.includes('/auth/outlook/callback')) {
    logger.info(`OAuth callback request: ${req.method} ${req.path}`, {
      query: req.query,
      headers: req.headers,
      ip: req.ip
    });
  } else {
    logger.info(`${req.method} ${req.path} - ${req.ip}`);
  }
  next();
});

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API Routes - IMPORTANT: These must be defined before static file serving
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);

// Debug routes (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug/oauth', debugOAuthRoutes);
  logger.info('OAuth debug routes enabled at /api/debug/oauth');
}

// Log any requests to OAuth callback URLs for debugging
app.use((req, res, next) => {
  if (req.path === '/api/auth/gmail/callback' || req.path === '/api/auth/outlook/callback') {
    logger.warn(`OAuth callback reached middleware: ${req.path}`, {
      query: req.query,
      method: req.method
    });
  }
  next();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');
    
    // Check Redis connection
    await redisClient.ping();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected'
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Serve static files in production (if client build exists)
const clientBuildPath = path.join(__dirname, 'client/build');
const fs = require('fs');

if (process.env.NODE_ENV === 'production' && fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  
  // API root endpoint for production
  app.get('/api', (req, res) => {
    res.json({
      name: 'FAQ Generator API',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: '/api/health',
        auth: '/api/auth',
        accounts: '/api/accounts',
        emails: '/api/emails',
        faqs: '/api/faqs',
        dashboard: '/api/dashboard',
        export: '/api/export'
      },
      documentation: 'https://github.com/brinked/faq-generator'
    });
  });
  
  // Serve React app for all non-API routes
  app.get('*', (req, res) => {
    // Log any unmatched routes for debugging
    if (req.path.startsWith('/api/')) {
      logger.warn(`Unmatched API route: ${req.method} ${req.path}`);
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  // Development mode - API root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'FAQ Generator API',
      version: '1.0.0',
      status: 'running',
      mode: 'development',
      endpoints: {
        health: '/api/health',
        auth: '/api/auth',
        accounts: '/api/accounts',
        emails: '/api/emails',
        faqs: '/api/faqs',
        dashboard: '/api/dashboard',
        export: '/api/export'
      },
      frontend: 'Run `npm run dev` in the client directory to start the React development server',
      documentation: 'https://github.com/brinked/faq-generator'
    });
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.details
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found'
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('join-room', (room) => {
    socket.join(room);
    logger.info(`Client ${socket.id} joined room: ${room}`);
  });
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Initialize services
async function initializeApp() {
  try {
    // Initialize database connection
    await db.connect();
    logger.info('Database connected successfully');
    
    // Initialize Redis connection
    await redisClient.connect();
    logger.info('Redis connected successfully');
    
    // Initialize background job queues
    await initializeQueues();
    logger.info('Job queues initialized');
    
    // Start scheduled jobs
    startScheduledJobs();
    logger.info('Scheduled jobs started');
    
    // Start server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });
    
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  try {
    await db.end();
    await redisClient.quit();
    logger.info('Database and Redis connections closed');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  try {
    await db.end();
    await redisClient.quit();
    logger.info('Database and Redis connections closed');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Initialize the application
initializeApp();

module.exports = { app, server, io };