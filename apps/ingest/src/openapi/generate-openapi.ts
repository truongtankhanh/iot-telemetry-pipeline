import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderOpenApiDocument } from './render-openapi';

/**
 * Writes `docs/openapi.json`, or with `--check` says whether the file in the repository still matches
 * the controllers. Run it from the build (`pnpm docs:openapi`, `pnpm --filter @itp/ingest openapi:check`):
 * the Swagger plugin that adds descriptions and inferred properties runs in `nest build`, not in ts-jest.
 */

/** From `dist/openapi` up to the repository root; only meaningful inside the repository. */
const TARGET = join(__dirname, '../../../../docs/openapi.json');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) {
    console.error('Usage: node dist/openapi/generate-openapi.js [--check]');
    process.exitCode = 2;
    return;
  }

  const rendered = await renderOpenApiDocument();
  if (args.includes('--check')) {
    const committed = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : undefined;
    if (committed !== rendered) {
      console.error(
        'docs/openapi.json does not match the controllers: run `pnpm docs:openapi` and commit the result.',
      );
      process.exitCode = 1;
    }
    return;
  }
  writeFileSync(TARGET, rendered);
  console.log(`Wrote ${TARGET}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
