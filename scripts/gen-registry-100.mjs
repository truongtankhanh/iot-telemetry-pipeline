#!/usr/bin/env node
// Writes the 100-device registry that the Simulation lab's scale check uses (SIM-10):
//   apps/simulator/fixtures/devices-100/devices.json   100 devices in 20 zones
//   apps/simulator/fixtures/devices-100/rules.json     a copy of apps/ingest/config/rules.json
// Both are committed; `scripts/gen-registry-100.test.mjs` fails when they drift from this script or from ingest's rules.
// Run `node scripts/gen-registry-100.mjs` after changing the table below or ingest's `rules.json`. It starts no server
// and touches no database.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const ROOT = new URL('../', import.meta.url);
export const INGEST_CONFIG = new URL('apps/ingest/config/', ROOT);
export const FIXTURE_DIR = new URL('apps/simulator/fixtures/devices-100/', ROOT);

/** What a kind of device reports, and how its name and id are written. */
const KINDS = {
  server_room: {
    role: 'env',
    word: 'server room',
    metrics: ['temperature_c', 'humidity_pct'],
  },
  indoor_air: {
    role: 'air',
    word: 'air quality',
    metrics: ['co2_ppm', 'temperature_c', 'humidity_pct'],
  },
  power_meter: { role: 'power', word: 'power feed', metrics: ['power_kw'] },
};

const SE = 'server_room';
const IA = 'indoor_air';
const PM = 'power_meter';

/**
 * The 20 zones, in the order of the Lab's frame 19 for the first eight (14, 9, 6, 6, 8, 7, 8 and 5 devices: 63), then
 * twelve smaller ones that share the other 37. `mix` is how many devices of each kind the zone holds *in all*, the
 * devices of ingest's registry included. Three zones (`BLD-DC`, `BLD-LIB`, `BLD-LAB`) hold server rooms: the only kind
 * with a temperature rule, so "a breach on 12 devices in 3 zones" raises alerts with the real `rules.json`.
 *
 * Zone codes: the five of ingest's registry are the command center's. The other seven `BLD-` codes are the buildings
 * drawn in frame 14 of the design (twelve in all, as `digital-twin.md` counts) and are not checked against the command
 * center. The `SIM-Z` codes are invented here: the command center does not know them, so run without it.
 */
const ZONES = [
  { code: 'BLD-DC', label: 'Data center', prefix: 'dc', mix: [[SE, 14]] },
  {
    code: 'BLD-LIB',
    label: 'Library',
    prefix: 'lib',
    mix: [
      [IA, 5],
      [SE, 4],
    ],
  },
  { code: 'BLD-STU', label: 'Student center', prefix: 'stu', mix: [[IA, 6]] },
  {
    code: 'BLD-HUB',
    label: 'Innovation hub',
    prefix: 'hub',
    mix: [
      [PM, 4],
      [IA, 2],
    ],
  },
  { code: 'BLD-LHA', label: 'Lecture hall A', prefix: 'lha', mix: [[IA, 8]] },
  { code: 'SIM-Z01', label: 'Lecture hall B', prefix: 'lhb', mix: [[IA, 7]] },
  {
    code: 'BLD-LAB',
    label: 'Engineering lab',
    prefix: 'lab',
    mix: [
      [SE, 4],
      [IA, 4],
    ],
  },
  { code: 'BLD-SPORTS', label: 'Sports hall', prefix: 'spt', mix: [[IA, 5]] },
  {
    code: 'BLD-ADMIN',
    label: 'Administration',
    prefix: 'adm',
    mix: [
      [IA, 3],
      [PM, 1],
    ],
  },
  { code: 'BLD-DORA', label: 'Dormitory A', prefix: 'dra', mix: [[IA, 4]] },
  { code: 'BLD-DORB', label: 'Dormitory B', prefix: 'drb', mix: [[IA, 4]] },
  { code: 'BLD-CLINIC', label: 'Clinic', prefix: 'cli', mix: [[IA, 3]] },
  {
    code: 'BLD-SEC',
    label: 'Security office',
    prefix: 'sec',
    mix: [
      [IA, 2],
      [PM, 1],
    ],
  },
  { code: 'SIM-Z02', label: 'Cafeteria', prefix: 'caf', mix: [[IA, 3]] },
  {
    code: 'SIM-Z03',
    label: 'Workshop',
    prefix: 'wsh',
    mix: [
      [IA, 2],
      [PM, 1],
    ],
  },
  { code: 'SIM-Z04', label: 'Parking deck', prefix: 'prk', mix: [[PM, 3]] },
  { code: 'SIM-Z05', label: 'Gatehouse', prefix: 'gat', mix: [[IA, 3]] },
  { code: 'SIM-Z06', label: 'Greenhouse', prefix: 'grn', mix: [[IA, 3]] },
  { code: 'SIM-Z07', label: 'Auditorium', prefix: 'aud', mix: [[IA, 2]] },
  { code: 'SIM-Z08', label: 'Pump house', prefix: 'pmp', mix: [[PM, 2]] },
];

const pad = (n) => String(n).padStart(2, '0');

/**
 * The registry: the devices of ingest's `devices.json` first, unchanged, then the others up to each zone's mix. No
 * randomness and no clock, so the output is a function of this file and of `originals`.
 */
export function buildRegistry(originals) {
  const devices = originals.map((device) => ({ ...device }));
  const taken = new Set(devices.map((device) => device.id));
  for (const zone of ZONES) {
    for (const [kind, count] of zone.mix) {
      const { role, word, metrics } = KINDS[kind];
      const have = devices.filter((d) => d.zoneCode === zone.code && d.kind === kind).length;
      for (let n = have + 1; n <= count; n++) {
        const id = `${zone.prefix}-${role}-${pad(n)}`;
        if (taken.has(id)) throw new Error(`gen-registry-100: the id "${id}" is already used`);
        taken.add(id);
        devices.push({
          id,
          kind,
          zoneCode: zone.code,
          name: `${zone.label} — ${word} ${pad(n)}`,
          metrics: [...metrics],
        });
      }
    }
  }
  return {
    $comment:
      'Generated by scripts/gen-registry-100.mjs; do not edit by hand. 100 devices in 20 zones for the Simulation lab scale check (SIM-10). ' +
      "The first six are apps/ingest/config/devices.json. BLD- zones are the command center's or the buildings of the design's twin; " +
      'SIM-Z zones are invented and unknown to the command center.',
    devices,
  };
}

export const ZONE_TABLE = ZONES;

/** The two files, as text: `devices.json` through Prettier with the repository's config, `rules.json` byte for byte. */
export async function renderFiles() {
  const originals = JSON.parse(
    readFileSync(new URL('devices.json', INGEST_CONFIG), 'utf8'),
  ).devices;
  const path = fileURLToPath(new URL('devices.json', FIXTURE_DIR));
  const config = (await resolveConfig(path)) ?? {};
  const devices = await format(JSON.stringify(buildRegistry(originals)), {
    ...config,
    filepath: path,
  });
  const rules = readFileSync(new URL('rules.json', INGEST_CONFIG), 'utf8');
  return { 'devices.json': devices, 'rules.json': rules };
}

async function main() {
  const files = await renderFiles();
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(new URL(name, FIXTURE_DIR), text);
    console.log(`wrote apps/simulator/fixtures/devices-100/${name}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
