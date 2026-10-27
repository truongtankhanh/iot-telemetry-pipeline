import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeviceInfo } from '../../api/types';
import type { BenchmarkStore } from '../../state/benchmarkStore';
import { runningBenchmark } from '../../state/benchmarkTestSupport';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import { fakeLabSimulator, labFleet, renderLab } from '../lab/labTestSupport';
import { installReactFlowStubs } from '../topology/topologyTestSupport';
import { TwinInject } from './TwinInject';

let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());
afterEach(() => vi.unstubAllGlobals());

const fleet = () => labFleet(6);
/** `d001`: a server room, the kind the temperature rule is for. */
const serverRoom = (): DeviceInfo => fleet().devices[0]!;

/** The card inside what it reads: a store holding the fleet, a router, and a fake simulator behind `fetch`. */
function renderCard(device: DeviceInfo = serverRoom(), benchmark?: BenchmarkStore) {
  const state = fleet();
  const simulator = fakeLabSimulator(structuredClone(state));
  vi.stubGlobal('fetch', simulator.fetch);
  const store = createStudioStore();
  store.getState().setLink('live', Date.now());
  store.getState().setView(structuredClone(state), Date.now());
  const result = render(
    <StudioProvider store={store} benchmark={benchmark}>
      <MemoryRouter initialEntries={['/twin']}>
        <TwinInject device={device} />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { ...result, simulator, store };
}

const injectButton = () => screen.getByRole('button', { name: 'Inject now' });
const anomaliesSent = (simulator: ReturnType<typeof fakeLabSimulator>) =>
  simulator.callsTo('POST', '/api/anomalies').map((call) => call.body);

describe('TwinInject: what the card shows', () => {
  it('names the device and starts from the Lab’s defaults: the rule’s value, 60 s, 20 s from now', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Inject at d001' })).toBeInTheDocument();
    expect(screen.getByLabelText('Value')).toHaveValue('29.2');
    expect(screen.getByLabelText('Duration')).toHaveValue('60');
    expect(screen.getByText('Starts in 20 s')).toBeInTheDocument();
    expect(screen.getByText('Breach temperature_c → 29.2 °C for 60 s')).toBeInTheDocument();
    expect(injectButton()).toBeEnabled();
  });

  it('draws the five chips of the frames, Breach on, and only Breach can be chosen', () => {
    renderCard();
    const chips = within(screen.getByRole('radiogroup', { name: 'Fault type' })).getAllByRole(
      'radio',
    );
    expect(chips.map((chip) => chip.closest('label')?.textContent)).toEqual([
      'Breach',
      'Silent',
      'Drop',
      'Delay',
      'Malformed',
    ]);
    expect(screen.getByRole('radio', { name: 'Breach' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Breach' })).toBeEnabled();
    for (const name of ['Silent', 'Drop', 'Delay', 'Malformed']) {
      expect(screen.getByRole('radio', { name }), name).toBeDisabled();
    }
  });

  it('says where the other kinds of fault are set, and links to the Faults page', () => {
    renderCard();
    expect(screen.getByText(/Only a breach is a timed fault/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Faults page' })).toHaveAttribute(
      'href',
      '/lab/faults',
    );
    // Each disabled chip is tied to that sentence for a screen reader.
    expect(screen.getByRole('radio', { name: 'Drop' })).toHaveAccessibleDescription(
      /Only a breach is a timed fault/,
    );
  });

  it('opens the Lab on this device, and says the typed values stay on the card', () => {
    renderCard();
    expect(screen.getByRole('link', { name: 'Open in lab' })).toHaveAttribute(
      'href',
      '/lab?target=d001',
    );
    expect(screen.getByText(/the values typed here stay here/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderCard();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('TwinInject: the form', () => {
  it('follows the value and the duration typed into it, in the sentence of what will be sent', async () => {
    const user = userEvent.setup();
    renderCard();
    const value = screen.getByLabelText('Value');
    await user.clear(value);
    await user.type(value, '31');
    const duration = screen.getByLabelText('Duration');
    await user.clear(duration);
    await user.type(duration, '45');
    expect(screen.getByText('Breach temperature_c → 31.0 °C for 45 s')).toBeInTheDocument();
  });

  it('cannot send a value outside the metric’s range, and says why in words', async () => {
    const user = userEvent.setup();
    const { simulator } = renderCard();
    const value = screen.getByLabelText('Value');
    await user.clear(value);
    await user.type(value, '500');
    expect(injectButton()).toBeDisabled();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Enter a value from -40 to 85 °C');
    await user.click(injectButton());
    expect(anomaliesSent(simulator)).toEqual([]);
  });

  it('cannot send a duration of zero, and says why in words', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.clear(screen.getByLabelText('Duration'));
    await user.type(screen.getByLabelText('Duration'), '0');
    expect(injectButton()).toBeDisabled();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(/Duration must be above 0 s/);
  });
});

describe('TwinInject: sending', () => {
  it('sends the breach the Lab would, on the engine’s clock, and tells the result in the live region', async () => {
    const user = userEvent.setup();
    const { simulator, store } = renderCard();
    await user.click(injectButton());

    expect(await screen.findByText('Injected 1 fault.')).toBeInTheDocument();
    // The fixture's engine clock is at 10 s, so 20 s from now is 30 s on it.
    expect(anomaliesSent(simulator)).toEqual([
      { deviceId: 'd001', metric: 'temperature_c', value: 29.2, startAt: 30, duration: 60 },
    ]);
    expect(store.getState().view?.engine.anomalies).toHaveLength(1);
    // The result sits in a live region that was already there, so it is announced.
    const regions = screen.getAllByRole('status');
    expect(regions.some((region) => region.textContent?.includes('Injected 1 fault.'))).toBe(true);
  });

  it('will not send again over a fault already on the device, and says which', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(injectButton());
    await screen.findByText('Injected 1 fault.');
    expect(injectButton()).toBeDisabled();
    expect(
      screen.getByText('d001 already has a fault on temperature_c from 20 s to 80 s from now'),
    ).toBeInTheDocument();
  });

  it('says what the simulator refused with, and lets the message be dismissed', async () => {
    const user = userEvent.setup();
    const { simulator } = renderCard();
    simulator.failAdd(() => ({ status: 409, message: 'The engine has too many faults' }));
    await user.click(injectButton());

    expect(await screen.findByText(/0 of 1 injected/)).toBeInTheDocument();
    expect(screen.getByText(/The engine has too many faults/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/0 of 1 injected/)).toBeNull();
    // Nothing was added, so the button is free to send again.
    expect(injectButton()).toBeEnabled();
  });

  it('says the engine’s clock could not be read, and sends nothing', async () => {
    const user = userEvent.setup();
    const { simulator } = renderCard();
    simulator.failState({ status: 503, message: 'Starting up' });
    await user.click(injectButton());
    expect(await screen.findByText(/The engine's clock could not be read/)).toBeInTheDocument();
    expect(anomaliesSent(simulator)).toEqual([]);
  });
});

describe('TwinInject: one path with the Lab (SIM-21 acceptance)', () => {
  it('sends exactly what the Lab sends for the same device and the same inputs', async () => {
    const user = userEvent.setup();

    // The Lab, on d001.
    const lab = renderLab({ path: '/lab?target=d001' });
    await user.click(screen.getByRole('button', { name: 'Inject now' }));
    await screen.findByText('Injected 1 fault.');
    const fromLab = anomaliesSent(lab.simulator);
    expect(fromLab).toHaveLength(1);
    lab.unmount();
    vi.unstubAllGlobals();

    // The twin's card, on the same device.
    const { simulator } = renderCard();
    await user.click(injectButton());
    await screen.findByText('Injected 1 fault.');

    expect(anomaliesSent(simulator)).toEqual(fromLab);
  });

  it('keeps the two the same when the value and the duration are changed in both', async () => {
    const user = userEvent.setup();

    const lab = renderLab({ path: '/lab?target=d001' });
    const labValue = screen.getByLabelText('Value');
    await user.clear(labValue);
    await user.type(labValue, '31');
    const labDuration = screen.getByLabelText('Duration');
    await user.clear(labDuration);
    await user.type(labDuration, '45');
    await user.click(screen.getByRole('button', { name: 'Inject now' }));
    await screen.findByText('Injected 1 fault.');
    const fromLab = anomaliesSent(lab.simulator);
    lab.unmount();
    vi.unstubAllGlobals();

    const { simulator } = renderCard();
    const value = screen.getByLabelText('Value');
    await user.clear(value);
    await user.type(value, '31');
    const duration = screen.getByLabelText('Duration');
    await user.clear(duration);
    await user.type(duration, '45');
    await user.click(injectButton());
    await screen.findByText('Injected 1 fault.');

    expect(fromLab).toEqual([
      { deviceId: 'd001', metric: 'temperature_c', value: 31, startAt: 30, duration: 45 },
    ]);
    expect(anomaliesSent(simulator)).toEqual(fromLab);
  });
});

describe('TwinInject while a benchmark runs', () => {
  it('turns Inject now off: an injection may start devices, which the simulator refuses', () => {
    renderCard(serverRoom(), runningBenchmark());
    expect(injectButton()).toBeDisabled();
  });

  it('keeps Inject now on when no benchmark runs', () => {
    renderCard();
    expect(injectButton()).toBeEnabled();
  });
});
