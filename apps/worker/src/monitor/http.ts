import { validateHttpTarget } from './targets';
import type { CheckOutcome } from './types';

export type HttpCheckConfig = {
  url: string;
  timeoutMs: number;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers: Record<string, string> | null;
  body: string | null;
  expectedStatus: number[] | null;
  responseKeyword: string | null;
  responseForbiddenKeyword: string | null;
};

const USER_AGENT = 'Uptimer/0.1';
const RETRY_DELAYS_MS = [300, 800] as const;
const MAX_ASSERTION_BODY_BYTES = 1024 * 1024; // 1 MiB

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isAbortError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'name' in err) {
    return (err as { name?: unknown }).name === 'AbortError';
  }
  return false;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();

  // If the caller also passes a signal, forward abort.
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function readTextUpTo(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let truncated = false;

  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;

      const chunk = r.value;
      if (!chunk || chunk.length === 0) continue;

      const remaining = maxBytes - bytes;
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      if (chunk.length <= remaining) {
        bytes += chunk.length;
        text += decoder.decode(chunk, { stream: true });
      } else {
        bytes += remaining;
        text += decoder.decode(chunk.slice(0, remaining), { stream: true });
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }

  text += decoder.decode();
  return { text, truncated };
}

function statusOk(httpStatus: number, expectedStatus: number[] | null): boolean {
  if (expectedStatus && expectedStatus.length > 0) {
    return expectedStatus.includes(httpStatus);
  }
  return httpStatus >= 200 && httpStatus < 300;
}

async function attemptHttpCheck(config: HttpCheckConfig): Promise<Omit<CheckOutcome, 'attempts'>> {
  const started = performance.now();

  try {
    const headers = new Headers(config.headers ?? undefined);
    if (!headers.has('user-agent')) {
      headers.set('User-Agent', USER_AGENT);
    }

    const init: RequestInit = {
      method: config.method,
      headers,
      cache: 'no-store',
      cf: {
        cacheTtlByStatus: { '100-599': -1 },
      },
    };

    if (config.body !== null) {
      init.body = config.body;
    }

    const res = await fetchWithTimeout(config.url, config.timeoutMs, init);

    const latencyMs = Math.round(performance.now() - started);
    const httpStatus = res.status;

    if (!statusOk(httpStatus, config.expectedStatus)) {
      res.body?.cancel();
      return {
        status: 'down',
        latencyMs,
        httpStatus,
        error: `Unexpected HTTP status: ${httpStatus}`,
      };
    }

    const mustContain = config.responseKeyword;
    const mustNotContain = config.responseForbiddenKeyword;
    if (!mustContain && !mustNotContain) {
      res.body?.cancel();
      return { status: 'up', latencyMs, httpStatus, error: null };
    }

    if (!res.body) {
      return {
        status: 'unknown',
        latencyMs,
        httpStatus,
        error: 'Response body is not readable for keyword assertions',
      };
    }

    const { text, truncated } = await readTextUpTo(res.body, MAX_ASSERTION_BODY_BYTES);

    if (mustContain) {
      const found = text.includes(mustContain);
      if (!found) {
        return {
          status: truncated ? 'unknown' : 'down',
          latencyMs,
          httpStatus,
          error: truncated
            ? `Response body exceeded ${MAX_ASSERTION_BODY_BYTES} bytes; cannot assert required keyword`
            : 'Response keyword not found',
        };
      }
    }

    if (mustNotContain) {
      const found = text.includes(mustNotContain);
      if (found) {
        return {
          status: 'down',
          latencyMs,
          httpStatus,
          error: 'Forbidden response keyword found',
        };
      }
      if (truncated) {
        return {
          status: 'unknown',
          latencyMs,
          httpStatus,
          error: `Response body exceeded ${MAX_ASSERTION_BODY_BYTES} bytes; cannot assert forbidden keyword absence`,
        };
      }
    }

    return { status: 'up', latencyMs, httpStatus, error: null };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    if (isAbortError(err)) {
      return {
        status: 'down',
        latencyMs,
        httpStatus: null,
        error: `Timeout after ${config.timeoutMs}ms`,
      };
    }

    return {
      status: 'down',
      latencyMs,
      httpStatus: null,
      error: toErrorMessage(err),
    };
  }
}

export async function runHttpCheck(config: HttpCheckConfig): Promise<CheckOutcome> {
  const targetErr = validateHttpTarget(config.url);
  if (targetErr) {
    return { status: 'unknown', latencyMs: null, httpStatus: null, error: targetErr, attempts: 1 };
  }

  const maxAttempts = 1 + RETRY_DELAYS_MS.length;
  let last: CheckOutcome | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await attemptHttpCheck(config);
    const outcome: CheckOutcome = { ...r, attempts: attempt };

    if (outcome.status === 'up') {
      return outcome;
    }
    if (outcome.status === 'unknown') {
      return outcome;
    }

    last = outcome;
    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (delay !== undefined) {
      await sleep(delay);
    }
  }

  return (
    last ?? {
      status: 'unknown',
      latencyMs: null,
      httpStatus: null,
      error: 'No attempts executed',
      attempts: 0,
    }
  );
}
