import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Anomaly } from '../../api/types';
import { fromAnomalies } from '../../lib/timelineEditor';
import { EditorDrafts } from '../../state/editorDrafts';
import { axeViolations } from '../../test-axe';
import { EditorCanvas } from './EditorCanvas';
import { type PartContext, renderEditorPart } from './timelineTestSupport';

afterEach(() => vi.unstubAllGlobals());

const hot = /^dc-env-01 temperature_c 29\.2 °C from \d+(\.\d)? s for \d+(\.\d)? s/;
const blocks = () =>
  screen.queryAllByRole('button', { name: /from \d+(\.\d)? s for \d+(\.\d)? s/ });

function canvas(options = {}) {
  let context!: PartContext;
  const harness = renderEditorPart((c) => {
    context = c;
    return <EditorCanvas editor={c.editor} commands={c.commands} impact={c.impact} />;
  }, options);
  return { ...harness, context: () => context };
}

const saved = { path: '/lab/timeline?scenario=bad-afternoon' };

/** `count` anomalies on one signal, 10 s apart, none overlapping. */
const many = (count: number): Anomaly[] =>
  Array.from({ length: count }, (_, i) => ({
    deviceId: 'dc-env-01',
    metric: 'temperature_c',
    value: 29.2,
    startAt: i * 10,
    duration: 5,
  }));

async function select(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('button', { name }));
}

