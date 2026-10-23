import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test-axe';
import { StepCard, type StepCardProps } from './StepCard';
import { StepList } from './StepList';

const base = (overrides: Partial<StepCardProps> = {}): StepCardProps => ({
  index: 2,
  count: 6,
  title: 'Heat the server room',
  say: '“Row A in the data center just got hotter than it should be.”',
  phase: 'waiting',
  waitingFor: 'the rule server-room-hot to raise on dc-env-01',
  awaitType: 'rule-raised',
  detail: 'server-room-hot has 2 of 3 readings above 27 °C',
  reading: { value: '29.3', unit: '°C', breach: true },
  cause: null,
  late: false,
  moveOnLabel: 'Move on without the rule',
  happened: 'the rule raised',
  failure: null,
  movedOn: null,
  scenarioRunning: true,
  sinceStartS: 14.6,
  facts: [
    { done: true, text: 'Scenario started' },
    { done: true, text: 'Broker accepts the readings' },
    { done: false, text: 'Alert opens about 4 s from now' },
  ],
  nextTitle: 'The alert opens',
  canBack: true,
  notes: null,
  notesOpen: false,
  notice: null,
  onNext: vi.fn(),
  onBack: vi.fn(),
  onRestart: vi.fn(),
  onRetry: vi.fn(),
  onToggleNotes: vi.fn(),
  ...overrides,
});

const show = (overrides: Partial<StepCardProps> = {}) => {
  const props = base(overrides);
  return { props, ...render(<StepCard {...props} />) };
};

