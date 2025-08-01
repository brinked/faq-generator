const redis = require('redis');
const logger = require('../utils/logger');

// Redis configuration for v4+
const redisConfig = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis connection attempts exhausted');
        return new Error('Redis connection attempts exhausted');
      }
      // Exponential backoff with max 3 seconds
      return Math.min(retries * 100, 3000);
    },
    connectTimeout: 10000,
    commandTimeout: 5000
  }
};

// Create Redis client
const client = redis.createClient(redisConfig);

// Track connection state
let isConnected = false;
let connectionPromise = null;

// Error handling
client.on('error', (err) => {
  logger.error('Redis Client Error:', err);
  isConnected = false;
});

client.on('connect', () => {
  logger.info('Redis client connected');
  isConnected = true;
});

client.on('ready', () => {
  logger.info('Redis client ready');
  isConnected = true;
});

client.on('end', () => {
  logger.info('Redis client disconnected');
  isConnected = false;
});

// Ensure connection function
async function ensureConnection() {
  if (isConnected && client.isOpen) {
    return;
  }
  
  if (connectionPromise) {
    return connectionPromise;
  }
  
  connectionPromise = (async () => {
    try {
      if (!client.isOpen) {
        await client.connect();
        logger.info('Redis connection established');
      }
      isConnected = true;
    } catch (error) {
      logger.error('Redis connection failed:', error);
      isConnected = false;
      throw error;
    } finally {
      connectionPromise = null;
    }
  })();
  
  return connectionPromise;
}

// Redis wrapper with additional methods
const redisClient = {
  // Basic operations
  async get(key) {
    try {
      await ensureConnection();
      return await client.get(key);
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      throw error;
    }
  },

  async set(key, value, options = {}) {
    try {
      await ensureConnection();
      if (options.ttl) {
        return await client.setEx(key, options.ttl, value);
      }
      return await client.set(key, value);
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  },

  async del(key) {
    try {
      await ensureConnection();
      return await client.del(key);
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      throw error;
    }
  },

  async exists(key) {
    try {
      await ensureConnection();
      return await client.exists(key);
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      throw error;
    }
  },

  async expire(key, seconds) {
    try {
      await ensureConnection();
      return await client.expire(key, seconds);
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      throw error;
    }
  },

  // Hash operations
  async hget(key, field) {
    try {
      await ensureConnection();
      return await client.hGet(key, field);
    } catch (error) {
      logger.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  },

  async hset(key, field, value) {
    try {
      await ensureConnection();
      return await client.hSet(key, field, value);
    } catch (error) {
      logger.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  },

  async hgetall(key) {
    try {
      await ensureConnection();
      return await client.hGetAll(key);
    } catch (error) {
      logger.error(`Redis HGETALL error for key ${key}:`, error);
      throw error;
    }
  },

  async hdel(key, field) {
    try {
      await ensureConnection();
      return await client.hDel(key, field);
    } catch (error) {
      logger.error(`Redis HDEL error for key ${key}, field ${field}:`, error);
      throw error;
    }
  },

  // List operations
  async lpush(key, value) {
    try {
      await ensureConnection();
      return await client.lPush(key, value);
    } catch (error) {
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      throw error;
    }
  },

  async rpop(key) {
    try {
      await ensureConnection();
      return await client.rPop(key);
    } catch (error) {
      logger.error(`Redis RPOP error for key ${key}:`, error);
      throw error;
    }
  },

  async llen(key) {
    try {
      await ensureConnection();
      return await client.lLen(key);
    } catch (error) {
      logger.error(`Redis LLEN error for key ${key}:`, error);
      throw error;
    }
  },

  // Set operations
  async sadd(key, member) {
    try {
      await ensureConnection();
      return await client.sAdd(key, member);
    } catch (error) {
      logger.error(`Redis SADD error for key ${key}:`, error);
      throw error;
    }
  },

  async smembers(key) {
    try {
      await ensureConnection();
      return await client.sMembers(key);
    } catch (error) {
      logger.error(`Redis SMEMBERS error for key ${key}:`, error);
      throw error;
    }
  },

  async srem(key, member) {
    try {
      await ensureConnection();
      return await client.sRem(key, member);
    } catch (error) {
      logger.error(`Redis SREM error for key ${key}:`, error);
      throw error;
    }
  },

  // Utility methods
  async ping() {
    try {
      await ensureConnection();
      return await client.ping();
    } catch (error) {
      logger.error('Redis PING error:', error);
      throw error;
    }
  },

  async flushall() {
    try {
      await ensureConnection();
      return await client.flushAll();
    } catch (error) {
      logger.error('Redis FLUSHALL error:', error);
      throw error;
    }
  },

  async keys(pattern) {
    try {
      await ensureConnection();
      return await client.keys(pattern);
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
      throw error;
    }
  },

  // Connection methods
  async connect() {
    return ensureConnection();
  },

  async quit() {
    try {
      await client.quit();
      logger.info('Redis connection closed');
      isConnected = false;
    } catch (error) {
      logger.error('Redis quit error:', error);
      throw error;
    }
  },

  // Cache helper methods
  async cacheGet(key, fallback, ttl = 3600) {
    try {
      const cached = await this.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
      
      const result = await fallback();
      if (result) {
        await this.set(key, JSON.stringify(result), { ttl });
      }
      
      return result;
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error);
      // Return fallback result if cache fails
      return await fallback();
    }
  },

  async cacheSet(key, value, ttl = 3600) {
    try {
      await this.set(key, JSON.stringify(value), { ttl });
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error);
      // Don't throw error for cache failures
    }
  },

  async cacheDel(key) {
    try {
      await this.del(key);
    } catch (error) {
      logger.error(`Cache DEL error for key ${key}:`, error);
      // Don't throw error for cache failures
    }
  }
};

module.exports = redisClient;