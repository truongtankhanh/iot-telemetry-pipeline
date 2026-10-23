import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FaultsSnapshot } from '../../api/types';
import { DEFAULT_DRAFTS } from '../../lib/faultSettings';
import { faultState } from './faultsTestSupport';
import { useFaultDrafts } from './useFaultDrafts';

const faults = (changes: Partial<FaultsSnapshot> = {}): FaultsSnapshot =>
  faultState(changes).engine.faults;

function setup(initial: FaultsSnapshot | null) {
  return renderHook(({ engine }) => useFaultDrafts(engine), { initialProps: { engine: initial } });
}

describe('useFaultDrafts', () => {
  it('starts from the defaults of the frame when nothing is on, or the state has not arrived', () => {
    expect(setup(faults()).result.current.drafts).toEqual(DEFAULT_DRAFTS);
    expect(setup(null).result.current.drafts).toEqual(DEFAULT_DRAFTS);
  });

  it('starts from the engine’s settings for a fault that is on', () => {
    const { result } = setup(faults({ drop: { percent: 12 }, reorder: { window: 6 } }));
    expect(result.current.drafts.drop).toEqual({ percent: 12 });
    expect(result.current.drafts.reorder).toEqual({ window: 6 });
    expect(result.current.drafts.duplicate).toEqual(DEFAULT_DRAFTS.duplicate);
  });

  it('changes one draft and leaves the others', () => {
    const { result } = setup(faults());
    act(() => result.current.setDraft('drop', { percent: 9 }));
    expect(result.current.drafts.drop).toEqual({ percent: 9 });
    expect(result.current.drafts.duplicate).toEqual(DEFAULT_DRAFTS.duplicate);
  });

  it('puts a draft back to the engine’s settings with reset', () => {
    const { result } = setup(faults({ drop: { percent: 5 } }));
    act(() => result.current.setDraft('drop', { percent: 9 }));
    act(() => result.current.reset('drop'));
    expect(result.current.drafts.drop).toEqual({ percent: 5 });
  });

  it('puts the draft of a fault that is off back to its last values, which is where it was', () => {
    const { result } = setup(faults());
    act(() => result.current.setDraft('delay', { delayMs: 40, jitterMs: 4 }));
    act(() => result.current.reset('delay'));
    expect(result.current.drafts.delay).toEqual({ delayMs: 40, jitterMs: 4 });
  });

  it('does nothing with reset before the state has arrived', () => {
    const { result } = setup(null);
    act(() => result.current.reset('drop'));
    expect(result.current.drafts).toEqual(DEFAULT_DRAFTS);
  });

  it('takes the engine’s new settings for a fault that changed under it, and leaves the other drafts alone', () => {
    const { result, rerender } = setup(faults());
    act(() => result.current.setDraft('delay', { delayMs: 40, jitterMs: 4 }));
    act(() => result.current.setDraft('drop', { percent: 9 }));
    rerender({ engine: faults({ drop: { percent: 7 } }) });
    expect(result.current.drafts.drop).toEqual({ percent: 7 });
    expect(result.current.drafts.delay).toEqual({ delayMs: 40, jitterMs: 4 });
  });

  it('keeps what was in the controls when a fault is switched off', () => {
    const { result, rerender } = setup(faults({ drop: { percent: 12 } }));
    expect(result.current.drafts.drop).toEqual({ percent: 12 });
    rerender({ engine: faults() });
    expect(result.current.drafts.drop).toEqual({ percent: 12 });
  });

  it('does not reset a draft because a fault it has nothing to do with changed', () => {
    const { result, rerender } = setup(faults({ drop: { percent: 5 } }));
    act(() => result.current.setDraft('drop', { percent: 9 }));
    rerender({ engine: faults({ drop: { percent: 5 }, duplicate: { percent: 3 } }) });
    expect(result.current.drafts.drop).toEqual({ percent: 9 });
    expect(result.current.drafts.duplicate).toEqual({ percent: 3 });
  });

  it('does not treat the time the link went down as a setting', () => {
    const { result, rerender } = setup(faults({ linkLoss: { since: 'a', forS: 30 } }));
    act(() => result.current.setDraft('link-loss', { forS: 45 }));
    rerender({ engine: faults({ linkLoss: { since: 'b', forS: 30 } }) });
    expect(result.current.drafts['link-loss']).toEqual({ forS: 45 });
    rerender({ engine: faults({ linkLoss: { since: 'b', forS: 60 } }) });
    expect(result.current.drafts['link-loss']).toEqual({ forS: 60 });
  });

  it('copies the kinds of malformed, so a draft can change without touching the state', () => {
    const engine = faults({ malformed: { percent: 3, kinds: ['range'] } });
    const { result } = setup(engine);
    act(() =>
      result.current.setDraft('malformed', { ...result.current.drafts.malformed, kinds: ['json'] }),
    );
    expect(engine.malformed?.kinds).toEqual(['range']);
  });
});
