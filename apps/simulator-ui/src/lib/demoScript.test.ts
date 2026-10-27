import { describe, expect, it } from 'vitest';
import { type DemoScript, tokensIn, validateScript } from './demoScript';

const valid = (): DemoScript => ({
  id: 'demo',
  title: 'Demo',
  summary: 'A demo',
  subject: { deviceId: 'dc-env-01', metric: 'temperature_c', ruleId: 'server-room-hot' },
  scenario: 'server-room-overheat',
  steps: [
    { id: 'one', title: 'One', summary: '{devices}', say: 'Say it.' },
    {
      id: 'two',
      title: 'Two',
      summary: 'Raise {rule.raise}',
      say: 'Heat it.',
      action: { type: 'run-scenario', scenario: 'server-room-overheat' },
      await: { type: 'rule-raised', ruleId: 'server-room-hot', deviceId: 'dc-env-01' },
      timeoutS: 90,
      notes: 'Only for {device}.',
    },
  ],
});

/** A copy of the valid script changed by `change`, as the raw value a file would give. */
const changed = (change: (script: Record<string, unknown>) => void): unknown => {
  const script = structuredClone(valid()) as unknown as Record<string, unknown>;
  change(script);
  return script;
};

const stepsOf = (script: Record<string, unknown>) => script.steps as Record<string, unknown>[];

const problemsOf = (raw: unknown): string[] => {
  const result = validateScript(raw);
  if (result.ok) throw new Error('the script was expected to be refused');
  return result.problems;
};

describe('tokensIn', () => {
  it('lists every token, in order, each time it is used', () => {
    expect(tokensIn('{device} → {value} for {duration}, {device} again')).toEqual([
      'device',
      'value',
      'duration',
      'device',
    ]);
  });

  it('does not read braces around anything else as a token', () => {
    expect(tokensIn('{ not a token } and {Also-not} and {}')).toEqual([]);
  });
});

