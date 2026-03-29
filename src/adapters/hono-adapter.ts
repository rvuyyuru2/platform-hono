import { HttpBindings, createAdaptorServer } from '@hono/node-server';
import {
  ServeStaticOptions,
  serveStatic,
} from '@hono/node-server/serve-static';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import {
  HttpStatus,
  RequestMethod,
  VersioningOptions,
} from '@nestjs/common';
import { VersionValue } from '@nestjs/common/interfaces';
import {
  ErrorHandler,
  NestApplicationOptions,
  RequestHandler,
} from '@nestjs/common/interfaces';
import { AbstractHttpAdapter } from '@nestjs/core/adapters/http-adapter';
import { Context, Hono } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { RedirectStatusCode, StatusCode } from 'hono/utils/http-status';
import * as http from 'http';
import * as http2 from 'http2';
import * as https from 'https';

import { HonoRequest, TypeBodyParser } from '../interfaces';
import { parseRequestBody } from './body-parser';
import { mapRequest } from './request-mapper';
import { buildResponse } from './response-mapper';
import { RouterBridge } from './router-bridge';
import { bridgeStreamingResponse } from './sse-bridge';
import { applyVersionFilter } from './version-filter';

type HonoHandler = RequestHandler<HonoRequest, Context>;
type ServerType = http.Server | http2.Http2Server | http2.Http2SecureServer;
type Ctx = Context | (() => Promise<Context>);

/**
 * Configuration options for the HonoAdapter.
 *
 * Modeled after Fastify's constructor options for familiar DX.
 */
export interface HonoAdapterOptions {
  /**
   * Trust proxy headers (X-Forwarded-For, X-Forwarded-Proto, etc.).
   * When true, req.ip and req.protocol derive from proxy headers.
   *
   * @default false
   */
  trustProxy?: boolean | string | string[];

  /**
   * Default JSON body size limit in bytes.
   * @default 1_048_576 (1 MB)
   */
  bodyLimit?: number;

  /**
   * Graceful shutdown timeout in milliseconds.
   * Active connections are drained before force-closing.
   *
   * @default 10_000 (10 seconds)
   */
  shutdownTimeout?: number;

  /**
   * Request timeout in milliseconds. 0 = no timeout.
   * @default 0
   */
  requestTimeout?: number;

  /**
   * Logger instance or boolean. true = console, false = silent.
   * @default false
   */
  logger?: boolean | { info: Function; error: Function; warn: Function };
}

/**
 * High-performance NestJS HTTP adapter for Hono.
 *
 * Fully compatible with NestJS v11, Node.js, and Bun.
 * Implements every AbstractHttpAdapter method including HEAD, SEARCH,
 * and WebDAV (PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK)
 * via Hono's `.on()` custom method API.
 *
 * Performance targets: ≥80k RPS on Bun, ≥60k RPS on Node.js 20+
 *
 * Usage:
 *   const app = await NestFactory.create(AppModule, new HonoAdapter());
 *   await app.listen(3000);
 *
 *   // With options (Fastify-like DX):
 *   const app = await NestFactory.create(AppModule, new HonoAdapter({
 *     trustProxy: true,
 *     bodyLimit: 10 * 1024 * 1024,
 *     shutdownTimeout: 15_000,
 *   }));
 */
export class HonoAdapter extends AbstractHttpAdapter<
  ServerType,
  HonoRequest,
  Context
