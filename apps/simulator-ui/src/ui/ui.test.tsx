import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnimationBudget } from '../lib/animationBudget';
import { axeViolations } from '../test-axe';
import { AnimationBudgetProvider } from './AnimationBudget';
import { Banner } from './Banner';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Chip } from './Chip';
import { ColumnChooser } from './ColumnChooser';
import { CursorPager } from './CursorPager';
import { DataLine } from './DataLine';
import { type Column, DataTable } from './DataTable';
import { DeliveryChip } from './DeliveryChip';
import { DeviceBadge } from './DeviceBadge';
import { Icon } from './Icon';
import { uiIcons } from './icons';
import { NodeState } from './NodeState';
import { Pager } from './Pager';
import { Pill } from './Pill';
import { Segmented } from './Segmented';
import { SelectField } from './SelectField';
import { SeverityBadge } from './SeverityBadge';
import { Switch } from './Switch';
import { tabId } from './tabId';
import { Tabs } from './Tabs';

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

  it('says what the rows are sorted by after the range, and names the nouns of cards', () => {
    render(
      <Pager
        {...props}
        total={38}
        pageSize={6}
        page={1}
        noun="Scenarios"
        sizeLabel="Cards per page"
        sizes={[6, 12, 24]}
        rangeNote="recently run first"
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Scenarios pages' })).toHaveTextContent(
      /Scenarios 1–6 of 38, recently run first/,
    );
    expect(
      within(screen.getByLabelText('Cards per page'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['6', '12', '24']);
  });

  it('announces the range politely only when asked to', () => {
    const { rerender } = render(<Pager {...props} page={1} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<Pager {...props} page={1} announce />);
    expect(screen.getByRole('status')).toHaveTextContent(/Rows 1–25 of 312/);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('copes with a page out of range and with no rows', () => {
    const { rerender } = render(<Pager {...props} page={99} />);
    expect(screen.getByRole('button', { name: 'Page 13' })).toHaveAttribute('aria-current', 'page');
    rerender(<Pager {...props} total={0} page={1} />);
    expect(screen.getByRole('navigation', { name: 'Rows pages' })).toHaveTextContent(
      /Rows 0–0 of 0/,
    );
  });

  describe('compact, for the top of a table', () => {
    it('is the page buttons alone: no range, no rows per page', () => {
      render(<Pager {...props} page={2} variant="compact" label="Events pages (top)" />);
      const nav = screen.getByRole('navigation', { name: 'Events pages (top)' });
      expect(nav).not.toHaveTextContent(/Rows 26/);
      expect(within(nav).queryByLabelText('Rows per page')).not.toBeInTheDocument();
      expect(within(nav).getByRole('button', { name: 'Page 2' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('turns the page like the full one, and keeps a name apart from it', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      render(
        <>
          <Pager
            {...props}
            page={7}
            variant="compact"
            label="Rows pages (top)"
            onPageChange={onPageChange}
          />
          <Pager {...props} page={7} />
        </>,
      );
      await user.click(
        within(screen.getByRole('navigation', { name: 'Rows pages (top)' })).getByRole('button', {
          name: 'Next page',
        }),
      );
      expect(onPageChange).toHaveBeenCalledWith(8);
      // The two navigations have two names, and only the full one has the range and the size.
      expect(screen.getAllByRole('navigation')).toHaveLength(2);
      expect(screen.getAllByLabelText('Rows per page')).toHaveLength(1);
    });

    it('is the full pager unless asked: the label is only the name', () => {
      render(<Pager {...props} page={1} label="Events pages" />);
      const nav = screen.getByRole('navigation', { name: 'Events pages' });
      expect(nav).toHaveTextContent(/Rows 1–25 of 312/);
      expect(within(nav).getByLabelText('Rows per page')).toBeInTheDocument();
    });
  });
});

describe('Switch', () => {
  it('is a switch with the words beside it as its name, and reports the new state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Snap to 5 s" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Snap to 5 s' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Snap to 5 s')).toBeVisible();
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('says it is on, and toggles with Space from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Snap" checked onChange={onChange} />);
    expect(screen.getByRole('switch', { name: 'Snap' })).toBeChecked();
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('can keep its label for a screen reader only, and still toggles under that name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Drop messages" labelHidden checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Drop messages' });
    expect(screen.getByText('Drop messages')).toHaveClass('visually-hidden');
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing while it is disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Snap" checked={false} onChange={onChange} disabled />);
    await user.click(screen.getByRole('switch', { name: 'Snap' }));
    expect(screen.getByRole('switch', { name: 'Snap' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no accessibility violation', async () => {
    const { container } = render(<Switch label="Snap to 5 s" checked onChange={() => {}} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Checkbox', () => {
  it('is a checkbox with the name it was given, and reports the new state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="Select dc-env-01" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Select dc-env-01' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles with Space from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="Select" checked onChange={onChange} />);
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('can be indeterminate, which a screen reader hears as mixed', () => {
    render(<Checkbox label="Select this page" checked={false} indeterminate onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Select this page' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box).toBePartiallyChecked();
  });

  it('does nothing when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="x" checked={false} disabled onChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DataTable sorting', () => {
  const sortable: Column<Row>[] = [
    { id: 'device', header: 'Device', cell: (row) => row.device, sortable: true },
    { id: 'reading', header: 'Reading', cell: (row) => row.reading, align: 'end' },
  ];

  it('makes a sortable header a button and asks for that column', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <DataTable
        caption="Devices"
        columns={sortable}
        rows={rows}
        rowKey={(r) => r.id}
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Device' }));
    expect(onSortChange).toHaveBeenCalledWith('device');
    expect(screen.queryByRole('button', { name: 'Reading' })).not.toBeInTheDocument();
  });

  it('says which column is sorted and which way, and "none" for the others that can be', () => {
    render(
      <DataTable
        caption="Devices"
        columns={[...sortable, { id: 'zone', header: 'Zone', cell: () => 'x', sortable: true }]}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: 'device', direction: 'desc' }}
        onSortChange={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Device' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: 'Zone' })).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'Reading' })).not.toHaveAttribute('aria-sort');
  });

  it('says ascending', () => {
    render(
      <DataTable
        caption="Devices"
        columns={sortable}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: 'device', direction: 'asc' }}
        onSortChange={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Device' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('leaves a header as plain text when nothing handles the sort', () => {
    render(<DataTable caption="Devices" columns={sortable} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Device' })).not.toHaveAttribute('aria-sort');
  });
});

describe('DataTable selection', () => {
  const selection = (
    selected: string[],
    pageState: 'none' | 'some' | 'all',
    handlers: { onToggle?: (key: string) => void; onTogglePage?: (on: boolean) => void } = {},
  ) => ({
    selected: new Set(selected),
    pageState,
    onToggle: handlers.onToggle ?? (() => {}),
    onTogglePage: handlers.onTogglePage ?? (() => {}),
    label: (row: Row) => `Select ${row.device}`,
  });

  it('adds a box to each row and one to the header, each with a name', () => {
    render(
      <DataTable
        caption="Devices"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={selection(['a'], 'some')}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select this page' })).toBePartiallyChecked();
    expect(screen.getByRole('checkbox', { name: 'Select dc-env-01' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select dc-env-02' })).not.toBeChecked();
  });

  it('names a row box "Select <key>" when no label is given', () => {
    render(
      <DataTable
        caption="Devices"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{ ...selection([], 'none'), label: undefined }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select a' })).toBeInTheDocument();
  });

  it('ticks all of the page from the header box, and clears it when all were selected', async () => {
    const user = userEvent.setup();
    const onTogglePage = vi.fn();
    const none = render(
      <DataTable
        caption="D"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={selection([], 'none', { onTogglePage })}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select this page' }));
    expect(onTogglePage).toHaveBeenLastCalledWith(true);
    none.unmount();

    render(
      <DataTable
        caption="D"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={selection(['a', 'b'], 'all', { onTogglePage })}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select this page' }));
    expect(onTogglePage).toHaveBeenLastCalledWith(false);
  });

  it('toggles one row from its box without opening the row', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="D"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        selection={selection([], 'none', { onToggle })}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select dc-env-02' }));
    expect(onToggle).toHaveBeenCalledWith('b');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('toggles a row from the keyboard with Space, which does not open the row either', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="D"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        selection={selection([], 'none', { onToggle })}
      />,
    );
    screen.getByRole('checkbox', { name: 'Select dc-env-01' }).focus();
    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledWith('a');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('marks the selected rows for styling', () => {
    render(
      <DataTable
        caption="D"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={selection(['b'], 'some')}
      />,
    );
    expect(screen.getByText('dc-env-02').closest('tr')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('dc-env-01').closest('tr')).not.toHaveAttribute('data-selected');
  });

  it('has no accessibility violations with a sort and a selection', async () => {
    const { container } = render(
      <DataTable
        caption="Devices"
        columns={[{ id: 'device', header: 'Device', cell: (r) => r.device, sortable: true }]}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: 'device', direction: 'asc' }}
        onSortChange={() => {}}
        selection={selection(['a'], 'some')}
        stickyHeader
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'all', label: 'All', count: 31 },
    { id: 'running', label: 'Running', count: 27 },
    { id: 'paused', label: 'Paused', count: 1 },
  ];
  const setup = (value = 'all') => {
    const onChange = vi.fn();
    const view = render(
      <>
        <Tabs
          tabs={tabs}
          value={value}
          onChange={onChange}
          label="State"
          idPrefix="fleet"
          panelId="panel"
        />
        <div role="tabpanel" id="panel" aria-labelledby={tabId('fleet', value)} />
      </>,
    );
    return { onChange, ...view };
  };

  it('is a tablist with a name, a tab for each with its count, and the selected one marked', () => {
    setup('running');
    expect(screen.getByRole('tablist', { name: 'State' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'All31',
      'Running27',
      'Paused1',
    ]);
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('points the selected tab at its panel, and gives each tab an id a panel can name', () => {
    setup('running');
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveAttribute('aria-controls', 'panel');
    expect(screen.getByRole('tab', { name: /All/ })).not.toHaveAttribute('aria-controls');
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveAttribute(
      'id',
      tabId('fleet', 'running'),
    );
  });

  it('is one tab stop: only the selected tab is in the tab order', () => {
    setup('running');
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('tabindex', '-1');
  });

  it('selects on a click', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('tab', { name: /Paused/ }));
    expect(onChange).toHaveBeenCalledWith('paused');
  });

  it('moves with the arrow keys, Home and End, wrapping at the ends, and focuses what it selects', async () => {
    const user = userEvent.setup();
    const { onChange } = setup('all');
    screen.getByRole('tab', { name: /All/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('running');
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('paused');
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('all');
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('paused');
  });

  it('has no accessibility violations', async () => {
    const { container } = setup('running');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'cards', label: 'Cards' },
    { value: 'table', label: 'Table' },
  ];

  it('is a radio group with a name; the chosen option is checked', () => {
    render(<Segmented options={options} value="table" onChange={() => {}} label="View" />);
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Cards' })).not.toBeChecked();
  });

  it('chooses on a click and with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented options={options} value="cards" onChange={onChange} label="View" />);
    await user.click(screen.getByText('Table'));
    expect(onChange).toHaveBeenLastCalledWith('table');
    screen.getByRole('radio', { name: 'Cards' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('table');
  });

  it('does not offer a disabled option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        options={[
          { value: 'cards', label: 'Cards', disabled: true },
          { value: 'table', label: 'Table' },
        ]}
        value="table"
        onChange={onChange}
        label="View"
      />,
    );
    expect(screen.getByRole('radio', { name: 'Cards' })).toBeDisabled();
    await user.click(screen.getByText('Cards'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <Segmented options={options} value="cards" onChange={() => {}} label="View" />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('ColumnChooser', () => {
  const columns = [
    { id: 'device', label: 'Device', locked: true },
    { id: 'zone', label: 'Zone' },
    { id: 'seen', label: 'Last seen' },
  ];

  it('is closed until the button is pressed, and says whether it is open', async () => {
    const user = userEvent.setup();
    render(<ColumnChooser columns={columns} visible={new Set(['zone'])} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Columns' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Columns to show' })).not.toBeInTheDocument();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Columns to show' })).toBeInTheDocument();
  });

  it('lists each column with a box: ticked if shown, and the locked one ticked and fixed', async () => {
    const user = userEvent.setup();
    render(<ColumnChooser columns={columns} visible={new Set(['zone'])} onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('checkbox', { name: 'Device' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Device' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Zone' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Last seen' })).not.toBeChecked();
  });

  it('reports the new set without changing the one it was given', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const visible = new Set(['zone']);
    render(<ColumnChooser columns={columns} visible={visible} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'Last seen' }));
    expect([...(onChange.mock.calls[0]![0] as Set<string>)].sort()).toEqual(['seen', 'zone']);
    await user.click(screen.getByRole('checkbox', { name: 'Zone' }));
    expect([...(onChange.mock.calls[1]![0] as Set<string>)]).toEqual([]);
    expect([...visible]).toEqual(['zone']);
  });

  it('closes on Esc and puts focus back on the button', async () => {
    const user = userEvent.setup();
    render(<ColumnChooser columns={columns} visible={new Set()} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Columns' });
    await user.click(button);
    await user.tab();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Columns to show' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes on a click elsewhere', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p>elsewhere</p>
        <ColumnChooser columns={columns} visible={new Set()} onChange={() => {}} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByText('elsewhere'));
    expect(screen.queryByRole('group', { name: 'Columns to show' })).not.toBeInTheDocument();
  });

  it('has no accessibility violations when open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ColumnChooser columns={columns} visible={new Set(['zone'])} onChange={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('DeliveryChip', () => {
  const chip = (
    deliveryStatus: string | null,
    deliveryAttempts: number | null = 1,
    deliveryError: string | null = null,
  ) => render(<DeliveryChip alert={{ deliveryStatus, deliveryAttempts, deliveryError }} />);

  it('says delivered with its attempts, in words and with an icon', () => {
    const { container } = chip('delivered', 2);
    expect(screen.getByText(/Delivered · 2 attempts/)).toHaveAttribute('data-tone', 'ok');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('says pending, failed with ingest’s error, and skipped', () => {
    const { unmount } = chip('pending', 1);
    expect(screen.getByText(/Pending · 1 attempt$/)).toHaveAttribute('data-tone', 'warn');
    unmount();

    const failed = chip('failed', 3, 'HTTP 502');
    expect(screen.getByText(/Failed · 3 attempts · HTTP 502/)).toHaveAttribute('data-tone', 'bad');
    failed.unmount();

    chip('skipped', 0);
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('leaves out the attempts when ingest gives none', () => {
    chip('delivered', null);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
  });

  it('never says delivered for a status it does not know, or for none', () => {
    const { unmount } = chip('quarantined');
    expect(screen.getByText('Delivery unknown')).toBeInTheDocument();
    unmount();
    chip(null, null);
    expect(screen.getByText('Delivery unknown')).toBeInTheDocument();
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
  });
});

describe('SelectField', () => {
  const options = [
    { value: 'all', label: 'All severities' },
    { value: 'high', label: 'high' },
  ];

  it('is named by its label and reports a choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectField label="Severity" value="all" options={options} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Severity'), 'high');
    expect(onChange).toHaveBeenCalledWith('high');
    expect(
      within(screen.getByLabelText('Severity'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All severities', 'high']);
  });

  it('shows the value it is given and has no accessibility violation', async () => {
    const { container } = render(
      <SelectField label="Severity" value="high" options={options} onChange={() => {}} />,
    );
    expect(screen.getByLabelText('Severity')).toHaveValue('high');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('CursorPager', () => {
  const props = {
    size: 25,
    sizes: [5, 25, 200],
    position: 'Showing 5 alerts · newest first',
    canNewer: true,
    canOlder: true,
    onSizeChange: vi.fn(),
    onNewer: vi.fn(),
    onOlder: vi.fn(),
  };

  it('is the navigation of the alert pages and says where the page is, politely', () => {
    render(<CursorPager {...props} note="The API pages with a cursor." />);
    const nav = screen.getByRole('navigation', { name: 'Alert pages' });
    expect(within(nav).getByRole('status')).toHaveTextContent('Showing 5 alerts · newest first');
    expect(within(nav).getByText('The API pages with a cursor.')).toBeVisible();
  });

  it('has Newer and Older and no page numbers', () => {
    render(<CursorPager {...props} />);
    expect(screen.getByRole('button', { name: 'Newer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Older' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Page / })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('reports a click on either end, and has no light at an end that is not there', async () => {
    const user = userEvent.setup();
    const onNewer = vi.fn();
    const onOlder = vi.fn();
    const { rerender } = render(<CursorPager {...props} onNewer={onNewer} onOlder={onOlder} />);
    await user.click(screen.getByRole('button', { name: 'Older' }));
    await user.click(screen.getByRole('button', { name: 'Newer' }));
    expect(onOlder).toHaveBeenCalledTimes(1);
    expect(onNewer).toHaveBeenCalledTimes(1);

    rerender(<CursorPager {...props} canNewer={false} canOlder={false} />);
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();
  });

  it('changes the page size', async () => {
    const user = userEvent.setup();
    const onSizeChange = vi.fn();
    render(<CursorPager {...props} onSizeChange={onSizeChange} />);
    await user.selectOptions(screen.getByLabelText('Alerts per page'), '200');
    expect(onSizeChange).toHaveBeenCalledWith(200);
    expect(
      within(screen.getByLabelText('Alerts per page'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['5', '25', '200']);
  });

  it('moves the keyboard to the other step when the one it was on stops being possible', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CursorPager {...props} />);
    await user.click(screen.getByRole('button', { name: 'Newer' }));
    expect(screen.getByRole('button', { name: 'Newer' })).toHaveFocus();

    rerender(<CursorPager {...props} canNewer={false} />);
    expect(screen.getByRole('button', { name: 'Older' })).toHaveFocus();
  });

  it('has no accessibility violation', async () => {
    const { container } = render(<CursorPager {...props} note="Note." />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Banner', () => {
  it('says its words in a polite live region, with an icon that is not the only signal', () => {
    const { container } = render(<Banner tone="warn">3 faults are active on 4 devices</Banner>);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('3 faults are active on 4 devices');
    expect(banner).toHaveAttribute('data-tone', 'warn');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has an informational tone as well', () => {
    render(<Banner tone="info">Gaps are confirmed later.</Banner>);
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'info');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <>
        <Banner tone="warn">Faults are on.</Banner>
        <Banner tone="info">Gaps are confirmed later.</Banner>
      </>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
