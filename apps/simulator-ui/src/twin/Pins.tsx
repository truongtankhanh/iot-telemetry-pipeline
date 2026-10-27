import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  type Vector2,
  Vector3,
} from 'three';
import type { DeviceShape } from '../lib/deviceIdentity';
import { prefersReducedMotion } from '../lib/reducedMotion';
import { LENS } from '../lib/twinCamera';
import { beaconPhase } from '../lib/twinFlow';
import { PIN_LIFT_M, type TwinPin } from '../lib/twinPins';
import type { TwinSelection } from '../lib/twinQuery';
import { CLICK_SLOP_PX } from './Buildings';
import { ghostOpacity, pinFills, severityColors, stateColors, stemColor } from './twinColors';

/** How wide a pin is on the screen, in pixels, wherever the camera is: a pin is a mark, not a model. */
const PIN_PX = 16;
/** The ring is this share of the shape's size at its inner edge; dashed rings leave every third piece out. */
const RING_INNER = 0.76;
/** The selected pin and the hovered one are drawn a little larger. */
const SELECTED_SCALE = 1.3;
const HOVERED_SCALE = 1.15;
/**
 * The beacon of an open alert is a ring that grows from `BEACON_FROM` to `BEACON_TO` times the pin's radius while it
 * fades (frame 14: radius 11 to 26 around a pin of 8). Under reduced motion it is still, at `BEACON_STILL` and a fixed
 * opacity; a beacon of alerts that were not read just now is dimmed.
 */
const BEACON_FROM = 1.4;
const BEACON_TO = 3.2;
const BEACON_STILL = 1.8;
const BEACON_OPACITY = 0.9;
const BEACON_STILL_OPACITY = 0.75;
const BEACON_STALE_FACTOR = 0.4;

