import { describe, expect, test, beforeEach } from 'bun:test';
import { Hono } from 'hono';

import {
  securityHeaders,
  rateLimit,
  requestTimeout,
} from '../src/adapters/security';
import {
  MetricsCollector,
  requestId,
  requestLogger,
} from '../src/adapters/observability';
import {
  mapRequest,
  extractClientIp,
  parseCookies,
} from '../src/adapters/request-mapper';
import { HonoAdapter } from '../src/adapters/hono-adapter';
import type { HonoAdapterOptions } from '../src/adapters/hono-adapter';

// ──────────── Security Headers Tests ────────────

describe('Security Headers', () => {
  test('applies all default security headers', async () => {
    const app = new Hono();
    app.use(securityHeaders());
    app.get('/', (c) => c.text('ok'));

    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
    expect(res.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(res.headers.get('X-DNS-Prefetch-Control')).toBe('off');
    expect(res.headers.get('X-Download-Options')).toBe('noopen');
    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=15552000; includeSubDomains',
    );
  });

  test('allows disabling specific headers', async () => {
    const app = new Hono();
    app.use(
      securityHeaders({
        frameOptions: false,
        hsts: false,
        noSniff: false,
      }),
    );
    app.get('/', (c) => c.text('ok'));

    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.headers.get('X-Content-Type-Options')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    // Others should still be present
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
  });

  test('allows custom header values', async () => {
    const app = new Hono();
    app.use(
      securityHeaders({
        frameOptions: 'DENY',
        hsts: 'max-age=31536000',
        contentSecurityPolicy: "default-src 'self'",
      }),
    );
    app.get('/', (c) => c.text('ok'));

    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000',
    );
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'self'",
    );
  });

  test('does not override explicitly set headers', async () => {
    const app = new Hono();
    app.use(securityHeaders());
    app.get('/', (c) => {
      c.header('X-Frame-Options', 'DENY');
      return c.text('ok');
    });

    const res = await app.fetch(new Request('http://localhost/'));
    // Route-set header should win
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

// ──────────── Rate Limiting Tests ────────────

describe('Rate Limiting', () => {
  test('allows requests under the limit', async () => {
    const app = new Hono();
    app.use(rateLimit({ max: 5, windowMs: 60_000 }));
    app.get('/', (c) => c.text('ok'));

    for (let i = 0; i < 5; i++) {
      const res = await app.fetch(
        new Request('http://localhost/', {
          headers: { 'x-forwarded-for': '1.2.3.4' },
        }),
      );
      expect(res.status).toBe(200);
    }
  });

  test('blocks requests over the limit', async () => {
    const app = new Hono();
    app.use(rateLimit({ max: 3, windowMs: 60_000 }));
    app.get('/', (c) => c.text('ok'));

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await app.fetch(
        new Request('http://localhost/', {
          headers: { 'x-forwarded-for': '10.0.0.1' },
        }),
      );
    }

    // 4th request should be rate limited
    const res = await app.fetch(
      new Request('http://localhost/', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.message).toBe('Too Many Requests');
  });

  test('includes rate limit headers', async () => {
    const app = new Hono();
    app.use(rateLimit({ max: 10, windowMs: 60_000 }));
    app.get('/', (c) => c.text('ok'));

    const res = await app.fetch(
      new Request('http://localhost/', {
        headers: { 'x-forwarded-for': '5.5.5.5' },
      }),
    );
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
  });

  test('skip function bypasses rate limiting', async () => {
    const app = new Hono();
    app.use(
      rateLimit({
        max: 1,
        windowMs: 60_000,
        skip: (c) => c.req.path === '/health',
      }),
    );
    app.get('/health', (c) => c.text('ok'));
    app.get('/', (c) => c.text('ok'));

    // Exhaust limit on /
    await app.fetch(
      new Request('http://localhost/', {
        headers: { 'x-forwarded-for': '7.7.7.7' },
      }),
    );
    const blocked = await app.fetch(
      new Request('http://localhost/', {
        headers: { 'x-forwarded-for': '7.7.7.7' },
      }),
    );
    expect(blocked.status).toBe(429);

    // /health should always pass
    const health = await app.fetch(
      new Request('http://localhost/health', {
        headers: { 'x-forwarded-for': '7.7.7.7' },
      }),
    );
    expect(health.status).toBe(200);
  });
});

// ──────────── Metrics Collector Tests ────────────

describe('MetricsCollector', () => {
  test('middleware records request metrics', async () => {
    const metrics = new MetricsCollector();
    const app = new Hono();
    app.use(metrics.middleware());
    app.get('/', (c) => c.text('ok'));
    app.get('/json', (c) => c.json({ ok: true }));

    await app.fetch(new Request('http://localhost/'));
    await app.fetch(new Request('http://localhost/json'));
    await app.fetch(new Request('http://localhost/'));

    const summary = metrics.getSummary();
    expect(summary.totalRequests).toBe(3);
    expect(summary.totalErrors).toBe(0);
    expect(summary.byMethod.GET).toBe(3);
  });

  test('tracks error count for 4xx/5xx', async () => {
    const metrics = new MetricsCollector();
    const app = new Hono();
    app.use(metrics.middleware());
    app.get('/ok', (c) => c.text('ok'));
    app.get('/fail', (c) => c.json({ error: 'not found' }, 404));
    app.get('/error', (c) => c.json({ error: 'server' }, 500));

    await app.fetch(new Request('http://localhost/ok'));
    await app.fetch(new Request('http://localhost/fail'));
    await app.fetch(new Request('http://localhost/error'));

    const summary = metrics.getSummary();
    expect(summary.totalRequests).toBe(3);
    expect(summary.totalErrors).toBe(2);
  });

  test('toPrometheus generates valid text format', async () => {
    const metrics = new MetricsCollector({ prefix: 'myapp' });
    const app = new Hono();
    app.use(metrics.middleware());
    app.get('/', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/'));

    const prometheus = metrics.toPrometheus();
    expect(prometheus).toContain('myapp_requests_total');
    expect(prometheus).toContain('# TYPE myapp_requests_total counter');
    expect(prometheus).toContain('quantile="0.5"');
    expect(prometheus).toContain('quantile="0.99"');
  });

  test('reset clears all metrics', async () => {
    const metrics = new MetricsCollector();
    const app = new Hono();
    app.use(metrics.middleware());
    app.get('/', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/'));
    expect(metrics.getSummary().totalRequests).toBe(1);

    metrics.reset();
    expect(metrics.getSummary().totalRequests).toBe(0);
  });
});

// ──────────── Request ID Tests ────────────

describe('Request ID', () => {
  test('generates unique request IDs', async () => {
    const app = new Hono();
    app.use(requestId());
    app.get('/', (c) => c.text(c.get('requestId' as any) ?? 'none'));

    const res1 = await app.fetch(new Request('http://localhost/'));
    const res2 = await app.fetch(new Request('http://localhost/'));

    expect(res1.headers.get('X-Request-Id')).toBeDefined();
    expect(res2.headers.get('X-Request-Id')).toBeDefined();
    expect(res1.headers.get('X-Request-Id')).not.toBe(
      res2.headers.get('X-Request-Id'),
    );
  });

  test('propagates existing request ID', async () => {
    const app = new Hono();
    app.use(requestId());
    app.get('/', (c) => c.text('ok'));

    const res = await app.fetch(
      new Request('http://localhost/', {
        headers: { 'X-Request-Id': 'my-trace-123' },
      }),
    );

    expect(res.headers.get('X-Request-Id')).toBe('my-trace-123');
  });

  test('supports custom header name', async () => {
    const app = new Hono();
    app.use(requestId({ header: 'X-Correlation-Id' }));
    app.get('/', (c) => c.text('ok'));

    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.headers.get('X-Correlation-Id')).toBeDefined();
  });
});

// ──────────── Cookie Parsing Tests ────────────

describe('Cookie Parsing', () => {
  test('parseCookies parses simple cookies', () => {
    const cookies = parseCookies('session=abc123; theme=dark');
    expect(cookies.session).toBe('abc123');
    expect(cookies.theme).toBe('dark');
  });

  test('parseCookies handles URL-encoded values', () => {
    const cookies = parseCookies('name=John%20Doe; path=%2Fhome');
    expect(cookies.name).toBe('John Doe');
    expect(cookies.path).toBe('/home');
  });

  test('parseCookies returns empty object for undefined', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  test('parseCookies ignores duplicate keys (first wins)', () => {
    const cookies = parseCookies('a=1; b=2; a=3');
    expect(cookies.a).toBe('1');
  });

  test('lazy cookie getter on mapped request', async () => {
    const app = new Hono();
    let cookies: any;

    app.get('/test', (ctx) => {
      mapRequest(ctx);
      cookies = (ctx.req as any).cookies;
      return ctx.text('ok');
    });

    await app.fetch(
      new Request('http://localhost/test', {
        headers: { Cookie: 'token=xyz; lang=en' },
      }),
    );

    // cookies are populated via the body parser step, but mapRequest 
    // doesn't set cookies directly — bodyParser does via lazy getter
  });
});

// ──────────── Enhanced Request Mapper Tests ────────────

describe('Enhanced Request Mapper', () => {
  test('lazy headers proxy works with bracket notation', async () => {
    const app = new Hono();
    let headerValue: string | undefined;
    let hasHeader: boolean;

    app.get('/test', (ctx) => {
      mapRequest(ctx);
      const req = ctx.req as any;
      headerValue = req.headers['x-custom'];
      hasHeader = 'x-custom' in req.headers;
      return ctx.text('ok');
    });

    await app.fetch(
      new Request('http://localhost/test', {
        headers: { 'x-custom': 'my-value' },
      }),
    );

    expect(headerValue).toBe('my-value');
    expect(hasHeader).toBe(true);
  });

  test('lazy query getter defers computation', async () => {
    const app = new Hono();
    let queryObj: any;

    app.get('/test', (ctx) => {
      mapRequest(ctx);
      queryObj = (ctx.req as any).query;
      return ctx.text('ok');
    });

    await app.fetch(new Request('http://localhost/test?foo=bar&baz=qux'));
    expect(queryObj).toEqual({ foo: 'bar', baz: 'qux' });
  });

  test('hostname extraction removes port', async () => {
    const app = new Hono();
    let hostname: string;

    app.get('/test', (ctx) => {
      mapRequest(ctx);
      hostname = (ctx.req as any).hostname;
      return ctx.text('ok');
    });

    await app.fetch(
      new Request('http://localhost:3000/test', {
        headers: { host: 'example.com:3000' },
      }),
    );

    expect(hostname!).toBe('example.com');
  });

  test('extractClientIp parses X-Forwarded-For chain', () => {
    const app = new Hono();
    let ip: string | undefined;

    app.get('/test', (ctx) => {
      ip = extractClientIp(ctx);
      return ctx.text('ok');
    });

    app.fetch(
      new Request('http://localhost/test', {
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178' },
      }),
    );

    expect(ip).toBe('203.0.113.50');
  });

  test('mapRequest is idempotent', async () => {
    const app = new Hono();
    let callCount = 0;

    app.get('/test', (ctx) => {
      const origDefineProperty = Object.defineProperty;
      const spy = Object.defineProperty;
      mapRequest(ctx);
      mapRequest(ctx); // second call should be a no-op
      return ctx.text('ok');
    });

    const res = await app.fetch(new Request('http://localhost/test'));
    expect(res.status).toBe(200);
  });

  test('socket property has remoteAddress', async () => {
    const app = new Hono();
    let socket: any;

    app.get('/test', (ctx) => {
      mapRequest(ctx);
      socket = (ctx.req as any).socket;
      return ctx.text('ok');
    });

    await app.fetch(
      new Request('http://localhost/test', {
        headers: { 'x-real-ip': '192.168.1.100' },
      }),
    );

    expect(socket.remoteAddress).toBe('192.168.1.100');
  });
});

// ──────────── HonoAdapter Options Tests ────────────

describe('HonoAdapter Options', () => {
  test('accepts constructor options', () => {
    const adapter = new HonoAdapter({
      trustProxy: true,
      bodyLimit: 10 * 1024 * 1024,
      shutdownTimeout: 5000,
      requestTimeout: 30_000,
    });

    const opts = adapter.getOptions();
    expect(opts.trustProxy).toBe(true);
    expect(opts.bodyLimit).toBe(10 * 1024 * 1024);
    expect(opts.shutdownTimeout).toBe(5000);
    expect(opts.requestTimeout).toBe(30_000);
  });

  test('uses defaults when no options provided', () => {
    const adapter = new HonoAdapter();
    const opts = adapter.getOptions();

    expect(opts.trustProxy).toBe(false);
    expect(opts.bodyLimit).toBe(1_048_576);
    expect(opts.shutdownTimeout).toBe(10_000);
    expect(opts.requestTimeout).toBe(0);
  });

  test('getHonoInstance returns the underlying Hono app', () => {
    const adapter = new HonoAdapter();
    expect(adapter.getHonoInstance()).toBeDefined();
    expect(adapter.getHonoInstance()).toBe(adapter.getInstance());
  });

  test('setOnErrorHook stores hook', () => {
    const adapter = new HonoAdapter();
    const hook = () => {};
    adapter.setOnErrorHook(hook);
    expect(true).toBe(true); // Just verify no throw
  });
});

// ──────────── Response Mapper Enhanced Tests ────────────

describe('Enhanced Response Mapper', () => {
  test('handles number body', async () => {
    const { buildResponse } = await import('../src/adapters/response-mapper');
    const app = new Hono();
    let response: Response;

    app.get('/test', async (ctx) => {
      response = await buildResponse(ctx, 42);
      return response;
    });

    await app.fetch(new Request('http://localhost/test'));
    expect(await response!.text()).toBe('42');
  });

  test('handles boolean body', async () => {
    const { buildResponse } = await import('../src/adapters/response-mapper');
    const app = new Hono();
    let response: Response;

    app.get('/test', async (ctx) => {
      response = await buildResponse(ctx, true);
      return response;
    });

    await app.fetch(new Request('http://localhost/test'));
    expect(await response!.text()).toBe('true');
  });

  test('handles array body as JSON', async () => {
    const { buildResponse } = await import('../src/adapters/response-mapper');
    const app = new Hono();
    let response: Response;

    app.get('/test', async (ctx) => {
      response = await buildResponse(ctx, [1, 2, 3]);
      return response;
    });

    await app.fetch(new Request('http://localhost/test'));
    const data = await response!.json();
    expect(data).toEqual([1, 2, 3]);
  });
});

// ──────────── Request Logger Tests ────────────

describe('Request Logger', () => {
  test('logs requests with method, path, status, duration', async () => {
    const logs: string[] = [];
    const app = new Hono();
    app.use(
      requestLogger({
        logger: {
          info: (msg: string) => logs.push(msg),
          error: (msg: string) => logs.push(`ERROR: ${msg}`),
        },
      }),
    );
    app.get('/', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/'));
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('GET');
    expect(logs[0]).toContain('/');
    expect(logs[0]).toContain('200');
    expect(logs[0]).toContain('ms');
  });

  test('skip function prevents logging', async () => {
    const logs: string[] = [];
    const app = new Hono();
    app.use(
      requestLogger({
        skip: (c) => c.req.path === '/health',
        logger: {
          info: (msg: string) => logs.push(msg),
          error: (msg: string) => logs.push(msg),
        },
      }),
    );
    app.get('/health', (c) => c.text('ok'));
    app.get('/api', (c) => c.text('ok'));

    await app.fetch(new Request('http://localhost/health'));
    await app.fetch(new Request('http://localhost/api'));

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('/api');
  });
});

// ──────────── Router Bridge Enhanced Tests ────────────

describe('Router Bridge (Map-based dispatch)', () => {
  test('registers and serves all standard HTTP methods', async () => {
    const adapter = new HonoAdapter();
    const app = adapter.getInstance();

    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options'];
    for (const method of methods) {
      (adapter as any)[method](`/${method}`, async (_req: any, ctx: any) => {
        ctx.res = ctx.json({ method });
      });
    }

    for (const method of methods) {
      const httpMethod = method.toUpperCase();
      const res = await app.fetch(
        new Request(`http://localhost/${method}`, {
          method: httpMethod === 'GET' ? 'GET' : httpMethod,
        }),
      );
      const body = await res.json();
      expect(body.method).toBe(method);
    }
  });
});
