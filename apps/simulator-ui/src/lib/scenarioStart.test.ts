import { describe, expect, it } from 'vitest';
import { bannerText, nameList, startBanner, startedNotice } from './scenarioStart';

describe('nameList', () => {
  it('joins one, two and three names the way a sentence does', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['a'])).toBe('a');
    expect(nameList(['a', 'b'])).toBe('a and b');
    expect(nameList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('startBanner', () => {
  it('says nothing when every device is running', () => {
    expect(startBanner([])).toBeNull();
  });

  it('says the frame sentence for one stopped device, with the id in the mono face', () => {
    const banner = startBanner([{ deviceId: 'hub-power-01', state: 'stopped' }]);
    expect(bannerText(banner!)).toBe('hub-power-01 is stopped; running this starts it.');
    expect(banner!.filter((segment) => segment.mono)).toEqual([
      { text: 'hub-power-01', mono: true },
    ]);
  });

  it('says a paused device is resumed, not started', () => {
    const banner = startBanner([{ deviceId: 'lib-air-01', state: 'paused' }]);
    expect(bannerText(banner!)).toBe('lib-air-01 is paused; running this resumes it.');
  });

  it('puts several devices in one sentence', () => {
    expect(
      bannerText(
        startBanner([
          { deviceId: 'a', state: 'stopped' },
          { deviceId: 'b', state: 'stopped' },
          { deviceId: 'c', state: 'stopped' },
        ])!,
      ),
    ).toBe('a, b and c are stopped; running this starts them.');
    expect(
      bannerText(
        startBanner([
          { deviceId: 'a', state: 'paused' },
          { deviceId: 'b', state: 'paused' },
        ])!,
      ),
    ).toBe('a and b are paused; running this resumes them.');
  });

  it('says both when the devices are in different states', () => {
    const banner = startBanner([
      { deviceId: 'dc-env-01', state: 'stopped' },
      { deviceId: 'lib-air-01', state: 'paused' },
    ]);
    expect(bannerText(banner!)).toBe(
      'dc-env-01 is stopped and lib-air-01 is paused; running this starts or resumes them.',
    );
  });
});

describe('startedNotice', () => {
  it('names the devices a run started, and is silent when it started none', () => {
    expect(startedNotice([])).toBeNull();
    expect(startedNotice(['hub-power-01'])).toBe('Started hub-power-01.');
    expect(startedNotice(['dc-env-01', 'lib-air-01'])).toBe('Started dc-env-01 and lib-air-01.');
  });
});
