# Digital twin control room — research and proposal

Status: **approach approved** (SIM-01, revision 3, 2026-10-19); the SIM-17 spike ended on 2026-10-26 in a **conditional go** (chunk 244,876 bytes of 350,000; frame time still to be measured on the reference laptop: [ADR-0012](../../adr/0012-simulator-studio-digital-twin.md#amendment-2026-10-26-the-sim-17-spike-conditional-go)). SIM-18 built the campus scene the same day ([ADR-0012](../../adr/0012-simulator-studio-digital-twin.md#amendment-2026-10-26-sim-18-the-campus-scene): built and unit-tested; the scene chunk is 246,489 bytes of 350,000; the frame time is 60 fps with no late frame on an M3 Pro but not yet measured on the reference laptop).
Frames: 14 campus, 15 building, 16 loading and
fallback, in [mockups/](mockups/). Decision: [ADR-0012](../../adr/0012-simulator-studio-digital-twin.md). This page
extends the [brief](brief.md), whose revision 2 deferred the 3D view.

> **V1, demo only — not for production.** The twin is a view of the simulation. It adds no authentication and no
> new control path.

## The question

Can Studio become a **digital twin control room**: the simulated campus in 3D, with the devices where they stand, the
data leaving them, the faults landing on them, and the controls to cause those faults, on one screen?

The command center is already building a 3D twin. So the question is also whether Studio should build one at all.

## What exists

Facts from the other repositories are attributed; this repository does not check them.

| Finding                                                                                                                                                                                                                                                                                       | Source                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| The command center renders its twin with three.js and React Three Fiber in one lazy chunk, budget 350 KB gzipped; a bare R3F canvas with the helpers it uses measured 307,060 bytes (2026-10-16).                                                                                             | ops-command-center ADR-0020                                           |
| The twin is gated: until its V2-19.8 it shows only in a development build or with `?twin=1`, so operators do not see it yet.                                                                                                                                                                  | ops-command-center ADR-0020 (Capability check)                        |
| Scene conventions: metres east-north-up from the site centre, three.js `x` east, `y` up, `z` −north; buildings extruded from the zone footprint (zone inset by 8 m) to `heightM`; one neutral material; no shadow maps; DOM labels.                                                           | ADR-0017, ADR-0020                                                    |
| Four levels (campus, building, asset, part), picking by BVH raycast, hover tooltip after 150 ms, an Escape ladder, a fallback to the 2D map without WebGL 2.                                                                                                                                  | ADR-0020 (V2-15.1)                                                    |
| Implemented so far: a `twin/` folder of scene components, tests and styles in the console, and `src/lib/twin*.ts` pure helpers; recent commits are building focus (V2-15.8, 15.9). The heat overlay (V2-17), incident beacons (V2-16) and the video wall are named in ADR-0020 as later work. | Repository history, 2026-10-19; ADR-0020                              |
| Models exist for two asset classes only (cooling tower, standby generator). Anything else is drawn as a box.                                                                                                                                                                                  | `ops/models/`                                                         |
| The campus is data: 20 zones (12 buildings) with `at` and `size` in metres from the centre and `heightM` for buildings, and assets with `at` and `elevationM`. Nine indoor climate sensors stand at building centres, marked unverified.                                                      | `apps/api/src/database/seed/campus.ts`, `assets.ts`                   |
| Consoles are meant to talk only to the command center's API; the pipeline's stream reaches them through it.                                                                                                                                                                                   | [ADR-0007](../../adr/0007-pipeline-as-the-single-telemetry-source.md) |
| Studio has six devices in five zones whose codes equal the command center's (`BLD-DC`, `BLD-LIB`, `BLD-LHA`, `BLD-STU`, `BLD-HUB`). **None has a position.**                                                                                                                                  | [devices.json](../../../apps/ingest/config/devices.json)              |

Two consequences shape everything below. First, a 3D campus already exists and is mature in its conventions, so
Studio's twin should not invent its own. Second, the data a twin needs, positions, is not in Studio's registry yet.

### The command center's catalogue

Checked against the seed on 2026-10-19 (`apps/api/src/database/seed/assets.ts`, `campus.ts`; this repository does not
check it). The catalogue is larger than what Studio simulates today.

| Count | What                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20    | Zones: 12 buildings, 2 gates, 2 parking areas, the lawn, the sports field, the utility plant and the lake                                                                                                                                                 |
| 31    | Assets: 22 equipment and 9 indoor climate sensors                                                                                                                                                                                                         |
| 16    | Asset classes: indoor climate 9, air handler 3, lift 3, cooling tower 2, precision cooling 2, barrier arm 2, and one each of standby generator, UPS, UPS battery, transformer, switchgear, chiller, booster pump, fume hood, gas detector and leak sensor |
| 9     | Assets drawn at campus level, as the command center draws them (outdoor and roof): CT-01, CT-02, GEN-01, TR-01, SWG-01, CH-01, BAR-01, BAR-02, AHU-H1                                                                                                     |
| 22    | Assets that appear only with their building in focus (the rest, including all nine sensors)                                                                                                                                                               |
| 8     | Assets in the Data Center: CT-01, CT-02, GEN-01, UPS-01, BAT-01, CRAC-01, CRAC-02, ICS-DC                                                                                                                                                                 |

Studio's six devices are **not** these assets: their ids differ (`dc-env-01`, not `ICS-DC`) and no mapping exists until
[V2-T01](../../tasks/v2/V2-T01-asset-catalogue-sync.md) and [V2-T05](../../tasks/v2/V2-T05-simulator-replaces-occ-telemetry-sim.md)
land. The twin therefore draws the catalogue as dim, dashed markers labelled _not simulated_, at the command center's
positions, so the campus is complete and the gap to V2 is visible rather than hidden.

## What a twin adds to a simulation demo

Studio already shows cause and consequence as a graph (Topology). A twin adds three things a graph cannot:

1. **Where.** "The server room overheats" lands on a building the audience can point at, next to the library and the
   lecture hall, not on a node called `dc-env-01`.
2. **Spread.** Which buildings are healthy, which are not reporting, and how the data leaves each one.
3. **Action at the place.** Select the building, inject the fault there, watch it happen there.

Everything else is already in Studio. So the twin is a view over the same state, not a second source of truth: every
number in it is also on Fleet, Topology or Alerts.

## Options

| #   | Option                                                                       | Gains                                                                                                | Costs and risks                                                                                                                                                                                                                              | Verdict                                            |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A   | Do not build one; show the command center's twin beside Studio (two windows) | Nothing to build or maintain. After the command center's V3 its twin shows the pipeline's telemetry. | Needs the command center running and signed in; its twin is behind a preview gate; cannot inject from it; two tools to drive in a demo.                                                                                                      | Keep as the **interim** and as the operator view   |
| B   | Embed the command center's twin in Studio (iframe)                           | One twin.                                                                                            | Needs an embed mode, framing and cookie changes in the command center and a sign-in; selection and injection would cross a `postMessage` boundary; Studio stops working alone.                                                               | Rejected                                           |
| C   | **A lean three.js scene in Studio on the command center's conventions**      | Standalone; click-to-inject; shows cause at device level; can fall back to Topology.                 | A second twin to maintain; a three.js dependency and a lazy chunk; positions must be added; far less work than the command center's twin (no models, no parts, no levels below a building, no BVH), but not measured: the spike measures it. | **Recommended**, behind a spike with exit criteria |
| D   | An isometric SVG or Canvas 2D scene, no three.js                             | No WebGL, no dependency, reuses the Topology drawing code.                                           | Fixed camera; a visibly lesser "3D"; rebuilt if real 3D is wanted later.                                                                                                                                                                     | Fallback if C fails its spike                      |
| E   | Extract the command center's twin into a shared package used by both         | One implementation; the right end state.                                                             | The command center's twin is not finished; the repositories share no package mechanism; a cross-repository change set.                                                                                                                       | Plan for it; not possible now                      |

The frames draw option D's way (an orthographic stand-in, as the command center's own mockups do); the WebGL scene
in C replaces it without changing layout, labels or panels.

## Recommendation

Build **C**, in the smallest form that earns the name, and write it so that **E** is a mechanical move later:

- Share **conventions**, not code: east-north-up metres, the footprint rule, the neutral material and its three face
  shades, the camera limits, the budgets, the word for each state.
- Keep everything that imports three.js under one folder and every calculation in pure functions beside it, as the
  command center does, so the folder can become a package.
- **Start with a spike** (SIM-17) that has exit criteria: the lazy chunk under the command center's 350 KB budget,
  the frame budget met on the command center's reference laptop, and the layout contract working. If any fails,
  fall back to **D** and say so in the ADR.
- Treat **A** as the answer for anyone who wants the operator's view: the guided demo can name it as a second
  screen.

Sếp confirmed this approach on 2026-10-19 (see [Decisions](#decisions)).

## Design

### Concept

A page, **Digital twin** (`/twin`), reached from the navigation and from a _Topology | Twin_ switch on Topology, the
Overview and the Lab canvas. It shows the campus in 3D with:

- the **buildings** the zones describe, neutral until something happens in them,
- a **pin** above each building for every device in it, shaped by the device kind (rounded square, circle, hexagon,
  as on Fleet and Topology) with the kind's glyph on its label,
- **neon arcs** (halo, core and moving pulse, as on Topology; dim and dashed when a device is silent) from each pin to a
  floating, dashed **Pipeline** hub that stands for broker and ingest and is labelled
  _logical_: the pipeline has no place on the campus and the twin does not pretend it has,
- a **beacon** on a pin while an alert it raised is open,
- the same **simulation controls** and **event timeline** as the Overview below the scene.

### Frames

| Frame                   | Shows                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14 Campus control room  | The whole campus, the Data Center selected and in alarm, a building inspector, "inject at" for the selected device, simulation controls, timeline |
| 15 Building focus       | The Data Center with see-through walls and a heat floor, two devices in Row A and Row B, the device inspector with the rule thresholds            |
| 16 Loading and fallback | The flat plan with live pins while the 3D code loads, the conditions under which the twin is not drawn, and the fallback banner                   |

### Layers and states

Layers: **Devices**, **Data flow**, **Alerts**, **Catalogue** (the command center's assets, dim and dashed, not simulated), **Heat**, and labels. Heat uses the command center's sequential ramp in
one hue, never red or orange.

| Device state          | Pin                                                       | Arc                    | Building rim (worst device wins)           |
| --------------------- | --------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| Healthy               | Green ring                                                | Indigo line, dots move | Green hairline                             |
| Anomaly (off-range)   | Amber ring                                                | Amber line, dots move  | Amber                                      |
| Alert open            | Amber ring, pulsing beacon in the alert's severity colour | Amber                  | Amber                                      |
| Paused, silent        | Grey dashed ring                                          | Grey dashed, no dots   | Grey dashed                                |
| Down (ingest, broker) | Red cross on the hub                                      | Red dashed             | Unchanged: the buildings did nothing wrong |
| Selected              | Indigo ring                                               | —                      | Indigo outline                             |

### What each fault looks like

The twin makes a fault visible where it lands. Each row is drawn from engine state, never on a loop of its own.

| Fault            | On the scene                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Threshold breach | The pin and rim turn amber; when the rule fires a beacon pulses and the alert chip appears on the label |
| Silent           | The pin goes grey and dashed, its arc stops, the label shows the age of the last value                  |
| Drop             | The arc's dots thin out, with gaps; a gap counter chip appears at the hub                               |
| Delay            | Dots travel slower, so they bunch at the hub; the lag figure on the hub rises                           |
| Duplicate        | Dots travel in pairs; the readings counter on the hub does not move                                     |
| Malformed        | A small cross appears at the hub and a reason chip names why it was rejected                            |
| Burst            | A short stream of dots, capped, then the arc settles                                                    |
| Link loss        | Every arc turns red and dashed; dots stop at the pins; the Pipeline hub shows "no link"                 |

### Interaction

- **Camera:** damped orbit, zoom to the cursor, pan; tilt between 20° and 78° from vertical; the target stays inside
  the boundary plus 40 m. Presets _Campus_, _Building_, _Top_ fly in 600 ms, instantly under reduced motion (SIM-18 builds _Campus_ and
  _Top_, which is 20° from vertical, the steepest the tilt limit allows; _Building_ arrives with SIM-20). The view
  never moves by itself, except where a guided-demo step says to.
- **Hover** shows a tooltip after 150 ms. **Click** a building to focus it, a pin to inspect the device. **Escape**
  climbs one level (device, building, campus) and never leaves the twin; **Home** returns to the campus. The selection is
  in the address with the Topology's keys, `device` and `zone`, so the _Topology | Twin_ switch carries it.
- **Inject here** posts the same command as the Lab; there is one way to inject, not two.
- **Neon arcs in WebGL** are line meshes with an additive halo and a moving pulse, not a full-screen bloom pass: a bloom
  pass costs more than six arcs justify and would glow the buildings too. SIM-17 measures the cost.
- **Keyboard and screen readers:** the scene is an image with a text alternative, and a visually hidden list of the
  devices follows it with the same names and states as Fleet. Nothing is discoverable only in 3D.

### Data

Positions come from a Studio-owned file, `apps/simulator/config/twin-layout.json`, until the command center's catalogue
supplies them ([V2-T01](../../tasks/v2/V2-T01-asset-catalogue-sync.md)):

```json
{
  "source": {
    "repository": "ops-command-center",
    "commit": "4b4fe02cd3a85698d462521fe1404a31ec5b3680",
    "files": ["apps/api/src/database/seed/campus.ts", "apps/api/src/database/seed/assets.ts"],
    "checkedOn": "2026-10-26"
  },
  "siteCenter": [108.4415, 11.953],
  "boundary": { "west": -282, "east": 228, "south": -277, "north": 247, "radius": 18 },
  "zones": [
    {
      "code": "BLD-DC",
      "name": "Data Center",
      "kind": "building",
      "use": "data_center",
      "at": [175, 40],
      "size": [60, 46],
      "heightM": 14
    }
  ],
  "devices": [
    {
      "id": "dc-env-01",
      "zone": "BLD-DC",
      "at": [170, 33],
      "elevationM": 0,
      "placement": "illustrative"
    }
  ],
  "catalogue": [
    {
      "code": "UPS-01",
      "class": "ups",
      "zone": "BLD-DC",
      "at": [164.5, 29.7],
      "elevationM": 0,
      "simulated": false
    }
  ]
}
```

- `zones` copies the command center's seed values for its 20 zones (a building also has its `use` and `heightM`), `boundary`
  its site boundary, and `catalogue` its 31 assets (`simulated: false` until V2-T05), in its convention (metres east and
  north of the centre). It can drift; the file states its source (`source`: repository, commit, files and the day it was
  compared), and a test checks that every device's `zone` exists in it and in `devices.json`.
- The simulator reads the file once at start and the UI gets it from `GET /api/twin-layout`, which answers the layout and a
  `placement` of the registry the simulator runs with: the devices it places, the ones it does not (each with the reason) and
  any it places that the registry does not have. A device with no position is reported, never dropped; with the 100-device
  registry 94 are unplaced by design. A file that cannot be used is a `200` with `available: false` and the reason, and the
  twin falls back to Topology. See the [simulator README](../../../apps/simulator/README.md#configuration).
- `devices[].placement` is `illustrative` (placed by hand inside the zone) or `surveyed`. The inspector says which. The
  frames' Row A and Row B are `illustrative`: nothing in the data says where a server row stands.
- The heat floor is interpolated between sensors and labelled so. It is a drawing aid, not a measurement.

### Performance and tests

- One lazy chunk, loaded only on `/twin`; budget 350 KB gzipped as in the command center, **to be confirmed by the
  spike**, not assumed. A device without WebGL 2 never downloads it.
- Demand rendering, pixel ratio at most 1.5, no shadow maps, one merged mesh for building shells. Six devices at
  0.5 Hz each need no worker and no transferable buffer; the command center's reasons for them (hundreds of points
  at 60 FPS) do not apply, and the design says so instead of copying them.
- Frame budget measured on the command center's reference laptop (Core i5-1235U, Iris Xe, Chrome): p95 at most
  14 ms.
- jsdom has no WebGL, so tests cover the pure functions (layout parsing, projection, state derivation) and the
  panels; the scene is checked against a written manual list on the reference laptop.

## Risks

| Risk                                                       | Containment                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A second twin drifts from the command center's             | Same conventions, written down; code in one folder with pure helpers; extraction (E) planned; a review at the command center's V3 |
| Effort grows toward the command center's own twin          | Scope is buildings, pins and arcs. No models, parts, levels beyond building, BVH or worker. The spike has exit criteria           |
| Positions are guesses                                      | `placement` is explicit and shown; replaced when V2-T01 provides a catalogue                                                      |
| A demo machine cannot draw it                              | Topology is the fallback and shows every value; the loading state keeps pins live                                                 |
| The twin looks more certain than the data                  | Pipeline hub drawn as logical; heat floor labelled interpolated; stale values show their age                                      |
| Studio's look and the command center's differ side by side | Already accepted in [ADR-0011](../../adr/0011-simulator-studio-control-plane.md); the materials are the command center's          |

## Tickets

See [implementation-order.md](implementation-order.md), phase 5: SIM-17 (spike and layout contract) through SIM-21
(guided-demo camera). The approach is confirmed; SIM-17 can start once the shell (SIM-04) and Topology (SIM-06) exist.

## Decisions

Taken by Sếp on 2026-10-19, following the recommendation:

1. **Option C with a spike.** Studio builds its own lean scene; option A (the command center's twin on a second screen)
   stays the interim and the operator's view.
2. **Placement.** The six devices are hand-placed and marked `illustrative`; they are replaced by surveyed or catalogue
   positions when those exist.
3. **The Pipeline hub** is drawn as a floating, dashed, logical object. The broker is not placed in a building.
