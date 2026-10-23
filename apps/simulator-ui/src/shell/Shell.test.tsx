import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell';

const parts = {
  header: <span>The header</span>,
  navigation: <nav aria-label="Pages">The pages</nav>,
  pinned: false,
};

describe('Shell', () => {
  it('draws the header, the navigation and the page, as every page has them', () => {
    const { container } = render(
      <Shell {...parts}>
        <p>The page</p>
      </Shell>,
    );
    expect(screen.getByText('The header')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('The page');
    expect(container.firstElementChild).not.toHaveAttribute('data-presenter');
    expect(container.firstElementChild).toHaveAttribute('data-pinned', 'false');
  });

  it('is the same with presenter set to false', () => {
    const plain = render(
      <Shell {...parts}>
        <p>The page</p>
      </Shell>,
    );
    const html = plain.container.innerHTML;
    plain.unmount();
    const off = render(
      <Shell {...parts} presenter={false}>
        <p>The page</p>
      </Shell>,
    );
    expect(off.container.innerHTML).toBe(html);
  });

  it('draws no navigation in presenter mode, and keeps the header, the skip link and the page', () => {
    const { container } = render(
      <Shell {...parts} presenter>
        <p>The page</p>
      </Shell>,
    );
    expect(container.firstElementChild).toHaveAttribute('data-presenter', 'true');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('The pages')).toBeNull();
    expect(screen.getByText('The header')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to the page' })).toHaveAttribute('href', '#main');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(main).toHaveTextContent('The page');
  });

  it('still shows a banner above the page in presenter mode (a lost link must stay visible)', () => {
    render(
      <Shell {...parts} presenter banner={<p role="alert">The link is lost</p>}>
        <p>The page</p>
      </Shell>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The link is lost');
  });
});
