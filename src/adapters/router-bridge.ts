import { RequestMethod } from '@nestjs/common';
import { RequestHandler } from '@nestjs/common/interfaces';
import { Context, Next, Hono } from 'hono';

import { HonoRequest } from '../interfaces';
import { buildResponse } from './response-mapper';

type HonoHandler = RequestHandler<HonoRequest, Context>;

// Pre-allocated method dispatch map — avoids switch on every registration
const METHOD_NAMES = [
  'get', 'post', 'put', 'delete', 'patch', 'options', 'all',
] as const;

type MethodName = (typeof METHOD_NAMES)[number];

/**
 * High-performance bridge between NestJS's routing expectations and Hono's router.
 *
 * Performance wins:
 *   1. Map-based method dispatch instead of switch statement
 *   2. Pre-bound method references avoid indirect function calls
 *   3. Inline params extraction (no separate call)
 *   4. Minimal closure allocations in wrappers
 */
export class RouterBridge {
  /** Map from lowercase method name → Hono instance method (pre-bound) */
  private readonly methodMap: Map<string, (path: string, handler: any) => void>;

  constructor(
    private readonly instance: Hono<any>,
    private readonly getResponseHook: () =>
      | ((req: HonoRequest, ctx: Context) => void | Promise<void>)
      | undefined,
  ) {
    // Pre-bind all standard methods once at construction
    this.methodMap = new Map<string, (path: string, handler: any) => void>();
    for (const m of METHOD_NAMES) {
      this.methodMap.set(m, (instance as any)[m].bind(instance));
    }
    this.methodMap.set('use', instance.use.bind(instance));
  }

  // ── Route handler wrapper ──────────────────────────────

  createRouteHandler(routeHandler: HonoHandler) {
    // Capture reference — avoid `this` in hot path closure
    const getHook = this.getResponseHook;

    return async (ctx: Context, next: Next) => {
      // Inline params extraction — avoid extra function call
      (ctx.req as any).params = ctx.req.param();

      await routeHandler(ctx.req as any, ctx, next);

      const hook = getHook();
      if (hook) await hook(ctx.req as any, ctx);

      return buildResponse(ctx);
    };
  }

  // ── Register route ─────────────────────────────────────

  register(
    method: string,
    pathOrHandler: string | HonoHandler,
    handler?: HonoHandler,
  ) {
    const [routePath, routeHandler] = RouterBridge.getRouteAndHandler(
      pathOrHandler,
      handler,
    );
    const wrapped = this.createRouteHandler(routeHandler);

    // Fast path: standard methods via pre-bound Map lookup
    const registrar = this.methodMap.get(method.toLowerCase());
    if (registrar) {
      registrar(routePath, wrapped);
    } else {
      // Custom methods (HEAD, SEARCH, WebDAV) — use Hono's .on()
      this.instance.on(method.toUpperCase(), routePath, wrapped);
    }
  }

  // ── Middleware factory for NestJS middleware consumer ───

  createMiddlewareFactory(requestMethod: RequestMethod) {
    return (path: string, callback: Function) => {
      const registrar = this.resolveMethodRegistrar(requestMethod);
      registrar(path, async (ctx: Context, next: Function) => {
        await callback(ctx.req, ctx, next);
      });
    };
  }

  // ── Helpers ────────────────────────────────────────────

  private resolveMethodRegistrar(
    requestMethod: RequestMethod,
  ): (path: string, handler: any) => void {
    const METHOD_TO_NAME: Record<number, string> = {
      [RequestMethod.GET]: 'get',
      [RequestMethod.POST]: 'post',
      [RequestMethod.PUT]: 'put',
      [RequestMethod.DELETE]: 'delete',
      [RequestMethod.PATCH]: 'patch',
      [RequestMethod.OPTIONS]: 'options',
      [RequestMethod.HEAD]: 'head',
      [RequestMethod.ALL]: 'all',
    };

    const name = METHOD_TO_NAME[requestMethod] ?? 'all';

    // HEAD needs .on() since Hono doesn't have a .head() method
    if (name === 'head') {
      return (p: string, h: any) => this.instance.on('HEAD', p, h);
    }

    return this.methodMap.get(name) ?? this.methodMap.get('all')!;
  }

  static getRouteAndHandler(
    pathOrHandler: string | HonoHandler,
    handler?: HonoHandler,
  ): [string, HonoHandler] {
    if (typeof pathOrHandler === 'function') {
      return ['', pathOrHandler];
    }
    return [pathOrHandler, handler as HonoHandler];
  }
}
