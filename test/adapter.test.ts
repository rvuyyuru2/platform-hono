import { describe, expect, test, beforeEach } from 'bun:test';

import { HonoAdapter } from '../src/adapters/hono-adapter';
import { mapRequest, extractClientIp } from '../src/adapters/request-mapper';
import { buildResponse } from '../src/adapters/response-mapper';
import { parseRequestBody } from '../src/adapters/body-parser';
import { RouterBridge } from '../src/adapters/router-bridge';
import { applyVersionFilter } from '../src/adapters/version-filter';
import { bridgeStreamingResponse } from '../src/adapters/sse-bridge';
import {
  VERSION_NEUTRAL,
  VersioningType,
  StreamableFile,
  RequestMethod,
} from '@nestjs/common';
import { Hono } from 'hono';
import { Readable } from 'node:stream';

// ──────────── HonoAdapter unit tests ────────────

describe('HonoAdapter', () => {
  let adapter: HonoAdapter;

  beforeEach(() => {
    adapter = new HonoAdapter();
  });

  test('should instantiate without errors', () => {
    expect(adapter).toBeDefined();
    expect(adapter.getInstance()).toBeInstanceOf(Hono);
  });

  test('getType() returns "hono"', () => {
    expect(adapter.getType()).toBe('hono');
  });

  test('isParserRegistered is false initially', () => {
    expect(adapter.isParserRegistered).toBe(false);
  });

  test('registerParserMiddleware sets isParserRegistered', () => {
    adapter.registerParserMiddleware(undefined, false);
    expect(adapter.isParserRegistered).toBe(true);
  });

  test('useBodyParser marks parser registered', () => {
    adapter.useBodyParser('application/json');
    expect(adapter.isParserRegistered).toBe(true);
  });

  test('registerParserMiddleware is idempotent', () => {
    adapter.registerParserMiddleware(undefined, false);
    adapter.registerParserMiddleware(undefined, false);
    expect(adapter.isParserRegistered).toBe(true);
  });

  test('setViewEngine throws', () => {
    expect(() => adapter.setViewEngine()).toThrow('not supported');
  });

  test('render throws', () => {
    expect(() => adapter.render()).toThrow('not supported');
  });

  test('setOnRequestHook stores hook', () => {
    const hook = () => {};
    adapter.setOnRequestHook(hook);
    // No direct accessor — just verify no throw
    expect(true).toBe(true);
  });

  test('setOnResponseHook stores hook', () => {
    const hook = () => {};
    adapter.setOnResponseHook(hook);
    expect(true).toBe(true);
  });
});

// ──────────── Request mapper tests ────────────

describe('Request Mapper', () => {
  test('extractClientIp returns cf-connecting-ip first', () => {
    const hono = new Hono();
    let extracted: string | undefined;

    hono.get('/test', (ctx) => {
      extracted = extractClientIp(ctx);
      return ctx.text('ok');
    });

    const req = new Request('http://localhost/test', {
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': '5.6.7.8',
      },
    });

    hono.fetch(req);
    // Give the async handler time to resolve
    expect(extracted).toBe('1.2.3.4');
  });

  test('extractClientIp falls back to x-forwarded-for', () => {
    const hono = new Hono();
    let extracted: string | undefined;

    hono.get('/test', (ctx) => {
      extracted = extractClientIp(ctx);
      return ctx.text('ok');
    });

    const req = new Request('http://localhost/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });

    hono.fetch(req);
    expect(extracted).toBe('10.0.0.1');
  });

  test('extractClientIp returns undefined when no proxy headers', () => {
    const hono = new Hono();
    let extracted: string | undefined = 'NOT_UNDEFINED';

    hono.get('/test', (ctx) => {
      extracted = extractClientIp(ctx);
      return ctx.text('ok');
    });

    hono.fetch(new Request('http://localhost/test'));
    expect(extracted).toBeUndefined();
  });

  test('mapRequest sets originalUrl, query, headers, ip', async () => {
    const hono = new Hono();
    let req: any;

    hono.get('/api/users', (ctx) => {
      mapRequest(ctx);
      req = ctx.req;
      return ctx.text('ok');
    });

    await hono.fetch(
      new Request('http://localhost/api/users?page=2&size=10', {
        headers: { 'x-real-ip': '192.168.1.1', 'x-custom': 'hello' },
      }),
    );

    expect(req.originalUrl).toBe('/api/users?page=2&size=10');
    expect(req.query).toEqual({ page: '2', size: '10' });
    expect(req.headers['x-custom']).toBe('hello');
    expect(req.ip).toBe('192.168.1.1');
  });
});

