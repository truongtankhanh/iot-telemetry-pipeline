# Simulator Studio — design brief

Status: **approved, revision 12** (SIM-01, 2026-10-20; merged to `main` as PR #46). Revision 4 follows Sếp's review of the UI (wide screens, device identity, neon data lines); revision 2 applied the review in
[design-note.md](design-note.md) to the first draft. Mockups: [Simulator Studio](https://claude.ai/artifact/8rSkLYmqoPzaF36yBxYLPQ)
(design canvas, private until shared from its Share menu). Source of every frame: [mockups/](mockups/) —
`Main.dc.html` is frame 00, the rest are numbered like the frames, and `studio.css` holds the tokens and components
they share. As in the command center's design pages, the frames render on the canvas only (they load its
`support.js` runtime); read them for markup and values, not in a browser.

> **V1, demo only — not for production.** Studio is a demonstration tool. It has no authentication and listens on
> `127.0.0.1` by default; see [Security posture](#security-posture).

Studio is a web UI for the simulator. Today the simulator is a command-line script: to change what a demo shows,
someone stops it and starts it again with other flags. Studio replaces that with an operations room for the
simulated campus: it shows what is running, lets the presenter start and break things, and follows each change
through the pipeline to the incident in the command center, so a demo does not need a terminal.

It is decided in [ADR-0011](../../adr/0011-simulator-studio-control-plane.md): the engine stays in the simulator's
Node process, the UI talks to it over HTTP and server-sent events, and the headless CLI keeps working.

## What revision 12 changed

Sếp asked what the Simulation lab does with 100 devices, reported that blocks in the canvas still overlapped, asked for paging of the scenarios, and asked for a more electric timeline editor. Frame 19 is the
Lab at that size; frames 11 and 12 are corrected.

| Part of the Lab         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations (frame 00)  | Every section is redrawn in the electric style, and `studio.css` carries it for all frames: **Surfaces and text** shows text beside a glow with computed contrast (primary 10.4 to 12.2:1 on a 12 % neon tint); **Colour roles** moves to electric tones (accent `#959BFF`, success `#3DF0AE`, warning `#FFC23D`, danger `#FF6280`, info `#44D2FF`, alert-high `#FF8F3A`, all at least 4.6:1 on surface-2) and shows the halo, glow and core recipe; **Status language** animates the five states (healthy breathes, anomaly pulses, down stutters with marching dashes, paused stays dark, selected breathes its halo); **Type** lets numerals of 24 px and up glow in cyan, amber or green; **Controls** carry an indigo edge light when they can act, cyan on hover and focus, red for danger, none when disabled, and sliders and progress fill indigo to cyan; **Motion** lists each effect with its timing and a live sample; **Device identity** shows each shape in healthy, anomaly and down; **Wide screens** gains a diagram and notes the glow scales with the UI; **Pagination** is lit and its table is corrected to what the frames show. Every control also has its states shown (default, hover, pressed, focus, disabled) with `cursor: pointer` on anything that acts and `not-allowed` on a disabled one, and a new **Tables** card shows the row hover: a cyan wash, a 2 px cyan bar and a quiet action, with the selected row unchanged by hover. |
| Overlap in the canvas   | The open zone's header (name, count, chevron) and its first device were drawn on top of each other, and the target popover, 440 px wide, covered the canvas. The zone header now has its own row with the chevron on the title line; the popover is as wide as the configuration column (268 px) and opens under the target field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Canvas above 60 devices | The canvas is a scrolling **zone list** (20 zones, 100 devices), worst first, each row with its count, a stacked state bar and, for targeted zones, an accent outline and "6 targeted". Lines are drawn from the visible rows only; the pipeline is drawn once. Search, _Problems only_ and _Collapse all_ stay in the canvas header.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reaching a device       | A zone is not expanded in the list. Selecting it fills a **zone table** under the canvas: device, state, reading, fault, start time and alert, with _All / Targets / Problems_ tabs and a pager. The table is the same component as the Fleet table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Targeting many devices  | Scope _Zone_ shows one chip per zone with the number of devices taken from it ("Library · 3"); the line under the field says "12 of 100 devices in 3 zones". The **stagger** field is visible and says when the first and last device start and when alerts are expected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Timeline                | One lane per zone group, not per device: a group draws one thin bar per device, offset by the stagger, with its time span. The alerts lane draws one dot per expected alert and one per clear, joined by a bar ("up to 12 alerts"), with the range of raise and clear times below. The ruler and the playhead are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Execution inspector     | The log has _All / Alerts / Faults_ filters, collapses runs of alike events ("6 more alerts, #8 to #13") and pages. Rule evaluation and trace show one target at a time, with previous and next arrows ("dc-env-01, 1 of 12").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Timeline editor         | Frame 05 is redrawn at its true pixel size (no scaling, so text is 13 px and up) with the same electric treatment as the data lines: the value is a three-layer neon line (wide halo, glow, bright core) with a spark running along it; the part inside an anomaly turns amber while the rest stays cyan; each anomaly is a glowing block with a value chip, grips on the selected one, and the raise line glows. The alerts lane has its own header, the rule and severity in the gutter, glowing raise and clear dots with their times, and an open bar for an alert that clears after the scenario. The playhead is a neon line with a glowing time pill and tints what has elapsed. The inspector's preview uses the same lines and marks the hysteresis band, the start and the end. The spark stops under reduced motion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Scenario library        | Frame 03 pages its cards: a search (name, device or rule), a sort, the source tabs with counts (All 38, Built-in 2, Custom 36), 6 cards per page (6, 12 or 24), the range "Scenarios 1–6 of 38" and the page numbers, with the same pager as the Fleet table. The dashed "New scenario" card is dropped once the list passes one page; the header button stays. Search, tab, sort, page and size are in the URL. Chart labels that ran off the card or over the line were moved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## What revision 11 changed

Sếp asked what the Simulation lab does when a zone or building holds many devices.

| Part of the Lab     | Decision                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Choosing the target | The two fixed selects are a **target picker**: a scope (Device, Zone, Class), the chosen targets as removable chips, and a popover with search, filter tabs (All, Playing, Problems), a switch to group by zone, a checkbox per device and per zone (tri-state), a scroll area, "Show n more", and "Select zone". A line says how many devices the fault will touch ("1 of 2 in Data Center"). |
| Catalogue assets    | Assets of the command center's catalogue that the simulator does not play are listed, dimmed, "not played", and cannot be ticked; the picker says why. They become targets when V2-T05 plays them.                                                                                                                                                                                             |
| The canvas          | The same grouped topology as the Overview: a zone is a node with its device count and worst state, the target's zone is open, the target is ringed with a target mark, and a zone's unplayed catalogue assets are one dashed "+ 8 catalogue assets" row. Search and the grouping switch sit in the canvas header.                                                                              |

Time inside a scenario is written as plain seconds, never as `t+N`: "Elapsed 41 s / 80 s", "alert at about 24 s", "clears at 80 s", "14 s in". The first mention on a page says it counts from the scenario start.

Every label in a node fits inside its block: a collapsed zone shows its name and a short line (the count and the state), and the zone code is in the tooltip. A label that does not fit is shortened, never allowed to run into the next block.

A fault aimed at several devices at once gets a **stagger** (seconds between devices) so they do not all change on the same tick;
it is a field of the trigger, shown only when the target holds more than one device.

## What revision 10 changed

On Topology the device detail states the device's current state in one note beside its name ("Anomaly · 29.3 °C, above
27 °C"), and the chart no longer draws an alert marker: the raise and clear lines stay, and the part of the line above
the raise line is amber. The Alert #7 chip and the Humidity tab are gone from that card; the alert itself is in the
Alerts card and the reasoning in Rule evaluation. The Fleet card, the inspector and the building view still draw the
bell, the tinted band and the three ringed readings; they can follow Topology if Sếp prefers.

## What revision 9 changed

Sếp reviewed Topology (frames 04 and 10).

| Finding                                                       | Decision                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A yellow chip covered the device list, next to the zone label | The Live pill and the scenario chip were drawn over the graph. Nothing is drawn over the graph's content any more: they sit in a toolbar above it. The legend moved to a strip below it. The only overlay left is the minimap, in the corner where the graph is empty.                                                                       |
| Many devices                                                  | The Overview's rules apply (see the scale rules): the toolbar has _Grouped by zone / All devices_, _Problems only_, a search that finds a device or zone, _Collapse all zones_, zoom and fit, and a minimap showing the view. Each zone header shows its device count and a chevron; a zone with more than 6 devices shows 6 and "+ n more". |
| The device detail looked bad beside the graph                 | It moved under the graph, full width, in three columns: the device detail (metric tabs, the chart at width, the range bar, actions), the rule evaluation (rule, condition, readings, reaction time, cause) and the alerts. The graph is capped at 640 px high and centred, so a wide screen shows it large without a tall page.              |

## What revision 8 changed

Sếp reviewed the device inspector (frame 02).

| Finding                         | Decision                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The detail layout is too narrow | The sheet is 680 px (was 480), scrolls inside itself, and each metric has its own panel.                                                                                                                                                                                                                         |
| Metric bars are too coarse      | Each metric gets the Fleet chart at full width (axes, raise and clear lines, alert flag, last-value tag) and a **range bar**: the scale split into the safe zone, the hysteresis band between clear and raise (hatched) and the alarm zone, with the baseline, a glowing pin at the current value and its label. |
| Last payload cannot be copied   | A copy icon on the payload block, as on the topic.                                                                                                                                                                                                                                                               |

## What revision 7 changed

Sếp reviewed Device fleet.

| Finding                                               | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Frames     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| The grid shows 6 devices; with more, it cannot scroll | The page scrolls under a fixed header and rail, and the toolbar sticks to the top (search, zone, kind, sort, group by zone, Cards or Table). Cards are for up to 12 devices, paged 12 to a page. Above 12 the view is a table with state tabs and counts, selection, a bulk bar (pause, start, stop, hold a value, select all), sortable columns, a sparkline, a pager and a column chooser. Sort, filters, page and size are in the URL. Frame 18 shows it with the command center's catalogue (31 assets) as sample data. | 01, 18     |
| "Open topology" had no concrete action                | It is a **Follow** menu naming each destination and what it does: Topology (the device selected and the path to the incident lit), Digital twin (the building in focus with the device pinned), Alert #7 (cause and delivery trail). On Overview the button is "Open in Topology" and keeps the current grouping, filter and selection.                                                                                                                                                                                     | 01, 03, 11 |

## What revision 6 changed

Sếp reviewed the Overview and asked what happens when there is more to show.

| Finding                                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Frames     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Live topology with many devices        | **Scale rules** (below). Up to 12 devices every device is a node. Above 12 the graph groups by zone: a zone is one node showing its device count, its worst state and a chevron to expand it in place; line width follows the devices behind it. Above 60 a zone shows counts only. Controls: _Grouped by zone / All devices_, _Problems only_, and a search that finds a device or zone and opens its zone.                                                                                                   | 11         |
| The "clears about" bar is hard to read | The progress bar is now three named phases on one bar (Normal, Anomaly, Recovery), the part already played is solid and the rest dim, the playhead carries its time, the alert-opened flag is filled and the clear flag hollow until it happens, and two plain lines say what happened and what is next ("Alert clears at 80 s, in 39 s"). Same component on Overview, Fleet and the twin.                                                                                                                     | 01, 11, 14 |
| Many events in the timeline            | A table in the style of CloudWatch Logs, not a scroll area: a filter field (`source:Rule device:dc-env-01`), relative ranges (5m, 30m, 1h, 3h, 12h, Custom), local or UTC time, numbered pages at the top and the bottom with a rows-per-page choice, a row that expands to its fields, and a density strip of events per minute whose handles set the range. Page, size and range are in the URL. Events are kept for the session (the last 5,000); a range with more rows than a page simply has more pages. | 11         |
| What does the top-bar search search?   | It is a command palette: pages, devices, zones, alerts, scenarios, topics and actions, with prefixes (`d:`, `a:`, `s:`, `>`), ranked by match then severity, shown 5 per group. The field now says so ("Search devices, alerts, scenarios…") and the opened palette is frame 17.                                                                                                                                                                                                                               | 17, all    |

### Scale rules

One rule for every view that draws devices, so growth never needs a redesign.

| Devices      | Topology and Overview                                                 | Fleet                                           | Twin                                                    |
| ------------ | --------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Up to 12     | One node per device                                                   | Cards                                           | One pin per device                                      |
| 13 to 60     | Grouped by zone; expand a zone in place; _Problems only_ and search   | A table with paging and filters, cards optional | Pins cluster per building with a count; expand on focus |
| More than 60 | Zones show counts and worst state only; a device is reached by search | The same table, server-side paging              | One badge per building, heat layer instead of pins      |

The Simulation lab follows the same thresholds (frame 19): the canvas is a zone list above 60 devices and the target picker, the timeline lanes and the log group and page.

The worst state of a group is the worst of its devices (down, then anomaly, then paused or silent, then healthy), so a
problem is never hidden by grouping.

## What revision 5 changed

A second review of the UI found five things that still read as rough.

| Finding                                            | Decision                                                                                                                                                                                                                                                                                                            | Frames     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Tables with many rows need paging                  | One pager: rows per page, the range announced politely, page and size in the URL. **Event stream** is numbered (10 to 100 rows, 200 kept in memory; page 1 follows live). **Alerts** is by cursor, because the API returns `X-Next-Cursor` and no total, so it has Newer and Older and no page numbers.             | 00, 06, 13 |
| Fleet charts are too coarse and sink into the card | Each card has a real chart: labelled axes, the rule's raise and clear lines with the headroom in words, the part above the line in amber, the alert as a flag, the last value as a tag, min, average and max, a hatched gap with the reason for a paused or silent device. Neon line and soft area, as on Topology. | 01         |
| Scenario timelines are hard to read                | Each card plots the value against the raise and clear lines with a time axis, the alert and the clear as flags, and a playhead and a tinted elapsed part while it runs. The multi-anomaly scenario shows one labelled lane per device.                                                                              | 03         |
| The Lab timeline is coarse                         | A ruler with major and minor ticks, a lane per device with its kind shape, the value drawn inside each block against its raise line, resize handles, an Alerts lane showing when each alert is expected to be open, a glowing playhead with its time. Same drawing in the dock and in the editor.                   | 05, 12     |
| The benchmark chart is coarse                      | Published and stored on one chart with the in-flight gap labelled, phases marked, a live tag on each line, an average line and a projected finish; ingest lag, flush time and buffered readings each get their own chart.                                                                                           | 09         |

Drawing the expected alerts exposed an error in the earlier frames, now corrected: the rule opens an alert at the third
publish tick at or after the anomaly starts (second for `power-over-contract`) and clears on the first tick after the
anomaly ends, so `server-room-overheat` is expected at about 24 s and clears at 80 s (it said 26 s and 85 s).
These are still computed, not observed.

## What revision 4 changed

Sếp reviewed the UI and asked for three things.

| Request                                                        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Frames                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Monitoring runs on large screens; the main layout must be wide | Frames are drawn at 1920 px. From 1600 px the navigation is an icon rail (labels on hover or pinned) and the margin grows to 40 px. Stage pages give the picture all the width the side panels (340 to 460 px) leave; nothing has a maximum content width. From 2560 px the UI scales ×1.25 and from 3200 px ×1.5, for a wall. Overview shows six KPIs, Topology puts its inspector beside the graph.                                                                                                                                         | all; 04, 10, 11, 12, 14        |
| Tell devices apart with icons or SVG                           | Each of the three device kinds has its own shape and glyph (rack in a rounded square, air flow in a circle, bolt in a hexagon), each metric its own icon, and each device a short code from its zone and index (`DC·1`, `LIB`, `HUB`). The shapes carry through Fleet, Topology, the Lab and the twin pins. Colour stays status, never identity.                                                                                                                                                                                              | 00, 01, 02, 04, 11, 12, 14, 15 |
| Neon, electric connection lines                                | Data lines are drawn in three layers: a soft halo, a bright core and a moving pulse, in electric cyan; amber for an anomaly, green for a delivered alert. **Light means energy is moving**: a paused, silent or down line is a dim dashed wire with no glow, so the glow can be trusted. Since revision 12 the same language edges nodes, controls, chips and charts at lower strength (see the revision 12 table); a data line is still the brightest thing on a page, capped at 24 glowing lines, and the pulse stops under reduced motion. | 00, 04, 10, 11, 12, 14, 15     |

The design note warned that a strong neon style tires the eyes and makes warnings lose meaning when everything glows.
The answer in revision 2 was that only a line that carries data glows. Revision 12 widens the style to the whole product on Sếp's decision (an IoT console suits electric neon) and keeps the note's concern with four rules: the glow is outside the border and never behind text, only numerals of 24 px and up glow, every animation stops under reduced motion, and a screen carries at most 24 glowing lines and 12 animated nodes. An alert keeps its own colour.
Electric cyan (`--flow`) is not the accent: the accent still means "selectable", so a selected node and a flowing line
cannot be confused.

## What revision 2 changed

[design-note.md](design-note.md) argued that the first draft read as a design-system page for developers rather than
an IoT operations product. Most of it is adopted. Where the note assumes a system this repository does not have, the
decision below says what was done instead.

| Note's recommendation                                                                       | Decision                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Land on an operations overview, keep Foundations internal                                   | **Adopted.** Studio opens on Overview (frame 11). Frame 00 is the internal `/foundations` route.                                                                                                                                                                                              |
| Answer operational questions with live KPIs, charts, alerts, timeline                       | **Adopted.** Every number comes from the engine or from ingest; none is a placeholder. Frames that stand for a measurement are labelled _Sample data_.                                                                                                                                        |
| Replace the stage strip with a topology of nodes, edges and motion                          | **Adopted** (frames 04, 10, and compact in 11 and 12). Dots on lines are driven by engine events, capped, and not drawn under reduced motion.                                                                                                                                                 |
| Dark theme too flat; raise contrast between layers                                          | **Adopted, with a measured limit.** New surfaces step 1.14 to 1.26:1 (were 1.11 to 1.17). Further depth comes from a 1 px top highlight and borders, not from lighter fills; tertiary text is barred from the lightest surface (4.1:1).                                                       |
| Palette `#08131D` / `#10212D` / `#1A3040`, accent (`#959BFF` since revision 12), state hues | **Adopted** with two changes: surface-2 and surface-3 are `#1B3345` and `#284256` (the note's `#1A3040` is only 1.1:1 from surface-1), and alert severity keeps its own scale so `high` is not confused with the amber of "warning".                                                          |
| Geist or Inter for UI, JetBrains Mono for technical text                                    | **Adopted:** Geist and JetBrains Mono. This replaces Barlow, which the command center uses today, so Studio differs from that console until its refresh.                                                                                                                                      |
| Seven pages: Overview, Fleet, Simulation Lab, Topology, Event Stream, Incidents, Analytics  | **Adapted.** "Incidents" is **Alerts**: an incident exists only in the command center, and the pipeline's own record is an alert with a delivery trail (frame 13). Analytics holds session metrics and the benchmark. Guided demo is kept as a page of its own.                               |
| Simulation Lab in three zones: configuration, canvas, inspector                             | **Adopted** (frame 12) with the scenario library, timeline and faults as its sub-pages (03, 05, 07).                                                                                                                                                                                          |
| Fault types: offline, latency, packet loss, breach, burst, malformed                        | **Adopted as far as the engine can do them:** silent, drop, delay, duplicate, reorder, burst, malformed, breach, and link loss. A **gateway** is not modelled: the pipeline has none, and the nearest real failure is the simulator's own connection to the broker.                           |
| Event inspector with payload and trace through the pipeline                                 | **Adapted.** Payload, rule evaluation and reaction time are real. A per-message trace is not: ingest exposes no per-message timings or delivery timestamp, so later stages show _seen at_ times observed by polling (frames 12, 13).                                                          |
| Next.js, Tailwind, ECharts, React Flow, Zustand, React Three Fiber                          | **Partly.** React with Vite stays (a static app served by the simulator needs no server rendering; ADR-0011). React Flow and Zustand are adopted. Tailwind is not: tokens are CSS variables shared by name with the command center. The chart library is decided with SIM-06.                 |
| Digital twin 3D as a later mode                                                             | **Reopened in revision 3.** Research and a recommendation (a lean three.js scene on the command center's conventions, behind a spike) are in [digital-twin.md](digital-twin.md) and [ADR-0012](../../adr/0012-simulator-studio-digital-twin.md); frames 14 to 16. Pending Sếp's confirmation. |
| Level of detail and render throttling for 128 nodes                                         | **Principle adopted, scale not needed.** `devices.json` has six devices and the V2 catalogue a few dozen. State is kept per node and updates are batched; zoom-dependent detail is not built.                                                                                                 |
| Sign in, then land on Overview                                                              | **Not applicable in V1.** There is no sign-in; `/` is Overview.                                                                                                                                                                                                                               |

## Requirements and how Studio meets them

| #   | Requirement                                              | Decision                                                                                                                                              | Frames         |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1  | Run a whole demo without a terminal                      | Every flag of `main.ts` has a control: devices, interval, anomalies, scenarios. Nothing in a demo needs a shell.                                      | 01, 02, 03, 12 |
| R2  | The CLI, the benchmark and `docker:demo` keep working    | The engine is a module with no UI in it; `main.ts` and `bench.ts` become thin callers ([ADR-0011](../../adr/0011-simulator-studio-control-plane.md)). | —              |
| R3  | See the whole chain in one view                          | Topology follows a reading from device to broker, ingest, rule, alert, outbox and the incident in the command center.                                 | 04, 10, 11     |
| R4  | Observe and act side by side                             | Overview and the Simulation lab put the live picture next to the controls; nobody changes page to see what a button did.                              | 11, 12         |
| R5  | Know what a scenario will do before it runs              | Studio reads `apps/ingest/config/rules.json` and shows the alerts a scenario should raise and when.                                                   | 03, 05, 12     |
| R6  | Look current and credible on a projector and on a laptop | Dark, dense, calm; large numbers; a presenter mode with 40 px headings; motion only where it carries data.                                            | 00, 11, 08     |
| R7  | Survive the command center's UI refresh after its V2     | Token names equal the command center's, so adopting Studio's values there is a change in one `:root` block, not in components.                        | 00             |
| R8  | Never look healthy when it is not                        | Each dependency has an explicit down, stale or not-configured state; last known data is dimmed and dated; sample numbers are labelled.                | 04, 10         |
| R9  | Safe on a developer's machine                            | Heavy actions (benchmark, burst) ask first and lock the fleet; the control API binds `127.0.0.1`.                                                     | 07, 09         |
| R11 | Read from a distance on a large display                  | Wide layouts at 1920 px, a rail from 1600 px, scaling for walls, figures that step up in size.                                                        | all            |
| R12 | Tell devices apart at a glance                           | A shape, a glyph and a short code per device kind and device, in every view.                                                                          | 00, 01, 04, 14 |
| R10 | See where it happens                                     | A 3D campus puts each device in its building, shows the data leaving it and the fault landing on it, and injects at the place.                        | 14, 15, 16     |

Not in scope: authentication or roles, several operators at once, editing the device registry from the UI (it stays
`devices.json` until [V2-T05](../../tasks/v2/V2-T05-simulator-replaces-occ-telemetry-sim.md)), 3D models or parts, storing
history of past runs beyond the session, phone layouts beyond a graceful stack.

## Users and viewing conditions

| Who                       | What they do in Studio                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Presenter (the tech lead) | Runs a demo for colleagues or stakeholders: starts a scenario, explains each stage, recovers calmly.  |
| Developer                 | Reproduces a rule or contract behaviour: holds a value, sends a malformed payload, republishes a seq. |
| Reviewer                  | Watches the chain during a demo without touching anything; Overview and Topology are enough.          |

- Read from 1–3 m on a projector and at arm's length on a laptop: 13 px is the smallest text, numbers are tabular,
  headings in presenter mode are 40 px.
- A demo has a script and an audience: an unexpected state must explain itself in a sentence, not in a stack trace.

## Pages

| Route           | Page           | Purpose                                                                                          | Frames         |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------ | -------------- |
| `/` `/overview` | Overview       | Health of the simulated campus: KPIs, live topology, alerts, simulation controls, event timeline | 11             |
| `/fleet`        | Device fleet   | Every device, its live values, and per-device control                                            | 01, 02         |
| `/topology`     | Topology       | Components, direction of data, state of each link; select a node for its readings and alerts     | 04, 10         |
| `/twin`         | Digital twin   | The campus in 3D: buildings, device pins, data arcs, alert beacons, building focus, heat floor   | 14, 15, 16     |
| `/events`       | Event stream   | What crosses the broker, newest first, with payloads                                             | 06             |
| `/alerts`       | Alerts         | What the rules raised, why, and where each alert went                                            | 13             |
| `/lab`          | Simulation lab | Configure and inject a fault; sub-pages for scenarios, timeline and faults                       | 12, 03, 05, 07 |
| `/demo`         | Guided demo    | Scripted walk-through in presenter mode                                                          | 08             |
| `/analytics`    | Analytics      | Session throughput, lag and rejections; the benchmark                                            | 09             |
| `/foundations`  | Foundations    | Tokens, status language and motion; internal, hidden in a packaged demo                          | 00             |

## Principles

1. **One story per screen.** Overview is about health, Fleet about devices, the Lab about causes, Topology about
   consequences. A page never mixes two.
2. **Observation next to action.** Where a control changes the system, the thing it changes is on the same screen.
3. **Accent is for action and selection, never for a fault.** A node that is selected is indigo; a node that is
   broken is red and dashed. They cannot be confused.
4. **Never colour alone.** A state is a border style, an icon and a word (WCAG 1.4.1).
5. **Show the cause with the effect.** The raise and clear thresholds on every chart, the expected alert on every
   scenario, the metric name next to every fault counter.
6. **Honest about what it does not know.** If ingest does not answer, Studio shows the last answer with its age,
   not a guess. Numbers in the mockups are illustrative and labelled _Sample data_ where they stand for a measurement.
7. **Motion follows state.** A dot travels a line only when the engine published; nothing loops on its own.
   Everything respects `prefers-reduced-motion`.
8. **Stable layout.** Inspectors are sheets over the page; the page behind them does not resize.

## Look and feel

Studio keeps the command center's token **names** (four surfaces, `--accent`, `--sev-*`, `--success`, `--warning`,
`--danger`) and takes its own **values** from the design note. It ships first, so it leads the command center's
later refresh rather than copying its V1 look.

| Decision                                                  | Why                                                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas `#08131D`, indigo `#959BFF` (revision 12), one red | From the note: a darker canvas so panels read as objects, one accent, one red for "something is broken".                                                  |
| Four surfaces, steps of 1.14 to 1.26:1                    | Measured; wider than the first draft, but still shallow, so a 1 px top highlight and a subtle border do part of the work. Menus and toasts use surface-3. |
| Geist for UI, JetBrains Mono for machine text             | Geist is tabular and neutral; topics, payloads and rule ids are read character by character and belong in a monospace face.                               |
| Neon data lines                                           | Electric cyan halo, core and pulse mean energy is moving; no flow, no light. Also the edge light of nodes and controls since revision 12.                 |
| Device kind shapes                                        | Rounded square, circle and hexagon, each with its glyph, so a device is recognised without reading its name.                                              |
| Operations-room layout                                    | KPI row, then the live picture, then the feed, as in the note's wireframe. The Lab drops to an icon rail so its three zones get the width.                |
| Node graph on a dotted canvas                             | Direction, state and selection are readable without reading labels; zones group devices as the campus does.                                               |
| Charts always carry the rule thresholds                   | A line going up means nothing in a demo until the audience sees the limit it crosses.                                                                     |

Frame 00 shows the tokens, the status language and the motion rules.

## Frame index

| Frame                                  | Shows                                                                                                                                  | Implemented by |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 00 Foundations                         | Surfaces with contrast, colour roles, five node states, type, controls, motion rules                                                   | SIM-04         |
| 01 Device fleet                        | Header dependency pills, KPIs, the running-scenario strip, six device cards with sparklines and per-device controls                    | SIM-05         |
| 02 Device fleet — inspector            | Sheet over the grid: topic, mode, interval, per-metric baseline and noise, manual value against the raise line, payload                | SIM-05         |
| 03 Simulation lab — scenarios          | Built-in and custom scenarios, mini timeline, expected alerts from `rules.json`, a start warning for a stopped device                  | SIM-08         |
| 04 Topology — alert in flight          | Zones, devices, broker, ingest, database, rules, alert, outbox, command center; selected node with chart and alerts                    | SIM-06         |
| 05 Simulation lab — timeline           | Lanes per device, anomaly blocks, shape/value/start/duration, preview against thresholds, expected alerts                              | SIM-11         |
| 06 Event stream                        | Filterable table of what was published and its PUBACK time, detail with payload, shell command and republish                           | SIM-13         |
| 07 Simulation lab — faults             | Drop, duplicate, malformed (by contract reason), delay, reorder, burst; the ingest counters each one moves                             | SIM-12         |
| 08 Guided demo                         | Scripted steps, narration, the event the step waits for, the pipeline so far, keyboard-driven                                          | SIM-14         |
| 09 Analytics — benchmark               | Locked settings, pre-flight checks, published vs stored progress, throughput, lag and flush time                                       | SIM-15         |
| 10 Topology — dependency down          | Ingest unreachable and no alert sink: red and amber pills, dashed stages, dimmed last-known alerts, retry                              | SIM-06         |
| 11 Overview                            | KPIs, compact live topology, alert feed, simulation controls (run, pause, step, reset), event timeline                                 | SIM-09         |
| 12 Simulation lab — workspace          | Fault configuration, canvas with the target highlighted, execution inspector (log, rule evaluation, trace), timeline dock              | SIM-10         |
| 13 Alerts                              | Alert list with delivery state; detail with cause and delivery trail from first breach to incident                                     | SIM-07         |
| 14 Digital twin — campus               | The campus in 3D, a device pin per device, arcs to a logical Pipeline hub, the selected building and "inject at"                       | SIM-18, SIM-19 |
| 15 Digital twin — building             | Data Center with see-through walls, a heat floor, Row A and Row B devices, the device inspector                                        | SIM-20         |
| 16 Digital twin — loading and fallback | The flat plan with live pins while the 3D code loads, the conditions under which the twin is not drawn, the fallback banner            | SIM-18         |
| 17 Command palette (⌘ K)               | What the search finds, the groups, prefixes and keys, shown over the Overview                                                          | SIM-04         |
| 18 Device fleet — table                | Fleet above 12 devices: state tabs, selection and bulk actions, sortable columns, sparklines, pager, with the catalogue as sample data | SIM-05         |
| 19 Simulation lab — 100 devices        | The Lab with 100 devices: zone list, zone table, zone chips and stagger, one lane per zone group, filtered and paged log               | SIM-10         |

## Pages and what they read

Studio publishes through the engine and reads consequences from ingest. It never writes to ingest and does not need
any change to it.

| Page      | Reads from                                                                                                                                    | Notes                                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fleet     | The engine                                                                                                                                    | Registry fields come from `devices.json`; units and ranges from `METRICS` in the telemetry contract.                                                                                                 |
| Topology  | The engine, `GET /api/ready`, `/metrics` and `GET /api/alerts` of ingest ([api.md](../../api.md))                                             | A stage is down when its source does not answer. "Postgres" is shown as up when ingest reports `database: up`.                                                                                       |
| Overview  | The same sources as Topology and Alerts                                                                                                       | Availability is running devices over registered devices; it is a simulation figure, not a service level.                                                                                             |
| Alerts    | `GET /api/alerts`, `deliveryStatus` and `externalRef`                                                                                         | `/api/alerts` has no delivery timestamp. Times after the alert are when Studio first saw the state, within its 1 s polling interval.                                                                 |
| Lab       | The engine and `apps/ingest/config/rules.json`                                                                                                | "Raised about" is the `for`-th publish tick at or after the anomaly starts, and "clears about" is the first tick after it ends: computed from `rules.json` and the interval, designed, not observed. |
| Events    | The engine's publish log, kept in memory (last 200)                                                                                           | PUBACK time is measured by the publisher, not by ingest.                                                                                                                                             |
| Faults    | The engine, and `telemetry_sequence_gaps_total`, `telemetry_rejections_total{reason}`, `telemetry_messages_total`, `telemetry_readings_total` | Shown as the change since a fault was switched on. Reasons are the fixed set in `parsePayload`.                                                                                                      |
| Analytics | The benchmark module ([bench.ts](../../../apps/simulator/src/bench.ts)) and ingest metrics                                                    | Needs `DATABASE_URL`, as the benchmark does today. Results live for the session; export is a download.                                                                                               |

## Interaction decisions taken in the mockups

- **Inspectors are sheets**, 680 px (the device inspector; 480 px was its first width), over the page. The page behind does not resize and the selected card keeps its
  accent border.
- **From 1600 px every page uses the icon rail**; below that the navigation is labelled, with sub-items for the Lab.
  The Lab's sub-pages (Workspace, Scenarios, Timeline, Faults) are a segmented control at the top of each.
- **A scenario runs from four places** (library card, the Fleet strip, the Overview controls, a guided step) and is
  always one scenario at a time per device: starting a second one that touches the same device asks to replace
  the first.
- **Step and Reset.** Step advances simulated time by one publish interval and sends that tick; Reset clears
  anomalies and returns devices to baseline. Both need the engine's simulated-clock mode (SIM-02); without it the
  buttons are absent, not disabled. _As built (SIM-09, 2026-10-21):_ only **Step** needs it (the process is started with
  `--simulated-clock`); Reset works on both clocks. **Pause** pauses the devices, not the scenario's clock, and is absent on the
  simulated clock, where nothing publishes by itself.
- **Selecting a node** in Topology opens its readings, thresholds and alerts below the graph; selecting an alert
  offers _Show in topology_ and the reverse.
- **Running a scenario starts a stopped device it needs**, and the card says so before the click (frame 03).
- **Manual value and anomaly are different things.** An anomaly follows a scenario's clock; "Hold value" in the
  inspector overrides the simulated signal until released. Both show a chip on the device card.
- **Faults are a scope plus switches.** An active fault turns the header pill amber so nobody forgets it is on.
- **Heavy actions confirm and lock.** Benchmark and burst say what they cost before they start.
- **Presenter mode** hides the navigation, uses 40 px headings and moves on by itself when the awaited event happens
  (for example "alert opens"); Space always moves on by hand. Escape leaves it without stopping what is running.
- **Shortcuts:** `⌘ K` search and go-to, `G` then a letter to go to a page, `Space`, `←`, `P`, `R`, `N`, `Esc` in
  presenter mode, `A` add anomaly in the editor. Single-key ones are ignored while focus is in a field.

## Security posture

Recorded here so it is not rediscovered. Studio adds a control surface, so it adds to the table in
[operations.md](../../operations.md#security-posture) when it ships (SIM-22).

| Area               | Today (design)                                                                              | If promoted beyond the demo                                     |
| ------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Control API and UI | No authentication. Binds `127.0.0.1`; in Compose the port is published on `127.0.0.1` only. | Authentication and an audit of who ran what; or do not ship it. |
| Reads from ingest  | Through the same unauthenticated read API the rest of the demo uses (V1-T04).               | Bearer token (V2-T04).                                          |
| Fault injection    | Only publishes through the broker the simulator already uses.                               | Not part of a deployment.                                       |

This follows the repository's V1 scope: it does not "fix" the anonymous broker or the open API
([V1-T04](../../tasks/v1/V1-T04-unauthenticated-api-metrics-docs.md)).

## Open questions

1. **Light theme.** _Decided 2026-10-19: no._ Dark only. A light set would need its own checked contrast; revisit if a
   projector demo shows a need.
2. **When the command center adopts Studio's tokens.** The names match; the values will differ until then. The two
   repositories cannot share a package today (copy, publish a tokens package, or generate both from one JSON file).
3. **Where custom scenarios live.** A JSON file under `apps/simulator/` (visible in git, easy to share) versus the
   browser. The mockups assume files; SIM-11 settles it. _For SIM-08 (2026-10-21):_ a read-only folder of `*.json` files
   (`SCENARIOS_DIR`, default `apps/simulator/scenarios`) read once at start, plus scenarios imported during the session, which
   are kept in memory and written nowhere. SIM-11 may move the storage; the document does not change. _Settled in SIM-11 (2026-10-22):_ files in
   `SCENARIOS_DIR`, written by `PUT` and `DELETE /api/scenarios/:name` (custom scenarios only, not while running); an import stays in memory
   until it is saved. See [ADR-0011](../../adr/0011-simulator-studio-control-plane.md).
4. **Benchmark in the same process.** It saturates the broker and the CPU. A child process keeps the UI responsive;
   SIM-15 decides.
5. **Studio's port.** _Decided 2026-10-19: `3200`_ (`3100` ingest, `3000` Grafana, `9090` Prometheus, `5433`
   PostgreSQL are taken in the Compose stack).
6. **Chart library.** The mockups draw SVG. Candidates for the live charts are a tree-shaken ECharts, uPlot, or
   hand-drawn SVG; SIM-06 decides after measuring the bundle. _SIM-05 drew its charts (the Fleet line chart, the
   sparkline and the range bar) as hand-written SVG, with no dependency, because the Fleet comes first._
   _Settled in SIM-06 (2026-10-20): hand-written SVG stays._ Topology's detail row reuses those charts; React Flow draws the
   graph and its cost is measured in [ADR-0011](../../adr/0011-simulator-studio-control-plane.md). ECharts and uPlot are not
   adopted.
7. **Delivery timestamps.** Showing when the outbox delivered, rather than when Studio saw it, needs ingest to expose
   the time in `/api/alerts`. That is a small change to ingest; it is not assumed here.
8. **Twin.** _Decided 2026-10-19:_ option C with a spike, devices hand-placed and marked `illustrative`, the Pipeline hub
   drawn as a floating logical object (see [digital-twin.md](digital-twin.md#decisions)). The spike (SIM-17) decides
   whether to continue.
9. **Alert marker on charts.** _Settled in SIM-05 (2026-10-20): no marker._ Frame 04's device chart shows the state beside
   the device name and draws no alert marker; frames 01, 02 and 15 still draw a bell, a band and rings. The Fleet cards and
   the inspector follow frame 04: the raise and clear lines stay, the part of the line beyond the raise line is amber, and
   the state is the word and icon beside the name. Frames 01, 02 and 15 differ from the build until they are redrawn.
10. **Hold-value dialog.** _Drawn in SIM-05 (2026-10-20)_ from the inspector's control, without a mockup: a modal that
    takes one metric (any metric a selected device reports, the most common first) and one value for all, says before
    anything is sent how many devices it reaches and which it skips, and hands the work to the page's bulk run.
11. **Scenario timeline at scale.** Frame 05 draws one lane per device; above 12 anomalies it groups by zone as the Lab's
    dock does (frame 19). SIM-11 draws the grouped state.
12. **Frames 04 and 10 differ from the build.** _Settled in SIM-06 (2026-10-20)._ The build shows only what Studio can measure:
    no "4 ms" on the Broker (no PUBACK time), no "12 buffered" on Ingest (not forwarded), no "Open" on the command center (Studio
    never reads it); zones carry their code and device count, not a name ("BLD-DC · 2 devices"; the registry has no zone
    names); the line under a device's id is its state in a word and an icon, not its metric; a silent device is grey, as
    drawn, though the Fleet draws it red. Left out: the _Topology | Twin_ switch, the _Data flow | Alerts_ layer switch, the
    scenario chip and the Cause row (SIM-08), "Show in twin", "Open in lab", "Retry now", the labels on the edges. "Retrying
    every 5 s" is "Retrying every 1 s", the poller's real cycle. The broker-disconnected state has no frame and was drawn in
    the language of frame 10. Frames 04 and 10 stay as drawn until they are redrawn.
13. **Frame 13 differs from the build.** _Settled in SIM-07 (2026-10-20)._ The list is paged by the cursor the API returns,
    so there is no "Page 1" button between _Newer_ and _Older_ (a page number would be wrong after a reload) and no count on
    _Open_ (the API gives no total); the line says "Showing 5 alerts · newest first". The address holds the status, the
    severity, the page size and the open alert, not the cursor: a reload opens the newest alerts. Ingest has no severity
    parameter, so the severity filter hides rows of the page already loaded and the list says how many ("Filtering this page:
    2 of 6 shown."). Every time in the trail says whose clock it is ("ingest", "observed", "recorded reading"), besides the
    frame's note. States the frame does not draw were drawn in its language: a delivery that is pending, failed (with
    ingest's error as text) or skipped, a delivery of unknown state, and, for a cleared alert, "Alert cleared" and "Clear
    delivered". The list's delivery chip is the state of the alert's _latest_ outbox event, which for a cleared alert is the
    clearing; the opening's delivery comes from what Studio saw, or says "Opening delivery not known". "Open incident"
    is "Open command center": it goes to the console's root, since which page of the console shows an incident is its own
    route, not checked here; the incident is named by its id beside it, with a copy button. The scenario that caused an
    alert is named only when the simulator can show a run of Studio that played on the alert's device and metric around the
    time it opened; an alert from the CLI's `--scenario`, from a fault added by hand, or from anything else has no cause.
    Frame 13 stays as drawn until it is redrawn.
14. **Frame 03 differs from the build.** _Settled in SIM-08 (2026-10-21)._ Each card's chart is drawn at its true pixel width,
    not scaled from a 330 px picture, so its text is 13 px (the frame's is 11.5 px) and its colours are tokens; a label that
    would not fit, or would run into another, is left off the picture and kept in the flag's tooltip and in the card's text.
    A scenario on one device and one metric gets the value chart, any other the lane chart, at most four lanes and a line
    "+ n more devices, m anomalies". The time axis runs to the next numbered tick past the end (and a quarter more on the value
    chart, for the label of the clear). A clear that may come later than shown reads "about 110 s or later", and one that was not
    found "clear time not known"; with no rules each card says why and draws no chart. **Edit**, **Duplicate**, **Export** and **Delete**, and the dashed **New scenario** card, were added by SIM-11 (question 17). Not built: **Follow** and the Fleet's running-scenario strip wait
    for a page that can take the person there (the Digital twin, SIM-09's controls); the pager is the Fleet's, without the
    first and last buttons; **Import JSON** is in the toolbar, not the header, and opens a file picker. Running a scenario over
    something that already plays on its devices asks first. Frame 03 stays as drawn until it is redrawn.
15. **Frame 11 differs from the build.** _Settled in SIM-09 (2026-10-21)._ The build shows only what Studio can observe or measure:
    the timeline has no "Rule raised" row (the rule fires inside ingest; an alert row names its rule) and no "Anomaly started" row
    (a time inside a run, not an observation); a run's row says what it started. Left out of the figures and the graph: "12 readings
    buffered", the Broker's "4 ms" and the command center's "incident open" (not measured), and the _Topology | Twin_ switch (the twin is
    SIM-18). The frame's own figures disagreed (it counted `hub-power-01` as stopped in the timeline and silent in the sixth card):
    the build follows the brief, availability being the engine's running devices over the registered ones. A figure whose source does
    not answer reads "unknown" with the reason, never zero. The timeline's sources are Fleet, Scenario, Alert, Outbox, Command Center,
    Ingest and Engine (the last two are the build's: `dependency` and `tick-error` observations). The graph's search is `gq` in the
    address, so the timeline's filter keeps `q`; the two scales (12 and 60 devices) are the Topology's. Not built here: the Twin view of
    the card (SIM-18). Frame 11 stays as drawn until it is redrawn.
16. **Frames 12 and 19 differ from the build.** _Settled in SIM-10 (2026-10-21)._ The build shows zone codes (`BLD-01`, `SIM-Z03`), not
    zone names, because the simulator does not know the catalogue; it has no catalogue asset rows and no _Topology | Twin_ switch (SIM-18).
    The trace and the log have no "Broker ack", "Rule raised" or "Anomaly started" rows (not observed by Studio; see question 15). Of
    the eight fault tiles only Breach can be chosen; the rest read "Comes with SIM-12". The stop condition offers Timed and Manual
    ("Alert clears" is disabled). Run and Stop are in the bar, and the log's filters are shown at every size. Frames 12 and 19 stay as
    drawn until they are redrawn.
17. **Frame 05 differs from the build.** _Settled in SIM-11 (2026-10-23)._ The build shows zone codes, not zone names, and no catalogue
    rows (as in questions 14 and 16). A new anomaly is added by the **Add anomaly** button, a plain **A**, or a double-click on a lane
    that already has one; dragging on an empty part of a lane to draw a new block is not built (a lane exists only where an anomaly
    does, and the button picks the device). **Length** (120, 180 and 300 s) is the window the picture shows, not a limit of the
    document: it widens by itself when a later start or a longer duration is typed in, a longer scenario shows its own window, and a
    drag stops at the edge of the window instead of widening it under the pointer. The inspector's preview is the Scenarios cards'
    chart (the value against the raise and clear lines, the amber part beyond the raise line, the alert and the clear as flags);
    the band between the two lines is not tinted and the start and the end are said in a line under the chart, not marked on it.
    The frame has no description field, no Delete, no Export and no state for a scenario that is new or a copy: the build adds a
    **Description** (200 characters), **Export JSON**, **Delete** (after asking) and a **Name** field for a new scenario or a copy
    (a saved scenario's name is shown, not edited: duplicate it, or save it under another name). **Run now** saves a scenario that is
    new or changed before it runs it, and a scenario that is running cannot be saved over or deleted (the editor offers Stop). The
    work in progress is kept for the session when the page is left, and a reload asks first. The Lab's "Open timeline editor" hands
    the page's own timeline over as a new scenario. Frame 05 stays as drawn until it is redrawn.
