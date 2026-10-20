import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOPOLOGY_QUERY,
  parseTopologyQuery,
  serializeTopologyQuery,
  type TopologyQuery,
} from './topologyQuery';

const query = (patch: Partial<TopologyQuery>): TopologyQuery => ({
  ...DEFAULT_TOPOLOGY_QUERY,
  ...patch,
});
const parse = (search: string) => parseTopologyQuery(new URLSearchParams(search));

describe('parseTopologyQuery and serializeTopologyQuery', () => {
  it('reads an empty address as the default, and writes the default as an empty address', () => {
    expect(parse('')).toEqual(DEFAULT_TOPOLOGY_QUERY);
    expect(serializeTopologyQuery(DEFAULT_TOPOLOGY_QUERY).toString()).toBe('');
  });

  it.each([
    query({ q: 'air hall', group: 'zone', problems: true }),
    query({ group: 'all' }),
    query({ selection: { type: 'device', id: 'dc-env-01' } }),
    query({ selection: { type: 'zone', id: 'BLD-DC' }, problems: true }),
    query({ selection: { type: 'stage', id: 'commandCenter' } }),
  ])('round-trips %j', (full) => {
    expect(parseTopologyQuery(serializeTopologyQuery(full))).toEqual(full);
  });

  it('writes only what differs from the default', () => {
    expect(serializeTopologyQuery(query({ problems: true, group: 'zone' })).toString()).toBe(
      'group=zone&problems=1',
    );
  });

  it('writes a stage as `node`, a device as `device` and a zone as `zone`', () => {
    expect(
      serializeTopologyQuery(query({ selection: { type: 'stage', id: 'rules' } })).toString(),
    ).toBe('node=rules');
    expect(
      serializeTopologyQuery(query({ selection: { type: 'device', id: 'a' } })).toString(),
    ).toBe('device=a');
    expect(
      serializeTopologyQuery(query({ selection: { type: 'zone', id: 'BLD-DC' } })).toString(),
    ).toBe('zone=BLD-DC');
  });

  it('opens the zone the palette links to', () => {
    expect(parse('zone=BLD-LIB').selection).toEqual({ type: 'zone', id: 'BLD-LIB' });
  });

  it('keeps a device id with characters that need encoding', () => {
    const odd = query({ selection: { type: 'device', id: 'a b/c&d' } });
    expect(parseTopologyQuery(new URLSearchParams(serializeTopologyQuery(odd).toString()))).toEqual(
      odd,
    );
  });
});

describe('a value that is not one of the allowed ones', () => {
  it('falls back to the default instead of failing', () => {
    expect(parse('group=sideways&problems=yes&node=nowhere')).toEqual(DEFAULT_TOPOLOGY_QUERY);
  });

  it('ignores an empty selection', () => {
    expect(parse('device=&zone=').selection).toBeNull();
  });

  it('cuts a long search at 100 characters', () => {
    expect(parse(`q=${'a'.repeat(300)}`).q).toHaveLength(100);
  });
});

describe('when the address names more than one selection', () => {
  it('takes the device, then the stage, then the zone', () => {
    expect(parse('zone=Z&node=rules&device=d').selection).toEqual({ type: 'device', id: 'd' });
    expect(parse('zone=Z&node=rules').selection).toEqual({ type: 'stage', id: 'rules' });
    expect(parse('zone=Z&node=nowhere').selection).toEqual({ type: 'zone', id: 'Z' });
  });

  it('writes one selection, so the address never holds two', () => {
    const written = serializeTopologyQuery(query({ selection: { type: 'device', id: 'd' } }));
    expect([...written.keys()]).toEqual(['device']);
  });
});
