import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/database/migrations/**',
  ],
  coverageDirectory: './coverage',
  // The floor is the level measured on 2026-10-19 at 3b37d7f (91.59 % statements, 84.22 % branches,
  // 81.05 % functions, 92.89 % lines), rounded down. It only guards against a regression: when
  // coverage rises, raise these numbers in the same change; never lower them to make a run pass.
  coverageThreshold: { global: { statements: 91, branches: 84, functions: 81, lines: 92 } },
  testEnvironment: 'node',
};

export default config;
