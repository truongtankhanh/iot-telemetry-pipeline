import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from './config/env.validation';
import { requestIdMiddleware } from './logging/request-id.middleware';

/**
 * The HTTP setup every way of running the service shares: the request id, the route prefix, the
 * request validation and the shutdown hooks. Also what the OpenAPI generator applies, so its paths
 * carry the prefix.
 */
export function configureHttp(app: INestApplication): INestApplication {
  // First, so that every route, the probes and /metrics included, answers with a request id.
  app.use(requestIdMiddleware);
  // /metrics stays at the root, where Prometheus expects it.
  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  return app;
}

/** The OpenAPI document of the routes `app` serves. Call it after `configureHttp`. */
export function buildOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('IoT Telemetry Pipeline')
      .setDescription('Devices, readings, rollups and alerts. Prometheus metrics at /metrics.')
      .setVersion('0.1.0')
      .build(),
  );
}

/** HTTP setup shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): INestApplication {
  configureHttp(app);
  if (app.get(ConfigService<Env, true>).get('API_DOCS_ENABLED', { infer: true })) {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
  }
  return app;
}
