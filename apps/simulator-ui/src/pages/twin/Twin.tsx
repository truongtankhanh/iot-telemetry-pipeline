import { lazy, Suspense, useCallback, useState } from 'react';
import { Link } from 'react-router';
import type { TwinLayout } from '../../api/types';
import { placementSummary } from '../../lib/twinStatus';
import { webgl2Available } from '../../lib/webgl';
import type { TwinSceneProps } from '../../twin/TwinScene';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { PageHeader } from '../../ui/PageHeader';
import pagesStyles from '../pages.module.css';
import styles from './twin.module.css';
import { useTwinLayout } from './useTwinLayout';

/** Why the scene is not drawn, in a sentence that says what Studio shows instead (frame 16). */
function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <>
      <Banner tone="warn">
        <b>{title}</b> {message}
      </Banner>
      <p>
        <Link className={pagesStyles.link} to="/topology">
          Open topology
        </Link>
      </p>
    </>
  );
}

/** What a scene whose code did not load is replaced by: the same fallback, so a stale or missing chunk is not a blank page. */
function SceneNotLoaded(_props: TwinSceneProps) {
  return (
    <Unavailable
      title="The 3D code could not be loaded."
      message="Reload the page to try again; until then Studio shows the topology, where every value is the same."
    />
  );
}

// The scene is its own chunk: it brings three.js and React Three Fiber, which no other page needs. It is requested only
// when this page has checked that the device can draw it and that there is a layout to draw, so a device without WebGL 2
// never downloads it. A chunk that fails to load becomes the fallback above.
const TwinScene = lazy(() =>
  import('../../twin/TwinScene').then(
    (module) => ({ default: module.TwinScene }),
    () => ({ default: SceneNotLoaded }),
  ),
);

/** Where the copy of the command center's campus came from, so the picture never looks more certain than its data. */
function sourceLine(layout: TwinLayout): string {
  const { repository, commit, checkedOn } = layout.source;
  return `Zones, boundary and catalogue are a copy of ${repository} at ${commit.slice(0, 7)}, compared on ${checkedOn}; this repository does not check them. Device positions are placed by hand.`;
}

/** The page once the device can draw it: reads the layout, and draws the scene or says why not. */
function TwinStage() {
  const layout = useTwinLayout();
  const [lost, setLost] = useState(false);
  const onContextLost = useCallback(() => setLost(true), []);

  if (layout.status === 'loading') return <p role="status">Reading the campus layout…</p>;
  if (layout.status === 'error') {
    return (
      <>
        <Unavailable title="The twin layout could not be read." message={layout.error ?? ''} />
        <div className={styles.actions}>
          <Button onClick={layout.retry}>Try again</Button>
        </div>
      </>
    );
  }

  const view = layout.view;
  if (view === null || !view.available || view.layout === null) {
    return (
      <Unavailable
        title="The twin layout is not available."
        message={`${view?.reason ?? 'The simulator sent none.'} Studio shows the topology instead; every value is the same.`}
      />
    );
  }
  if (lost) {
    return (
      <Unavailable
        title="The 3D view lost its graphics context."
        message="It did not come back within 5 seconds, so Studio shows the topology instead. Every value is the same."
      />
    );
  }

  const summary = placementSummary(view);
  return (
    <Card title="Campus">
      <div className={styles.stage}>
        <Suspense
          fallback={
            <p role="status" className={styles.loading}>
              Loading the 3D view…
            </p>
          }
        >
          <TwinScene layout={view.layout} onContextLost={onContextLost} className={styles.scene} />
        </Suspense>
      </div>
      <p className={styles.status}>{summary.headline}</p>
      <p className={styles.source}>{sourceLine(view.layout)}</p>
      {summary.notes.length > 0 ? (
        <Banner tone="warn">
          <span>Not drawn: the layout has no position for these devices.</span>
          <ul className={styles.notes}>
            {summary.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
    </Card>
  );
}

/**
 * The digital twin (frames 14 and 16), as a spike (SIM-17): the campus boundary and its buildings in 3D, to measure what
 * the real scene will cost. The device is asked first whether it can create a WebGL 2 context; if not, nothing is
 * requested and the page says so and links to the Topology, which shows every value. Otherwise the layout is read from the
 * simulator and the scene is loaded as a chunk of its own. It reads nothing from the store: the scene has no live data yet.
 */
export function Twin() {
  // Asked once per visit: it creates, and at once releases, a throwaway context.
  const [canDraw] = useState(() => webgl2Available());
  return (
    <>
      <PageHeader title="Digital twin" description="The simulated campus in 3D.">
        <Chip tone="warn">Spike</Chip>
      </PageHeader>
      {canDraw ? (
        <TwinStage />
      ) : (
        <Unavailable
          title="3D view isn't available on this device."
          message="WebGL 2 is off, so Studio shows the topology instead. Every value is the same."
        />
      )}
    </>
  );
}
