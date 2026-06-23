import { NextRequest } from "next/server";
import { verifyToken, verifySSEToken, ApiError, AuthError } from "@/lib/auth";

// ──────────────────────────────────────────────
// SSE Event Bus (in-memory, per-user) 
// ──────────────────────────────────────────────
// Each connected client registers a callback. 
// broadcastEvent() dispatches to all callbacks for a user.

const eventStreams = new Map<string, Set<(event: string) => void>>();

export function broadcastEvent(
  userId: string,
  eventType: string,
  data: Record<string, unknown>,
): void {
  const callbacks = eventStreams.get(userId);
  if (!callbacks || callbacks.size === 0) return;

  const event = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const cb of callbacks) {
    try {
      cb(event);
    } catch {
      // Callback threw — client already disconnected; will be cleaned up on abort
    }
  }
}

// ──────────────────────────────────────────────
// GET /api/v1/events — SSE stream
// ──────────────────────────────────────────────
// Auth: Authorization header or ?token= query param
// (EventSource API cannot set custom headers, so query param is required for browser)

export async function GET(request: NextRequest) {
  try {
    // ── Auth: try header first (standard API), then query param (SSE-specialized) ──
    let userId: string;

    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      // C4: Standard auth uses verifyToken which validates type is "access" or "refresh"
      const payload = verifyToken(authHeader.slice(7));
      if (!payload) throw new AuthError("Invalid or expired token", 401);
      userId = payload.userId;
    } else {
      const tokenParam = request.nextUrl.searchParams.get("token");
      if (!tokenParam) throw new AuthError("Missing authorization", 401);
      // C4: SSE token must have type "sse" (short-lived, 5 min)
      const sseUserId = verifySSEToken(tokenParam);
      if (!sseUserId) throw new AuthError("Invalid or expired SSE token", 401);
      userId = sseUserId;
    }

    // ── Create SSE stream ──
    const encoder = new TextEncoder();
    let closed = false;
    let heartbeat: NodeJS.Timeout | null = null;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

    // Register callback for this user's events
    const callback = (event: string) => {
      if (!closed && streamController) {
        try {
          streamController.enqueue(encoder.encode(event));
        } catch {
          closed = true;
        }
      }
    };

    // S7: Centralized cleanup function — called from both abort and cancel
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      const callbacks = eventStreams.get(userId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          eventStreams.delete(userId);
        }
      }
    };

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
        // Send initial connected event
        controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

        if (!eventStreams.has(userId)) {
          eventStreams.set(userId, new Set());
        }
        eventStreams.get(userId)!.add(callback);

        // Heartbeat every 15s to keep connection alive
        heartbeat = setInterval(() => {
          if (closed) {
            if (heartbeat) clearInterval(heartbeat);
            return;
          }
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            cleanup();
          }
        }, 15_000);

        // Cleanup on client disconnect
        request.signal.addEventListener("abort", cleanup);
      },
      // S7: Implement cancel to prevent memory leak when consumer calls reader.cancel()
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return new Response(
        `event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`,
        {
          status: 200, // SSE must return 200; error is communicated via event
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        },
      );
    }
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: "Internal server error" })}\n\n`,
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      },
    );
  }
}