import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  type Group,
  Line,
  LineDashedMaterial,
  LineLoop,
  PlaneGeometry,
  Vector3,
} from 'three';
import { LENS } from '../lib/twinCamera';
import type { HubModel } from '../lib/twinFlow';
import { crossColors, hubColor, stateColors } from './twinColors';

/** The hub is drawn this wide (a radius in metres): a mark over the campus, large enough to read at the home distance. */
const HUB_RADIUS_M = 34;
const GROUND_RING_RADIUS_M = 9;
const RING_POINTS = 64;
const DASH_M = 5;
const GAP_M = 4;
const FILL_OPACITY = 0.08;
/** The crosses are drawn in pixels: an arm's length and thickness, and how far the malformed one stands to the right. */
const DOWN_ARM_PX = 30;
const MALFORMED_ARM_PX = 18;
const ARM_THICKNESS_PX = 4;
const MALFORMED_OFFSET_PX = 36;

function ringPoints(radius: number, y: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < RING_POINTS; i += 1) {
    const angle = (i / RING_POINTS) * Math.PI * 2;
    points.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }
  return points;
}

/** A dashed line of the hub: dashes need each point's distance from the start, which `computeLineDistances` writes. */
function dashed<T extends Line>(make: (material: LineDashedMaterial) => T, color: number): T {
  const object = make(
    new LineDashedMaterial({
      color,
      dashSize: DASH_M,
      gapSize: GAP_M,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
  object.computeLineDistances();
  object.renderOrder = 7;
  return object;
}

function buildOutline(color: number, groundY: number): Line[] {
  const ring = new BufferGeometry();
  ring.setAttribute('position', new Float32BufferAttribute(ringPoints(HUB_RADIUS_M, 0), 3));
  const groundRing = new BufferGeometry();
  groundRing.setAttribute(
    'position',
    new Float32BufferAttribute(ringPoints(GROUND_RING_RADIUS_M, groundY), 3),
  );
  const stem = new BufferGeometry();
  stem.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, groundY, 0], 3));
  return [
    dashed((material) => new LineLoop(ring, material), color),
    dashed((material) => new LineLoop(groundRing, material), color),
    dashed((material) => new Line(stem, material), color),
  ];
}

export interface HubProps {
  hub: HubModel;
  visible: boolean;
}

/**
 * The logical Pipeline hub (SIM-19): a dashed ring floating over the middle of the campus and a dashed stem to a small
 * ring on the ground, in the accent colour, because the hub stands for the broker and ingest and the pipeline has no place
 * on the campus. The twin draws it floating so that it does not pretend to have one. The ring is grey when Studio has lost
 * its link to the simulator (what is shown is old). A red cross stands on the hub while the pipeline is down (broker
 * disconnected, ingest unreachable); a small amber one beside it while a malformed fault is on. The crosses face the camera
 * and keep their size in pixels. Its words are in the label (DOM) and the text twin. Not pickable; its geometries and
 * materials are **disposed** when it changes or the scene unmounts.
 */
export function Hub({ hub, visible }: HubProps) {
  const invalidate = useThree((state) => state.invalidate);
  const billboard = useRef<Group | null>(null);
  const scratch = useMemo(() => new Vector3(), []);

  const ringColor = hub.status.state === 'unknown' ? stateColors.stale : hubColor;
  const [x, y, z] = hub.anchor;
  const outline = useMemo(() => buildOutline(ringColor, -y), [ringColor, y]);
  const fill = useMemo(() => new CircleGeometry(HUB_RADIUS_M, RING_POINTS), []);
  const arm = useMemo(() => new PlaneGeometry(1, 1), []);

  useEffect(
    () => () => {
      for (const line of outline) {
        line.geometry.dispose();
        (line.material as LineDashedMaterial).dispose();
      }
    },
    [outline],
  );
  useEffect(
    () => () => {
      fill.dispose();
      arm.dispose();
    },
    [fill, arm],
  );
  useEffect(() => invalidate(), [hub, visible, invalidate]);

  // The crosses face the camera and are `1` world unit per pixel at the hub's distance.
  const tanHalfFov = Math.tan((LENS.fov * Math.PI) / 360);
  useFrame(({ camera, size }) => {
    const group = billboard.current;
    if (group === null) return;
    const metresPerPixel = (2 * tanHalfFov) / Math.max(1, size.height);
    group.quaternion.copy(camera.quaternion);
    group.scale.setScalar(
      group.getWorldPosition(scratch).distanceTo(camera.position) * metresPerPixel,
    );
  });

  if (!visible) return null;
  const down = hub.status.state === 'down';
  return (
    <group position={[x, y, z]}>
      {outline.map((object) => (
        <primitive key={object.id} object={object} />
      ))}
      <mesh geometry={fill} rotation-x={-Math.PI / 2} renderOrder={4}>
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={FILL_OPACITY}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {down || hub.cross !== null ? (
        <group ref={billboard}>
          {down ? <Cross geometry={arm} color={crossColors.down} arm={DOWN_ARM_PX} x={0} /> : null}
          {hub.cross !== null ? (
            <Cross
              geometry={arm}
              color={crossColors.malformed}
              arm={MALFORMED_ARM_PX}
              x={down ? MALFORMED_OFFSET_PX : 0}
            />
          ) : null}
        </group>
      ) : null}
    </group>
  );
}

/** Two arms crossing, in pixels, at `x` pixels to the right of the hub's centre. */
function Cross({
  geometry,
  color,
  arm,
  x,
}: {
  geometry: PlaneGeometry;
  color: number;
  arm: number;
  x: number;
}) {
  return (
    <group position-x={x} renderOrder={14}>
      {[Math.PI / 4, -Math.PI / 4].map((angle) => (
        <mesh key={angle} geometry={geometry} rotation-z={angle} scale={[arm, ARM_THICKNESS_PX, 1]}>
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