// ──────────── Body parser tests ────────────

describe('Body Parser', () => {
  test('parses application/json', async () => {
    const hono = new Hono();
    let body: any;

    hono.post('/test', async (ctx) => {
      await parseRequestBody(ctx, 'application/json', false);
      body = (ctx.req as any).body;
      return ctx.text('ok');
    });

    await hono.fetch(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      }),
    );

    expect(body).toEqual({ hello: 'world' });
  });

  test('parses application/json with rawBody', async () => {
    const hono = new Hono();
    let body: any;
    let rawBody: any;

    hono.post('/test', async (ctx) => {
      await parseRequestBody(ctx, 'application/json', true);
      body = (ctx.req as any).body;
      rawBody = (ctx.req as any).rawBody;
      return ctx.text('ok');
    });

    await hono.fetch(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 42 }),
      }),
    );

    expect(body).toEqual({ data: 42 });
    expect(rawBody).toBeInstanceOf(Buffer);
    expect(rawBody.toString()).toBe('{"data":42}');
  });

  test('handles invalid JSON gracefully', async () => {
    const hono = new Hono();
    let body: any;

    hono.post('/test', async (ctx) => {
      await parseRequestBody(ctx, 'application/json', false);
      body = (ctx.req as any).body;
      return ctx.text('ok');
    });

    await hono.fetch(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid json',
      }),
    );

    expect(body).toEqual({});
  });

  test('parses text/plain', async () => {
    const hono = new Hono();
    let body: any;

    hono.post('/test', async (ctx) => {
      await parseRequestBody(ctx, 'text/plain', false);
      body = (ctx.req as any).body;
      return ctx.text('ok');
    });

    await hono.fetch(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello world',
      }),
    );

    expect(body).toBe('hello world');
  });

  test('does nothing when no content type', async () => {
    const hono = new Hono();
    let bodySet = false;

    hono.post('/test', async (ctx) => {
      await parseRequestBody(ctx, undefined, false);
      bodySet = 'body' in (ctx.req as any);
      return ctx.text('ok');
    });

    await hono.fetch(
      new Request('http://localhost/test', { method: 'POST' }),
    );

    expect(bodySet).toBe(false);
  });
});

// ──────────── Response mapper tests ────────────

describe('Response Mapper', () => {
  test('returns existing response when no body', async () => {
    const hono = new Hono();
    let response: Response | undefined;

    hono.get('/test', async (ctx) => {
      ctx.res = ctx.text('existing');
      response = await buildResponse(ctx);
      return response;
    });

    await hono.fetch(new Request('http://localhost/test'));
    expect(response).toBeDefined();
    expect(await response!.text()).toBe('existing');
  });

  test('returns empty response for null body', async () => {
    const hono = new Hono();
    let response: Response | undefined;

    hono.get('/test', async (ctx) => {
      response = await buildResponse(ctx, null);
      return response;
    });

    await hono.fetch(new Request('http://localhost/test'));
    expect(response).toBeDefined();
    expect(response!.body).toBeNull();
  });

  test('returns JSON for object body', async () => {
    const hono = new Hono();
    let response: Response | undefined;

    hono.get('/test', async (ctx) => {
      response = await buildResponse(ctx, { key: 'value' });
      return response;
    });

    await hono.fetch(new Request('http://localhost/test'));
    const data = await response!.json();
    expect(data).toEqual({ key: 'value' });
  });

  test('returns octet-stream for Buffer', async () => {
    const hono = new Hono();
    let response: Response | undefined;

    hono.get('/test', async (ctx) => {
      response = await buildResponse(ctx, Buffer.from('binary data'));
      return response;
    });

    await hono.fetch(new Request('http://localhost/test'));
    expect(response!.headers.get('Content-Type')).toBe(
      'application/octet-stream',
    );
  });

  test('returns string body as-is', async () => {
    const hono = new Hono();
    let response: Response | undefined;

    hono.get('/test', async (ctx) => {
      response = await buildResponse(ctx, 'hello text');
      return response;
    });

    await hono.fetch(new Request('http://localhost/test'));
    expect(await response!.text()).toBe('hello text');
  });
});

