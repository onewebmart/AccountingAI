const { MongoMemoryReplSet } = require('mongodb-memory-server');

/**
 * Starts ONE in-memory replica set for the entire test run.
 *
 * Previously each spec called MongoMemoryReplSet.create() in its own beforeAll.
 * With 30+ DB-backed specs that meant 30+ mongod processes started and stopped
 * in sequence, and on Windows the port a stopped instance held is not always
 * released before the next one asks for a free port. The result was suites
 * failing at random — a different one most runs, every one passing in isolation.
 *
 * Specs now share this instance and isolate themselves by database name
 * instead (see src/test-utils/mongo.ts), which is both faster and deterministic.
 */
module.exports = async () => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  process.env.MONGO_TEST_URI = replSet.getUri();

  // Stash the handle for global-teardown; Jest runs the two in the same process.
  globalThis.__MONGO_REPLSET__ = replSet;
};