describe('validateScript', () => {
  it('accepts a valid script and gives it back as it is', () => {
    const result = validateScript(valid());
    expect(result).toEqual({ ok: true, script: valid() });
  });

  it('accepts a hold-value action and a step with neither action nor await', () => {
    const raw = changed((script) => {
      stepsOf(script)[0]!.action = {
        type: 'hold-value',
        deviceId: 'dc-env-01',
        metric: 'temperature_c',
        value: 29.5,
      };
    });
    expect(validateScript(raw).ok).toBe(true);
  });

  it('refuses a value that is not an object', () => {
    expect(problemsOf(null)).toEqual(['The script is not an object.']);
    expect(problemsOf([])).toEqual(['The script is not an object.']);
    expect(problemsOf('script')).toEqual(['The script is not an object.']);
  });

  it('refuses a script without steps', () => {
    expect(problemsOf(changed((script) => (script.steps = [])))).toEqual([
      'The script needs at least one step.',
    ]);
    expect(problemsOf(changed((script) => delete script.steps))).toEqual([
      'The script needs at least one step.',
    ]);
  });

  it('refuses a script without a subject, and a subject with a field missing', () => {
    expect(problemsOf(changed((script) => delete script.subject))[0]).toMatch(/needs a "subject"/);
    expect(
      problemsOf(changed((script) => delete (script.subject as Record<string, unknown>).ruleId)),
    ).toEqual(['The subject needs a non-empty "ruleId".']);
  });

  it('names the step in a duplicate id', () => {
    const raw = changed((script) => (stepsOf(script)[1]!.id = 'one'));
    expect(problemsOf(raw)).toEqual(['Step "one" has an id that another step has.']);
  });

  it('refuses an action or an await of an unknown type, naming the step', () => {
    expect(
      problemsOf(changed((script) => (stepsOf(script)[1]!.action = { type: 'zoom-camera' }))),
    ).toEqual(['Step "two" has an action of an unknown type: zoom-camera.']);
    expect(
      problemsOf(
        changed(
          (script) =>
            (stepsOf(script)[1]!.await = { type: 'tea-brewed', ruleId: 'r', deviceId: 'd' }),
        ),
      ),
    ).toEqual(['Step "two" waits for an event of an unknown type: tea-brewed.']);
  });

  it('refuses an await without a rule or a device, and a run-scenario without a name', () => {
    expect(
      problemsOf(
        changed((script) => (stepsOf(script)[1]!.await = { type: 'alert-opened', ruleId: 'r' })),
      ),
    ).toEqual(['Step "two" waits for alert-opened but names no rule or device.']);
    expect(
      problemsOf(changed((script) => (stepsOf(script)[1]!.action = { type: 'run-scenario' }))),
    ).toEqual(['Step "two" runs a scenario but names none.']);
  });

  it('refuses a held value that is not a finite number, or that is outside the contract', () => {
    const hold = (value: unknown) =>
      changed((script) => {
        stepsOf(script)[1]!.action = {
          type: 'hold-value',
          deviceId: 'dc-env-01',
          metric: 'temperature_c',
          value,
        };
      });
    expect(problemsOf(hold(Number.NaN))).toEqual([
      'Step "two" holds a value that is not a finite number.',
    ]);
    expect(problemsOf(hold(Infinity))).toEqual([
      'Step "two" holds a value that is not a finite number.',
    ]);
    expect(problemsOf(hold('29'))).toEqual([
      'Step "two" holds a value that is not a finite number.',
    ]);
    expect(problemsOf(hold(500))[0]).toMatch(/outside the contract's range -40 to 85/);
  });

  it('refuses a held metric the contract does not have', () => {
    const raw = changed((script) => {
      stepsOf(script)[1]!.action = {
        type: 'hold-value',
        deviceId: 'dc-env-01',
        metric: 'luminosity',
        value: 1,
      };
    });
    expect(problemsOf(raw)).toEqual([
      'Step "two" holds a metric the contract does not have: luminosity.',
    ]);
  });

  it('refuses a timeoutS that is zero, negative or not a number', () => {
    for (const bad of [0, -5, Number.NaN, '60']) {
      expect(problemsOf(changed((script) => (stepsOf(script)[1]!.timeoutS = bad)))).toEqual([
        'Step "two" needs a "timeoutS" above zero.',
      ]);
    }
  });

  it('refuses an unknown token in a title, a summary, the narration or the notes, naming the step', () => {
    for (const field of ['title', 'summary', 'say', 'notes']) {
      const raw = changed((script) => (stepsOf(script)[1]![field] = 'Hello {nope}'));
      expect(problemsOf(raw)).toEqual(['Step "two" uses the unknown token {nope}.']);
    }
  });

  it('refuses an unknown token in the script’s own text', () => {
    expect(problemsOf(changed((script) => (script.summary = 'About {nothing}')))).toEqual([
      'The script uses the unknown token {nothing}.',
    ]);
  });

  it('refuses a step without text, and says which', () => {
    const raw = changed((script) => (stepsOf(script)[0]!.say = '  '));
    expect(problemsOf(raw)).toEqual(['Step "one" needs a non-empty "say".']);
  });

  it('names a step by its position when it has no id', () => {
    const raw = changed((script) => delete stepsOf(script)[1]!.id);
    expect(problemsOf(raw)).toEqual(['Step 2 needs an "id".']);
  });

  it('accepts the camera of a step as campus, top or a building, and gives it back as it is', () => {
    for (const camera of ['campus', 'top', { building: 'BLD-DC' }]) {
      const raw = changed((script) => (stepsOf(script)[0]!.camera = camera));
      const result = validateScript(raw);
      expect(result.ok, JSON.stringify(camera)).toBe(true);
      expect(result.ok && result.script.steps[0]?.camera).toEqual(camera);
    }
  });

  it('leaves a step without a camera without one, and lets a camera sit beside an action', () => {
    const plain = validateScript(valid());
    expect(plain.ok && 'camera' in (plain.script.steps[0] ?? {})).toBe(false);
    const beside = validateScript(
      changed((script) => (stepsOf(script)[1]!.camera = { building: 'BLD-DC' })),
    );
    expect(beside.ok && beside.script.steps[1]?.action?.type).toBe('run-scenario');
    expect(beside.ok && beside.script.steps[1]?.camera).toEqual({ building: 'BLD-DC' });
  });

  it('keeps only the building of a camera object', () => {
    const raw = changed((script) => (stepsOf(script)[0]!.camera = { building: 'BLD-DC', zoom: 3 }));
    const result = validateScript(raw);
    expect(result.ok && result.script.steps[0]?.camera).toEqual({ building: 'BLD-DC' });
  });

  it('refuses a camera that is not campus, top or a building, naming the step', () => {
    const sentence =
      'Step "one" has a camera that is not "campus", "top" or { building: "<zone code>" }.';
    for (const bad of ['orbit', '', 3, true, null, [], {}, { building: '' }, { building: 7 }]) {
      const raw = changed((script) => (stepsOf(script)[0]!.camera = bad));
      expect(problemsOf(raw), JSON.stringify(bad)).toEqual([sentence]);
    }
  });

  it('reports every problem, not only the first', () => {
    const raw = changed((script) => {
      script.title = '';
      stepsOf(script)[0]!.say = '';
      stepsOf(script)[1]!.timeoutS = -1;
    });
    expect(problemsOf(raw)).toHaveLength(3);
  });
});
