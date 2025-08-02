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
const publicFaqRoutes = require('./src/routes/public-faqs');
const adminFaqRoutes = require('./src/routes/admin-faqs');
const emailRoutes = require('./src/routes/emails');
const faqRoutes = require('./src/routes/faqs');
const faqSourcesRoutes = require('./src/routes/faq-sources');
const accountRoutes = require('./src/routes/accounts');
const dashboardRoutes = require('./src/routes/dashboard');
const exportRoutes = require('./src/routes/export');
const syncRoutes = require('./src/routes/sync');
const adminRoutes = require('./src/routes/admin');
const debugOAuthRoutes = require('./src/routes/debug-oauth');
const testOAuthCallbackRoutes = require('./src/routes/test-oauth-callback');
const testDbRoutes = require('./src/routes/test-db');
const migrateRoutes = require('./src/routes/migrate');
const debugDeploymentRoutes = require('./src/routes/debug-deployment');
const migrationRoutes = require('./src/routes/migration');
const filteringStatsRoutes = require('./src/routes/filtering-stats');
const runMigrationRoutes = require('./src/routes/run-migration');
const { initializeQueues } = require('./src/services/queueService');
const { startScheduledJobs } = require('./src/services/schedulerService');
const healthMonitor = require('./src/services/healthMonitor');

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
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.tailwindcss.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com"],
      scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'", "'sha256-uyVwR/RWYLAiHr2X/447Bq5ppefcVFQI/0r3qfadufA='"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "https:"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

// Rate limiting - exclude health check endpoint
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health check endpoint
    return req.path === '/api/health';
  }
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

// Public routes (no authentication required)
app.use('/api/public', publicFaqRoutes);

// Admin routes (authentication required)
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminFaqRoutes);

// Existing routes (will be moved to admin area)
app.use('/api/emails', emailRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/faq-sources', faqSourcesRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/migrate', migrateRoutes);
app.use('/api/filtering-stats', filteringStatsRoutes);
app.use('/api/run-migration', runMigrationRoutes);

// Test OAuth callback route (temporary for debugging)
app.use('/api/test/oauth', testOAuthCallbackRoutes);

// Debug deployment route
app.use('/api/debug', debugDeploymentRoutes);

// Migration route
app.use('/api/migration', migrationRoutes);

// Debug routes (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug/oauth', debugOAuthRoutes);
  logger.info('OAuth debug routes enabled at /api/debug/oauth');
}

// Test database route
app.use('/api/test/db', testDbRoutes);

// Enhanced logging for all /api routes to debug routing issues
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    logger.info(`API Request: ${req.method} ${req.path}`, {
      query: req.query,
      headers: {
        host: req.headers.host,
        referer: req.headers.referer,
        'user-agent': req.headers['user-agent']
      }
    });
  }
  
  // Special logging for OAuth callbacks
  if (req.path === '/api/auth/gmail/callback' || req.path === '/api/auth/outlook/callback') {
    logger.warn(`OAuth callback reached middleware: ${req.path}`, {
      query: req.query,
      method: req.method,
      hasCode: !!req.query.code,
      hasError: !!req.query.error
    });
  }
  next();
});

// Enhanced health check endpoint with comprehensive monitoring
app.get('/api/health', async (req, res) => {
  try {
    const healthStatus = healthMonitor.getHealthStatus();
    const healthMetrics = healthMonitor.getHealthMetrics();
    
    // Check database connection
    await db.query('SELECT 1');
    
    // Check Redis connection
    await redisClient.ping();
    
    const response = {
      status: healthStatus.overall,
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected'
      },
      metrics: healthMetrics,
      monitoring: healthStatus.monitoring,
      readyForProcessing: healthMonitor.isReadyForProcessing()
    };
    
    const statusCode = healthStatus.overall === 'healthy' ? 200 : 503;
    res.status(statusCode).json(response);
    
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      monitoring: false
    });
  }
});

// Detailed health metrics endpoint
app.get('/api/health/metrics', (req, res) => {
  try {
    const metrics = healthMonitor.getHealthMetrics();
    const recommendations = healthMonitor.getProcessingRecommendations();
    
    res.json({
      metrics,
      recommendations,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Health metrics failed:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
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
        export: '/api/export',
        sync: '/api/sync'
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

// Initialize services with enhanced error handling and retries
async function initializeApp() {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      logger.info(`Initialization attempt ${retryCount + 1}/${maxRetries}`);
      
      // Initialize database connection with timeout
      logger.info('Connecting to database...');
      await Promise.race([
        db.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), 15000))
      ]);
      logger.info('✅ Database connected successfully');
      
      // Initialize Redis connection with timeout
      logger.info('Connecting to Redis...');
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 10000))
      ]);
      logger.info('✅ Redis connected successfully');
      
      // Initialize background job queues (with error handling)
      try {
        await initializeQueues();
        logger.info('✅ Job queues initialized');
      } catch (queueError) {
        logger.warn('Job queue initialization failed, continuing without queues:', queueError.message);
      }
      
      // Start scheduled jobs (with error handling)
      try {
        startScheduledJobs();
        logger.info('✅ Scheduled jobs started');
      } catch (schedulerError) {
        logger.warn('Scheduler initialization failed, continuing without scheduled jobs:', schedulerError.message);
      }
      
      // Start health monitoring
      try {
        healthMonitor.startMonitoring(30000); // Check every 30 seconds
        logger.info('✅ Health monitoring started');
      } catch (monitorError) {
        logger.warn('Health monitoring failed to start:', monitorError.message);
      }
      
      // Start server
      server.listen(PORT, '0.0.0.0', () => {
        logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
        logger.info('✅ FAQ Generator with OAuth token refresh fix is ready!');
        logger.info('✅ Gmail sync will now automatically refresh expired tokens');
        logger.info('✅ Ready to process emails without invalid_grant errors');
      });
      
      // If we get here, initialization was successful
      break;
      
    } catch (error) {
      retryCount++;
      logger.error(`Initialization attempt ${retryCount} failed:`, {
        error: error.message,
        stack: error.stack,
        retryCount,
        maxRetries
      });
      
      if (retryCount >= maxRetries) {
        logger.error('All initialization attempts failed. Exiting...');
        process.exit(1);
      }
      
      // Wait before retrying
      const waitTime = Math.min(retryCount * 5000, 15000);
      logger.info(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
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