describe('StepCard', () => {
  it('shows the step as the frame does: chips, a heading, the narration, the count, the reading and three facts', () => {
    show();
    expect(screen.getByText('Step 3')).toBeInTheDocument();
    expect(screen.getByText('Scenario running · 14 s in')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Heat the server room' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Row A in the data center/)).toBeInTheDocument();
    expect(
      screen.getByText('Waiting for the rule server-room-hot to raise on dc-env-01'),
    ).toBeInTheDocument();
    expect(screen.getByText('server-room-hot has 2 of 3 readings above 27 °C')).toBeInTheDocument();
    expect(screen.getByText('29.3')).toBeInTheDocument();
    expect(screen.getByText('Scenario started')).toBeInTheDocument();
    expect(screen.getByText('Alert opens about 4 s from now')).toBeInTheDocument();
  });

  it('puts the waiting block in a status, so a screen reader hears it change', () => {
    const { container } = show();
    const status = container.querySelector('[data-tone][role="status"]');
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent('Waiting for the rule server-room-hot to raise');
  });

  it('says how it moves on, from the step’s own event, and says nothing for a step that waits for nothing', () => {
    const { rerender, props } = show();
    expect(screen.getByText('Moves on by itself when the rule raises')).toBeInTheDocument();
    rerender(<StepCard {...props} awaitType="alert-opened" />);
    expect(screen.getByText('Moves on by itself when the alert opens')).toBeInTheDocument();
    rerender(<StepCard {...props} awaitType="incident-delivered" />);
    expect(screen.getByText('Moves on by itself when the incident appears')).toBeInTheDocument();
    rerender(<StepCard {...props} awaitType="alert-cleared" />);
    expect(screen.getByText('Moves on by itself when the alert clears')).toBeInTheDocument();
    rerender(<StepCard {...props} awaitType={null} phase="none" waitingFor={null} />);
    expect(screen.queryByText(/Moves on by itself/)).toBeNull();
  });

  it('draws no waiting block for a step that waits for nothing', () => {
    const { container } = show({ phase: 'none', waitingFor: null, awaitType: null, facts: [] });
    expect(
      container.querySelector('[data-tone][role="status"], [data-tone][role="alert"]'),
    ).toBeNull();
  });

  it('names the next step on the primary button, with its key, and calls onNext', async () => {
    const user = userEvent.setup();
    const { props } = show();
    const next = screen.getByRole('button', { name: 'Next: The alert opens' });
    expect(next).toHaveAttribute('aria-keyshortcuts', 'Space');
    expect(next).toHaveTextContent('Space');
    await user.click(next);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('says Finish on the last step', () => {
    show({ index: 5, nextTitle: null, awaitType: 'alert-cleared' });
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });

  it('offers Back, disabled on the first step, and Restart step', async () => {
    const user = userEvent.setup();
    const { props, rerender } = show();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Restart step' }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onRestart).toHaveBeenCalledTimes(1);
    rerender(<StepCard {...props} index={0} canBack={false} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  describe('when the step is late', () => {
    it('says it is late, names what is still awaited and why, and puts the way on in the button', () => {
      show({
        phase: 'slow',
        late: true,
        sinceStartS: 61,
        cause: {
          code: 'ingest-unreachable',
          text: 'Ingest does not answer, so no alert can open.',
        },
      });
      expect(
        screen.getByText('Late: still waiting for the rule server-room-hot to raise on dc-env-01'),
      ).toBeInTheDocument();
      expect(screen.getByText('Still not here after 61 s.')).toBeInTheDocument();
      expect(screen.getByText('Ingest does not answer, so no alert can open.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Move on without the rule' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Next:/ })).toBeNull();
    });

    it('says when nothing explains it', () => {
      show({ phase: 'slow', late: true, cause: null });
      expect(screen.getByText(/Nothing Studio can see explains it/)).toBeInTheDocument();
    });

    it('names a cause that is already visible before the time limit, and offers the way on at once', () => {
      show({
        phase: 'waiting',
        late: true,
        cause: {
          code: 'device-not-running',
          text: 'dc-env-01 is paused, so it publishes nothing.',
        },
      });
      expect(
        screen.getByText('Waiting for the rule server-room-hot to raise on dc-env-01'),
      ).toBeInTheDocument();
      expect(screen.getByText('dc-env-01 is paused, so it publishes nothing.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Move on without the rule' })).toBeInTheDocument();
    });
  });

  describe('when the step could not start', () => {
    it('is an alert with the simulator’s reason and a Retry', async () => {
      const user = userEvent.setup();
      const { props } = show({ phase: 'failed', failure: 'the engine refused the run' });
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('This step could not start');
      expect(alert).toHaveTextContent('the engine refused the run');
      await user.click(within(alert).getByRole('button', { name: 'Retry' }));
      expect(props.onRetry).toHaveBeenCalledTimes(1);
    });

    it('says what it waits for when there is no failure but a question to answer, with no Retry', () => {
      show({ phase: 'failed', failure: null });
      expect(screen.getByRole('alert')).toHaveTextContent('answer the question');
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
  });

  it('says a step is done, and that it has already happened', () => {
    show({ phase: 'done' });
    expect(screen.getByText('Done: the rule raised')).toBeInTheDocument();
    expect(screen.getByText('It has already happened.')).toBeInTheDocument();
  });

  it('says it is starting', () => {
    show({ phase: 'starting' });
    expect(screen.getByText('Starting this step')).toBeInTheDocument();
  });

  it('says in a status that the step moved on by itself, and is silent otherwise', () => {
    const { container, props, rerender } = show();
    const hidden = () => container.querySelector('p.visually-hidden[role="status"]');
    expect(hidden()).toHaveTextContent('');
    rerender(<StepCard {...props} movedOn="the alert opened" />);
    expect(hidden()).toHaveTextContent('Moved on: the alert opened');
  });

  it('shows the notes only when the step has some and the presenter asked, with the state on the button', async () => {
    const user = userEvent.setup();
    const { props, rerender } = show({ notes: null });
    expect(screen.queryByRole('button', { name: /Notes/ })).toBeNull();

    rerender(<StepCard {...props} notes="The anomaly begins a few seconds in." />);
    const button = screen.getByRole('button', { name: 'Notes' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('The anomaly begins a few seconds in.')).toBeNull();
    await user.click(button);
    expect(props.onToggleNotes).toHaveBeenCalledTimes(1);

    rerender(<StepCard {...props} notes="The anomaly begins a few seconds in." notesOpen />);
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByText('The anomaly begins a few seconds in.');
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute(
      'aria-controls',
      panel.id,
    );
  });

  it('shows the result of a command (Pause) as a status, and a refusal as an alert', () => {
    const { props, rerender } = show({ notice: { tone: 'ok', text: 'Paused 4 devices.' } });
    expect(screen.getByText('Paused 4 devices.')).toBeInTheDocument();
    rerender(<StepCard {...props} notice={{ tone: 'bad', text: 'dc-env-01: stopped' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('dc-env-01: stopped');
  });

  it('shows no scenario chip until the scenario runs, and no reading while the step starts', () => {
    show({ scenarioRunning: false, phase: 'starting' });
    expect(screen.queryByText(/Scenario running/)).toBeNull();
    expect(screen.queryByText('29.3')).toBeNull();
  });

  it('has no accessibility violations in its states', async () => {
    const states: Partial<StepCardProps>[] = [
      {},
      { phase: 'slow', late: true, cause: { code: 'simulated-clock', text: 'Press Step.' } },
      { phase: 'failed', failure: 'refused' },
      { phase: 'done', notes: 'Notes.', notesOpen: true },
      { phase: 'none', facts: [], awaitType: null, waitingFor: null },
    ];
    for (const state of states) {
      const { container, unmount } = show(state);
      expect(await axeViolations(container), JSON.stringify(state)).toEqual([]);
      unmount();
    }
  });
});

describe('StepList', () => {
  const items = [
    {
      id: 'normal',
      title: 'Everything is normal',
      summary: '4 devices, 2.0 msg/s',
      standing: 'done' as const,
    },
    {
      id: 'rule',
      title: 'The rule behind the alert',
      summary: 'Raise 27 °C',
      standing: 'done' as const,
    },
    {
      id: 'heat',
      title: 'Heat the server room',
      summary: 'dc-env-01 → 29.2 °C for 60 s',
      standing: 'current' as const,
    },
    {
      id: 'alert',
      title: 'The alert opens',
      summary: 'Rule, alert, outbox',
      standing: 'upcoming' as const,
    },
  ];

  it('is a labelled navigation with an ordered list of the steps', () => {
    render(<StepList items={items} scriptLine="Script: overheat-to-incident · 4 steps" />);
    const nav = screen.getByRole('navigation', { name: 'Demo steps' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(4);
    expect(within(nav).getByText('Script: overheat-to-incident · 4 steps')).toBeInTheDocument();
  });

  it('marks the current step with aria-current and says "Done" for the steps behind it, not by colour alone', () => {
    render(<StepList items={items} scriptLine="" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, null, 'step', null]);
    expect(within(rows[0] as HTMLElement).getByText('Done')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Done')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).queryByText('Done')).toBeNull();
    expect(within(rows[3] as HTMLElement).queryByText('Done')).toBeNull();
  });

  it('shows the title and the summary of every step', () => {
    render(<StepList items={items} scriptLine="" />);
    expect(screen.getByText('dc-env-01 → 29.2 °C for 60 s')).toBeInTheDocument();
    expect(screen.getByText('The alert opens')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<StepList items={items} scriptLine="Script" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
