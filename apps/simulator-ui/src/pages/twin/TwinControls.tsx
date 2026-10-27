import type { CameraNudge } from '../../lib/twinCamera';
import { formatClockTime } from '../../lib/time';
import type { LinkState } from '../../state/store';
import { Button } from '../../ui/Button';
import { uiIcons } from '../../ui/icons';
import { Pill } from '../../ui/Pill';
import { Switch } from '../../ui/Switch';
import styles from './twinStage.module.css';

export interface TwinLayers {
  devices: boolean;
  /** The Pipeline hub, the arc from each pin to it and the dots that travel the arcs. */
  dataFlow: boolean;
  /** The beacons of open alerts and the alert chip on a label. */
  alerts: boolean;
  /** The floor of the building in focus: tinted by temperature (interpolated), or hatched when there is none to show. */
  heat: boolean;
  catalogue: boolean;
}

/** Where the camera buttons send it: the whole campus, the building in focus, or overhead. */
export type CameraButton = 'campus' | 'building' | 'top';

export interface TwinControlsProps {
  link: LinkState;
  lostSince: number | null;
  layers: TwinLayers;
  /** The catalogue assets the layer draws (frame 14: "Catalogue · 9" at campus level; frame 15: "Catalogue · 8" in a building). */
  catalogueCount: number;
  /** The name of the building in focus, which names the middle camera button; `null` at campus level. */
  focusedName: string | null;
  onLayers: (layers: TwinLayers) => void;
  onPreset: (preset: CameraButton) => void;
  onNudge: (nudge: CameraNudge) => void;
}

/**
 * The controls over the scene (frame 14): the state of the link and the layers at the top left, and the camera at the
 * bottom right — the presets _Campus_, the focused building (named after it, disabled while none is) and _Top_ (flights of
 * 600 ms) and the buttons that turn, zoom and reset the view.
 * Every control is a real button or switch with a name, so the camera has a keyboard path that does not need the scene to
 * be focused. The presets are actions and not a choice: the viewer can move the camera off one, so none is shown as
 * "current". The layers are Devices, Data flow, Alerts, Heat (the floor of the building in focus; frame 15) and Catalogue.
 */
export function TwinControls({
  link,
  lostSince,
  layers,
  catalogueCount,
  focusedName,
  onLayers,
  onPreset,
  onNudge,
}: TwinControlsProps) {
  return (
    <>
      <div className={styles.overlayTop}>
        {link === 'live' ? (
          <Pill label="Live" tone="ok" />
        ) : link === 'lost' ? (
          <Pill
            label="Lost"
            tone="bad"
            detail={lostSince === null ? null : `at ${formatClockTime(lostSince)}`}
          />
        ) : (
          <Pill label="Connecting" tone="unknown" />
        )}
        <section className={styles.layers} aria-label="Layers">
          <h3 className={styles.layersTitle}>Layers</h3>
          <Switch
            label="Devices"
            checked={layers.devices}
            onChange={(devices) => onLayers({ ...layers, devices })}
          />
          <Switch
            label="Data flow"
            checked={layers.dataFlow}
            onChange={(dataFlow) => onLayers({ ...layers, dataFlow })}
          />
          <Switch
            label="Alerts"
            checked={layers.alerts}
            onChange={(alerts) => onLayers({ ...layers, alerts })}
          />
          <Switch
            label="Heat"
            checked={layers.heat}
            onChange={(heat) => onLayers({ ...layers, heat })}
          />
          <Switch
            label={`Catalogue · ${catalogueCount}`}
            checked={layers.catalogue}
            onChange={(catalogue) => onLayers({ ...layers, catalogue })}
          />
        </section>
      </div>

      <div className={styles.tools}>
        <div className={styles.toolGroup} role="group" aria-label="Camera">
          <Button variant="ghost" size="sm" onClick={() => onPreset('campus')}>
            Campus
          </Button>
          {/* Always there, so the group does not jump about; it works only while a building is in focus. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={focusedName === null}
            onClick={() => onPreset('building')}
          >
            {focusedName ?? 'Building'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onPreset('top')}>
            Top
          </Button>
        </div>
        <div className={styles.toolGroup} role="group" aria-label="Move the camera">
          <Button
            variant="ghost"
            size="sm"
            icon={uiIcons.rotateLeft}
            aria-label="Rotate left"
            onClick={() => onNudge('rotate-left')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={uiIcons.rotateRight}
            aria-label="Rotate right"
            onClick={() => onNudge('rotate-right')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={uiIcons.plus}
            aria-label="Zoom in"
            onClick={() => onNudge('zoom-in')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={uiIcons.minus}
            aria-label="Zoom out"
            onClick={() => onNudge('zoom-out')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={uiIcons.fit}
            aria-label="Reset camera"
            onClick={() => onPreset('campus')}
          />
        </div>
      </div>
    </>
  );
}
