const { performanceConfig } = require('../config/performance');
const monitoringService = require('../services/monitoringService');
const logger = require('../utils/logger');
const compression = require('compression');

// Request timing middleware
const requestTiming = (req, res, next) => {
  const startTime = Date.now();
  
  // Add timing to response headers
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    
    // Log slow requests
    if (duration > 5000) { // 5 seconds
      logger.warn(`Slow request detected: ${req.method} ${req.path} took ${duration}ms`);
    }
    
    // Track API metrics
    if (req.path.startsWith('/api/')) {
      // This would integrate with monitoring service
      // monitoringService.trackAPIRequest(req.path, req.method, duration, res.statusCode);
    }
  });
  
  next();
};

// Memory monitoring middleware
const memoryMonitoring = (req, res, next) => {
  const usage = process.memoryUsage();
  const limits = performanceConfig.memory.limits;
  
  // Check memory usage before processing request
  if (usage.heapUsed > limits.heapUsed * 0.9) {
    logger.warn(`High memory usage detected: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);
    
    // Force garbage collection if enabled
    if (performanceConfig.memory.gc.enabled && global.gc) {
      global.gc();
      logger.info('Forced garbage collection executed');
    }
  }
  
  next();
};

// Request size limiting middleware
const requestSizeLimiting = (req, res, next) => {
  const contentLength = parseInt(req.get('content-length') || '0');
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (contentLength > maxSize) {
    return res.status(413).json({
      error: 'Request entity too large',
      maxSize: `${maxSize / 1024 / 1024}MB`
    });
  }
  
  next();
};

// Connection pooling middleware for database
const connectionPooling = (req, res, next) => {
  // Add database connection info to request
  req.dbPool = {
    maxConnections: performanceConfig.database.pool.max,
    timeout: performanceConfig.database.query.timeout
  };
  
  next();
};

// Cache control middleware
const cacheControl = (req, res, next) => {
  const cacheConfig = performanceConfig.cache.http;
  
  // Set cache headers based on route
  if (req.path.startsWith('/api/dashboard')) {
    res.set('Cache-Control', `public, max-age=${cacheConfig.dashboard}`);
  } else if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', `public, max-age=${cacheConfig.api}`);
  } else if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg)$/)) {
    res.set('Cache-Control', `public, max-age=${cacheConfig.static}`);
  } else {
    res.set('Cache-Control', 'no-cache');
  }
  
  next();
};

// Compression middleware with performance config
const compressionMiddleware = compression({
  level: performanceConfig.compression.level,
  threshold: performanceConfig.compression.threshold,
  filter: performanceConfig.compression.filter
});

// Rate limiting with performance considerations
const createRateLimiter = (windowMs, max, message) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Clean old entries
    for (const [ip, timestamps] of requests.entries()) {
      const validTimestamps = timestamps.filter(time => time > windowStart);
      if (validTimestamps.length === 0) {
        requests.delete(ip);
      } else {
        requests.set(ip, validTimestamps);
      }
    }
    
    // Check current IP
    const userRequests = requests.get(key) || [];
    const recentRequests = userRequests.filter(time => time > windowStart);
    
    if (recentRequests.length >= max) {
      return res.status(429).json({
        error: message || 'Too many requests',
        retryAfter: Math.ceil((recentRequests[0] + windowMs - now) / 1000)
      });
    }
    
    // Add current request
    recentRequests.push(now);
    requests.set(key, recentRequests);
    
    next();
  };
};

// Performance monitoring middleware
const performanceMonitoring = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();
  
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
    
    // Log performance metrics for slow or memory-intensive requests
    if (duration > 1000 || Math.abs(memoryDelta) > 10 * 1024 * 1024) { // 1s or 10MB
      logger.info(`Performance metrics for ${req.method} ${req.path}:`, {
        duration: `${duration.toFixed(2)}ms`,
        memoryDelta: `${Math.round(memoryDelta / 1024 / 1024)}MB`,
        statusCode: res.statusCode
      });
    }
  });
  
  next();
};

// Circuit breaker middleware for external services
const createCircuitBreaker = (name, options = {}) => {
  const {
    failureThreshold = 5,
    resetTimeout = 60000,
    monitoringPeriod = 10000
  } = options;
  
  let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  let failures = 0;
  let lastFailureTime = null;
  let nextAttempt = null;
  
  return (req, res, next) => {
    const now = Date.now();
    
    // Reset failure count periodically
    if (lastFailureTime && now - lastFailureTime > monitoringPeriod) {
      failures = 0;
    }
    
    // Check circuit breaker state
    if (state === 'OPEN') {
      if (now < nextAttempt) {
        return res.status(503).json({
          error: `Service ${name} is temporarily unavailable`,
          retryAfter: Math.ceil((nextAttempt - now) / 1000)
        });
      } else {
        state = 'HALF_OPEN';
      }
    }
    
    // Wrap response to track failures
    const originalSend = res.send;
    res.send = function(data) {
      if (res.statusCode >= 500) {
        failures++;
        lastFailureTime = now;
        
        if (failures >= failureThreshold) {
          state = 'OPEN';
          nextAttempt = now + resetTimeout;
          logger.warn(`Circuit breaker opened for ${name} after ${failures} failures`);
        }
      } else if (state === 'HALF_OPEN') {
        state = 'CLOSED';
        failures = 0;
        logger.info(`Circuit breaker closed for ${name}`);
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

// Batch processing middleware
const batchProcessing = (batchSize = 100, timeout = 5000) => {
  const batches = new Map();
  
  return (req, res, next) => {
    const batchKey = `${req.method}:${req.path}`;
    
    if (!batches.has(batchKey)) {
      batches.set(batchKey, {
        requests: [],
        timer: null
      });
    }
    
    const batch = batches.get(batchKey);
    batch.requests.push({ req, res, next });
    
    // Process batch when full or after timeout
    if (batch.requests.length >= batchSize) {
      processBatch(batchKey, batch);
    } else if (!batch.timer) {
      batch.timer = setTimeout(() => {
        processBatch(batchKey, batch);
      }, timeout);
    }
  };
  
  function processBatch(batchKey, batch) {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    
    const requests = batch.requests.splice(0);
    
    // Process all requests in batch
    for (const { req, res, next } of requests) {
      next();
    }
    
    logger.info(`Processed batch of ${requests.length} requests for ${batchKey}`);
  }
};

// Health check middleware
const healthCheck = (req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') {
    const metrics = monitoringService.getMetrics();
    const isHealthy = metrics.memory.heapUsed.percentage < 90 && 
                     (!metrics.system.cpu || metrics.system.cpu.usage < 95);
    
    return res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: metrics.memory,
      cpu: metrics.system.cpu,
      version: process.env.npm_package_version || '1.0.0'
    });
  }
  
  next();
};

// Graceful shutdown middleware
const gracefulShutdown = () => {
  let isShuttingDown = false;
  
  const shutdown = (signal) => {
    if (isShuttingDown) return;
    
    isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    
    // Stop accepting new requests
    server.close(() => {
      logger.info('HTTP server closed');
      
      // Stop monitoring service
      monitoringService.stop();
      
      // Close database connections
      if (require('../config/database').pool) {
        require('../config/database').pool.end();
      }
      
      // Close Redis connections
      if (require('../config/redis').quit) {
        require('../config/redis').quit();
      }
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
    
    // Force shutdown after timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  return (req, res, next) => {
    if (isShuttingDown) {
      return res.status(503).json({
        error: 'Server is shutting down',
        message: 'Please try again later'
      });
    }
    next();
  };
};

module.exports = {
  requestTiming,
  memoryMonitoring,
  requestSizeLimiting,
  connectionPooling,
  cacheControl,
  compressionMiddleware,
  createRateLimiter,
  performanceMonitoring,
  createCircuitBreaker,
  batchProcessing,
  healthCheck,
  gracefulShutdown
};