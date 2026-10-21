import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../lib/routes';
import { LabSwitcher } from './LabSwitcher';

const at = (path: string, routes = appRoutes()) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LabSwitcher routes={routes} />
    </MemoryRouter>,
  );

describe('LabSwitcher', () => {
  it('lists the Lab pages in the frame order, named Workspace, Scenarios, Timeline and Faults', () => {
    at('/lab/scenarios');
    const nav = screen.getByRole('navigation', { name: 'Simulation lab' });
    const links = nav.querySelectorAll('a');
    expect([...links].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Workspace', '/lab'],
      ['Scenarios', '/lab/scenarios'],
      ['Timeline', '/lab/timeline'],
      ['Faults', '/lab/faults'],
    ]);
  });

  it('marks the page you are on, and only that one', () => {
    at('/lab/scenarios');
    expect(screen.getByRole('link', { name: 'Scenarios' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['Workspace', 'Timeline', 'Faults']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('aria-current');
    }
  });

  it('marks the Workspace on the Lab itself, not on its sub-pages', () => {
    at('/lab');
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Scenarios' })).not.toHaveAttribute('aria-current');
  });

  it('keeps a page that is not built a link, to its placeholder', () => {
    at('/lab/scenarios');
    expect(screen.getByRole('link', { name: 'Faults' })).toHaveAttribute('href', '/lab/faults');
  });

  it('draws nothing when the app has no Lab', () => {
    const { container } = at(
      '/',
      appRoutes().filter((route) => route.path !== '/lab' && route.parent !== '/lab'),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
