import 'reflect-metadata';

import { validateEnv } from '../config/env.validation';
import { mqttConnectOptions, tlsSettingsProblems } from './mqtt-options';

const PEM = (label: string) => `-----BEGIN ${label}-----\nAAAA\n-----END ${label}-----\n`;

describe('mqttConnectOptions', () => {
  it('gives every connection its own client id under the configured prefix', () => {
    const settings = { MQTT_CLIENT_ID_PREFIX: 'ingest' };
    expect(mqttConnectOptions(settings, 0, 'host-7').clientId).toBe('ingest-host-7-0');
    expect(mqttConnectOptions(settings, 3, 'host-7').clientId).toBe('ingest-host-7-3');
  });

  it('uses MQTT 5 clean sessions, as the shared-subscription design assumes', () => {
    const options = mqttConnectOptions({ MQTT_CLIENT_ID_PREFIX: 'ingest' }, 0, 'h');
    expect(options).toMatchObject({ protocolVersion: 5, clean: true });
    expect(options).not.toHaveProperty('cert');
  });

  it('passes client certificates through, accepting escaped newlines', () => {
    const escaped = PEM('CERTIFICATE').replace(/\n/g, '\\n');
    const options = mqttConnectOptions(
      {
        MQTT_CLIENT_ID_PREFIX: 'ingest',
        MQTT_CA_PEM: PEM('CERTIFICATE'),
        MQTT_CERT_PEM: escaped,
        MQTT_KEY_PEM: PEM('RSA PRIVATE KEY'),
      },
      0,
      'h',
    );
    expect(options.cert).toBe(PEM('CERTIFICATE'));
    expect(options.key).toBe(PEM('RSA PRIVATE KEY'));
    expect(options.ca).toBe(PEM('CERTIFICATE'));
  });
});

describe('TLS settings validation', () => {
  it('requires certificate and key together, and both to be PEM', () => {
    expect(
      tlsSettingsProblems({ MQTT_CLIENT_ID_PREFIX: 'x', MQTT_CERT_PEM: PEM('CERTIFICATE') }),
    ).toEqual(['MQTT_CERT_PEM and MQTT_KEY_PEM must be set together']);
    expect(
      tlsSettingsProblems({
        MQTT_CLIENT_ID_PREFIX: 'x',
        MQTT_CERT_PEM: 'not a cert',
        MQTT_KEY_PEM: PEM('PRIVATE KEY'),
      }),
    ).toEqual(['MQTT_CERT_PEM is not PEM']);
  });

  it('stops startup on a half-configured certificate', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'postgres://x', MQTT_KEY_PEM: PEM('PRIVATE KEY') }),
    ).toThrow(/MQTT_CERT_PEM and MQTT_KEY_PEM must be set together/);
  });

  it('defaults to one plain connection', () => {
    const env = validateEnv({ DATABASE_URL: 'postgres://x' });
    expect(env.MQTT_CONNECTIONS).toBe(1);
    expect(env.MQTT_CLIENT_ID_PREFIX).toBe('ingest');
    expect(env.MQTT_CERT_PEM).toBeUndefined();
  });
});
