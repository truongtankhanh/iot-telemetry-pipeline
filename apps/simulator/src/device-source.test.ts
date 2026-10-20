import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JsonFileDeviceSource } from './device-source.ts';

const registry = new URL('../../ingest/config/devices.json', import.meta.url).pathname;

describe('JsonFileDeviceSource', () => {
  it('loads the devices of the ingest registry', async () => {
    const devices = await new JsonFileDeviceSource(registry).load();

    assert.ok(devices.length > 0);
    assert.equal(new Set(devices.map((d) => d.id)).size, devices.length);
    for (const device of devices) {
      assert.equal(typeof device.id, 'string');
      assert.equal(typeof device.kind, 'string');
      assert.equal(typeof device.zoneCode, 'string');
      assert.ok(device.metrics.length > 0);
    }
    const dc = devices.find((d) => d.id === 'dc-env-01');
    assert.deepEqual(dc?.metrics, ['temperature_c', 'humidity_pct']);
  });

  it('rejects when the file is missing', async () => {
    await assert.rejects(new JsonFileDeviceSource('/nonexistent/devices.json').load(), /ENOENT/);
  });
});
