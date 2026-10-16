import { isDataError } from './errors';

describe('isDataError', () => {
  it('recognises data exceptions and integrity violations', () => {
    expect(isDataError({ code: '22003' })).toBe(true); // numeric value out of range
    expect(isDataError({ code: '23514' })).toBe(true); // check violation, e.g. no partition for the row
    expect(isDataError({ code: '23503' })).toBe(true); // foreign key violation
  });

  it('treats connection, shutdown and concurrency failures as retryable', () => {
    expect(isDataError({ code: 'ECONNREFUSED' })).toBe(false);
    expect(isDataError({ code: '57P01' })).toBe(false); // admin shutdown
    expect(isDataError({ code: '08006' })).toBe(false); // connection failure
    expect(isDataError({ code: '40P01' })).toBe(false); // deadlock
    expect(isDataError(new Error('timeout exceeded when trying to connect'))).toBe(false);
    expect(isDataError(null)).toBe(false);
  });
});
