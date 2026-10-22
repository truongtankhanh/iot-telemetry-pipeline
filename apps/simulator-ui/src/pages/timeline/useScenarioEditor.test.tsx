import { act, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Anomaly } from '../../api/types';
import { fromScenario, toDocument } from '../../lib/timelineEditor';
import { EditorDrafts } from '../../state/editorDrafts';
import { scenarioItem } from '../scenarios/scenariosTestSupport';
import { renderEditorHook } from './timelineTestSupport';
import { useScenarioEditor } from './useScenarioEditor';

const useBoth = () => ({ editor: useScenarioEditor(), location: useLocation() });

const ready = async (result: { current: ReturnType<typeof useBoth> }) => {
  await waitFor(() => expect(result.current.editor.status).toBe('ready'));
};

const extra: Anomaly = {
  deviceId: 'dc-env-02',
  metric: 'temperature_c',
  value: 30,
  startAt: 5,
  duration: 20,
};

describe('useScenarioEditor: what the address opens', () => {
  it('opens a new scenario at once, empty, with nothing to save yet', () => {
    const { result } = renderEditorHook(useBoth);
    const { editor } = result.current;
    expect(editor.status).toBe('ready');
    expect(editor.kind).toBe('new');
    expect(editor.doc.entries).toEqual([]);
    expect(editor.dirty).toBe(false);
    expect(editor.errors.name).toBe('Give the scenario a name');
    expect(editor.errors.count).toBe('Add at least one anomaly');
  });

  it('waits for the library to open a saved scenario, then holds it as it is saved', async () => {
    const { result } = renderEditorHook(useBoth, { path: '/lab/timeline?scenario=bad-afternoon' });
    expect(result.current.editor.status).toBe('loading');
    await ready(result);
    const { editor } = result.current;
    expect(editor.kind).toBe('saved');
    expect(editor.saved?.name).toBe('bad-afternoon');
    expect(editor.doc.name).toBe('bad-afternoon');
    expect(editor.doc.entries).toHaveLength(3);
    expect(editor.dirty).toBe(false);
    expect(editor.base).toEqual(toDocument(fromScenario(editor.saved!)));
    expect(editor.errors).toEqual({ entries: {} });
  });

  it('opens a new scenario and says why for a built-in or a name that does not exist', async () => {
    const builtIn = renderEditorHook(useBoth, {
      path: '/lab/timeline?scenario=server-room-overheat',
    });
    await ready(builtIn.result);
    expect(builtIn.result.current.editor.kind).toBe('new');
    expect(builtIn.result.current.editor.openingNotice).toMatch(/built-in scenario/);

    const missing = renderEditorHook(useBoth, { path: '/lab/timeline?scenario=nope' });
    await ready(missing.result);
    expect(missing.result.current.editor.openingNotice).toBe(
      'There is no scenario named "nope", so this is a new one.',
    );
  });

  it('opens a copy under a new name, unsaved but not stored until it is touched', async () => {
    const { result, drafts } = renderEditorHook(useBoth, {
      path: '/lab/timeline?duplicate=server-room-overheat',
    });
    await ready(result);
    const { editor } = result.current;
    expect(editor.kind).toBe('copy');
    expect(editor.doc.name).toBe('server-room-overheat-copy');
    expect(editor.dirty).toBe(true);
    expect(drafts.dirtyKeys()).toEqual([]);

    act(() => editor.describe('Mine.'));
    expect(drafts.dirtyKeys()).toEqual(['copy:server-room-overheat']);
    expect(result.current.editor.doc.description).toBe('Mine.');
  });

  it('says why when the library cannot be read and the address needs it', async () => {
    const { result } = renderEditorHook(useBoth, {
      path: '/lab/timeline?scenario=bad-afternoon',
      libraryFailure: { status: 502, message: 'ingest is down' },
    });
    await waitFor(() => expect(result.current.editor.loadError).toBe('ingest is down'));
    expect(result.current.editor.status).toBe('loading');
  });
});

