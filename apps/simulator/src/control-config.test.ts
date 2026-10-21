import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ControlConfigError,
  DEFAULT_SCENARIOS_DIR,
  DEFAULT_STUDIO_DIR,
  type ControlFlags,
  isLoopbackHost,
  resolveControlConfig,
} from './control-config.ts';

const resolve = (env: Record<string, string | undefined> = {}, flags: ControlFlags = {}) =>
  resolveControlConfig({ env, flags });

describe('resolveControlConfig defaults and sources', () => {
  it('listens on 127.0.0.1:3200 and reads ingest on localhost:3100 when nothing is set', () => {
    assert.deepEqual(resolve(), {
      host: '127.0.0.1',
      port: 3200,
      ingestUrl: 'http://localhost:3100',
      consoleUrl: null,
      studioDir: DEFAULT_STUDIO_DIR,
      scenariosDir: DEFAULT_SCENARIOS_DIR,
      allowNonLoopback: false,
    });
  });

  it('reads the environment', () => {
    const config = resolve({
      CONTROL_HOST: 'localhost',
      CONTROL_PORT: '4300',
      INGEST_URL: 'http://ingest:3100/',
      OCC_CONSOLE_URL: 'https://console.example/',
    });
    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 4300);
    assert.equal(config.ingestUrl, 'http://ingest:3100');
    assert.equal(config.consoleUrl, 'https://console.example');
  });

  it('lets a flag beat the environment', () => {
    const config = resolve(
      { CONTROL_HOST: 'localhost', CONTROL_PORT: '4300', INGEST_URL: 'http://a:1' },
      { controlHost: '127.0.0.2', controlPort: '5000', ingestUrl: 'http://b:2' },
    );
    assert.equal(config.host, '127.0.0.2');
    assert.equal(config.port, 5000);
    assert.equal(config.ingestUrl, 'http://b:2');
  });

  it('treats an empty value, as a blank line in a .env file gives, as not set', () => {
    const config = resolve(
      { CONTROL_HOST: '', CONTROL_PORT: '  ', INGEST_URL: '', OCC_CONSOLE_URL: '' },
      { controlHost: '' },
    );
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3200);
    assert.equal(config.ingestUrl, 'http://localhost:3100');
    assert.equal(config.consoleUrl, null);
  });

  it('keeps a path on the ingest URL and drops only the trailing slash', () => {
    assert.equal(
      resolve({ INGEST_URL: 'http://gateway/ingest/' }).ingestUrl,
      'http://gateway/ingest',
    );
  });
});

describe('isLoopbackHost', () => {
  it('accepts localhost, the 127.0.0.0/8 range and ::1', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) {
      assert.equal(isLoopbackHost(host), true, host);
    }
  });

  it('refuses every-interface, LAN and other names', () => {
    for (const host of [
      '0.0.0.0',
      '::',
      '192.168.1.5',
      '10.0.0.1',
      'example.com',
      '127.0.0.1.evil.test',
      '128.0.0.1',
    ]) {
      assert.equal(isLoopbackHost(host), false, host);
    }
  });
});

describe('resolveControlConfig loopback rule', () => {
  it('accepts a loopback address without the variable', () => {
    for (const host of ['127.0.0.1', '127.9.9.9', '::1', 'localhost']) {
      assert.equal(resolve({ CONTROL_HOST: host }).host, host);
    }
  });

  it('refuses a non-loopback address and names the variable that allows it', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'example.com']) {
      assert.throws(
        () => resolve({ CONTROL_HOST: host }),
        (error: unknown) =>
          error instanceof ControlConfigError &&
          error.message.includes(`"${host}"`) &&
          error.message.includes('CONTROL_ALLOW_NON_LOOPBACK=true'),
        host,
      );
    }
  });

  it('names the flag when the flag supplied the refused address', () => {
    assert.throws(() => resolve({}, { controlHost: '0.0.0.0' }), /--control-host/);
  });

  it('allows a non-loopback address only when the variable is exactly true', () => {
    assert.equal(
      resolve({ CONTROL_HOST: '0.0.0.0', CONTROL_ALLOW_NON_LOOPBACK: 'true' }).host,
      '0.0.0.0',
    );
    for (const value of ['1', 'yes', 'TRUE', 'false', '']) {
      assert.throws(
        () => resolve({ CONTROL_HOST: '0.0.0.0', CONTROL_ALLOW_NON_LOOPBACK: value }),
        ControlConfigError,
        value,
      );
    }
  });

  it('reports whether the variable was set, so the server can say it is exposed', () => {
    assert.equal(resolve({ CONTROL_ALLOW_NON_LOOPBACK: 'true' }).allowNonLoopback, true);
    assert.equal(resolve().allowNonLoopback, false);
  });
});

