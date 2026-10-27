import { useId } from 'react';
import { Link } from 'react-router';
import type { DeviceInfo } from '../../api/types';
import { metricUnit } from '../../lib/deviceIdentity';
import { injectionSentence, INJECT_TILES, labLink, startsInSentence } from '../../lib/twinInject';
import { Button } from '../../ui/Button';
import { useBenchmarkLock } from '../../state/useBenchmarkLock';
import { Card } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { faultGlyphs, toneIcons } from '../../ui/icons';
import { NumberField } from '../../ui/NumberField';
import pagesStyles from '../pages.module.css';
import styles from './twin.module.css';
import { useTwinInject } from './useTwinInject';

export interface TwinInjectProps {
  /** The device the fault is aimed at. Call it with `key={device.id}`, so the form starts again for another device. */
  device: DeviceInfo;
}

/**
 * "Inject at <device>" (frames 14 and 15): the Lab's fault, aimed at the selected device. The five chips of the frames, of
 * which only a breach is a timed fault (the other four are disabled and a line says where they are, as the Lab's tiles do); its
 * value and duration, from the Lab's defaults; when it starts; and **Inject now**, which sends what the Lab would send for
 * the same inputs, because the plan and the send are the Lab's (`useTwinInject`). A button that cannot act is disabled and the
 * line beside it says why in words. What happened is told in one live region that is always there, so a result is announced
 * without the region being made and removed. _Open in lab_ opens the Lab on this device; the form's values stay here.
 */
export function TwinInject({ device }: TwinInjectProps) {
  const { draft, patch, plan, injection, inject } = useTwinInject(device);
  const group = useId();
  const noteId = useId();
  const busy = injection.progress.running;
  // A benchmark is running: an injection may start devices, which the simulator refuses; the banner says why.
  const lock = useBenchmarkLock();
  const metric = plan.metric;
  const unit = metric === null ? '' : metricUnit(metric);
  const sentence = injectionSentence(plan, draft);
  const startsIn = startsInSentence(draft);
  const { notice, partial } = injection;

  return (
    <Card title={`Inject at ${device.id}`}>
      <div className={styles.injectTiles} role="radiogroup" aria-label="Fault type">
        {INJECT_TILES.map((tile) => (
          <label
            key={tile.id}
            className={styles.injectTile}
            data-on={tile.id === draft.tile ? 'true' : undefined}
            data-disabled={tile.available ? undefined : 'true'}
            title={tile.reason ?? undefined}
          >
            <input
              type="radio"
              name={group}
              value={tile.id}
              checked={tile.id === draft.tile}
              disabled={!tile.available}
              aria-describedby={tile.available ? undefined : noteId}
              onChange={() => patch({ tile: tile.id })}
            />
            <Icon glyph={faultGlyphs[tile.id]} size="sm" />
            <span>{tile.label}</span>
          </label>
        ))}
      </div>
      <p id={noteId} className={styles.hint}>
        Only a breach is a timed fault. Silent, drop, delay and malformed are set elsewhere: pause
        the device in the Fleet, or use the <Link to="/lab/faults">Faults page</Link>.
      </p>

      {sentence === null ? null : <p className={styles.injectSentence}>{sentence}</p>}
      <div className={styles.injectFields}>
        <NumberField
          label="Value"
          unit={unit}
          value={plan.value}
          error={plan.errors.value}
          onChange={(value) => patch({ value })}
        />
        <NumberField
          label="Duration"
          unit="s"
          value={draft.duration}
          error={plan.errors.duration}
          onChange={(duration) => patch({ duration })}
        />
      </div>
      {startsIn === null ? null : <p className={styles.hint}>{startsIn}</p>}

      <p className={styles.injectBlocker} role="status">
        {busy ? 'Sending…' : (plan.blocker ?? '')}
      </p>
      <div className={styles.injectButtons}>
        <Button
          variant="primary"
          size="sm"
          disabled={plan.blocker !== null || busy || lock.locked}
          onClick={() => void inject()}
        >
          Inject now
        </Button>
        <Link className={pagesStyles.link} to={labLink(device.id)}>
          Open in lab
        </Link>
      </div>
      <p className={styles.hint}>The Lab opens on this device; the values typed here stay here.</p>

      <div role="status" className={styles.injectResult}>
        {notice === null ? null : (
          <div className={styles.injectNotice} data-tone={notice.tone}>
            <Icon glyph={notice.tone === 'bad' ? toneIcons.bad : toneIcons.ok} size="sm" />
            <span>{notice.text}</span>
            {partial === null ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void injection.remove(partial.ids)}
              >
                Remove these {partial.ok}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={injection.dismissNotice}>
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
