import { Link } from 'react-router';
import { lockReason } from '../lib/benchmarkLock';
import { useBenchmarkStatus } from '../state/benchmarkContext';
import { Banner } from '../ui/Banner';
import styles from './benchmarkBanner.module.css';

export interface BenchmarkBannerProps {
  /** The Analytics page says the same, with the controls of the run beside it; a second banner above it would only repeat. */
  onAnalytics: boolean;
}

/**
 * Above every page while a benchmark runs: the reason the controls that publish are locked, and the way to the page that
 * follows the run and stops it. A benchmark uses most of the machine's CPU and writes to the live database, so it is not
 * something to forget on another page; the header's pill says the same in a few words. Nothing is drawn when no run goes.
 */
export function BenchmarkBanner({ onAnalytics }: BenchmarkBannerProps) {
  const status = useBenchmarkStatus();
  if (status === null || onAnalytics) return null;
  return (
    <Banner tone="warn">
      {lockReason(status)}{' '}
      <Link className={styles.link} to="/analytics">
        Follow it or stop it on Analytics
      </Link>
    </Banner>
  );
}
