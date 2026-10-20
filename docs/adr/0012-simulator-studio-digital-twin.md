# ADR-0012: Studio's digital twin is a lean three.js scene on the command center's conventions

- **Status:** Accepted 2026-10-19 as the approach; **go or no-go is decided by the SIM-17 spike** (see [digital-twin.md](../design/simulator/digital-twin.md)). Confirmed with it: hand-placed `illustrative` positions, and the Pipeline hub drawn as a floating logical object.
- **Date:** 2026-10-19

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
