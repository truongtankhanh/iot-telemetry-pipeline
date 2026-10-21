import type { ScenarioNeed } from '../api/types';

/** A piece of a sentence; a device id is drawn in the mono face. */
export interface TextSegment {
  text: string;
  mono?: boolean;
}

/** `a`, `a and b`, `a, b and c`. */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The ids of a list as mono segments, joined as `nameList` does. */
function idSegments(ids: readonly string[]): TextSegment[] {
  const segments: TextSegment[] = [];
  ids.forEach((id, index) => {
    if (index > 0) segments.push({ text: index === ids.length - 1 ? ' and ' : ', ' });
    segments.push({ text: id, mono: true });
  });
  return segments;
}

/**
 * What a card says before the click when running the scenario would start a device that is stopped, or resume one
 * that is paused ("hub-power-01 is stopped; running this starts it."). `null` when every device it needs is running.
 */
export function startBanner(needs: readonly ScenarioNeed[]): TextSegment[] | null {
  const stopped = needs.filter((need) => need.state === 'stopped').map((need) => need.deviceId);
  const paused = needs.filter((need) => need.state === 'paused').map((need) => need.deviceId);
  if (stopped.length === 0 && paused.length === 0) return null;

  const group = (ids: string[], state: string): TextSegment[] => [
    ...idSegments(ids),
    { text: ` ${ids.length === 1 ? 'is' : 'are'} ${state}` },
  ];
  const segments: TextSegment[] = [];
  if (stopped.length > 0) segments.push(...group(stopped, 'stopped'));
  if (stopped.length > 0 && paused.length > 0) segments.push({ text: ' and ' });
  if (paused.length > 0) segments.push(...group(paused, 'paused'));

  const total = stopped.length + paused.length;
  const them = total === 1 ? 'it' : 'them';
  const verb =
    stopped.length > 0 && paused.length > 0
      ? 'starts or resumes'
      : stopped.length > 0
        ? 'starts'
        : 'resumes';
  segments.push({ text: `; running this ${verb} ${them}.` });
  return segments;
}

/** The banner as plain text, for a test or an accessible name. */
export const bannerText = (segments: readonly TextSegment[]): string =>
  segments.map((segment) => segment.text).join('');

/** What the page says after a run that started devices ("Started hub-power-01."); `null` when it started none. */
export function startedNotice(startedDevices: readonly string[]): string | null {
  return startedDevices.length === 0 ? null : `Started ${nameList(startedDevices)}.`;
}
