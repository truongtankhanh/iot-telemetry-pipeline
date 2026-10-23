import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { DEMO_SCRIPTS } from '../../lib/demoScripts';
import { useDemoSession } from '../../state/demoSessionContext';
import { ReplaceDialog } from '../scenarios/ReplaceDialog';
import { PresenterView } from './PresenterView';
import { StartScreen } from './StartScreen';
import { useDemoDriver } from './useDemoDriver';
import { useDemoKeys } from './useDemoKeys';

/**
 * The guided demo (frame 08), at `/demo`. Two faces of one page: the start screen, and the presenter view while a demo is being
 * presented (the shell, which reads the same session, then drops the navigation and swaps in the presenter header). The script is the
 * one the address names (`?script=`), else the one being presented, else the first. The keys are listened to only while presenting.
 */
export function Demo() {
  const [params] = useSearchParams();
  const session = useDemoSession();
  const wanted = session.scriptId ?? params.get('script');
  const script = useMemo(
    () =>
      DEMO_SCRIPTS.find((entry) => entry.id === wanted) ??
      (DEMO_SCRIPTS[0] as (typeof DEMO_SCRIPTS)[number]),
    [wanted],
  );
  const driver = useDemoDriver(script);
  const { actions } = driver;
  const presenting = session.status === 'presenting';

  useDemoKeys(presenting, {
    next: actions.next,
    back: actions.back,
    exit: actions.exit,
    restart: () => void actions.restart(),
    togglePause: () => void actions.togglePause(),
    toggleNotes: actions.toggleNotes,
  });

  return (
    <>
      {presenting ? <PresenterView driver={driver} /> : <StartScreen driver={driver} />}
      {driver.pendingReplace === null ? null : (
        <ReplaceDialog
          pending={driver.pendingReplace}
          busy={driver.replaceBusy}
          onConfirm={() => void actions.confirmReplace()}
          onCancel={actions.cancelReplace}
        />
      )}
    </>
  );
}
