import 'reflect-metadata'; // the class-transformer decorators of Env need it before the module loads
import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/telemetry' };

describe('validateEnv: DB_POOL_MAX', () => {
  it('is 10 when not set, which is what the pool was before the setting existed', () => {
    expect(validateEnv(base).DB_POOL_MAX).toBe(10);
  });

  it('reads the value as a number', () => {
    expect(validateEnv({ ...base, DB_POOL_MAX: '25' }).DB_POOL_MAX).toBe(25);
  });

  it.each(['2', '100'])('accepts %s, the ends of the range', (value) => {
    expect(validateEnv({ ...base, DB_POOL_MAX: value }).DB_POOL_MAX).toBe(Number(value));
  });

  it.each(['1', '0', '101', '2.5', 'many'])('refuses %s and names the variable', (value) => {
    expect(() => validateEnv({ ...base, DB_POOL_MAX: value })).toThrow(/DB_POOL_MAX/);
  });
});

describe('validateEnv: DB_STATEMENT_TIMEOUT_MS', () => {
  it('is 0 when not set, which sets no timeout', () => {
    expect(validateEnv(base).DB_STATEMENT_TIMEOUT_MS).toBe(0);
  });

  it.each(['0', '1000', '3600000'])('accepts %s', (value) => {
    expect(validateEnv({ ...base, DB_STATEMENT_TIMEOUT_MS: value }).DB_STATEMENT_TIMEOUT_MS).toBe(
      Number(value),
    );
  });

  it.each(['-1', '3600001', '1.5', 'soon'])('refuses %s and names the variable', (value) => {
    expect(() => validateEnv({ ...base, DB_STATEMENT_TIMEOUT_MS: value })).toThrow(
      /DB_STATEMENT_TIMEOUT_MS/,
    );
  });
});
