import { evaluate, INITIAL_STATE, parseRules, type Rule, type RuleState } from './rules-engine';

const hot: Rule = {
  id: 'server-room-hot',
  kind: 'server_room',
  metric: 'temperature_c',
  direction: 'above',
  raise: 27,
  clear: 25.5,
  for: 3,
  severity: 'high',
  incidentType: 'equipment_fault',
  title: 'Server room temperature high',
};

/** Feeds values through the engine and returns the transitions in order. */
function run(rule: Rule, values: number[], start: RuleState = INITIAL_STATE) {
  let state = start;
  return values.map((value) => {
    const result = evaluate(rule, state, value);
    state = result.state;
    return result.transition;
  });
}

describe('evaluate', () => {
  it('opens only after `for` consecutive breaches', () => {
    expect(run(hot, [27.5, 28, 28.2])).toEqual([null, null, 'opened']);
  });

  it('resets the streak when a reading is back within range', () => {
    expect(run(hot, [28, 28, 26, 28, 28])).toEqual([null, null, null, null, null]);
  });

  it('treats the threshold itself as not breached', () => {
    expect(run(hot, [27, 27, 27])).toEqual([null, null, null]);
  });

  it('does not flap inside the hysteresis band', () => {
    // Opens, then hovers between clear (25.5) and raise (27): stays open.
    expect(run(hot, [28, 28, 28, 26.9, 26, 25.6, 27.5])).toEqual([
      null,
      null,
      'opened',
      null,
      null,
      null,
      null,
    ]);
  });

  it('clears once the value is back past the clear threshold', () => {
    expect(run(hot, [28, 28, 28, 25.4])).toEqual([null, null, 'opened', 'cleared']);
  });

  it('supports "below" rules', () => {
    const cold: Rule = { ...hot, id: 'cold', direction: 'below', raise: 18, clear: 19, for: 2 };
    expect(run(cold, [17.5, 17, 18.5, 19.2])).toEqual([null, 'opened', null, 'cleared']);
  });

  it('continues from a rebuilt open state', () => {
    expect(run(hot, [26, 25], { open: true, streak: 0 })).toEqual([null, 'cleared']);
  });
});

describe('parseRules', () => {
  const kinds = new Map([['server_room', new Set(['temperature_c', 'humidity_pct'])]]);

  it('accepts a valid rule set', () => {
    expect(parseRules({ rules: [hot] }, kinds)).toEqual([hot]);
  });

  it.each([
    [{ ...hot, kind: 'freezer' }, 'no device has kind "freezer"'],
    [{ ...hot, metric: 'co2_ppm' }, 'never reports co2_ppm'],
    [{ ...hot, clear: 28 }, 'clear must be on the safe side of raise'],
    [{ ...hot, for: 0 }, 'for must be a positive integer'],
    [{ ...hot, severity: 'urgent' }, 'severity is invalid'],
  ])('rejects %o', (rule, message) => {
    expect(() => parseRules({ rules: [rule] }, kinds)).toThrow(message);
  });

  it('rejects duplicate ids', () => {
    expect(() => parseRules({ rules: [hot, hot] }, kinds)).toThrow('duplicate id');
  });
});
