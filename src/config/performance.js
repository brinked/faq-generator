const os = require('os');

// Performance configuration optimized for Render.com infrastructure
const performanceConfig = {
  // Database connection pooling
  database: {
    // Optimized for Render PostgreSQL
    pool: {
      min: 2,
      max: process.env.NODE_ENV === 'production' ? 20 : 10,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200
    },
    // Query optimization
    query: {
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000
    }
  },

  // Redis configuration for Render
  redis: {
    // Connection pooling
    pool: {
      min: 1,
      max: process.env.NODE_ENV === 'production' ? 10 : 5
    },
    // Cache TTL settings
    ttl: {
      short: 300,      // 5 minutes
      medium: 1800,    // 30 minutes
      long: 3600,      // 1 hour
      extended: 86400  // 24 hours
    },
    // Memory optimization
    memory: {
      maxMemoryPolicy: 'allkeys-lru',
      maxMemory: '256mb'
    }
  },

  // Queue processing optimization
  queue: {
    // Bull queue settings for Render
    concurrency: {
      emailSync: Math.min(os.cpus().length, 4),
      faqGeneration: Math.min(os.cpus().length, 2),
      cleanup: 1
    },
    // Job retry configuration
    retry: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    },
    // Job timeout settings
    timeout: {
      emailSync: 300000,     // 5 minutes
      faqGeneration: 600000, // 10 minutes
      cleanup: 120000        // 2 minutes
    }
  },

  // AI service optimization
  ai: {
    // OpenAI API optimization
    openai: {
      maxRetries: 3,
      timeout: 30000,
      // Batch processing settings
      batchSize: {
        questions: 10,
        embeddings: 50,
        answers: 5
      }
    },
    // Embedding cache settings
    embeddings: {
      cacheEnabled: true,
      cacheTTL: 86400, // 24 hours
      batchProcessing: true
    }
  },

  // Email processing optimization
  email: {
    // Batch processing settings
    batchSize: {
      fetch: 100,
      process: 50,
      store: 25
    },
    // Rate limiting for email APIs
    rateLimit: {
      gmail: {
        requests: 250,
        window: 100000 // 100 seconds
      },
      outlook: {
        requests: 300,
        window: 300000 // 5 minutes
      }
    }
  },

  // Memory management
  memory: {
    // Garbage collection optimization
    gc: {
      enabled: process.env.NODE_ENV === 'production',
      interval: 60000, // 1 minute
      threshold: 0.8   // 80% memory usage
    },
    // Memory limits
    limits: {
      heapUsed: 400 * 1024 * 1024,    // 400MB
      heapTotal: 500 * 1024 * 1024,   // 500MB
      external: 100 * 1024 * 1024     // 100MB
    }
  },

  // Clustering for Render
  cluster: {
    enabled: process.env.NODE_ENV === 'production',
    workers: process.env.WEB_CONCURRENCY || Math.min(os.cpus().length, 4),
    respawn: true,
    respawnDelay: 1000
  },

  // Monitoring and metrics
  monitoring: {
    enabled: true,
    interval: 30000, // 30 seconds
    metrics: {
      memory: true,
      cpu: true,
      database: true,
      redis: true,
      queue: true,
      api: true
    }
  },

  // Caching strategy
  cache: {
    // Application-level caching
    app: {
      faqs: {
        ttl: 1800,        // 30 minutes
        maxSize: 1000     // Max 1000 FAQs in memory
      },
      accounts: {
        ttl: 3600,        // 1 hour
        maxSize: 100      // Max 100 accounts in memory
      },
      stats: {
        ttl: 300,         // 5 minutes
        maxSize: 50       // Max 50 stat objects
      }
    },
    // HTTP response caching
    http: {
      static: 86400,      // 24 hours for static assets
      api: 300,           // 5 minutes for API responses
      dashboard: 60       // 1 minute for dashboard data
    }
  },

  // Compression settings
  compression: {
    enabled: true,
    level: 6,           // Balance between speed and compression
    threshold: 1024,    // Only compress responses > 1KB
    filter: (req, res) => {
      // Don't compress if response is already compressed
      if (req.headers['x-no-compression']) {
        return false;
      }
      // Use compression for all other responses
      return true;
    }
  },

  // Request optimization
  request: {
    // Body parser limits
    bodyParser: {
      json: { limit: '10mb' },
      urlencoded: { limit: '10mb', extended: true },
      text: { limit: '10mb' }
    },
    // Request timeout
    timeout: 30000,
    // Keep-alive settings
    keepAlive: {
      enabled: true,
      timeout: 5000
    }
  }
};

// Environment-specific overrides
if (process.env.NODE_ENV === 'production') {
  // Production optimizations for Render
  performanceConfig.database.pool.max = 25;
  performanceConfig.redis.pool.max = 15;
  performanceConfig.queue.concurrency.emailSync = 6;
  performanceConfig.queue.concurrency.faqGeneration = 3;
  performanceConfig.memory.limits.heapUsed = 800 * 1024 * 1024; // 800MB
  performanceConfig.memory.limits.heapTotal = 1024 * 1024 * 1024; // 1GB
} else if (process.env.NODE_ENV === 'development') {
  // Development optimizations
  performanceConfig.database.pool.max = 5;
  performanceConfig.redis.pool.max = 3;
  performanceConfig.queue.concurrency.emailSync = 2;
  performanceConfig.queue.concurrency.faqGeneration = 1;
  performanceConfig.monitoring.interval = 60000; // 1 minute
}

// Helper functions for performance optimization
const performanceHelpers = {
  // Get optimal batch size based on available memory
  getOptimalBatchSize: (itemSize, maxMemory = 100 * 1024 * 1024) => {
    return Math.floor(maxMemory / itemSize);
  },

  // Calculate optimal concurrency based on CPU cores
  getOptimalConcurrency: (taskType = 'cpu') => {
    const cores = os.cpus().length;
    switch (taskType) {
      case 'io':
        return cores * 2;
      case 'cpu':
        return cores;
      case 'mixed':
        return Math.ceil(cores * 1.5);
      default:
        return cores;
    }
  },

  // Memory usage checker
  checkMemoryUsage: () => {
    const usage = process.memoryUsage();
    const limits = performanceConfig.memory.limits;
    
    return {
      heapUsed: {
        current: usage.heapUsed,
        limit: limits.heapUsed,
        percentage: (usage.heapUsed / limits.heapUsed) * 100
      },
      heapTotal: {
        current: usage.heapTotal,
        limit: limits.heapTotal,
        percentage: (usage.heapTotal / limits.heapTotal) * 100
      },
      external: {
        current: usage.external,
        limit: limits.external,
        percentage: (usage.external / limits.external) * 100
      }
    };
  },

  // Performance recommendations based on current metrics
  getPerformanceRecommendations: (metrics) => {
    const recommendations = [];
    
    if (metrics.memory.heapUsed.percentage > 80) {
      recommendations.push({
        type: 'memory',
        priority: 'high',
        message: 'High memory usage detected. Consider reducing batch sizes or enabling garbage collection.',
        action: 'reduce_batch_size'
      });
    }
    
    if (metrics.cpu && metrics.cpu.usage > 80) {
      recommendations.push({
        type: 'cpu',
        priority: 'high',
        message: 'High CPU usage detected. Consider reducing concurrency or optimizing algorithms.',
        action: 'reduce_concurrency'
      });
    }
    
    return recommendations;
  }
};

module.exports = {
  performanceConfig,
  performanceHelpers
};