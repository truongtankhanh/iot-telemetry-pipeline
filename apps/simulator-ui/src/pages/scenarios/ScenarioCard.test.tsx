import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import scenariosFixture from '../../api/fixtures/scenarios.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { ScenarioItem, ScenarioLibraryView } from '../../api/types';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import { ScenarioCard } from './ScenarioCard';
import type { ScenarioCommands } from './useScenarioCommands';

const [overheat, lecture, afternoon] = (scenariosFixture as unknown as ScenarioLibraryView)
  .scenarios as [ScenarioItem, ScenarioItem, ScenarioItem];

/** Commands that do nothing, with any of them replaced. */
function commands(overrides: Partial<ScenarioCommands> = {}): ScenarioCommands {
  return {
    isBusy: () => false,
    importing: false,
    errorOf: () => null,
    notice: null,
    dismissNotice: vi.fn(),
    pending: null,
    run: vi.fn(async () => {}),
    confirmReplace: vi.fn(async () => {}),
    cancelReplace: vi.fn(),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    importFile: vi.fn(async () => {}),
    ...overrides,
  };
}

function renderCard(
  item: ScenarioItem,
  options: {
    commands?: ScenarioCommands;
    selected?: boolean;
    running?: boolean;
    onDelete?: (name: string) => void;
  } = {},
) {
  const view = structuredClone(stateViewFixture);
  if (options.running) {
    view.runs = [
      {
        id: 'r1',
        scenario: item.name,
        startedAt: '2026-10-21T08:00:00.000Z',
        offsetS: 0,
        endsAtS: item.lengthS,
        anomalyIds: ['a1'],
        startedDevices: [],
      },
    ];
    view.engine.elapsedS = 41;
  }
  const store = createStudioStore();
  store.getState().setView(view, 1);
  const cmd = options.commands ?? commands();
  const result = render(
    <MemoryRouter>
      <StudioProvider store={store}>
        <ScenarioCard
          item={item}
          rules={view.rules}
          devices={view.devices}
          selected={options.selected ?? false}
          commands={cmd}
          {...(options.onDelete === undefined ? {} : { onDelete: options.onDelete })}
        />
      </StudioProvider>
    </MemoryRouter>,
  );
  return { ...result, commands: cmd };
}

