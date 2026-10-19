import { applyDecorators } from '@nestjs/common';
import { parseTimestamp } from '@itp/telemetry-contract';
import { Transform } from 'class-transformer';
import { IsDate, type ValidationArguments } from 'class-validator';

/**
 * A query parameter that holds an instant, read as strictly as the `ts` of a telemetry message: ISO 8601
 * with a zone (`Z` or `±HH:mm`), calendar-valid. `new Date(value)` would also take text with no zone
 * (read in the server's time zone), a bare number, or a day that rolls over into the next month, so the
 * same string would mean one instant to the contract and another to this API.
 *
 * A string the contract accepts becomes a `Date`. Anything else (unparseable text, an array from a
 * repeated parameter) is left as it is, and `IsDate` refuses it with a message that names the
 * parameter and shows a valid example.
 */
export function QueryTimestamp() {
  return applyDecorators(
    Transform(
      ({ value }: { value: unknown }) => {
        if (typeof value !== 'string') return value;
        const ms = parseTimestamp(value);
        return Number.isNaN(ms) ? value : new Date(ms);
      },
      { toClassOnly: true },
    ),
    IsDate({
      message: ({ property }: ValidationArguments) =>
        `"${property}" must be an ISO 8601 timestamp with a zone, e.g. 2026-10-17T10:00:00Z`,
    }),
  );
}
