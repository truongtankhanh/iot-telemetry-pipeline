import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORWARDED_METRICS, parseExposition, selectForwarded } from './prometheus-text.ts';

// The shape `prom-client` writes for ingest's metrics (comments, counters with and without labels,
// a histogram, a default process metric).
const EXPOSITION = `# HELP telemetry_messages_total MQTT messages received, by result
# TYPE telemetry_messages_total counter
telemetry_messages_total{result="accepted"} 1520
telemetry_messages_total{result="rejected"} 3

# HELP telemetry_sequence_gaps_total Messages confirmed missing from per-device sequence numbers
# TYPE telemetry_sequence_gaps_total counter
telemetry_sequence_gaps_total 0

# TYPE telemetry_ingest_lag_seconds histogram
telemetry_ingest_lag_seconds_bucket{le="0.05"} 10
telemetry_ingest_lag_seconds_bucket{le="+Inf"} 1520
telemetry_ingest_lag_seconds_sum 41.25
telemetry_ingest_lag_seconds_count 1520
process_cpu_user_seconds_total 12.5
`;

describe('parseExposition', () => {
  it('reads counters with and without labels and skips comments and blank lines', () => {
    const samples = parseExposition(EXPOSITION);
    assert.deepEqual(samples[0], {
      name: 'telemetry_messages_total',
      labels: { result: 'accepted' },
      value: 1520,
    });
    assert.deepEqual(samples[1], {
      name: 'telemetry_messages_total',
      labels: { result: 'rejected' },
      value: 3,
    });
    assert.deepEqual(samples[2], { name: 'telemetry_sequence_gaps_total', labels: {}, value: 0 });
    assert.equal(samples.length, 8);
  });

  it('reads the histogram buckets, sum and count', () => {
    const byName = new Map(parseExposition(EXPOSITION).map((s) => [`${s.name}`, s]));
    assert.equal(byName.get('telemetry_ingest_lag_seconds_sum')?.value, 41.25);
    assert.equal(byName.get('telemetry_ingest_lag_seconds_count')?.value, 1520);
    const buckets = parseExposition(EXPOSITION).filter(
      (s) => s.name === 'telemetry_ingest_lag_seconds_bucket',
    );
    assert.deepEqual(
      buckets.map((b) => [b.labels.le, b.value]),
      [
        ['0.05', 10],
        ['+Inf', 1520],
      ],
    );
  });

  it('reads several labels, escaped quotes, backslashes and newlines in a value', () => {
    const [sample] = parseExposition('m{a="x",b="say \\"hi\\"",c="back\\\\slash",d="l1\\nl2"} 7');
    assert.deepEqual(sample?.labels, { a: 'x', b: 'say "hi"', c: 'back\\slash', d: 'l1\nl2' });
    assert.equal(sample?.value, 7);
  });

  it('reads a trailing comma, spaces inside the braces and a timestamp after the value', () => {
    const [sample] = parseExposition('m{ a="1" , b="2", } 5 1700000000000');
    assert.deepEqual(sample?.labels, { a: '1', b: '2' });
    assert.equal(sample?.value, 5);
  });

  it('reads NaN, infinities, exponents and negative numbers', () => {
    const values = parseExposition('a NaN\nb +Inf\nc -Inf\nd 1.5e3\ne -2').map((s) => s.value);
    assert.ok(Number.isNaN(values[0]));
    assert.deepEqual(values.slice(1), [Infinity, -Infinity, 1500, -2]);
  });

  it('skips a line that does not parse and keeps the rest', () => {
    const samples = parseExposition(
      [
        'good_total 1',
        'no value here{',
        'bad{a="unterminated} 2',
        'also_good 3',
        '{a="1"} 4',
        'x abc',
      ].join('\n'),
    );
    assert.deepEqual(
      samples.map((s) => s.name),
      ['good_total', 'also_good'],
    );
  });

  it('handles CRLF line ends and an empty body', () => {
    assert.equal(parseExposition('a 1\r\nb 2\r\n').length, 2);
    assert.deepEqual(parseExposition(''), []);
  });
});

describe('selectForwarded', () => {
  it('keeps only the forwarded metrics, whatever their labels', () => {
    const kept = selectForwarded(parseExposition(EXPOSITION));
    assert.deepEqual(
      kept.map((s) => s.name),
      [
        'telemetry_messages_total',
        'telemetry_messages_total',
        'telemetry_sequence_gaps_total',
        'telemetry_ingest_lag_seconds_sum',
        'telemetry_ingest_lag_seconds_count',
      ],
    );
  });

  it('drops a forwarded sample whose value JSON cannot carry', () => {
    const kept = selectForwarded(
      parseExposition(
        'telemetry_sequence_gaps_total NaN\nalert_deliveries_total{result="ok"} +Inf\nalerts_transitions_total{transition="opened"} 2',
      ),
    );
    assert.deepEqual(
      kept.map((s) => s.name),
      ['alerts_transitions_total'],
    );
  });

  it('forwards eight metric names', () => {
    assert.equal(FORWARDED_METRICS.length, 8);
    assert.equal(new Set(FORWARDED_METRICS).size, 8);
  });
});
