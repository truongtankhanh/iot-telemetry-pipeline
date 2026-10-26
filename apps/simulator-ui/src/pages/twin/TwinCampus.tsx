import {
  type ComponentType,
  lazy,
  type ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { TwinLayout, TwinLayoutView } from '../../api/types';
import { climb, sameSelection, type TwinSelection } from '../../lib/twinQuery';
import { type CameraNudge, type CameraPreset } from '../../lib/twinCamera';
import { tooltipOf } from '../../lib/twinPins';
import { placementSummary, type SceneProblem } from '../../lib/twinStatus';
import { useStudio } from '../../state/studioContext';
import type { TwinSceneHandle, TwinSceneProps } from '../../twin/TwinScene';
import { Banner } from '../../ui/Banner';
import { Card } from '../../ui/Card';
import { EventTimeline } from '../overview/EventTimeline';
import { SimulationControls } from '../overview/SimulationControls';
import { useOverviewParams } from '../overview/useOverviewParams';
import { useSimulationControls } from '../overview/useSimulationControls';
import styles from './twin.module.css';
import { TwinControls, type TwinLayers } from './TwinControls';
import { TwinDevices } from './TwinDevices';
import { TwinLabels, type TwinLabelsHandle } from './TwinLabels';
import { TwinLegend } from './TwinLegend';
import { TwinLoading } from './TwinLoading';
import { TwinPlan } from './TwinPlan';
import { TwinSelectionCard } from './TwinSelectionCard';
import { TwinTooltip } from './TwinTooltip';
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
 */
export function TwinCampus({ view, onUnavailable }: TwinCampusProps) {
  const [selection, select] = useTwinParams();
  const model = useTwinModel(view, selection);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const [hovered, setHovered] = useState<TwinSelection | null>(null);
  const [layers, setLayers] = useState<TwinLayers>({ devices: true, catalogue: true });
  const scene = useRef<TwinSceneHandle | null>(null);
  const labels = useRef<TwinLabelsHandle | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);

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

  const layout = model?.layout ?? null;
  const escape = useCallback(() => {
    if (selection === null) return false;
    select(layout === null ? null : climb(selection, layout));
    return true;
  }, [selection, layout, select]);
  const home = useCallback(() => {
    scene.current?.fly('campus');
    select(null);
  }, [select]);
  const nudge = useCallback((step: CameraNudge) => scene.current?.nudge(step), []);
  const preset = useCallback((target: CameraPreset) => scene.current?.fly(target), []);
  useTwinKeys(stage, { escape, home, nudge });

  if (model === null) {
    return <p role="status">Waiting for the first message from the simulator…</p>;
  }

  const summary = placementSummary(view);
  const selectedDevice = selection?.type === 'device' ? selection.id : null;
  const hoveredDevice = hovered?.type === 'device' ? hovered.id : null;
  const missing = model.catalogue.missing;

  return (
    <div data-stale={model.stale ? 'true' : undefined}>
      <div className={styles.campus}>
        <Card title="Campus">
          <div
            ref={stage}
            className={styles.stage}
            tabIndex={0}
            role="group"
            aria-label="Campus view. With focus here, the arrow keys pan and plus and minus zoom; Escape goes up one level and Home returns to the campus."
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
                catalogue={model.catalogue.drawn}
                layers={layers}
                selection={selection}
                hovered={hovered}
                onHover={onHover}
                onLeave={onLeave}
                onSelect={select}
                onView={updateLabels}
                onUnavailable={onUnavailable}
                className={styles.scene}
              />
            </Suspense>
            {layers.devices ? (
              <TwinLabels
                ref={labels}
                pins={model.pins}
                selection={selection}
                hoveredId={hoveredDevice}
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
              catalogueCount={model.catalogue.drawn.length}
              onLayers={setLayers}
              onPreset={preset}
              onNudge={nudge}
            />
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
        <TwinSelectionCard selection={selection} model={model} onSelect={select} />
      </div>

      <TwinDevices
        rows={model.list}
        selectedId={selectedDevice}
        now={model.now}
        onSelect={(id) => select({ type: 'device', id })}
      />

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
