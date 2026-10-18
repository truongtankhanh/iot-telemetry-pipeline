import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * Reads V8 `.cpuprofile` files (what `node --cpu-prof` writes) and prints, as Markdown ready to paste
 * into docs/benchmarks.md: the functions with the most self time, the time by origin (the service,
 * the contract, one line per package in node_modules, Node's own code), and for each `--match` the
 * self and the inclusive share of the functions it names. Used by deploy/bench/run-baseline.sh's
 * output (IMP-11.2); no dependency.
 *
 *   node src/cpuprofile-top.ts <file.cpuprofile>... [--top 20] [--match <regex>]...
 *                              [--from <s>] [--to <s>] [--timeline]
 *
 * Shares are of the BUSY time: samples in `(idle)` are left out of the denominator and reported on
 * their own line, so the question "is the process CPU-bound?" can be answered. A sample weighs the
 * time to the NEXT sample (`timeDeltas[i + 1]`), so idle stretches, which have few but long samples,
 * count for what they last; the last sample of a file weighs nothing. `--match` is tested against
 * `<file>:<function>`, for example `mqtt-consumer.service.js:handle`: a bare `handle` also matches
 * mqtt.js and express. `--from` and `--to` keep the samples between those seconds after the start of
 * each profile (a profile begins at process start, so it includes the boot); `--timeline` prints
 * the busy share per second to help choose them. Frames are the compiled `dist/*.js` lines.
 */

interface CallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  children?: number[];
}

export interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

export interface Options {
  top: number;
  match: RegExp[];
  /** Seconds after the start of each profile; samples before it are left out. */
  from: number;
  /** Seconds after the start of each profile; samples from it on are left out. */
  to: number;
}

export interface FunctionRow {
  name: string;
  file: string;
  line: number;
  selfMs: number;
}

export interface OriginRow {
  origin: string;
  selfMs: number;
}

export interface MatchRow {
  pattern: string;
  selfMs: number;
  inclusiveMs: number;
}

export interface Summary {
  files: number;
  /** Length of the profiles, whatever the window. */
  profileMs: number;
  /** Time inside the window. */
  windowMs: number;
  idleMs: number;
  busyMs: number;
  functions: FunctionRow[];
  origins: OriginRow[];
  matches: MatchRow[];
}

const SPECIAL = new Set(['(root)', '(program)', '(idle)', '(garbage collector)']);

/** The file of a frame, short enough to read: from `apps/`, `packages/` or `node_modules/` on. */
export function shortFile(url: string): string {
  if (url === '') return '';
  const path = url.replace(/^file:\/\//, '');
  const modules = path.lastIndexOf('/node_modules/');
  if (modules >= 0) return path.slice(modules + 1);
  const repo = path.search(/\/(apps|packages)\//);
  return repo >= 0 ? path.slice(repo + 1) : path;
}

/** Where a frame's time is counted: the service, the contract, a package, Node itself or a special entry. */
export function originOf(frame: CallFrame): string {
  if (SPECIAL.has(frame.functionName)) return frame.functionName;
  const { url } = frame;
  if (url === '') return '(native, no url)';
  if (url.startsWith('node:')) return 'node internals';
  const file = shortFile(url);
  if (file.startsWith('apps/ingest/')) return 'service (apps/ingest)';
  if (file.startsWith('packages/telemetry-contract/')) return 'telemetry-contract';
  if (file.startsWith('node_modules/')) {
    const parts = file.split('/');
    // node_modules/@scope/name/... or node_modules/name/...
    const name = parts[1]!.startsWith('@') ? `${parts[1]}/${parts[2]}` : parts[1]!;
    return name === '@itp/telemetry-contract' ? 'telemetry-contract' : name;
  }
  return 'other';
}

interface Sample {
  node: number;
  ms: number;
}

/** Samples of a profile with their weights, inside the window. */
function samplesOf(profile: CpuProfile, options: Options): Sample[] {
  const { samples, timeDeltas } = profile;
  const kept: Sample[] = [];
  let at = 0; // microseconds since the profile began
  for (let i = 0; i < samples.length; i++) {
    at += timeDeltas[i] ?? 0;
    const seconds = at / 1e6;
    if (seconds < options.from || seconds >= options.to) continue;
    kept.push({ node: samples[i]!, ms: (timeDeltas[i + 1] ?? 0) / 1000 });
  }
  return kept;
}

export function profileMs(profile: CpuProfile): number {
  return profile.timeDeltas.reduce((sum, delta) => sum + delta, 0) / 1000;
}

export function summarise(profiles: CpuProfile[], options: Options): Summary {
  const self = new Map<string, FunctionRow>();
  const origins = new Map<string, number>();
  const matches = options.match.map((re) => ({ pattern: re.source, selfMs: 0, inclusiveMs: 0 }));
  let windowMs = 0;
  let idleMs = 0;

  for (const profile of profiles) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map<number, number>();
    for (const n of profile.nodes) for (const child of n.children ?? []) parent.set(child, n.id);
    // Which nodes each --match names, decided once per node.
    const named = options.match.map((re) => {
      const ids = new Set<number>();
      for (const n of profile.nodes) {
        if (re.test(`${shortFile(n.callFrame.url)}:${n.callFrame.functionName}`)) ids.add(n.id);
      }
      return ids;
    });

    for (const { node, ms } of samplesOf(profile, options)) {
      const frame = byId.get(node)?.callFrame;
      // The last sample of a file weighs nothing: it would only add a row of 0 ms.
      if (!frame || ms <= 0) continue;
      windowMs += ms;
      if (frame.functionName === '(idle)') {
        idleMs += ms;
        continue;
      }
      const origin = originOf(frame);
      origins.set(origin, (origins.get(origin) ?? 0) + ms);

      const key = `${frame.functionName}\u0000${frame.url}\u0000${frame.lineNumber}\u0000${frame.columnNumber}`;
      const row = self.get(key);
      if (row) row.selfMs += ms;
      else {
        self.set(key, {
          name: frame.functionName || '(anonymous)',
          file: shortFile(frame.url),
          line: frame.lineNumber + 1,
          selfMs: ms,
        });
      }

      // Inclusive: the sample counts once per pattern if any frame of its stack matches.
      matches.forEach((m, i) => {
        const ids = named[i]!;
        if (ids.has(node)) m.selfMs += ms;
        for (let at: number | undefined = node; at !== undefined; at = parent.get(at)) {
          if (ids.has(at)) {
            m.inclusiveMs += ms;
            break;
          }
        }
      });
    }
  }

  return {
    files: profiles.length,
    profileMs: profiles.reduce((sum, p) => sum + profileMs(p), 0),
    windowMs,
    idleMs,
    busyMs: windowMs - idleMs,
    functions: [...self.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, options.top),
    origins: [...origins]
      .map(([origin, selfMs]) => ({ origin, selfMs }))
      .sort((a, b) => b.selfMs - a.selfMs),
    matches,
  };
}

/** Busy share of each whole second of a profile, from its start. */
export function timeline(profile: CpuProfile): { second: number; busyPercent: number }[] {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const busy: number[] = [];
  const total: number[] = [];
  let at = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    at += profile.timeDeltas[i] ?? 0;
    const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const second = Math.floor(at / 1e6);
    total[second] = (total[second] ?? 0) + ms;
    if (byId.get(profile.samples[i]!)?.callFrame.functionName !== '(idle)') {
      busy[second] = (busy[second] ?? 0) + ms;
    }
  }
  return Array.from({ length: total.length }, (_, second) => ({
    second,
    busyPercent: total[second] ? ((busy[second] ?? 0) / total[second]) * 100 : 0,
  }));
}

