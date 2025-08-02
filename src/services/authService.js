const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger');

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
  }

  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password) {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  /**
   * Hash a token using SHA-256 (deterministic)
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Compare a password with its hash
   */
  async comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT token for admin user
   */
  generateToken(userId, username) {
    return jwt.sign(
      { 
        userId, 
        username, 
        type: 'admin',
        iat: Math.floor(Date.now() / 1000)
      },
      this.jwtSecret,
      { expiresIn: this.jwtExpiresIn }
    );
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      logger.error('Token verification failed:', error.message);
      return null;
    }
  }

  /**
   * Admin login
   */
  async login(username, password) {
    try {
      // Get admin user
      const result = await db.query(
        'SELECT id, username, email, password_hash, is_active FROM admin_users WHERE username = $1 OR email = $1',
        [username]
      );

      if (result.rows.length === 0) {
        return { success: false, message: 'Invalid credentials' };
      }

      const user = result.rows[0];

      if (!user.is_active) {
        return { success: false, message: 'Account is disabled' };
      }

      // Verify password
      const isValidPassword = await this.comparePassword(password, user.password_hash);
      if (!isValidPassword) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Generate token
      const token = this.generateToken(user.id, user.username);

      // Update last login
      await db.query(
        'UPDATE admin_users SET last_login_at = NOW() WHERE id = $1',
        [user.id]
      );

      // Store session in database
      const tokenHash = this.hashToken(token);
      await db.query(
        'INSERT INTO admin_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, new Date(Date.now() + 24 * 60 * 60 * 1000)] // 24 hours
      );

      logger.info(`Admin login successful: ${user.username}`);

      return {
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      };
    } catch (error) {
      logger.error('Login error:', error);
      return { success: false, message: 'Login failed' };
    }
  }

  /**
   * Verify admin session
   */
  async verifySession(token) {
    try {
      const decoded = this.verifyToken(token);
      if (!decoded) {
        return { valid: false, message: 'Invalid token' };
      }

      // Check if session exists in database
      const tokenHash = this.hashToken(token);
      const sessionResult = await db.query(
        'SELECT s.*, u.username, u.email FROM admin_sessions s JOIN admin_users u ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > NOW()',
        [tokenHash]
      );

      if (sessionResult.rows.length === 0) {
        return { valid: false, message: 'Session expired' };
      }

      const session = sessionResult.rows[0];
      return {
        valid: true,
        user: {
          id: session.user_id,
          username: session.username,
          email: session.email
        }
      };
    } catch (error) {
      logger.error('Session verification error:', error);
      return { valid: false, message: 'Session verification failed' };
    }
  }

  /**
   * Logout admin user
   */
  async logout(token) {
    try {
      const tokenHash = this.hashToken(token);
      await db.query(
        'DELETE FROM admin_sessions WHERE token_hash = $1',
        [tokenHash]
      );
      return { success: true };
    } catch (error) {
      logger.error('Logout error:', error);
      return { success: false, message: 'Logout failed' };
    }
  }

  /**
   * Get admin user by ID
   */
  async getAdminUser(userId) {
    try {
      const result = await db.query(
        'SELECT id, username, email, is_active, last_login_at, created_at FROM admin_users WHERE id = $1',
        [userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Get admin user error:', error);
      return null;
    }
  }

  /**
   * Update admin password
   */
  async updatePassword(userId, newPassword) {
    try {
      const passwordHash = await this.hashPassword(newPassword);
      await db.query(
        'UPDATE admin_users SET password_hash = $1 WHERE id = $2',
        [passwordHash, userId]
      );
      return { success: true };
    } catch (error) {
      logger.error('Update password error:', error);
      return { success: false, message: 'Password update failed' };
    }
  }

  /**
   * Initialize admin user from environment variables
   */
  async initializeAdminUser() {
    try {
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@faqgenerator.com';
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (!adminPassword) {
        logger.warn('ADMIN_PASSWORD not set, using default password');
        return;
      }

      // Check if admin user exists
      const existingUser = await db.query(
        'SELECT id FROM admin_users WHERE username = $1 OR email = $2',
        [adminUsername, adminEmail]
      );

      if (existingUser.rows.length === 0) {
        // Create new admin user
        const passwordHash = await this.hashPassword(adminPassword);
        await db.query(
          'INSERT INTO admin_users (username, email, password_hash) VALUES ($1, $2, $3)',
          [adminUsername, adminEmail, passwordHash]
        );
        logger.info('Admin user created from environment variables');
      } else {
        // Update existing admin user password
        const passwordHash = await this.hashPassword(adminPassword);
        await db.query(
          'UPDATE admin_users SET password_hash = $1 WHERE username = $2 OR email = $3',
          [passwordHash, adminUsername, adminEmail]
        );
        logger.info('Admin user password updated from environment variables');
      }
    } catch (error) {
      logger.error('Initialize admin user error:', error);
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions() {
    try {
      const result = await db.query(
        'DELETE FROM admin_sessions WHERE expires_at < NOW()'
      );
      logger.info(`Cleaned up ${result.rowCount} expired sessions`);
    } catch (error) {
      logger.error('Cleanup expired sessions error:', error);
    }
  }
}

module.exports = AuthService; 