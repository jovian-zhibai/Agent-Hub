// ──────────────────────────────────────────────
// Agent Hub — Crypto Utilities
// AES-256-GCM encryption for API keys
// ──────────────────────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const ENCODING = "hex";

/**
 * Get the master encryption key from environment variable.
 * Must be 32 bytes (64 hex characters).
 */
function getMasterKey(): Buffer {
  const keyHex = process.env.KEY_ENCRYPTION_KEY;
  
  if (!keyHex) {
    throw new Error(
      "KEY_ENCRYPTION_KEY environment variable is not set. " +
      "Run 'npm run setup' to generate one."
    );
  }

  if (keyHex.length !== 64) {
    throw new Error(
      `KEY_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ` +
      `Got ${keyHex.length} characters.`
    );
  }

  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt a plaintext API key using AES-256-GCM.
 * 
 * Format: <iv>:<encrypted>:<authTag>
 * All parts are hex-encoded.
 * 
 * @param plaintext - The API key to encrypt
 * @returns Encrypted string in format "iv:ciphertext:authTag"
 * 
 * @example
 * const encrypted = encryptKey("sk-1234567890abcdef");
 * // Returns: "a1b2c3d4...:<ciphertext>:<authTag>"
 */
export function encryptKey(plaintext: string): string {
  if (!plaintext || plaintext.trim().length === 0) {
    throw new Error("Cannot encrypt empty key");
  }

  try {
    const masterKey = getMasterKey();
    const iv = randomBytes(IV_LENGTH);
    
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);
    
    let encrypted = cipher.update(plaintext, "utf8", ENCODING);
    encrypted += cipher.final(ENCODING);
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:encrypted:authTag (all hex)
    return `${iv.toString(ENCODING)}:${encrypted}:${authTag.toString(ENCODING)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Key encryption failed: ${message}`);
  }
}

/**
 * Decrypt an encrypted API key.
 * 
 * @param encrypted - Encrypted string in format "iv:ciphertext:authTag"
 * @returns Decrypted plaintext API key
 * 
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 * 
 * @example
 * const decrypted = decryptKey(encryptedKey);
 * // Returns: "sk-1234567890abcdef"
 */
export function decryptKey(encrypted: string): string {
  if (!encrypted || encrypted.trim().length === 0) {
    throw new Error("Cannot decrypt empty string");
  }

  try {
    const parts = encrypted.split(":");
    if (parts.length !== 3) {
      throw new Error(
        "Invalid encrypted key format. Expected 'iv:ciphertext:authTag'"
      );
    }

    const [ivHex, encryptedHex, authTagHex] = parts;
    if (!ivHex || !encryptedHex || !authTagHex) {
      throw new Error(
        "Invalid encrypted key format. Expected 'iv:ciphertext:authTag'"
      );
    }

    const masterKey = getMasterKey();
    const iv = Buffer.from(ivHex, ENCODING);
    const authTag = Buffer.from(authTagHex, ENCODING);
    
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, ENCODING, "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Key decryption failed: ${message}`);
  }
}

/**
 * Extract the first N characters of a plaintext key for display purposes.
 * 
 * @param plaintext - The API key
 * @param length - Number of characters to extract (default: 8)
 * @returns Prefix string for display (e.g., "sk-1234")
 * 
 * @example
 * const prefix = extractKeyPrefix("sk-1234567890abcdef", 7);
 * // Returns: "sk-1234"
 */
export function extractKeyPrefix(plaintext: string, length = 8): string {
  if (!plaintext) {
    return "";
  }
  return plaintext.slice(0, Math.min(length, plaintext.length));
}

/**
 * Mask an API key for display purposes.
 * Shows only the prefix and masks the rest.
 * 
 * @param plaintext - The API key
 * @param visibleChars - Number of visible characters (default: 8)
 * @returns Masked string (e.g., "sk-1234...****")
 * 
 * @example
 * const masked = maskKey("sk-1234567890abcdef");
 * // Returns: "sk-1234...****"
 */
export function maskKey(plaintext: string, visibleChars = 8): string {
  if (!plaintext) {
    return "****";
  }
  
  if (plaintext.length <= visibleChars) {
    return plaintext;
  }
  
  const prefix = plaintext.slice(0, visibleChars);
  return `${prefix}...****`;
}

/**
 * Validate that a key encryption key is properly formatted.
 * 
 * @param keyHex - Hex-encoded encryption key
 * @returns true if valid, false otherwise
 */
export function validateMasterKey(keyHex: string): boolean {
  if (!keyHex || keyHex.length !== 64) {
    return false;
  }
  
  // Check if it's valid hex
  return /^[0-9a-f]{64}$/i.test(keyHex);
}

/**
 * Generate a random encryption key (for setup scripts).
 * 
 * @returns 64-character hex string (32 bytes)
 */
export function generateMasterKey(): string {
  return randomBytes(32).toString("hex");
}
