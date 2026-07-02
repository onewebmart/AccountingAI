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
  // Limit parallel workers to 1 for integration tests that share an RS
  maxWorkers: 1,
  // Force exit after tests complete — mongodb-memory-server cleanup is async
  forceExit: true,
};
