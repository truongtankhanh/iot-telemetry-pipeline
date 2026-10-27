import { useCallback, useMemo } from 'react';
import type { DeviceInfo } from '../../api/types';
import { useInjection } from '../lab/useInjection';
import { useLabFault } from '../lab/useLabFault';

/**
 * The twin's "Inject here" (SIM-21), which is the Lab's injection and not a copy of it: the fault's form and the plan made from it
 * are the Lab's `useLabFault` (the same defaults, the same value from the rule, the same checks, the same refusal of a fault that
 * would play over one already on the device), and what is sent, and how a refusal or a partial failure is told, is the Lab's
 * `useInjection`. The twin only aims it at one device. The form is this hook's own state, not the address's and not a Lab page's
 * that happens to be open, so the two forms never fight. Call it from a component with `key={deviceId}`, so the form starts again
 * for another device.
 */
export function useTwinInject(device: DeviceInfo) {
  const reached = useMemo(() => [device], [device]);
  const fault = useLabFault(reached);
  const injection = useInjection();
  const { injectNow } = injection;
  const { anomalies } = fault.plan;
  const inject = useCallback(() => injectNow(anomalies), [injectNow, anomalies]);
  return { ...fault, injection, inject };
}