describe('useScenarioEditor: editing', () => {
  const open = async (options = {}) => {
    const harness = renderEditorHook(useBoth, {
      path: '/lab/timeline?scenario=bad-afternoon',
      ...options,
    });
    await ready(harness.result);
    return harness;
  };
  const ids = (result: { current: ReturnType<typeof useBoth> }) =>
    result.current.editor.doc.entries.map((entry) => entry.id);

  it('moves a block by the snap step, stores the copy and marks it changed', async () => {
    const { result, drafts } = await open();
    expect(result.current.editor.step).toBe(5);
    act(() => result.current.editor.move('a2', 33)); // dc-env-01, 30 to 90 → starts at 35
    const entry = result.current.editor.doc.entries.find((e) => e.id === 'a2');
    expect(entry?.anomaly.startAt).toBe(35);
    expect(result.current.editor.dirty).toBe(true);
    expect(drafts.dirtyKeys()).toEqual(['scenario:bad-afternoon']);
  });

  it('moves by a second when the snap is off', async () => {
    const { result } = await open();
    act(() => result.current.editor.setSnap(false));
    expect(result.current.editor.step).toBe(1);
    act(() => result.current.editor.move('a2', 33.4));
    expect(result.current.editor.doc.entries[1]?.anomaly.startAt).toBe(33);
  });

  it('says so when a neighbour stops a move, and stops saying it on the next edit', async () => {
    const { result } = await open();
    act(() => result.current.editor.add({ ...extra, deviceId: 'dc-env-01', startAt: 120 }));
    act(() => result.current.editor.move('a4', 0)); // dc-env-01 temperature: a2 ends at 90
    expect(result.current.editor.message).toEqual({
      tone: 'note',
      text: 'Stopped at the edge of the next block on dc-env-01 temperature_c',
    });
    act(() => result.current.editor.move('a4', 100));
    expect(result.current.editor.message).toBeNull();
  });

  it('resizes an edge', async () => {
    const { result } = await open();
    act(() => result.current.editor.resize('a2', 'end', 100));
    expect(result.current.editor.doc.entries[1]?.anomaly).toMatchObject({
      startAt: 30,
      duration: 70,
    });
  });

  it('adds, selects the new block, and refuses one that overlaps with the reason', async () => {
    const { result } = await open();
    act(() => {
      result.current.editor.add(extra);
    });
    expect(ids(result)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(result.current.editor.selectedId).toBe('a4');

    act(() => {
      result.current.editor.add({ ...extra, deviceId: 'dc-env-01', startAt: 40, duration: 10 });
    });
    expect(ids(result)).toHaveLength(4);
    expect(result.current.editor.message).toEqual({
      tone: 'bad',
      text: 'dc-env-01 already has a fault on temperature_c in the scenario from 30 s to 90 s',
    });
  });

  it('edits a field and gives the reason back to the field when the edit is refused', async () => {
    const { result } = await open();
    let outcome: unknown;
    act(() => {
      outcome = result.current.editor.edit('a2', { value: 31 });
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(result.current.editor.doc.entries[1]?.anomaly.value).toBe(31);

    act(() => {
      result.current.editor.add({ ...extra, deviceId: 'dc-env-01', startAt: 120, duration: 10 });
    });
    act(() => {
      outcome = result.current.editor.edit('a4', { startAt: 60 });
    });
    expect(outcome).toMatchObject({ ok: false });
    expect(result.current.editor.doc.entries[3]?.anomaly.startAt).toBe(120);
  });

  it('removes a block and clears the selection when it was the selected one', async () => {
    const { result } = await open();
    act(() => result.current.editor.select('a2'));
    expect(result.current.editor.selectedId).toBe('a2');
    act(() => result.current.editor.remove('a2'));
    expect(ids(result)).toEqual(['a1', 'a3']);
    expect(result.current.editor.selectedId).toBeNull();
  });

  it('names and describes the scenario, and says what is wrong with a name', async () => {
    const { result } = renderEditorHook(useBoth);
    act(() => result.current.editor.rename('Bad Name'));
    expect(result.current.editor.errors.name).toMatch(/^Use 1 to 64 characters/);
    act(() => result.current.editor.rename('bad-afternoon'));
    await waitFor(() =>
      expect(result.current.editor.errors.name).toBe(
        'A scenario named "bad-afternoon" already exists',
      ),
    );
    act(() => result.current.editor.rename('fresh'));
    expect(result.current.editor.errors.name).toBeUndefined();
  });

  it('widens the window by itself and keeps a wider one that was chosen', async () => {
    const { result } = await open();
    expect(result.current.editor.windowS).toBe(120); // the scenario ends at 100 s
    act(() => result.current.editor.setWindow(300));
    expect(result.current.editor.windowS).toBe(300);
    act(() => result.current.editor.setWindow(120));
    act(() => {
      result.current.editor.add({ ...extra, startAt: 130, duration: 20 });
    });
    expect(result.current.editor.windowS).toBe(180);
  });

  it('discards the copy: the scenario is as it is saved again', async () => {
    const { result, drafts } = await open();
    act(() => result.current.editor.remove('a1'));
    expect(result.current.editor.dirty).toBe(true);
    act(() => result.current.editor.discard());
    expect(drafts.get('scenario:bad-afternoon')).toBeUndefined();
    expect(result.current.editor.dirty).toBe(false);
    expect(ids(result)).toEqual(['a1', 'a2', 'a3']);
  });

  it('puts a copy back as it was (the drag that is cancelled)', async () => {
    const { result } = await open();
    const before = result.current.editor.doc;
    act(() => result.current.editor.move('a2', 60));
    act(() => result.current.editor.restore(before));
    expect(result.current.editor.doc.entries[1]?.anomaly.startAt).toBe(30);
  });
});

describe('useScenarioEditor: the copy outlives the page', () => {
  it('finds the copy again when the page is opened again, because it lives in the store', async () => {
    const drafts = new EditorDrafts();
    const first = renderEditorHook(useBoth, {
      path: '/lab/timeline?scenario=bad-afternoon',
      drafts,
    });
    await ready(first.result);
    act(() => first.result.current.editor.remove('a1'));
    first.unmount();

    const second = renderEditorHook(useBoth, {
      path: '/lab/timeline?scenario=bad-afternoon',
      drafts,
    });
    await ready(second.result);
    expect(second.result.current.editor.doc.entries.map((e) => e.id)).toEqual(['a2', 'a3']);
    expect(second.result.current.editor.dirty).toBe(true);
  });

  it('asks the browser to hold the page back while a copy holds work, and not otherwise', async () => {
    const { result } = renderEditorHook(useBoth, { path: '/lab/timeline?scenario=bad-afternoon' });
    await ready(result);
    const quiet = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    act(() => result.current.editor.remove('a1'));
    const held = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });
});

describe('useScenarioEditor: after a save and a delete', () => {
  it('moves a new scenario to the saved key and points the address at it, before the library has it', async () => {
    const { result, drafts } = renderEditorHook(useBoth);
    act(() => {
      result.current.editor.rename('fresh');
      result.current.editor.add(extra);
    });
    expect(drafts.dirtyKeys()).toEqual(['new']);
    const doc = result.current.editor.doc;
    const item = scenarioItem('fresh', { anomalies: [extra], lengthS: 25 });

    act(() => result.current.editor.afterSave(doc, item));

    expect(drafts.get('new')).toBeUndefined();
    expect(drafts.get('scenario:fresh')?.base).toEqual(toDocument(doc));
    expect(result.current.location.search).toBe('?scenario=fresh');
    expect(result.current.editor.kind).toBe('saved');
    expect(result.current.editor.dirty).toBe(false);
    expect(result.current.editor.doc.name).toBe('fresh');
  });

  it('forgets the copy and the address when the scenario is deleted', async () => {
    const { result, drafts } = renderEditorHook(useBoth, {
      path: '/lab/timeline?scenario=bad-afternoon',
    });
    await ready(result);
    act(() => result.current.editor.remove('a1'));
    act(() => result.current.editor.afterDelete());
    expect(drafts.get('scenario:bad-afternoon')).toBeUndefined();
    expect(result.current.location.search).toBe('');
    expect(result.current.editor.kind).toBe('new');
  });
});
