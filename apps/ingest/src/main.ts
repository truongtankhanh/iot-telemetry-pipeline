import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { configureApp } from './configure-app';
import { createLogger } from './logging/create-logger';

async function bootstrap(): Promise<void> {
  // Lines written while the application is being created are held until the logger is chosen.
  const created = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = created.get(ConfigService<Env, true>);
  created.useLogger(createLogger(config.get('LOG_FORMAT', { infer: true })));
  // `useLogger` does not print the held lines by itself; Nest does it once the application has
  // started, so a boot that fails in between (for example on the database) would lose them.
  created.flushLogs();
  const app = configureApp(created);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`Ingest API on http://localhost:${port}/api — metrics at /metrics`, 'Bootstrap');
}

void bootstrap();
