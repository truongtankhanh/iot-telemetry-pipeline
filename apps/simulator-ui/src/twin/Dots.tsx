import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { CircleGeometry, Mesh, MeshBasicMaterial, type Quaternion, type Vector3 } from 'three';
import { prefersReducedMotion } from '../lib/reducedMotion';
import { LENS } from '../lib/twinCamera';
import { dotTravelMs, pointAt, SCREEN_DOT_CAP, shouldDraw, startDelayMs } from '../lib/twinDots';
import { isLit, type TwinArc } from '../lib/twinFlow';
import { DotLimiter, type PulseListener } from '../state/pulses';
import { dotColors } from './twinColors';

/** How wide a dot is on the screen, in pixels (frame 14's circle of radius 3.5). */
const DOT_PX = 7;

/** Listens to the pulses of the placed devices and returns the function that stops. The page builds it from the pulse bus. */
export type PulseSource = (listener: PulseListener) => () => void;

interface Dot {
  arcId: string;
  /** `performance.now()` at which it starts: later than the pulse for the second copy of a duplicate. */
  bornAt: number;
  travelMs: number;
  mesh: Mesh;
}

/**
 * The 24 small discs of the scene and the dots that use them. A class, not state of the component, because it is mutated
 * on every pulse and every frame, outside React's render: the component holds one and calls its methods (as a page holds a
 * `PulseBus`), and nothing here is a value React is meant to compare. The caps live here: the arc's own `DotLimiter(4)` and
 * the screen's `DotLimiter(24)`; a dot that would pass either is dropped, not queued.
 */
class DotPool {
  readonly all: readonly Mesh[];
  private readonly geometry = new CircleGeometry(0.5, 16);
  private readonly materials = {
    flowing: new MeshBasicMaterial({
      color: dotColors.flowing,
      depthTest: false,
      depthWrite: false,
    }),
    warn: new MeshBasicMaterial({ color: dotColors.warn, depthTest: false, depthWrite: false }),
  };
  private readonly alive: Dot[] = [];
  private readonly free: Mesh[];
  private readonly screen = new DotLimiter(SCREEN_DOT_CAP);
  private readonly perArc = new Map<string, DotLimiter>();

  constructor() {
    this.free = Array.from({ length: SCREEN_DOT_CAP }, () => {
      const mesh = new Mesh(this.geometry, this.materials.flowing);
      mesh.visible = false;
      mesh.renderOrder = 9;
      mesh.frustumCulled = false;
      return mesh;
    });
    this.all = [...this.free];
  }

  /** True while a dot is alive: the scene asks for the next frame only then. */
  get busy(): boolean {
    return this.alive.length > 0;
  }

  /** Starts a dot on `arc` if both caps allow; false when it was dropped. */
  start(arc: TwinArc, bornAt: number): boolean {
    let limiter = this.perArc.get(arc.id);
    if (limiter === undefined) {
      limiter = new DotLimiter();
      this.perArc.set(arc.id, limiter);
    }
    if (!this.screen.tryStart()) return false;
    if (!limiter.tryStart()) {
      this.screen.finish();
      return false;
    }
    const mesh = this.free.pop();
    if (mesh === undefined) {
      // Cannot happen while the screen cap equals the pool; given back rather than assumed.
      limiter.finish();
      this.screen.finish();
      return false;
    }
    this.alive.push({ arcId: arc.id, bornAt, travelMs: dotTravelMs(arc.slow), mesh });
    return true;
  }

