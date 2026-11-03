import type { Config } from 'jest';

// Separate from jest.config.ts: no dotenv setup, AppModule, or E2E discovery.
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/jwt-auth.guard.spec.ts'],
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  resolver: '<rootDir>/scripts/check-unit-tests.cjs',
  setupFiles: ['<rootDir>/scripts/check-unit-tests.cjs'],
  clearMocks: true,
};

export default config;
