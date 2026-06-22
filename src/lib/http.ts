// ──────────────────────────────────────────────
// Agent Hub — HTTP Response Helpers
//
// Collapses the ~20 duplicated try/catch tails and ~15
// duplicated NOT_FOUND/FORBIDDEN responses across the API
// routes into a small set of helpers. All error responses
// keep the existing `{ code, message }` shape so the client
// (`src/lib/api.ts`) and frontend continue to work unchanged.
// ──────────────────────────────────────────────

import { NextResponse } from "next/server";
import { ApiError, AuthError } from "./auth";

// ──────────────────────────────────────────────
// Error code constants (single source of truth)
// ──────────────────────────────────────────────

export const ERROR_CODE = {
  AUTH_ERROR: "AUTH_ERROR",
  API_ERROR: "API_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

// ──────────────────────────────────────────────
// Error responses
// ──────────────────────────────────────────────

export function errorResponse(
  code: string,
  message: string,
  status: number,
) {
  return NextResponse.json({ code, message }, { status });
}

export function notFound(message = "Resource not found") {
  return errorResponse(ERROR_CODE.NOT_FOUND, message, 404);
}

export function forbidden(message = "Access denied") {
  return errorResponse(ERROR_CODE.FORBIDDEN, message, 403);
}

export function validationError(message = "Validation failed", status = 400) {
  return errorResponse(ERROR_CODE.VALIDATION_ERROR, message, status);
}

export function conflict(message = "Resource already exists") {
  return errorResponse(ERROR_CODE.CONFLICT, message, 409);
}

// ──────────────────────────────────────────────
// Unified try/catch tail
// ──────────────────────────────────────────────

/**
 * Handle an error thrown from an API route handler.
 *
 * - `AuthError` / `ApiError` → mapped to their statusCode with the
 *   appropriate code (AUTH_ERROR vs API_ERROR), preserving the
 *   existing distinction the frontend relies on.
 * - everything else → logged with `label` for traceability and
 *   returned as a generic 500 INTERNAL_ERROR (message never leaks
 *   the raw error to the client).
 *
 * Replaces the copy-pasted `if (error instanceof ApiError) {...}` +
 * `console.error("[route] ...")` tail in ~20 routes.
 */
export function handleApiError(error: unknown, label: string): NextResponse {
  if (error instanceof ApiError) {
    const code =
      error instanceof AuthError ? ERROR_CODE.AUTH_ERROR : ERROR_CODE.API_ERROR;
    return errorResponse(code, error.message, error.statusCode);
  }

  // eslint-disable-next-line no-console
  console.error(`[${label}] Unexpected error:`, error);
  return errorResponse(
    ERROR_CODE.INTERNAL_ERROR,
    "Internal server error",
    500,
  );
}
