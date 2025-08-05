const AuthService = require('../services/authService');
const logger = require('../utils/logger');

const authService = new AuthService();

/**
 * Middleware to verify admin authentication
 */
const requireAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') ||
      req.cookies?.adminToken ||
      req.query?.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const session = await authService.verifySession(token);

    if (!session.valid) {
      return res.status(401).json({
        success: false,
        message: session.message || 'Invalid session'
      });
    }

    // Add user info to request
    req.user = session.user;
    req.token = token;

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

/**
 * Optional auth middleware - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') ||
      req.cookies?.adminToken ||
      req.query?.token;

    if (token) {
      const session = await authService.verifySession(token);
      if (session.valid) {
        req.user = session.user;
        req.token = token;
      }
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next();
  }
};

/**
 * Middleware to check if user is admin
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

module.exports = {
  requireAuth,
  optionalAuth,
  requireAdmin
};
