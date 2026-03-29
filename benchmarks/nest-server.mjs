#!/usr/bin/env node
/**
 * NestJS benchmark server — measures adapter overhead WITH NestJS DI pipeline.
 *
 * This is the real-world benchmark: it measures the HonoAdapter running
 * inside a full NestJS application with modules, controllers, and DI.
 *
 * Usage:
 *   bun run --bun ./benchmarks/nest-server.mjs
 *
 * Then: bun run benchmark:suite 4000
 */

import { Controller, Get, Post, Body, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

// Inline controller — minimal allocations
@Controller()
class BenchController {
  @Get('/')
  hello() {
    return 'Hello World';
  }

  @Get('/json')
  json() {
    return { message: 'Hello World', timestamp: Date.now() };
  }

  @Post('/echo')
  echo(@Body() body) {
    return body;
  }
}

@Module({ controllers: [BenchController] })
class BenchModule {}

async function bootstrap() {
  // Dynamic import to support both installed and local builds
  const { HonoAdapter } = await import('../src/adapters/hono-adapter.ts');

  const app = await NestFactory.create(BenchModule, new HonoAdapter(), {
    logger: false,
  });

  await app.listen(4000);
  console.log(`NestJS + HonoAdapter benchmark server on http://localhost:4000`);
  console.log('Endpoints: GET /, GET /json, POST /echo');
}

bootstrap();
