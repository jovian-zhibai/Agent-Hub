// ──────────────────────────────────────────────
// API Validation Schemas
// Using Zod for request validation
// ──────────────────────────────────────────────

import { z } from "zod";

// ──────────────────────────────────────────────
// Common Schemas
// ──────────────────────────────────────────────

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ──────────────────────────────────────────────
// Auth Schemas
// ──────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  plan: z.enum(["free", "pro", "team"]).optional().default("free"),
});

// ──────────────────────────────────────────────
// Agent Schemas
// ──────────────────────────────────────────────

export const createAgentSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  framework: z.enum(["opencode", "claude-code", "other"]),
  machineId: z.string().min(1, "Machine ID is required"),
  projectName: z.string().max(200).optional(),
  projectPath: z.string().max(500).optional(),
  safetyMode: z.boolean().optional().default(false),
  monthlyBudget: z.number().positive().optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(["running", "idle", "disabled", "offline", "error"]).optional(),
  safetyMode: z.boolean().optional(),
  monthlyBudget: z.number().positive().optional().nullable(),
  enabled: z.boolean().optional(),
});

// ──────────────────────────────────────────────
// Key Schemas
// ──────────────────────────────────────────────

export const createKeySchema = z.object({
  providerId: z.string().min(1, "Provider ID is required"),
  protocol: z.string().min(1, "Protocol is required"),
  keyLabel: z.string().min(1, "Key label is required").max(100),
  keyValue: z.string().min(1, "API key value is required"),
  scope: z.enum(["personal", "workspace"]).optional().default("personal"),
  workspaceId: z.string().uuid().optional().nullable(),
  group: z.string().max(50).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  initialBalance: z.number().positive().optional().nullable(),
});

export const updateKeySchema = z.object({
  keyLabel: z.string().min(1).max(100).optional(),
  group: z.string().max(50).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  initialBalance: z.number().positive().optional().nullable(),
  isActive: z.boolean().optional(),
});

// ──────────────────────────────────────────────
// Key Binding Schemas
// ──────────────────────────────────────────────

export const keyBindingSchema = z.object({
  keyId: z.string().uuid(),
  priority: z.number().int().min(0),
  status: z.enum(["active", "standby", "depleted", "failed"]).optional().default("standby"),
});

export const updateKeyBindingsSchema = z.object({
  bindings: z.array(keyBindingSchema).min(1, "At least one key binding is required"),
});

// ──────────────────────────────────────────────
// Permission Schemas
// ──────────────────────────────────────────────

export const toolRuleSchema = z.object({
  allow: z.boolean().optional(),
  deny: z.boolean().optional(),
  ask: z.boolean().optional(),
  denyPaths: z.array(z.string()).optional(),
  writeDenyPaths: z.array(z.string()).optional(),
  safetyMode: z.object({
    deny: z.boolean().optional(),
  }).optional(),
});

export const permissionRulesSchema = z.object({
  version: z.number().int().optional().default(1),
  tools: z.record(z.string(), toolRuleSchema).optional(),
});

export const updatePermissionSchema = z.object({
  rules: permissionRulesSchema,
  safetyMode: z.boolean().optional(),
});

// ──────────────────────────────────────────────
// Provider Schemas
// ──────────────────────────────────────────────

export const createProviderSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  displayName: z.string().min(1, "Display name is required").max(100),
  supportedProtocols: z.array(z.string()).min(1, "At least one protocol is required"),
  baseUrls: z.record(z.string(), z.string().url()),
});

// ──────────────────────────────────────────────
// Model Schemas
// ──────────────────────────────────────────────

export const createModelSchema = z.object({
  providerId: z.string().uuid(),
  defaultProtocol: z.string().min(1),
  supportedProtocols: z.array(z.string()).min(1),
  modelName: z.string().min(1, "Model name is required"),
  displayName: z.string().min(1, "Display name is required"),
  pricingInput: z.number().min(0, "Input pricing must be non-negative"),
  pricingOutput: z.number().min(0, "Output pricing must be non-negative"),
  pricingSource: z.enum(["litellm", "openrouter", "manual", "unknown"]).optional().default("unknown"),
  isActive: z.boolean().optional().default(true),
});

export const updateModelSchema = z.object({
  displayName: z.string().min(1).optional(),
  pricingInput: z.number().min(0).optional(),
  pricingOutput: z.number().min(0).optional(),
  pricingSource: z.enum(["litellm", "openrouter", "manual", "unknown"]).optional(),
  isActive: z.boolean().optional(),
});

// ──────────────────────────────────────────────
// Telemetry Schemas
// ──────────────────────────────────────────────

export const telemetryEventSchema = z.object({
  agentId: z.string().uuid(),
  keyId: z.string().uuid().optional(),
  eventId: z.string().optional(), // B7: deterministic ID for idempotent ingestion
  eventType: z.enum([
    "tool_call",
    "token_usage",
    "permission_denied",
    "key_health",
    "heartbeat",
    "key_failover",
    "agent_enabled",
    "agent_disabled",
  ]),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.number().int().positive(),
});

export const batchTelemetrySchema = z.object({
  events: z.array(telemetryEventSchema).min(1).max(500),
});

// ──────────────────────────────────────────────
// Auth Schemas
// ──────────────────────────────────────────────

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

// ──────────────────────────────────────────────
// Helper: Validate and return typed data
// ──────────────────────────────────────────────

export class ValidationError extends Error {
  public errors: z.ZodError;
  
  constructor(message: string, errors: z.ZodError) {
    super(message);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

/**
 * Validate data against a Zod schema and return typed result.
 * Throws ValidationError if validation fails.
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    throw new ValidationError("Validation failed", result.error);
  }
  
  return result.data;
}

/**
 * Format Zod errors into a user-friendly message.
 */
export function formatValidationErrors(error: z.ZodError): string {
  return error.issues
    .map((err: z.ZodIssue) => {
      const path = err.path.join(".");
      return path ? `${path}: ${err.message}` : err.message;
    })
    .join(", ");
}
