import { useState } from 'react';
import { kindIdentity } from '../lib/deviceIdentity';
import type { NodeStateName } from '../lib/nodeState';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { DataLine } from '../ui/DataLine';
import { type Column, DataTable } from '../ui/DataTable';
import { DeviceBadge } from '../ui/DeviceBadge';
import { Icon } from '../ui/Icon';
import { metricIcons, uiIcons } from '../ui/icons';
import { NodeState } from '../ui/NodeState';
import { PageHeader } from '../ui/PageHeader';
import { Pager } from '../ui/Pager';
import { Pill } from '../ui/Pill';
import { SeverityBadge } from '../ui/SeverityBadge';
import styles from './foundations.module.css';

const SURFACES = [
  ['--surface-0', 'canvas, inputs'],
  ['--surface-1', 'panels, rail'],
  ['--surface-2', 'elevated, selected'],
  ['--surface-3', 'menus, toasts'],
] as const;

const ROLES = [
  ['--accent', 'accent: you can act on this, or it is selected'],
  ['--success', 'success: healthy, delivered'],
  ['--warning', 'warning: anomaly'],
  ['--danger', 'danger: critical, failed'],
  ['--info', 'info, and the low severity'],
] as const;

const STATES: NodeStateName[] = ['healthy', 'anomaly', 'down', 'paused', 'selected'];
const VARIANTS = ['primary', 'secondary', 'outline', 'danger', 'ghost'] as const;
const DEMO_STATES = [undefined, 'hover', 'pressed', 'focus'] as const;

const MOTION = [
  ['Message on a line', 'A dot and a spark travel along the direction of data', '2.2 s'],
  ['Healthy node', 'The edge light breathes', '3.2 s'],
  ['Anomaly', 'The amber edge pulses', '1.3 s'],
  ['Down', 'The red edge stutters, the dashes march', '2.4 s'],
  ['Selected', 'The indigo halo breathes', '2.4 s'],
  ['Fault injected', 'The node changes state and holds it', '200 ms, once'],
  ['Pause', 'All motion stops; state and camera stay', 'held'],
] as const;

const WIDTHS = [
  ['< 1600 px', 'Labelled navigation, 28 px margin'],
  ['≥ 1600 px', 'Icon rail (labels on hover or pinned), 40 px margin, larger figures'],
  ['≥ 2560 px', 'The whole UI scaled ×1.25'],
  ['≥ 3200 px', 'The whole UI scaled ×1.5, for a wall'],
] as const;

interface Sample {
  id: string;
  state: NodeStateName;
  reading: string;
  seen: string;
}

const SAMPLE: Sample[] = [
  { id: 'dc-env-02', state: 'healthy', reading: '22.4 °C', seen: '2 s ago' },
  { id: 'dc-env-01', state: 'anomaly', reading: '29.3 °C', seen: '1 s ago' },
  { id: 'lha-air-01', state: 'healthy', reading: '688 ppm', seen: '2 s ago' },
  { id: 'hub-power-01', state: 'down', reading: '—', seen: '4 min ago' },
];

const COLUMNS: Column<Sample>[] = [
  { id: 'device', header: 'Device', cell: (row) => <code>{row.id}</code> },
  {
    id: 'state',
    header: 'State',
    cell: (row) => (
      <Chip tone={row.state === 'healthy' ? 'ok' : row.state === 'anomaly' ? 'warn' : 'bad'}>
        {row.state}
      </Chip>
    ),
  },
  { id: 'reading', header: 'Reading', cell: (row) => row.reading, align: 'end' },
  { id: 'seen', header: 'Seen', cell: (row) => row.seen, align: 'end' },
];

/**
 * The electric language of Studio, built from the shared components (frame 00): tokens, status, type,
 * controls, motion, device identity, data lines, wide screens, tables. Internal: it is the page a
 * developer opens to see a component in every state, and it exists in development and in tests, not in
 * the packaged demo. Contrast ratios are not copied here: `pnpm lint` measures them from the token file.
 */
