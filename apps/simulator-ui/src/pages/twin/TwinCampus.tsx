import {
  type ComponentType,
  lazy,
  type ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TwinLayout, TwinLayoutView } from '../../api/types';
import type { CatalogueBox } from '../../lib/twinCatalogue';
import { isLit } from '../../lib/twinFlow';
import { buildingBounds } from '../../lib/twinGeometry';
import { climb, focusedZone, sameSelection, type TwinSelection } from '../../lib/twinQuery';
import { type CameraNudge, type CameraTarget } from '../../lib/twinCamera';
import type { CameraMove } from '../../lib/twinDemoCamera';
import { tooltipOf } from '../../lib/twinPins';
import { placementSummary, type SceneProblem } from '../../lib/twinStatus';
import { usePulseBus } from '../../state/pulseContext';
import { useStudio } from '../../state/studioContext';
import type { PulseSource, TwinSceneHandle, TwinSceneProps } from '../../twin/TwinScene';
import { Banner } from '../../ui/Banner';
import { Card } from '../../ui/Card';
import { EventTimeline } from '../overview/EventTimeline';
import { SimulationControls } from '../overview/SimulationControls';
import { useOverviewParams } from '../overview/useOverviewParams';
import { useSimulationControls } from '../overview/useSimulationControls';
import styles from './twin.module.css';
import { type CameraButton, TwinControls, type TwinLayers } from './TwinControls';
import { TwinBuildingAssets } from './TwinBuildingAssets';
import { TwinDevices } from './TwinDevices';
import { TwinFocusText } from './TwinFocusText';
import { TwinHub } from './TwinHub';
import { TwinHeatLegend } from './TwinHeatLegend';
import { TwinInject } from './TwinInject';
import { TwinLabels, type TwinLabelsHandle } from './TwinLabels';
import { TwinLegend } from './TwinLegend';
import { TwinLevel } from './TwinLevel';
import { TwinPresenterDock } from './TwinPresenterDock';
import { TwinLoading } from './TwinLoading';
import { TwinPlan } from './TwinPlan';
import { TwinSelectionCard } from './TwinSelectionCard';
import { TwinTooltip } from './TwinTooltip';
import { useGrantedSlots } from './useGrantedSlots';
import { useTwinDemoCamera } from './useTwinDemoCamera';
import { useTwinKeys } from './useTwinKeys';
import { useTwinModel } from './useTwinModel';
import { useTwinParams } from './useTwinParams';

/** What a scene whose code did not load is replaced by: nothing drawn, and the page told, which then shows the fallback. */
function SceneNotLoaded({ onUnavailable }: TwinSceneProps): ReactElement | null {
  useEffect(() => {
    onUnavailable('code-not-loaded');
  }, [onUnavailable]);
  return null;
}

// The scene is its own chunk: it brings three.js and React Three Fiber, which no other page needs. It is requested only
// when the page has checked that the device can draw it and that there is a layout to draw, so a device without WebGL 2
// never downloads it. A chunk that fails to load becomes `SceneNotLoaded` and then the fallback, not a blank page.
type SceneModule = { default: ComponentType<TwinSceneProps> };
const TwinScene = lazy(() =>
  import('../../twin/TwinScene').then(
    (module): SceneModule => ({ default: module.TwinScene }),
    (): SceneModule => ({ default: SceneNotLoaded }),
  ),
);

/** Where the copy of the command center's campus came from, so the picture never looks more certain than its data. */
function sourceLine(layout: TwinLayout): string {
  const { repository, commit, checkedOn } = layout.source;
  return `Zones, boundary and catalogue are a copy of ${repository} at ${commit.slice(0, 7)}, compared on ${checkedOn}; this repository does not check them. Device positions are placed by hand.`;
}

/** The same empty list every render while no building is in focus, so the labels are not handed a new array for nothing. */
const NO_BOXES: readonly CatalogueBox[] = [];