describe('ScenarioCard', () => {
  it('names the scenario, its source and length, and describes it, as the frame does', () => {
    renderCard(overheat);
    const card = screen.getByRole('article', { name: 'server-room-overheat' });
    expect(within(card).getByText('built-in · 1 anomaly · 80 s')).toBeInTheDocument();
    expect(
      within(card).getByText('Row A runs hot for a minute, then recovers.'),
    ).toBeInTheDocument();
    expect(within(card).getByText('dc-env-01')).toBeInTheDocument();
    expect(within(card).getByText('temperature_c → 29.2')).toBeInTheDocument();
  });

  it('says what the rules should raise and when, in the words of the frame', () => {
    renderCard(overheat);
    expect(screen.getByText(/Raises/)).toHaveTextContent(
      'Raises Server room temperature high (high) about 24 s; clears about 80 s.',
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(/alert expected at 24 s, clears at 80 s/);
  });

  it('says "or later" for a clear that may take longer', () => {
    renderCard(lecture);
    expect(screen.getByText(/Raises/)).toHaveTextContent('clears about 110 s or later.');
  });

  it('notes an anomaly no rule watches, and counts the alerts of a longer scenario', () => {
    renderCard(afternoon);
    expect(screen.getByText(/Raises 2 alerts/)).toHaveTextContent('Raises 2 alerts: low, high.');
    expect(screen.getByRole('listitem')).toHaveTextContent(
      'No rule watches temperature_c on lha-air-01.',
    );
  });

  it('warns, before the click, that running it will start a device that is stopped', () => {
    renderCard(afternoon);
    expect(screen.getByRole('note')).toHaveTextContent(
      'hub-power-01 is stopped; running this starts it.',
    );
  });

  it('has no warning when every device it needs is running', () => {
    renderCard(overheat);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says the reason, and draws no chart, when the rules could not be read', () => {
    renderCard({
      ...overheat,
      expected: { available: false, reason: 'cannot read rules.json (ENOENT)' },
    });
    expect(screen.getByText(/Expected alerts are not available/)).toHaveTextContent(
      'Expected alerts are not available: cannot read rules.json (ENOENT).',
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('marks a scenario imported during the session', () => {
    renderCard({ ...afternoon, imported: true });
    expect(screen.getByText('custom · imported · 3 anomalies · 100 s')).toBeInTheDocument();
  });

  it('marks the card a link points at', () => {
    renderCard(overheat, { selected: true });
    expect(screen.getByRole('article')).toHaveAttribute('aria-current', 'true');
  });
});

describe('ScenarioCard: run and stop', () => {
  it('runs the scenario on Run, and names it in the button for a reader who hears one button at a time', async () => {
    const user = userEvent.setup();
    const { commands: cmd } = renderCard(overheat);
    await user.click(screen.getByRole('button', { name: 'Run server-room-overheat' }));
    expect(cmd.run).toHaveBeenCalledWith('server-room-overheat');
    expect(screen.queryByRole('button', { name: /^Stop/ })).not.toBeInTheDocument();
  });

  it('shows Stop, a running chip with the second, and no Run, while the scenario plays', async () => {
    const user = userEvent.setup();
    const { commands: cmd } = renderCard(overheat, { running: true });
    expect(screen.getByText(/Running/)).toHaveTextContent('Running · 41 s');
    expect(screen.queryByRole('button', { name: /^Run/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop server-room-overheat' }));
    expect(cmd.stop).toHaveBeenCalledWith('server-room-overheat');
    expect(screen.getByRole('article')).toHaveAttribute('data-running', 'true');
  });

  it('cannot be pressed twice while a command is on its way', () => {
    renderCard(overheat, {
      commands: commands({ isBusy: (_name, action) => action === 'run' || action === undefined }),
    });
    const run = screen.getByRole('button', { name: 'Run server-room-overheat' });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute('aria-busy', 'true');
  });

  it('says what the simulator said when it refused, on the card', () => {
    renderCard(overheat, { commands: commands({ errorOf: () => 'Cannot reach the simulator' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the simulator');
  });
});

describe('ScenarioCard: accessibility', () => {
  it('has no violations, idle or running', async () => {
    const idle = renderCard(afternoon);
    expect(await axeViolations(idle.container)).toEqual([]);
    idle.unmount();
    const running = renderCard(overheat, { running: true });
    expect(await axeViolations(running.container)).toEqual([]);
  });
});

describe('ScenarioCard: the editor’s commands', () => {
  it('leads a built-in to a copy, says why it cannot be edited, and offers no delete', () => {
    renderCard(overheat, { onDelete: vi.fn() });
    expect(
      screen.getByRole('button', {
        name: 'Edit server-room-overheat (built-in; duplicate it to change)',
      }),
    ).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Duplicate server-room-overheat' })).toHaveAttribute(
      'href',
      '/lab/timeline?duplicate=server-room-overheat',
    );
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export server-room-overheat as JSON' }),
    ).toBeEnabled();
  });

  it('leads a custom scenario to the editor, for editing and for a copy', () => {
    renderCard(afternoon);
    expect(screen.getByRole('link', { name: 'Edit bad-afternoon' })).toHaveAttribute(
      'href',
      '/lab/timeline?scenario=bad-afternoon',
    );
    expect(screen.getByRole('link', { name: 'Duplicate bad-afternoon' })).toHaveAttribute(
      'href',
      '/lab/timeline?duplicate=bad-afternoon',
    );
  });

  it('asks the page to delete a custom scenario, and shows no Delete without a page that confirms', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const { unmount } = renderCard(afternoon, { onDelete });
    await user.click(screen.getByRole('button', { name: 'Delete bad-afternoon' }));
    expect(onDelete).toHaveBeenCalledWith('bad-afternoon');
    unmount();

    renderCard(afternoon);
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it('cannot delete a scenario that is running, and says so', () => {
    renderCard(afternoon, { running: true, onDelete: vi.fn() });
    expect(
      screen.getByRole('button', { name: 'Delete bad-afternoon (stop it first)' }),
    ).toBeDisabled();
  });

  it('exports the document as a JSON file named after the scenario', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const names: string[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:studio/1';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    renderCard(afternoon);
    await user.click(screen.getByRole('button', { name: 'Export bad-afternoon as JSON' }));
    expect(names).toEqual(['bad-afternoon.json']);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0] as Blob);
    });
    expect(JSON.parse(text)).toEqual({
      name: afternoon.name,
      description: afternoon.description,
      anomalies: afternoon.anomalies,
    });
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['name', 'description', 'anomalies']);
  });

  it('has no accessibility violation with the commands in place', async () => {
    const { container } = renderCard(afternoon, { onDelete: vi.fn() });
    expect(await axeViolations(container)).toEqual([]);
  });
});
