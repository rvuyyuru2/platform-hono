import { HttpStatus } from '@nestjs/common';
import { ErrorHandler, RequestHandler } from '@nestjs/common/interfaces';
import { Context, Hono } from 'hono';

import { buildResponse } from './response-mapper';

/**
 * Wire NestJS error and not-found handlers into Hono's lifecycle.
 */
export function setErrorHandler(
  instance: Hono<any>,
  handler: ErrorHandler,
  statusFn: (ctx: Context, code: number) => any,
) {
  instance.onError(async (err: Error, ctx: Context) => {
    await handler(err, ctx.req as any, ctx);
    return buildResponse(ctx);
  });
}

export function setNotFoundHandler(
  instance: Hono<any>,
  handler: RequestHandler,
  statusFn: (ctx: Context, code: number) => any,
) {
  instance.notFound(async (ctx: Context) => {
    await handler(ctx.req as any, ctx);
    await statusFn(ctx, HttpStatus.NOT_FOUND);
    return buildResponse(ctx, 'Not Found');
  });
}
