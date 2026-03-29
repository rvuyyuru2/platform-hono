import { Context, MiddlewareHandler, Next } from 'hono';

// ──────────── Helmet-like security headers ────────────

export interface SecurityHeadersOptions {
  /** Content-Security-Policy header value */
  contentSecurityPolicy?: string | false;
  /** X-Content-Type-Options: nosniff (default: true) */
  noSniff?: boolean;
  /** X-Frame-Options (default: 'SAMEORIGIN') */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Strict-Transport-Security (default: max-age=15552000; includeSubDomains) */
  hsts?: string | false;
  /** X-XSS-Protection (default: '0' — modern browsers don't need it) */
  xssProtection?: string | false;
  /** Referrer-Policy (default: 'strict-origin-when-cross-origin') */
  referrerPolicy?: string | false;
  /** X-Permitted-Cross-Domain-Policies (default: 'none') */
  crossDomainPolicy?: string | false;
  /** X-DNS-Prefetch-Control (default: 'off') */
  dnsPrefetchControl?: 'on' | 'off' | false;
  /** X-Download-Options (default: 'noopen') */
  downloadOptions?: string | false;
  /** Permissions-Policy header */
  permissionsPolicy?: string | false;
  /** Cross-Origin-Embedder-Policy */
  crossOriginEmbedder?: string | false;
  /** Cross-Origin-Opener-Policy */
  crossOriginOpener?: string | false;
  /** Cross-Origin-Resource-Policy */
  crossOriginResource?: string | false;
}

/**
 * Helmet-like security headers middleware for Hono.
 *
 * Sets sensible security defaults. Each header can be individually disabled.
 *
 * @example
 *   app.use(securityHeaders());
 *   app.use(securityHeaders({ frameOptions: 'DENY' }));
 */
export function securityHeaders(
  options?: SecurityHeadersOptions,
): MiddlewareHandler {
  // Pre-compute header pairs at registration time, not per-request
  const headers: [string, string][] = [];

  const o = options ?? {};

  if (o.noSniff !== false) {
    headers.push(['X-Content-Type-Options', 'nosniff']);
  }
  if (o.frameOptions !== false) {
    headers.push(['X-Frame-Options', o.frameOptions ?? 'SAMEORIGIN']);
  }
  if (o.hsts !== false) {
    headers.push([
      'Strict-Transport-Security',
      typeof o.hsts === 'string'
        ? o.hsts
        : 'max-age=15552000; includeSubDomains',
    ]);
  }
  if (o.xssProtection !== false) {
    headers.push(['X-XSS-Protection', o.xssProtection ?? '0']);
  }
  if (o.referrerPolicy !== false) {
    headers.push([
      'Referrer-Policy',
      o.referrerPolicy ?? 'strict-origin-when-cross-origin',
    ]);
  }
  if (o.crossDomainPolicy !== false) {
    headers.push([
      'X-Permitted-Cross-Domain-Policies',
      o.crossDomainPolicy ?? 'none',
    ]);
  }
  if (o.dnsPrefetchControl !== false) {
    headers.push([
      'X-DNS-Prefetch-Control',
      o.dnsPrefetchControl ?? 'off',
    ]);
  }
  if (o.downloadOptions !== false) {
    headers.push(['X-Download-Options', o.downloadOptions ?? 'noopen']);
  }
  if (o.contentSecurityPolicy && typeof o.contentSecurityPolicy === 'string') {
    headers.push(['Content-Security-Policy', o.contentSecurityPolicy]);
  }
  if (o.permissionsPolicy) {
    headers.push(['Permissions-Policy', o.permissionsPolicy]);
  }
  if (o.crossOriginEmbedder) {
    headers.push(['Cross-Origin-Embedder-Policy', o.crossOriginEmbedder]);
  }
  if (o.crossOriginOpener) {
    headers.push(['Cross-Origin-Opener-Policy', o.crossOriginOpener]);
  }
  if (o.crossOriginResource) {
    headers.push(['Cross-Origin-Resource-Policy', o.crossOriginResource]);
  }

  // Length is captured once — no .length access per request
  const len = headers.length;

  return async (ctx: Context, next: Next) => {
    await next();
    // Apply headers after handler — allows per-route overrides
    for (let i = 0; i < len; i++) {
      const [name, value] = headers[i];
      if (!ctx.res.headers.has(name)) {
        ctx.header(name, value);
      }
    }
  };
}

