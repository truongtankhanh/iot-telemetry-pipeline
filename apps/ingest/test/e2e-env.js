// Runs before any test module is loaded: ConfigModule reads and validates the environment as soon
// as AppModule is imported, so the e2e environment must exist first.
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/telemetry_test';
process.env.MQTT_URL ??= 'mqtt://localhost:1883';
Object.assign(process.env, {
  MQTT_SHARE_GROUP: 'ingest-e2e',
  OCC_API_URL: 'http://127.0.0.1:3199/api', // the fake command center started by the test
  FLUSH_INTERVAL_MS: '5000', // tests flush explicitly
  DELIVERY_INTERVAL_MS: '60000', // tests tick the outbox explicitly
  CONFIG_DIR: `${__dirname}/../config`,
});
