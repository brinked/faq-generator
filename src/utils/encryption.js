const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Get encryption key from environment or generate one
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  
  if (key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be exactly ${KEY_LENGTH} characters long`);
  }
  
  return Buffer.from(key, 'utf8');
}

/**
 * Encrypt a string
 */
function encrypt(text) {
  if (!text) {
    return null;
  }
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from('faq-generator', 'utf8'));
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Combine iv, tag, and encrypted data
    const combined = iv.toString('hex') + tag.toString('hex') + encrypted;
    
    return combined;
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt a string
 */
function decrypt(encryptedData) {
  if (!encryptedData) {
    return null;
  }
  
  try {
    const key = getEncryptionKey();
    
    // Extract iv, tag, and encrypted data
    const ivHex = encryptedData.slice(0, IV_LENGTH * 2);
    const tagHex = encryptedData.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2);
    const encrypted = encryptedData.slice((IV_LENGTH + TAG_LENGTH) * 2);
    
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from('faq-generator', 'utf8'));
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Generate a random encryption key
 */
function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('base64').slice(0, KEY_LENGTH);
}

/**
 * Hash a password using bcrypt-like approach with crypto
 */
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512');
  return salt + ':' + hash.toString('hex');
}

/**
 * Verify a password against a hash
 */
function verifyPassword(password, hashedPassword) {
  const [salt, hash] = hashedPassword.split(':');
  const hashToVerify = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512');
  return hash === hashToVerify.toString('hex');
}

/**
 * Generate a secure random token
 */
function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Create HMAC signature
 */
function createHmacSignature(data, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  return hmac.digest('hex');
}

/**
 * Verify HMAC signature
 */
function verifyHmacSignature(data, signature, secret) {
  const expectedSignature = createHmacSignature(data, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Encrypt sensitive data for database storage
 */
function encryptForStorage(data) {
  if (typeof data === 'object') {
    data = JSON.stringify(data);
  }
  return encrypt(data.toString());
}

/**
 * Decrypt sensitive data from database storage
 */
function decryptFromStorage(encryptedData, parseJson = false) {
  const decrypted = decrypt(encryptedData);
  
  if (parseJson && decrypted) {
    try {
      return JSON.parse(decrypted);
    } catch (error) {
      throw new Error('Failed to parse decrypted JSON data');
    }
  }
  
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
  generateEncryptionKey,
  hashPassword,
  verifyPassword,
  generateSecureToken,
  createHmacSignature,
  verifyHmacSignature,
  encryptForStorage,
  decryptFromStorage
};