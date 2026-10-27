import { DEMO_SCRIPTS } from '../lib/demoScripts';
import { elapsedMs, formatElapsed } from '../lib/demoSession';
import { useDemoSession } from '../state/demoSessionContext';
import { useNow } from '../state/useNow';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { uiIcons } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { BenchmarkPill, DependencyPills } from './DependencyPills';
import headerStyles from './header.module.css';
import styles from './presenterHeader.module.css';

export interface PresenterHeaderProps {
  /** Leaves presenter mode. It stops nothing: what the demo started keeps running. */
  onExit: () => void;
}

/**
 * The header of presenter mode (frame 08): what is being presented, the three dependencies of the pipeline, where the demo is
 * ("Step 3 of 6 · 02:48 in") and the way out. The dependency pills stay: a stopped ingest or a missing command center must be
 * visible from across a room, and a demo that has stopped working says so here before it says so anywhere else. The clock is not
 * a live region: a number that changes every second would be read out every second.
 */
export function PresenterHeader({ onExit }: PresenterHeaderProps) {
  const session = useDemoSession();
  const now = useNow(1000);
  const script = DEMO_SCRIPTS.find((entry) => entry.id === session.scriptId);

  return (
    <div className={headerStyles.header}>
      <div className={headerStyles.brand}>
        <svg className={headerStyles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect width="32" height="32" rx="7" className={headerStyles.markBg} />
          <path d="M18 5 8 18h7l-1 9 10-13h-7z" className={headerStyles.markBolt} />
        </svg>
        <div>
          <h1 className={`${headerStyles.name} ${styles.title}`}>Guided demo</h1>
          <div className={headerStyles.sub}>{script?.title ?? 'No script'}</div>
        </div>
      </div>
      <DependencyPills />
      <div className={headerStyles.end}>
        <BenchmarkPill />
        <Chip icon={uiIcons.clock}>
          Step {Math.min(session.stepIndex + 1, Math.max(session.stepCount, 1))} of{' '}
          {session.stepCount} · {formatElapsed(elapsedMs(session, now))} in
        </Chip>
        <Button
          variant="outline"
          size="sm"
          icon={uiIcons.close}
          onClick={onExit}
          aria-keyshortcuts="Escape"
        >
          Exit presenter <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}
