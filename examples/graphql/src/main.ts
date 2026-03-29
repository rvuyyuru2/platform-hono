import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { HonoAdapter } from '../../../src/adapters';
import type { NestHonoApplication } from '../../../src/interfaces';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestHonoApplication>(
    AppModule,
    new HonoAdapter(),
  );

  app.enableCors({ origin: '*' });

  await app.listen(3000);
  Logger.log('GraphQL example running on http://localhost:3000');
  Logger.log('GraphQL Playground: http://localhost:3000/graphql');
}
bootstrap();