  /**
   * Moves every dot to where it is at `now`, takes off those that arrived, whose arc is gone or is no longer lit ("dots stop
   * at the pins"), and turns each to face the camera at a size of `DOT_PX` pixels.
   */
  step(
    now: number,
    arcs: ReadonlyMap<string, TwinArc>,
    camera: { position: Vector3; quaternion: Quaternion },
    metresPerPixel: number,
  ): void {
    for (let index = this.alive.length - 1; index >= 0; index -= 1) {
      const dot = this.alive[index] as Dot;
      const arc = arcs.get(dot.arcId);
      const progress = (now - dot.bornAt) / dot.travelMs;
      const at =
        arc === undefined || !isLit(arc.look) || progress >= 1
          ? null
          : pointAt(arc.points, progress);
      if (arc === undefined || at === null) {
        this.alive.splice(index, 1);
        this.release(dot);
        continue;
      }
      if (progress < 0) {
        // The second copy of a duplicate, not yet started.
        dot.mesh.visible = false;
        continue;
      }
      dot.mesh.material = arc.look === 'warn' ? this.materials.warn : this.materials.flowing;
      dot.mesh.position.set(at[0], at[1], at[2]);
      dot.mesh.quaternion.copy(camera.quaternion);
      dot.mesh.scale.setScalar(
        dot.mesh.position.distanceTo(camera.position) * metresPerPixel * DOT_PX,
      );
      dot.mesh.visible = true;
    }
  }

  /** Takes every dot off and forgets the per-arc counts. */
  clear(): void {
    for (const dot of this.alive.splice(0)) this.release(dot);
    this.perArc.clear();
  }

  dispose(): void {
    this.geometry.dispose();
    this.materials.flowing.dispose();
    this.materials.warn.dispose();
  }

  private release(dot: Dot): void {
    dot.mesh.visible = false;
    this.free.push(dot.mesh);
    this.screen.finish();
    this.perArc.get(dot.arcId)?.finish();
  }
}

export interface DotsProps {
  arcs: readonly TwinArc[];
  /** The arcs that hold a `line` slot of the animation budget: only these move dots. */
  granted: ReadonlySet<string>;
  pulses: PulseSource;
  visible: boolean;
}

/**
 * The dots that travel the arcs (SIM-19): one each time a device the engine published for, never on a loop of its own.
 * At most 4 are alive on an arc and `SCREEN_DOT_CAP` (24) on the whole screen. None is drawn under
 * `prefers-reduced-motion`, while the tab is hidden, or on an arc that is not lit (a dim wire, a cut link); an arc past the
 * animation budget keeps its glow and moves no dots. The scene asks for a frame only while a dot is alive, and the pool of
 * 24 discs is built once. **Disposed** with the scene.
 */
export function Dots({ arcs, granted, pulses, visible }: DotsProps) {
  const invalidate = useThree((state) => state.invalidate);
  const [pool] = useState(() => new DotPool());

  // What a pulse and a frame need to know of this render, without making either an effect of its own.
  const latest = useRef({ arcs: new Map<string, TwinArc>(), granted, visible });
  useEffect(() => {
    latest.current = { arcs: new Map(arcs.map((arc) => [arc.id, arc])), granted, visible };
  });

  useEffect(() => () => pool.dispose(), [pool]);

  useEffect(() => {
    const stop = pulses((deviceId, _at, fault) => {
      const current = latest.current;
      const arc = current.arcs.get(deviceId);
      if (!current.visible || arc === undefined || !current.granted.has(deviceId)) return;
      const draw = shouldDraw({
        hidden: document.hidden,
        reduced: prefersReducedMotion(),
        lit: isLit(arc.look),
      });
      if (draw && pool.start(arc, performance.now() + startDelayMs(fault))) invalidate();
    });
    return () => {
      stop();
      pool.clear();
    };
  }, [pulses, pool, invalidate]);

  const tanHalfFov = Math.tan((LENS.fov * Math.PI) / 360);
  useFrame(({ camera, size }) => {
    if (!pool.busy) return;
    const metresPerPixel = (2 * tanHalfFov) / Math.max(1, size.height);
    pool.step(performance.now(), latest.current.arcs, camera, metresPerPixel);
    if (pool.busy) invalidate();
  });

  if (!visible) return null;
  return (
    <>
      {pool.all.map((mesh) => (
        <primitive key={mesh.id} object={mesh} />
      ))}
    </>
  );
}
