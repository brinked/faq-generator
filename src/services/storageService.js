const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const logger = require('../utils/logger');

class StorageService {
  constructor() {
    // Render.com uses ephemeral storage, so we need to handle file storage carefully
    this.baseDir = process.env.STORAGE_PATH || '/tmp/faq-generator';
    this.maxFileSize = 50 * 1024 * 1024; // 50MB max file size
    this.maxStorageSize = 500 * 1024 * 1024; // 500MB max total storage
    this.cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
    
    this.init();
  }

  async init() {
    try {
      // Ensure base directory exists
      await this.ensureDirectory(this.baseDir);
      
      // Create subdirectories
      await this.ensureDirectory(path.join(this.baseDir, 'exports'));
      await this.ensureDirectory(path.join(this.baseDir, 'backups'));
      await this.ensureDirectory(path.join(this.baseDir, 'temp'));
      await this.ensureDirectory(path.join(this.baseDir, 'logs'));
      
      // Start cleanup scheduler
      this.startCleanupScheduler();
      
      logger.info(`Storage service initialized at ${this.baseDir}`);
    } catch (error) {
      logger.error('Failed to initialize storage service:', error);
      throw error;
    }
  }

  async ensureDirectory(dirPath) {
    try {
      await fs.access(dirPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(dirPath, { recursive: true });
        logger.info(`Created directory: ${dirPath}`);
      } else {
        throw error;
      }
    }
  }

  // Store file with automatic cleanup
  async storeFile(filename, data, category = 'temp') {
    try {
      const categoryDir = path.join(this.baseDir, category);
      await this.ensureDirectory(categoryDir);
      
      const filePath = path.join(categoryDir, filename);
      
      // Check file size
      const dataSize = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
      if (dataSize > this.maxFileSize) {
        throw new Error(`File size ${dataSize} exceeds maximum allowed size ${this.maxFileSize}`);
      }
      
      // Check total storage usage
      await this.checkStorageLimit();
      
      // Store file
      await fs.writeFile(filePath, data);
      
      // Set file metadata
      const stats = await fs.stat(filePath);
      const metadata = {
        filename,
        category,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        path: filePath
      };
      
      logger.info(`File stored: ${filename} (${stats.size} bytes) in ${category}`);
      return metadata;
      
    } catch (error) {
      logger.error(`Failed to store file ${filename}:`, error);
      throw error;
    }
  }

