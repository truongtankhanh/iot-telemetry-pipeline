import { NestFactory } from '@nestjs/core';
import { buildOpenApiDocument, configureHttp } from '../configure-app';
import { OpenApiModule } from './openapi.module';

/**
 * The OpenAPI document of the service as text: the one that `docs/openapi.json` holds and that
 * `pnpm --filter @itp/ingest openapi:check` compares against. Two-space JSON and one final newline,
 * with nothing that changes between runs (no timestamp), so a byte comparison is meaningful.
 *
 * The application is created but never started, so nothing listens on a port.
 */
export async function renderOpenApiDocument(): Promise<string> {
  const app = await NestFactory.create(OpenApiModule, { logger: false });
  try {
    configureHttp(app);
    return `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
