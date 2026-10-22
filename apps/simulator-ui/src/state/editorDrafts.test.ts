import { describe, expect, it, vi } from 'vitest';
import type { Anomaly } from '../api/types';
import { EMPTY_DOC, fromAnomalies, fromScenario, setName, toDocument } from '../lib/timelineEditor';
import { draftKey, EditorDrafts } from './editorDrafts';

const hot: Anomaly = {
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
};

const saved = { name: 'hot', description: '', anomalies: [hot] };

describe('draftKey', () => {
  it('keeps a saved scenario, a duplicate and the new scenario apart', () => {
    expect(draftKey.scenario('hot')).toBe('scenario:hot');
    expect(draftKey.copy('hot')).toBe('copy:hot');
    expect(draftKey.new).toBe('new');
    expect(new Set([draftKey.scenario('x'), draftKey.copy('x'), draftKey.new]).size).toBe(3);
  });
});

describe('EditorDrafts', () => {
  it('holds a copy and gives back the same object until it is set again', () => {
    const drafts = new EditorDrafts();
    const draft = { doc: fromScenario(saved), base: toDocument(fromScenario(saved)) };
    expect(drafts.get('scenario:hot')).toBeUndefined();
    drafts.set('scenario:hot', draft);
    expect(drafts.get('scenario:hot')).toBe(draft);
    expect(drafts.get('scenario:hot')).toBe(drafts.get('scenario:hot'));
  });

  it('tells its listeners about a set and about a discard that did something, and only then', () => {
    const drafts = new EditorDrafts();
    const listener = vi.fn();
    const stop = drafts.subscribe(listener);
    drafts.set('new', { doc: EMPTY_DOC, base: null });
    expect(listener).toHaveBeenCalledTimes(1);
    drafts.discard('nothing-here');
    expect(listener).toHaveBeenCalledTimes(1);
    drafts.discard('new');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(drafts.get('new')).toBeUndefined();
    stop();
    drafts.set('new', { doc: EMPTY_DOC, base: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('knows which copies differ from what is saved', () => {
    const drafts = new EditorDrafts();
    const doc = fromScenario(saved);
    drafts.set('scenario:hot', { doc, base: toDocument(doc) });
    drafts.set('new', { doc: EMPTY_DOC, base: null });
    expect(drafts.dirtyKeys()).toEqual([]);
    expect(drafts.hasDirty()).toBe(false);

    drafts.set('scenario:hot', { doc: setName(doc, 'cold'), base: toDocument(doc) });
    drafts.set('copy:hot', { doc: fromAnomalies([hot]), base: null });
    expect(drafts.dirtyKeys().sort()).toEqual(['copy:hot', 'scenario:hot']);
    expect(drafts.hasDirty()).toBe(true);
  });

  it('lets each listener go on its own', () => {
    const drafts = new EditorDrafts();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = drafts.subscribe(a);
    drafts.subscribe(b);
    stopA();
    drafts.set('new', { doc: EMPTY_DOC, base: null });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
