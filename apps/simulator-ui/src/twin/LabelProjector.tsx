import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Matrix4 } from 'three';

/** The camera's view-projection matrix (column-major, 16 numbers) and the size of the canvas it projects to, in pixels. */
export type ViewListener = (
  matrix: ArrayLike<number>,
  size: { width: number; height: number },
) => void;

/**
 * Tells the DOM overlays (the labels, the tooltip) where the camera is, so that they can follow the pins. It does no
 * drawing and renders nothing: in each frame it works out `projection × view` and, only when that or the canvas's size
 * differs from the last one it told, calls `onView` — no React state, no render per frame. It must be mounted after the
 * camera rig: frame callbacks run in the order they were registered, and the rig is what moves the camera.
 *
 * The camera's world matrix is brought up to date here because the renderer does it only when it draws, which is after
 * the frame callbacks.
 */
export function LabelProjector({ onView }: { onView: ViewListener }) {
  const matrix = useMemo(() => new Matrix4(), []);
  const last = useRef<{ elements: number[]; width: number; height: number } | null>(null);

  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const before = last.current;
    if (
      before !== null &&
      before.width === size.width &&
      before.height === size.height &&
      before.elements.every((value, index) => value === matrix.elements[index])
    ) {
      return;
    }
    last.current = { elements: [...matrix.elements], width: size.width, height: size.height };
    onView(matrix.elements, size);
  });

  return null;
}
