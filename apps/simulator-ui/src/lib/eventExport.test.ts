import { describe, expect, it, vi } from 'vitest';
import observationsFixture from '../api/fixtures/observations.json';
import type { ObservationEvent } from '../api/types';
import {
  browserDownload,
  CSV_HEADER,
  csvCell,
  type DownloadHost,
  downloadText,
  eventsToCsv,
  exportFileName,
} from './eventExport';
import { eventRows } from './eventRows';

const rows = eventRows(observationsFixture as unknown as ObservationEvent[]);

describe('a CSV field', () => {
  it('is left as it is when it needs no quoting', () => {
    expect(csvCell('server-room-overheat')).toBe('server-room-overheat');
    expect(csvCell('')).toBe('');
    expect(csvCell('#7 opened · high')).toBe('#7 opened · high');
  });

  it('is quoted when it holds a comma, a quote or a line break, and quotes are doubled', () => {
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"');
  });

  it('gets an apostrophe in front when a spreadsheet would take it for a formula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('=1,2')).toBe('"\'=1,2"');
    expect(csvCell('a-b')).toBe('a-b');
  });
});

describe('the rows as CSV', () => {
  const lines = eventsToCsv(rows).split('\r\n');

  it('starts with the header, ends with a line break, and has a line for each row', () => {
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines.at(-1)).toBe('');
    expect(lines).toHaveLength(rows.length + 2);
  });

  it('writes the time in ISO 8601 UTC, the source, the kind and the message', () => {
    const alert = lines.find((line) => line.includes('alert-opened')) as string;
    expect(alert).toBe(
      '3,2026-10-20T08:00:27.100Z,Alert,alert-opened,#7 opened · high,dc-env-01,server-room-hot,7,',
    );
  });

  it('joins what an event names with a semicolon', () => {
    const csv = eventsToCsv([{ ...rows[0]!, devices: ['a', 'b'], scenarios: ['x', 'y'] }]);
    expect(csv.split('\r\n')[1]).toMatch(/,a; b,,,x; y$/);
  });

  it('leaves the time empty for a row whose time was not one', () => {
    const csv = eventsToCsv([{ ...rows[0]!, at: 0 }]);
    expect(csv.split('\r\n')[1]?.split(',')[1]).toBe('');
  });

  it('is only the header for no rows', () => {
    expect(eventsToCsv([])).toBe(`${CSV_HEADER.join(',')}\r\n`);
  });
});

describe('the file name', () => {
  it('says the range', () => {
    expect(exportFileName('1h')).toBe('studio-events-1h.csv');
    expect(exportFileName('custom')).toBe('studio-events-custom.csv');
  });
});

describe('handing the text to the person', () => {
  it('makes an object URL, clicks a link with the name, and gives the URL back', () => {
    const click = vi.fn();
    const link = { href: '', download: '', click };
    const created: Blob[] = [];
    const host: DownloadHost = {
      createObjectURL: (blob) => {
        created.push(blob);
        return 'blob:studio/1';
      },
      revokeObjectURL: vi.fn(),
      createLink: () => link,
    };
    downloadText('events.csv', 'a,b\r\n', undefined, host);

    expect(link.href).toBe('blob:studio/1');
    expect(link.download).toBe('events.csv');
    expect(click).toHaveBeenCalledTimes(1);
    expect(host.revokeObjectURL).toHaveBeenCalledWith('blob:studio/1');
    expect(created[0]?.type).toBe('text/csv;charset=utf-8');
    expect(created[0]?.size).toBe(5);
  });

  it('gives the URL back even if the click throws', () => {
    const revoke = vi.fn();
    const host: DownloadHost = {
      createObjectURL: () => 'blob:studio/2',
      revokeObjectURL: revoke,
      createLink: () => ({
        href: '',
        download: '',
        click: () => {
          throw new Error('blocked');
        },
      }),
    };
    expect(() => downloadText('x.csv', '', undefined, host)).toThrow('blocked');
    expect(revoke).toHaveBeenCalledWith('blob:studio/2');
  });

  it('uses the browser’s own by default', () => {
    expect(typeof browserDownload.createObjectURL).toBe('function');
    expect(browserDownload.createLink().click).toBeTypeOf('function');
  });
});
