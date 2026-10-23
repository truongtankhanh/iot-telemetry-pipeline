import { describe, expect, it } from 'vitest';
import { mosquittoPubCommand, quoteShell } from './shellCommand';

/** Reads one shell word the way a POSIX shell reads single quotes: `'…'` is literal, `\'` outside quotes is a quote. */
function unquote(word: string): string {
  let out = '';
  let i = 0;
  while (i < word.length) {
    const char = word[i] as string;
    if (char === "'") {
      const end = word.indexOf("'", i + 1);
      if (end === -1) throw new Error(`unterminated quote in ${word}`);
      out += word.slice(i + 1, end);
      i = end + 1;
    } else if (char === '\\' && word[i + 1] === "'") {
      out += "'";
      i += 2;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

describe('quoteShell', () => {
  it('leaves a plain word alone, and quotes it when asked', () => {
    expect(quoteShell('campus/BLD-DC/dc-env-01/telemetry')).toBe(
      'campus/BLD-DC/dc-env-01/telemetry',
    );
    expect(quoteShell('abc', true)).toBe("'abc'");
  });

  it('quotes what a shell would read as more than a word', () => {
    for (const word of ['a b', 'a;b', 'a$b', 'a`b`', 'a|b', 'a&b', 'a*', '', '#x', 'a\nb']) {
      const quoted = quoteShell(word);
      expect(quoted.startsWith("'"), JSON.stringify(word)).toBe(true);
      expect(unquote(quoted), JSON.stringify(word)).toBe(word);
    }
  });

  it('gives a shell back the same bytes, whatever the text has in it', () => {
    for (const text of [
      `it's`,
      `'`,
      `''`,
      `a'b'c`,
      '$(rm -rf ~)',
      '`id`',
      'back\\slash',
      'new\nline',
      '{"seq":1,"ts":"2026-10-01T05:00:00.000Z","metrics":{"temperature_c":22.5}}',
      '😀 é',
    ]) {
      expect(unquote(quoteShell(text, true)), JSON.stringify(text)).toBe(text);
    }
  });
});

describe('mosquittoPubCommand', () => {
  const payload = '{"seq":1284,"ts":"2026-10-19T02:14:31.012Z","metrics":{"temperature_c":29.3}}';

  it('is the command of frame 06', () => {
    expect(
      mosquittoPubCommand({ topic: 'campus/BLD-DC/dc-env-01/telemetry', payload, port: 1883 }),
    ).toBe(
      [
        'mosquitto_pub -h localhost -p 1883 -q 1 \\',
        '  -t campus/BLD-DC/dc-env-01/telemetry \\',
        `  -m '${payload}'`,
      ].join('\n'),
    );
  });

  it('uses the port of the state, and 1883 when there is none or it is not a port', () => {
    const at = (port: number | null) => mosquittoPubCommand({ topic: 't', payload: '{}', port });
    expect(at(8883)).toContain('-p 8883 ');
    for (const port of [null, 0, -1, 65536, 1.5, Number.NaN]) {
      expect(at(port), String(port)).toContain('-p 1883 ');
    }
  });

  it('always names localhost, never the broker host of the state', () => {
    expect(mosquittoPubCommand({ topic: 't', payload: '{}', port: 1883 })).toContain(
      '-h localhost',
    );
  });

  it('quotes a topic and a payload that need it', () => {
    const command = mosquittoPubCommand({
      topic: 'campus/BLD DC/x;y',
      payload: `{"note":"it's"}\n`,
      port: 1883,
    });
    const lines = command.split('\n');
    expect(lines[1]).toBe(`  -t 'campus/BLD DC/x;y' \\`);
    expect(unquote(lines[1]?.slice(5, -2) as string)).toBe('campus/BLD DC/x;y');
    // The payload has a newline of its own, so the quoted word spans the rest of the text.
    const payloadWord = command.slice(command.indexOf('-m ') + 3);
    expect(unquote(payloadWord)).toBe(`{"note":"it's"}\n`);
  });
});
