import { Link } from 'react-router';
import type { PagedAlert, RulesView } from '../../api/types';
import { alertTrail } from '../../lib/alertTrail';
import { alertWhy, ruleOf } from '../../lib/alertWhy';
import { ingestFields, severityOf } from '../../lib/alertRows';
import { consoleHref } from '../../lib/topologyDetail';
import { useSeries } from '../../state/historyContext';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { DeliveryChip } from '../../ui/DeliveryChip';
import { Icon } from '../../ui/Icon';
import { toneIcons, uiIcons } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { CopyButton } from '../fleet/CopyButton';
import styles from './alerts.module.css';
import { AlertTrail } from './AlertTrail';

export interface AlertDetailProps {
  alert: PagedAlert;
  rules: RulesView;
  /** The command center's console (`config.consoleUrl`), or `null`: the incident is then its plain id. */
  consoleUrl: string | null;
  /** The row of this alert is not on the page shown; what is drawn is the live feed's copy, which has no cause. */
  notOnPage: boolean;
}

/**
 * One alert: why it was raised (the rule, the readings, and the Studio scenario only when the simulator names one),
 * where it went (the delivery trail), and what can be done with it. With a console URL set, _Open command center_
 * goes to the console and the incident is named by its id beside it, with a copy button: which page of the console
 * shows an incident is that console's own route, which Studio does not know and does not guess.
 */
export function AlertDetail({ alert, rules, consoleUrl, notOnPage }: AlertDetailProps) {
  const series = useSeries(alert.deviceId, alert.metric);
  const rule = ruleOf(rules, alert);
  const why = alertWhy({ alert, rule, series });
  const trail = alertTrail({ alert, rule, series });
  const href = consoleHref(consoleUrl);

  return (
    <Card
      title={alert.title}
      aside={
        <>
          <SeverityBadge severity={severityOf(alert.severity)} />
          <span className={styles.mono}>#{alert.id}</span>
        </>
      }
    >
      <div className={styles.detail}>
        {notOnPage ? (
          <p className={styles.notice} role="status">
            This alert is not on the page shown. What is drawn is the live feed&rsquo;s copy of it,
            which does not say what caused it.
          </p>
        ) : null}

        <div className={styles.statuses}>
          {alert.status === 'open' ? (
            <Chip tone="warn" icon={toneIcons.warn}>
              Open
            </Chip>
          ) : (
            <Chip tone="ok" icon={toneIcons.ok}>
              Cleared
            </Chip>
          )}
          <DeliveryChip alert={alert} />
        </div>

        <div className={styles.why}>
          <Icon glyph={toneIcons.warn} />
          <div>
            <p>
              <b>Why:</b> {why.text}
            </p>
            {why.cause ? <p className={styles.whyCause}>{why.cause}</p> : null}
          </div>
        </div>

        <div>
          <span className={styles.label}>Delivery trail</span>
          <AlertTrail trail={trail} />
        </div>

        {alert.externalRef ? (
          <div className={styles.incident}>
            Incident <span className={styles.mono}>{alert.externalRef}</span>
            <CopyButton text={alert.externalRef} label="incident id" />
          </div>
        ) : null}

        <div className={styles.actions}>
          {alert.externalRef && href ? (
            <a className={styles.linkButton} href={href} target="_blank" rel="noreferrer">
              Open command center
              <Icon glyph={uiIcons.external} size="sm" />
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : null}
          <Link
            className={styles.linkButton}
            to={`/topology?device=${encodeURIComponent(alert.deviceId)}`}
          >
            Show in topology
          </Link>
          <CopyButton text={JSON.stringify(ingestFields(alert), null, 2)} label="alert as JSON">
            Copy as JSON
          </CopyButton>
        </div>
      </div>
    </Card>
  );
}