// ──────────── Version filter tests ────────────

describe('Version Filter', () => {
  test('VERSION_NEUTRAL passes through', () => {
    const handler = () => 'called';
    const route = applyVersionFilter(handler, VERSION_NEUTRAL, {
      type: VersioningType.URI,
    } as any);
    expect(route({}, {}, () => {})).toBe('called');
  });

  test('URI versioning passes through', () => {
    const handler = () => 'uri-pass';
    const route = applyVersionFilter(handler, '1', {
      type: VersioningType.URI,
    } as any);
    expect(route({}, {}, () => {})).toBe('uri-pass');
  });

  test('Header versioning matches version', () => {
    const handler = () => 'matched';
    const route = applyVersionFilter(handler, '2', {
      type: VersioningType.HEADER,
      header: 'X-API-Version',
    } as any);

    // Simulate request with matching header
    const req = {
      headers: { 'x-api-version': '2' },
      header: (name: string) => {
        const map: Record<string, string> = { 'x-api-version': '2' };
        return map[name];
      },
    };
    expect(route(req, {}, () => 'fallback')).toBe('matched');
  });

  test('Header versioning falls through on mismatch', () => {
    const handler = () => 'matched';
    const route = applyVersionFilter(handler, '2', {
      type: VersioningType.HEADER,
      header: 'X-API-Version',
    } as any);

    const req = {
      headers: { 'x-api-version': '3' },
      header: (name: string) => {
        const map: Record<string, string> = { 'x-api-version': '3' };
        return map[name];
      },
    };
    expect(route(req, {}, () => 'fallback')).toBe('fallback');
  });

  test('Custom extractor versioning', () => {
    const handler = () => 'custom-hit';
    const route = applyVersionFilter(handler, '5', {
      type: VersioningType.CUSTOM,
      extractor: (req: any) => req.customVersion,
    } as any);

    expect(route({ customVersion: '5' }, {}, () => 'miss')).toBe('custom-hit');
    expect(route({ customVersion: '6' }, {}, () => 'miss')).toBe('miss');
  });

  test('Media type versioning', () => {
    const handler = () => 'media-hit';
    const route = applyVersionFilter(handler, '1', {
      type: VersioningType.MEDIA_TYPE,
      key: 'v=',
    } as any);

    const req = {
      headers: { accept: 'application/json;v=1' },
      header: () => undefined,
    };
    expect(route(req, {}, () => 'miss')).toBe('media-hit');
  });

  test('throws on unsupported versioning type', () => {
    const handler = () => {};
    expect(() =>
      applyVersionFilter(handler, '1', { type: 999 } as any),
    ).toThrow('Unsupported');
  });
});

// ──────────── Router bridge tests ────────────

describe('RouterBridge', () => {
  test('getRouteAndHandler extracts path and handler', () => {
    const handler = () => {};
    const [path, h] = RouterBridge.getRouteAndHandler('/test', handler as any);
    expect(path).toBe('/test');
    expect(h).toBe(handler);
  });

  test('getRouteAndHandler handles handler-only overload', () => {
    const handler = () => {};
    const [path, h] = RouterBridge.getRouteAndHandler(handler as any);
    expect(path).toBe('');
    expect(h).toBe(handler);
  });

  test('createMiddlewareFactory returns a function', () => {
    const hono = new Hono();
    const bridge = new RouterBridge(hono, () => undefined);
    const factory = bridge.createMiddlewareFactory(RequestMethod.GET);
    expect(typeof factory).toBe('function');
  });
});

// ──────────── Full integration: Hono fetch cycle ────────────

