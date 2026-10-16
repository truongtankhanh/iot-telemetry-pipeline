// Runs before any test module is loaded: ConfigModule reads and validates the environment as soon
// as AppModule is imported, so the e2e environment must exist first.
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/telemetry_test';
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
