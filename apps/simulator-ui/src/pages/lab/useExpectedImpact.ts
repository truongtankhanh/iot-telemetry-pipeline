import { useEffect, useMemo, useState } from 'react';
import { ApiError, getExpected } from '../../api/client';
import type { Anomaly, ExpectationPreview } from '../../api/types';
import { useStudio } from '../../state/studioContext';
import { librarySignature } from '../scenarios/useScenarioLibrary';

export interface ExpectedImpact {
  /**
   * `idle`: nothing to ask about. `loading`: asked for now and not answered. `ready` and `error`: the answer to the
   * current question.
   */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /**
   * The last answer that arrived, kept while the next one is asked for so the picture does not blink on every key. It is
   * for an earlier question when `fresh` is false, and a component dims it then. `null` for no anomalies.
   */
  preview: ExpectationPreview | null;
  /** True when `preview` answers the current question. */
  fresh: boolean;
  /** The simulator's reason, while `status` is `error` ("anomalies[1] overlaps anomalies[0] on …"). */
  error: string | null;
}

interface Answer {
  key: string;
  preview: ExpectationPreview | null;
  error: string | null;
}

/** How long the form is left alone before it is asked about: a typed number is several keys. */
export const IMPACT_DEBOUNCE_MS = 250;

/**
 * What the rules should do with these anomalies, asked of the simulator (`POST /api/expectations`) a moment after they
 * stop changing. The same question is asked again when what the answer depends on changes (a device starts or stops, an
 * interval changes, a run begins: `librarySignature`), and never while the list is empty. A request that is overtaken
 * is aborted and an answer to an old question is never taken for the new one. Times are seconds from now, as the form's.
 */
export function useExpectedImpact(
  anomalies: readonly Anomaly[],
  options: { debounceMs?: number } = {},
): ExpectedImpact {
  const debounceMs = options.debounceMs ?? IMPACT_DEBOUNCE_MS;
  const signature = useStudio((state) => librarySignature(state.view));
  const [answer, setAnswer] = useState<Answer | null>(null);

  // The question as a string: the list itself is a new array on every render of the caller.
  const question = useMemo(
    () => (anomalies.length === 0 || signature === null ? '' : JSON.stringify(anomalies)),
    [anomalies, signature],
  );
  const key = question === '' ? '' : `${signature}|${question}`;

  useEffect(() => {
    if (key === '') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getExpected(JSON.parse(question) as Anomaly[], { signal: controller.signal }).then(
        (preview) => {
          if (!controller.signal.aborted) setAnswer({ key, preview, error: null });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof ApiError
              ? error.message
              : 'The expected alerts could not be worked out';
          setAnswer((previous) => ({ key, preview: previous?.preview ?? null, error: message }));
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, question, debounceMs]);

  if (key === '') return { status: 'idle', preview: null, fresh: true, error: null };
  const current = answer !== null && answer.key === key ? answer : null;
  return {
    status: current === null ? 'loading' : current.error === null ? 'ready' : 'error',
    preview: answer?.preview ?? null,
    fresh: current !== null && current.error === null,
    error: current?.error ?? null,
  };
}
