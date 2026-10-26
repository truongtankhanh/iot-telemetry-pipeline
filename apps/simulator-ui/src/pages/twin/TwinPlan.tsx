import { type CSSProperties, useMemo } from 'react';
import type { TwinLayout } from '../../api/types';
import type { DeviceShape } from '../../lib/deviceIdentity';
import { planOf } from '../../lib/twinPlan';
import type { TwinPin } from '../../lib/twinPins';
import styles from './twinStage.module.css';

const points = (shape: readonly [number, number][]) =>
  shape.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** A device's mark on the plan, in a box one unit either side of its centre; the ring is the state (frame 14, frame 16). */
function Mark({ shape }: { shape: DeviceShape }) {
  switch (shape) {
    case 'circle':
      return <circle r="0.7" />;
    case 'hexagon':
      return <polygon points="0.7,0 0.35,0.62 -0.35,0.62 -0.7,0 -0.35,-0.62 0.35,-0.62" />;
    case 'rounded':
      return <rect x="-0.65" y="-0.65" width="1.3" height="1.3" rx="0.5" />;
    case 'rounded-square':
      return <rect x="-0.65" y="-0.65" width="1.3" height="1.3" rx="0.25" />;
  }
}

export interface TwinPlanProps {
  layout: Pick<TwinLayout, 'zones' | 'boundary'>;
  pins: readonly TwinPin[];
  selectedId: string | null;
}

/**
 * The flat plan of the campus, shown while the 3D code loads (frame 16): the boundary, the zones and the buildings'
 * footprints as SVG, seen from the home camera's direction, and the devices as live marks on it — shape for the kind,
 * ring for the state, dashed when the device is not reporting. It is drawn from the layout the page already has and the
 * pins the scene will draw, so nothing waits for the 3D code and the picture does not change what it says when the scene
 * replaces it. The marks are DOM, placed by their share of the picture, which is why the box keeps the plan's aspect ratio (the frame is a size container, and the box is as large as fits in it).
 * It is an image with a text alternative; the page's text list carries every value.
 */
export function TwinPlan({ layout, pins, selectedId }: TwinPlanProps) {
  const plan = useMemo(() => planOf(layout), [layout]);
  const { x, y, width, height } = plan.viewBox;

  return (
    <div className={styles.planFrame}>
      <div
        className={styles.plan}
        style={{ '--plan-ratio': plan.aspect } as CSSProperties}
        role="img"
        aria-label={`Flat site plan of the campus with ${pins.length} devices, shown while the 3D view loads.`}
      >
        <svg className={styles.planSvg} viewBox={`${x} ${y} ${width} ${height}`} aria-hidden="true">
          <polygon className={styles.planBoundary} points={points(plan.boundary)} />
          {plan.zones.map((zone) => (
            <polygon
              key={zone.code}
              className={styles.planZone}
              data-kind={zone.kind}
              points={points(zone.points)}
            />
          ))}
          {plan.buildings.map((building) => (
            <polygon
              key={building.code}
              className={styles.planBuilding}
              points={points(building.points)}
            />
          ))}
        </svg>
        {pins.map((pin) => {
          const [east, , minusNorth] = pin.stemBase;
          const spot = plan.share(east, -minusNorth || 0);
          return (
            <svg
              key={pin.id}
              className={styles.planPin}
              data-state={pin.id === selectedId ? 'selected' : pin.state}
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
              viewBox="-1 -1 2 2"
              aria-hidden="true"
            >
              <Mark shape={pin.shape} />
            </svg>
          );
        })}
      </div>
    </div>
  );
}
