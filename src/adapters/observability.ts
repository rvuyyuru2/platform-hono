import { Context, MiddlewareHandler, Next } from 'hono';

// ──────────── Request / Response Metrics ────────────

export interface MetricsOptions {
  /** Custom labels to add to every metric (e.g., { service: 'api' }) */
  labels?: Record<string, string>;
  /** Disable histogram collection (for lower overhead) */
  disableHistogram?: boolean;
  /** Custom buckets for latency histogram in ms */
  buckets?: number[];
  /** Prefix for metric names (default: 'http') */
  prefix?: string;
}

export interface RequestMetric {
  method: string;
  path: string;
  statusCode: number;
  duration: number; // ms
  timestamp: number;
}

export interface MetricsSummary {
  totalRequests: number;
  totalErrors: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  requestsPerSecond: number;
  byMethod: Record<string, number>;
  byStatus: Record<number, number>;
  byPath: Record<string, { count: number; avgMs: number }>;
}

/**
 * In-process metrics collector for Hono.
 *
 * Collects request count, latency distribution, error rates, and
 * per-path/method breakdowns. Designed for low overhead:
 *   - Uses circular buffer for recent metrics
 *   - No external dependencies
 *   - Compatible with OpenTelemetry export
 *
 * @example
 *   const metrics = new MetricsCollector();
 *   app.use(metrics.middleware());
 *
 *   // Prometheus-compatible endpoint
 *   app.get('/metrics', (c) => c.text(metrics.toPrometheus()));
 *
 *   // JSON summary
 *   app.get('/metrics/json', (c) => c.json(metrics.getSummary()));
 */
export class MetricsCollector {
  private readonly buffer: RequestMetric[];
  private readonly maxSize: number;
  private writeIndex = 0;
  private totalCount = 0;
  private errorCount = 0;
  private readonly prefix: string;
  private readonly labels: Record<string, string>;
  private startTime: number;

  constructor(options?: MetricsOptions & { maxBufferSize?: number }) {
    this.maxSize = options?.maxBufferSize ?? 10_000;
    this.buffer = new Array(this.maxSize);
    this.prefix = options?.prefix ?? 'http';
    this.labels = options?.labels ?? {};
    this.startTime = Date.now();
  }

  /**
   * Hono middleware that records request metrics.
   */
  middleware(): MiddlewareHandler {
    return async (ctx: Context, next: Next) => {
      const start = performance.now();

      await next();

      const duration = performance.now() - start;
      const metric: RequestMetric = {
        method: ctx.req.method,
        path: ctx.req.routePath || ctx.req.path,
        statusCode: ctx.res.status,
        duration,
        timestamp: Date.now(),
      };

      this.record(metric);
    };
  }

  private record(metric: RequestMetric): void {
    this.buffer[this.writeIndex % this.maxSize] = metric;
    this.writeIndex++;
    this.totalCount++;
    if (metric.statusCode >= 400) {
      this.errorCount++;
    }
  }

  /**
   * Get recent metrics within a time window (default: last 60 seconds).
   */
  getRecent(windowMs = 60_000): RequestMetric[] {
    const cutoff = Date.now() - windowMs;
    const recent: RequestMetric[] = [];
    const count = Math.min(this.writeIndex, this.maxSize);
    const start = this.writeIndex > this.maxSize
      ? this.writeIndex - this.maxSize
      : 0;

    for (let i = start; i < this.writeIndex; i++) {
      const m = this.buffer[i % this.maxSize];
      if (m && m.timestamp >= cutoff) {
        recent.push(m);
      }
    }
    return recent;
  }

  /**
   * Get a summary of collected metrics.
   */
  getSummary(windowMs = 60_000): MetricsSummary {
    const recent = this.getRecent(windowMs);
    const durations = recent.map((m) => m.duration).sort((a, b) => a - b);
    const uptime = (Date.now() - this.startTime) / 1000;

    const byMethod: Record<string, number> = {};
    const byStatus: Record<number, number> = {};
    const byPath: Record<string, { count: number; totalMs: number }> = {};

    for (const m of recent) {
      byMethod[m.method] = (byMethod[m.method] ?? 0) + 1;
      byStatus[m.statusCode] = (byStatus[m.statusCode] ?? 0) + 1;
      if (!byPath[m.path]) byPath[m.path] = { count: 0, totalMs: 0 };
      byPath[m.path].count++;
      byPath[m.path].totalMs += m.duration;
    }

    const pathSummary: Record<string, { count: number; avgMs: number }> = {};
    for (const [path, data] of Object.entries(byPath)) {
      pathSummary[path] = {
        count: data.count,
        avgMs: Math.round((data.totalMs / data.count) * 100) / 100,
      };
    }

    return {
      totalRequests: this.totalCount,
      totalErrors: this.errorCount,
      avgLatencyMs:
        durations.length > 0
          ? Math.round(
              (durations.reduce((a, b) => a + b, 0) / durations.length) * 100,
            ) / 100
          : 0,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      requestsPerSecond:
        uptime > 0 ? Math.round((this.totalCount / uptime) * 100) / 100 : 0,
      byMethod,
      byStatus,
      byPath: pathSummary,
    };
  }

