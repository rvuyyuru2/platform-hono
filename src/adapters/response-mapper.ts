import { StreamableFile } from '@nestjs/common';
import { isObject } from '@nestjs/common/utils/shared.utils';
import { Context } from 'hono';

/**
 * Build a Hono `Response` from the value NestJS wants to send.
 *
 * Optimised hot-path ordering (most common first):
 *   1. undefined + existing response  → passthrough (zero alloc)
 *   2. string                        → text (typeof check, fastest)
 *   3. object (non-null, non-binary) → JSON
 *   4. StreamableFile                → streaming download
 *   5. null / undefined              → empty 204-style response
 *   6. ReadableStream / Buffer       → binary stream
 *   7. primitive                     → text fallback
 *
 * Performance notes:
 *   - typeof checks are single CPU instructions
 *   - instanceof checks are ordered by frequency
 *   - Content-Type header is only set when not already present
 */
export async function buildResponse(ctx: Context, body?: any): Promise<Response> {
  // Fast path: no body AND existing response with a body → zero-alloc passthrough
  if (body === undefined && ctx.res && ctx.res.body !== null) {
    return ctx.res;
  }

  // String body — most common for text/html responses
  if (typeof body === 'string') {
    return ctx.body(body);
  }

  // null / undefined = empty response
  if (body === null || body === undefined) {
    return ctx.newResponse(null);
  }

  // StreamableFile (NestJS built-in for file downloads)
  if (body instanceof StreamableFile) {
    return buildStreamableResponse(ctx, body);
  }

  // ReadableStream — web-standard streaming
  if (body instanceof ReadableStream) {
    ensureHeader(ctx, 'Content-Type', 'application/octet-stream');
    return ctx.body(body as any);
  }

  // Buffer / Uint8Array / ArrayBuffer — binary
  if (
    body instanceof Buffer ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer
  ) {
    ensureHeader(ctx, 'Content-Type', 'application/octet-stream');
    return ctx.body(body as any);
  }

  // Object → JSON (covers arrays, plain objects, class instances)
  if (isObject(body)) {
    ensureHeader(ctx, 'Content-Type', 'application/json');
    return ctx.json(body);
  }

  // Fallback: number, boolean, etc. → text
  return ctx.body(String(body));
}

// ── Helpers ──────────────────────────────────────────────

function ensureHeader(ctx: Context, name: string, value: string): void {
  if (!ctx.res?.headers?.get(name)) {
    ctx.header(name, value);
  }
}

// ── StreamableFile helper ────────────────────────────────

function buildStreamableResponse(ctx: Context, sf: StreamableFile): Response {
  const h = sf.getHeaders();
  const resHeaders = ctx.res?.headers;

  if (h.type && !resHeaders?.get('Content-Type')) {
    ctx.header('Content-Type', h.type);
  }
  if (h.disposition && !resHeaders?.get('Content-Disposition')) {
    ctx.header('Content-Disposition', h.disposition as string);
  }
  if (h.length !== undefined && !resHeaders?.get('Content-Length')) {
    ctx.header('Content-Length', String(h.length));
  }

  const nodeStream = sf.getStream();

  // Convert Node.js Readable → Web ReadableStream
  const webStream =
    typeof (nodeStream as any)[Symbol.asyncIterator] === 'function' &&
    typeof (nodeStream as any).pipeTo !== 'function'
      ? new ReadableStream({
          start(controller) {
            (nodeStream as any).on('data', (chunk: any) =>
              controller.enqueue(chunk),
            );
            (nodeStream as any).on('end', () => controller.close());
            (nodeStream as any).on('error', (err: any) =>
              controller.error(err),
            );
          },
        })
      : (nodeStream as unknown as ReadableStream);

  return new Response(webStream, {
    status: ctx.res?.status ?? 200,
    headers: ctx.res?.headers,
  });
}