export function Foundations() {
  const [page, setPage] = useState(2);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string | null>('dc-env-01');

  return (
    <>
      <PageHeader
        title="Foundations"
        description="The electric neon language of Studio: tokens, status, device identity, data lines, controls, motion and the wide-screen rules every page reuses."
      >
        <Chip tone="accent">Internal · /foundations</Chip>
      </PageHeader>

      <Card title="Surfaces and text">
        <div className={styles.swatches}>
          {SURFACES.map(([token, use]) => (
            <div key={token} className={styles.swatch}>
              <div className={styles.chipColor} style={{ background: `var(${token})` }} />
              <code>{token}</code>
              <span className={styles.muted}>{use}</span>
            </div>
          ))}
        </div>
        <p>
          Primary text, <span className={styles.secondary}>secondary text</span> and{' '}
          <span className={styles.tertiary}>tertiary text</span>. The smallest text is 13 px. The
          glow is a shadow outside a border and never behind text; only numerals of 24 px and up may
          glow.
        </p>
      </Card>

      <Card title="Colour roles">
        <div className={styles.swatches}>
          {ROLES.map(([token, use]) => (
            <div key={token} className={styles.swatch}>
              <div className={styles.chipColor} style={{ background: `var(${token})` }} />
              <code>{token}</code>
              <span className={styles.muted}>{use}</span>
            </div>
          ))}
        </div>
        <div className={styles.row}>
          <SeverityBadge severity="critical" />
          <SeverityBadge severity="high" />
          <SeverityBadge severity="medium" />
          <SeverityBadge severity="low" />
          <Chip tone="accent">Accent</Chip>
          <Chip tone="ok">Healthy</Chip>
          <Chip tone="warn">Anomaly</Chip>
          <Chip tone="bad">Down</Chip>
        </div>
      </Card>

      <Card title="Status language">
        <p className={styles.muted}>
          The edge light is the state, in motion. A state is also always a border style, an icon and
          a word: never colour or light alone. At most 12 nodes animate at once; the rest hold their
          glow still.
        </p>
        <div className={styles.row}>
          {STATES.map((state) => (
            <NodeState key={state} state={state}>
              {state === 'selected' ? 'dc-env-01' : `node ${state}`}
            </NodeState>
          ))}
        </div>
        <div className={styles.row}>
          <Pill label="Broker" detail=":1883" tone="ok" />
          <Pill label="Ingest" detail="not ready · database down" tone="warn" />
          <Pill label="Ingest" detail="unreachable" tone="bad" />
          <Pill label="Command Center" detail="unknown" tone="unknown" />
          <Pill label="Broker" detail=":1883" tone="ok" stale />
        </div>
      </Card>

      <Card title="Type">
        <div className={styles.row}>
          <span className={`${styles.numeral} ${styles.neonCyan}`}>29.3 °C</span>
          <span className={`${styles.numeral} ${styles.neonAmber}`}>1450 ppm</span>
          <span className={`${styles.numeral} ${styles.neonGreen}`}>0 gaps</span>
        </div>
        <p>Body text. The smallest text is 13 px.</p>
        <code>campus/BLD-DC/dc-env-01/telemetry</code>
        <p className={styles.muted}>
          Geist for the interface, JetBrains Mono for ids, topics, payloads, logs and rule names.
          Numbers are tabular, so a live value never moves its neighbours.
        </p>
      </Card>

      <Card title="Controls">
        <p className={styles.muted}>
          A control lights up when it can act, answers a hover within 120 ms, drops a pixel when
          pressed, and has no light at all when disabled.
        </p>
        <table className={styles.states}>
          <caption className="visually-hidden">Every variant of a button in every state</caption>
          <thead>
            <tr>
              <th scope="col">Variant</th>
              <th scope="col">Default</th>
              <th scope="col">Hover</th>
              <th scope="col">Pressed</th>
              <th scope="col">Focus</th>
              <th scope="col">Disabled</th>
            </tr>
          </thead>
          <tbody>
            {VARIANTS.map((variant) => (
              <tr key={variant}>
                <th scope="row">{variant}</th>
                {DEMO_STATES.map((demo) => (
                  <td key={demo ?? 'default'}>
                    <Button variant={variant} demoState={demo} tabIndex={-1}>
                      Run
                    </Button>
                  </td>
                ))}
                <td>
                  <Button variant={variant} disabled>
                    Run
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.row}>
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg">Large</Button>
          <Button icon={uiIcons.search}>With an icon</Button>
          <Button icon={uiIcons.close} aria-label="Close" />
        </div>
      </Card>

      <Card title="Motion">
        <p className={styles.muted}>
          Motion follows the engine&rsquo;s state, never a loop of its own. With reduced motion the
          dots, sparks, breathing and flicker are not drawn; the glow stays, still. Caps: 4 dots per
          line, 24 on screen, 24 glowing lines, 12 animated nodes.
        </p>
        <table className={styles.plain}>
          <caption className="visually-hidden">The motion of each event</caption>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Effect</th>
              <th scope="col">Timing</th>
            </tr>
          </thead>
          <tbody>
            {MOTION.map(([event, effect, timing]) => (
              <tr key={event}>
                <th scope="row">{event}</th>
                <td>{effect}</td>
                <td>{timing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Device identity">
        <p className={styles.muted}>
          Three kinds, three shapes, one glyph each, so a device is recognisable in a graph, on a
          card and in 3D without reading its name. The shape is the kind and the edge light is the
          state.
        </p>
        <div className={styles.row}>
          {(['server_room', 'indoor_air', 'power_meter'] as const).map((kind) => (
            <div key={kind} className={styles.identity}>
              <span className={styles.muted}>{kindIdentity(kind).label}</span>
              <div className={styles.row}>
                <DeviceBadge kind={kind} code="DC·1" state="healthy" />
                <DeviceBadge kind={kind} code="DC·1" state="anomaly" />
                <DeviceBadge kind={kind} code="DC·1" state="down" />
              </div>
            </div>
          ))}
        </div>
        <ul className={styles.metrics}>
          {(
            [
              ['temperature', 'temperature_c'],
              ['humidity', 'humidity_pct'],
              ['co2', 'co2_ppm'],
              ['power', 'power_kw'],
            ] as const
          ).map(([icon, name]) => (
            <li key={name}>
              <Icon glyph={metricIcons[icon]} />
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Data lines">
        <p className={styles.muted}>
          Light means energy is moving. A line that carries nothing is a dim dashed wire, so the
          glow can be trusted.
        </p>
        <div className={styles.row}>
          <DataLine from={[4, 12]} to={[116, 12]} flowing />
          <DataLine from={[4, 12]} to={[116, 12]} flowing={false} />
        </div>
      </Card>

      <Card title="Wide screens">
        <table className={styles.plain}>
          <caption className="visually-hidden">What changes at each width</caption>
          <thead>
            <tr>
              <th scope="col">Width</th>
              <th scope="col">Layout</th>
            </tr>
          </thead>
          <tbody>
            {WIDTHS.map(([width, layout]) => (
              <tr key={width}>
                <th scope="row">{width}</th>
                <td>{layout}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.muted}>
          Nothing is capped at a maximum content width. The glow is drawn in CSS pixels, so it
          scales with the whole UI.
        </p>
      </Card>

      <Card title="Tables and paging">
        <DataTable
          caption="Devices with their state and reading"
          columns={COLUMNS}
          rows={SAMPLE}
          rowKey={(row) => row.id}
          selectedKey={selected}
          onRowClick={(row) => setSelected(row.id)}
          rowAction={(row) => (
            <Button size="sm" variant="ghost" onClick={() => setSelected(row.id)}>
              Open
            </Button>
          )}
        />
        <Pager
          page={page}
          pageSize={pageSize}
          total={312}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </Card>
    </>
  );
}
