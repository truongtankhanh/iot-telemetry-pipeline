import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRules, parseRules } from './rules-source.ts';

const rule = (change: Record<string, unknown> = {}) => ({
  id: 'server-room-hot',
  kind: 'server_room',
  metric: 'temperature_c',
  direction: 'above',
  raise: 27,
  clear: 25.5,
  for: 3,
  severity: 'high',
  incidentType: 'equipment_fault',
  title: 'Server room temperature high',
  ...change,
});

describe('parseRules', () => {
  it('keeps the fields Studio reads and drops the ones only the command center reads', () => {
    assert.deepEqual(parseRules({ $comment: 'x', rules: [rule()] }), [
      {
        id: 'server-room-hot',
        kind: 'server_room',
        metric: 'temperature_c',
        direction: 'above',
        raise: 27,
        clear: 25.5,
        for: 3,
        severity: 'high',
        title: 'Server room temperature high',
      },
    ]);
  });

  it('accepts a rule that fires below a value, with the clear line above the raise line', () => {
    const [parsed] = parseRules({ rules: [rule({ direction: 'below', raise: 10, clear: 12 })] });
    assert.equal(parsed?.direction, 'below');
  });

  it('accepts an empty list', () => {
    assert.deepEqual(parseRules({ rules: [] }), []);
  });

  it('refuses what is not a list of rules', () => {
    assert.throws(() => parseRules({}), /"rules" must be an array/);
    assert.throws(() => parseRules(null), /"rules" must be an array/);
    assert.throws(() => parseRules({ rules: 'x' }), /"rules" must be an array/);
  });

  for (const key of ['id', 'kind', 'metric', 'title']) {
    it(`refuses a rule without ${key}`, () => {
      assert.throws(
        () => parseRules({ rules: [rule({ [key]: undefined })] }),
        new RegExp(`${key} is required`),
      );
      assert.throws(
        () => parseRules({ rules: [rule({ [key]: '' })] }),
        new RegExp(`${key} is required`),
      );
    });
  }

  it('names the rule and the position of the one that is wrong', () => {
    assert.throws(
      () => parseRules({ rules: [rule(), rule({ id: 'b', direction: 'sideways' })] }),
      /rules\[1\] \(b\)\.direction must be above or below/,
    );
  });

  it('refuses a duplicate id', () => {
    assert.throws(() => parseRules({ rules: [rule(), rule()] }), /duplicate id/);
  });

  it('refuses a metric the telemetry contract does not have', () => {
    assert.throws(
      () => parseRules({ rules: [rule({ metric: 'pressure_hpa' })] }),
      /unknown metric "pressure_hpa"/,
    );
  });

  it('refuses raise and clear that are not finite numbers', () => {
    assert.throws(() => parseRules({ rules: [rule({ raise: '27' })] }), /raise and clear/);
    assert.throws(() => parseRules({ rules: [rule({ clear: Number.NaN })] }), /raise and clear/);
    assert.throws(
      () => parseRules({ rules: [rule({ raise: Number.POSITIVE_INFINITY })] }),
      /raise and clear/,
    );
  });

  it('refuses a clear line on the wrong side of the raise line, for both directions', () => {
    assert.throws(
      () => parseRules({ rules: [rule({ raise: 27, clear: 28 })] }),
      /clear must be on the safe side/,
    );
    assert.throws(
      () => parseRules({ rules: [rule({ direction: 'below', raise: 10, clear: 9 })] }),
      /clear must be on the safe side/,
    );
  });

  it('accepts a clear line equal to the raise line (no hysteresis band), as ingest does', () => {
    assert.equal(parseRules({ rules: [rule({ raise: 27, clear: 27 })] }).length, 1);
  });

  it('refuses a "for" that is not a positive integer', () => {
    for (const value of [0, -1, 1.5, '3', undefined]) {
      assert.throws(
        () => parseRules({ rules: [rule({ for: value })] }),
        /for must be a positive integer/,
      );
    }
  });

  it('refuses a severity that is not one of the four', () => {
    assert.throws(() => parseRules({ rules: [rule({ severity: 'urgent' })] }), /severity/);
  });

  it('refuses an entry that is not an object', () => {
    assert.throws(() => parseRules({ rules: [42] }), /rules\[0\]\.id is required/);
  });
});

describe('loadRules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-source-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  it('reads a valid file', () => {
    const view = loadRules(write('ok.json', JSON.stringify({ rules: [rule()] })));
    assert.equal(view.available, true);
    assert.equal(view.reason, null);
    assert.equal(view.items.length, 1);
  });

  it('says why when the file is not there, and does not throw', () => {
    const path = join(dir, 'missing.json');
    const view = loadRules(path);
    assert.equal(view.available, false);
    assert.deepEqual(view.items, []);
    assert.match(view.reason ?? '', /cannot read .*missing\.json \(ENOENT\)/);
  });

  it('says why when the file is not JSON', () => {
    const view = loadRules(write('bad.json', '{ nope'));
    assert.equal(view.available, false);
    assert.match(view.reason ?? '', /bad\.json is not valid JSON/);
  });

  it('says which rule is wrong when the content is not usable', () => {
    const view = loadRules(write('wrong.json', JSON.stringify({ rules: [rule({ for: 0 })] })));
    assert.equal(view.available, false);
    assert.deepEqual(view.items, []);
    assert.match(view.reason ?? '', /wrong\.json is not usable: rules\[0\] \(server-room-hot\)/);
  });

  it("reads the repository's own rules.json, so a change to that file that Studio cannot read is caught here", () => {
    const path = fileURLToPath(new URL('../../ingest/config/rules.json', import.meta.url));
    const view = loadRules(path);
    assert.equal(view.reason, null);
    assert.equal(view.available, true);
    assert.ok(view.items.length >= 4);
    assert.ok(view.items.some((r) => r.id === 'server-room-hot' && r.raise === 27));
  });
});
