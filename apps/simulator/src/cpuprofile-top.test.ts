import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type CpuProfile,
  format,
  type Options,
  originOf,
  shortFile,
  summarise,
  timeline,
} from './cpuprofile-top.ts';

const REPO = 'file:///Users/dev/iot-telemetry-pipeline';
const CONSUMER = `${REPO}/apps/ingest/dist/telemetry/mqtt-consumer.service.js`;
const CONTRACT = `${REPO}/packages/telemetry-contract/dist/index.cjs`;
const MQTT = `${REPO}/node_modules/.pnpm/mqtt@5.16.0/node_modules/mqtt/build/lib/handlers/index.js`;
const NEST = `${REPO}/node_modules/.pnpm/@nestjs+core@12.1.2/node_modules/@nestjs/core/index.js`;

const node = (id: number, functionName: string, url: string, children: number[] = []) => ({
  id,
  callFrame: { functionName, url, lineNumber: id * 10, columnNumber: 0 },
  children,
});

/**
 * root(1) ─ (program)(2)
 *         ─ (idle)(3)
 *         ─ mqtt `handle`(4) ─ service `handle`(5) ─ `parsePayload`(6) ─ `JSON.parse`(7)
 *         ─ (garbage collector)(8)
 *         ─ nest `handle`(9)   (another function that is also called `handle`)
 */
const nodes = [
  node(1, '(root)', '', [2, 3, 4, 8, 9]),
  node(2, '(program)', ''),
  node(3, '(idle)', ''),
  node(4, 'handle', MQTT, [5]),
  node(5, 'handle', CONSUMER, [6]),
  node(6, 'parsePayload', CONTRACT, [7]),
  node(7, 'JSON.parse', ''),
  node(8, '(garbage collector)', ''),
  node(9, 'handle', NEST),
];

/**
 * A profile whose samples last exactly the given milliseconds. A sample weighs the delta of the NEXT
 * sample, so a final idle sentinel carries the last real sample's duration and weighs nothing.
 */
function profileOf(spent: [node: number, ms: number][]): CpuProfile {
  const samples = [...spent.map(([id]) => id), 3];
  const timeDeltas = [0, ...spent.map(([, ms]) => ms * 1000)];
  return { nodes, samples, timeDeltas };
}

const options = (extra: Partial<Options> = {}): Options => ({
  top: 20,
  match: [],
  from: 0,
  to: Number.POSITIVE_INFINITY,
  ...extra,
});

// 100 ms busy, 100 ms idle: parsePayload 50, service handle 30, JSON.parse 20.
const sample = profileOf([
  [5, 30],
  [6, 50],
  [3, 100],
  [7, 20],
]);

