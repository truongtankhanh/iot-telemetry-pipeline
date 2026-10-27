import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Facts } from './TwinFacts';
import styles from './twin.module.css';
import type { TwinFocus } from './useTwinModel';

export interface TwinBuildingAssetsProps {
  focus: TwinFocus;
}

/**
 * "Also in this building" (frame 15): what the command center's catalogue puts in the building in focus, one row per class —
 * the codes, the class in words, and where it stands when the data says ("roof", "3 m east") — with the chip and the
 * sentence that say these are drawn but not simulated. It is shown whenever a building is in focus, with a device selected
 * or not, because the assets are drawn then. A building with none says so instead of showing an empty card.
 */
export function TwinBuildingAssets({ focus }: TwinBuildingAssetsProps) {
  const count = focus.groups.reduce((total, group) => total + group.codes.length, 0);
  return (
    <Card title="Also in this building" aside={<Chip>Catalogue · not simulated</Chip>}>
      {count === 0 ? (
        <p className={styles.hint}>
          No asset of the command center&apos;s catalogue stands in {focus.zone.name}.
        </p>
      ) : (
        <>
          <Facts
            rows={focus.groups.map(
              (group) =>
                [
                  group.codes.join(', '),
                  group.where === null ? group.label : `${group.label}, ${group.where}`,
                ] as const,
            )}
          />
          <p className={styles.hint}>
            {count === 1
              ? "1 asset of the command center's catalogue stands here."
              : `${count} assets of the command center's catalogue stand here.`}{' '}
            Studio draws {count === 1 ? 'it' : 'them'} but does not play{' '}
            {count === 1 ? 'it' : 'them'} until V2-T05.
          </p>
        </>
      )}
    </Card>
  );
}
