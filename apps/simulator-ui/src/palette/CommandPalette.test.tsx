import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';

import { appRoutes } from '../lib/routes';
import { createStudioStore } from '../state/store';
import { StudioProvider } from '../state/StudioProvider';
import { axeViolations } from '../test-axe';
import { CommandPalette } from './CommandPalette';

const routes = appRoutes({ foundations: true });

function Where() {
  const { pathname, search } = useLocation();
  return <span data-testid="location">{pathname + search}</span>;
}

function renderPalette() {
  const store = createStudioStore();
  store.getState().setView(structuredClone(fixture), 0);
  const result = render(
    <StudioProvider store={store}>
      <MemoryRouter>
        <button type="button">opener</button>
        <Where />
        <CommandPalette routes={routes} />
      </MemoryRouter>
    </StudioProvider>,
  );
  const open = () => {
    screen.getByRole('button', { name: 'opener' }).focus();
    act(() => store.getState().setPaletteOpen(true));
  };
  return { store, open, ...result };
}

const options = () => screen.getAllByRole('option').map((option) => option.textContent ?? '');
const where = () => screen.getByTestId('location').textContent;

describe('CommandPalette', () => {
  it('is not in the page while it is closed, and focuses its field when it opens', () => {
    const { open } = renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    expect(screen.getByRole('dialog', { name: 'Search and go to' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('finds the devices of a zone by typing "dc"', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('dc');
    const list = options().join(' | ');
    expect(list).toContain('dc-env-01');
    expect(list).toContain('dc-env-02');
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-activedescendant',
      screen.getAllByRole('option')[0]?.id,
    );
  });

  it('restricts the results to a group with a prefix, five at a time, and "Show all" lists the rest', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('d:');
    expect(screen.queryByRole('group', { name: 'Pages' })).not.toBeInTheDocument();
    expect(options().join(' | ')).not.toContain('hub-power-01');
    await userEvent.click(screen.getByText(/Show all/));
    expect(options().join(' | ')).toContain('hub-power-01');
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument();
  });

  it('goes to the active result on Enter and closes', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('fleet{Enter}');
    expect(where()).toBe('/fleet');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes with the device in the address when the result is a device', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('d:dc-env-01{Enter}');
    expect(where()).toBe('/fleet?device=dc-env-01');
  });

  it('keeps the palette open on ⌘ Enter, with the field still focused', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('fleet{Meta>}{Enter}{/Meta}');
    expect(where()).toBe('/fleet');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('moves with the arrows, wrapping at both ends', async () => {
    const { open } = renderPalette();
    open();
    const count = screen.getAllByRole('option').length;
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[count - 1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('does nothing when an action is chosen, and says where it is available', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('>');
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Enter}');
    expect(where()).toBe('/');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('zzzzqq');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 results');
  });

  it('closes on Esc and returns focus to where it was', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'opener' })).toHaveFocus();
  });

  it('closes on a click outside, and starts empty the next time', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.keyboard('dc');
    await userEvent.click(document.querySelector('[role="dialog"]')!.parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('keeps Tab inside the dialog', async () => {
    const { open } = renderPalette();
    open();
    await userEvent.tab();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('has no accessibility violations', async () => {
    const { open } = renderPalette();
    open();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