describe('summarise', () => {
  it('ranks functions by self time and leaves idle out of the denominator', () => {
    const summary = summarise([sample], options());

    assert.equal(summary.busyMs, 100);
    assert.equal(summary.idleMs, 100);
    assert.deepEqual(
      summary.functions.map((f) => [f.name, f.selfMs]),
      [
        ['parsePayload', 50],
        ['handle', 30],
        ['JSON.parse', 20],
      ],
    );
    assert.equal(summary.functions[0]!.file, 'packages/telemetry-contract/dist/index.cjs');
    assert.equal(summary.functions[0]!.line, 61); // lineNumber is zero-based
  });

  it('adds up the time by origin', () => {
    const summary = summarise(
      [
        profileOf([
          [5, 30],
          [6, 50],
          [4, 10],
          [9, 5],
          [8, 3],
          [2, 2],
          [7, 20],
        ]),
      ],
      options(),
    );

    const byOrigin = Object.fromEntries(summary.origins.map((o) => [o.origin, o.selfMs]));
    assert.deepEqual(byOrigin, {
      'service (apps/ingest)': 30,
      'telemetry-contract': 50,
      '(native, no url)': 20,
      mqtt: 10,
      '@nestjs/core': 5,
      '(garbage collector)': 3,
      '(program)': 2,
    });
  });

  it('keeps functions of the same name apart by file', () => {
    const summary = summarise(
      [
        profileOf([
          [4, 10],
          [5, 30],
          [9, 5],
        ]),
      ],
      options(),
    );
    assert.deepEqual(
      summary.functions.map((f) => [f.name, f.file, f.selfMs]),
      [
        ['handle', 'apps/ingest/dist/telemetry/mqtt-consumer.service.js', 30],
        ['handle', 'node_modules/mqtt/build/lib/handlers/index.js', 10],
        ['handle', 'node_modules/@nestjs/core/index.js', 5],
      ],
    );
  });

  it('counts a --match inclusively, once per sample, through its callees', () => {
    const summary = summarise(
      [sample],
      options({
        match: [
          /:parsePayload$/, //                              self 50, plus JSON.parse below it: 70
          /mqtt-consumer\.service\.js:handle$/, //          self 30, plus everything below: 100
          /(handle|parsePayload|JSON\.parse)$/, //          three frames on one stack: still 100, not 170
        ],
      }),
    );

    assert.deepEqual(
      summary.matches.map((m) => [m.selfMs, m.inclusiveMs]),
      [
        [50, 70],
        [30, 100],
        [100, 100],
      ],
    );
  });

  it('a bare name also names the functions of other files, which is why the pattern has the file', () => {
    const summary = summarise(
      [
        profileOf([
          [4, 10],
          [9, 5],
          [5, 30],
        ]),
      ],
      options({ match: [/handle$/, /mqtt-consumer\.service\.js:handle$/] }),
    );
    assert.deepEqual(
      summary.matches.map((m) => m.inclusiveMs),
      [45, 30],
    );
  });

  it('keeps only the samples inside the window', () => {
    // Samples start at 0, 10, 20, 30 s; `--from 10 --to 30` keeps the 2nd and the 3rd.
    const profile: CpuProfile = {
      nodes,
      samples: [5, 6, 7, 5, 3],
      timeDeltas: [0, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    };
    const summary = summarise([profile], options({ from: 10, to: 30 }));
    assert.deepEqual(
      summary.functions.map((f) => [f.name, f.selfMs]),
      [
        ['parsePayload', 10_000],
        ['JSON.parse', 10_000],
      ],
    );
  });

  it('adds several profiles up', () => {
    const summary = summarise([sample, sample], options({ match: [/:parsePayload$/] }));
    assert.equal(summary.files, 2);
    assert.equal(summary.busyMs, 200);
    assert.equal(summary.functions[0]!.selfMs, 100);
    assert.equal(summary.matches[0]!.inclusiveMs, 140);
  });

  it('does not divide by zero when there is nothing to report', () => {
    const empty: CpuProfile = { nodes, samples: [], timeDeltas: [] };
    const idleOnly = profileOf([[3, 50]]);
    for (const profile of [empty, idleOnly]) {
      const text = format(summarise([profile], options()), options());
      assert.match(text, /No busy samples in the selected window\./);
      assert.doesNotMatch(text, /NaN|Infinity/);
    }
  });
});

describe('format', () => {
  it('prints the three blocks with shares of the busy time, and escapes pipes', () => {
    const piped: CpuProfile = {
      nodes: [node(1, '(root)', '', [2]), node(2, 'a|b', CONSUMER)],
      samples: [2, 1],
      timeDeltas: [0, 40_000],
    };
    const summary = summarise([piped, sample], options({ match: [/:parsePayload$/] }));
    const text = format(summary, options({ match: [/:parsePayload$/] }));

    assert.match(text, /### Top 4 functions by self time/);
    assert.match(text, /\| a\\\|b \|/);
    assert.match(text, /### Time by origin/);
    assert.match(text, /### Functions named by --match/);
    assert.match(text, /\| :parsePayload\$ \| 35\.7 % \| 50\.0 % \|/);
  });
});

describe('timeline', () => {
  it('gives the busy share of each second', () => {
    const profile: CpuProfile = {
      nodes,
      // second 0: 250 ms busy, 750 ms idle; second 1: 1000 ms busy
      samples: [6, 3, 6, 3],
      timeDeltas: [0, 250_000, 750_000, 1_000_000],
    };
    const rows = timeline(profile);
    assert.equal(rows[0]!.second, 0);
    assert.equal(Math.round(rows[0]!.busyPercent), 25);
    assert.equal(Math.round(rows[1]!.busyPercent), 100);
  });
});

describe('origins and file names', () => {
  it('reads packages out of pnpm paths, scoped ones included', () => {
    assert.equal(
      originOf({ functionName: 'f', url: MQTT, lineNumber: 0, columnNumber: 0 }),
      'mqtt',
    );
    assert.equal(
      originOf({ functionName: 'f', url: NEST, lineNumber: 0, columnNumber: 0 }),
      '@nestjs/core',
    );
    assert.equal(
      originOf({ functionName: 'f', url: 'node:internal/url', lineNumber: 0, columnNumber: 0 }),
      'node internals',
    );
    assert.equal(
      originOf({
        functionName: 'f',
        url: 'file:///elsewhere/x.js',
        lineNumber: 0,
        columnNumber: 0,
      }),
      'other',
    );
  });

  it('shortens a url to the repository-relative part', () => {
    assert.equal(shortFile(CONSUMER), 'apps/ingest/dist/telemetry/mqtt-consumer.service.js');
    assert.equal(shortFile(''), '');
  });
});
