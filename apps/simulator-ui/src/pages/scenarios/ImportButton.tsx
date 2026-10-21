import { useRef } from 'react';
import { Button } from '../../ui/Button';

export interface ImportButtonProps {
  /** An import is on its way: the button cannot be pressed again. */
  importing: boolean;
  /** Called with the file the person chose; reading and checking it is the caller's. */
  onFile: (file: File) => void;
}

/**
 * "Import JSON": a button that opens the browser's file picker, behind which sits a file input that is never shown.
 * It hands the chosen file on and forgets it (the input is cleared, so the same file can be chosen again after a
 * refusal). It checks nothing about the file: what is wrong with a scenario is for the simulator to say.
 */
export function ImportButton({ importing, onFile }: ImportButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="outline"
        disabled={importing}
        aria-busy={importing || undefined}
        onClick={() => input.current?.click()}
      >
        Import JSON
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Scenario file (JSON)"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}
