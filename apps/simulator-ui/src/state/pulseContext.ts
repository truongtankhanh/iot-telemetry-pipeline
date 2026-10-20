import { createContext, useContext } from 'react';
import type { PulseBus } from './pulses';

/** The pulse bus of this window. Provided once by `StudioProvider`; a test provides its own. */
export const PulseContext = createContext<PulseBus | null>(null);

export function usePulseBus(): PulseBus {
  const pulses = useContext(PulseContext);
  if (pulses === null) throw new Error('The pulse bus needs a StudioProvider above it');
  return pulses;
}
