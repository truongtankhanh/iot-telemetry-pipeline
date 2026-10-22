import { act, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { RunConflict } from '../../api/types';
import type { DownloadHost } from '../../lib/eventExport';
import { scenarioJson } from '../../lib/timelineExport';
import { toDocument } from '../../lib/timelineEditor';
import { renderEditorHook } from './timelineTestSupport';
import { useEditorCommands } from './useEditorCommands';
import { useScenarioEditor } from './useScenarioEditor';

const useBoth = (download?: DownloadHost) => {
  const editor = useScenarioEditor();
  const commands = useEditorCommands(editor, download === undefined ? {} : { download });
  return { editor, commands, location: useLocation() };
};

type Rendered = ReturnType<typeof renderEditorHook<ReturnType<typeof useBoth>>>;

const hot = {
  deviceId: 'dc-env-02',
  metric: 'temperature_c' as const,
  value: 30,
  startAt: 5,
  duration: 20,
};

const ready = (r: Rendered) => waitFor(() => expect(r.result.current.editor.status).toBe('ready'));

/** A new scenario named `name` holding one valid anomaly. */
async function newScenario(name = 'fresh', options = {}) {
  const r = renderEditorHook(() => useBoth(), options);
  await ready(r);
  act(() => {
    r.result.current.editor.rename(name);
    r.result.current.editor.add(hot);
  });
  return r;
}

/** `bad-afternoon`, saved, opened for editing. */
async function savedScenario(options = {}) {
  const r = renderEditorHook(() => useBoth(), {
    path: '/lab/timeline?scenario=bad-afternoon',
    ...options,
  });
  await waitFor(() => expect(r.result.current.editor.kind).toBe('saved'));
  return r;
}

describe('useEditorCommands: save', () => {
  it('saves a new scenario: the document is sent, the state and the copy follow, the address points at it', async () => {
    const r = await newScenario();
    expect(r.result.current.commands.saveBlock).toBeNull();

    let item: unknown;
    await act(async () => {
      item = await r.result.current.commands.save();
    });

    expect(item).toMatchObject({ name: 'fresh' });
    const [put] = r.simulator.callsTo('PUT', '/api/scenarios/fresh');
    expect(put?.body).toEqual({
      name: 'fresh',
      description: '',
      anomalies: [hot],
    });
    expect(r.store.getState().view?.scenarios).toContain('fresh');
    // The router applies the new address a moment after the save: wait for it, then look at the rest.
    await waitFor(() => expect(r.result.current.location.search).toBe('?scenario=fresh'));
    const { editor } = r.result.current;
    expect(editor.kind).toBe('saved');
    expect(editor.dirty).toBe(false);
    expect(editor.message).toEqual({ tone: 'ok', text: 'Saved fresh.' });
    expect(r.drafts.get('new')).toBeUndefined();
    await waitFor(() =>
      expect(r.simulator.callsTo('GET', '/api/scenarios').length).toBeGreaterThan(1),
    );
  });

  it('saves a change to a saved scenario in place', async () => {
    const r = await savedScenario();
    act(() => r.result.current.editor.move('a2', 60));
    expect(r.result.current.commands.saveBlock).toBeNull();

    await act(async () => {
      await r.result.current.commands.save();
    });

    const [put] = r.simulator.callsTo('PUT', '/api/scenarios/bad-afternoon');
    expect((put?.body as { anomalies: { startAt: number }[] }).anomalies[1]?.startAt).toBe(60);
    expect(r.result.current.editor.dirty).toBe(false);
    expect(r.result.current.editor.base).toEqual(toDocument(r.result.current.editor.doc));
  });

  it('does not offer a save for a scenario that has nothing to save, is not valid, or is running', async () => {
    const r = await savedScenario();
    expect(r.result.current.commands.saveBlock).toBe('Nothing to save');

    const bad = await newScenario('Bad Name');
    expect(bad.result.current.commands.saveBlock).toBe('Fix 1 problem first');
    let item: unknown = 'untouched';
    await act(async () => {
      item = await bad.result.current.commands.save();
    });
    expect(item).toBeNull();
    expect(bad.simulator.callsTo('PUT', '/api/scenarios/Bad%20Name')).toEqual([]);
  });

  it('keeps the copy and shows the simulator’s reason when a save is refused', async () => {
    const r = await newScenario();
    r.simulator.failSave({
      status: 500,
      message: 'cannot write fresh.json in the scenarios folder (EROFS)',
    });

    await act(async () => {
      await r.result.current.commands.save();
    });

    expect(r.result.current.commands.error).toBe(
      'cannot write fresh.json in the scenarios folder (EROFS)',
    );
    expect(r.result.current.editor.kind).toBe('new');
    expect(r.result.current.editor.dirty).toBe(true);
    expect(r.drafts.get('new')).toBeDefined();
    expect(r.result.current.commands.busy).toBeNull();

    r.simulator.failSave(null);
    await act(async () => {
      await r.result.current.commands.save();
    });
    expect(r.result.current.commands.error).toBeNull();
    expect(r.result.current.editor.kind).toBe('saved');
  });
});

describe('useEditorCommands: run now', () => {
  it('saves first when the scenario is changed, then runs it', async () => {
    const r = await savedScenario();
    act(() => r.result.current.editor.move('a2', 60));

    await act(async () => {
      await r.result.current.commands.runNow();
    });

    const order = r.simulator.calls
      .filter((c) => c.method !== 'GET')
      .map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual([
      'PUT /api/scenarios/bad-afternoon',
      'POST /api/scenarios/bad-afternoon/run',
    ]);
    expect(r.result.current.commands.running).toBe(true);
    expect(r.result.current.commands.notice?.text).toMatch(/^Running bad-afternoon\./);
  });

  it('runs a scenario that is saved and unchanged without saving it again', async () => {
    const r = await savedScenario();
    await act(async () => {
      await r.result.current.commands.runNow();
    });
    expect(r.simulator.callsTo('PUT', '/api/scenarios/bad-afternoon')).toEqual([]);
    expect(r.simulator.callsTo('POST', '/api/scenarios/bad-afternoon/run')).toHaveLength(1);
  });

  it('saves a new scenario and runs it', async () => {
    const r = await newScenario();
    await act(async () => {
      await r.result.current.commands.runNow();
    });
    expect(r.simulator.callsTo('PUT', '/api/scenarios/fresh')).toHaveLength(1);
    expect(r.simulator.callsTo('POST', '/api/scenarios/fresh/run')).toHaveLength(1);
  });

  it('does not run when the save is refused', async () => {
    const r = await newScenario();
    r.simulator.failSave({
      status: 409,
      message: 'a file named fresh.json is already in the scenarios folder',
    });
    await act(async () => {
      await r.result.current.commands.runNow();
    });
    expect(r.simulator.callsTo('POST', '/api/scenarios/fresh/run')).toEqual([]);
    expect(r.result.current.commands.error).toMatch(/already in the scenarios folder/);
  });

  it('does not run a scenario that is not valid, and says what is wrong', async () => {
    const r = renderEditorHook(() => useBoth());
    await ready(r);
    expect(r.result.current.commands.runBlock).toBe('Fix 2 problems first');
    await act(async () => {
      await r.result.current.commands.runNow();
    });
    expect(r.simulator.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('asks before it plays over something, and repeats the run with replace when told to', async () => {
    const r = await savedScenario();
    const conflict: RunConflict = {
      deviceId: 'dc-env-01',
      anomalyId: 'a9',
      runId: 'r9',
      scenario: 'server-room-overheat',
    };
    r.simulator.conflicts.set('bad-afternoon', [conflict]);

    await act(async () => {
      await r.result.current.commands.runNow();
    });
    expect(r.result.current.commands.pending?.conflicts).toEqual([conflict]);
    expect(r.result.current.commands.running).toBe(false);

    await act(async () => {
      await r.result.current.commands.confirmReplace();
    });
    const runs = r.simulator.callsTo('POST', '/api/scenarios/bad-afternoon/run');
    expect(runs.at(-1)?.body).toEqual({ replace: true });
    expect(r.result.current.commands.running).toBe(true);
  });

  it('cannot be saved over or deleted while it runs, and stops when told to', async () => {
    const r = await savedScenario();
    await act(async () => {
      await r.result.current.commands.runNow();
    });
    expect(r.result.current.commands.running).toBe(true);
    expect(r.result.current.commands.saveBlock).toBe('It is running; stop it first');
    expect(r.result.current.commands.deleteBlock).toBe('It is running; stop it first');

    await act(async () => {
      await r.result.current.commands.stop();
    });
    expect(r.simulator.callsTo('POST', '/api/scenarios/bad-afternoon/stop')).toHaveLength(1);
    expect(r.result.current.commands.running).toBe(false);
  });
});

describe('useEditorCommands: delete, discard and export', () => {
  it('deletes a saved scenario and forgets its copy', async () => {
    const r = await savedScenario();
    act(() => r.result.current.editor.remove('a1'));

    let done = false;
    await act(async () => {
      done = await r.result.current.commands.remove();
    });

    expect(done).toBe(true);
    expect(r.simulator.callsTo('DELETE', '/api/scenarios/bad-afternoon')).toHaveLength(1);
    expect(r.store.getState().view?.scenarios).not.toContain('bad-afternoon');
    expect(r.drafts.get('scenario:bad-afternoon')).toBeUndefined();
    expect(r.result.current.editor.kind).toBe('new');
    expect(r.result.current.editor.message).toEqual({ tone: 'ok', text: 'Deleted bad-afternoon.' });
  });

  it('has nothing to delete for a scenario that is not saved', async () => {
    const r = await newScenario();
    expect(r.result.current.commands.deleteBlock).toBe('It is not saved');
    let done = true;
    await act(async () => {
      done = await r.result.current.commands.remove();
    });
    expect(done).toBe(false);
    expect(r.simulator.callsTo('DELETE', '/api/scenarios/fresh')).toEqual([]);
  });

  it('discards the copy and what the last refusal said', async () => {
    const r = await savedScenario();
    act(() => r.result.current.editor.remove('a1'));
    r.simulator.failSave({ status: 500, message: 'nope' });
    await act(async () => {
      await r.result.current.commands.save();
    });
    expect(r.result.current.commands.error).toBe('nope');

    act(() => r.result.current.commands.discard());
    expect(r.result.current.commands.error).toBeNull();
    expect(r.result.current.editor.dirty).toBe(false);
    expect(r.result.current.editor.doc.entries).toHaveLength(3);
  });

  it('hands the copy to the browser as a JSON file named after the scenario', async () => {
    const link = { href: '', download: '', click: vi.fn() };
    const host: DownloadHost = {
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
      createLink: () => link,
    };
    const r = renderEditorHook(() => useBoth(host), {
      path: '/lab/timeline?scenario=bad-afternoon',
    });
    await waitFor(() => expect(r.result.current.editor.kind).toBe('saved'));

    act(() => r.result.current.commands.exportJson());

    expect(link.download).toBe('bad-afternoon.json');
    expect(link.click).toHaveBeenCalledOnce();
    const blob = vi.mocked(host.createObjectURL).mock.calls[0]![0];
    expect(blob.size).toBe(new Blob([scenarioJson(toDocument(r.result.current.editor.doc))]).size);
  });
});
