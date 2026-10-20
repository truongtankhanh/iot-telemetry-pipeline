import axe from 'axe-core';

/**
 * Accessibility violations of a rendered subtree, as readable lines (empty when there are none).
 * jsdom computes neither layout nor stylesheets, so the rules that need them are off here: colour
 * contrast is measured from the token file by `pnpm lint` (scripts/contrast.ts), and the page-level
 * `region` rule judges a fragment, not a page.
 */
export async function axeViolations(root: Element): Promise<string[]> {
  const result = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`,
  );
}
