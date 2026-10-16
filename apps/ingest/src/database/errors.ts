/**
 * A data error is PostgreSQL's verdict on the rows themselves — SQLSTATE class 22 (data exception:
 * out of range, bad text representation) or 23 (integrity constraint, including a row with no
 * partition). Retrying the same rows fails the same way. Every other failure — connection refused or
 * reset, shutdown in progress, deadlock, timeout — says nothing about the rows and is retried.
 */
export function isDataError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^2[23][0-9A-Z]{3}$/.test(code);
}