describe('resolveControlConfig validation', () => {
  it('rejects a port that is not an integer from 1 to 65535 and names its source', () => {
    for (const port of ['0', '65536', 'abc', '3200.5', '-1', '1e3']) {
      assert.throws(
        () => resolve({ CONTROL_PORT: port }),
        (error: unknown) =>
          error instanceof ControlConfigError && error.message.includes('CONTROL_PORT'),
        port,
      );
    }
    assert.throws(() => resolve({}, { controlPort: 'x' }), /--control-port/);
  });

  it('accepts the ends of the port range', () => {
    assert.equal(resolve({ CONTROL_PORT: '1' }).port, 1);
    assert.equal(resolve({ CONTROL_PORT: '65535' }).port, 65535);
  });

  it('rejects an ingest URL that is not http or https and names its source', () => {
    for (const url of ['ftp://ingest', 'ingest:3100', 'not a url']) {
      assert.throws(
        () => resolve({ INGEST_URL: url }),
        (error: unknown) =>
          error instanceof ControlConfigError && error.message.includes('INGEST_URL'),
        url,
      );
    }
    assert.throws(() => resolve({}, { ingestUrl: 'ftp://x' }), /--ingest-url/);
  });

  it('rejects a console URL that is not http or https', () => {
    assert.throws(() => resolve({ OCC_CONSOLE_URL: 'javascript:alert(1)' }), /OCC_CONSOLE_URL/);
  });
});

describe('resolveControlConfig studio directory', () => {
  it('defaults to the build of apps/simulator-ui', () => {
    assert.ok(DEFAULT_STUDIO_DIR.endsWith('/apps/simulator-ui/dist'), DEFAULT_STUDIO_DIR);
    assert.equal(resolve().studioDir, DEFAULT_STUDIO_DIR);
  });

  it('reads STUDIO_DIR and lets --studio-dir beat it', () => {
    assert.equal(resolve({ STUDIO_DIR: '/app/ui' }).studioDir, '/app/ui');
    assert.equal(
      resolve({ STUDIO_DIR: '/app/ui' }, { studioDir: '/srv/studio' }).studioDir,
      '/srv/studio',
    );
  });

  it('makes a relative path absolute, so the server does not depend on where it was started', () => {
    const dir = resolve({ STUDIO_DIR: 'build/ui' }).studioDir;
    assert.ok(dir.startsWith('/'), dir);
    assert.ok(dir.endsWith('/build/ui'), dir);
  });

  it('treats a blank value as not set', () => {
    assert.equal(resolve({ STUDIO_DIR: '  ' }, { studioDir: '' }).studioDir, DEFAULT_STUDIO_DIR);
  });
});

describe('resolveControlConfig scenarios directory', () => {
  it('defaults to apps/simulator/scenarios, which the repository does not create', () => {
    assert.ok(DEFAULT_SCENARIOS_DIR.endsWith('/apps/simulator/scenarios'), DEFAULT_SCENARIOS_DIR);
    assert.equal(resolve().scenariosDir, DEFAULT_SCENARIOS_DIR);
  });

  it('reads SCENARIOS_DIR and lets --scenarios-dir beat it', () => {
    assert.equal(resolve({ SCENARIOS_DIR: '/srv/scenarios' }).scenariosDir, '/srv/scenarios');
    assert.equal(
      resolve({ SCENARIOS_DIR: '/srv/scenarios' }, { scenariosDir: '/tmp/mine' }).scenariosDir,
      '/tmp/mine',
    );
  });

  it('makes a relative path absolute, so the server does not depend on where it was started', () => {
    const dir = resolve({ SCENARIOS_DIR: 'my/scenarios' }).scenariosDir;
    assert.ok(dir.startsWith('/'), dir);
    assert.ok(dir.endsWith('/my/scenarios'), dir);
  });

  it('treats a blank value as not set', () => {
    assert.equal(
      resolve({ SCENARIOS_DIR: '  ' }, { scenariosDir: '' }).scenariosDir,
      DEFAULT_SCENARIOS_DIR,
    );
  });
});
