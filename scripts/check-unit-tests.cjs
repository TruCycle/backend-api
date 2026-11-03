'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- Node and Jest load this CommonJS boundary before TypeScript transforms. */

// This file is the launcher, Jest resolver, and per-test safety setup.
const path = require('node:path');

const rootDirectory = path.resolve(__dirname, '..');
const reviewedTests = [
  'src/modules/shops/shops-validation.spec.ts',
  'src/modules/auth/auth-sessions.spec.ts',
  'src/common/security/socket-access.spec.ts',
  'src/common/utils/postcode.spec.ts',
  'src/common/utils/safe-log.spec.ts',
  'src/common/utils/operational-log-privacy.spec.ts',
  'src/common/filters/http-exception.filter.spec.ts',
  'src/modules/notifications/nearby-email-privacy.spec.ts',
  'src/common/utils/public-location.spec.ts',
  'src/database/migration-release.spec.ts',
  'src/modules/auth/auth.service.spec.ts',
  'src/modules/auth/activation-recovery.spec.ts',
  'src/modules/found-items/found-items-identity-privacy.spec.ts',
  'src/modules/found-items/found-items-lifecycle.spec.ts',
  'src/modules/found-items/found-items-location-privacy.spec.ts',
  'src/modules/gamification/gamification-identity-privacy.spec.ts',
  'src/modules/items/items-claims-privacy.spec.ts',
  'src/modules/items/items-donor-privacy.spec.ts',
  'src/modules/items/dto/search-items.dto.spec.ts',
  'src/modules/notifications/nearby-item-privacy.spec.ts',
  'src/modules/items/item-geocoding.service.spec.ts',
  'src/modules/items/co2-estimation.service.spec.ts',
  'src/modules/rewards/rewards.service.spec.ts',
  'src/modules/messages/messages-identity-privacy.spec.ts',
  'test/jwt-auth.guard.spec.ts',
];

function deniedOperation(operation) {
  return function denyIntegration() {
    throw new Error(`Unit-test safety guard blocked ${operation}. Use a mock.`);
  };
}

function installSafetyGuards() {
  if (process.env.TRUCYCLE_ISOLATED_UNIT_RUN !== '1') {
    throw new Error('Run unit tests through node scripts/check-unit-tests.cjs.');
  }

  process.env.ENABLE_DB = 'false';
  process.env.TYPEORM_SYNC = 'false';
  globalThis.fetch = deniedOperation('fetch');

  // TypeORM imports dotenv without configuring it. Replace the module so that
  // importing entities is safe, while any attempt to load an env file fails.
  const { jest: jestMock } = require('@jest/globals');
  jestMock.doMock('dotenv', () => ({
    config: deniedOperation('dotenv configuration'),
    configDotenv: deniedOperation('dotenv configuration'),
    populate: deniedOperation('dotenv environment population'),
    parse: deniedOperation('dotenv parsing'),
  }));

  const http = require('node:http');
  const https = require('node:https');
  const net = require('node:net');
  const tls = require('node:tls');
  const dgram = require('node:dgram');
  const childProcess = require('node:child_process');

  for (const transport of [http, https]) {
    transport.request = deniedOperation('HTTP request');
    transport.get = deniedOperation('HTTP GET');
  }
  net.Socket.prototype.connect = deniedOperation('socket connection');
  net.Server.prototype.listen = deniedOperation('server listener');
  tls.connect = deniedOperation('TLS connection');
  dgram.createSocket = deniedOperation('UDP socket');
  for (const method of [
    'exec',
    'execFile',
    'execSync',
    'execFileSync',
    'spawn',
    'spawnSync',
    'fork',
  ]) {
    childProcess[method] = deniedOperation(`child process ${method}`);
  }
}

function resolveUnitModule(request, options) {
  const resolved = options.defaultResolver(request, options);
  const normalized = resolved.replace(/\\/g, '/');
  if (
    /\/(?:src|dist)\/(?:app\.module|main)\.[cm]?[jt]s$/.test(normalized) ||
    /\/(?:src|dist)\/(?:scripts\/run-migrations|database\/migrations\/)/.test(normalized) ||
    /\/node_modules\/dotenv\/config\.[cm]?js$/.test(normalized)
  ) {
    throw new Error(`Unit-test safety guard blocked runtime configuration import: ${request}`);
  }
  return resolved;
}

// Jest calls a setupFiles function without arguments, and a resolver with two.
module.exports = function unitTestBoundary(request, options) {
  if (typeof request === 'string') {
    return resolveUnitModule(request, options);
  }
  return installSafetyGuards();
};

if (require.main === module) {
  const fs = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const unexpectedArguments = process.argv.slice(2).filter((arg) => !['--listTests'].includes(arg));
  if (unexpectedArguments.length) {
    console.error('Only --listTests is supported; test selection is intentionally fixed.');
    process.exit(1);
  }

  const missingTests = reviewedTests.filter(
    (test) => !fs.existsSync(path.join(rootDirectory, test)),
  );
  if (missingTests.length) {
    throw new Error(`Reviewed unit tests are missing: ${missingTests.join(', ')}`);
  }

  // Do not forward database/provider credentials, NODE_OPTIONS, npm preloads, or dotenv settings.
  const safeEnvironment = {};
  const allowedEnvironmentKeys = [
    'PATH',
    'Path',
    'PATHEXT',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'SYSTEMDRIVE',
    'CI',
    'GITHUB_ACTIONS',
  ];
  for (const key of allowedEnvironmentKeys) {
    if (process.env[key] !== undefined) safeEnvironment[key] = process.env[key];
  }
  Object.assign(safeEnvironment, {
    NODE_ENV: 'test',
    ENABLE_DB: 'false',
    TYPEORM_SYNC: 'false',
    TRUCYCLE_ISOLATED_UNIT_RUN: '1',
    JWT_SECRET: 'isolated-unit-test-only',
  });

  const jestExecutable = require.resolve('jest/bin/jest');
  const result = spawnSync(
    process.execPath,
    [
      jestExecutable,
      '--config',
      path.join(rootDirectory, 'jest.unit.config.ts'),
      '--runInBand',
      '--no-cache',
      '--runTestsByPath',
      ...reviewedTests,
      ...process.argv.slice(2),
    ],
    { cwd: rootDirectory, env: safeEnvironment, stdio: 'inherit' },
  );
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
