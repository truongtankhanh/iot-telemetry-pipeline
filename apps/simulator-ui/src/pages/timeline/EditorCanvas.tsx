import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { DeviceInfo, RulesView } from '../../api/types';
import { buildDock, type DockLane } from '../../lib/labTimeline';
import { createAddAnomalyShortcut } from '../../lib/shortcuts';
import { defaultAnomaly } from '../../lib/timelineDefaults';
import { addEntryDisabledReason, anomaliesOf, lengthOf, snapTo } from '../../lib/timelineEditor';
import {
  groupedAbove,
  keyEdit,
  timeAt,
  toggleZone,
  windowOptions,
} from '../../lib/timelineGeometry';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { useElementWidth } from '../../ui/charts/useElementWidth';
import { uiIcons } from '../../ui/icons';
import { Segmented } from '../../ui/Segmented';
import { Switch } from '../../ui/Switch';
import { TimelinePicture } from '../lab/TimelinePicture';
import type { ExpectedImpact } from '../lab/useExpectedImpact';
import { useRunElapsed } from '../scenarios/useRunElapsed';
import styles from './editorCanvas.module.css';
import type { EditorCommands } from './useEditorCommands';
import { usePointerEdit } from './usePointerEdit';
import type { ScenarioEditor } from './useScenarioEditor';

/** The width before the picture's own is known, and in a test, which has no `ResizeObserver`. */
const FALLBACK_WIDTH = 900;
/** A device lane in the editor is taller than in the Lab's dock, to give the value line and the grips room. */
const LANE_PX = 60;

const RULES_UNKNOWN: RulesView = {
  available: false,
  reason: 'The rules have not arrived',
  items: [],
};

/** The x of a pointer on the picture, in the picture's own units (the page may be scaled). */
function unitsX(element: SVGElement, clientX: number, widthUnits: number): number {
  const rect = (element.ownerSVGElement ?? element).getBoundingClientRect();
  return rect.width > 0 ? (clientX - rect.left) * (widthUnits / rect.width) : clientX - rect.left;
}

/** Gives its children the seconds into the run of the scenario; only drawn while it runs, because it owns a one-second timer. */
function RunElapsed({
  scenario,
  lengthS,
  children,
}: {
  scenario: string;
  lengthS: number;
  children: (elapsedS: number | null) => ReactNode;
}) {
  return children(useRunElapsed(scenario, lengthS));
}

interface EditorPictureProps {
  editor: ScenarioEditor;
  impact: ExpectedImpact;
  devices: readonly DeviceInfo[];
  rules: RulesView;
  width: number;
  elapsedS: number | null;
  /** The zones of a grouped timeline that are open. */
  expanded: ReadonlySet<string>;
  onToggleZone(zone: string): void;
  /** The playhead is scrubbed on the ruler (not while the scenario runs). */
  onScrub: ((seconds: number) => void) | null;
  onAdd(at: { deviceId: string; metric: string; startAt: number }): void;
  /** The element whose blocks the Up and Down keys move between. */
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * The timeline picture with the editor's handlers. A component of its own, not a function inside the canvas: it holds the
 * pointer drag, which must survive the canvas being drawn again.
 */
function EditorPicture({
  editor,
  impact,
  devices,
  rules,
  width,
  elapsedS,
  expanded,
  onToggleZone,
  onScrub,
  onAdd,
  containerRef,
}: EditorPictureProps) {
  const { doc, step, windowS, selectedId } = editor;
  const grouped = groupedAbove(doc.entries.length);
  const model = buildDock({
    anomalies: anomaliesOf(doc),
    pending: [],
    expected: impact.preview?.expected ?? null,
    devices,
    rules,
    width,
    grouped,
    elapsedS,
    ids: doc.entries.map((entry) => entry.id),
    selectedId,
    windowS,
    ...(grouped ? { expanded } : {}),
    laneHeight: LANE_PX,
    markInside: true,
    alertRows: true,
  });

  const edit = usePointerEdit({
    axis: model.axis,
    widthUnits: model.width,
    getDoc: () => doc,
    select: editor.select,
    move: editor.move,
    resize: editor.resize,
    restore: editor.restore,
  });
  const order = model.lanes.flatMap((lane) => lane.blocks).flatMap((b) => (b.id ? [b.id] : []));

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, id: string) => {
    const entry = doc.entries.find((candidate) => candidate.id === id);
    if (entry === undefined) return;
    const { anomaly } = entry;
    const key = keyEdit(event.key, { shift: event.shiftKey, alt: event.altKey }, step);
    if (key !== null) {
      event.preventDefault();
      if (key.action === 'move') editor.move(id, snapTo(anomaly.startAt, step) + key.delta);
      else if (key.action === 'resize-end') {
        editor.resize(id, 'end', snapTo(anomaly.startAt + anomaly.duration, step) + key.delta);
      } else editor.resize(id, 'start', snapTo(anomaly.startAt, step) + key.delta);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      editor.remove(id);
    } else if (event.key === 'Escape') {
      editor.select(null);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = order[order.indexOf(id) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next !== undefined) {
        containerRef.current?.querySelector<SVGGElement>(`[data-block-id="${next}"]`)?.focus();
      }
    }
  };

  const scrub = (event: ReactPointerEvent<SVGRectElement>) => {
    onScrub?.(timeAt(model.axis, unitsX(event.currentTarget, event.clientX, model.width)));
  };

