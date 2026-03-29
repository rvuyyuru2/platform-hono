# platform-hono

<div align="center">

[![NPM version](https://img.shields.io/npm/v/platform-hono.svg?style=flat-square)](https://www.npmjs.com/package/platform-hono)
[![License](https://img.shields.io/npm/l/platform-hono.svg?style=flat-square)](https://github.com/rvuyyuru2/platform-hono/blob/main/LICENSE)

**The fastest NestJS HTTP adapter. Period.**

Drop-in replacement for `@nestjs/platform-express` and `@nestjs/platform-fastify`,
powered by [Hono](https://hono.dev/).

</div>

---

## Why platform-hono?

| Adapter | RPS (GET /) | Latency p99 | Startup | Memory |
| --- | --- | --- | --- | --- |
| **platform-hono** | **≥80k** | **<2ms** | **~50ms** | **~30MB** |
| platform-fastify | ~65k | ~3ms | ~100ms | ~45MB |
| platform-express | ~35k | ~8ms | ~120ms | ~55MB |

> Benchmarks measured on Apple M2, Node.js 22, Bun 1.3. Run `bun run benchmark:suite` to reproduce.

---

## Features

### Core Compatibility
- **100% NestJS v11 compatible** — controllers, guards, pipes, interceptors, exception filters, middleware, DI, modules
- **All HTTP methods** — GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD, SEARCH + WebDAV
- **API versioning** — URI, Header, Media Type, Custom strategies
- **Request-scoped providers** — full support
- **Global prefix** — works out of the box

### Performance
- **Zero-copy request mapping** — lazy Proxy-based headers, deferred query parsing
- **charCodeAt body dispatch** — no string allocations on the hot path
- **Map-based router** — pre-bound method dispatch, no switch statements
- **Minimal closures** — pre-captured references in handler wrappers
- **Streaming responses** — zero-alloc passthrough for SSE and file downloads

### Developer Experience (Fastify-class DX)
- **Constructor options** — `new HonoAdapter({ trustProxy, bodyLimit, shutdownTimeout })`
- **Built-in cookie support** — `parseCookies()`, `adapter.setCookie()`, `adapter.clearCookie()`
- **Lifecycle hooks** — `onRequest`, `onResponse`, `onError`
- **Graceful shutdown** — connection draining with configurable timeout
- **Request timeout** — automatic 408 for slow requests

### Security
- **Helmet-like headers** — `securityHeaders()` middleware with 14 configurable headers
- **Rate limiting** — `rateLimit()` with sliding window, skip rules, custom key extraction
- **Request timeout** — `requestTimeout()` middleware
- **CORS** — built-in via Hono
- **Body size limits** — configurable per content-type

### Observability
- **Metrics collector** — `MetricsCollector` with circular buffer, per-path/method breakdown
- **Prometheus export** — `metrics.toPrometheus()` text format
- **Request ID** — `requestId()` middleware with propagation
- **Structured logger** — `requestLogger()` with skip rules and custom format
- **JSON summary** — `metrics.getSummary()` for dashboards

### Ecosystem
- **SSE** — `@Sse()` decorator works out of the box
- **WebSockets** — `HonoWsAdapter` for `@WebSocketGateway()`
- **GraphQL** — Apollo Server v5 via `HonoGraphQLDriver`
- **File uploads** — built-in multipart handlers (memory + disk storage)
- **Static assets** — `@hono/node-server/serve-static`
- **Dual output** — ESM + CJS with proper `exports` map
- **Node.js & Bun** — first-class support for both runtimes

---

## Installation

```bash
# npm
npm install platform-hono hono @hono/node-server
npm install @nestjs/common @nestjs/core rxjs reflect-metadata

# bun
bun add platform-hono hono @hono/node-server
```

---

## Quick Start

```typescript
import { NestFactory } from '@nestjs/core';
import { HonoAdapter, NestHonoApplication } from 'platform-hono';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestHonoApplication>(
    AppModule,
    new HonoAdapter({
      trustProxy: true,        // parse X-Forwarded-For, X-Forwarded-Proto
      bodyLimit: 10_485_760,   // 10 MB default body limit
      shutdownTimeout: 15_000, // 15s graceful shutdown
      requestTimeout: 30_000,  // 30s request timeout
    }),
    { rawBody: true },
  );

  app.enableCors({ origin: '*' });
  await app.listen(3000);
  console.log('Server running on http://localhost:3000');
}

bootstrap();
```

---

## Architecture

```
src/adapters/
  hono-adapter.ts        ← Main adapter with config options + graceful shutdown
  request-mapper.ts      ← Zero-copy lazy Proxy headers, deferred query, cookie parsing
  response-mapper.ts     ← Optimised typeof-first response building
  body-parser.ts         ← charCodeAt content-type dispatch + lazy cookies
  router-bridge.ts       ← Map-based pre-bound method dispatch
  version-filter.ts      ← URI/Header/MediaType/Custom versioning
  error-handler.ts       ← Error and not-found handler wiring
  sse-bridge.ts          ← SSE streaming bridge (Node.js + edge runtime)
  websocket-adapter.ts   ← WebSocket adapter (ws)
  security.ts            ← Helmet headers, rate limiting, request timeout
  observability.ts       ← Metrics, request ID, structured logger
```

### Hot Path Optimizations

1. **Headers** — `Proxy<Headers>` intercepts bracket notation reads → routes to `Headers.get()`. No `Object.fromEntries()` allocation.
2. **Query** — Lazy getter via `Object.defineProperty`. Only computed if controller reads `req.query`.
3. **Cookies** — Lazy getter. Cookie string parsed only when `req.cookies` is accessed.
4. **Body parsing** — `charCodeAt(0)` dispatch: `'a'=97` (application/*), `'m'=109` (multipart/*), `'t'=116` (text/*). No string comparison.
5. **Router** — `Map<string, Function>` with pre-bound Hono methods. No switch statement on every route registration.
6. **Response** — `typeof body === 'string'` checked before `instanceof` (typeof is a single CPU instruction).

---

## Usage

### Controllers

Standard NestJS controllers work unchanged:

```typescript
@Controller('cats')
export class CatsController {
  @Get()
  findAll() {
    return [{ name: 'Tom' }];
  }

  @Post()
  create(@Body() body: CreateCatDto) {
    return body;
  }
}
```

### Adapter Options

```typescript
new HonoAdapter({
  trustProxy: true,           // Parse proxy headers for req.ip, req.protocol
  bodyLimit: 50 * 1024 * 1024, // 50 MB body limit
  shutdownTimeout: 10_000,    // 10s graceful shutdown with connection draining
  requestTimeout: 60_000,     // 60s per-request timeout
  logger: true,               // Enable console logging
})
```

### Security Headers (Helmet-like)

```typescript
import { securityHeaders } from 'platform-hono';

const adapter = new HonoAdapter();
const hono = adapter.getHonoInstance();

hono.use(securityHeaders({
  frameOptions: 'DENY',
  contentSecurityPolicy: "default-src 'self'",
  hsts: 'max-age=31536000; includeSubDomains; preload',
  crossOriginEmbedder: 'require-corp',
  crossOriginOpener: 'same-origin',
  crossOriginResource: 'same-origin',
}));
```

Default headers applied:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Strict-Transport-Security: max-age=15552000; includeSubDomains`
- `X-XSS-Protection: 0`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-DNS-Prefetch-Control: off`
- `X-Download-Options: noopen`
- `X-Permitted-Cross-Domain-Policies: none`

### Rate Limiting

```typescript
import { rateLimit } from 'platform-hono';

hono.use(rateLimit({
  max: 100,                    // 100 requests per window
  windowMs: 60_000,           // 1 minute window
  headers: true,              // Include X-RateLimit-* headers
  skip: (ctx) => ctx.req.path === '/health',
  keyGenerator: (ctx) => ctx.req.header('x-api-key') ?? ctx.req.ip,
}));
```

### Observability

```typescript
import { MetricsCollector, requestId, requestLogger } from 'platform-hono';

const metrics = new MetricsCollector({ prefix: 'api', labels: { service: 'users' } });

hono.use(requestId());
hono.use(metrics.middleware());
hono.use(requestLogger({
  skip: (c) => c.req.path === '/health',
}));

// Prometheus endpoint
hono.get('/metrics', (c) => c.text(metrics.toPrometheus()));

// JSON dashboard endpoint
hono.get('/metrics/json', (c) => c.json(metrics.getSummary()));
```

### Cookies

```typescript
// Reading cookies (lazy, parsed from Cookie header on first access)
const token = req.cookies.session;
const lang = req.cookies.lang;

// Setting cookies
const adapter = app.getHttpAdapter() as HonoAdapter;
adapter.setCookie(ctx, 'session', 'abc123', {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  maxAge: 3600,
  path: '/',
});

// Clearing cookies
adapter.clearCookie(ctx, 'session');
```

### File Uploads

Built-in multipart handling — no separate `multer` package required:

```typescript
import { FileInterceptor, UploadedFile, MemoryStorageFile } from 'platform-hono';

@Post('upload')
@UseInterceptors(FileInterceptor('file'))
uploadFile(@UploadedFile() file: MemoryStorageFile) {
  return { filename: file.originalFilename, size: file.size };
}
```

### SSE (Server-Sent Events)

```typescript
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable, interval, map } from 'rxjs';

@Controller()
export class EventsController {
  @Sse('events')
  events(): Observable<MessageEvent> {
    return interval(1000).pipe(
      map((i) => ({ data: { count: i } })),
    );
  }
}
```

### WebSockets

```typescript
import { HonoAdapter, HonoWsAdapter } from 'platform-hono';

const app = await NestFactory.create(AppModule, new HonoAdapter());
app.useWebSocketAdapter(new HonoWsAdapter(app));
```

### API Versioning

```typescript
// URI versioning (default)
app.enableVersioning({ type: VersioningType.URI });

// Header versioning
app.enableVersioning({
  type: VersioningType.HEADER,
  header: 'X-API-Version',
});

// Media Type versioning
app.enableVersioning({ type: VersioningType.MEDIA_TYPE, key: 'v=' });

// Custom versioning
app.enableVersioning({
  type: VersioningType.CUSTOM,
  extractor: (request) => request.headers['x-version'],
});
```

### GraphQL (Apollo v5)

```typescript
import { HonoGraphQLDriver } from 'platform-hono';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: HonoGraphQLDriver,
      autoSchemaFile: 'schema.gql',
      sortSchema: true,
      subscriptions: { 'graphql-ws': true },
    }),
  ],
})
export class AppModule {}
```

### Exception Filters

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    httpAdapter.reply(
      ctx.getResponse(),
      { statusCode: status, timestamp: new Date().toISOString() },
      status,
    );
  }
}
```

### Static Assets

```typescript
app.useStaticAssets('/static', { root: 'public' });
```

### Graceful Shutdown

The adapter automatically tracks active connections and drains them on shutdown:

```typescript
const app = await NestFactory.create(AppModule, new HonoAdapter({
  shutdownTimeout: 15_000, // Wait up to 15s for connections to drain
}));

// NestJS shutdown hooks work automatically
app.enableShutdownHooks();
```

---

## Exports

| Export path | Contents |
| --- | --- |
| `platform-hono` | Everything (adapters, interfaces, drivers, multer, security, observability) |
| `platform-hono/adapters` | HonoAdapter, HonoWsAdapter, security, observability, all modules |
| `platform-hono/interfaces` | HonoRequest, NestHonoApplication, hook types |

### Key Exports

```typescript
// Adapter
import { HonoAdapter, HonoAdapterOptions, CookieOptions } from 'platform-hono';

// WebSocket
import { HonoWsAdapter } from 'platform-hono';

// Security
import { securityHeaders, rateLimit, requestTimeout } from 'platform-hono';
import type { SecurityHeadersOptions, RateLimitOptions, RequestTimeoutOptions } from 'platform-hono';

// Observability  
import { MetricsCollector, requestId, requestLogger } from 'platform-hono';
import type { MetricsOptions, RequestIdOptions, RequestLoggerOptions, MetricsSummary } from 'platform-hono';

// GraphQL
import { HonoGraphQLDriver } from 'platform-hono';

// File uploads
import { FileInterceptor, FilesInterceptor, UploadedFile, UploadedFiles } from 'platform-hono';
import type { MemoryStorageFile } from 'platform-hono';

// Types
import type { NestHonoApplication, HonoRequest } from 'platform-hono';
```

---

## Benchmarks

### Run the comparison suite

```bash
# Terminal 1 — start all servers (Hono + Fastify + Express)
bun run benchmark:servers

# Terminal 2 — run comparison
bun run benchmark:suite
```

### Run NestJS-specific benchmark

```bash
# Terminal 1 — NestJS + HonoAdapter
bun run benchmark:nest

# Terminal 2
bun run benchmark:suite 4000
```

The suite measures:
- Requests per second (average, max)
- Latency (p50, p99, max)
- Throughput (MB/s)
- Error rates

Results are saved to `benchmarks/results.csv`.

---

## Examples

Two fully working example applications are included:

```bash
# REST API example (17 endpoints)
bun run example:rest

# GraphQL example (Apollo v5, subscriptions, file upload)
bun run example:graphql
```

See [examples/rest/README.md](examples/rest/README.md) and [examples/graphql/README.md](examples/graphql/README.md).

---

## Testing

```bash
bun test           # All tests (~140+ tests, <200ms)
bun test --watch   # Watch mode
```

Test coverage includes:
- Adapter unit tests (options, lifecycle, methods)
- Request mapper (lazy headers, query, IP extraction, cookies)
- Response mapper (JSON, binary, streaming, primitives)
- Body parser (JSON, form, multipart, text, edge cases)
- Router bridge (method dispatch, middleware factory)
- Version filter (URI, Header, Media Type, Custom)
- SSE bridge (Node.js + edge runtime)
- Security headers (defaults, overrides, disabling)
- Rate limiting (window, skip, headers)
- Metrics collector (recording, summary, Prometheus)
- Request ID (generation, propagation)
- Request logger (format, skip)
- File upload handlers (memory, disk, validation)

---

## API Reference

### `HonoAdapter`

Extends `AbstractHttpAdapter`. Fully compatible with NestJS v11.

| Method | Description |
| --- | --- |
| `constructor(options?)` | Create adapter with optional configuration |
| `initHttpServer(options)` | Creates HTTP server with global middleware |
| `listen(port, ...args)` | Start listening |
| `close()` | Graceful shutdown with connection draining |
| `enableCors(options)` | Enable CORS via Hono middleware |
| `useStaticAssets(path, options)` | Serve static files |
| `useBodyParser(type, rawBody?, maxSize?)` | Register body parser |
| `applyVersionFilter(handler, version, opts)` | Apply API versioning |
| `setErrorHandler(handler)` | Wire NestJS error handler |
| `setNotFoundHandler(handler)` | Wire NestJS 404 handler |
| `setCookie(ctx, name, value, options?)` | Set a response cookie |
| `clearCookie(ctx, name, options?)` | Clear a cookie |
| `setOnRequestHook(hook)` | Register onRequest lifecycle hook |
| `setOnResponseHook(hook)` | Register onResponse lifecycle hook |
| `setOnErrorHook(hook)` | Register onError lifecycle hook |
| `getOptions()` | Get adapter configuration |
| `getHonoInstance()` | Get underlying Hono instance |
| `getType()` | Returns `"hono"` |

### `HonoAdapterOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `trustProxy` | `boolean \| string \| string[]` | `false` | Trust proxy headers |
| `bodyLimit` | `number` | `1_048_576` | Default body size limit (bytes) |
| `shutdownTimeout` | `number` | `10_000` | Graceful shutdown timeout (ms) |
| `requestTimeout` | `number` | `0` | Per-request timeout (ms, 0=none) |
| `logger` | `boolean \| Logger` | `false` | Logger instance or boolean |

---

## Requirements

- **NestJS** `^11.0.0`
- **Hono** `^4.0.0`
- **Node.js** `>=18` or **Bun** `>=1.0`
- **TypeScript** `>=5.0`

## License

[MIT](LICENSE)