  // Retrieve file
  async getFile(filename, category = 'temp') {
    try {
      const filePath = path.join(this.baseDir, category, filename);
      
      // Check if file exists
      await fs.access(filePath);
      
      // Read file
      const data = await fs.readFile(filePath);
      const stats = await fs.stat(filePath);
      
      return {
        data,
        metadata: {
          filename,
          category,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          path: filePath
        }
      };
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filename}`);
      }
      logger.error(`Failed to retrieve file ${filename}:`, error);
      throw error;
    }
  }

  // Delete file
  async deleteFile(filename, category = 'temp') {
    try {
      const filePath = path.join(this.baseDir, category, filename);
      await fs.unlink(filePath);
      logger.info(`File deleted: ${filename} from ${category}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false; // File doesn't exist
      }
      logger.error(`Failed to delete file ${filename}:`, error);
      throw error;
    }
  }

  // List files in category
  async listFiles(category = 'temp') {
    try {
      const categoryDir = path.join(this.baseDir, category);
      const files = await fs.readdir(categoryDir);
      
      const fileList = [];
      for (const filename of files) {
        const filePath = path.join(categoryDir, filename);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          fileList.push({
            filename,
            category,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            path: filePath
          });
        }
      }
      
      return fileList.sort((a, b) => b.modified - a.modified);
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      logger.error(`Failed to list files in ${category}:`, error);
      throw error;
    }
  }

  // Create export archive
  async createExportArchive(data, filename) {
    try {
      const archivePath = path.join(this.baseDir, 'exports', filename);
      const output = require('fs').createWriteStream(archivePath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      return new Promise((resolve, reject) => {
        output.on('close', () => {
          logger.info(`Export archive created: ${filename} (${archive.pointer()} bytes)`);
          resolve({
            filename,
            path: archivePath,
            size: archive.pointer()
          });
        });
        
        archive.on('error', reject);
        archive.pipe(output);
        
        // Add data to archive
        if (typeof data === 'object') {
          for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string') {
              archive.append(value, { name: key });
            } else {
              archive.append(JSON.stringify(value, null, 2), { name: `${key}.json` });
            }
          }
        } else {
          archive.append(data, { name: 'data.json' });
        }
        
        archive.finalize();
      });
      
    } catch (error) {
      logger.error(`Failed to create export archive ${filename}:`, error);
      throw error;
    }
  }

  // Create backup
  async createBackup(data, filename) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `${filename}-${timestamp}.json`;
      
      const backupData = {
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        data
      };
      
      return await this.storeFile(
        backupFilename,
        JSON.stringify(backupData, null, 2),
        'backups'
      );
      
    } catch (error) {
      logger.error(`Failed to create backup ${filename}:`, error);
      throw error;
    }
  }

  // Restore from backup
  async restoreFromBackup(filename) {
    try {
      const file = await this.getFile(filename, 'backups');
      const backupData = JSON.parse(file.data.toString());
      
      logger.info(`Restored backup from ${backupData.timestamp}`);
      return backupData.data;
      
    } catch (error) {
      logger.error(`Failed to restore backup ${filename}:`, error);
      throw error;
    }
  }

  // Check storage limit and cleanup if necessary
  async checkStorageLimit() {
    try {
      const totalSize = await this.getTotalStorageSize();
      
      if (totalSize > this.maxStorageSize) {
        logger.warn(`Storage limit exceeded: ${totalSize} > ${this.maxStorageSize}`);
        await this.cleanupOldFiles();
      }
      
    } catch (error) {
      logger.error('Failed to check storage limit:', error);
    }
  }

  // Get total storage size
  async getTotalStorageSize() {
    let totalSize = 0;
    
    const categories = ['exports', 'backups', 'temp', 'logs'];
    
    for (const category of categories) {
      try {
        const files = await this.listFiles(category);
        totalSize += files.reduce((sum, file) => sum + file.size, 0);
      } catch (error) {
        // Category might not exist, continue
      }
    }
    
    return totalSize;
  }

  // Cleanup old files
  async cleanupOldFiles() {
    try {
      const categories = ['temp', 'exports', 'logs'];
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      const now = Date.now();
      
      let deletedCount = 0;
      let freedSpace = 0;
      
      for (const category of categories) {
        const files = await this.listFiles(category);
        
        for (const file of files) {
          const age = now - file.modified.getTime();
          
          if (age > maxAge) {
            freedSpace += file.size;
            await this.deleteFile(file.filename, category);
            deletedCount++;
          }
        }
      }
      
      // Keep only last 10 backups
      const backups = await this.listFiles('backups');
      if (backups.length > 10) {
        const oldBackups = backups.slice(10);
        for (const backup of oldBackups) {
          freedSpace += backup.size;
          await this.deleteFile(backup.filename, 'backups');
          deletedCount++;
        }
      }
      
      logger.info(`Cleanup completed: ${deletedCount} files deleted, ${freedSpace} bytes freed`);
      
    } catch (error) {
      logger.error('Failed to cleanup old files:', error);
    }
  }

  // Start cleanup scheduler
  startCleanupScheduler() {
    setInterval(() => {
      this.cleanupOldFiles();
    }, this.cleanupInterval);
    
    logger.info(`Cleanup scheduler started (interval: ${this.cleanupInterval}ms)`);
  }

  // Get storage statistics
  async getStorageStats() {
    try {
      const categories = ['exports', 'backups', 'temp', 'logs'];
      const stats = {
        total: {
          files: 0,
          size: 0
        },
        categories: {}
      };
      
      for (const category of categories) {
        const files = await this.listFiles(category);
        const categorySize = files.reduce((sum, file) => sum + file.size, 0);
        
        stats.categories[category] = {
          files: files.length,
          size: categorySize,
          sizeFormatted: this.formatBytes(categorySize)
        };
        
        stats.total.files += files.length;
        stats.total.size += categorySize;
      }
      
      stats.total.sizeFormatted = this.formatBytes(stats.total.size);
      stats.limits = {
        maxFileSize: this.maxFileSize,
        maxStorageSize: this.maxStorageSize,
        maxFileSizeFormatted: this.formatBytes(this.maxFileSize),
        maxStorageSizeFormatted: this.formatBytes(this.maxStorageSize)
      };
      
      stats.usage = {
        percentage: Math.round((stats.total.size / this.maxStorageSize) * 100),
        remaining: this.maxStorageSize - stats.total.size,
        remainingFormatted: this.formatBytes(this.maxStorageSize - stats.total.size)
      };
      
      return stats;
      
    } catch (error) {
      logger.error('Failed to get storage stats:', error);
      throw error;
    }
  }

  // Format bytes to human readable format
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Stream file for download
  async streamFile(filename, category = 'temp') {
    try {
      const filePath = path.join(this.baseDir, category, filename);
      
      // Check if file exists
      await fs.access(filePath);
      
      const stats = await fs.stat(filePath);
      const stream = require('fs').createReadStream(filePath);
      
      return {
        stream,
        size: stats.size,
        mimeType: this.getMimeType(filename)
      };
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filename}`);
      }
      throw error;
    }
  }

  // Get MIME type based on file extension
  getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.zip': 'application/zip',
      '.txt': 'text/plain',
      '.log': 'text/plain'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

module.exports = new StorageService();