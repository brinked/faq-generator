const logger = require('../utils/logger');
const db = require('../config/database');

/**
 * Health Monitor Service
 * Provides real-time monitoring and alerts for the FAQ generator system
 * Prevents issues like memory exhaustion and processing failures
 */
class HealthMonitor {
  constructor() {
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.alertThresholds = {
      memoryUsage: 1.5 * 1024 * 1024 * 1024, // 1.5GB (75% of 2GB)
      consecutiveErrors: 5,
      processingTimeout: 300000, // 5 minutes
      dbConnectionTimeout: 10000 // 10 seconds
    };
    
    this.currentStatus = {
      memory: { healthy: true, usage: 0, timestamp: null },
      database: { healthy: true, responseTime: 0, timestamp: null },
      processing: { healthy: true, errors: 0, timestamp: null },
      openai: { healthy: true, responseTime: 0, timestamp: null }
    };
    
    this.alerts = [];
    this.maxAlerts = 50; // Keep last 50 alerts
  }

  /**
   * Start health monitoring
   */
  startMonitoring(intervalMs = 30000) { // Check every 30 seconds
    if (this.isMonitoring) {
      logger.warn('Health monitoring is already running');
      return;
    }
    
    logger.info('🏥 Starting health monitoring system...');
    this.isMonitoring = true;
    
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        logger.error('Health monitoring check failed:', error);
      }
    }, intervalMs);
    
    // Initial health check
    this.performHealthChecks();
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    logger.info('🏥 Health monitoring stopped');
  }

  /**
   * Perform comprehensive health checks
   */
  async performHealthChecks() {
    const timestamp = new Date();
    
    // Check memory usage
    await this.checkMemoryHealth(timestamp);
    
    // Check database health
    await this.checkDatabaseHealth(timestamp);
    
    // Check processing health
    await this.checkProcessingHealth(timestamp);
    
    // Log overall health status
    this.logHealthStatus();
  }

  /**
   * Check memory usage and trigger alerts if needed
   */
  async checkMemoryHealth(timestamp) {
    try {
      const memUsage = process.memoryUsage();
      const heapUsed = memUsage.heapUsed;
      const heapTotal = memUsage.heapTotal;
      const external = memUsage.external;
      
      const isHealthy = heapUsed < this.alertThresholds.memoryUsage;
      
      this.currentStatus.memory = {
        healthy: isHealthy,
        usage: heapUsed,
        heapTotal,
        external,
        usagePercent: Math.round((heapUsed / (2 * 1024 * 1024 * 1024)) * 100), // % of 2GB
        timestamp
      };
      
      if (!isHealthy) {
        const alert = {
          type: 'memory_high',
          severity: 'critical',
          message: `High memory usage: ${Math.round(heapUsed / 1024 / 1024)}MB (${this.currentStatus.memory.usagePercent}% of 2GB limit)`,
          timestamp,
          data: { heapUsed, heapTotal, external }
        };
        
        this.addAlert(alert);
        
        // Force garbage collection if available
        if (global.gc) {
          logger.warn('🗑️  Forcing garbage collection due to high memory usage');
          global.gc();
        }
      }
      
    } catch (error) {
      logger.error('Memory health check failed:', error);
      this.currentStatus.memory = {
        healthy: false,
        error: error.message,
        timestamp
      };
    }
  }

  /**
   * Check database connectivity and performance
   */
  async checkDatabaseHealth(timestamp) {
    try {
      const startTime = Date.now();
      
      // Simple connectivity test
      await db.query('SELECT 1 as health_check');
      
      const responseTime = Date.now() - startTime;
      const isHealthy = responseTime < this.alertThresholds.dbConnectionTimeout;
      
      this.currentStatus.database = {
        healthy: isHealthy,
        responseTime,
        timestamp
      };
      
      if (!isHealthy) {
        const alert = {
          type: 'database_slow',
          severity: 'warning',
          message: `Slow database response: ${responseTime}ms`,
          timestamp,
          data: { responseTime }
        };
        
        this.addAlert(alert);
      }
      
    } catch (error) {
      logger.error('Database health check failed:', error);
      
      const alert = {
        type: 'database_error',
        severity: 'critical',
        message: `Database connection failed: ${error.message}`,
        timestamp,
        data: { error: error.message }
      };
      
      this.addAlert(alert);
      
      this.currentStatus.database = {
        healthy: false,
        error: error.message,
        timestamp
      };
    }
  }

  /**
   * Check processing health and error rates
   */
  async checkProcessingHealth(timestamp) {
    try {
      // Check recent processing errors
      const errorQuery = `
        SELECT COUNT(*) as error_count
        FROM emails 
        WHERE processing_status = 'failed' 
        AND updated_at > NOW() - INTERVAL '10 minutes'
      `;
      
      const errorResult = await db.query(errorQuery);
      const recentErrors = parseInt(errorResult.rows[0].error_count);
      
      const isHealthy = recentErrors < this.alertThresholds.consecutiveErrors;
      
      this.currentStatus.processing = {
        healthy: isHealthy,
        errors: recentErrors,
        timestamp
      };
      
      if (!isHealthy) {
        const alert = {
          type: 'processing_errors',
          severity: 'warning',
          message: `High processing error rate: ${recentErrors} errors in last 10 minutes`,
          timestamp,
          data: { errorCount: recentErrors }
        };
        
        this.addAlert(alert);
      }
      
    } catch (error) {
      logger.error('Processing health check failed:', error);
      this.currentStatus.processing = {
        healthy: false,
        error: error.message,
        timestamp
      };
    }
  }

  /**
   * Add alert to the system
   */
  addAlert(alert) {
    this.alerts.unshift(alert);
    
    // Keep only the most recent alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }
    
    // Log the alert
    const logLevel = alert.severity === 'critical' ? 'error' : 'warn';
    logger[logLevel](`🚨 HEALTH ALERT [${alert.type}]: ${alert.message}`);
  }

  /**
   * Log overall health status
   */
  logHealthStatus() {
    const overallHealthy = Object.values(this.currentStatus).every(status => status.healthy);
    
    if (overallHealthy) {
      logger.debug('💚 System health: All systems operational');
    } else {
      const unhealthyComponents = Object.entries(this.currentStatus)
        .filter(([_, status]) => !status.healthy)
        .map(([component, _]) => component);
      
      logger.warn(`💛 System health: Issues detected in: ${unhealthyComponents.join(', ')}`);
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    const overallHealthy = Object.values(this.currentStatus).every(status => status.healthy);
    
    return {
      overall: overallHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      components: this.currentStatus,
      recentAlerts: this.alerts.slice(0, 10), // Last 10 alerts
      monitoring: this.isMonitoring
    };
  }

  /**
   * Get health metrics for API endpoint
   */
  getHealthMetrics() {
    const memStatus = this.currentStatus.memory;
    const dbStatus = this.currentStatus.database;
    const procStatus = this.currentStatus.processing;
    
    return {
      memory: {
        healthy: memStatus.healthy,
        usageMB: memStatus.usage ? Math.round(memStatus.usage / 1024 / 1024) : 0,
        usagePercent: memStatus.usagePercent || 0,
        limit: '2048MB'
      },
      database: {
        healthy: dbStatus.healthy,
        responseTimeMs: dbStatus.responseTime || 0,
        status: dbStatus.healthy ? 'connected' : 'error'
      },
      processing: {
        healthy: procStatus.healthy,
        recentErrors: procStatus.errors || 0,
        status: procStatus.healthy ? 'operational' : 'degraded'
      },
      alerts: {
        total: this.alerts.length,
        critical: this.alerts.filter(a => a.severity === 'critical').length,
        recent: this.alerts.slice(0, 5)
      }
    };
  }

  /**
   * Check if system is ready for processing
   */
  isReadyForProcessing() {
    const memHealthy = this.currentStatus.memory.healthy;
    const dbHealthy = this.currentStatus.database.healthy;
    const procHealthy = this.currentStatus.processing.healthy;
    
    return memHealthy && dbHealthy && procHealthy;
  }

  /**
   * Get processing recommendations based on current health
   */
  getProcessingRecommendations() {
    const recommendations = [];
    
    if (!this.currentStatus.memory.healthy) {
      recommendations.push({
        type: 'memory',
        action: 'reduce_batch_size',
        message: 'Reduce batch size due to high memory usage'
      });
    }
    
    if (!this.currentStatus.database.healthy) {
      recommendations.push({
        type: 'database',
        action: 'delay_processing',
        message: 'Delay processing due to database issues'
      });
    }
    
    if (!this.currentStatus.processing.healthy) {
      recommendations.push({
        type: 'processing',
        action: 'increase_delays',
        message: 'Increase delays between operations due to recent errors'
      });
    }
    
    return recommendations;
  }
}

// Create singleton instance
const healthMonitor = new HealthMonitor();

module.exports = healthMonitor;