export interface TwinCampusProps {
  /** The simulator's layout, available (the page has checked). */
  view: TwinLayoutView;
  onUnavailable: (problem: SceneProblem) => void;
}

/**
 * The campus (frame 14) once the device can draw it and the simulator gave a layout: the scene with its labels, tooltip and
 * controls; while the scene's code loads, the flat plan with live pins and the loading card (frame 16); the key, the
 * headline and the source; the selection card; the text list of every device; and, under them, the simulation controls and
 * the event timeline of the Overview, so the twin can be driven alone. The selection is in the address (`device`, `zone`);
 * what the pointer is over, the layers and the camera are this page's. Escape climbs one level, Home returns to the
 * campus. Everything it shows of a device comes from Fleet's own rows.
 *
 * One level in (SIM-20, frame 15): the building the selection names (a selected building, or the building of a selected
 * device) is the **focus**, derived from the address and never stored. Choosing a building, or a device of another one,
 * flies the camera to it (the viewer's own action); Escape from a device goes to its building and the camera stays, Escape
 * from a building goes to the campus and the camera flies back, so the level and the view cannot disagree. A page that
 * opens with a building in the address starts at it, with no flight.
 */
export function TwinCampus({ view, onUnavailable }: TwinCampusProps) {
  const [selection, select] = useTwinParams();
  const model = useTwinModel(view, selection);
  const bus = usePulseBus();
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const [hovered, setHovered] = useState<TwinSelection | null>(null);
  const [layers, setLayers] = useState<TwinLayers>({
    devices: true,
    dataFlow: true,
    alerts: true,
    heat: true,
    catalogue: true,
  });
  const scene = useRef<TwinSceneHandle | null>(null);
  const labels = useRef<TwinLabelsHandle | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);

  // A guided-demo step's camera (SIM-21): the move it makes is the page's own (select what it says, fly), and it comes from the
  // step on screen, never from anything else. At mount the scene starts at it instead of flying.
  const applyCameraMove = useCallback(
    (move: CameraMove, flight: boolean) => {
      if (move.select !== undefined) select(move.select);
      if (flight) scene.current?.fly(move.fly);
    },
    [select],
  );
  const demo = useTwinDemoCamera({
    layout: model?.layout ?? null,
    hasFocus: (model?.focus ?? null) !== null,
    apply: applyCameraMove,
  });

  // Where the camera starts: the building the address already names, else the camera of the demo step on screen; decided once,
  // when the first state view has come and the scene is about to be made. (Adjusting state while rendering, the way React
  // documents it for a value derived once.)
  const [start, setStart] = useState<CameraTarget | undefined>(undefined);
  const [startDecided, setStartDecided] = useState(false);
  if (model !== null && !startDecided) {
    setStartDecided(true);
    if (model.focus !== null) setStart({ building: model.focus.bounds });
    else if (demo.startMove !== null) setStart(demo.startMove.fly);
  }

  const controls = useSimulationControls();
  const [overview, updateOverview] = useOverviewParams();
  const controlFocused = useCallback(() => updateOverview({ focus: null }), [updateOverview]);

  // The pointer is over something (reported on every move) / left it. A pin and the building behind it can both report in
  // one move, so a leave clears the hover only if it is still the thing that was left.
  const onHover = useCallback(
    (target: TwinSelection) => setHovered((was) => (sameSelection(was, target) ? was : target)),
    [],
  );
  const onLeave = useCallback(
    (target: TwinSelection) => setHovered((was) => (sameSelection(was, target) ? null : was)),
    [],
  );
  // The scene tells the labels each time the camera moves; they place themselves, with no render of this page.
  const updateLabels = useCallback(
    (matrix: ArrayLike<number>, size: { width: number; height: number }) =>
      labels.current?.update(matrix, size),
    [],
  );

  // The animation budget is the screen's (12 pulsing nodes, 24 glowing lines, shared with the 2D edges). The twin asks on
  // this side of the canvas and hands the scene plain ids: the lit arcs first, in the pins' order, may move dots; a pin
  // with an open alert may pulse its beacon. What is past a cap keeps its look and stands still.
  const litArcs = (model?.flow.arcs ?? []).filter((arc) => isLit(arc.look)).map((arc) => arc.id);
  const grantedArcs = useGrantedSlots('line', layers.dataFlow ? litArcs : []);
  const alertPins = (model?.pins ?? []).filter((pin) => pin.alert !== null).map((pin) => pin.id);
  const movingBeacons = useGrantedSlots('node', layers.alerts ? alertPins : []);
  // What the engine published, for the devices that have a pin: a dot is drawn for each, and for nothing else.
  const pinIds = (model?.pins ?? []).map((pin) => pin.id).join('\u0000');
  const pulses = useMemo<PulseSource>(
    () => (listener) => bus.subscribe(pinIds === '' ? [] : pinIds.split('\u0000'), listener),
    [bus, pinIds],
  );

  const layout = model?.layout ?? null;
  const focus = model?.focus ?? null;
  const focusCode = focus?.code ?? null;
  const focusBounds = focus?.bounds ?? null;

  // The catalogue boxes that belong to this level (the other buildings' are drawn dimmer and not labelled): their count is
  // the layer's, and in a focused building they are labelled.
  const boxes = model?.catalogue.boxes;
  const ownBoxes = useMemo(() => (boxes ?? []).filter((box) => !box.faded), [boxes]);
  const assetLabels = focusCode !== null && layers.catalogue ? ownBoxes : NO_BOXES;

  // Choosing something: a building, or a device of another building, takes the camera there; a device of the building in
  // focus does not move it.
  const choose = useCallback(
    (target: TwinSelection) => {
      select(target);
      if (layout === null) return;
      const code = focusedZone(target, layout);
      if (code === null || code === focusCode) return;
      const bounds = buildingBounds(layout, code);
      if (bounds !== null) scene.current?.fly({ building: bounds });
    },
    [select, layout, focusCode],
  );
  // One step up. A device climbs to its building with the camera where it is; a building climbs to the campus and the camera
  // flies back to it.
  const escape = useCallback(() => {
    if (selection === null) return false;
    const next = layout === null ? null : climb(selection, layout);
    select(next);
    if (next === null && focusCode !== null) scene.current?.fly('campus');
    return true;
  }, [selection, layout, select, focusCode]);
  const home = useCallback(() => {
    scene.current?.fly('campus');
    select(null);
  }, [select]);
  const toBuilding = useCallback(() => {
    if (focusCode !== null) select({ type: 'zone', id: focusCode });
  }, [select, focusCode]);
  const nudge = useCallback((step: CameraNudge) => scene.current?.nudge(step), []);
  const preset = useCallback(
    (target: CameraButton) => {
      if (target !== 'building') scene.current?.fly(target);
      else if (focusBounds !== null) scene.current?.fly({ building: focusBounds });
    },
    [focusBounds],
  );
  useTwinKeys(stage, { escape, home, nudge, presenting: demo.presenting });

  if (model === null) {
    return (
      <>
        <p role="status">Waiting for the first message from the simulator…</p>
        <TwinPresenterDock problem={null} />
      </>
    );
  }

  const summary = placementSummary(view);
  const selectedDevice = selection?.type === 'device' ? selection.id : null;
  // The device the "Inject at" card aims at: the selected one, when the simulator has it. A building has no card (its devices are chosen).
  const injectDevice =
    selectedDevice === null
      ? null
      : (model.rows.find((row) => row.device.id === selectedDevice)?.device ?? null);
  const hoveredDevice = hovered?.type === 'device' ? hovered.id : null;
  const missing = model.catalogue.missing;

  return (
    <div data-stale={model.stale ? 'true' : undefined}>
      <TwinLevel
        level={model.level}
        focus={focus}
        state={focus === null ? null : (model.buildings[focus.code] ?? null)}
        onCampus={home}
        onBuilding={toBuilding}
      />
      <div className={styles.campus}>
        <Card title={focus === null ? 'Campus' : `${focus.zone.name} interior`}>
          <div
            ref={stage}
            className={styles.stage}
            tabIndex={0}
            role="group"
            aria-label={`${focus === null ? 'Campus view' : `${focus.zone.name} view`}. With focus here, the arrow keys pan and plus and minus zoom; Escape goes up one level and Home returns to the campus.`}
          >
            <Suspense
              fallback={
                <>
                  <TwinPlan layout={model.layout} pins={model.pins} selectedId={selectedDevice} />
                  <TwinLoading zones={model.layout.zones.length} devices={model.pins.length} />
                </>
              }
            >
              <TwinScene
                ref={scene}
                layout={model.layout}
                pins={model.pins}
                buildingStates={model.buildings}
                catalogue={model.catalogue.boxes}
                focusedCode={focusCode}
                start={start}
                heat={model.heat}
                flow={model.flow}
                granted={grantedArcs}
                moving={movingBeacons}
                pulses={pulses}
                layers={layers}
                selection={selection}
                hovered={hovered}
                onHover={onHover}
                onLeave={onLeave}
                onSelect={choose}
                onView={updateLabels}
                onUnavailable={onUnavailable}
                className={styles.scene}
              />
            </Suspense>
            {layers.devices || layers.dataFlow ? (
              <TwinLabels
                ref={labels}
                pins={layers.devices ? model.pins : []}
                selection={selection}
                hoveredId={hoveredDevice}
                hub={layers.dataFlow ? model.flow.hub : null}
                alerts={layers.alerts}
                assets={assetLabels}
              />
            ) : null}
            <TwinTooltip
              stage={stage}
              target={hovered}
              content={tooltipOf(hovered, model.layout, model.pins, model.buildings)}
            />
            <TwinControls
              link={link}
              lostSince={lostSince}
              layers={layers}
              catalogueCount={ownBoxes.length}
              focusedName={focus?.zone.name ?? null}
              onLayers={setLayers}
              onPreset={preset}
              onNudge={nudge}
            />
            {layers.heat ? <TwinHeatLegend heat={model.heat} /> : null}
          </div>
          <TwinLegend />
          <p className={styles.status}>{summary.headline}</p>
          <p className={styles.source}>{sourceLine(model.layout)}</p>
          {summary.notes.length > 0 ? (
            <Banner tone="warn">
              <span>Not drawn: the layout has no position for these devices.</span>
              <ul className={styles.notes}>
                {summary.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Banner>
          ) : null}
          {missing.length > 0 ? (
            <Banner tone="warn">
              Not drawn: the layout lacks these campus-level catalogue assets: {missing.join(', ')}.
            </Banner>
          ) : null}
        </Card>
        <div className={styles.aside}>
          <TwinPresenterDock problem={demo.problem} />
          <TwinSelectionCard selection={selection} model={model} onSelect={choose} />
          {injectDevice === null ? null : (
            <TwinInject key={injectDevice.id} device={injectDevice} />
          )}
          {focus === null ? null : <TwinBuildingAssets focus={focus} />}
        </div>
      </div>

      <TwinDevices
        rows={model.list}
        selectedId={selectedDevice}
        now={model.now}
        onSelect={(id) => choose({ type: 'device', id })}
      />
      <TwinHub hub={model.flow.hub} faultLines={model.faultLines} />
      <TwinFocusText level={model.level} focus={focus} model={model} />

      <div className={styles.simRow}>
        <SimulationControls
          controls={controls}
          scenario={overview.scenario}
          onScenario={(scenario) => updateOverview({ scenario })}
          focus={overview.focus}
          onFocused={controlFocused}
        />
        <EventTimeline
          query={overview.events}
          onQuery={(events) => updateOverview({ events })}
          now={model.now}
        />
      </div>
    </div>
  );
}
