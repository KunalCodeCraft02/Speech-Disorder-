/** @type {import('jest').Config} */
module.exports = {
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/tests/helpers/globalTeardown.js',

  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: '.',
      setupFiles: ['<rootDir>/tests/setup/env.js'],
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      testTimeout: 10000,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      rootDir: '.',
      setupFiles: ['<rootDir>/tests/setup/env.js'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup/db.js'],
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      testTimeout: 20000,
    },
    {
      displayName: 'sockets',
      testEnvironment: 'node',
      rootDir: '.',
      setupFiles: ['<rootDir>/tests/setup/env.js'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup/db.js'],
      testMatch: ['<rootDir>/tests/sockets/**/*.test.js'],
      testTimeout: 20000,
    },
  ],

  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
};
