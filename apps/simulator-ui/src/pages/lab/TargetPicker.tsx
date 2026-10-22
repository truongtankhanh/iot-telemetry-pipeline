import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FleetRow } from '../../lib/fleetQuery';
import {
  appliesSentence,
  pickerGroups,
  resolveTargets,
  SCOPE_LABELS,
  scopeOptions,
  selectZone,
  TAB_LABELS,
  TARGET_SCOPES,
  TARGET_TABS,
  type TargetScope,
  type TargetTab,
  tabCounts,
  targetChips,
  targetCounts,
  toggleTarget,
  zoneSelection,
} from '../../lib/labTargets';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { Segmented } from '../../ui/Segmented';
import styles from './targetPicker.module.css';

export interface TargetPickerProps {
  /** Every device of the registry with its state, as the Fleet builds them. */
  rows: readonly FleetRow[];
  scope: TargetScope;
  /** The choice: device ids, zone codes or classes, by scope. */
  targets: readonly string[];
  onScope: (scope: TargetScope) => void;
  onChange: (targets: string[]) => void;
}

/**
 * Where the fault goes (frames 12 and 19): a scope (Device, Zone or Class), the choice as removable chips, and a popover
 * to change it — a search, the tabs _All / Playing / Problems_ with their counts, the devices under their zone with a
 * tri-state box for the zone, "Show n more in this zone", and _Done_. A zone or a class is chosen whole (it reaches every
 * device that has it). The line under the field says how many devices the fault will reach.
 *
 * It is a disclosure with checkboxes, as the Fleet's column chooser is, not a listbox: every row is a real checkbox in the
 * page's tab order, Esc closes it and puts focus back on the button, and so does a click elsewhere. The popover is as wide
 * as the column it opens in, never wider (frame 19). Catalogue assets are not listed: Studio has no source for them yet.
 */