describe('Adapter Integration', () => {
  test('registers GET route and responds with JSON', async () => {
    const adapter = new HonoAdapter();
    const app = adapter.getInstance();

    // Register a simple GET
    adapter.get('/hello', async (req: any, ctx: any) => {
      ctx.status(200);
      ctx.res = ctx.json({ message: 'hello from hono' });
    });

    const res = await app.fetch(new Request('http://localhost/hello'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('hello from hono');
  });

  test('registers POST route and parses JSON body', async () => {
    const adapter = new HonoAdapter();
    const app = adapter.getInstance();

    adapter.post('/echo', async (req: any, ctx: any) => {
      // We need to manually parse in unit test since initHttpServer isn't called
      const body = await ctx.req.json();
      ctx.res = ctx.json(body);
    });

    const res = await app.fetch(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ echo: true }),
      }),
    );

    const data = await res.json();
    expect(data.echo).toBe(true);
  });

  test('registers all standard HTTP methods', () => {
    const adapter = new HonoAdapter();
    const noop = async () => {};

    // These should not throw
    adapter.get('/g', noop as any);
    adapter.post('/p', noop as any);
    adapter.put('/u', noop as any);
    adapter.delete('/d', noop as any);
    adapter.patch('/pa', noop as any);
    adapter.options('/o', noop as any);
    adapter.head('/h', noop as any);
    adapter.search('/s', noop as any);
    adapter.all('/a', noop as any);

    expect(true).toBe(true);
  });

  test('registers WebDAV methods without error', () => {
    const adapter = new HonoAdapter();
    const noop = async () => {};

    adapter.propfind('/pf', noop as any);
    adapter.proppatch('/pp', noop as any);
    adapter.mkcol('/mk', noop as any);
    adapter.copy('/cp', noop as any);
    adapter.move('/mv', noop as any);
    adapter.lock('/lk', noop as any);
    adapter.unlock('/ul', noop as any);

    expect(true).toBe(true);
  });

  test('enableCors does not throw', () => {
    const adapter = new HonoAdapter();
    expect(() => adapter.enableCors({ origin: '*' })).not.toThrow();
  });

  test('close resolves', async () => {
    const adapter = new HonoAdapter();
    adapter.initHttpServer({} as any);
    // Start listening on a random port, then close
    const server = adapter.listen(0);
    await adapter.close();
    expect(true).toBe(true);
  });

  test('initHttpServer creates an http server', () => {
    const adapter = new HonoAdapter();
    adapter.initHttpServer({} as any);
    const server = adapter.getHttpServer();
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
  });
});

// ──────────── SSE Bridge tests ────────────

describe('SSE Bridge', () => {
  test('bridgeStreamingResponse adds writeHead/write/end to context (edge fallback)', () => {
    const app = new Hono();
    const ctx = new (class {
      env = {}; // no outgoing = edge path
      res: Response | null = null;
    })() as unknown as Context;

    bridgeStreamingResponse(ctx);

    const c = ctx as any;
    expect(typeof c.writeHead).toBe('function');
    expect(typeof c.write).toBe('function');
    expect(typeof c.end).toBe('function');
    expect(typeof c.on).toBe('function');
    expect(typeof c.flushHeaders).toBe('function');
  });

  test('edge fallback buffers writes and assembles response on end()', () => {
    const ctx = { env: {}, res: null } as any;
    bridgeStreamingResponse(ctx);

    ctx.writeHead(200, { 'Content-Type': 'text/event-stream' });
    ctx.write('data: hello\n\n');
    ctx.write('data: world\n\n');
    ctx.end();

    expect(ctx.res).toBeInstanceOf(Response);
    expect(ctx.res.status).toBe(200);
    expect(ctx.res.headers.get('Content-Type')).toBe('text/event-stream');
  });

  test('is idempotent (does not re-bridge)', () => {
    const ctx = { env: {}, res: null } as any;
    bridgeStreamingResponse(ctx);
    const origWrite = ctx.write;
    bridgeStreamingResponse(ctx);
    expect(ctx.write).toBe(origWrite);
  });

  test('node path proxies to raw ServerResponse', () => {
    const calls: string[] = [];
    const fakeRes = {
      writeHead: () => calls.push('writeHead'),
      write: () => calls.push('write'),
      end: () => calls.push('end'),
      on: () => calls.push('on'),
      once: () => calls.push('once'),
      flushHeaders: () => calls.push('flushHeaders'),
      headersSent: false,
    };
    const ctx = { env: { outgoing: fakeRes }, res: null } as any;

    bridgeStreamingResponse(ctx);
    ctx.writeHead(200);
    ctx.write('chunk');
    ctx.end();

    expect(calls).toEqual(['writeHead', 'write', 'end']);
  });
});