const percent = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)} %` : '–';
const fixed = (value: number) => value.toFixed(1);
const cell = (text: string) => text.replaceAll('|', '\\|');

export function format(summary: Summary, options: Options): string {
  const lines: string[] = [];
  const windowNote =
    Number.isFinite(options.to) || options.from > 0
      ? ` (window ${options.from} s to ${options.to} s)`
      : '';
  lines.push(
    `${summary.files} profile(s), ${fixed(summary.profileMs / 1000)} s long${windowNote}: ` +
      `busy ${fixed(summary.busyMs)} ms (${percent(summary.busyMs, summary.windowMs)}), ` +
      `idle ${fixed(summary.idleMs)} ms. Shares below are of the busy time.`,
    '',
  );
  if (summary.busyMs <= 0) {
    lines.push('No busy samples in the selected window.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    `### Top ${summary.functions.length} functions by self time`,
    '',
    '| # | Function | File:line | Self ms | Self % |',
    '| - | -------- | --------- | ------- | ------ |',
  );
  summary.functions.forEach((f, i) => {
    const where = f.file ? `${f.file}:${f.line}` : '';
    lines.push(
      `| ${i + 1} | ${cell(f.name)} | ${cell(where)} | ${fixed(f.selfMs)} | ${percent(f.selfMs, summary.busyMs)} |`,
    );
  });

  lines.push(
    '',
    '### Time by origin',
    '',
    '| Origin | Self ms | Self % |',
    '| ------ | ------- | ------ |',
  );
  for (const o of summary.origins) {
    lines.push(`| ${cell(o.origin)} | ${fixed(o.selfMs)} | ${percent(o.selfMs, summary.busyMs)} |`);
  }

  if (summary.matches.length > 0) {
    lines.push(
      '',
      '### Functions named by --match',
      '',
      '| Pattern (file:function) | Self % | Inclusive % |',
      '| ----------------------- | ------ | ----------- |',
    );
    for (const m of summary.matches) {
      lines.push(
        `| ${cell(m.pattern)} | ${percent(m.selfMs, summary.busyMs)} | ${percent(m.inclusiveMs, summary.busyMs)} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export function formatTimeline(
  name: string,
  rows: { second: number; busyPercent: number }[],
): string {
  const lines = [
    `### Busy share per second: ${name}`,
    '',
    '| Second | Busy % |',
    '| ------ | ------ |',
  ];
  for (const { second, busyPercent } of rows)
    lines.push(`| ${second} | ${busyPercent.toFixed(0)} |`);
  return `${lines.join('\n')}\n`;
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      top: { type: 'string', default: '20' },
      match: { type: 'string', multiple: true, default: [] },
      from: { type: 'string', default: '0' },
      to: { type: 'string' },
      timeline: { type: 'boolean', default: false },
    },
  });
  if (positionals.length === 0) {
    console.error(
      'usage: node src/cpuprofile-top.ts <file.cpuprofile>... [--top 20] [--match <regex>]... [--from <s>] [--to <s>] [--timeline]',
    );
    process.exit(2);
  }
  const options: Options = {
    top: Number(values.top),
    match: values.match.map((pattern) => new RegExp(pattern)),
    from: Number(values.from),
    to: values.to === undefined ? Number.POSITIVE_INFINITY : Number(values.to),
  };
  const profiles = positionals.map((file) => JSON.parse(readFileSync(file, 'utf8')) as CpuProfile);

  if (values.timeline) {
    profiles.forEach((profile, i) =>
      console.log(formatTimeline(positionals[i]!, timeline(profile))),
    );
  }
  console.log(format(summarise(profiles, options), options));
}

if (import.meta.main) main();
