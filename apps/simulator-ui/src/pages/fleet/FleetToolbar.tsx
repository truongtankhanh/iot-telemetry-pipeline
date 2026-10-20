import { type FleetQuery, type FleetSortKey, kindLabel, SORT_LABELS } from '../../lib/fleetQuery';
import { Checkbox } from '../../ui/Checkbox';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { Segmented } from '../../ui/Segmented';
import styles from './fleet.module.css';

export interface FleetToolbarProps {
  query: FleetQuery;
  zones: readonly string[];
  kinds: readonly string[];
  /** Which view is shown (the Cards choice is off above 12 devices). */
  view: 'cards' | 'table';
  cardsAllowed: boolean;
  onChange: (patch: Partial<FleetQuery>) => void;
}

/**
 * The filters of the Fleet, above the list and stuck below the header while the page scrolls: search, zone,
 * class, sort, group by zone, Cards or Table. A group, not an ARIA toolbar: a toolbar promises arrow-key movement
 * between its controls, and a search field needs the arrow keys for itself. Every field is named, the visible
 * names being the placeholder and the first option of each list.
 */
export function FleetToolbar({
  query,
  zones,
  kinds,
  view,
  cardsAllowed,
  onChange,
}: FleetToolbarProps) {
  return (
    <div className={styles.toolbar} role="group" aria-label="Filter and sort the devices">
      <label className={styles.search}>
        <Icon glyph={uiIcons.search} size="sm" />
        <input
          type="search"
          aria-label="Find by id, name or zone"
          placeholder="Find by id, name or zone"
          value={query.q}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </label>

      <select
        className={styles.select}
        aria-label="Zone"
        value={query.zone ?? ''}
        onChange={(event) => onChange({ zone: event.target.value || null })}
      >
        <option value="">All zones</option>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        aria-label="Class"
        value={query.kind ?? ''}
        onChange={(event) => onChange({ kind: event.target.value || null })}
      >
        <option value="">All classes</option>
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {kindLabel(kind)}
          </option>
        ))}
      </select>

      <label className={styles.inline}>
        <span>Sort</span>
        <select
          className={styles.select}
          value={query.sort}
          onChange={(event) => onChange({ sort: event.target.value as FleetSortKey, dir: 'asc' })}
        >
          {(Object.keys(SORT_LABELS) as FleetSortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      {view === 'cards' ? (
        <label className={styles.inline}>
          <Checkbox
            label="Group by zone"
            checked={query.group}
            onChange={(group) => onChange({ group })}
          />
          <span>Group by zone</span>
        </label>
      ) : null}

      <div className={styles.end}>
        <Segmented
          label="View"
          value={view}
          onChange={(value) => onChange({ view: value === 'table' ? 'table' : 'cards' })}
          options={[
            { value: 'cards', label: 'Cards', disabled: !cardsAllowed },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>
    </div>
  );
}
