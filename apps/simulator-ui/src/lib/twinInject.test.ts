import { describe, expect, it } from 'vitest';
import { FAULT_TILES } from './labFault';
import { readLabQuery } from './labQuery';
import { injectionSentence, INJECT_TILES, labLink, startsInSentence } from './twinInject';

describe('INJECT_TILES', () => {
  it('are the five chips of the frames, in their order', () => {
    expect(INJECT_TILES.map((tile) => tile.id)).toEqual([
      'breach',
      'silent',
      'drop',
      'delay',
      'malformed',
    ]);
  });

  it('are the Lab’s own tiles, so what can be chosen and why not is the Lab’s word', () => {
    for (const tile of INJECT_TILES) {
      expect(tile).toBe(FAULT_TILES.find((candidate) => candidate.id === tile.id));
    }
  });

  it('leaves only Breach choosable, and gives every other chip the reason', () => {
    expect(INJECT_TILES.filter((tile) => tile.available).map((tile) => tile.id)).toEqual([
      'breach',
    ]);
    for (const tile of INJECT_TILES.filter((candidate) => !candidate.available)) {
      expect(tile.reason, tile.id).toMatch(/\S/);
    }
  });
});

describe('startsInSentence', () => {
  it('says when the fault starts, as the Lab’s seconds', () => {
    expect(startsInSentence({ startAt: 20 })).toBe('Starts in 20 s');
    expect(startsInSentence({ startAt: 2.5 })).toBe('Starts in 2.5 s');
  });

  it('says now for zero', () => {
    expect(startsInSentence({ startAt: 0 })).toBe('Starts now');
  });

  it('says nothing for an empty, negative or non-finite field (the plan’s error speaks)', () => {
    for (const startAt of [null, -1, Number.NaN, Infinity]) {
      expect(startsInSentence({ startAt }), String(startAt)).toBeNull();
    }
  });
});

describe('injectionSentence', () => {
  const plan = { metric: 'temperature_c', value: 29.2 };

  it('says what the button sends: the metric, the reading with its unit and the length', () => {
    expect(injectionSentence(plan, { duration: 60, stop: 'timed' })).toBe(
      'Breach temperature_c → 29.2 °C for 60 s',
    );
  });

  it('writes a value with the Lab’s precision', () => {
    expect(
      injectionSentence({ metric: 'temperature_c', value: 29 }, { duration: 60, stop: 'timed' }),
    ).toBe('Breach temperature_c → 29.0 °C for 60 s');
    expect(
      injectionSentence({ metric: 'co2_ppm', value: 1234.6 }, { duration: 30, stop: 'timed' }),
    ).toMatch(/^Breach co2_ppm → 1235 .+ for 30 s$/);
  });

  it('leaves the length out for a manual fault, and when the duration is empty', () => {
    expect(injectionSentence(plan, { duration: 60, stop: 'manual' })).toBe(
      'Breach temperature_c → 29.2 °C',
    );
    expect(injectionSentence(plan, { duration: null, stop: 'timed' })).toBe(
      'Breach temperature_c → 29.2 °C',
    );
  });

  it('is null while the plan has no metric or no value', () => {
    const draft = { duration: 60, stop: 'timed' } as const;
    expect(injectionSentence({ metric: null, value: 29.2 }, draft)).toBeNull();
    expect(injectionSentence({ metric: 'temperature_c', value: null }, draft)).toBeNull();
  });
});

describe('labLink', () => {
  it('opens the Lab on one device', () => {
    expect(labLink('dc-env-01')).toBe('/lab?target=dc-env-01');
  });

  it('is read back by the Lab as that device chosen, with nothing else changed', () => {
    const query = readLabQuery(new URLSearchParams(labLink('dc-env-01').split('?')[1]));
    expect(query.scope).toBe('device');
    expect(query.targets).toEqual(['dc-env-01']);
    expect(query.zone).toBeNull();
    expect(query.page).toBe(1);
  });

  it('writes an id that needs it as a query string can carry it', () => {
    const link = labLink('dc env/01&x');
    expect(link).toBe('/lab?target=dc+env%2F01%26x');
    const query = readLabQuery(new URLSearchParams(link.split('?')[1]));
    expect(query.targets).toEqual(['dc env/01&x']);
  });
});
