import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './cursor';

const MESSAGE = '"before" is not a cursor returned by this API';
const TIME = '2026-10-17T10:00:00.123Z';

/** What a client could send: the text, or the JSON of a value, in base64url. */
const encoded = (value: unknown) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

describe('alert cursor', () => {
  it('returns the time and the id it was made from', () => {
    const row = { openedAt: new Date(TIME), id: '42' };

    expect(decodeCursor(encodeCursor(row))).toEqual(row);
  });

  it('is made of base64url characters only, so it is safe in a query string', () => {
    const cursor = encodeCursor({ openedAt: new Date(TIME), id: '9007199254740993' });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['an empty string', ''],
    ['text outside the base64url alphabet', '!!!'],
    ['text that is not JSON', encoded('not json')],
    ['a JSON array', encoded([TIME, '7'])],
    ['a JSON string', encoded('"x"')],
    ['a missing id', encoded({ t: TIME })],
    ['a missing t', encoded({ id: '7' })],
    ['an extra field', encoded({ t: TIME, id: '7', x: 1 })],
    ['a numeric id', encoded({ t: TIME, id: 7 })],
    ['a non-numeric id', encoded({ t: TIME, id: 'abc' })],
    ['a negative id', encoded({ t: TIME, id: '-1' })],
    [
      'an id of 19 digits, which could overflow a bigint',
      encoded({ t: TIME, id: '1234567890123456789' }),
    ],
    ['a t that is not a string', encoded({ t: 1760695200123, id: '7' })],
    ['a loose t', encoded({ t: '1', id: '7' })],
    ['a t that is a date only', encoded({ t: '2026-10-17', id: '7' })],
    ['an impossible t', encoded({ t: '2026-02-31T00:00:00.000Z', id: '7' })],
    [
      'a valid t that is not in the canonical form',
      encoded({ t: '2026-10-17T10:00:00Z', id: '7' }),
    ],
  ])('refuses %s with a 400, not a 500', (_name, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
    expect(() => decodeCursor(cursor)).toThrow(MESSAGE);
  });
});
