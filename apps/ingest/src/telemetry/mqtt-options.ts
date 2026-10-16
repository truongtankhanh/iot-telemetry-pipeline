import type { IClientOptions } from 'mqtt';

/** The part of the environment that shapes broker connections. */
export interface MqttSettings {
  MQTT_CLIENT_ID_PREFIX: string;
  MQTT_USERNAME?: string;
  MQTT_PASSWORD?: string;
  MQTT_CA_PEM?: string;
  MQTT_CERT_PEM?: string;
  MQTT_KEY_PEM?: string;
}

/**
 * Connection options for connection number `index` of this process.
 *
 * - Client ids are unique per process and per connection, and start with a fixed prefix so a
 *   broker policy can allow exactly `<prefix>-*` (AWS IoT Core policies match client ids).
 * - Client certificates (mutual TLS) are taken from PEM strings, which is how a secret store
 *   injects them into a container; AWS IoT Core accepts nothing else for MQTT on port 8883.
 */
export function mqttConnectOptions(
  settings: MqttSettings,
  index: number,
  instance: string,
): IClientOptions {
  const options: IClientOptions = {
    protocolVersion: 5,
    clientId: `${settings.MQTT_CLIENT_ID_PREFIX}-${instance}-${index}`,
    clean: true,
    reconnectPeriod: 2000,
  };
  if (settings.MQTT_USERNAME) options.username = settings.MQTT_USERNAME;
  if (settings.MQTT_PASSWORD) options.password = settings.MQTT_PASSWORD;
  if (settings.MQTT_CA_PEM) options.ca = pem(settings.MQTT_CA_PEM);
  if (settings.MQTT_CERT_PEM) options.cert = pem(settings.MQTT_CERT_PEM);
  if (settings.MQTT_KEY_PEM) options.key = pem(settings.MQTT_KEY_PEM);
  return options;
}

/** Problems with the TLS settings, checked at startup alongside the rest of the environment. */
export function tlsSettingsProblems(settings: MqttSettings): string[] {
  const problems: string[] = [];
  if (Boolean(settings.MQTT_CERT_PEM) !== Boolean(settings.MQTT_KEY_PEM)) {
    problems.push('MQTT_CERT_PEM and MQTT_KEY_PEM must be set together');
  }
  for (const name of ['MQTT_CA_PEM', 'MQTT_CERT_PEM', 'MQTT_KEY_PEM'] as const) {
    const value = settings[name];
    if (value && !pem(value).includes('-----BEGIN ')) problems.push(`${name} is not PEM`);
  }
  return problems;
}

/** Accepts real newlines or `\n` escapes — the latter is what one-line env files produce. */
const pem = (value: string): string => value.replace(/\\n/g, '\n');
