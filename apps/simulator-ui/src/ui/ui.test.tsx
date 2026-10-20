import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnimationBudget } from '../lib/animationBudget';
import { AnimationBudgetProvider } from './AnimationBudget';
import { Button } from './Button';
import { Chip } from './Chip';
import { DataLine } from './DataLine';
import { type Column, DataTable } from './DataTable';
import { DeviceBadge } from './DeviceBadge';
import { Icon } from './Icon';
import { uiIcons } from './icons';
import { NodeState } from './NodeState';
import { Pager } from './Pager';
import { Pill } from './Pill';
import { SeverityBadge } from './SeverityBadge';

const withBudget = (ui: ReactNode, budget = new AnimationBudget()) => (
  <AnimationBudgetProvider budget={budget}>{ui}</AnimationBudgetProvider>
);
const count = (container: HTMLElement, selector: string) =>
  container.querySelectorAll(selector).length;

describe('Pill', () => {
  it('says its label, its detail and, for a screen reader, its tone', () => {
    render(<Pill label="Ingest" detail=":3100" tone="ok" />);
    const pill = screen.getByText('Ingest').closest('span[data-tone]');
    expect(pill).toHaveTextContent('Ingest');
    expect(pill).toHaveTextContent(':3100');
    expect(pill).toHaveTextContent('ok');
    expect(pill).toHaveAttribute('data-tone', 'ok');
  });

  it('has an icon for the tone that no screen reader reads, so the state is not colour alone', () => {
    const { container } = render(<Pill label="Broker" detail="disconnected" tone="bad" />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('problem')).toBeInTheDocument();
  });

  it('marks old data as stale and says it is the last known', () => {
    render(<Pill label="Broker" detail=":1883" tone="ok" stale />);
    expect(screen.getByText(/last known/)).toBeInTheDocument();
    expect(screen.getByText('Broker').closest('span[data-tone]')).toHaveAttribute(
      'data-stale',
      'true',
    );
  });

  it('animates only when it asks for attention, is not stale, and the budget allows it', () => {
    const attention = render(withBudget(<Pill label="Ingest" tone="bad" detail="unreachable" />));
    expect(count(attention.container, '[data-animated="true"]')).toBe(1);
    attention.unmount();

    for (const props of [
      { tone: 'ok' as const },
      { tone: 'unknown' as const },
      { tone: 'bad' as const, stale: true },
    ]) {
      const { container, unmount } = render(withBudget(<Pill label="x" {...props} />));
      expect(count(container, '[data-animated]')).toBe(0);
      unmount();
    }
  });
});

describe('Chip and SeverityBadge', () => {
  it('shows a chip with its words and its glyph', () => {
    const { container } = render(
      <Chip tone="warn" icon={uiIcons.check}>
        Anomaly
      </Chip>,
    );
    expect(screen.getByText('Anomaly').closest('span')).toHaveAttribute('data-tone', 'warn');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows the severity as a word with an icon', () => {
    const { container } = render(<SeverityBadge severity="critical" />);
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(container.querySelector('[data-severity="critical"] svg')).toBeInTheDocument();
  });
});

describe('Icon', () => {
  it('is hidden from a screen reader unless it has a label', () => {
    const { container, rerender } = render(<Icon glyph={uiIcons.search} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Icon glyph={uiIcons.search} label="Search" />);
    expect(screen.getByRole('img', { name: 'Search' })).toBeInTheDocument();
  });
});

describe('NodeState', () => {
  it('says its state in words for every state', () => {
    const states = ['healthy', 'anomaly', 'down', 'paused', 'selected'] as const;
    const words = ['Healthy', 'Anomaly', 'Down', 'Paused', 'Selected'];
    render(
      <>
        {states.map((state) => (
          <NodeState key={state} state={state}>
            node-{state}
          </NodeState>
        ))}
      </>,
    );
    for (const word of words) expect(screen.getByText(word)).toBeInTheDocument();
  });

  it('keeps a paused node dark: it never takes a slot of the budget', () => {
    const budget = new AnimationBudget();
    const { container } = render(
      withBudget(<NodeState state="paused">hub-power-01</NodeState>, budget),
    );
    expect(count(container, '[data-animated]')).toBe(0);
    expect(budget.counts('node')).toEqual({ held: 0, granted: 0 });
  });
});