  /**
   * Prometheus-compatible text format output.
   */
  toPrometheus(): string {
    const summary = this.getSummary();
    const prefix = this.prefix;
    const labelStr = Object.entries(this.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    const lb = labelStr ? `{${labelStr}}` : '';

    const lines: string[] = [];

    lines.push(`# HELP ${prefix}_requests_total Total HTTP requests`);
    lines.push(`# TYPE ${prefix}_requests_total counter`);
    lines.push(`${prefix}_requests_total${lb} ${summary.totalRequests}`);

    lines.push(`# HELP ${prefix}_errors_total Total HTTP errors (4xx + 5xx)`);
    lines.push(`# TYPE ${prefix}_errors_total counter`);
    lines.push(`${prefix}_errors_total${lb} ${summary.totalErrors}`);

    lines.push(
      `# HELP ${prefix}_request_duration_ms Request duration in milliseconds`,
    );
    lines.push(`# TYPE ${prefix}_request_duration_ms summary`);
    lines.push(
      `${prefix}_request_duration_ms${lb ? lb.slice(0, -1) + ',' : '{'}quantile="0.5"} ${summary.p50Ms}`,
    );
    lines.push(
      `${prefix}_request_duration_ms${lb ? lb.slice(0, -1) + ',' : '{'}quantile="0.95"} ${summary.p95Ms}`,
    );
    lines.push(
      `${prefix}_request_duration_ms${lb ? lb.slice(0, -1) + ',' : '{'}quantile="0.99"} ${summary.p99Ms}`,
    );

    for (const [method, count] of Object.entries(summary.byMethod)) {
      lines.push(
        `${prefix}_requests_by_method${lb ? lb.slice(0, -1) + ',' : '{'}method="${method}"} ${count}`,
      );
    }

    for (const [status, count] of Object.entries(summary.byStatus)) {
      lines.push(
        `${prefix}_requests_by_status${lb ? lb.slice(0, -1) + ',' : '{'}status="${status}"} ${count}`,
      );
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Reset all collected metrics.
   */
  reset(): void {
    this.writeIndex = 0;
    this.totalCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return Math.round(sorted[Math.max(0, idx)] * 100) / 100;
}

// ──────────── Request ID ────────────

export interface RequestIdOptions {
  /** Header to check for existing request ID (default: 'X-Request-Id') */
  header?: string;
  /** Custom ID generator (default: crypto.randomUUID) */
  generator?: () => string;
}

let _counter = 0;

/**
 * Request ID middleware — assigns or propagates a unique request identifier.
 *
 * @example
 *   app.use(requestId());
 *   // Access: ctx.get('requestId') or req.headers['x-request-id']
 */
export function requestId(options?: RequestIdOptions): MiddlewareHandler {
  const headerName = options?.header ?? 'X-Request-Id';
  const headerNameLower = headerName.toLowerCase();
  const generate =
    options?.generator ??
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? () => crypto.randomUUID()
      : () => `${Date.now().toString(36)}-${(++_counter).toString(36)}`);

  return async (ctx: Context, next: Next) => {
    const existing = ctx.req.header(headerNameLower);
    const id = existing || generate();

    ctx.set('requestId' as any, id);
    ctx.header(headerName, id);

    await next();
  };
}

// ──────────── Request Logger ────────────

export interface RequestLoggerOptions {
  /** Custom logger (default: console) */
  logger?: {
    info: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  /** Skip logging for certain paths (e.g., health checks) */
  skip?: (ctx: Context) => boolean;
  /** Custom log format function */
  format?: (metric: {
    method: string;
    path: string;
    status: number;
    duration: number;
    requestId?: string;
  }) => string;
}

/**
 * Structured request logger middleware.
 *
 * @example
 *   app.use(requestLogger());
 *   app.use(requestLogger({ skip: (c) => c.req.path === '/health' }));
 */
export function requestLogger(
  options?: RequestLoggerOptions,
): MiddlewareHandler {
  const logger = options?.logger ?? console;
  const skip = options?.skip;
  const format =
    options?.format ??
    ((m) =>
      `${m.method} ${m.path} ${m.status} ${m.duration.toFixed(2)}ms${m.requestId ? ` [${m.requestId}]` : ''}`);

  return async (ctx: Context, next: Next) => {
    if (skip?.(ctx)) return next();

    const start = performance.now();

    await next();

    const duration = performance.now() - start;
    const msg = format({
      method: ctx.req.method,
      path: ctx.req.path,
      status: ctx.res.status,
      duration,
      requestId: ctx.get('requestId' as any),
    });

    if (ctx.res.status >= 500) {
      logger.error(msg);
    } else {
      logger.info(msg);
    }
  };
}
