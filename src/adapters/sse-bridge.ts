import { Context } from 'hono';

/**
 * Adds Node.js streaming shims (`writeHead`, `write`, `end`, `on`, `flushHeaders`)
 * to a Hono Context so NestJS's `@Sse()` decorator and any code that writes
 * directly to the response stream works out of the box.
 *
 * When running on `@hono/node-server`, the raw `ServerResponse` is at
 * `ctx.env.outgoing`. These shims delegate to that.
 *
 * If no raw response is available (e.g. edge runtime), writes are buffered
 * and a final Response is assembled on `end()`.
 */
export function bridgeStreamingResponse(ctx: Context): void {
  const c = ctx as any;

  // Already bridged?
  if (c._sseBridged) return;
  c._sseBridged = true;

  const rawRes = ctx.env?.outgoing;

  if (rawRes && typeof rawRes.writeHead === 'function') {
    // Node.js path — delegate to the underlying ServerResponse
    c.writeHead = rawRes.writeHead.bind(rawRes);
    c.write = rawRes.write.bind(rawRes);
    c.end = rawRes.end.bind(rawRes);
    c.on = rawRes.on.bind(rawRes);
    c.once = rawRes.once?.bind(rawRes);
    c.flushHeaders = rawRes.flushHeaders?.bind(rawRes);
    c.headersSent = rawRes.headersSent ?? false;

    // Keep headersSent in sync (accessed by NestJS)
    Object.defineProperty(c, 'headersSent', {
      get: () => rawRes.headersSent,
      configurable: true,
    });
  } else {
    // Edge runtime fallback: buffer chunks and assemble on end()
    const chunks: Uint8Array[] = [];
    let headers: Record<string, string> = {};
    let statusCode = 200;
    let ended = false;

    c.writeHead = (status: number, hdrs?: Record<string, string>) => {
      statusCode = status;
      if (hdrs) headers = { ...headers, ...hdrs };
    };

    c.write = (chunk: any) => {
      if (ended) return false;
      const data =
        typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      chunks.push(data);
      return true;
    };

    c.end = (chunk?: any) => {
      if (ended) return;
      ended = true;
      if (chunk) {
        const data =
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
        chunks.push(data);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
      const body = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        body.set(c, offset);
        offset += c.byteLength;
      }
      ctx.res = new Response(body, { status: statusCode, headers });
    };

    c.on = () => c;
    c.once = () => c;
    c.flushHeaders = () => {};
    c.headersSent = false;
  }
}
