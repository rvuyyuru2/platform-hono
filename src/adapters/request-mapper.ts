import { Context } from 'hono';

// ──────── IP headers in priority order ────────
const IP_HEADERS = [
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
  'true-client-ip',
  'x-client-ip',
  'x-cluster-client-ip',
  'forwarded',
  'via',
] as const;

/**
 * Extract the client IP from common proxy headers.
 * Returns the first non-empty value found.
 *
 * When trustProxy is enabled, parses X-Forwarded-For chains correctly,
 * returning only the leftmost (client) address.
 */
export function extractClientIp(
  ctx: Context,
  trustProxy?: boolean | string | string[],
): string | undefined {
  for (let i = 0; i < IP_HEADERS.length; i++) {
    const value = ctx.req.header(IP_HEADERS[i]);
    if (value) {
      // X-Forwarded-For may be a comma-separated chain
      if (i === 1 /* x-forwarded-for */ && value.indexOf(',') !== -1) {
        return value.slice(0, value.indexOf(',')).trim();
      }
      return value;
    }
  }

  // Fallback: Node.js raw socket IP (available via @hono/node-server bindings)
  return (ctx.env as any)?.incoming?.socket?.remoteAddress;
}

/**
 * Lazy headers proxy — avoids `Object.fromEntries()` allocation.
 *
 * NestJS accesses `req.headers['content-type']` etc. via bracket notation.
 * This proxy routes those reads to `Headers.get()` which is O(1).
 * Write support is included for guards/interceptors that modify headers.
 */
const HEADERS_HANDLER: ProxyHandler<Headers> = {
  get(target, prop) {
    if (typeof prop === 'string') {
      return target.get(prop) ?? undefined;
    }
    return undefined;
  },
  set(target, prop, value) {
    if (typeof prop === 'string') {
      target.set(prop, String(value));
    }
    return true;
  },
  has(target, prop) {
    return typeof prop === 'string' && target.has(prop);
  },
  ownKeys(target) {
    return [...target.keys()];
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === 'string' && target.has(prop)) {
      return {
        configurable: true,
        enumerable: true,
        value: target.get(prop),
        writable: true,
      };
    }
    return undefined;
  },
};

function createHeadersProxy(raw: Headers): Record<string, string> {
  return new Proxy(raw, HEADERS_HANDLER) as unknown as Record<string, string>;
}

/**
 * Extract originalUrl (path + query) without constructing a URL object.
 * Uses indexOf for O(1)-class string slicing.
 */
function extractOriginalUrl(rawUrl: string): string {
  const protocolEnd = rawUrl.indexOf('/', rawUrl.indexOf('://') + 3);
  return protocolEnd !== -1 ? rawUrl.slice(protocolEnd) : rawUrl;
}

/**
 * Map a Hono Context → NestJS-expected request properties.
 *
 * Mutates `ctx.req` in-place to avoid allocating a wrapper object.
 * Uses lazy getters for `query` and `headers` — only computed on first access.
 *
 * All properties NestJS internals depend on are added here:
 *   ip, query, headers, originalUrl, params, body, rawBody, hostname, protocol,
 *   method, url, path, cookies, res, socket
 */
export function mapRequest(
  ctx: Context,
  trustProxy?: boolean | string | string[],
): void {
  const req = ctx.req as any;

  // Avoid double-mapping
  if (req._mapped) return;
  req._mapped = true;

  // IP — lightweight extraction
  req.ip = extractClientIp(ctx, trustProxy);

  // originalUrl — zero-alloc path extraction
  req.originalUrl = extractOriginalUrl(ctx.req.url);

  // Capture the raw URL before any overrides
  const _rawUrl = ctx.req.url;

  // Lazy query getter — parse directly from URL to avoid recursion
  // through Hono's query() method after we shadow the property
  let _query: Record<string, string> | undefined;
  Object.defineProperty(req, 'query', {
    get() {
      if (_query === undefined) {
        const qIdx = _rawUrl.indexOf('?');
        if (qIdx === -1) {
          _query = {};
        } else {
          _query = Object.fromEntries(new URLSearchParams(_rawUrl.slice(qIdx + 1)));
        }
      }
      return _query;
    },
    set(v) {
      _query = v;
    },
    enumerable: true,
    configurable: true,
  });

  // Lazy headers proxy — zero-copy, routes reads to Headers.get()
  let _headers: Record<string, string> | undefined;
  Object.defineProperty(req, 'headers', {
    get() {
      if (_headers === undefined) _headers = createHeadersProxy(ctx.req.raw.headers);
      return _headers;
    },
    set(v) {
      _headers = v;
    },
    enumerable: true,
    configurable: true,
  });

  // hostname — lazy, uses header if available
  Object.defineProperty(req, 'hostname', {
    get() {
      const host = ctx.req.header('host');
      if (!host) return '';
      const colon = host.indexOf(':');
      return colon !== -1 ? host.slice(0, colon) : host;
    },
    enumerable: true,
    configurable: true,
  });

  // protocol
  Object.defineProperty(req, 'protocol', {
    get() {
      if (trustProxy) {
        const proto = ctx.req.header('x-forwarded-proto');
        if (proto) return proto;
      }
      return ctx.req.url.startsWith('https') ? 'https' : 'http';
    },
    enumerable: true,
    configurable: true,
  });

  // method / url / path — define via Object.defineProperty because
  // HonoRequest exposes these as read-only getters
  Object.defineProperty(req, 'method', {
    value: ctx.req.method,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(req, 'url', {
    value: req.originalUrl,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(req, 'path', {
    value: ctx.req.path,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  // Response reference — some NestJS features access req.res
  req.res = ctx;

  // Socket-like object for compatibility (e.g., request-scoped providers)
  req.socket = {
    remoteAddress: req.ip,
    encrypted: ctx.req.url.startsWith('https'),
  };
}

/**
 * Parse cookies from the Cookie header.
 * Lightweight parser — no external dependency.
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    const eq = pair.indexOf('=');
    if (eq !== -1) {
      const key = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      // Only set first occurrence (spec-compliant)
      if (!(key in cookies)) {
        cookies[key] = decodeURIComponent(val);
      }
    }
  }
  return cookies;
}
