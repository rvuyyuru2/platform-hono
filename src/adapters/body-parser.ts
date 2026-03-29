import { Context } from 'hono';

import { parseCookies } from './request-mapper';

/**
 * Body parser that works on the hot path.
 *
 * Uses `charCodeAt` to dispatch on content-type without allocating
 * intermediate strings.  Supports:
 *   • application/json
 *   • application/x-www-form-urlencoded
 *   • multipart/form-data
 *   • text/plain
 *   • application/graphql (treats as JSON)
 *
 * Cookie parsing is deferred to a lazy getter — only evaluated if
 * controller code reads `req.cookies`.
 */
export async function parseRequestBody(
  ctx: Context,
  contentType: string | undefined,
  rawBody: boolean,
  bodyLimit?: number,
): Promise<void> {
  const req = ctx.req as any;

  // Lazy cookie getter — avoids parsing overhead unless accessed
  if (!('cookies' in req)) {
    let _cookies: Record<string, string> | undefined;
    Object.defineProperty(req, 'cookies', {
      get() {
        if (_cookies === undefined) {
          _cookies = parseCookies(ctx.req.header('cookie'));
        }
        return _cookies;
      },
      set(v) {
        _cookies = v;
      },
      enumerable: true,
      configurable: true,
    });
  }

  if (!contentType) return;

  // charCodeAt(0): 'a'=97 'application/*', 'm'=109 'multipart/*', 't'=116 'text/*'
  const first = contentType.charCodeAt(0);

  // multipart/form-data — delegate to Hono's built-in parser 
  if (first === 109) {
    req.body = await ctx.req
      .parseBody({ all: true })
      .catch(() => ({}));
    return;
  }

  // application/*
  if (first === 97) {
    // charCodeAt(12): 'j'=106 → json, 'x'=120 → x-www-form-urlencoded, 'g'=103 → graphql
    const typeChar = contentType.charCodeAt(12);

    if (typeChar === 120) {
      // application/x-www-form-urlencoded
      req.body = await ctx.req
        .parseBody({ all: true })
        .catch(() => ({}));
      return;
    }

    if (typeChar === 106 || typeChar === 103) {
      // application/json OR application/graphql
      if (rawBody) {
        const text = await ctx.req.text();
        req.rawBody = Buffer.from(text);
        try {
          req.body = JSON.parse(text);
        } catch {
          req.body = {};
        }
      } else {
        req.body = await ctx.req.json().catch(() => ({}));
      }
      return;
    }

    // application/octet-stream — store as Buffer
    if (typeChar === 111) {
      const ab = await ctx.req.arrayBuffer().catch(() => new ArrayBuffer(0));
      req.body = Buffer.from(ab);
      if (rawBody) {
        req.rawBody = req.body;
      }
      return;
    }
  }

  // text/plain
  if (first === 116) {
    const text = await ctx.req.text().catch(() => '');
    if (rawBody) {
      req.rawBody = Buffer.from(text);
    }
    req.body = text;
  }
}
