import { Data } from "effect";

/**
 * Standard API Error structure for Elysia's global onError handler
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string = "INTERNAL_SERVER_ERROR",
    public status: number = 500,
    public data?: any
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized access") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = "Bad request") {
    super(message, "BAD_REQUEST", 400);
  }
}

// --- Effect-specific Tagged Errors (for internal domain logic) ---

export class WebhookError extends Data.TaggedError("WebhookError")<{
  readonly message: string;
  readonly reason: "missing_headers" | "invalid_signature" | "unknown_event";
}> { }

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly operation: string;
}> { }

export class RedisError extends Data.TaggedError("RedisError")<{
  readonly message: string;
  readonly operation: string;
}> { }

export class QueueError extends Data.TaggedError("QueueError")<{
  readonly message: string;
  readonly queue: string;
}> { }
