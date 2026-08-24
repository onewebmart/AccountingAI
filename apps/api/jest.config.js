module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  testTimeout: 60000, // mongodb-memory-server RS startup can take time
  moduleNameMapper: {
    '^@ai-accounting/shared(.*)$': '<rootDir>/../../../packages/shared/src$1',
  },
  // One in-memory replica set for the whole run, shared by every DB-backed
  // spec. Starting one per spec raced for ports on Windows and made the suite
  // fail a different suite most runs.
  globalSetup: '<rootDir>/../test/global-setup.js',
  globalTeardown: '<rootDir>/../test/global-teardown.js',
  // Specs share one mongod, so they must not run concurrently against it.
  maxWorkers: 1,
  // Force exit after tests complete — mongodb-memory-server cleanup is async
  forceExit: true,
};
