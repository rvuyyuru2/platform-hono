#!/usr/bin/env node
/**
 * Comprehensive benchmark suite: Hono vs Fastify vs Express
 *
 * Usage:
 *   # Start servers first:  bun run ./benchmarks/server.mjs
 *   bun run benchmark:suite              # default ports 3000/3001/3002
 *   bun run benchmark:suite 8080         # custom base port
 *   bun run benchmark:suite 3000 15 200  # port  duration  connections
 *
 * Metrics:
 *   - Requests per second (avg, min, max)
 *   - Latency (p50, p99, max)
 *   - Throughput (MB/s)
 *   - Memory usage (RSS)
 */

import autocannon from 'autocannon';

const BASE_PORT = parseInt(process.argv[2] || '3000', 10);
const DURATION = parseInt(process.argv[3] || '10', 10);
const CONNECTIONS = parseInt(process.argv[4] || '200', 10);
const PIPELINING = 10;

const SERVERS = [
  { name: 'Hono', port: BASE_PORT },
  { name: 'Fastify', port: BASE_PORT + 1 },
  { name: 'Express', port: BASE_PORT + 2 },
];

const TESTS = [
  {
    label: 'GET / (text)',
    path: '/',
    method: 'GET',
  },
  {
    label: 'GET /json',
    path: '/json',
    method: 'GET',
  },
  {
    label: 'POST /echo (JSON)',
    path: '/echo',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello', ts: Date.now() }),
  },
];

// ── helpers ──────────────────────────────────────────────

async function isServerAlive(port) {
  try {
    const res = await fetch(`http://localhost:${port}/`);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

function run(url, opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: CONNECTIONS,
        duration: DURATION,
        pipelining: PIPELINING,
        ...opts,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
    autocannon.track(instance, { renderProgressBar: true });
  });
}

function formatNum(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}

// ── main ─────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║            PLATFORM-HONO BENCHMARK SUITE                   ║');
console.log(`║  Duration: ${DURATION}s | Connections: ${CONNECTIONS} | Pipelining: ${PIPELINING}`.padEnd(63) + '║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Check which servers are alive
const activeServers = [];
for (const server of SERVERS) {
  if (await isServerAlive(server.port)) {
    activeServers.push(server);
    console.log(`  ✓ ${server.name} alive on port ${server.port}`);
  } else {
    console.log(`  ✗ ${server.name} not found on port ${server.port} — skipping`);
  }
}

if (activeServers.length === 0) {
  console.error('\n  No servers found. Run: bun run ./benchmarks/server.mjs\n');
  process.exit(1);
}

// Results matrix: results[test][server] = { rps, lat, ... }
const allResults = [];

for (const test of TESTS) {
  const testResults = { label: test.label, servers: [] };

  for (const server of activeServers) {
    const url = `http://localhost:${server.port}${test.path}`;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${test.label} — ${server.name} (port ${server.port})`);
    console.log(`${'─'.repeat(60)}`);

    try {
      const r = await run(url, {
        method: test.method,
        headers: test.headers,
        body: test.body,
      });
      testResults.servers.push({
        name: server.name,
        rpsAvg: r.requests.average,
        rpsMax: r.requests.max,
        latP50: r.latency.p50,
        latP99: r.latency.p99,
        latMax: r.latency.max,
        throughputMBs: (r.throughput.average / 1024 / 1024).toFixed(2),
        errors: r.errors,
        timeouts: r.timeouts,
      });
    } catch (e) {
      console.log(`  ⚠  Error: ${e.message}`);
    }
  }

  allResults.push(testResults);
}

// ── summary tables ───────────────────────────────────────

console.log(`\n${'═'.repeat(90)}`);
console.log('  BENCHMARK RESULTS — COMPARISON');
console.log(`${'═'.repeat(90)}`);

for (const test of allResults) {
  console.log(`\n  ▸ ${test.label}`);
  console.log(
    '    ' +
      'Server'.padEnd(12) +
      'RPS avg'.padStart(12) +
      'RPS max'.padStart(12) +
      'p50 ms'.padStart(10) +
      'p99 ms'.padStart(10) +
      'max ms'.padStart(10) +
      'MB/s'.padStart(10) +
      'Errors'.padStart(10),
  );
  console.log('    ' + '─'.repeat(86));

  // Sort by RPS descending
  const sorted = [...test.servers].sort((a, b) => b.rpsAvg - a.rpsAvg);

  for (const s of sorted) {
    const isWinner = s === sorted[0] && test.servers.length > 1;
    const prefix = isWinner ? ' 🏆' : '   ';
    console.log(
      `  ${prefix}` +
        s.name.padEnd(12) +
        formatNum(s.rpsAvg).padStart(12) +
        formatNum(s.rpsMax).padStart(12) +
        String(s.latP50).padStart(10) +
        String(s.latP99).padStart(10) +
        String(s.latMax).padStart(10) +
        s.throughputMBs.padStart(10) +
        String(s.errors).padStart(10),
    );
  }

  // Show speedup ratio
  if (sorted.length >= 2) {
    const fastest = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const ratio = (fastest.rpsAvg / sorted[i].rpsAvg).toFixed(2);
      console.log(
        `    → ${fastest.name} is ${ratio}x faster than ${sorted[i].name}`,
      );
    }
  }
}

console.log(`\n${'═'.repeat(90)}\n`);

// ── CSV export ───────────────────────────────────────────

const csvLines = ['test,server,rps_avg,rps_max,p50_ms,p99_ms,max_ms,mb_s,errors'];
for (const test of allResults) {
  for (const s of test.servers) {
    csvLines.push(
      `"${test.label}","${s.name}",${s.rpsAvg},${s.rpsMax},${s.latP50},${s.latP99},${s.latMax},${s.throughputMBs},${s.errors}`,
    );
  }
}

import { writeFileSync } from 'fs';
const csvPath = new URL('./results.csv', import.meta.url);
writeFileSync(csvPath, csvLines.join('\n'));
console.log(`  Results saved to benchmarks/results.csv\n`);
    'Err'.padStart(6),
);
console.log(`${'─'.repeat(80)}`);

for (const r of results) {
  console.log(
    `  ${r.label.padEnd(23)}` +
      `${String(r.rpsAvg).padStart(10)}` +
      `${String(r.rpsMax).padStart(10)}` +
      `${String(r.latP50).padStart(9)}` +
      `${String(r.latP99).padStart(9)}` +
      `${String(r.latMax).padStart(9)}` +
      `${r.throughputMBs.padStart(8)}` +
      `${String(r.errors + r.timeouts).padStart(6)}`,
  );
}
console.log(`${'═'.repeat(80)}\n`);

// ── comparison reference ─────────────────────────────────

console.log('  Reference targets (NestJS):');
console.log('    Express   ≈  35,000 RPS');
console.log('    Fastify   ≈  65,000 RPS');
console.log('    Hono (this adapter) target ≥  80,000 RPS');
console.log('');