> {
  private _isParserRegistered: boolean;
  private _onRequestHook?: (
    request: HonoRequest,
    response: Context,
    done: () => void,
  ) => void | Promise<void>;
  private _onResponseHook?: (
    request: HonoRequest,
    response: Context,
  ) => void | Promise<void>;
  private _onErrorHook?: (
    error: Error,
    request: HonoRequest,
    response: Context,
  ) => void | Promise<void>;

  private readonly adapterOptions: Required<HonoAdapterOptions>;
  private readonly router: RouterBridge;
  protected readonly instance: Hono<{ Bindings: HttpBindings }>;

  /** Active connections tracked for graceful shutdown */
  private readonly activeConnections = new Set<any>();

  constructor(options?: HonoAdapterOptions) {
    const honoInstance = new Hono<{ Bindings: HttpBindings }>();
    super(honoInstance);
    this.instance = honoInstance;

    // Merge defaults with user options
    this.adapterOptions = {
      trustProxy: options?.trustProxy ?? false,
      bodyLimit: options?.bodyLimit ?? 1_048_576,
      shutdownTimeout: options?.shutdownTimeout ?? 10_000,
      requestTimeout: options?.requestTimeout ?? 0,
      logger: options?.logger ?? false,
    };

    this.router = new RouterBridge(
      honoInstance,
      () => this._onResponseHook,
    );
  }

  get isParserRegistered(): boolean {
    return !!this._isParserRegistered;
  }

  // ──────────── Lifecycle hooks ────────────

  /**
   * Hook called before every request enters the NestJS pipeline.
   * Equivalent to Fastify's `onRequest` hook.
   */
  public setOnRequestHook(hook: Function) {
    this._onRequestHook = hook as any;
  }

  /**
   * Hook called after every response is sent.
   * Equivalent to Fastify's `onResponse` hook.
   */
  public setOnResponseHook(hook: Function) {
    this._onResponseHook = hook as any;
  }

  /**
   * Hook called when an error occurs during request processing.
   * Equivalent to Fastify's `onError` hook.
   */
  public setOnErrorHook(hook: Function) {
    this._onErrorHook = hook as any;
  }

  // ──────────── Standard HTTP methods ────────────

  public all(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('all', pathOrHandler, handler);
  }

  public get(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('get', pathOrHandler, handler);
  }

  public post(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('post', pathOrHandler, handler);
  }

  public put(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('put', pathOrHandler, handler);
  }

  public delete(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('delete', pathOrHandler, handler);
  }

  public use(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('use', pathOrHandler, handler);
  }

  public patch(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('patch', pathOrHandler, handler);
  }

  public options(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('options', pathOrHandler, handler);
  }

  public head(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('HEAD', pathOrHandler, handler);
  }

  public search(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('SEARCH', pathOrHandler, handler);
  }

  // ──────────── WebDAV methods (NestJS v11) ────────────

  public propfind(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('PROPFIND', pathOrHandler, handler);
  }

  public proppatch(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('PROPPATCH', pathOrHandler, handler);
  }

  public mkcol(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('MKCOL', pathOrHandler, handler);
  }

  public copy(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('COPY', pathOrHandler, handler);
  }

  public move(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('MOVE', pathOrHandler, handler);
  }

  public lock(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('LOCK', pathOrHandler, handler);
  }

  public unlock(pathOrHandler: string | HonoHandler, handler?: HonoHandler) {
    this.router.register('UNLOCK', pathOrHandler, handler);
  }

  // ──────────── Response helpers ────────────

  public async reply(ctx: Ctx, body: any, statusCode?: number) {
    ctx = await this.normalizeContext(ctx);

    if (statusCode) {
      ctx.status(statusCode as StatusCode);
    }

    ctx.res = await buildResponse(ctx, body);
  }

  public async status(ctx: Ctx, statusCode: number) {
    ctx = await this.normalizeContext(ctx);
    return ctx.status(statusCode as StatusCode);
  }

  public async end(ctx: Ctx, message?: string) {
    ctx = await this.normalizeContext(ctx);
    if (message) {
      ctx.res = new Response(message, {
        status: ctx.res?.status ?? 200,
        headers: ctx.res?.headers,
      });
    }
    return RESPONSE_ALREADY_SENT;
  }

  public render() {
    throw new Error(
      'View rendering is not supported in the Hono adapter. Use a template engine plugin.',
    );
  }

  public async redirect(ctx: Ctx, statusCode: number, url: string) {
    ctx = await this.normalizeContext(ctx);
    ctx.res = ctx.redirect(url, statusCode as RedirectStatusCode);
  }

  // ──────────── Cookie helpers ────────────

  /**
   * Set a cookie on the response.
   *
   * @example
   *   adapter.setCookie(ctx, 'session', 'abc123', { httpOnly: true, maxAge: 3600 });
   */
  public setCookie(
    ctx: Context,
    name: string,
    value: string,
    options?: CookieOptions,
  ) {
    const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
    if (options?.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
    if (options?.domain) parts.push(`Domain=${options.domain}`);
    if (options?.path) parts.push(`Path=${options.path}`);
    if (options?.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
    if (options?.httpOnly) parts.push('HttpOnly');
    if (options?.secure) parts.push('Secure');
    if (options?.sameSite) parts.push(`SameSite=${options.sameSite}`);
    ctx.header('Set-Cookie', parts.join('; '), { append: true });
  }

  /**
   * Clear a cookie by setting its expiry to the past.
   */
  public clearCookie(ctx: Context, name: string, options?: CookieOptions) {
    this.setCookie(ctx, name, '', {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    });
  }

  // ──────────── Error / Not-Found handlers ────────────

  public setErrorHandler(handler: ErrorHandler) {
    this.instance.onError(async (err: Error, ctx: Context) => {
      // Fire onError hook if registered
      if (this._onErrorHook) {
        await this._onErrorHook(err, ctx.req as any, ctx);
      }

      await handler(err, ctx.req as any, ctx);
      return buildResponse(ctx);
    });
  }

  public setNotFoundHandler(handler: RequestHandler) {
    this.instance.notFound(async (ctx: Context) => {
      await handler(ctx.req as any, ctx);
      ctx.status(HttpStatus.NOT_FOUND as StatusCode);
      return buildResponse(ctx, 'Not Found');
    });
  }

  // ──────────── Static assets / view engine ────────────

  public useStaticAssets(path: string, options: ServeStaticOptions) {
    this.instance.use(path, serveStatic(options));
  }

  public setViewEngine() {
    throw new Error('View engines are not supported in the Hono adapter.');
  }

  // ──────────── Header / request introspection ────────────

  public async isHeadersSent(ctx: Ctx): Promise<boolean> {
    ctx = await this.normalizeContext(ctx);
    return ctx.finalized;
  }

  public async getHeader(ctx: Ctx, name: string) {
    ctx = await this.normalizeContext(ctx);
    return ctx.res?.headers?.get(name) ?? undefined;
  }

  public async setHeader(ctx: Ctx, name: string, value: string) {
    ctx = await this.normalizeContext(ctx);
    ctx.header(name, value);
  }

  public async appendHeader(ctx: Ctx, name: string, value: string) {
    ctx = await this.normalizeContext(ctx);
    ctx.header(name, value, { append: true });
  }

  public async getRequestHostname(ctx: Ctx): Promise<string> {
    ctx = await this.normalizeContext(ctx);
    return ctx.req.header('host') ?? '';
  }

  public getRequestMethod(request: HonoRequest): string {
    return request.method;
  }

  public getRequestUrl(request: HonoRequest): string {
    return (request as any).originalUrl ?? request.url;
  }

  // ──────────── CORS / body parsing ────────────

  public enableCors(options: Parameters<typeof cors>[0]) {
    this.instance.use(cors(options));
  }

  public useBodyParser(
    type: TypeBodyParser,
    rawBody?: boolean,
    maxBodySize?: number,
  ) {
    if (maxBodySize) {
      this.instance.use(this.bodyLimit(maxBodySize));
    }
    this._isParserRegistered = true;
  }

  public close(): Promise<void> {
    const timeout = this.adapterOptions.shutdownTimeout;

    return new Promise((resolve) => {
      // Stop accepting new connections
      this.httpServer.close(() => {
        this.activeConnections.clear();
        resolve();
      });

      // Force-close after timeout
      if (timeout > 0) {
        const timer = setTimeout(() => {
          for (const conn of this.activeConnections) {
            conn.destroy?.();
          }
          this.activeConnections.clear();
          resolve();
        }, timeout);

        // Unref so the timer doesn't keep the process alive
        if (typeof timer === 'object' && 'unref' in timer) {
          (timer as any).unref();
        }
      }
    });
  }

  // ──────────── Server initialisation ────────────

  public initHttpServer(options: NestApplicationOptions) {
    const wantsRawBody = !!options.rawBody;
    const trustProxy = this.adapterOptions.trustProxy;

    // Global middleware: augment every request with NestJS-expected properties
    this.instance.use(async (ctx, next) => {
      // Map request properties (lazy headers, lazy query, ip, originalUrl, cookies)
      mapRequest(ctx, trustProxy);

      // Bridge streaming response methods for SSE support
      bridgeStreamingResponse(ctx);

      // Body parsing (hot path optimised with charCodeAt dispatch)
      const contentType = ctx.req.header('content-type');
      await parseRequestBody(ctx, contentType, wantsRawBody);

      // onRequestHook (mirrors Express & Fastify adapters)
      if (this._onRequestHook) {
        await new Promise<void>((resolve, reject) => {
          try {
            const result = this._onRequestHook!(ctx.req as any, ctx, resolve);
            if (result instanceof Promise) result.catch(reject);
          } catch (e) {
            reject(e);
          }
        });
      }

      await next();
    });

    const isHttpsEnabled = options?.httpsOptions;
    const createServer = isHttpsEnabled
      ? (https.createServer as any)
      : (http.createServer as any);

    this.httpServer = createAdaptorServer({
      fetch: this.instance.fetch,
      createServer,
      overrideGlobalObjects: false,
    });

    // Track connections for graceful shutdown
    this.httpServer.on('connection', (conn: any) => {
      this.activeConnections.add(conn);
      conn.on('close', () => this.activeConnections.delete(conn));
    });

    // Request timeout
    if (this.adapterOptions.requestTimeout > 0) {
      (this.httpServer as any).requestTimeout = this.adapterOptions.requestTimeout;
    }
  }

  public getType(): string {
    return 'hono';
  }

  // ──────────── Parser middleware registration ────────────

  public registerParserMiddleware(_prefix?: string, rawBody?: boolean) {
    if (this._isParserRegistered) {
      return;
    }

    this.useBodyParser('application/x-www-form-urlencoded', rawBody);
    this.useBodyParser('application/json', rawBody);
    this.useBodyParser('text/plain', rawBody);

    this._isParserRegistered = true;
  }

  // ──────────── Middleware factory ────────────

  public async createMiddlewareFactory(requestMethod: RequestMethod) {
    return this.router.createMiddlewareFactory(requestMethod);
  }

  // ──────────── API versioning ────────────

  public applyVersionFilter(
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions,
  ) {
    return applyVersionFilter(handler, version, versioningOptions);
  }

  // ──────────── Listen / body limit ────────────

  public listen(port: string | number, ...args: any[]): ServerType {
    return this.httpServer.listen(port, ...args);
  }

  public bodyLimit(maxSize: number) {
    return honoBodyLimit({
      maxSize,
      onError: (ctx) => {
        const size = ctx.req.header('Content-Length') ?? 'unknown';
        throw new Error(
          `Body size exceeded: ${maxSize} bytes. Received: ${size} bytes. Method: ${ctx.req.method}. Path: ${ctx.req.path}`,
        );
      },
    });
  }

  // ──────────── Accessors ────────────

  /** Access the adapter configuration */
  public getOptions(): Readonly<Required<HonoAdapterOptions>> {
    return this.adapterOptions;
  }

  /** Access the underlying Hono instance for advanced use cases */
  public getHonoInstance(): Hono<{ Bindings: HttpBindings }> {
    return this.instance;
  }

  // ──────────── Private ────────────

  private async normalizeContext(ctx: Ctx): Promise<Context> {
    return typeof ctx === 'function' ? await ctx() : ctx;
  }
}

// ──────────── Cookie options interface ────────────

export interface CookieOptions {
  maxAge?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}