describe('the animation caps', () => {
  it('lets 12 nodes animate and 24 lines glow out of 40 and 60, and draws the rest still', () => {
    const { container } = render(
      withBudget(
        <>
          {Array.from({ length: 40 }, (_, i) => (
            <NodeState key={`n${i}`} state="healthy">
              node {i}
            </NodeState>
          ))}
          {Array.from({ length: 60 }, (_, i) => (
            <DataLine key={`l${i}`} from={[0, 12]} to={[100, 12]} flowing />
          ))}
        </>,
      ),
    );
    expect(count(container, '[data-animated="true"]')).toBe(12);
    expect(count(container, '[data-glowing="true"]')).toBe(24);
    expect(count(container, '[data-state="healthy"]')).toBe(40); // all 40 keep their state and glow
    expect(count(container, '[data-flowing="true"]')).toBe(60);
  });

  it('hands the movement to the next node when one leaves', () => {
    const budget = new AnimationBudget();
    const draw = (list: number[]) =>
      withBudget(
        <>
          {list.map((id) => (
            <NodeState key={id} state="anomaly">
              n{id}
            </NodeState>
          ))}
        </>,
        budget,
      );
    const ids = Array.from({ length: 14 }, (_, i) => i);
    const { container, rerender } = render(draw(ids));
    expect(count(container, '[data-animated="true"]')).toBe(12);

    rerender(draw(ids.slice(2))); // the first two, which held the slots, leave
    expect(count(container, '[data-animated="true"]')).toBe(12); // the two that waited took them
    expect(budget.counts('node')).toEqual({ held: 12, granted: 12 });
  });

  it('gives a line that carries nothing no light, and no slot', () => {
    const budget = new AnimationBudget();
    const { container } = render(
      withBudget(<DataLine from={[0, 12]} to={[100, 12]} flowing={false} />, budget),
    );
    expect(count(container, '[data-glowing]')).toBe(0);
    expect(budget.counts('line')).toEqual({ held: 0, granted: 0 });
    expect(screen.getByRole('img', { name: 'No data moving' })).toBeInTheDocument();
  });

  it('animates nothing outside a budget', () => {
    const { container } = render(
      <>
        <Pill label="Ingest" tone="bad" />
        <NodeState state="down">dc-env-01</NodeState>
        <DataLine from={[0, 12]} to={[100, 12]} flowing />
      </>,
    );
    expect(count(container, '[data-animated],[data-glowing]')).toBe(0);
  });
});

describe('DeviceBadge', () => {
  it('names the kind, the code and the state', () => {
    render(<DeviceBadge kind="server_room" code="DC·1" state="anomaly" />);
    expect(screen.getByRole('img', { name: 'Server room DC·1, anomaly' })).toBeInTheDocument();
  });

  it('gives each kind its shape, and a kind it does not know a neutral one', () => {
    const shape = (kind: string) => {
      const { container, unmount } = render(<DeviceBadge kind={kind} code="X" />);
      const found = container.querySelector('[data-shape]')?.getAttribute('data-shape');
      unmount();
      return found;
    };
    expect([
      shape('server_room'),
      shape('indoor_air'),
      shape('power_meter'),
      shape('water_meter'),
    ]).toEqual(['rounded-square', 'circle', 'hexagon', 'rounded']);
  });
});

