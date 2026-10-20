export type SlotKind = 'node' | 'line';

/**
 * How many things on one screen may animate (frame 00): 12 pulsing nodes and 24 glowing lines. Past
 * that a thing keeps its glow, still. The caps are not a taste: forty breathing nodes are noise, and
 * a screen that must be read from three metres has to say which few things are moving.
 */
export const CAPS: Record<SlotKind, number> = { node: 12, line: 24 };

export interface AnimationSlot {
  /** True while this slot is inside the cap. It can change when another slot is released. */
  isGranted(): boolean;
  /** Gives the slot up; the first waiting slot of the same kind takes it over. Safe to call twice. */
  release(): void;
}

interface Entry {
  kind: SlotKind;
  granted: boolean;
  onChange: () => void;
}

/**
 * Hands out the right to animate in the order slots were asked for, so what was on the screen first
 * keeps moving and a newcomer waits. `onChange` runs when a slot is granted or taken away (a React
 * component re-renders on it).
 */
export class AnimationBudget {
  private entries: Entry[] = [];
  private readonly caps: Record<SlotKind, number>;

  constructor(caps: Record<SlotKind, number> = CAPS) {
    this.caps = caps;
  }

  acquire(kind: SlotKind, onChange: () => void = () => {}): AnimationSlot {
    const entry: Entry = { kind, granted: false, onChange };
    this.entries.push(entry);
    this.rebalance(kind);
    return {
      isGranted: () => entry.granted,
      release: () => {
        if (!this.entries.includes(entry)) return;
        this.entries = this.entries.filter((e) => e !== entry);
        entry.granted = false;
        this.rebalance(kind);
      },
    };
  }

  /** Slots asked for and not released, and how many of them are inside the cap. */
  counts(kind: SlotKind): { held: number; granted: number } {
    const mine = this.entries.filter((e) => e.kind === kind);
    return { held: mine.length, granted: mine.filter((e) => e.granted).length };
  }

  private rebalance(kind: SlotKind): void {
    let granted = 0;
    for (const entry of this.entries) {
      if (entry.kind !== kind) continue;
      const shouldBeGranted = granted < this.caps[kind];
      if (shouldBeGranted) granted++;
      if (entry.granted !== shouldBeGranted) {
        entry.granted = shouldBeGranted;
        entry.onChange();
      }
    }
  }
}
