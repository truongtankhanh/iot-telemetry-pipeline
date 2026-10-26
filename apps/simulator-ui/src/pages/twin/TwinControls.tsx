import type { CameraNudge, CameraPreset } from '../../lib/twinCamera';
import { formatClockTime } from '../../lib/time';
import type { LinkState } from '../../state/store';
import { Button } from '../../ui/Button';
import { uiIcons } from '../../ui/icons';
import { Pill } from '../../ui/Pill';
import { Switch } from '../../ui/Switch';
import styles from './twinStage.module.css';

export interface TwinLayers {
  devices: boolean;
  catalogue: boolean;
}

export interface TwinControlsProps {
  link: LinkState;
  lostSince: number | null;
  layers: TwinLayers;
  /** The catalogue assets the campus layer draws (frame 14: "Catalogue · 9"). */
  catalogueCount: number;
  onLayers: (layers: TwinLayers) => void;
  onPreset: (preset: CameraPreset) => void;
  onNudge: (nudge: CameraNudge) => void;
}

/**
 * The controls over the scene (frame 14): the state of the link and the layers at the top left, and the camera at the
 * bottom right — the presets _Campus_ and _Top_ (flights of 600 ms) and the buttons that turn, zoom and reset the view.
 * Every control is a real button or switch with a name, so the camera has a keyboard path that does not need the scene to
 * be focused. The presets are actions and not a choice: the viewer can move the camera off one, so none is shown as
 * "current". Layers for data flow, alerts and heat arrive with the tickets that draw them.
 */
export function TwinControls({
  link,
  lostSince,
  layers,
  catalogueCount,
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
