import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { startNotices } from '../../lib/demoWaiting';
import { scriptLine } from '../../lib/demoText';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { uiIcons } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import styles from './demo.module.css';
import type { DemoDriver } from './useDemoDriver';

export interface StartScreenProps {
  driver: DemoDriver;
}

/**
 * Before the demo and after `Esc` (frame 08's page, outside presenter mode): the script and its steps, what would stop it from
 * finishing (said now, not a minute into it), and the way in: "Start presenter", or "Resume at step N" when the presenter left with
 * `Esc` (which stopped nothing), and the same two ways in on the twin: "Present on the twin" starts (or resumes) and goes to `/twin`, where
 * the step is drawn beside the scene (SIM-21). The session is kept for the life of the window; a reload loses it, and this says so.
 */
export function StartScreen({ driver }: StartScreenProps) {
  const { script, session, text, live, actions } = driver;
  const navigate = useNavigate();
  const resume = useRef<HTMLButtonElement>(null);
  const paused = session.status === 'paused-for-exit';
  const finished = session.status === 'finished';
  const notices = startNotices({
    link: live.link,
    view: live.view,
    lastAlertSink: live.lastAlertSink,
  });
  const holds = session.holds;

  // Leaving with Esc puts the keyboard on the way back in. A page that was just opened leaves focus where the shell puts it.
  useEffect(() => {
    if (paused) resume.current?.focus();
  }, [paused]);

  return (
    <>
      <PageHeader
        title="Guided demo"
        description="A scripted walk-through in presenter mode: it starts the scenario, explains each stage and moves on when the pipeline does."
      />
      <Card title={script.title}>
        <p>{script.summary}</p>
        <ol className={styles.startSteps}>
          {script.steps.map((step) => (
            <li key={step.id}>
              {text(step.title)}
              <small>{text(step.summary)}</small>
            </li>
          ))}
        </ol>
        <p className={styles.hint}>{scriptLine(script, live.scenarioItem)}</p>

        {notices.length === 0 ? null : (
          <div className={styles.notices}>
            {notices.map((notice) => (
              <Banner key={notice.code} tone={notice.tone}>
                {notice.text}
              </Banner>
            ))}
          </div>
        )}

        {paused ? (
          <Banner tone="info">
            Left at step {session.stepIndex + 1} of {session.stepCount}. Leaving stopped nothing:
            what the demo started is still running.
          </Banner>
        ) : null}
        {finished ? (
          <Banner tone="info">The demo finished. What it started has run its course.</Banner>
        ) : null}
        {holds.length === 0 ? null : (
          <Banner tone="warn">
            The demo is holding {holds.map((hold) => `${hold.deviceId} ${hold.metric}`).join(', ')}.
            It is let go when the demo finishes, or with “Stop demo and release”.
          </Banner>
        )}
        {driver.releaseError === null ? null : (
          <p role="alert" className={styles.notice} data-tone="bad">
            A held value could not be released: {driver.releaseError}
          </p>
        )}

        <div className={styles.row}>
          {paused ? (
            <>
              <Button
                ref={resume}
                variant="primary"
                size="lg"
                icon={uiIcons.play}
                onClick={actions.resume}
              >
                Resume at step {session.stepIndex + 1}
              </Button>
              <Button variant="outline" onClick={actions.start}>
                Start again
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" icon={uiIcons.play} onClick={actions.start}>
              {finished ? 'Start again' : 'Start presenter'}
            </Button>
          )}
          {/* The same start (or resume) and then the twin: its page draws the current step beside the scene and moves its camera. */}
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              navigate('/twin');
              if (paused) actions.resume();
              else actions.start();
            }}
          >
            {paused ? 'Resume on the twin' : 'Present on the twin'}
          </Button>
          {session.status === 'idle' ? null : (
            <Button variant="ghost" onClick={() => void actions.stopDemo()}>
              Stop demo and release
            </Button>
          )}
        </div>
        <p className={styles.hint}>
          Where the demo is, is kept while this window stays open; a reload forgets it, and the
          scenario keeps playing.
        </p>
      </Card>
    </>
  );
}