describe('Button', () => {
  it('is a button that does not submit, with a variant and a size', () => {
    render(
      <Button variant="primary" size="lg">
        Run
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Run' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('data-size', 'lg');
  });

  it('calls its handler when clicked, and not when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Pause</Button>);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Pause
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  });

  it('can be reached and used from the keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Step</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Step' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is square with only an icon, and named by its aria-label', () => {
    render(<Button icon={uiIcons.close} aria-label="Close" />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('data-icon-only', 'true');
  });

  it('can show a state without a pointer, for the Foundations page', () => {
    render(<Button demoState="hover">Run</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-demo', 'hover');
  });
});

interface Row {
  id: string;
  device: string;
  reading: string;
}
const rows: Row[] = [
  { id: 'a', device: 'dc-env-01', reading: '29.3 °C' },
  { id: 'b', device: 'dc-env-02', reading: '22.4 °C' },
];
const columns: Column<Row>[] = [
  { id: 'device', header: 'Device', cell: (row) => row.device },
  { id: 'reading', header: 'Reading', cell: (row) => row.reading, align: 'end' },
];

describe('DataTable', () => {
  it('has a name, column headers and a row per item', () => {
    render(<DataTable caption="Devices" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole('table', { name: 'Devices' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Device', 'Reading']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('29.3 °C')).toBeInTheDocument();
  });

  it('makes no tab stops when rows open nothing', () => {
    render(<DataTable caption="Devices" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    for (const row of screen.getAllByRole('row')) expect(row).not.toHaveAttribute('tabindex');
  });

  it('opens a row on a click, on Enter and on Space', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="Devices"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    await user.click(screen.getByText('dc-env-01'));
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0]);

    const second = screen.getByText('dc-env-02').closest('tr')!;
    second.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });

  it('marks the selected row', () => {
    render(
      <DataTable
        caption="Devices"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey="b"
      />,
    );
    expect(screen.getByText('dc-env-02').closest('tr')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('dc-env-01').closest('tr')).not.toHaveAttribute('aria-current');
  });

  it('puts a quiet action in each row, which does not open the row from the keyboard', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    render(
      <DataTable
        caption="Devices"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        rowAction={(row) => (
          <Button size="sm" variant="ghost" onClick={() => onAction(row.id)}>
            Open {row.device}
          </Button>
        )}
      />,
    );
    screen.getByRole('button', { name: 'Open dc-env-01' }).focus();
    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith('a');
    expect(onRowClick).not.toHaveBeenCalled(); // using the action does not also open the row
  });

  it('says so when there are no rows', () => {
    render(
      <DataTable
        caption="Devices"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty="No devices yet"
      />,
    );
    expect(screen.getByText('No devices yet')).toBeInTheDocument();
  });
});

describe('Pager', () => {
  const props = { total: 312, pageSize: 25, onPageChange: vi.fn(), onPageSizeChange: vi.fn() };

  it('reads the range and the total', () => {
    render(<Pager {...props} page={2} />);
    expect(screen.getByRole('navigation', { name: 'Rows pages' })).toHaveTextContent(
      /Rows 26–50 of 312/,
    );
  });

  it('lights the current page and marks it for a screen reader', () => {
    render(<Pager {...props} page={7} />);
    expect(screen.getByRole('button', { name: 'Page 7' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 8' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 13' })).toBeInTheDocument();
  });

  it('turns the page on a click, with previous and next', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pager {...props} page={7} onPageChange={onPageChange} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await user.click(screen.getByRole('button', { name: 'Page 13' }));
    expect(onPageChange.mock.calls).toEqual([[8], [6], [13]]);
  });

  it('has no light at its ends: the first page cannot go back, the last cannot go on', () => {
    const { rerender } = render(<Pager {...props} page={1} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    rerender(<Pager {...props} page={13} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('changes the rows per page', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(<Pager {...props} page={1} onPageSizeChange={onPageSizeChange} />);
    await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    expect(
      within(screen.getByLabelText('Rows per page'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['10', '25', '50', '100']);
  });

  it('copes with a page out of range and with no rows', () => {
    const { rerender } = render(<Pager {...props} page={99} />);
    expect(screen.getByRole('button', { name: 'Page 13' })).toHaveAttribute('aria-current', 'page');
    rerender(<Pager {...props} total={0} page={1} />);
    expect(screen.getByRole('navigation', { name: 'Rows pages' })).toHaveTextContent(
      /Rows 0–0 of 0/,
    );
  });
});
