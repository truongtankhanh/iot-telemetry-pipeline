/**
 * Contrast proof for Studio's design tokens (src/styles/tokens.css).
 *
 *   node scripts/contrast.ts           print every pair with its ratio
 *   node scripts/contrast.ts --check   print one line when all pass, the whole table when not (`pnpm lint`)
 *
 * Both exit 1 when a pair is below its minimum or cannot be measured. The pairs and the arithmetic are
 * in contrast-lib.ts. Plain Node 24 with type stripping, no dependency.
 */
import { readFileSync } from 'node:fs';
import { checkPairs, formatReport, parseTokens } from './contrast-lib.ts';

const TOKENS = new URL('../src/styles/tokens.css', import.meta.url);

const report = checkPairs(parseTokens(readFileSync(TOKENS, 'utf8')));
const failures = report.results.filter((r) => !r.ok);
const failed = failures.length > 0 || report.errors.length > 0;

if (process.argv.includes('--check') && !failed) {
  console.log(`contrast: ${report.results.length} pairs of src/styles/tokens.css pass`);
} else {
  console.log(formatReport(report));
}

if (failed) {
  console.error(
    `contrast: ${failures.length} pair(s) below their minimum, ${report.errors.length} that could not be measured`,
  );
  process.exit(1);
}
