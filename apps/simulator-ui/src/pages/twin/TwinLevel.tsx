import { type TopologyState, TOPOLOGY_TONES, TOPOLOGY_WORDS } from '../../lib/topologyState';
import type { ViewLevel } from '../../lib/twinQuery';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { toneIcons } from '../../ui/icons';
import { Kbd } from '../../ui/Kbd';
import styles from './twin.module.css';
import type { TwinFocus } from './useTwinModel';

export interface TwinLevelProps {
  level: ViewLevel;
  /** The building in focus; the header is not drawn without one (the campus has the page's own heading). */
  focus: TwinFocus | null;
  /** The building's worst look: a chip names it when it is not healthy. `null` for a building with no device. */
  state: TopologyState | null;
  /** Climb to the campus / to the building: the same steps as Escape. */
  onCampus: () => void;
  onBuilding: () => void;
}

/**
 * Where the viewer is, one level in (frame 15): the breadcrumb _Digital twin › Campus › Data Center_, in which Campus (and,
 * from a device, the building) is a real button that climbs there, the building's name as a heading with a chip when
 * something is wrong in it, and the hint for the key that goes up a level. The chip is a word and an icon, not a colour.
 * Nothing is drawn at campus level.
 */
export function TwinLevel({ level, focus, state, onCampus, onBuilding }: TwinLevelProps) {
  if (focus === null) return null;
  const tone = state === null ? null : TOPOLOGY_TONES[state];
  return (
    <div className={styles.level}>
      <nav aria-label="Level of the twin">
        <ol className={styles.crumbs}>
          <li>Digital twin</li>
          <li>
            <Button variant="ghost" size="sm" onClick={onCampus}>
              Campus
            </Button>
          </li>
          <li>
            {level === 'device' ? (
              <Button variant="ghost" size="sm" onClick={onBuilding}>
                {focus.zone.name}
              </Button>
            ) : (
              <span aria-current="location">{focus.zone.name}</span>
            )}
          </li>
        </ol>
      </nav>
      <div className={styles.levelTitle}>
        <h2>{focus.zone.name}</h2>
        {state === null || state === 'healthy' || tone === null ? null : (
          <Chip tone={tone === 'unknown' ? 'neutral' : tone} icon={toneIcons[tone]}>
            {TOPOLOGY_WORDS[state]}
          </Chip>
        )}
      </div>
      <p className={styles.hint}>
        <Kbd>Esc</Kbd> returns to {level === 'device' ? focus.zone.name : 'Campus'}
      </p>
    </div>
  );
}
