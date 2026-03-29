import { Logger } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';

import { HonoAdapter } from '../../../src/adapters';
import type { NestHonoApplication } from '../../../src/interfaces';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './filters/all-exception.filter';
import { NotFoundFilter } from './filters/not-found.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestHonoApplication>(
    AppModule,
    new HonoAdapter(),
    { rawBody: true },
  );

  // CORS
  app.enableCors({ origin: '*' });

  // Static assets
  app.useStaticAssets('/public', { root: 'public' });

  // Body parsers with size limits
  app.useBodyParser('application/json', 50 * 1024 * 1024);
  app.useBodyParser('application/x-www-form-urlencoded', 5 * 1024 * 1024);
  app.useBodyParser('text/plain', 50 * 1024 * 1024);

  // Global exception filters
  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new AllExceptionsFilter(httpAdapter),
    new NotFoundFilter(httpAdapter),
  );

  await app.listen(3000);
  Logger.log('REST example running on http://localhost:3000');
}
bootstrap();
