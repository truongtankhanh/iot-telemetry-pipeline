# ADR-0012: Studio's digital twin is a lean three.js scene on the command center's conventions

- **Status:** Accepted 2026-10-19 as the approach; **go or no-go is decided by the SIM-17 spike** (see [digital-twin.md](../design/simulator/digital-twin.md)). Confirmed with it: hand-placed `illustrative` positions, and the Pipeline hub drawn as a floating logical object.
- **Date:** 2026-10-19
- **Amended 2026-10-26:** the SIM-17 spike ended in a **conditional go** (see [the amendment](#amendment-2026-10-26-the-sim-17-spike-conditional-go)).

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
