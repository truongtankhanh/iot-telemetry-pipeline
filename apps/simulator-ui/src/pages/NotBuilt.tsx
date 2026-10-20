import { Link } from 'react-router';
import type { AppRoute } from '../lib/routes';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { PageHeader } from '../ui/PageHeader';
import styles from './pages.module.css';

/**
 * The page of a route whose ticket has not landed. It says which ticket builds it and which frames it
 * follows, so a link in the navigation or a search result is never a dead end, and the order of the plan
 * is visible from the demo itself.
 */
export function NotBuilt({ route }: { route: AppRoute }) {
  const frames = route.frames.join(', ');
  return (
    <>
      <PageHeader title={route.label} description={route.description}>
        <Chip tone="warn">Not built yet</Chip>
      </PageHeader>
      <Card title={`Coming with ${route.ticket}`}>
        <p>
          This page is built by <b>{route.ticket}</b>, from{' '}
          {route.frames.length === 1 ? 'frame' : 'frames'} {frames} of the design. The shell around
          it, the search and the status of the pipeline already work.
        </p>
        <p>
          <Link className={styles.link} to="/">
            Back to the Overview
          </Link>
        </p>
      </Card>
    </>
  );
}
