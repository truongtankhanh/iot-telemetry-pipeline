import {
  SCENARIO_SORT_LABELS,
  SCENARIO_SORTS,
  SCENARIO_TAB_LABELS,
  SCENARIO_TABS,
  type ScenarioQuery,
  type ScenarioSortKey,
  type ScenarioTab,
} from '../../lib/scenarioQuery';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { SelectField } from '../../ui/SelectField';
import { Tabs } from '../../ui/Tabs';
import { ImportButton } from './ImportButton';
import styles from './scenarios.module.css';

export const TABS_PREFIX = 'scenario-tab';
export const PANEL_ID = 'scenario-panel';

export interface ScenariosToolbarProps {
  query: ScenarioQuery;
  counts: Record<ScenarioTab, number>;
  onChange: (patch: Partial<ScenarioQuery>) => void;
  importing: boolean;
  onImportFile: (file: File) => void;
}

/**
 * The source tabs with their counts, and above the cards the search, the sort and the import. A group, not an ARIA
 * toolbar: a toolbar promises arrow-key movement between its controls, and a search field needs the arrow keys for
 * itself. Every field has a name; the tabs' counts follow the search.
 */
export function ScenariosToolbar({
  query,
  counts,
  onChange,
  importing,
  onImportFile,
}: ScenariosToolbarProps) {
  return (
    <>
      <Tabs
        label="Scenario source"
        idPrefix={TABS_PREFIX}
        panelId={PANEL_ID}
        value={query.tab}
        onChange={(tab) => onChange({ tab: tab as ScenarioTab })}
        tabs={SCENARIO_TABS.map((id) => ({
          id,
          label: SCENARIO_TAB_LABELS[id],
          count: counts[id],
        }))}
      />
      <div className={styles.toolbar} role="group" aria-label="Find, sort and import scenarios">
        <label className={styles.search}>
          <Icon glyph={uiIcons.search} size="sm" />
          <input
            type="search"
            aria-label="Find a scenario by name, device or rule"
            placeholder="Find a scenario by name, device or rule"
            value={query.q}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange({ q: event.target.value })}
          />
        </label>
        <SelectField
          label="Sort"
          value={query.sort}
          options={SCENARIO_SORTS.map((key) => ({ value: key, label: SCENARIO_SORT_LABELS[key] }))}
          onChange={(sort) => onChange({ sort: sort as ScenarioSortKey })}
        />
        <span className={styles.end}>
          <ImportButton importing={importing} onFile={onImportFile} />
        </span>
      </div>
    </>
  );
}
