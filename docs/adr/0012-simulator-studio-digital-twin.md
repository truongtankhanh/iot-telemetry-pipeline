# ADR-0012: Studio's digital twin is a lean three.js scene on the command center's conventions

- **Status:** Accepted 2026-10-19 as the approach; **go or no-go is decided by the SIM-17 spike** (see [digital-twin.md](../design/simulator/digital-twin.md)). Confirmed with it: hand-placed `illustrative` positions, and the Pipeline hub drawn as a floating logical object.
- **Date:** 2026-10-19
- **Amended 2026-10-26:** the SIM-17 spike ended in a **conditional go** (see [the amendment](#amendment-2026-10-26-the-sim-17-spike-conditional-go)).
- **Amended 2026-10-26 (SIM-18):** the campus scene is built on that go, which stays **conditional** (see [the second amendment](#amendment-2026-10-26-sim-18-the-campus-scene)).
- **Amended 2026-10-26 (SIM-19):** the data flow, the alert beacons and the fault visuals are built; the condition stays (see [the third amendment](#amendment-2026-10-26-sim-19-data-flow-beacons-and-fault-visuals)).

## Context

[ADR-0011](0011-simulator-studio-control-plane.md) deferred a 3D view of the simulated campus because
ops-command-center builds its own twin (its ADR-0017, ADR-0018 and ADR-0020; this repository does not check them).
The design review then asked for a "digital twin control room". The research is in
[digital-twin.md](../design/simulator/digital-twin.md); the facts that decide this ADR are:

- The command center's twin is mature in its conventions (east-north-up metres from the site centre, footprints
  inset by 8 m, one neutral material, DOM labels, a WebGL 2 check with a fallback) but is gated to development
  builds until its V2-19.8, and cannot take a fault injection.
- Studio has six devices in five zones whose codes equal the command center's, and no positions for them.
- Studio already has a 2D fallback that shows every value: Topology.

## Decision

1. **Studio gets a `/twin` page that draws the campus in 3D with three.js and React Three Fiber**, in its own lazily
   loaded chunk, behind a WebGL 2 check that falls back to Topology.
2. **The scene shares conventions, not code, with the command center:** axes, units, footprint rule, the material and
   its three face shades, camera limits, the budgets, and the names of the states.
3. **Scope is a campus of extruded buildings, device pins, data arcs to a logical Pipeline hub, alert beacons, a
   building focus level and a heat floor.** No models, no parts, no levels below a building, no BVH, no worker.
4. **Positions come from `apps/simulator/config/twin-layout.json`** (zones copied from the command center's seed,
   devices placed by hand and marked `illustrative`) until the command center's catalogue supplies them (V2-T01).
5. **Injection from the scene uses the Lab's command.** There is one way to inject.
6. **Code is arranged for extraction:** everything that imports three.js lives under one folder, everything else in
   pure functions beside it.
7. **A spike (SIM-17) decides whether to continue.** Exit criteria: the lazy chunk within the command center's
   350 KB gzipped budget, the frame budget (p95 at most 14 ms) met on its reference laptop, and the layout contract
   working. If one fails, Studio falls back to an isometric 2D scene (option D in the research) and this ADR is
   amended.

## Alternatives considered

| Option                                          | Why not                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rely on the command center's twin (two windows) | Costs nothing and stays the interim answer, but Studio then has no 3D view of its own, cannot inject from the scene, and depends on a gated feature. |
| Embed the command center's twin                 | Needs an embed mode, framing and sign-in changes there, a message channel for selection, and Studio would stop working alone.                        |
| Isometric SVG or Canvas 2D                      | Cheaper and works without WebGL, but the camera is fixed and it would be rebuilt if real 3D is wanted; kept as the fallback if the spike fails.      |
| A shared twin package now                       | The right end state, but the command center's twin is unfinished and the repositories share no package mechanism.                                    |
| The broker drawn inside a building              | It would imply a place that does not exist; the hub is drawn dashed and labelled logical.                                                            |

## Consequences

- A second twin exists to maintain. Drift is contained by shared conventions and by planning extraction when the
  command center's twin is complete; it is reviewed at that command center's V3.
- A new dependency pair (three, React Three Fiber) enters the Studio UI package, in a lazy chunk only; the 2D pages
  never download it. Licences and sizes are recorded in SIM-17.
- A new config file holds positions. Until a catalogue replaces it, the placement of every device is a guess and the
  UI says so.
- The Pipeline hub, the heat floor and the Row A and Row B areas are drawing aids. They are labelled as logical,
  interpolated and illustrative so the twin never looks more certain than the data.
- The scene cannot be run under jsdom. Tests cover the pure functions and the panels; the scene has a manual list on
  the reference laptop.

## Amendment, 2026-10-26: the SIM-17 spike, conditional go

**Verdict: conditional go.** The lazy chunk is well inside its budget, the layout contract works and every fallback behaves. The frame criterion was **not measured on the
reference laptop** (Core i5-1235U, Iris Xe, Chrome), so this is not a pass of every exit criterion of decision 7; it was measured on a much faster machine and showed no
problem. The twin goes on to SIM-18 **on this condition**: the frame time is measured on the reference laptop before SIM-18 is closed, and recorded here in a new dated
section. If its p95 is above 14 ms, or the chunk goes over 350,000 bytes with SIM-18's additions, Studio falls back to the isometric 2D scene (option D), as decision 7 says.
The decision to go on without that number was taken by Sếp on 2026-10-26.

### What the spike built

`/twin` is a lazy page (`apps/simulator-ui/src/pages/twin/`). It asks the browser for a WebGL 2 context, reads `GET /api/twin-layout` (the layout file of SIM-17-sim) and only then requests the
scene, a chunk of its own that holds three.js and React Three Fiber (`apps/simulator-ui/src/twin/`, the only folder that imports either). The scene draws the ground inside the site boundary, the
boundary and the 12 buildings extruded from their footprints (the zone inset by 8 m) with the command center's axes (three.js `x` east, `y` up, `z` minus north) and colours, lit by a hemisphere
light and a directional light, on a canvas that draws on demand (`frameloop="demand"`, pixel ratio at most 1.5, no shadow maps), with three's `OrbitControls` limited to a tilt of 20° to 78° from
vertical, a distance of 60 to 900 m and a target inside the boundary plus 40 m. Every calculation is a pure function in `apps/simulator-ui/src/lib/twin*.ts` and `webgl.ts`. No pins, arcs, beacons,
labels, building focus, heat floor or injection: those are SIM-18 to SIM-21. Measured on the working tree of the branch `feat/sim-17-twin-spike` on top of `1d40ec3`; the UI half was not committed
when this was written, so there is no commit hash for the measured code.

### Exit criteria

| Criterion                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy chunk within 350 KB gzipped                         | **Pass: 244,876 bytes**, 105,124 under 350,000 (and 130,124 under the command center's amended 375,000). Method below.                                                                                                                                                                                                                                                                                                                                                                 |
| Frame budget (p95 at most 14 ms) on the reference laptop | **Not measured on it.** Measured on an Apple M3 Pro: no late frame; see below. This is the open condition.                                                                                                                                                                                                                                                                                                                                                                             |
| Layout contract working                                  | **Pass.** `GET /api/twin-layout` answers the layout and a `placement` of the registry; with the default registry 6 of 6 devices are placed, with the 100-device registry 6 are placed and 94 reported as not placed, none dropped (tests in `apps/simulator`). The page names any device that is not placed. An unusable layout, a simulator without the route, no WebGL 2 and a lost context each show the fallback to Topology with the reason, and none of them requests the scene. |
| The chunk is not requested except on `/twin`             | **Pass.** Observed in a browser (below) and from the build.                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Chunk size.** Counted as the command center counts its twin chunk (ADR-0020, V2-12.3, which this repository does not check): zlib level 9, the scene chunk's `.js` and `.css` and the chunks only it imports,
1 KB = 1,000 bytes. The scene chunk `assets/TwinScene-CN8aCayz.js` is 936,142 bytes raw and **244,876 bytes** gzipped; it has no stylesheet and no chunk that only it imports. For comparison, the phase file's
`gzip -c` (level 6, the `.js` alone) gives 245,735 bytes and Vite's own report 247.68 kB. The page chunk (`Twin-TiCcrDTx.js` and its `.css`) is separate and about 3.2 kB gzipped by Vite's figures, so the page and
the scene together are about 248 kB. For scale: the command center measured an empty React Three Fiber canvas at 238,918 bytes and 307,060 with `CameraControls`, `Bvh` and the model loaders (2026-10-16, its ADR-0020);
this scene has `OrbitControls` only and no loader. Measured on 2026-10-26 with Vite 8.3.4, three 0.186.1 and @react-three/fiber 9.8.2, from `vite build --manifest` and a one-off script that is not kept in
the repository. A chunk's size does not depend on the machine.

**Frame time.** Measured on **Sếp's MacBook Pro (`Mac15,7`, Apple M3 Pro, 18 GB, on AC power)**, which is **not** the reference laptop, with headless Chrome 155.0.8059.86 driven through the DevTools protocol by a
one-off script (not kept in the repository), on 2026-10-26 between 11:54 and 11:57 (+07), viewport 1920 × 1080 at device pixel ratio 1, WebGL on a real GPU (`ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)`, WebGL 2.0),
devices at rest. The machine was **not idle**: its one-minute load average was 4.2 at the start and 15.0 at the end, with Sếp's other processes running. The page's `requestAnimationFrame` was sampled during 5 s with no
input, 10 s of synthetic orbit (the left button on a looping path, about 60 events a second) and 10 s of synthetic zoom (the wheel, in and out, at the cursor):

| Phase | Frames | Frame interval p50 / p95 / p99 / max (ms) | Frames over 25 ms | Main-thread time of the animation-frame callbacks p50 / p95 / p99 / max (ms) |
| ----- | ------ | ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| idle  | 300    | 16.7 / 16.8 / 16.8 / 16.8                 | 0                 | none: the demand loop draws nothing                                          |
| orbit | 604    | 16.7 / 16.8 / 16.8 / 16.8                 | 0                 | 0.1 / 0.2 / 0.6 / 1.0                                                        |
| zoom  | 602    | 16.7 / 16.8 / 16.8 / 16.8                 | 0                 | 0.1 / 0.2 / 0.3 / 0.7                                                        |

The interval stayed on the 60 Hz of the display throughout: no late frame. The scene's main-thread cost per drawn frame is about a fifth of a millisecond at p95. **What this does not show:** the GPU time is not
isolated (a vsync-locked interval shows that the GPU kept up, not by how much); the command center itself noted that an interval cannot be read against a 14 ms budget (its ADR-0020, V2-19.8, where the budget was also
never measured on the reference hardware); the input was synthetic; and the Iris Xe of the reference laptop is far slower than this GPU. It is evidence that nothing is wrong, not a measurement of the criterion.
The scene's first frame was drawn 275 ms after navigation start on a local server with the cache off.

### Checks of the manual list

Observed in headless Chrome on the same machine, against the Studio served by the simulator (so under the server's strict Content-Security-Policy, which the Vite dev server does not send):

- **Laziness.** With the cache off, `/`, `/fleet`, `/topology` and `/lab` requested no `TwinScene` chunk (28 to 38 scripts each); `/twin` requested it once. From the build: `WebGLRenderer` is in exactly one file, the scene chunk,
  which only the lazy page chunk imports; it is not in the entry's static import graph and `index.html` does not name it.
- **Console.** No Content-Security-Policy violation, no error and no exception on `/twin`. One warning: `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`, which comes from @react-three/fiber 9.8.2
  with three 0.186.1 (this repository's code does not use `Clock`).
- **No WebGL 2** (Chrome with `--disable-3d-apis`): the banner "3D view isn't available on this device", the reason and the link to Topology; no request for the scene and none to `/api/twin-layout`.
- **Context lost for good:** the scene gave way to the fallback after 5 s with the link to Topology; **restored within 2 s**, it stayed.
- **Layout not usable** (the response replaced in the browser; the server side is covered by the simulator's tests): `available: false` shows its reason and the link; a `404` says the simulator is too old for the twin and offers
  **Try again**; neither requests the scene.
- **Camera**, from screenshots: the tilt stops near 20° and 78° from vertical, nothing goes under the ground, panning far leaves the campus in view, and the home distance is the 900 m limit. The numbers were not read from
  the camera, and **reduced motion was not observed**.

### Licences

All permissive, from `pnpm licenses list` for the production dependencies of `@itp/simulator-ui` and the registry on 2026-10-26: `three` MIT; `@react-three/fiber` MIT and its dependencies `@babel/runtime`, `@types/webxr`,
`base64-js`, `buffer`, `its-fine`, `react-use-measure`, `scheduler`, `suspend-react` and `use-sync-external-store` MIT, and `ieee754` BSD-3-Clause (a dependency of `buffer`); `@types/three` MIT (a development dependency).
Nothing is copyleft.

### The time the spike took

About 3 hours 10 minutes of wall-clock on 2026-10-26, from the creation of the first analysis file (08:47) to the end of the measurements (about 11:57), including time spent waiting for commands and answers. The simulator
half was committed at 09:26 (`1d40ec3`). Active hours were not recorded.

### Consequences of the spike

- Three.js is a 0.x dependency: a minor release can break. React Three Fiber 9.8.2 declares `react >=19 <19.4`, and Studio is on `^19.3.1`, so a React 19.4 upgrade has to wait for it. Both are the command center's
  versions, so a later extraction stays mechanical.
- The console shows one deprecation warning in production (`THREE.Clock`), from React Three Fiber, until it moves to `THREE.Timer`.
- The footprint rule (the zone inset by 8 m) is written twice, in `apps/simulator/src/twin-layout.ts` (to check the devices) and `apps/simulator-ui/src/lib/twinGeometry.ts` (to extrude); their tests pin the same numbers.
- Vite now prints its "chunk larger than 500 kB" warning for the scene chunk. It does not fail the build and the warning limit was left alone; there is no build-time check of the 350,000-byte budget yet, and SIM-18 adds
  one if the twin goes on (the command center's `scripts/chunk-budget.ts` is the model).
- The scene is not unit-tested (jsdom has no WebGL): the pure helpers, the layout hook and the page are, with the scene replaced by a stand-in; a scene chunk that fails to load (it becomes the fallback) is not tested.
- **Owed by SIM-18:** the visually hidden list of devices that follows the scene (nothing is discoverable only in 3D), the keyboard camera and the Escape and Home keys, the flat plan with live pins while the code loads,
  and a build-time budget check.
- The main bundle was 310,498 bytes raw in a listing taken before this work and is 328,355 now; this spike adds a lazy import and a route to it, which cannot explain 18 KB, and the earlier listing predates the Analytics
  commit (`2367710`), but that was **not verified** by building the commit before the spike.

## Amendment, 2026-10-26: SIM-18, the campus scene

The spike's go was conditional on the frame time being measured on the reference laptop and on the chunk staying under 350,000 bytes with SIM-18's additions. **The chunk is now measured** (below) and is well inside its budget;
**the frame time on the reference laptop is not**. SIM-18 was written, its unit tests pass, and it was observed in a headless Chrome on the machine of the spike (below), not on the reference laptop. The condition on the frame time stands, and so does the fallback to option D if it fails. This
section says what was built, what differs from the design page, what was measured and what is owed; it gives no figure that was not measured.

### What SIM-18 built

- **Pins and states.** A pin for every device the layout places, in the shape of its kind (rounded square, circle, hexagon), ringed in its state (dashed when it is paused, stopped or silent), on a stem down to its building's roof.
  The state is Fleet's and the Topology's own (`deviceStatus`, then `deviceTopologyState`), so the three pages cannot disagree; a building takes the worst of its pins. While the link to the simulator is lost every pin is dashed
  and its label says how old its last value is.
- **Labels and tooltip** are DOM above the canvas, at most 12 at a time (the selected pin, the hovered one and those that need a look first), placed from the camera's matrix without a React render per frame; the tooltip
  appears after the pointer rests 150 ms.
- **Camera.** The presets _Campus_ and _Top_ fly in 600 ms (instantly under `prefers-reduced-motion`; a flight ends the moment the viewer takes hold), with buttons that rotate, zoom and reset and, with focus on the stage,
  arrow keys to pan and `+` / `-` to zoom. _Top_ is **20° from vertical**, the steepest the tilt limit allows, not straight down; _Building_ comes with SIM-20.
- **Selection** is in the address with the keys the Topology reads (`device`, `zone`), so the _Topology | Twin_ switch (on the Topology, the Overview, the Lab canvas and the Twin) carries the selected device or building
  and a shared link keeps it. **Escape** climbs one level (device, building, nothing) and never leaves the page; **Home** returns to the campus.
- **Catalogue layer.** The nine assets the command center draws at campus level, as dim dashed boxes, labelled "not simulated". The list of nine codes is a constant in Studio (`lib/twinCatalogue.ts`), because the layout file
  has no field for it and "outdoor and roof" cannot be read from its data; a test that reads the real layout file is what notices a drift.
- **Loading and fallback.** While the scene's code loads, the flat plan (an SVG from the same layout, seen from the home camera's direction) shows the devices live, with a checklist and no percentage. When the twin cannot be
  drawn (no WebGL 2, a layout that could not be read or used, a lost context, code that did not load) the page says why and shows **the Topology itself, in place**, never an empty canvas.
- **Text twin.** A table of every device Fleet lists, with its name, id, state, latest values, last heard and whether the scene draws it, visually hidden until focus is inside it (a row can be chosen with Enter).
- The Overview's simulation controls and event timeline sit under the scene, so the twin can be driven alone.

### Where it differs from the design page, and why

- A line is one pixel wide in WebGL, so a building's state is carried by the tint of its top face (the walls take their shade from the lights) more than by its outline, and a stale building's rim is not dashed. A pin's ring is
  a band of triangles for the same reason.
- Pins are drawn without a depth test: at campus distance a 16-pixel mark is wider than the 6 m it floats above its roof, and a building would cut it. A pin behind a nearer building is therefore still seen and can be picked.
- The tints of an anomaly and of a dark building are frame 14's (`#5b4e34`, `#2b3338`); the command center's neutral material has none, and nothing here says whether its own twin will.
- The loading card has no progress bar that moves, and the fallback banner cannot be dismissed, so that the reason stays next to the topology it explains.

### The budget is now checked

`pnpm --filter @itp/simulator-ui budget` builds Studio with a manifest into `dist-budget/` (git-ignored, so the `dist/` the simulator serves never holds `.vite/`) and checks the scene chunk: zlib level 9, the chunk's `.js` and
`.css` and the chunks only it imports, 1 KB = 1,000 bytes, at most 350,000; the scene is not in the entry's static imports, `index.html` does not name it, and no other file contains `WebGLRenderer`. It exits 1 on any of them.
It is a step of the `verify` job of `ci.yml` and of `scripts/ci-local.sh`, which change together.

### Measured: the chunk with SIM-18's additions

On 2026-10-26, by Sếp, on a MacBook Pro (model and chip not stated), Node 24, Vite 8.3.4, with `pnpm --filter @itp/simulator-ui build` and then `pnpm --filter @itp/simulator-ui budget`, on the working tree of the branch
`feat/sim-18-twin-campus` (the changes were not committed; there is no commit hash). Chunk sizes do not depend on the machine.

- The scene chunk `assets/TwinScene-Cy7HEnhO.js`: 941,047 bytes raw, **246,489 bytes gzipped (level 9)**. It has no `.css` and no chunk that only it imports, so that is the total counted. The margin is **103,511 bytes** under 350,000
  (128,511 under the command center's 375,000). The spike's chunk was 244,876 bytes: SIM-18's pins, markers, flights and handles added **1,613 bytes (0.7 %)**.
- The laziness check of the script passed: the scene is not in the entry's static imports, `index.html` does not name it, and no other file has the renderer. Vite still prints its 500 kB warning for this chunk.
- The page chunk `assets/Twin-B7BV9U5h.js` is 32.62 kB raw and 11.79 kB gzipped (Vite's figure), with `assets/Twin-BW7tuW5O.css` 8.12 kB and 2.17 kB; with the scene the twin is about 260 kB gzipped. The entry bundle `assets/index-DPjD2MGL.js`
  is 328.52 kB raw and 104.14 kB gzipped (328,355 and 104.05 kB at the spike): the switch, the routes and the one lazy import changed it by about 170 bytes.
- `vite build --manifest --outDir dist-budget` worked as written, and `dist/` has no `.vite/`.

### Measured: the frame time and what a browser showed

On 2026-10-26 at about 15:07 +07, by Claude at Sếp's request, against the Studio served by Sếp's running simulator (six devices, no scenario playing, so every pin was healthy): a headless Chrome 155.0.8059.86 driven through the DevTools
protocol by a one-off script outside the repository (it loads pages and clicks in the interface and sends no command to the simulator), at 1920 × 1080 and device pixel ratio 1, cache off. The machine is the one of the spike's measurement, **not the
reference laptop**: a MacBook Pro `Mac15,7`, Apple M3 Pro, 18 GB, on AC power, with the simulator, ingest and Vite servers running (load average 3.2 before the run and 4.8 after), so the figures are not those of an idle machine. The build was the
working tree of `feat/sim-18-twin-campus` (not committed; no commit hash).

| Phase                                     | Frames | fps | Frame interval p50 / p95 / p99 / max (ms) | Frames over 25 ms | Page `requestAnimationFrame` callbacks, p95 / max (ms)  |
| ----------------------------------------- | ------ | --- | ----------------------------------------- | ----------------- | ------------------------------------------------------- |
| idle, 5 s                                 | 300    | 60  | 16.7 / 16.8 / 16.8 / 16.8                 | 0                 | 0.5 / 0.5 (10 callbacks: the demand loop draws nothing) |
| orbit, 10 s (drag, about 60 events/s)     | 603    | 60  | 16.7 / 16.7 / 16.8 / 16.8                 | 0                 | 0.4 / 0.6                                               |
| zoom, 10 s (wheel, at the cursor)         | 603    | 60  | 16.7 / 16.7 / 16.8 / 16.8                 | 0                 | 0.4 / 0.8                                               |
| eight flights, _Campus_ and _Top_ (7.2 s) | 433    | 60  | 16.7 / 16.8 / 16.8 / 16.8                 | 0                 | 0.4 / 1.8                                               |

The interval is locked to the 60 Hz of the compositor: no frame was late in any phase, labels and pins included. What this does **not** show is what it did not show for the spike: a vsync-locked interval says the GPU kept up, not by how much; the 14 ms
of the criterion is a budget that an interval cannot be read against; the input is synthetic; and the hardware is far faster than the reference laptop's. It is a measurement on the wrong machine, not a pass of the criterion on the right one.

What the same run saw:

- **Lazy.** With the cache off, `/`, `/fleet`, `/topology` and `/lab` requested no `TwinScene` chunk (29, 32, 35 and 39 scripts); `/twin` requested it once.
- **Console.** Only the `THREE.Clock` deprecation warning of the spike; no error, no exception, no Content-Security-Policy violation. The first frame of the scene was marked at 467 ms from navigation (275 ms at the spike, which had no pins, labels or live
  state; the machine's load differs and was not isolated).
- **Pins and text.** Six pins and six labels were placed; the headline read "20 zones, 12 buildings, 31 catalogue assets (not simulated) · 6 of 6 devices placed (6 illustrative)"; the text table had six rows, each with the Fleet name and the id; the
  `View` switch had _Twin_ selected; the stage had `tabindex` 0; the scene's text alternative named 12 buildings and 6 devices.
- **Pointer and keys.** With the pointer on a pin the tooltip was absent at about 60 ms and present at about 410 ms (kind, building, state, readings, position) and the cursor was a pointer; a click set `?device=dc-env-01` and the selection card;
  `Esc` went to `?zone=BLD-DC`, a second `Esc` to no selection, and a third left the page on `/twin`; the switch to Topology kept `?device=dc-env-01`, and back kept it on `/twin`; `Home` cleared it.
- **Fallbacks.** After `loseContext()` and 7.5 s, the canvas was gone, the reason was shown and the Topology was in place with a single heading. With 3D APIs off (`--disable-3d-apis`), no scene and no layout was requested, the banner and the Topology were
  shown and there was no canvas.
- **Screenshots** of the campus, a hover, a selected pin, a selected building, the _Top_ preset in flight and settled, a rotation, the catalogue layer off, the lost context and the missing WebGL 2 were taken; the first, the selected pin, the selected
  building, _Top_ and the missing WebGL 2 were looked at. They show the scene drawn, pins in the shapes of their kinds, healthy rims, the catalogue markers as small dim boxes, and _Top_ as a near-overhead view.
- **A defect they showed, fixed the same day.** At the home view the six labels, each about 165 × 44 px, stand within about 330 px of each other and overlapped: the label of one Data Center device sat under the other's, and the Library's was
  partly under the Innovation Hub's; the cap of 12 labels does not prevent that. A label that would cover one already shown is now hidden (`visibleLabels` in `lib/twinProject.ts`, which takes them in the order selected, hovered, needing a look, the rest, and keeps a
  gap of 4 px). In a second run, on a rebuilt Studio, three of the six were named at the home view and five when zoomed in, none covering another (two screenshots, looked at); the second Data Center device stays unnamed in both, its pin being next to the
  first's, and is in the tooltip and the text list. The campus also fills only part of the stage at home (the 900 m distance limit, as at the spike).
- **A scenario, from the page's own Run button** (15:20 to 15:22, on Sếp's request; `server-room-overheat`, sampled every 5 s through the labels' `data-state`, the text table and the simulation card, with screenshots): the Data Center device read healthy at
  20 s, **anomaly from 25 s to 80 s** ("Anomaly: temperature_c 29.2 °C, above 27") and healthy again at 85 s; in the screenshot at 30 s its building has an amber outline and a brown top, its pin an amber ring and its label an amber border, and at 100 s all
  are green again; the other five devices stayed healthy. The alert opened 27 s after the start and cleared at 83 s. Side effect: **alert #28** (high, `dc-env-01`, delivery skipped, no sink) is now in the database of Sếp's ingest.
- **Paused, from the page's own Pause button** (about 10 s, then Resume): all six pins and labels went to the paused look — dashed rings and label borders, dark buildings with a grey outline, "Data Center · paused" — the text table said "Paused" with "8 s
  ago", and after Resume everything read healthy again and the simulator listed all six devices as running.
- **Not observed:** the silent look (it needs a fault), reduced motion, a keyboard-only pass, a screen reader, the tilt and target limits as numbers, the alert beacon (SIM-19), and anything on the reference laptop.

### Still owed

- The frame time on the reference laptop (p95 over 20 s of orbit and zoom at 1920 × 1080, devices at rest), in a new dated section. Over 14 ms means option D; the chunk is within its budget.
- The rest of the manual list: the silent look, the reduced-motion case of the flights, the flat plan while the code loads (throttled network), a keyboard-only pass, and the
  hidden list read with a screen reader.
- Of what the spike said SIM-18 owed: the visually hidden list, the keyboard camera, Escape and Home, the flat plan with live pins and the build-time budget check are built; the frame time is measured only off the reference laptop.

### Consequences

- The scene chunk holds pins, markers and the camera's flights on top of the spike's code; the page chunk holds the plan, the labels, the tooltip, the controls and the text table.
- CI builds Studio one more time (with a manifest, into a folder of its own).
- The link-state pill is written a fourth time (the Topology, the Overview, the Lab and now the Twin); an extraction would touch three other pages and was left.

## Amendment, 2026-10-26: SIM-19, data flow, beacons and fault visuals

SIM-19 puts motion and consequence on the SIM-18 scene. The **conditions of the go stand unchanged**: the frame time on the command center's reference laptop is not measured, and SIM-19 is the first change that makes the scene
animate, so the figure taken at SIM-18 (an idle scene) no longer describes it. **This section records what was built and decided; it gives no figure that was not measured, and nothing in it has yet been seen running.**
The chunk size with SIM-19's additions is **measured** (below); the frame time with a scenario running and the hand checks are **not recorded** and are owed (see [Still owed](#still-owed-sim-19)).

### What SIM-19 built

- **The Pipeline hub and the arcs.** A dashed, floating ring over the middle of the site boundary, 80 m up, with a dashed stem to a small ring on the ground, in the accent colour: the hub stands for the broker and ingest, a
  logical object with no place on the campus, and the layout has no position for it (the height and the centre are constants of `lib/twinFlow.ts`). One arc leaves each pin for the hub. A lit arc (a device running or in
  anomaly) is a soft additive halo under a core, cyan for `flowing` and amber for `warn`; one that carries nothing is a dashed wire, grey for a device that does not report and red for a hub that is down or a cut link
  (`bad`). The words are Topology's. An arc is a **ribbon** that faces the camera and keeps its width in pixels (`lib/twinRibbon.ts`): no bloom pass and no SVG filter, as the design page decided.
- **Dots.** A dot travels an arc each time the simulator published for that device (the pulse bus), at most 4 alive on an arc and 24 on the screen, none under `prefers-reduced-motion`, while the tab is hidden, or on an
  arc that is not lit. A message the simulator tagged `duplicate` is a `published` event of its own, so its copy starts 150 ms after the first and the two read as a pair. A delay makes a dot take 1,400 ms plus the
  configured delay, up to 5 s. A burst has no special case: its messages meet the two caps and the rest are dropped.
- **Beacons.** While an alert is open on a device, its pin carries a ring in the **alert's severity colour** (`--sev-*`, never `--warning`) that grows and fades every 1.6 s, and its label carries the chip (`High · #7`; the
  number is the alert's id as the Alerts page writes it). A device with several open alerts shows the worst, newest among equals, and the text says "+n more". Alerts that were not read just now dim the beacon and say so.
- **Fault visuals, each from the engine's own state** (`faults` of the state view; nothing has a clock of its own): drop makes gaps in the arc and shows `dropped N` at the hub (the engine's count); delay makes dots slower
  and shows `lag 800 ± 100 ms · 3 held`; duplicate shows `readings N`, the figure that does not move; malformed puts a small cross at the hub and `rejected: json, shape`; a burst shows `burst`; link loss turns every arc red
  and dashed, starts no dot and shows `no link`; silent is the device's own stale look with the age of its last value on the label. Switch a fault off and the next state view draws nothing for it. A fault whose scope is
  _selected_ acts on those devices' arcs only; a cut link reaches all.
- **Layers.** _Data flow_ and _Alerts_ join _Devices_ and _Catalogue_ (frame 14); Heat is SIM-20. The key gains the red cross, the beacon and the logical hub.
- **Text twin.** A visually hidden block after the device list says what the hub is, how it stands, each chip and each fault that is on; the list and the card say the open alert in words.

### Decisions taken (Sếp, "accept all", 2026-10-26)

1. **An open alert is amber** (Q1): a healthy pin with an open alert has the anomaly _look_ (ring, rim, arc) because the alert outlives the breach, while the **word** stays Fleet's (`Running`). The twin therefore differs from
   Topology's colour for that device in that window, on purpose.
2. **The hub's place** (Q2) is a constant derived from the boundary, not a field of `twin-layout.json`: no data and no simulator change.
3. **One alert per pin** (Q3), the worst; **the engine's own counts** for the hub's chips (Q4), not ingest's gaps, which trail the cause by its grace period; **the pulse bus carries the message's `fault`** (Q5) as an optional third
   argument, which Topology's edges never see; **reorder has no picture** (Q6), a line of text.
4. **Malformed comes from the state, not the message** (P1): the cross and the reasons are on while the fault is, and gone one update after it is off; a cross that flashed per message would be a loop of the UI's own.
5. **Arcs keep their glow and move only dots** (a deviation from the plan, recorded in `docs/plan/SIM-19-implementation.md`): a marching pulse on every lit arc would keep the scene drawing 60 frames a second whenever a
   device runs, ending the idle that SIM-18 measured. The animation budget (24 lines, 12 nodes, shared with the 2D edges) decides which arcs move dots and which beacons pulse; what is past a cap stands still. The scene asks for
   a frame only while a dot or a moving beacon is alive.

### Where it differs from the design page, and why

- The arcs are cyan for a healthy device, as on frame 14 and on Topology; the design page's table says "indigo", but indigo is the accent colour ("you can act on this"), not energy.
- No arc marches continuously (decision 5); the movement on an arc is its dots.
- The malformed cross shows while the fault is on, not once per rejected message (decision 4).
- With the six placed devices the screen cap of 24 dots cannot be reached (6 arcs × 4): it is built and unit-tested as the brief says, and **was not observed**.

### Measured: the chunk with SIM-19's additions

On 2026-10-27, by Sếp, with `pnpm --filter @itp/simulator-ui build` and then `pnpm --filter @itp/simulator-ui budget`, on the working tree of the branch `feat/sim-19-twin-data-flow` (the changes were not committed; there is no commit
hash; the machine is not recorded, and chunk sizes do not depend on it). The scene chunk `assets/TwinScene-C4J9AxVx.js` is 949,612 bytes raw and **249,433 bytes gzipped (level 9)**, the only file counted, with a margin of
**100,567 bytes** under 350,000. SIM-18's was 246,489: SIM-19's hub, arcs, dots and beacon added **2,944 bytes (1.2 %)**. The script's laziness check passed (requested only by the twin page). The page chunk and the entry bundle
were not listed in the output given, so their sizes are not recorded.

On the same day Studio's unit tests were run by Sếp: 147 files, 2,559 tests, all passing, including the cases of `Twin.test.tsx` written for this ticket. That says nothing about the parts that draw (`Arcs`, `Hub`, `Dots`, the
beacon in `Pins`), which jsdom cannot run.

### Still owed (SIM-19)

- The frame time on the reference laptop, **with `server-room-overheat` playing** and dots moving (p95 over 20 s at 1920 × 1080; over 14 ms means option D), in a new dated section.
- The hand checks of the ticket's list, none done: the overheat run (pin and rim amber, then the beacon with the alert, both gone with it), each fault on and off, a cut link, ingest stopped, a selected scope, reduced motion
  (no dots, a still beacon), the layers off, a hidden tab, and the hidden text read with a screen reader.
- The unit tests of the pure files (`twinAlerts`, `twinFaults`, `twinFlow`, `twinDots`, `twinRibbon`, `twinPins`, the pulse bus's third argument, `useGrantedSlots`, `useTwinModel`) are written by the `steel-unit-react-*`
  suite after this change; the page's tests are in `Twin.test.tsx`. The parts that draw (`Arcs`, `Hub`, `Dots`, the beacon in `Pins`) cannot be tested in jsdom.

### Consequences

- The scene chunk holds arcs, a hub, a pool of dots and a beacon on top of SIM-18's (249,433 bytes gzipped in all); the page chunk holds the hub label, the alert chip and the text twin (its size is not recorded).
- The pulse bus has a third, optional argument; a plain message still calls its listeners with two.
- Two screens now spend the same animation budget (Topology's edges and the twin's arcs); only one is on screen at a time.
- `lib/reducedMotion.ts` is a third copy of the one-line media query (`CameraRig` and `useEdgeDots` carry the others); an extraction was left.
