const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which level to log based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }),
  
  // File transport for errors
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
  
  // File transport for all logs
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Add request logging middleware
logger.requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
    
    if (res.statusCode >= 400) {
      logger.error(message);
    } else {
      logger.http(message);
    }
  });
  
  next();
};

// Add error logging helper
logger.logError = (error, context = {}) => {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    ...context
  };
  
  logger.error('Application Error:', errorInfo);
};

// Add performance logging helper
logger.logPerformance = (operation, duration, metadata = {}) => {
  logger.info(`Performance: ${operation} completed in ${duration}ms`, metadata);
};

// Add database query logging helper
logger.logQuery = (query, duration, rowCount) => {
  if (process.env.LOG_QUERIES === 'true') {
    logger.debug(`Query executed in ${duration}ms, returned ${rowCount} rows: ${query}`);
  }
};

// Add API call logging helper
logger.logApiCall = (service, endpoint, duration, status) => {
  const message = `API Call: ${service} ${endpoint} - ${status} (${duration}ms)`;
  
  if (status >= 400) {
    logger.warn(message);
  } else {
    logger.info(message);
  }
};

// Add job processing logging helper
logger.logJob = (jobName, status, duration, metadata = {}) => {
  const message = `Job: ${jobName} - ${status}`;
  
  if (duration) {
    logger.info(`${message} (${duration}ms)`, metadata);
  } else {
    logger.info(message, metadata);
  }
};

// Add email processing logging helper
logger.logEmailProcessing = (accountId, emailCount, duration) => {
  logger.info(`Email Processing: Account ${accountId} - ${emailCount} emails processed in ${duration}ms`);
};

// Add FAQ generation logging helper
logger.logFaqGeneration = (questionCount, faqCount, duration) => {
  logger.info(`FAQ Generation: ${questionCount} questions processed, ${faqCount} FAQs generated in ${duration}ms`);
};

module.exports = logger;