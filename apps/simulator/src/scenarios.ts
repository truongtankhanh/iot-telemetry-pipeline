/**
 * Preset anomalies for `--scenario`, in the `--anomaly` format (`device:metric:value:startAt:duration`).
 * SIM-08 turns these into data; until then the CLI and the tests read them from here.
 */
export const SCENARIOS: Record<string, string[]> = {
  // Overheats row A for a minute, then recovers: opens and clears "Server room temperature high".
  'server-room-overheat': ['dc-env-01:temperature_c:29.2:20:60'],
  'crowded-lecture': ['lha-air-01:co2_ppm:1450:20:90'],
};
