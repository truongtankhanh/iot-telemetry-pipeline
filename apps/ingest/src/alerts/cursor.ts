import { BadRequestException } from '@nestjs/common';

/** Where a page of alerts ended: the last alert returned. */
export interface CursorRow {
  openedAt: Date;
  /** `alert.id` is a `bigserial`, which `pg` returns as a string. */
  id: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** At most 18 digits: a 19-digit value can exceed a `bigint`, and PostgreSQL would answer a 500. */
const ID = /^\d{1,18}$/;

const notACursor = () => new BadRequestException('"before" is not a cursor returned by this API');

/**
 * The position after an alert, to page `GET /alerts` newest first by `(opened_at, id)`. The id is
 * part of it because alerts opened by the same reading share `opened_at`; the time alone would skip
 * one of them at a page boundary.
 *
 * Opaque to clients, whose only job is to hand it back. The time is a JS `Date`, so it is exact to the
 * millisecond: that is all `opened_at` ever holds, because it is the `ts` of a `Reading`
 * (`rules.service.ts`). A writer that stored finer values would make a page repeat or skip rows.
 */
export function encodeCursor({ openedAt, id }: CursorRow): string {
  return Buffer.from(JSON.stringify({ t: openedAt.toISOString(), id })).toString('base64url');
}

/** Throws the 400 for anything `encodeCursor` could not have produced, so it never reaches SQL. */
export function decodeCursor(cursor: string): CursorRow {
  // `Buffer.from(…, 'base64url')` skips characters it does not know instead of failing.
  if (!BASE64URL.test(cursor)) throw notACursor();

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw notACursor();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw notACursor();

  const { t, id, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof t !== 'string' || typeof id !== 'string') {
    throw notACursor();
  }
  // The canonical form only: a loose or rolled-over date would parse to some other instant.
  const openedAt = new Date(t);
  if (Number.isNaN(openedAt.getTime()) || openedAt.toISOString() !== t || !ID.test(id)) {
    throw notACursor();
  }
  return { openedAt, id };
}
