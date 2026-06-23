// ──────────────────────────────────────────────
// Crypto Utilities Tests
// ──────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptKey,
  decryptKey,
  extractKeyPrefix,
  maskKey,
  validateMasterKey,
  generateMasterKey,
} from "../crypto";

describe("Crypto Utilities", () => {
  const ORIGINAL_ENV = process.env;
  const TEST_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeEach(() => {
    // Set up test environment
    process.env = { ...ORIGINAL_ENV };
    process.env.KEY_ENCRYPTION_KEY = TEST_MASTER_KEY;
  });

  afterEach(() => {
    // Restore original environment
    process.env = ORIGINAL_ENV;
  });

  describe("encryptKey", () => {
    it("should encrypt a plaintext key", () => {
      const plaintext = "sk-1234567890abcdef";
      const encrypted = encryptKey(plaintext);

      // Should have format: iv:ciphertext:authTag
      expect(encrypted).toContain(":");
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(3);
      
      // Each part should be hex
      parts.forEach((part) => {
        expect(part).toMatch(/^[0-9a-f]+$/i);
      });
    });

    it("should produce different ciphertexts for same plaintext", () => {
      const plaintext = "sk-test-key-12345";
      const encrypted1 = encryptKey(plaintext);
      const encrypted2 = encryptKey(plaintext);

      // Should be different due to random IV
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should throw error for empty key", () => {
      expect(() => encryptKey("")).toThrow("Cannot encrypt empty key");
      expect(() => encryptKey("   ")).toThrow("Cannot encrypt empty key");
    });

    it("should throw error if master key is missing", () => {
      delete process.env.KEY_ENCRYPTION_KEY;
      expect(() => encryptKey("test-key")).toThrow("KEY_ENCRYPTION_KEY environment variable is not set");
    });

    it("should throw error if master key is invalid length", () => {
      process.env.KEY_ENCRYPTION_KEY = "short";
      expect(() => encryptKey("test-key")).toThrow("KEY_ENCRYPTION_KEY must be 64 hex characters");
    });
  });

  describe("decryptKey", () => {
    it("should decrypt an encrypted key correctly", () => {
      const plaintext = "sk-original-key-12345";
      const encrypted = encryptKey(plaintext);
      const decrypted = decryptKey(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle special characters", () => {
      const plaintext = "test-key-!@#$%^&*()_+-=[]{}|;:',.<>?/`~";
      const encrypted = encryptKey(plaintext);
      const decrypted = decryptKey(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode characters", () => {
      const plaintext = "key-with-emoji-🔑-and-中文";
      const encrypted = encryptKey(plaintext);
      const decrypted = decryptKey(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw error for invalid format", () => {
      expect(() => decryptKey("invalid")).toThrow("Invalid encrypted key format");
      expect(() => decryptKey("only:two")).toThrow("Invalid encrypted key format");
    });

    it("should throw error for empty string", () => {
      expect(() => decryptKey("")).toThrow("Cannot decrypt empty string");
    });

    it("should throw error for tampered ciphertext", () => {
      const plaintext = "sk-test-key";
      const encrypted = encryptKey(plaintext);
      
      // Tamper with the ciphertext
      const parts = encrypted.split(":");
      parts[1] = parts[1]!.slice(0, -2) + "ff"; // Change last 2 chars
      const tampered = parts.join(":");

      expect(() => decryptKey(tampered)).toThrow("Key decryption failed");
    });

    it("should throw error with wrong master key", () => {
      const plaintext = "sk-test-key";
      const encrypted = encryptKey(plaintext);

      // Change the master key
      process.env.KEY_ENCRYPTION_KEY = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      expect(() => decryptKey(encrypted)).toThrow("Key decryption failed");
    });
  });

  describe("extractKeyPrefix", () => {
    it("should extract first N characters", () => {
      expect(extractKeyPrefix("sk-1234567890", 7)).toBe("sk-1234");
      expect(extractKeyPrefix("anthropic-key-abc", 8)).toBe("anthropi");
    });

    it("should handle short keys", () => {
      expect(extractKeyPrefix("short", 10)).toBe("short");
    });

    it("should handle empty keys", () => {
      expect(extractKeyPrefix("", 8)).toBe("");
    });

    it("should use default length of 8", () => {
      expect(extractKeyPrefix("sk-1234567890abcdef")).toBe("sk-12345");
    });
  });

  describe("maskKey", () => {
    it("should mask a key correctly", () => {
      const result = maskKey("sk-1234567890abcdef");
      expect(result).toBe("sk-12345...****");
    });

    it("should show full key if shorter than visible chars", () => {
      expect(maskKey("short", 10)).toBe("short");
    });

    it("should handle empty keys", () => {
      expect(maskKey("")).toBe("****");
    });

    it("should support custom visible chars", () => {
      expect(maskKey("sk-1234567890abcdef", 4)).toBe("sk-1...****");
    });
  });

  describe("validateMasterKey", () => {
    it("should validate correct master key", () => {
      expect(validateMasterKey(TEST_MASTER_KEY)).toBe(true);
    });

    it("should reject short keys", () => {
      expect(validateMasterKey("short")).toBe(false);
    });

    it("should reject long keys", () => {
      expect(validateMasterKey(TEST_MASTER_KEY + "ff")).toBe(false);
    });

    it("should reject non-hex keys", () => {
      expect(validateMasterKey("z".repeat(64))).toBe(false);
    });

    it("should reject empty keys", () => {
      expect(validateMasterKey("")).toBe(false);
    });
  });

  describe("generateMasterKey", () => {
    it("should generate a valid master key", () => {
      const key = generateMasterKey();
      expect(key).toHaveLength(64);
      expect(validateMasterKey(key)).toBe(true);
    });

    it("should generate different keys each time", () => {
      const key1 = generateMasterKey();
      const key2 = generateMasterKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("Round-trip encryption", () => {
    it("should handle various key formats", () => {
      const keys = [
        "sk-1234567890abcdef",
        "anthropic-key-xyz",
        "azure-key-ABC123",
        "very-long-key-" + "x".repeat(100),
        "short",
      ];

      keys.forEach((key) => {
        const encrypted = encryptKey(key);
        const decrypted = decryptKey(encrypted);
        expect(decrypted).toBe(key);
      });
    });
  });
});