describe('EditorCanvas: the picture', () => {
  it('draws a block for each anomaly in a lane for each signal, in a window that holds the scenario', async () => {
    canvas(saved);
    expect(
      await screen.findByRole('group', {
        name: /^Timeline of 120 seconds: 3 anomalies on 3 devices/,
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(screen.getByText('hub-power-01')).toBeInTheDocument();
    expect(screen.getByText('power_kw')).toBeInTheDocument();
  });

  it('says there is nothing on the timeline for a new scenario, and adds the first anomaly with the button', async () => {
    const user = userEvent.setup();
    canvas();
    expect(
      await screen.findByText('Nothing on the timeline yet. Choose Add anomaly, or press A.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add anomaly' }));
    expect(await screen.findByRole('button', { name: hot })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('adds an anomaly with a plain A, and not while a field has the focus', async () => {
    const user = userEvent.setup();
    canvas(saved);
    await waitFor(() => expect(blocks()).toHaveLength(3));
    await user.keyboard('a');
    await waitFor(() => expect(blocks()).toHaveLength(4));

    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    await user.keyboard('a');
    expect(blocks()).toHaveLength(4);
    field.remove();
  });

  it('refuses a 51st anomaly: the button is off and says why', async () => {
    const drafts = new EditorDrafts();
    drafts.set('new', { doc: fromAnomalies(many(50)), base: null });
    canvas({ drafts });
    const add = await screen.findByRole('button', { name: 'Add anomaly' });
    expect(add).toBeDisabled();
    expect(screen.getByText('A scenario holds at most 50 anomalies')).toBeInTheDocument();
  });
});

describe('EditorCanvas: the window and the snap', () => {
  it('has three windows, the one that holds the scenario chosen, and widens on request', async () => {
    const user = userEvent.setup();
    canvas(saved);
    const length = await screen.findByRole('radiogroup', { name: 'Length' });
    expect(within(length).getByRole('radio', { name: '120 s' })).toBeChecked();
    await user.click(within(length).getByRole('radio', { name: '300 s' }));
    expect(
      await screen.findByRole('group', { name: /^Timeline of 300 seconds/ }),
    ).toBeInTheDocument();
  });

  it('has a snap switch that is on, and a finer step when it is off', async () => {
    const user = userEvent.setup();
    canvas(saved);
    await select(user, hot);
    const snap = screen.getByRole('switch', { name: 'Snap to 5 s' });
    expect(snap).toBeChecked();
    await user.click(snap);
    expect(snap).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: hot }));
    await user.keyboard('{ArrowRight}');
    expect(
      await screen.findByRole('button', { name: /^dc-env-01 temperature_c 29\.2 °C from 31 s/ }),
    ).toBeInTheDocument();
  });
});

describe('EditorCanvas: selecting and the keyboard', () => {
  it('selects a block when it is clicked, with grips on it, and lets go on Escape', async () => {
    const user = userEvent.setup();
    canvas(saved);
    await select(user, hot);
    const block = screen.getByRole('button', { name: hot });
    expect(block).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Drag to change when it starts')).toBeInTheDocument();
    expect(screen.getByText('Drag to change when it ends')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: hot })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Drag to change when it starts')).not.toBeInTheDocument();
  });

  it('moves the selected block by the step with the arrows, and its end with Shift', async () => {
    const user = userEvent.setup();
    canvas(saved);
    await select(user, hot);
    await user.keyboard('{ArrowRight}');
    // The same element keeps the focus while it moves, so the next key goes to it (it is not made again).
    expect(
      await screen.findByRole('button', {
        name: /^dc-env-01 temperature_c 29\.2 °C from 35 s for 60 s/,
      }),
    ).toHaveFocus();
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(
      await screen.findByRole('button', {
        name: /^dc-env-01 temperature_c 29\.2 °C from 35 s for 65 s/,
      }),
    ).toBeInTheDocument();
    await user.keyboard('{Shift>}{Alt>}{ArrowLeft}{/Alt}{/Shift}');
    expect(
      await screen.findByRole('button', {
        name: /^dc-env-01 temperature_c 29\.2 °C from 30 s for 70 s/,
      }),
    ).toBeInTheDocument();
  });

  it('removes the selected block with Delete', async () => {
    const user = userEvent.setup();
    canvas(saved);
    await select(user, hot);
    await user.keyboard('{Delete}');
    await waitFor(() => expect(blocks()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: hot })).not.toBeInTheDocument();
  });

  it('goes to the next and the previous block with Down and Up, and gives it the focus', async () => {
    const user = userEvent.setup();
    canvas(saved);
    await select(user, /^hub-power-01 power_kw 190 kW/);
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('button', { name: hot })).toHaveFocus());
    await user.keyboard('{ArrowUp}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^hub-power-01 power_kw 190 kW/ })).toHaveFocus(),
    );
  });

  it('has one tab stop among the blocks: the selected one, else the first', async () => {
    const user = userEvent.setup();
    canvas(saved);
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(blocks().filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(blocks()[0]).toHaveAttribute('tabindex', '0');
    await select(user, hot);
    expect(screen.getByRole('button', { name: hot })).toHaveAttribute('tabindex', '0');
    expect(blocks().filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('says what stopped a move at the next block', async () => {
    const user = userEvent.setup();
    const { context } = canvas(saved);
    await select(user, hot);
    act(() => {
      context().editor.add({
        deviceId: 'dc-env-01',
        metric: 'temperature_c',
        value: 29.2,
        startAt: 100,
        duration: 10,
      });
    });
    await select(user, /from 100 s for 10 s/);
    act(() => context().editor.move('a4', 0));
    expect(context().editor.message).toEqual({
      tone: 'note',
      text: 'Stopped at the edge of the next block on dc-env-01 temperature_c',
    });
  });
});

describe('EditorCanvas: many anomalies group by zone', () => {
  it('draws a lane for each zone above 12, and opens one into its devices on request', async () => {
    const user = userEvent.setup();
    const drafts = new EditorDrafts();
    drafts.set('new', { doc: fromAnomalies(many(14)), base: null });
    canvas({ drafts });

    const toggle = await screen.findByRole('button', { name: 'Open zone BLD-DC into its devices' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(blocks()).toHaveLength(0); // thin bars, no blocks, while the zone is shut

    await user.click(toggle);
    const open = await screen.findByRole('button', { name: 'Close zone BLD-DC to one lane' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(blocks()).toHaveLength(14);
  });
});

describe('EditorCanvas: accessibility', () => {
  it('has no violation with a block selected', async () => {
    const user = userEvent.setup();
    const { container } = canvas(saved);
    await select(user, hot);
    expect(await axeViolations(container)).toEqual([]);
  });
});
