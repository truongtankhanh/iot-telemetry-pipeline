import { describe, expect, it } from 'vitest';
import type { TwinKeyEvent } from './twinShortcuts';
import { createTwinShortcuts } from './twinShortcuts';

const press = (key: string, extra: Partial<TwinKeyEvent> = {}): TwinKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: { tagName: 'BODY' },
  stageFocused: false,
  ...extra,
});

const handle = createTwinShortcuts();

describe('the twin’s keys', () => {
  it('climbs a level on Escape and returns to the campus on Home, wherever focus is', () => {
    expect(handle(press('Escape'))).toEqual({ type: 'escape' });
    expect(handle(press('Home'))).toEqual({ type: 'home' });
  });

  it('pans and zooms only with focus on the stage', () => {
    expect(handle(press('ArrowLeft'))).toBeNull();
    expect(handle(press('+'))).toBeNull();
    expect(handle(press('ArrowLeft', { stageFocused: true }))).toEqual({
      type: 'nudge',
      nudge: 'pan-left',
    });
    expect(handle(press('=', { stageFocused: true }))).toEqual({
      type: 'nudge',
      nudge: 'zoom-in',
    });
    expect(handle(press('_', { stageFocused: true }))).toEqual({
      type: 'nudge',
      nudge: 'zoom-out',
    });
  });

  it('ignores a key in a field and with a modifier held', () => {
    const field = { tagName: 'INPUT' };
    expect(handle(press('Escape', { target: field }))).toBeNull();
    expect(handle(press('Home', { target: field }))).toBeNull();
    expect(handle(press('ArrowLeft', { target: field, stageFocused: true }))).toBeNull();
    expect(handle(press('Home', { metaKey: true }))).toBeNull();
    expect(handle(press('Escape', { ctrlKey: true }))).toBeNull();
    expect(handle(press('Escape', { altKey: true }))).toBeNull();
  });

  it('is not the twin’s for any other key', () => {
    expect(handle(press('g', { stageFocused: true }))).toBeNull();
    expect(handle(press('Enter', { stageFocused: true }))).toBeNull();
  });
});

describe('the twin’s keys while a guided demo is presented on it', () => {
  it('leaves Escape to presenter mode instead of climbing a level', () => {
    expect(handle(press('Escape', { presenting: true }))).toBeNull();
    expect(handle(press('Escape', { presenting: true, stageFocused: true }))).toBeNull();
  });

  it('leaves ArrowLeft to the previous step instead of panning, even on the stage', () => {
    expect(handle(press('ArrowLeft', { presenting: true, stageFocused: true }))).toBeNull();
  });

  it('keeps Home, the other arrows and the zoom keys as the twin’s', () => {
    expect(handle(press('Home', { presenting: true }))).toEqual({ type: 'home' });
    const onStage = { presenting: true, stageFocused: true };
    expect(handle(press('ArrowRight', onStage))).toEqual({ type: 'nudge', nudge: 'pan-right' });
    expect(handle(press('ArrowUp', onStage))).toEqual({ type: 'nudge', nudge: 'pan-up' });
    expect(handle(press('ArrowDown', onStage))).toEqual({ type: 'nudge', nudge: 'pan-down' });
    expect(handle(press('+', onStage))).toEqual({ type: 'nudge', nudge: 'zoom-in' });
    expect(handle(press('-', onStage))).toEqual({ type: 'nudge', nudge: 'zoom-out' });
  });

  it('is the old behaviour when presenting is false or absent', () => {
    expect(handle(press('Escape', { presenting: false }))).toEqual({ type: 'escape' });
    expect(handle(press('ArrowLeft', { presenting: false, stageFocused: true }))).toEqual({
      type: 'nudge',
      nudge: 'pan-left',
    });
  });
});
