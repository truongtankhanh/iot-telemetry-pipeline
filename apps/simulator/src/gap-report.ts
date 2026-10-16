import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import type { DeviceSpec } from './signals.ts';

/**
 * Accounts for every message of a `bench.ts` run after the fact (V1-T01): messages the replicas
 * accepted, plus the gaps they confirmed, plus gaps still open, plus the messages lost at the very
 * end of a device's run (no later message exists to reveal them) must equal what was published.
 *
 * Assumes a fresh database whose devices were seeded with `last_seq = 1000000` (run-gap-check.sh),
 * which is where bench.ts starts counting.
 */

const { values } = parseArgs({
  options: {
    messages: { type: 'string' },
    metrics: { type: 'string', multiple: true, default: [] },
    database: {
      type: 'string',
      default: 'postgres://postgres:postgres@localhost:5434/telemetry',
    },
    registry: {
      type: 'string',
      default: new URL('../../ingest/config/devices.json', import.meta.url).pathname,
    },
    expect: { type: 'string', default: 'none' },
  },
});

const BASE_SEQ = 1_000_000;
const total = Number(values.messages);
const devices = (JSON.parse(readFileSync(values.registry, 'utf8')) as { devices: DeviceSpec[] })
  .devices;

// bench.ts sends message i to device i % devices.length.
const published = new Map(
  devices.map((d, k) => [d.id, Math.floor((total - k - 1) / devices.length) + 1]),
);

const sum = (text: string, name: string, labels = '') =>
  [...text.matchAll(new RegExp(`^${name}${labels} (\\S+)$`, 'gm'))].reduce(
    (n, m) => n + Number(m[1]),
    0,
  );

let accepted = 0;
let confirmed = 0;
for (const url of values.metrics) {
  const text = await (await fetch(url)).text();
  accepted += sum(text, 'telemetry_messages_total', '\\{result="accepted"\\}');
  confirmed += sum(text, 'telemetry_sequence_gaps_total');
}

const db = new pg.Pool({ connectionString: values.database });
const { rows } = await db.query<{ id: string; last_seq: string | null; open: string }>(
  `SELECT d.id, d.last_seq,
          coalesce((SELECT sum((h->>1)::bigint - (h->>0)::bigint + 1)
                    FROM jsonb_array_elements(d.seq_holes) h), 0) AS open
   FROM device d`,
);
await db.end();

let open = 0;
let tail = 0;
for (const row of rows) {
  const n = published.get(row.id);
  if (n === undefined) continue; // a device the bench did not publish for
  open += Number(row.open);
  tail += BASE_SEQ + n - Number(row.last_seq ?? BASE_SEQ);
}

const accounted = accepted + confirmed + open + tail;
console.table({
  'messages published': total,
  'accepted by the replicas': accepted,
  'gaps confirmed (metric, all replicas)': confirmed,
  'gaps still open (database)': open,
  'lost at the end of a device run': tail,
  'accounted for': accounted,
  unaccounted: total - accounted,
});

const lost = confirmed + open + tail;
const exact = accounted === total;
const verdict = values.expect === 'loss' ? exact && lost > 0 : exact && lost === 0;
console.log(
  verdict
    ? `PASS (${values.expect === 'loss' ? `${lost} lost messages, each counted once` : 'no gaps, none lost'})`
    : `FAIL (expected ${values.expect === 'loss' ? 'loss, accounted exactly' : 'no loss and no gaps'})`,
);
process.exit(verdict ? 0 : 1);
