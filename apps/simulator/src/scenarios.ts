import type { ScenarioDocument } from './scenario-document.ts';

/**
 * The scenarios that ship with the simulator, as the same documents a custom scenario is written in. The CLI's
 * `--scenario`, the control API and Studio all read them through the `ScenarioLibrary`. Times are seconds from
 * the start of the scenario.
 */
export const BUILT_IN_SCENARIOS: ScenarioDocument[] = [
  {
    name: 'server-room-overheat',
    // Overheats row A for a minute, then recovers: opens and clears "Server room temperature high".
    description: 'Row A runs hot for a minute, then recovers.',
    anomalies: [
      { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
    ],
  },
  {
    name: 'crowded-lecture',
    description: 'Lecture Hall A fills up and CO₂ climbs.',
    anomalies: [
      { deviceId: 'lha-air-01', metric: 'co2_ppm', value: 1450, startAt: 20, duration: 90 },
    ],
  },
];
