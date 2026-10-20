import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { uiIcons } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { Clock } from './Clock';
import { DependencyPills, EnginePill } from './DependencyPills';
import styles from './header.module.css';

/** The campus of the demo registry (apps/ingest/config/devices.json); the registry names no other. */
const CAMPUS = 'Langbiang Tech Campus';

const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

export interface HeaderProps {
  /** Opens the command palette (search and go-to share it). */
  onOpenPalette: () => void;
}

/**
 * Who this is, what the pipeline depends on, the state of the engine, search and go-to, the time. The
 * pills are the first thing to read in a demo: they are what makes a stopped ingest or a missing command
 * center visible from across a room.
 */
export function Header({ onOpenPalette }: HeaderProps) {
  const key = isMac() ? '⌘ K' : 'Ctrl K';
  return (
    <div className={styles.header}>
      <div className={styles.brand}>
        <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect width="32" height="32" rx="7" className={styles.markBg} />
          <path d="M18 5 8 18h7l-1 9 10-13h-7z" className={styles.markBolt} />
        </svg>
        <div>
          <div className={styles.name}>Simulator Studio</div>
          <div className={styles.sub}>{CAMPUS}</div>
        </div>
      </div>
      <DependencyPills />
      <div className={styles.end}>
        <EnginePill />
        <Button
          variant="outline"
          size="sm"
          icon={uiIcons.search}
          onClick={onOpenPalette}
          aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
        >
          Search devices, alerts, scenarios… <Kbd>{key}</Kbd>
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenPalette}>
          Go to… <Kbd>G</Kbd>
        </Button>
        <Clock />
        <span title="A V1 demo, not for production">
          <Chip>V1</Chip>
        </span>
      </div>
    </div>
  );
}