  const onLaneAdd = (lane: DockLane, event: ReactMouseEvent<SVGRectElement>) => {
    const t = timeAt(model.axis, unitsX(event.currentTarget, event.clientX, model.width));
    onAdd({ deviceId: lane.label, metric: lane.sub, startAt: snapTo(t, step) });
  };

  return (
    <>
      <TimelinePicture
        model={model}
        editing={{
          selectedId,
          dragging: edit.dragging,
          onSelect: editor.select,
          bind: edit.bind,
          onKeyDown,
          onToggleZone,
          onLaneAdd,
          ...(onScrub === null
            ? {}
            : {
                ruler: {
                  onPointerDown: (event: ReactPointerEvent<SVGRectElement>) => {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    scrub(event);
                  },
                  onPointerMove: (event: ReactPointerEvent<SVGRectElement>) => {
                    if (event.buttons === 1) scrub(event);
                  },
                },
              }),
        }}
      />
      {model.alertsNote !== null ? (
        <p className={styles.note} role="status">
          {model.alertsNote}
        </p>
      ) : null}
    </>
  );
}

export interface EditorCanvasProps {
  editor: ScenarioEditor;
  commands: EditorCommands;
  /** What the simulator says the rules do with the scenario, asked by the page. */
  impact: ExpectedImpact;
}

/**
 * The editor's canvas (frame 05): the Snap switch and the Length of the window, Add anomaly, and the timeline picture. The
 * picture is the Lab's drawing with the editor's extras: blocks that are selected, moved and resized with the pointer (grips
 * on the selected one) or the keyboard, zones that open into their devices above 12 anomalies, the alerts the simulator
 * expects, one row each, and a playhead that follows the run while the scenario plays and is scrubbed on the ruler otherwise.
 *
 * Keys on a block: the arrows move it by the snap step; Shift and the arrows move its end; Alt and Shift its start; Up and Down
 * go to the previous and the next block; Delete removes it; Escape lets go of the selection. A plain `A` anywhere on the page
 * adds an anomaly. Everything a pointer does can also be done in the inspector's fields.
 */
export function EditorCanvas({ editor, commands, impact }: EditorCanvasProps) {
  const { doc, selectedId, devices } = editor;
  const [ref, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const rules = useStudio((state) => state.view?.rules) ?? RULES_UNKNOWN;
  const profiles = useStudio((state) => state.view?.profiles);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [scrubS, setScrubS] = useState<number | null>(null);

  const count = doc.entries.length;
  const lengthS = lengthOf(doc);
  const full = addEntryDisabledReason(doc);

  const { add: addEntry, setMessage } = editor;
  const add = useCallback(
    (at?: { deviceId: string; metric: string; startAt: number }) => {
      const made = defaultAnomaly({
        doc,
        devices,
        rules,
        profiles: profiles ?? {},
        selectedId,
        ...(at === undefined ? {} : { at }),
      });
      if (made === null) {
        setMessage({
          tone: 'note',
          text:
            at === undefined
              ? 'There is no device to put an anomaly on'
              : 'There is no room for an anomaly there',
        });
        return;
      }
      addEntry(made);
    },
    [doc, devices, rules, profiles, selectedId, addEntry, setMessage],
  );

  // A plain A adds an anomaly, on this page only and not while a field has the focus.
  useEffect(() => {
    const isAdd = createAddAnomalyShortcut();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (full === null && isAdd(event)) {
        event.preventDefault();
        add();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [add, full]);

  const pictureAt = (elapsedS: number | null) => (
    <EditorPicture
      editor={editor}
      impact={impact}
      devices={devices}
      rules={rules}
      width={width}
      elapsedS={elapsedS}
      expanded={expanded}
      onToggleZone={(zone) => setExpanded((was) => toggleZone(was, zone))}
      onScrub={commands.running ? null : setScrubS}
      onAdd={add}
      containerRef={ref}
    />
  );

  return (
    <Card
      title="Timeline"
      aside={
        <div className={styles.controls}>
          <Switch checked={editor.snap} onChange={editor.setSnap} label="Snap to 5 s" />
          <Segmented
            label="Length"
            value={String(editor.windowS)}
            onChange={(value) => editor.setWindow(Number(value))}
            options={windowOptions(lengthS).map((option) => ({
              value: String(option.value),
              label: option.label,
              disabled: option.disabled,
            }))}
          />
        </div>
      }
    >
      <div className={styles.bar}>
        <Button
          size="sm"
          variant="outline"
          icon={uiIcons.plus}
          disabled={full !== null}
          onClick={() => add()}
        >
          Add anomaly
        </Button>
        <span className={styles.hint}>
          {full ??
            'Double-click a lane, or press A. Drag a block to move it, its edges to resize it.'}
        </span>
      </div>

      <div className={styles.scroll} ref={ref}>
        {count === 0 ? (
          <p className={styles.empty}>
            Nothing on the timeline yet. Choose Add anomaly, or press A.
          </p>
        ) : commands.running ? (
          <RunElapsed scenario={doc.name} lengthS={lengthS}>
            {(elapsed) => pictureAt(elapsed)}
          </RunElapsed>
        ) : (
          pictureAt(scrubS)
        )}
      </div>
      {impact.status === 'error' && impact.error !== null ? (
        <p className={styles.note} role="status">
          The expected alerts could not be worked out: {impact.error}
        </p>
      ) : null}
    </Card>
  );
}
