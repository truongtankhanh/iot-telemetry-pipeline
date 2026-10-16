// Runs before any test module is loaded: ConfigModule reads and validates the environment as soon
// as AppModule is imported, so the e2e environment must exist first.

// The suite drops the `public` schema of its database (V1-T03), so it has a variable of its own and
// never falls back to DATABASE_URL, which in a developer's shell is a database worth keeping. The
// name must also say it is disposable. Both are checked here, before anything connects.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/telemetry_test';

function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

if (!/_test$/.test(databaseName(TEST_DATABASE_URL))) {
  throw new Error(
    `Refusing to run the e2e suite: it wipes the database it connects to, and the name of ` +
      `"${databaseName(TEST_DATABASE_URL) || 'the database in TEST_DATABASE_URL'}" does not end in ` +
      `"_test". Set TEST_DATABASE_URL to a disposable database, e.g. ` +
      `postgres://postgres:postgres@localhost:5432/telemetry_test. DATABASE_URL is never used.`,
  );
}

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.MQTT_URL ??= 'mqtt://localhost:1883';
Object.assign(process.env, {
  MQTT_SHARE_GROUP: 'ingest-e2e',
  MQTT_CONNECTIONS: '2', // exercises several connections in one shared group
  OCC_API_URL: 'http://127.0.0.1:3199/api', // the fake command center started by the test
  OCC_TOKEN_URL: 'http://127.0.0.1:3199/token', // …and its identity provider
  OCC_CLIENT_ID: 'telemetry-pipeline',
  OCC_CLIENT_SECRET: 'e2e-secret',
  FLUSH_INTERVAL_MS: '5000', // tests flush explicitly
  SEQUENCE_GRACE_MS: '0', // a gap counts at once; the grace period is unit-tested
  DELIVERY_INTERVAL_MS: '60000', // tests tick the outbox explicitly
  CONFIG_DIR: `${__dirname}/../config`,
});
