import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { twinLayoutFixture } from '../../api/fixtures/twinLayout';
import type { TwinLayout } from '../../api/types';
import { MIN_DWELL_MS } from '../../lib/demoSession';
import { OVERHEAT_TO_INCIDENT } from '../../lib/demoScripts';
import type { CameraMove } from '../../lib/twinDemoCamera';
import { DemoSessionStore } from '../../state/demoSessionStore';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { type TwinDemoCameraOptions, useTwinDemoCamera } from './useTwinDemoCamera';

const layout = twinLayoutFixture.layout as TwinLayout;
const withoutDataCenter: TwinLayout = {
  ...layout,
  zones: layout.zones.filter((zone) => zone.code !== 'BLD-DC'),
};

const STEP_IDS = OVERHEAT_TO_INCIDENT.steps.map((step) => step.id);
const CAMPUS = { fly: 'campus', select: null };
const DATA_CENTER = {
  fly: { building: expect.objectContaining({ heightM: 14 }) as unknown },
  select: { type: 'zone', id: 'BLD-DC' },
};

/** A presented demo is at `step`, with the times of its steps counted from 1 s. */
function presentAt(demo: DemoSessionStore, step = 0) {
  demo.dispatch({
    type: 'start',
    scriptId: OVERHEAT_TO_INCIDENT.id,
    stepCount: OVERHEAT_TO_INCIDENT.steps.length,
    now: 1_000,
  });
  for (let i = 0; i < step; i++) demo.dispatch({ type: 'next', now: 2_000 + i * 1_000 });
}

function setup(options: { step?: number | null; layout?: TwinLayout | null; hasFocus?: boolean }) {
  const demo = new DemoSessionStore();
  if (options.step !== null) presentAt(demo, options.step ?? 0);
  const apply = vi.fn<(move: CameraMove, flight: boolean) => void>();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={createStudioStore()} demo={demo}>
      {children}
    </StudioProvider>
  );
  const initialProps: TwinDemoCameraOptions = {
    layout: options.layout === undefined ? layout : options.layout,
    hasFocus: options.hasFocus ?? false,
    apply,
  };
  const hook = renderHook((props: TwinDemoCameraOptions) => useTwinDemoCamera(props), {
    wrapper,
    initialProps,
  });
  /** The presenter's (or the stack's) moves of the session, inside `act`. */
  const dispatch = (action: Parameters<DemoSessionStore['dispatch']>[0]) =>
    act(() => demo.dispatch(action));
  return { demo, apply, hook, dispatch };
}

describe('useTwinDemoCamera: when nothing is presented', () => {
  it('moves nothing and is not presenting, before a demo, and after Esc', () => {
    const { apply, hook, dispatch } = setup({ step: null });
    expect(hook.result.current).toEqual({ presenting: false, startMove: null, problem: null });
    expect(apply).not.toHaveBeenCalled();

    dispatch({
      type: 'start',
      scriptId: OVERHEAT_TO_INCIDENT.id,
      stepCount: OVERHEAT_TO_INCIDENT.steps.length,
      now: 1_000,
    });
    expect(hook.result.current.presenting).toBe(true);
    dispatch({ type: 'exit' });
    expect(hook.result.current.presenting).toBe(false);
    expect(hook.result.current.startMove).toBeNull();
  });
});

