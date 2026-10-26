/**
 * The size and the laziness of the digital twin's 3D scene chunk, from a Vite build with a manifest.
 *
 * The size is counted the way the command center counts its twin (ADR-0020), so the two can be compared: zlib level 9,
 * the scene chunk's `.js` and `.css` and the chunks only the scene imports, 1 KB = 1,000 bytes, against 350,000 bytes
 * (ADR-0012). `gzip -c` is level 6 and one file, and gives a slightly larger figure for the same chunk. Laziness is the
 * other half of the budget: the scene must not be in the entry's static imports, not be named in `index.html`, and be the
 * only place three.js's renderer is. Pure: the files are read through `source`, so it is tested without a build.
 */
import { gzipSync } from 'node:zlib';

/** The scene's source file, as the manifest names it. */
export const SCENE_SOURCE = 'src/twin/TwinScene.tsx';
/** ADR-0012: the budget of the twin's lazy chunk, gzipped. */
export const BUDGET_BYTES = 350_000;
/** What three.js's renderer is called in a bundle: only the scene's files may contain it. */
const RENDERER = 'WebGLRenderer';

export interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

export type Manifest = Record<string, ManifestChunk>;

export interface BuildSource {
  /** The bytes of a file of the build, by the path the manifest gives (`assets/…`). */
  read: (file: string) => Uint8Array;
  /** Every `.js` file of the build, as `assets/…`. */
  jsFiles: () => string[];
  indexHtml: string;
}

export interface CountedFile {
  file: string;
  bytes: number;
  gzipBytes: number;
}

export interface BudgetReport {
  /** The scene chunk's file, or `null` when the manifest has no such chunk. */
  sceneFile: string | null;
  files: CountedFile[];
  totalGzipBytes: number;
  budgetBytes: number;
  /** Budget minus total: negative when over. */
  marginBytes: number;
  /** What is wrong, one sentence each; empty when the budget and the laziness hold. */
  problems: string[];
}

/** Every chunk reachable from `start` through `next`, `start` included. */
function closure(
  manifest: Manifest,
  start: string,
  next: (chunk: ManifestChunk) => string[],
): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    const chunk = manifest[key];
    if (chunk === undefined) continue;
    for (const child of next(chunk)) {
      if (!seen.has(child) && manifest[child] !== undefined) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return seen;
}

const staticImports = (chunk: ManifestChunk) => chunk.imports ?? [];

/** The scene chunk and the chunks only it imports: reachable from it, not loaded at start, and imported by nothing else. */
function ownChunks(manifest: Manifest, sceneKey: string, loadedAtStart: ReadonlySet<string>) {
  const importers = new Map<string, Set<string>>();
  for (const [key, chunk] of Object.entries(manifest)) {
    for (const child of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      const set = importers.get(child) ?? new Set<string>();
      set.add(key);
      importers.set(child, set);
    }
  }
  const own = closure(manifest, sceneKey, staticImports);
  for (const key of [...own]) if (loadedAtStart.has(key)) own.delete(key);
  own.add(sceneKey);
  // A chunk the scene shares with another lazy chunk is not the scene's own: take out what something outside the set imports.
  for (let changed = true; changed;) {
    changed = false;
    for (const key of [...own]) {
      if (key === sceneKey) continue;
      if ([...(importers.get(key) ?? [])].some((importer) => !own.has(importer))) {
        own.delete(key);
        changed = true;
      }
    }
  }
  return own;
}

export function budgetReport(
  manifest: Manifest,
  source: BuildSource,
  budgetBytes: number = BUDGET_BYTES,
): BudgetReport {
  const empty = (problem: string): BudgetReport => ({
    sceneFile: null,
    files: [],
    totalGzipBytes: 0,
    budgetBytes,
    marginBytes: budgetBytes,
    problems: [problem],
  });

  const entries = Object.entries(manifest);
  const sceneKey = entries.find(
    ([key, chunk]) => key === SCENE_SOURCE || chunk.src === SCENE_SOURCE,
  )?.[0];
  if (sceneKey === undefined) {
    return empty(`the manifest has no ${SCENE_SOURCE}: the scene is not a chunk of its own`);
  }
  const entryKey = entries.find(([, chunk]) => chunk.isEntry === true)?.[0];
  if (entryKey === undefined) return empty('the manifest has no entry chunk');

  const loadedAtStart = closure(manifest, entryKey, staticImports);
  const own = ownChunks(manifest, sceneKey, loadedAtStart);

  const files: CountedFile[] = [];
  const count = (file: string) => {
    const bytes = source.read(file);
    files.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length });
  };
  for (const key of own) {
    const chunk = manifest[key];
    if (chunk === undefined) continue;
    count(chunk.file);
    for (const css of chunk.css ?? []) count(css);
  }
  const totalGzipBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  const sceneFile = manifest[sceneKey]?.file ?? null;

  const problems: string[] = [];
  if (totalGzipBytes > budgetBytes) {
    problems.push(
      `the scene chunk is ${totalGzipBytes} bytes gzipped, over the budget of ${budgetBytes}`,
    );
  }
  if (loadedAtStart.has(sceneKey)) {
    problems.push(
      'the scene is in the static import graph of the entry: it is loaded on every page',
    );
  }
  const ownFiles = new Set(files.map((file) => file.file));
  for (const file of source.jsFiles()) {
    if (!ownFiles.has(file) && Buffer.from(source.read(file)).includes(RENDERER)) {
      problems.push(`${file} has three.js's renderer but is not one of the scene's own files`);
    }
  }
  for (const { file } of files) {
    if (source.indexHtml.includes(file)) {
      problems.push(`index.html names ${file} (a script or a modulepreload)`);
    }
  }

  return {
    sceneFile,
    files,
    totalGzipBytes,
    budgetBytes,
    marginBytes: budgetBytes - totalGzipBytes,
    problems,
  };
}

const grouped = (n: number) => n.toLocaleString('en-US');

/** The report as text: the files counted, the total against the budget, and every problem. */
export function formatReport(report: BudgetReport): string {
  const lines: string[] = [];
  if (report.sceneFile !== null) {
    lines.push(`scene chunk: ${report.sceneFile}`);
    lines.push('files counted (raw bytes, gzip level 9):');
    for (const file of report.files) {
      lines.push(`  ${file.file}  ${file.bytes}  ${file.gzipBytes}`);
    }
    lines.push(
      `total ${grouped(report.totalGzipBytes)} bytes gzipped, budget ${grouped(report.budgetBytes)}, margin ${grouped(report.marginBytes)}`,
    );
  }
  lines.push(
    report.problems.length === 0
      ? 'chunk budget: ok (within budget, requested only by the twin page)'
      : `chunk budget: FAILED\n  - ${report.problems.join('\n  - ')}`,
  );
  return lines.join('\n');
}
