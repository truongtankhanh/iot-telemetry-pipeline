/** The id of a tab, so a panel can name the tab that shows it (`aria-labelledby`). Apart from `Tabs.tsx` so that file exports only a component. */
export const tabId = (idPrefix: string, id: string) => `${idPrefix}-tab-${id}`;