describe('useTwinDemoCamera: the step on screen when the twin mounts', () => {
  it('starts there with no flight: the selection is made, the camera is for the scene to start at', () => {
    const { apply, hook } = setup({ step: 0 });
    expect(hook.result.current.presenting).toBe(true);
    expect(hook.result.current.startMove).toEqual(CAMPUS);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(CAMPUS, false);
  });

  it('starts at the building of a building step, and selects it', () => {
    const { apply, hook } = setup({ step: 2 });
    expect(hook.result.current.startMove).toEqual(DATA_CENTER);
    expect(apply).toHaveBeenCalledWith(DATA_CENTER, false);
  });

  it('does not take the selection from a viewer whose address already chose a building', () => {
    const { apply, hook } = setup({ step: 2, hasFocus: true });
    expect(hook.result.current.startMove).toEqual(DATA_CENTER);
    expect(apply).not.toHaveBeenCalled();
  });

  it('has no start for a step without a camera', () => {
    const { apply, hook } = setup({ step: 1 });
    expect(hook.result.current.startMove).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('waits for the layout, then starts there', () => {
    const { apply, hook } = setup({ step: 2, layout: null });
    expect(hook.result.current.startMove).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    hook.rerender({ layout, hasFocus: false, apply });
    expect(hook.result.current.startMove).toEqual(DATA_CENTER);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(DATA_CENTER, false);
  });
});

describe('useTwinDemoCamera: a step coming on screen', () => {
  it('flies when a step with a camera arrives, and for none that has no camera', () => {
    const { apply, dispatch } = setup({ step: 0 });
    apply.mockClear();

    dispatch({ type: 'next', now: 5_000 });
    // "The rule behind the alert" has no camera: the camera stays where the presenter put it.
    expect(apply).not.toHaveBeenCalled();

    dispatch({ type: 'next', now: 6_000 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(DATA_CENTER, true);

    dispatch({ type: 'next', now: 7_000 });
    // "The alert opens" has none either.
    expect(apply).toHaveBeenCalledTimes(1);

    dispatch({ type: 'next', now: 8_000 });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(CAMPUS, true);
  });

  it('flies again for a step that is gone back to', () => {
    const { apply, dispatch } = setup({ step: 2 });
    apply.mockClear();

    dispatch({ type: 'back', now: 5_000 });
    expect(apply).not.toHaveBeenCalled();
    dispatch({ type: 'next', now: 6_000 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(DATA_CENTER, true);
  });

  it('flies when the step arrives on its awaited event, as it does when the presenter moves on', () => {
    const { apply, dispatch } = setup({ step: 2 });
    apply.mockClear();
    // The step after "Heat the server room" has no camera: one more, by hand, reaches the one that has.
    dispatch({
      type: 'event-satisfied',
      stepId: 'heat',
      stepIds: STEP_IDS,
      now: 2_000 + 2_000 + MIN_DWELL_MS,
    });
    expect(apply).not.toHaveBeenCalled();
    dispatch({ type: 'next', now: 30_000 });
    expect(apply).toHaveBeenCalledWith(CAMPUS, true);
  });

  it('flies again when the step is restarted, once for each', () => {
    const { apply, dispatch } = setup({ step: 2 });
    apply.mockClear();
    dispatch({
      type: 'restart-step',
      stepId: 'heat',
      baseline: { observationId: 0, seriesT: null, openAlertIds: [], at: 9_000 },
      now: 9_000,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(DATA_CENTER, true);
  });

  it('does not fly again for the same step when the page renders again', () => {
    const { apply, hook } = setup({ step: 0 });
    apply.mockClear();
    const other = vi.fn<(move: CameraMove, flight: boolean) => void>();
    hook.rerender({ layout, hasFocus: true, apply: other });
    hook.rerender({ layout: { ...layout }, hasFocus: false, apply: other });
    expect(apply).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});

describe('useTwinDemoCamera: a camera this layout cannot follow', () => {
  it('moves nothing and says why', () => {
    const { apply, hook, dispatch } = setup({ step: 1, layout: withoutDataCenter });
    expect(hook.result.current.problem).toBeNull();
    dispatch({ type: 'next', now: 5_000 });
    expect(apply).not.toHaveBeenCalled();
    expect(hook.result.current.startMove).toBeNull();
    expect(hook.result.current.problem).toBe(
      'The camera step names BLD-DC, which is not a building of this campus layout.',
    );
  });

  it('forgets the problem once the step goes on to one that can be followed', () => {
    const { hook, dispatch } = setup({ step: 2, layout: withoutDataCenter });
    expect(hook.result.current.problem).toMatch(/BLD-DC/);
    // "The alert opens", then "The incident appears", whose camera is the campus.
    dispatch({ type: 'next', now: 5_000 });
    dispatch({ type: 'next', now: 6_000 });
    expect(hook.result.current.problem).toBeNull();
    expect(hook.result.current.startMove).toEqual(CAMPUS);
  });
});
