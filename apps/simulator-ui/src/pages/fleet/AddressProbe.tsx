import { useLocation } from 'react-router';

/** Shows the address (path and query) as text, so a test can read what a page put in it. Used by the tests only. */
export function AddressProbe() {
  const { pathname, search } = useLocation();
  return <span data-testid="location">{pathname + search}</span>;
}
