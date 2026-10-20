import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BrokerLink, type BrokerState, describeBroker } from './broker-link.ts';

describe('describeBroker', () => {
  it('keeps scheme, host and the explicit port', () => {
    assert.deepEqual(describeBroker('mqtt://localhost:11883'), {
      url: 'mqtt://localhost:11883',
      port: 11883,
    });
    assert.deepEqual(describeBroker('mqtt://mosquitto:1883'), {
      url: 'mqtt://mosquitto:1883',
      port: 1883,
    });
  });

  it('uses the default port of the scheme when the URL has none', () => {
    assert.equal(describeBroker('mqtt://broker.example').port, 1883);
    assert.equal(describeBroker('mqtts://broker.example').port, 8883);
    assert.equal(describeBroker('ws://broker.example').port, 80);
    assert.equal(describeBroker('wss://broker.example').port, 443);
    assert.equal(describeBroker('mqtt://broker.example').url, 'mqtt://broker.example');
  });

  it('drops credentials, path and query', () => {
    const shown = describeBroker('mqtts://device:s3cret@broker.example:8883/mqtt?token=abc#frag');
    assert.deepEqual(shown, { url: 'mqtts://broker.example:8883', port: 8883 });
    assert.ok(!JSON.stringify(shown).includes('s3cret'));
  });

  it('keeps the brackets of an IPv6 host', () => {
    assert.deepEqual(describeBroker('mqtt://[::1]:1883'), { url: 'mqtt://[::1]:1883', port: 1883 });
  });

  it('shows a URL that does not parse as given, without credentials', () => {
    assert.deepEqual(describeBroker('localhost:1883'), { url: 'localhost:1883', port: 1883 });
    const odd = describeBroker('not a url //user:pw@host:99/x');
    assert.ok(!odd.url.includes('pw'));
    assert.equal(odd.port, 99);
    assert.deepEqual(describeBroker('whatever'), { url: 'whatever', port: null });
  });

  it('leaves the port unknown for a scheme it does not know', () => {
    assert.equal(describeBroker('amqp://broker.example').port, null);
  });
});

describe('BrokerLink', () => {
  it('starts disconnected, with the shown URL', () => {
    const link = new BrokerLink('mqtt://u:p@localhost:1883');
    assert.deepEqual(link.state(), { url: 'mqtt://localhost:1883', port: 1883, connected: false });
  });

  it('can start connected', () => {
    assert.equal(new BrokerLink('mqtt://localhost', true).state().connected, true);
  });

  it('announces a change, once, and nothing for a repeat', () => {
    const link = new BrokerLink('mqtt://localhost:1883');
    const seen: BrokerState[] = [];
    link.on('change', (state) => seen.push(state));

    link.setConnected(true);
    link.setConnected(true);
    link.setConnected(false);
    link.setConnected(false);

    assert.deepEqual(
      seen.map((s) => s.connected),
      [true, false],
    );
    assert.equal(seen[0]?.url, 'mqtt://localhost:1883');
  });

  it('hands out a copy of its state', () => {
    const link = new BrokerLink('mqtt://localhost:1883');
    const state = link.state();
    state.connected = true;
    assert.equal(link.state().connected, false);
  });
});
