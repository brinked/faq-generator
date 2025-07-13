const os = require('os');
const { performanceConfig } = require('../config/performance');
const logger = require('../utils/logger');
const db = require('../config/database');
const redis = require('../config/redis');

class MonitoringService {
  constructor() {
    this.metrics = {
      system: {},
      database: {},
      redis: {},
      queue: {},
      api: {},
      memory: {},
      performance: {}
    };
    
    this.alerts = [];
    this.isMonitoring = false;
    this.monitoringInterval = null;
  }

  // Start monitoring service
  start() {
    if (this.isMonitoring) {
      logger.warn('Monitoring service is already running');
      return;
    }

    this.isMonitoring = true;
    const interval = performanceConfig.monitoring.interval;
    
    logger.info(`Starting monitoring service with ${interval}ms interval`);
    
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, interval);

    // Initial metrics collection
    this.collectMetrics();
  }

  // Stop monitoring service
  stop() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    logger.info('Monitoring service stopped');
  }

  // Collect all metrics
  async collectMetrics() {
    try {
      const timestamp = new Date();
      
      // Collect system metrics
      if (performanceConfig.monitoring.metrics.memory) {
        this.metrics.memory = this.collectMemoryMetrics();
      }
      
      if (performanceConfig.monitoring.metrics.cpu) {
        this.metrics.system = await this.collectSystemMetrics();
      }
      
      if (performanceConfig.monitoring.metrics.database) {
        this.metrics.database = await this.collectDatabaseMetrics();
      }
      
      if (performanceConfig.monitoring.metrics.redis) {
        this.metrics.redis = await this.collectRedisMetrics();
      }
      
      if (performanceConfig.monitoring.metrics.queue) {
        this.metrics.queue = await this.collectQueueMetrics();
      }
      
      if (performanceConfig.monitoring.metrics.api) {
        this.metrics.api = this.collectAPIMetrics();
      }

      // Store metrics in database for historical analysis
      await this.storeMetrics(timestamp);
      
      // Check for alerts
      this.checkAlerts();
      
      // Log performance summary
      this.logPerformanceSummary();
      
    } catch (error) {
      logger.error('Error collecting metrics:', error);
    }
  }

  // Collect memory metrics
  collectMemoryMetrics() {
    const usage = process.memoryUsage();
    const limits = performanceConfig.memory.limits;
    
    return {
      heapUsed: {
        bytes: usage.heapUsed,
        mb: Math.round(usage.heapUsed / 1024 / 1024),
        percentage: Math.round((usage.heapUsed / limits.heapUsed) * 100)
      },
      heapTotal: {
        bytes: usage.heapTotal,
        mb: Math.round(usage.heapTotal / 1024 / 1024),
        percentage: Math.round((usage.heapTotal / limits.heapTotal) * 100)
      },
      external: {
        bytes: usage.external,
        mb: Math.round(usage.external / 1024 / 1024),
        percentage: Math.round((usage.external / limits.external) * 100)
      },
      rss: {
        bytes: usage.rss,
        mb: Math.round(usage.rss / 1024 / 1024)
      }
    };
  }

  // Collect system metrics
  async collectSystemMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    return {
      cpu: {
        cores: cpus.length,
        model: cpus[0].model,
        loadAverage: {
          '1min': loadAvg[0],
          '5min': loadAvg[1],
          '15min': loadAvg[2]
        },
        usage: await this.getCPUUsage()
      },
      memory: {
        total: Math.round(os.totalmem() / 1024 / 1024),
        free: Math.round(os.freemem() / 1024 / 1024),
        used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
        percentage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
      },
      uptime: Math.round(os.uptime()),
      platform: os.platform(),
      arch: os.arch()
    };
  }

  // Get CPU usage percentage
  getCPUUsage() {
    return new Promise((resolve) => {
      const startMeasure = this.cpuAverage();
      
      setTimeout(() => {
        const endMeasure = this.cpuAverage();
        const idleDifference = endMeasure.idle - startMeasure.idle;
        const totalDifference = endMeasure.total - startMeasure.total;
        const percentageCPU = 100 - Math.round(100 * idleDifference / totalDifference);
        
        resolve(percentageCPU);
      }, 1000);
    });
  }

  // Calculate CPU average
  cpuAverage() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    
    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
      irq += cpu.times.irq;
    }
    
    const total = user + nice + sys + idle + irq;
    
    return { idle, total };
  }

  // Collect database metrics
  async collectDatabaseMetrics() {
    try {
      const poolStats = db.pool ? {
        totalCount: db.pool.totalCount,
        idleCount: db.pool.idleCount,
        waitingCount: db.pool.waitingCount
      } : null;

      // Get database size and connection info
      const dbStatsQuery = `
        SELECT 
          pg_database_size(current_database()) as db_size,
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections
      `;
      
      const result = await db.query(dbStatsQuery);
      const dbStats = result.rows[0];

      // Get table statistics
      const tableStatsQuery = `
        SELECT 
          schemaname,
          tablename,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_tuples,
          n_dead_tup as dead_tuples
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 10
      `;
      
      const tableResult = await db.query(tableStatsQuery);
      
      return {
        pool: poolStats,
        size: {
          bytes: parseInt(dbStats.db_size),
          mb: Math.round(parseInt(dbStats.db_size) / 1024 / 1024)
        },
        connections: {
          active: parseInt(dbStats.active_connections),
          idle: parseInt(dbStats.idle_connections),
          total: parseInt(dbStats.active_connections) + parseInt(dbStats.idle_connections)
        },
        tables: tableResult.rows,
        performance: {
          avgQueryTime: await this.getAverageQueryTime(),
          slowQueries: await this.getSlowQueries()
        }
      };
    } catch (error) {
      logger.error('Error collecting database metrics:', error);
      return { error: error.message };
    }
  }

  // Get average query time
  async getAverageQueryTime() {
    try {
      const query = `
        SELECT 
          ROUND(AVG(mean_time)::numeric, 2) as avg_time,
          ROUND(AVG(total_time)::numeric, 2) as total_time
        FROM pg_stat_statements 
        WHERE calls > 10
      `;
      
      const result = await db.query(query);
      return result.rows[0] || { avg_time: 0, total_time: 0 };
    } catch (error) {
      return { avg_time: 0, total_time: 0 };
    }
  }

  // Get slow queries
  async getSlowQueries() {
    try {
      const query = `
        SELECT 
          query,
          calls,
          ROUND(mean_time::numeric, 2) as mean_time,
          ROUND(total_time::numeric, 2) as total_time
        FROM pg_stat_statements 
        WHERE mean_time > 1000
        ORDER BY mean_time DESC
        LIMIT 5
      `;
      
      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  // Collect Redis metrics
  async collectRedisMetrics() {
    try {
      if (!redis.isReady) {
        return { status: 'disconnected' };
      }

      const info = await redis.info();
      const memory = await redis.info('memory');
      const stats = await redis.info('stats');
      
      // Parse Redis info
      const parseInfo = (infoString) => {
        const lines = infoString.split('\r\n');
        const result = {};
        
        for (const line of lines) {
          if (line.includes(':')) {
            const [key, value] = line.split(':');
            result[key] = isNaN(value) ? value : parseFloat(value);
          }
        }
        
        return result;
      };

      const memoryInfo = parseInfo(memory);
      const statsInfo = parseInfo(stats);
      
      return {
        status: 'connected',
        memory: {
          used: Math.round(memoryInfo.used_memory / 1024 / 1024),
          peak: Math.round(memoryInfo.used_memory_peak / 1024 / 1024),
          rss: Math.round(memoryInfo.used_memory_rss / 1024 / 1024)
        },
        stats: {
          totalConnectionsReceived: statsInfo.total_connections_received,
          totalCommandsProcessed: statsInfo.total_commands_processed,
          instantaneousOpsPerSec: statsInfo.instantaneous_ops_per_sec,
          keyspaceHits: statsInfo.keyspace_hits,
          keyspaceMisses: statsInfo.keyspace_misses,
          hitRate: statsInfo.keyspace_hits / (statsInfo.keyspace_hits + statsInfo.keyspace_misses) * 100
        },
        keyspace: await this.getRedisKeyspaceInfo()
      };
    } catch (error) {
      logger.error('Error collecting Redis metrics:', error);
      return { status: 'error', error: error.message };
    }
  }

  // Get Redis keyspace information
  async getRedisKeyspaceInfo() {
    try {
      const keys = await redis.dbSize();
      return { totalKeys: keys };
    } catch (error) {
      return { totalKeys: 0 };
    }
  }

  // Collect queue metrics
  async collectQueueMetrics() {
    try {
      // This would integrate with Bull queue monitoring
      // For now, return placeholder metrics
      return {
        emailSync: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0
        },
        faqGeneration: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0
        },
        cleanup: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0
        }
      };
    } catch (error) {
      logger.error('Error collecting queue metrics:', error);
      return { error: error.message };
    }
  }

  // Collect API metrics
  collectAPIMetrics() {
    // This would integrate with API request tracking
    // For now, return placeholder metrics
    return {
      requests: {
        total: 0,
        perMinute: 0,
        errors: 0,
        errorRate: 0
      },
      responseTime: {
        average: 0,
        p95: 0,
        p99: 0
      },
      endpoints: {}
    };
  }

  // Store metrics in database
  async storeMetrics(timestamp) {
    try {
      const metricsData = {
        timestamp,
        memory: this.metrics.memory,
        system: this.metrics.system,
        database: this.metrics.database,
        redis: this.metrics.redis,
        queue: this.metrics.queue,
        api: this.metrics.api
      };

      await db.query(
        `INSERT INTO system_metrics (timestamp, metrics_data) VALUES ($1, $2)`,
        [timestamp, JSON.stringify(metricsData)]
      );
    } catch (error) {
      logger.error('Error storing metrics:', error);
    }
  }

  // Check for performance alerts
  checkAlerts() {
    const alerts = [];
    
    // Memory alerts
    if (this.metrics.memory.heapUsed.percentage > 85) {
      alerts.push({
        type: 'memory',
        level: 'critical',
        message: `High memory usage: ${this.metrics.memory.heapUsed.percentage}%`,
        timestamp: new Date()
      });
    } else if (this.metrics.memory.heapUsed.percentage > 70) {
      alerts.push({
        type: 'memory',
        level: 'warning',
        message: `Elevated memory usage: ${this.metrics.memory.heapUsed.percentage}%`,
        timestamp: new Date()
      });
    }

    // CPU alerts
    if (this.metrics.system.cpu && this.metrics.system.cpu.usage > 90) {
      alerts.push({
        type: 'cpu',
        level: 'critical',
        message: `High CPU usage: ${this.metrics.system.cpu.usage}%`,
        timestamp: new Date()
      });
    }

    // Database connection alerts
    if (this.metrics.database.pool && this.metrics.database.pool.waitingCount > 5) {
      alerts.push({
        type: 'database',
        level: 'warning',
        message: `Database connection pool under pressure: ${this.metrics.database.pool.waitingCount} waiting`,
        timestamp: new Date()
      });
    }

    // Log alerts
    for (const alert of alerts) {
      if (alert.level === 'critical') {
        logger.error(`ALERT [${alert.type}]: ${alert.message}`);
      } else {
        logger.warn(`ALERT [${alert.type}]: ${alert.message}`);
      }
    }

    this.alerts = alerts;
  }

  // Log performance summary
  logPerformanceSummary() {
    const summary = {
      memory: `${this.metrics.memory.heapUsed.mb}MB (${this.metrics.memory.heapUsed.percentage}%)`,
      cpu: this.metrics.system.cpu ? `${this.metrics.system.cpu.usage}%` : 'N/A',
      database: this.metrics.database.connections ? `${this.metrics.database.connections.active} active connections` : 'N/A',
      redis: this.metrics.redis.status || 'N/A'
    };

    logger.info('Performance Summary:', summary);
  }

  // Get current metrics
  getMetrics() {
    return {
      ...this.metrics,
      alerts: this.alerts,
      timestamp: new Date()
    };
  }

  // Get historical metrics
  async getHistoricalMetrics(hours = 24) {
    try {
      const query = `
        SELECT timestamp, metrics_data 
        FROM system_metrics 
        WHERE timestamp > NOW() - INTERVAL '${hours} hours'
        ORDER BY timestamp DESC
        LIMIT 1000
      `;
      
      const result = await db.query(query);
      return result.rows.map(row => ({
        timestamp: row.timestamp,
        ...JSON.parse(row.metrics_data)
      }));
    } catch (error) {
      logger.error('Error fetching historical metrics:', error);
      return [];
    }
  }

  // Generate performance report
  async generatePerformanceReport() {
    const currentMetrics = this.getMetrics();
    const historicalMetrics = await this.getHistoricalMetrics(24);
    
    return {
      current: currentMetrics,
      historical: historicalMetrics,
      summary: {
        uptime: Math.round(os.uptime()),
        alerts: this.alerts.length,
        performance: this.calculatePerformanceScore(currentMetrics)
      },
      recommendations: this.generateRecommendations(currentMetrics)
    };
  }

  // Calculate overall performance score
  calculatePerformanceScore(metrics) {
    let score = 100;
    
    // Deduct points for high resource usage
    if (metrics.memory.heapUsed.percentage > 80) score -= 20;
    else if (metrics.memory.heapUsed.percentage > 60) score -= 10;
    
    if (metrics.system.cpu && metrics.system.cpu.usage > 80) score -= 20;
    else if (metrics.system.cpu && metrics.system.cpu.usage > 60) score -= 10;
    
    // Deduct points for database issues
    if (metrics.database.pool && metrics.database.pool.waitingCount > 0) score -= 10;
    
    // Deduct points for Redis issues
    if (metrics.redis.status !== 'connected') score -= 15;
    
    return Math.max(0, score);
  }

  // Generate performance recommendations
  generateRecommendations(metrics) {
    const recommendations = [];
    
    if (metrics.memory.heapUsed.percentage > 70) {
      recommendations.push({
        type: 'memory',
        priority: 'high',
        message: 'Consider implementing memory optimization strategies',
        actions: ['Enable garbage collection', 'Reduce batch sizes', 'Implement memory caching limits']
      });
    }
    
    if (metrics.system.cpu && metrics.system.cpu.usage > 70) {
      recommendations.push({
        type: 'cpu',
        priority: 'medium',
        message: 'High CPU usage detected',
        actions: ['Reduce queue concurrency', 'Optimize algorithms', 'Consider horizontal scaling']
      });
    }
    
    if (metrics.database.pool && metrics.database.pool.waitingCount > 0) {
      recommendations.push({
        type: 'database',
        priority: 'medium',
        message: 'Database connection pool under pressure',
        actions: ['Increase pool size', 'Optimize queries', 'Implement connection pooling']
      });
    }
    
    return recommendations;
  }
}

module.exports = new MonitoringService();