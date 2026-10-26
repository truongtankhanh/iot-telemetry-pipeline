/**
 * The budget of the digital twin's 3D scene chunk (ADR-0012): at most 350,000 bytes gzipped, and requested only on /twin.
 *
 *   pnpm --filter @itp/simulator-ui budget            build with a manifest into dist-budget, then check it
 *   node scripts/chunk-budget.ts <dist directory>     check a build made with `vite build --manifest`
 *
 * Exits 1 when the chunk is over budget or is not lazy, 2 when there is no manifest to read. The counting is in
 * chunk-budget-lib.ts. Plain Node 24 with type stripping, no dependency.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { budgetReport, formatReport, type Manifest } from './chunk-budget-lib.ts';

const dist = process.argv[2];
if (dist === undefined) {
  console.error('usage: node scripts/chunk-budget.ts <dist directory built with --manifest>');
  process.exit(2);
}

const manifestPath = join(dist, '.vite', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(
    `no ${manifestPath}: build with "vite build --manifest" (pnpm --filter @itp/simulator-ui budget does)`,
  );
  process.exit(2);
}

const report = budgetReport(JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest, {
  read: (file) => readFileSync(join(dist, file)),
  jsFiles: () =>
    readdirSync(join(dist, 'assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => `assets/${name}`),
  indexHtml: readFileSync(join(dist, 'index.html'), 'utf8'),
});

console.log(formatReport(report));
if (report.problems.length > 0) process.exit(1);