export function TargetPicker({ rows, scope, targets, onScope, onChange }: TargetPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<TargetTab>('all');
  const [grouped, setGrouped] = useState(true);
  const [openZones, setOpenZones] = useState<ReadonlySet<string>>(() => new Set());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const devices = useMemo(() => rows.map((row) => row.device), [rows]);
  const chosen = useMemo(() => new Set(targets), [targets]);
  const chips = useMemo(() => targetChips(devices, scope, targets), [devices, scope, targets]);
  const reached = useMemo(() => resolveTargets(devices, scope, targets), [devices, scope, targets]);
  const counts = useMemo(() => targetCounts(devices, reached), [devices, reached]);
  const onlyZone = counts.zones === 1 ? (reached[0]?.zoneCode ?? null) : null;

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    close();
  };

  const tabs = useMemo(() => tabCounts(rows, q), [rows, q]);
  const groups = useMemo(
    () => pickerGroups(rows, { tab, q, open: openZones }),
    [rows, tab, q, openZones],
  );
  const options = useMemo(
    () => (scope === 'device' ? [] : scopeOptions(devices, scope, q)),
    [devices, scope, q],
  );

  const openZone = (zone: string) =>
    setOpenZones((were) => {
      const next = new Set(were);
      next.add(zone);
      return next;
    });

  const changeScope = (value: string) => {
    onScope(value as TargetScope);
    setQ('');
  };

  const deviceRow = (row: FleetRow) => (
    <label key={row.device.id} className={styles.row}>
      <Checkbox
        label={`Select ${row.device.id}`}
        checked={chosen.has(row.device.id)}
        onChange={(on) => onChange(toggleTarget(targets, row.device.id, on))}
      />
      <span className={styles.id}>{row.device.id}</span>
      <span className={styles.faint}>{row.status.word}</span>
    </label>
  );

  return (
    <div className={styles.picker} ref={root} onKeyDown={onKeyDown}>
      <Segmented
        label="Scope"
        value={scope}
        onChange={changeScope}
        options={TARGET_SCOPES.map((value) => ({ value, label: SCOPE_LABELS[value] }))}
      />

      <div className={styles.field} data-open={open ? 'true' : undefined}>
        <ul className={styles.chips} aria-label="Chosen targets">
          {chips.map((chip) => (
            <li key={chip.id} className={styles.chip}>
              <Chip tone="accent">
                <span className={chip.count === null ? styles.id : undefined}>{chip.label}</span>
                {chip.count === null ? null : <span className={styles.faint}> · {chip.count}</span>}
              </Chip>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${chip.label}`}
                onClick={() => onChange(toggleTarget(targets, chip.id, false))}
              >
                <Icon glyph={uiIcons.close} size="sm" />
              </button>
            </li>
          ))}
        </ul>
        <button
          ref={trigger}
          type="button"
          className={styles.add}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((was) => !was)}
        >
          {targets.length === 0 ? 'Choose targets…' : 'Add…'}
          <Icon glyph={uiIcons.chevronDown} size="sm" />
        </button>
      </div>

      <p className={styles.applies} aria-live="polite">
        {targets.length === 0 ? 'No target chosen' : appliesSentence(counts, onlyZone)}
      </p>

      {open ? (
        <div className={styles.panel} id={panelId} role="group" aria-label="Choose targets">
          <div className={styles.searchRow}>
            <Icon glyph={uiIcons.search} size="sm" />
            <input
              ref={search}
              type="search"
              className={styles.search}
              aria-label="Search devices, zones or classes"
              placeholder="device, zone or class"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>

          {scope === 'device' ? (
            <>
              <div className={styles.tools}>
                <Segmented
                  label="Show"
                  value={tab}
                  onChange={(value) => setTab(value as TargetTab)}
                  options={TARGET_TABS.map((value) => ({
                    value,
                    label: `${TAB_LABELS[value]} ${tabs[value]}`,
                  }))}
                />
                <label className={styles.switch}>
                  <Checkbox label="Group by zone" checked={grouped} onChange={setGrouped} />
                  <span>Group by zone</span>
                </label>
              </div>

              <div className={styles.list} tabIndex={-1}>
                {groups.length === 0 ? (
                  <p className={styles.empty} role="status">
                    No device matches.
                  </p>
                ) : grouped ? (
                  groups.map((group) => {
                    const ids = group.rows.map((row) => row.device.id);
                    const state = zoneSelection(ids, chosen);
                    return (
                      <div key={group.zone} className={styles.group}>
                        <label className={styles.groupHead}>
                          <Checkbox
                            label={`Select zone ${group.zone}`}
                            checked={state === 'all'}
                            indeterminate={state === 'some'}
                            onChange={(on) => onChange(selectZone(targets, ids, on))}
                          />
                          <b>{group.zone}</b>
                          <span className={styles.faint}>
                            {ids.filter((id) => chosen.has(id)).length} of {ids.length}
                          </span>
                        </label>
                        {group.shown.map(deviceRow)}
                        {group.more > 0 ? (
                          <button
                            type="button"
                            className={styles.more}
                            onClick={() => openZone(group.zone)}
                          >
                            Show {group.more} more in this zone
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  groups.flatMap((group) => group.rows).map(deviceRow)
                )}
              </div>
            </>
          ) : (
            <div className={styles.list} tabIndex={-1}>
              {options.length === 0 ? (
                <p className={styles.empty} role="status">
                  Nothing matches.
                </p>
              ) : (
                options.map((option) => (
                  <label key={option.id} className={styles.row}>
                    <Checkbox
                      label={`Select ${option.label}`}
                      checked={chosen.has(option.id)}
                      onChange={(on) => onChange(toggleTarget(targets, option.id, on))}
                    />
                    <span className={scope === 'zone' ? styles.id : undefined}>{option.label}</span>
                    <span className={styles.faint}>
                      {option.count} {option.count === 1 ? 'device' : 'devices'}
                    </span>
                  </label>
                ))
              )}
            </div>
          )}

          <div className={styles.foot}>
            <span className={styles.faint}>
              Catalogue assets cannot be a target until the simulator plays them.
            </span>
            <Button size="sm" variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
