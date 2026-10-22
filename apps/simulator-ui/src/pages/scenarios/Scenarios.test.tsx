import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { StateView } from '../../api/types';
import { axeViolations } from '../../test-axe';
import {
  address,
  fixtureLibrary,
  jsonFile,
  library38,
  renderScenarios,
} from './scenariosTestSupport';

afterEach(() => vi.unstubAllGlobals());

/** The names of the cards on show, in order. */
const names = () =>
  screen
    .getAllByRole('article')
    .map((card) => within(card).getByRole('heading', { level: 2 }).textContent);

const cardsShown = () => screen.findAllByRole('article');

const tab = (label: string, count: number) =>
  screen.getByRole('tab', { name: new RegExp(`^${label}\\s*${count}$`) });

/** The state with a run of one scenario in it, as if it had been started. */
function viewWithRun(scenario: string, lengthS: number): StateView {
  const view = structuredClone(stateViewFixture);
  view.runs = [
    {
      id: 'r1',
      scenario,
      startedAt: '2026-10-21T08:00:00.000Z',
      offsetS: 0,
      endsAtS: lengthS,
      anomalyIds: ['a1'],
      startedDevices: [],
    },
  ];
  view.engine.elapsedS = 41;
  return view;
}

describe('Scenarios: the library', () => {
  it('shows the Lab switcher, the title and a card for each scenario, the one run last first', async () => {
    renderScenarios();
    await cardsShown();

    expect(screen.getByRole('heading', { level: 1, name: 'Scenarios' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scenarios' })).toHaveAttribute('aria-current', 'page');
    expect(names()).toEqual(['bad-afternoon', 'server-room-overheat', 'crowded-lecture']);
    expect(tab('All', 3)).toBeInTheDocument();
    expect(tab('Built-in', 2)).toBeInTheDocument();
    expect(tab('Custom', 1)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Scenarios pages' })).toHaveTextContent(
      'Scenarios 1–3 of 3, recently run first',
    );
  });

  it('says which files were not used, and why, and does not draw them as cards', async () => {
    renderScenarios();
    await cardsShown();
    expect(screen.getByText('1 scenario file was not used')).toBeInTheDocument();
    expect(screen.getByText('broken.json')).toBeInTheDocument();
    expect(names()).not.toContain('broken');
  });

  it('shows one page of six cards of 38 scenarios, with the counts of the tabs', async () => {
    renderScenarios({ library: library38() });
    await cardsShown();

    expect(names()).toEqual([
      'server-room-overheat',
      'crowded-lecture',
      'custom-01',
      'custom-02',
      'custom-03',
      'custom-04',
    ]);
    expect(tab('All', 38)).toBeInTheDocument();
    expect(tab('Built-in', 2)).toBeInTheDocument();
    expect(tab('Custom', 36)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Scenarios pages' })).toHaveTextContent(
      'Scenarios 1–6 of 38',
    );
    expect(screen.getByRole('button', { name: 'Page 7' })).toBeInTheDocument();
  });

  it('keeps the page in the address, so a reload opens the same page', async () => {
    const user = userEvent.setup();
    const first = renderScenarios({ library: library38() });
    await cardsShown();
    await user.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(address()).toBe('/lab/scenarios?page=2');
    expect(names()).toEqual([
      'custom-05',
      'custom-06',
      'custom-07',
      'custom-08',
      'custom-09',
      'custom-10',
    ]);

    first.unmount();
    renderScenarios({ library: library38(), path: '/lab/scenarios?page=2' });
    await cardsShown();
    expect(names()[0]).toBe('custom-05');
    expect(screen.getByRole('navigation', { name: 'Scenarios pages' })).toHaveTextContent(
      'Scenarios 7–12 of 38',
    );
  });

  it('changes the cards per page to 12 or 24, and goes back to the first page', async () => {
    const user = userEvent.setup();
    renderScenarios({ library: library38(), path: '/lab/scenarios?page=3' });
    await cardsShown();
    await user.selectOptions(screen.getByLabelText('Cards per page'), '12');
    expect(address()).toBe('/lab/scenarios?size=12');
    expect(names()).toHaveLength(12);
    expect(
      within(screen.getByLabelText('Cards per page'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['6', '12', '24']);
  });

  it('shows the custom scenarios on the Custom tab, with the tab in the address', async () => {
    const user = userEvent.setup();
    renderScenarios({ library: library38() });
    await cardsShown();
    await user.click(tab('Custom', 36));
    expect(address()).toBe('/lab/scenarios?tab=custom');
    expect(names()[0]).toBe('custom-01');
    expect(screen.getByRole('navigation', { name: 'Scenarios pages' })).toHaveTextContent(
      'Scenarios 1–6 of 36',
    );
  });

  it('finds a scenario by a device of its anomalies, and the counts follow the search', async () => {
    const user = userEvent.setup();
    renderScenarios();
    await cardsShown();
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a scenario by name, device or rule' }),
      'hub',
    );
    expect(names()).toEqual(['bad-afternoon']);
    expect(address()).toBe('/lab/scenarios?q=hub');
    expect(tab('All', 1)).toBeInTheDocument();
    expect(tab('Built-in', 0)).toBeInTheDocument();
    expect(tab('Custom', 1)).toBeInTheDocument();
  });

  it('finds a scenario by the rule it should raise', async () => {
    const user = userEvent.setup();
    renderScenarios();
    await cardsShown();
    await user.type(screen.getByRole('searchbox'), 'indoor-co2');
    expect(names()).toEqual(['crowded-lecture']);
  });

  it('says nothing matches, and clears the search and the tab on request', async () => {
    const user = userEvent.setup();
    renderScenarios();
    await cardsShown();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No scenario matches.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear the search and the tab' }));
    expect(address()).toBe('/lab/scenarios');
    expect(names()).toHaveLength(3);
  });

  it('sorts by name, and keeps the sort in the address', async () => {
    const user = userEvent.setup();
    renderScenarios();
    await cardsShown();
    await user.selectOptions(screen.getByLabelText('Sort'), 'name');
    expect(address()).toBe('/lab/scenarios?sort=name');
    expect(names()).toEqual(['bad-afternoon', 'crowded-lecture', 'server-room-overheat']);
    expect(screen.getByRole('navigation', { name: 'Scenarios pages' })).toHaveTextContent(
      'by name',
    );
  });
});

describe('Scenarios: states', () => {
  it('waits for the first message of the simulator, and reads nothing before it', async () => {
    const { simulator } = renderScenarios({ view: null });
    expect(
      screen.getByText('Waiting for the first message from the simulator…'),
    ).toBeInTheDocument();
    expect(simulator.callsTo('GET', '/api/scenarios')).toEqual([]);
  });

  it('dims the cards and says when the link was lost', async () => {
    const { container } = renderScenarios({ link: 'lost' });
    await cardsShown();
    expect(screen.getByText(/^Lost at/)).toBeInTheDocument();
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
  });

  it('says why the library could not be read, and reads again on request', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios({
      libraryFailure: { status: 502, message: 'The simulator cannot be reached' },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The scenarios could not be read. The simulator cannot be reached',
    );

    simulator.failLibrary(null);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await cardsShown();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the rules are not available on each card, and draws no chart', async () => {
    const library = fixtureLibrary();
    for (const scenario of library.scenarios) {
      scenario.expected = { available: false, reason: 'cannot read rules.json (ENOENT)' };
    }
    renderScenarios({ library });
    await cardsShown();
    expect(screen.getAllByText(/Expected alerts are not available/)).toHaveLength(3);
    expect(screen.queryAllByRole('img')).toEqual([]);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderScenarios();
    await cardsShown();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Scenarios: run and stop', () => {
  it('runs a scenario, tells it, shows Stop and the running chip, and reads the library again', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    await user.click(await screen.findByRole('button', { name: 'Run server-room-overheat' }));

    expect(await screen.findByText('Running server-room-overheat.')).toBeInTheDocument();
    const [run] = simulator.callsTo('POST', '/api/scenarios/server-room-overheat/run');
    expect(run?.body).toBeUndefined();
    const card = screen.getByRole('article', { name: 'server-room-overheat' });
    expect(
      within(card).getByRole('button', { name: 'Stop server-room-overheat' }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/^Running/)).toBeInTheDocument();
    await waitFor(() =>
      expect(simulator.callsTo('GET', '/api/scenarios').length).toBeGreaterThanOrEqual(2),
    );
  });

  it('tells which devices the run started', async () => {
    const user = userEvent.setup();
    renderScenarios();
    await user.click(await screen.findByRole('button', { name: 'Run bad-afternoon' }));
    expect(
      await screen.findByText('Running bad-afternoon. Started hub-power-01.'),
    ).toBeInTheDocument();
  });

  it('says what the simulator said when it refused a run, on the card', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    const run = await screen.findByRole('button', { name: 'Run server-room-overheat' });
    simulator.failRun({ status: 400, message: 'Unknown device "ghost-01"' });
    await user.click(run);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unknown device "ghost-01"');
    expect(
      within(screen.getByRole('article', { name: 'server-room-overheat' })).getByRole('alert'),
    ).toBe(alert);
  });

  it('stops a scenario that plays, tells it, and gives Run back', async () => {
    const user = userEvent.setup();
    const library = fixtureLibrary();
    library.scenarios[0]!.running = true;
    const { simulator } = renderScenarios({
      view: viewWithRun('server-room-overheat', 80),
      library,
    });
    await user.click(await screen.findByRole('button', { name: 'Stop server-room-overheat' }));

    expect(await screen.findByText('Stopped server-room-overheat.')).toBeInTheDocument();
    expect(simulator.callsTo('POST', '/api/scenarios/server-room-overheat/stop')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Run server-room-overheat' })).toBeInTheDocument();
  });

  it('dismisses what it told', async () => {
    const user = userEvent.setup();
    renderScenarios();
    await user.click(await screen.findByRole('button', { name: 'Run server-room-overheat' }));
    await screen.findByText('Running server-room-overheat.');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Running server-room-overheat.')).not.toBeInTheDocument();
  });
});

describe('Scenarios: replacing what is in the way', () => {
  const inTheWay = [
    { deviceId: 'dc-env-01', anomalyId: 'a1', runId: 'r9', scenario: 'crowded-lecture' },
  ];

  it('asks before it replaces, names what is in the way, and runs with replace when told to', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    simulator.conflicts.set('server-room-overheat', inTheWay);
    await user.click(await screen.findByRole('button', { name: 'Run server-room-overheat' }));

    const dialog = await screen.findByRole('dialog', { name: 'Replace what is running?' });
    expect(
      within(dialog).getByText('The run of crowded-lecture, on dc-env-01'),
    ).toBeInTheDocument();
    expect(simulator.callsTo('POST', '/api/scenarios/server-room-overheat/run')).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: 'Replace and run' }));

    expect(
      await screen.findByText('Running server-room-overheat. Replaced crowded-lecture.'),
    ).toBeInTheDocument();
    const runs = simulator.callsTo('POST', '/api/scenarios/server-room-overheat/run');
    expect(runs.map((call) => call.body)).toEqual([undefined, { replace: true }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names an anomaly that no run of Studio started', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    simulator.conflicts.set('server-room-overheat', [
      { deviceId: 'dc-env-01', anomalyId: 'a1', runId: null, scenario: null },
    ]);
    await user.click(await screen.findByRole('button', { name: 'Run server-room-overheat' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 anomaly that no run of Studio started');
    await user.click(within(dialog).getByRole('button', { name: 'Replace and run' }));
    expect(
      await screen.findByText(
        'Running server-room-overheat. Replaced 1 anomaly that no run of Studio started.',
      ),
    ).toBeInTheDocument();
  });

  it('changes nothing on Cancel', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    simulator.conflicts.set('server-room-overheat', inTheWay);
    await user.click(await screen.findByRole('button', { name: 'Run server-room-overheat' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(simulator.callsTo('POST', '/api/scenarios/server-room-overheat/run')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Run server-room-overheat' })).toBeInTheDocument();
  });

  it('cancels on Escape and gives the focus back to the button that asked', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    simulator.conflicts.set('server-room-overheat', inTheWay);
    await user.click(await screen.findByRole('button', { name: 'Run server-room-overheat' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Run server-room-overheat' })).toHaveFocus();
    expect(simulator.callsTo('POST', '/api/scenarios/server-room-overheat/run')).toHaveLength(1);
  });
});

describe('Scenarios: importing', () => {
  const document = (change: object = {}) => ({
    name: 'extra',
    description: 'Imported.',
    anomalies: [
      { deviceId: 'dc-env-02', metric: 'temperature_c', value: 30, startAt: 5, duration: 20 },
    ],
    ...change,
  });
  const choose = (file: File) =>
    fireEvent.change(screen.getByLabelText('Scenario file (JSON)'), { target: { files: [file] } });

  it('imports a file, tells it, and points at the new card', async () => {
    const { simulator } = renderScenarios();
    await cardsShown();
    choose(jsonFile('extra.json', JSON.stringify(document())));

    expect(await screen.findByText('Imported extra.')).toBeInTheDocument();
    await screen.findByRole('article', { name: 'extra' });
    // The router applies a navigation as a transition, which can land a moment after the library read that brings the
    // card: the card may be there before the address points at it, so the end state is waited for, not assumed.
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'extra' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      expect(address()).toBe('/lab/scenarios?scenario=extra');
    });
    expect(simulator.callsTo('POST', '/api/scenarios/import')[0]?.body).toEqual(document());
    expect(screen.queryByText(/No scenario is named/)).not.toBeInTheDocument();
  });

  it('shows the reason when the simulator refuses a value outside the range of the contract', async () => {
    renderScenarios();
    await cardsShown();
    choose(
      jsonFile(
        'hot.json',
        JSON.stringify(
          document({
            anomalies: [
              {
                deviceId: 'dc-env-02',
                metric: 'temperature_c',
                value: 900,
                startAt: 5,
                duration: 20,
              },
            ],
          }),
        ),
      ),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'hot.json was not imported: anomalies[0].value 900 is outside the range of temperature_c (-40 to 85 °C)',
    );
  });

  it('shows the reason when the name is taken', async () => {
    renderScenarios();
    await cardsShown();
    choose(jsonFile('again.json', JSON.stringify(document({ name: 'server-room-overheat' }))));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'again.json was not imported: a scenario named "server-room-overheat" already exists',
    );
  });

  it('refuses a file that is not JSON without sending it', async () => {
    const { simulator } = renderScenarios();
    await cardsShown();
    choose(jsonFile('nope.json', '{ nope'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nope.json was not imported: it is not valid JSON.',
    );
    expect(simulator.callsTo('POST', '/api/scenarios/import')).toEqual([]);
  });

  it('refuses a file over 16 KiB without sending it', async () => {
    const { simulator } = renderScenarios();
    await cardsShown();
    choose(jsonFile('big.json', JSON.stringify(document({ description: 'x'.repeat(17_000) }))));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'big.json was not imported: it is larger than 16 KiB.',
    );
    expect(simulator.callsTo('POST', '/api/scenarios/import')).toEqual([]);
  });
});

describe('Scenarios: a link that points at a scenario', () => {
  it('shows the page that holds it and marks its card', async () => {
    const user = userEvent.setup();
    renderScenarios({ library: library38(), path: '/lab/scenarios?scenario=custom-36' });
    const card = await screen.findByRole('article', { name: 'custom-36' });
    expect(card).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('navigation', { name: 'Scenarios pages' })).toHaveTextContent(
      'Scenarios 37–38 of 38',
    );

    // The mark is a pointer, not a filter: paging on drops it.
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(address()).toBe('/lab/scenarios?page=6');
  });

  it('says so when the tab hides the scenario, and shows it on request', async () => {
    const user = userEvent.setup();
    renderScenarios({
      library: library38(),
      path: '/lab/scenarios?scenario=custom-36&tab=built-in',
    });
    expect(await screen.findByText(/is not in this list/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show it' }));
    expect(address()).toBe('/lab/scenarios?scenario=custom-36');
    expect(await screen.findByRole('article', { name: 'custom-36' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('says so when there is no such scenario', async () => {
    const user = userEvent.setup();
    renderScenarios({ path: '/lab/scenarios?scenario=nope' });
    expect(await screen.findByText(/No scenario is named/)).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(address()).toBe('/lab/scenarios');
  });
});

describe('Scenarios: the editor’s commands', () => {
  it('ends the list with a card that starts a new scenario, on the last page only', async () => {
    renderScenarios();
    await cardsShown();
    expect(screen.getByRole('link', { name: /^New scenario/ })).toHaveAttribute(
      'href',
      '/lab/timeline',
    );
  });

  it('shows the new-scenario card on the last page of a long list and not on the others', async () => {
    const { unmount } = renderScenarios({ library: library38() });
    await cardsShown();
    expect(screen.queryByRole('link', { name: /^New scenario/ })).not.toBeInTheDocument();
    unmount();

    renderScenarios({ library: library38(), path: '/lab/scenarios?page=7' });
    await cardsShown();
    expect(screen.getByRole('link', { name: /^New scenario/ })).toBeInTheDocument();
  });

  it('asks before it deletes, deletes the scenario and its card, and tells it', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    await user.click(await screen.findByRole('button', { name: 'Delete bad-afternoon' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete bad-afternoon?' });
    expect(dialog).toHaveTextContent('removes bad-afternoon and its file');
    expect(simulator.callsTo('DELETE', '/api/scenarios/bad-afternoon')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Deleted bad-afternoon.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'bad-afternoon' })).not.toBeInTheDocument(),
    );
    expect(simulator.callsTo('DELETE', '/api/scenarios/bad-afternoon')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('changes nothing on Cancel or Escape, and gives the focus back to the Delete button', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    await user.click(await screen.findByRole('button', { name: 'Delete bad-afternoon' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete bad-afternoon' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete bad-afternoon' })).toHaveFocus();
    expect(simulator.callsTo('DELETE', '/api/scenarios/bad-afternoon')).toEqual([]);
  });

  it('says what the simulator said when it refuses to delete, on the card', async () => {
    const user = userEvent.setup();
    const { simulator } = renderScenarios();
    simulator.failDelete({ status: 500, message: 'cannot remove bad-afternoon.json (EACCES)' });
    await user.click(await screen.findByRole('button', { name: 'Delete bad-afternoon' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    const card = await screen.findByRole('article', { name: 'bad-afternoon' });
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'cannot remove bad-afternoon.json (EACCES)',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no Delete for a built-in scenario', async () => {
    renderScenarios();
    const card = await screen.findByRole('article', { name: 'server-room-overheat' });
    expect(within(card).queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    expect(
      within(card).getByRole('link', { name: 'Duplicate server-room-overheat' }),
    ).toBeInTheDocument();
  });
});
