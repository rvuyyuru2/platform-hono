#!/usr/bin/env node
/**
 * Benchmark servers for platform-hono, Fastify, and Express.
 *
 * Starts all three servers on adjacent ports so the suite can compare them.
 *
 * Usage:
 *   bun run ./benchmarks/server.mjs          # default: Hono:3000, Fastify:3001, Express:3002
 *   bun run ./benchmarks/server.mjs 8080     # Hono:8080, Fastify:8081, Express:8082
 *
 * Each server has identical endpoints:
 *   GET  /       — plain text "Hello World"
 *   GET  /json   — JSON { message, timestamp }
 *   POST /echo   — JSON echo
 */

const basePort = parseInt(process.argv[2] || '3000', 10);

// ──────── Hono server (raw, no NestJS overhead) ────────

import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const honoApp = new Hono();

honoApp.get('/', (c) => c.text('Hello World'));
honoApp.get('/json', (c) =>
  c.json({ message: 'Hello World', timestamp: Date.now() }),
);
honoApp.post('/echo', async (c) => c.json(await c.req.json()));

serve({ fetch: honoApp.fetch, port: basePort }, () => {
  console.log(`  Hono     → http://localhost:${basePort}`);
});

// ──────── Fastify server ────────

let fastifyPort = basePort + 1;
try {
  const Fastify = (await import('fastify')).default;
  const fastify = Fastify({ logger: false });

  fastify.get('/', async () => 'Hello World');
  fastify.get('/json', async () => ({
    message: 'Hello World',
    timestamp: Date.now(),
  }));
  fastify.post('/echo', async (req) => req.body);

  await fastify.listen({ port: fastifyPort });
  console.log(`  Fastify  → http://localhost:${fastifyPort}`);
} catch (e) {
  console.log(
    `  Fastify  → SKIPPED (install fastify to compare: bun add -d fastify)`,
  );
  fastifyPort = 0;
}

// ──────── Express server ────────

let expressPort = basePort + 2;
try {
  const express = (await import('express')).default;
  const expressApp = express();
  expressApp.use(express.json());

  expressApp.get('/', (_req, res) => res.send('Hello World'));
  expressApp.get('/json', (_req, res) =>
    res.json({ message: 'Hello World', timestamp: Date.now() }),
  );
  expressApp.post('/echo', (req, res) => res.json(req.body));

  await new Promise((resolve) =>
    expressApp.listen(expressPort, () => resolve()),
  );
  console.log(`  Express  → http://localhost:${expressPort}`);
} catch (e) {
  console.log(
    `  Express  → SKIPPED (install express to compare: bun add -d express)`,
  );
  expressPort = 0;
}

console.log(`\nBenchmark servers ready. Run: bun run benchmark:suite ${basePort}`);