const roundedRect = (half: number, radius: number): Shape => {
  const shape = new Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.quadraticCurveTo(half, -half, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.quadraticCurveTo(half, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.quadraticCurveTo(-half, half, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.quadraticCurveTo(-half, -half, -half + radius, -half);
  return shape;
};

const circle = (radius: number): Shape => {
  const shape = new Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
};

/** Pointed left and right, as frame 14 draws it. */
const hexagon = (radius: number): Shape => {
  const shape = new Shape();
  for (let corner = 0; corner < 6; corner += 1) {
    const angle = (corner * Math.PI) / 3;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    if (corner === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
};

/** The pin shapes of the Fleet (`kindIdentity`), one unit across. */
const SHAPES: Record<DeviceShape, () => Shape> = {
  'rounded-square': () => roundedRect(0.45, 0.16),
  circle: () => circle(0.5),
  hexagon: () => hexagon(0.5),
  rounded: () => roundedRect(0.45, 0.28),
};

/** The corners of a shape's outline, without the point that closes it. */
function outlineOf(shape: Shape): Vector2[] {
  const points = shape.getPoints(8);
  const first = points[0];
  const last = points[points.length - 1];
  if (first !== undefined && last !== undefined && first.equals(last)) points.pop();
  return points;
}

/**
 * A band along an outline, as triangles facing +z: each piece is a quad between the outline and the same outline pulled
 * towards the centre. A thin line is one pixel wide in WebGL, which a ring around a 16-pixel pin cannot be; a band can.
 * A dashed band leaves out every third piece (frame 14's dashed ring for a pin that is not reporting).
 */
function ringGeometry(outline: readonly Vector2[], dashed: boolean): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const count = outline.length;
  outline.forEach((outer, index) => {
    positions.push(outer.x, outer.y, 0, outer.x * RING_INNER, outer.y * RING_INNER, 0);
    if (dashed && index % 3 === 2) return;
    const next = (index + 1) % count;
    // Vertices of piece `i`: outer 2i, inner 2i + 1.
    indices.push(2 * index, 2 * next, 2 * next + 1, 2 * index, 2 * next + 1, 2 * index + 1);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(new Uint16Array(indices), 1));
  return geometry;
}

interface PinShapeGeometry {
  fill: BufferGeometry;
  ring: BufferGeometry;
  dashed: BufferGeometry;
}

/** The geometries every pin shares: one fill, one ring and one dashed ring per shape, a hit area and a stem. */
function buildGeometries() {
  const byShape = {} as Record<DeviceShape, PinShapeGeometry>;
  for (const [name, make] of Object.entries(SHAPES) as [DeviceShape, () => Shape][]) {
    const shape = make();
    const outline = outlineOf(shape);
    byShape[name] = {
      fill: new ShapeGeometry(shape, 8),
      ring: ringGeometry(outline, false),
      dashed: ringGeometry(outline, true),
    };
  }
  // A bigger disc than the pin, so a 16-pixel mark is not a 16-pixel target.
  const hit = new CircleGeometry(0.8, 16);
  const stem = new BufferGeometry();
  stem.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, -PIN_LIFT_M, 0], 3));
  // The pin's radius is 0.5 head units, so this ring is the pin's own size before the beacon scales it.
  const beacon = new RingGeometry(0.46, 0.54, 40);
  return { byShape, hit, stem, beacon };
}

export interface PinsProps {
  pins: readonly TwinPin[];
  /** The selected device, drawn larger and ringed in the selected colour. */
  selectedId: string | null;
  /** The device under the pointer, drawn a little larger. */
  hoveredId: string | null;
  visible: boolean;
  /** The Alerts layer is on: a pin with an open alert carries a beacon in the alert's severity colour. */
  alerts: boolean;
  /** The devices whose beacon may move: those that hold a `node` slot of the animation budget (12). The rest are still. */
  moving: ReadonlySet<string>;
  onHover: (target: TwinSelection) => void;
  onLeave: (target: TwinSelection) => void;
  onSelect: (target: TwinSelection) => void;
}

/**
 * The devices: a pin above each building, in the shape of the device's kind, ringed in its state (a dashed ring when it
 * is not reporting), on a stem down to the roof. A pin is a billboard of constant size on the screen: each frame it
 * turns to face the camera and is scaled by its distance, so it reads at any zoom. It is drawn over the buildings
 * (no depth test), because at campus distance a 16-pixel mark is wider than the height it floats at and a building would
 * cut it. The state is also the ring's dashes and the label's words, never the colour alone. Picking is the pointer
 * events of the scene, on a hit disc larger than the pin. The shared geometries are built once and **disposed** on unmount.
 *
 * A pin whose device has an open alert also carries a **beacon** (SIM-19): a ring in the alert's severity colour that
 * grows and fades once every `BEACON_PERIOD_MS`, behind the pin so the pin stays readable. It is a child of the pin's
 * billboard head, so it keeps its size on the screen too. The scene asks for the next frame only while a beacon exists,
 * the tab is shown and the viewer has not asked for less motion; then the ring is still and larger.
 *
 * With a building in focus (SIM-20) the pins of that building stand just above its floor, on a short stem, and the pins of
 * every other building are `faded` (pin, ring and stem at the ghost opacity) unless they carry a beacon, which never fades.
 */
export function Pins({
  pins,
  selectedId,
  hoveredId,
  visible,
  alerts,
  moving,
  onHover,
  onLeave,
  onSelect,
}: PinsProps) {
  const invalidate = useThree((state) => state.invalidate);
  const geometries = useMemo(() => buildGeometries(), []);
  const [heads] = useState(() => new Map<string, Group>());
  const [beacons] = useState(() => new Map<string, { mesh: Mesh; stale: boolean; id: string }>());
  const scratch = useMemo(() => new Vector3(), []);

  useEffect(
    () => () => {
      for (const { fill, ring, dashed } of Object.values(geometries.byShape)) {
        fill.dispose();
        ring.dispose();
        dashed.dispose();
      }
      geometries.hit.dispose();
      geometries.stem.dispose();
      geometries.beacon.dispose();
    },
    [geometries],
  );
  useEffect(() => invalidate(), [pins, selectedId, hoveredId, visible, alerts, invalidate]);

  // Face the camera and keep the size on screen: a world size of `PIN_PX` pixels at the pin's distance.
  const tanHalfFov = Math.tan((LENS.fov * Math.PI) / 360);
  useFrame(({ camera, size }) => {
    const metresPerPixel = (2 * tanHalfFov) / Math.max(1, size.height);
    for (const head of heads.values()) {
      head.quaternion.copy(camera.quaternion);
      head.scale.setScalar(
        head.getWorldPosition(scratch).distanceTo(camera.position) * metresPerPixel * PIN_PX,
      );
    }
    if (beacons.size === 0) return;
    const reduced = prefersReducedMotion();
    const phase = beaconPhase(performance.now());
    let anyMoves = false;
    for (const { mesh, stale, id } of beacons.values()) {
      // A beacon past the animation budget, or under reduced motion, is a still ring: it keeps saying "alert open".
      const still = reduced || !moving.has(id);
      anyMoves ||= !still;
      const material = mesh.material as MeshBasicMaterial;
      const grow = still ? BEACON_STILL : BEACON_FROM + (BEACON_TO - BEACON_FROM) * phase;
      const opacity = still ? BEACON_STILL_OPACITY : BEACON_OPACITY * (1 - phase);
      mesh.scale.setScalar(grow);
      material.opacity = stale ? opacity * BEACON_STALE_FACTOR : opacity;
    }
    // The next frame is asked for only while a beacon moves; a hidden tab draws nothing to move.
    if (anyMoves && !document.hidden) invalidate();
  });

  if (!visible) return null;
  return (
    <>
      {pins.map((pin) => {
        const shape = geometries.byShape[pin.shape];
        const selected = pin.id === selectedId;
        const target: TwinSelection = { type: 'device', id: pin.id };
        const ring = selected ? stateColors.selected : stateColors[pin.state];
        // Another building is in focus: the pin, its stem and its ring are drawn at the ghost opacity.
        const opacity = pin.faded ? ghostOpacity : 1;
        // The stem runs from the pin down to where the device stands: the roof, or in focus the floor, so its length is the
        // pin's own and not `PIN_LIFT_M`.
        const stemLength = pin.anchor[1] - pin.stemBase[1];
        return (
          <group key={pin.id} position={pin.anchor}>
            <lineSegments
              geometry={geometries.stem}
              renderOrder={10}
              scale={[1, stemLength / PIN_LIFT_M, 1]}
            >
              <lineBasicMaterial
                color={stemColor}
                depthTest={false}
                transparent={pin.faded}
                opacity={opacity}
              />
            </lineSegments>
            <group
              ref={(head) => {
                if (head === null) return;
                heads.set(pin.id, head);
                return () => {
                  heads.delete(pin.id);
                };
              }}
            >
              {alerts && pin.alert !== null ? (
                <mesh
                  geometry={geometries.beacon}
                  position-z={-0.02}
                  renderOrder={9}
                  ref={(mesh) => {
                    if (mesh === null || pin.alert === null) return;
                    beacons.set(pin.id, { mesh, stale: pin.alert.stale, id: pin.id });
                    return () => {
                      beacons.delete(pin.id);
                    };
                  }}
                >
                  <meshBasicMaterial
                    color={severityColors[pin.alert.severity]}
                    transparent
                    opacity={BEACON_OPACITY}
                    blending={AdditiveBlending}
                    depthTest={false}
                    depthWrite={false}
                  />
                </mesh>
              ) : null}
              <group scale={selected ? SELECTED_SCALE : pin.id === hoveredId ? HOVERED_SCALE : 1}>
                <mesh geometry={shape.fill} renderOrder={11}>
                  <meshBasicMaterial
                    color={pin.state === 'anomaly' ? pinFills.anomaly : pinFills.normal}
                    depthTest={false}
                    transparent={pin.faded}
                    opacity={opacity}
                  />
                </mesh>
                <mesh
                  geometry={pin.state === 'stale' ? shape.dashed : shape.ring}
                  position-z={0.02}
                  renderOrder={12}
                >
                  <meshBasicMaterial
                    color={ring}
                    depthTest={false}
                    transparent={pin.faded}
                    opacity={opacity}
                  />
                </mesh>
                <mesh
                  geometry={geometries.hit}
                  position-z={0.04}
                  renderOrder={13}
                  onPointerOver={(event) => {
                    event.stopPropagation();
                    onHover(target);
                  }}
                  // A building behind the pin must not take the hover from it.
                  onPointerMove={(event) => event.stopPropagation()}
                  onPointerOut={() => onLeave(target)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.delta > CLICK_SLOP_PX) return;
                    onSelect(target);
                  }}
                >
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
                </mesh>
              </group>
            </group>
          </group>
        );
      })}
    </>
  );
}
