import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { uiIcons } from '../../ui/icons';

/** Copies with the clipboard API where it exists, and with a hidden text area where it does not (a plain-HTTP address that is not localhost). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (permissions, an insecure origin): fall through to the older way.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export interface CopyButtonProps {
  /** What is copied. */
  text: string;
  /** What it is, for the button's name and the confirmation ("topic", "last payload"). */
  label: string;
  /** Visible words on the button ("Copy as JSON"). Without them it is an icon button named "Copy the <label>". */
  children?: ReactNode;
}

/**
 * An icon button that copies a text. What happened is said in a status message that a screen reader announces,
 * and, when nothing worked, it says to select the text and copy it by hand: a copy button that fails silently
 * is worse than none.
 */
export function CopyButton({ text, label, children }: CopyButtonProps) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(text);
    setMessage(
      ok ? `Copied the ${label}` : `Could not copy the ${label}: select it and copy it by hand`,
    );
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 3000);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={uiIcons.copy}
        // With words on the button they are its name; a different `aria-label` would contradict them.
        {...(children ? {} : { 'aria-label': `Copy the ${label}` })}
        onClick={() => void copy()}
      >
        {children}
      </Button>
      <span className="visually-hidden" role="status">
        {message}
      </span>
    </>
  );
}
