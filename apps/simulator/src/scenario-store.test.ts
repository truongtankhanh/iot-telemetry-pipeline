import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { ScenarioDocument } from './scenario-document.ts';
import {
  FolderScenarioStore,
  MAX_SCENARIO_FILE_BYTES,
  ScenarioStoreError,
  serializeScenario,
} from './scenario-store.ts';

const root = mkdtempSync(join(tmpdir(), 'scenario-store-'));
after(() => {
  // A case may leave a folder that cannot be listed or removed.
  for (const entry of readdirSync(root)) chmodSync(join(root, entry), 0o700);
  rmSync(root, { recursive: true, force: true });
});

let cases = 0;
/** The path of a folder for one case; it does not exist yet. */
const folderPath = () => join(root, `case-${cases++}`);

const scenario = (name: string, value = 29.2): ScenarioDocument => ({
  name,
  description: `The scenario ${name}.`,
  anomalies: [{ deviceId: 'dc-env-01', metric: 'temperature_c', value, startAt: 20, duration: 60 }],
});

/** What a store call throws, or fails the case. */
function failure(run: () => void): ScenarioStoreError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ScenarioStoreError, String(error));
    return error;
  }
  assert.fail('expected the store to refuse');
}

describe('serializeScenario', () => {
  it('writes two-space JSON with a fixed key order and a final newline', () => {
    const text = serializeScenario({
      description: 'd',
      anomalies: [
        {
          shape: 'ramp',
          duration: 5,
          startAt: 1,
          value: 30,
          metric: 'temperature_c',
          deviceId: 'a',
        },
        { duration: 5, startAt: 1, value: 40, metric: 'humidity_pct', deviceId: 'b' },
      ],
      name: 'order',
    });
    assert.equal(
      text,
      `${JSON.stringify(
        {
          name: 'order',
          description: 'd',
          anomalies: [
            {
              deviceId: 'a',
              metric: 'temperature_c',
              value: 30,
              startAt: 1,
              duration: 5,
              shape: 'ramp',
            },
            { deviceId: 'b', metric: 'humidity_pct', value: 40, startAt: 1, duration: 5 },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it('gives the same bytes for the same scenario, and omits a shape that is not there', () => {
    const doc = scenario('same');
    assert.equal(serializeScenario(doc), serializeScenario(structuredClone(doc)));
    assert.equal(serializeScenario(doc).includes('shape'), false);
  });
});

describe('FolderScenarioStore.save', () => {
  it('creates the folder and writes the scenario as a file that reads back', () => {
    const dir = folderPath();
    new FolderScenarioStore(dir).save('hot.json', scenario('hot'), { replace: false });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'hot.json'), 'utf8')), scenario('hot'));
    assert.equal(readFileSync(join(dir, 'hot.json'), 'utf8'), serializeScenario(scenario('hot')));
  });

  it('replaces a file when told to, and leaves no temporary file behind', () => {
    const dir = folderPath();
    const store = new FolderScenarioStore(dir);
    store.save('hot.json', scenario('hot'), { replace: false });
    store.save('hot.json', scenario('hot', 31.5), { replace: true });
    assert.equal(JSON.parse(readFileSync(join(dir, 'hot.json'), 'utf8')).anomalies[0].value, 31.5);
    assert.deepEqual(readdirSync(dir), ['hot.json']);
  });

  it('refuses a new file whose name is taken on disk, and leaves that file as it was', () => {
    const dir = folderPath();
    mkdirSync(dir);
    writeFileSync(join(dir, 'hot.json'), '{ "this is": "not a scenario"');
    const error = failure(() =>
      new FolderScenarioStore(dir).save('hot.json', scenario('hot'), { replace: false }),
    );
    assert.equal(error.kind, 'file-exists');
    assert.match(
      error.message,
      /hot\.json is already in the scenarios folder and holds another scenario or was not loaded/,
    );
    assert.equal(readFileSync(join(dir, 'hot.json'), 'utf8'), '{ "this is": "not a scenario"');
    assert.deepEqual(readdirSync(dir), ['hot.json']);
  });

  it('refuses a file over the size limit before it touches the disk', () => {
    const dir = folderPath();
    const huge: ScenarioDocument = {
      ...scenario('huge'),
      anomalies: Array.from({ length: 50 }, (_, i) => ({
        deviceId: `device-${'x'.repeat(400)}-${i}`,
        metric: 'temperature_c' as const,
        value: 30,
        startAt: i * 70,
        duration: 60,
      })),
    };
    assert.ok(Buffer.byteLength(serializeScenario(huge)) > MAX_SCENARIO_FILE_BYTES);
    const error = failure(() =>
      new FolderScenarioStore(dir).save('huge.json', huge, { replace: false }),
    );
    assert.equal(error.kind, 'too-large');
    assert.match(error.message, /more than the 16384 a scenario file may have/);
    assert.equal(existsSync(dir), false, 'not even the folder was made');
  });

  it('says why when the folder cannot be made, and writes nothing', () => {
    const dir = folderPath();
    writeFileSync(dir, 'a file where the folder should be');
    const error = failure(() =>
      new FolderScenarioStore(dir).save('hot.json', scenario('hot'), { replace: false }),
    );
    assert.equal(error.kind, 'unwritable');
    assert.match(error.message, /cannot write hot\.json in the scenarios folder \([A-Z]+\)/);
  });

  it(
    'says why when the folder is read-only',
    { skip: process.getuid?.() === 0 ? 'root can write anywhere' : false },
    () => {
      const dir = folderPath();
      mkdirSync(dir);
      chmodSync(dir, 0o500);
      const error = failure(() =>
        new FolderScenarioStore(dir).save('hot.json', scenario('hot'), { replace: false }),
      );
      assert.equal(error.kind, 'unwritable');
      assert.match(error.message, /\((EACCES|EPERM|EROFS)\)/);
      chmodSync(dir, 0o700);
      assert.deepEqual(readdirSync(dir), []);
    },
  );

  it('removes its temporary file when the rename fails', () => {
    const dir = folderPath();
    mkdirSync(join(dir, 'hot.json'), { recursive: true }); // a folder where the file should go
    const error = failure(() =>
      new FolderScenarioStore(dir).save('hot.json', scenario('hot'), { replace: true }),
    );
    assert.equal(error.kind, 'unwritable');
    assert.deepEqual(readdirSync(dir), ['hot.json']);
  });

  it('never writes outside the folder or to a name that is not a .json file', () => {
    const dir = folderPath();
    mkdirSync(dir);
    const store = new FolderScenarioStore(dir);
    for (const file of ['../escape.json', 'sub/x.json', '..\\x.json', 'x.txt', '.json', '..', '']) {
      assert.equal(
        failure(() => store.save(file, scenario('x'), { replace: true })).kind,
        'unwritable',
        file,
      );
      assert.equal(failure(() => store.remove(file)).kind, 'unwritable', file);
    }
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(existsSync(join(root, 'escape.json')), false);
  });
});

describe('FolderScenarioStore.remove', () => {
  it('removes the file', () => {
    const dir = folderPath();
    const store = new FolderScenarioStore(dir);
    store.save('hot.json', scenario('hot'), { replace: false });
    store.remove('hot.json');
    assert.deepEqual(readdirSync(dir), []);
  });

  it('is not an error when the file or the folder is already gone', () => {
    const dir = folderPath();
    const store = new FolderScenarioStore(dir);
    assert.doesNotThrow(() => store.remove('gone.json'));
    mkdirSync(dir);
    assert.doesNotThrow(() => store.remove('gone.json'));
  });

  it('says why when the file cannot be removed', () => {
    const dir = folderPath();
    mkdirSync(join(dir, 'hot.json'), { recursive: true }); // unlink on a folder fails
    const error = failure(() => new FolderScenarioStore(dir).remove('hot.json'));
    assert.equal(error.kind, 'unwritable');
    assert.match(error.message, /cannot remove hot\.json from the scenarios folder \([A-Z]+\)/);
  });
});
