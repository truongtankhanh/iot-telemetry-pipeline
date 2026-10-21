import { useId } from 'react';
import type { DeviceInfo, RulesView, ScenarioItem, Severity } from '../../api/types';
import { expectationView, scenarioChips, scenarioMeta } from '../../lib/scenarioExpectation';
import { startBanner } from '../../lib/scenarioStart';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { navIcons, toneIcons, trailGlyphs, uiIcons } from '../../ui/icons';
import styles from './scenarioCard.module.css';
import { ScenarioChart } from './ScenarioChart';
import type { ScenarioCommands } from './useScenarioCommands';
import { useRunElapsed } from './useRunElapsed';

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/** The worst severity among the alerts the scenario should raise: the colour of its tile. */
function worstSeverity(item: ScenarioItem): Severity | null {
  if (!item.expected.available) return null;
  const raised = item.expected.alerts.map((alert) => alert.severity);
  return SEVERITY_ORDER.find((severity) => raised.includes(severity)) ?? null;
}

/**
 * "Running · 41 s". A part of its own because it owns the one-second timer of `useRunElapsed`: only a card that is
 * running has one.
 */
function RunningChip({ scenario, lengthS }: { scenario: string; lengthS: number }) {
  const elapsed = useRunElapsed(scenario, lengthS);
  return (
    <Chip tone="warn" icon={uiIcons.play}>
      Running{elapsed === null ? '' : ` · ${Math.floor(elapsed)} s`}
    </Chip>
  );
}

export interface ScenarioCardProps {
  item: ScenarioItem;
  rules: RulesView;
  devices: readonly DeviceInfo[];
  /** A link pointed at this scenario (`?scenario=`): the card is marked. */
  selected: boolean;
  commands: ScenarioCommands;
}

/**
 * A scenario of the library (frame 03): what it is, a chart of what it does to the rules, what the rules should
 * raise and when (in words, as the simulator worked it out), what running it will do to the fleet, and Run or, while it
 * plays, Stop. Whether it plays comes from the state's `runs`, which a command updates at once, not from the library
 * read, which is asked again a moment later. Edit and Duplicate are the editor's (SIM-11) and are not here.
 */
export function ScenarioCard({ item, rules, devices, selected, commands }: ScenarioCardProps) {
  const titleId = useId();
  const running = useStudio(
    (state) => state.view?.runs.some((run) => run.scenario === item.name) ?? false,
  );
  const expectation = expectationView(item);
  const banner = startBanner(item.needsStart);
  const worst = worstSeverity(item);
  const error = commands.errorOf(item.name);

  return (
    <article
      className={styles.card}
      aria-labelledby={titleId}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-running={running ? 'true' : undefined}
    >
      <header className={styles.head}>
        <span className={styles.tile} data-severity={worst ?? undefined} aria-hidden="true">
          <Icon glyph={navIcons.lab} />
        </span>
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.name}>
            {item.name}
          </h2>
          <p className={styles.meta}>{scenarioMeta(item)}</p>
        </div>
        {running ? <RunningChip scenario={item.name} lengthS={item.lengthS} /> : null}
      </header>

      <div className={styles.body}>
        {item.description === '' ? null : <p className={styles.description}>{item.description}</p>}
        <div className={styles.chips}>
          {scenarioChips(item).map((chip) => (
            <Chip key={chip}>
              <span className={styles.mono}>{chip}</span>
            </Chip>
          ))}
        </div>

        <ScenarioChart item={item} rules={rules} devices={devices} running={running} />

        <p className={styles.expect} data-kind={expectation.kind}>
          <Icon
            glyph={expectation.kind === 'unavailable' ? toneIcons.warn : trailGlyphs.alert}
            size="sm"
          />
          <span>
            {expectation.before}
            {expectation.strong === '' ? null : <b>{expectation.strong}</b>}
            {expectation.after}
          </span>
        </p>
        {expectation.notes.length === 0 ? null : (
          <ul className={styles.notes}>
            {expectation.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        {banner === null ? null : (
          <div className={styles.banner} role="note">
            <Icon glyph={toneIcons.warn} size="sm" />
            <span>
              {banner.map((segment, index) =>
                segment.mono ? (
                  <code key={index} className={styles.mono}>
                    {segment.text}
                  </code>
                ) : (
                  segment.text
                ),
              )}
            </span>
          </div>
        )}
      </div>

      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <footer className={styles.foot}>
        {running ? (
          <Button
            variant="danger"
            size="sm"
            icon={uiIcons.stop}
            aria-label={`Stop ${item.name}`}
            aria-busy={commands.isBusy(item.name, 'stop') || undefined}
            disabled={commands.isBusy(item.name)}
            onClick={() => void commands.stop(item.name)}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={uiIcons.play}
            aria-label={`Run ${item.name}`}
            aria-busy={commands.isBusy(item.name, 'run') || undefined}
            disabled={commands.isBusy(item.name)}
            onClick={() => void commands.run(item.name)}
          >
            Run
          </Button>
        )}
      </footer>
    </article>
  );
}