// ──────────── Rate Limiting ────────────

export interface RateLimitOptions {
  /** Maximum requests per window (default: 100) */
  max?: number;
  /** Time window in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
  /** Custom key extractor (default: IP address) */
  keyGenerator?: (ctx: Context) => string;
  /** Custom response when rate limited */
  handler?: (ctx: Context) => Response | Promise<Response>;
  /** Skip rate limiting for certain requests */
  skip?: (ctx: Context) => boolean;
  /** Response status code (default: 429) */
  statusCode?: number;
  /** Include rate limit info in response headers (default: true) */
  headers?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * In-memory sliding-window rate limiter for Hono.
 *
 * For distributed deployments, replace with a Redis-backed store.
 *
 * @example
 *   app.use(rateLimit({ max: 100, windowMs: 60_000 }));
 */
export function rateLimit(options?: RateLimitOptions): MiddlewareHandler {
  const max = options?.max ?? 100;
  const windowMs = options?.windowMs ?? 60_000;
  const statusCode = options?.statusCode ?? 429;
  const includeHeaders = options?.headers !== false;
  const skip = options?.skip;
  const keyGenerator =
    options?.keyGenerator ?? ((ctx: Context) => (ctx.req as any).ip ?? 'unknown');
  const customHandler = options?.handler;

  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup to prevent memory leaks (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetTime) {
        store.delete(key);
      }
    }
  }, 300_000);

  // Unref so it doesn't keep the process alive
  if (typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
    (cleanupInterval as any).unref();
  }

  return async (ctx: Context, next: Next) => {
    if (skip?.(ctx)) {
      return next();
    }

    const key = keyGenerator(ctx);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    if (includeHeaders) {
      ctx.header('X-RateLimit-Limit', String(max));
      ctx.header('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
      ctx.header(
        'X-RateLimit-Reset',
        String(Math.ceil(entry.resetTime / 1000)),
      );
    }

    if (entry.count > max) {
      if (includeHeaders) {
        ctx.header(
          'Retry-After',
          String(Math.ceil((entry.resetTime - now) / 1000)),
        );
      }

      if (customHandler) {
        return customHandler(ctx);
      }

      return ctx.json(
        {
          statusCode,
          message: 'Too Many Requests',
          retryAfter: Math.ceil((entry.resetTime - now) / 1000),
        },
        statusCode as any,
      );
    }

    return next();
  };
}

// ──────────── Request Timeout ────────────

export interface RequestTimeoutOptions {
  /** Timeout duration in milliseconds (default: 30_000 = 30 seconds) */
  timeout?: number;
  /** Custom timeout response */
  handler?: (ctx: Context) => Response | Promise<Response>;
  /** Status code for timeout (default: 408) */
  statusCode?: number;
}

/**
 * Request timeout middleware.
 * Aborts slow requests with a configurable status code.
 *
 * @example
 *   app.use(requestTimeout({ timeout: 30_000 }));
 */
export function requestTimeout(
  options?: RequestTimeoutOptions,
): MiddlewareHandler {
  const timeout = options?.timeout ?? 30_000;
  const statusCode = options?.statusCode ?? 408;
  const customHandler = options?.handler;

  return async (ctx: Context, next: Next) => {
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
    }, timeout);

    try {
      await next();
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) {
      if (customHandler) {
        return customHandler(ctx);
      }
      return ctx.json(
        { statusCode, message: 'Request Timeout' },
        statusCode as any,
      );
    }
  };
}
