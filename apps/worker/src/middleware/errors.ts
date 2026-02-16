import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
): Response {
  return c.json({ error: { code, message } } satisfies ErrorResponse, status);
}

export function handleNotFound(c: Context): Response {
  return jsonError(c, 404, 'NOT_FOUND', 'Not Found');
}

export function handleError(err: unknown, c: Context): Response {
  if (err instanceof AppError) {
    return jsonError(c, err.status, err.code, err.message);
  }

  if (err instanceof ZodError) {
    return jsonError(c, 400, 'INVALID_ARGUMENT', err.message);
  }

  // Avoid leaking internal details to clients; log for debugging.
  console.error(err);
  return jsonError(c, 500, 'INTERNAL', 'Internal Server Error');
}
