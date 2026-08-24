/**
 * Connection helper for DB-backed specs.
 *
 * The replica set itself is started once per run by test/global-setup.js.
 * Each spec gets its own DATABASE on that one instance, so suites stay isolated
 * from each other without paying for a mongod start-up — and without racing for
 * ports, which is what made the suite flaky when every spec ran its own.
 */
export function testMongoUri(dbName?: string): string {
  const base = process.env.MONGO_TEST_URI;

  if (!base) {
    throw new Error(
      'MONGO_TEST_URI is not set — test/global-setup.js did not run. ' +
        'Check globalSetup in jest.config.js.',
    );
  }

  const name = dbName ?? `test_${Math.random().toString(36).slice(2, 10)}`;

  // getUri() looks like mongodb://127.0.0.1:PORT/?replicaSet=… — the database
  // name goes before the query string, not after it.
  const [origin, query] = base.split('?');
  const withDb = `${origin.replace(/\/+$/, '')}/${name}`;

  return query ? `${withDb}?${query}` : withDb;
}
