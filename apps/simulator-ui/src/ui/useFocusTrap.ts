import { type RefObject, useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside an element: from its last control it goes to the first, and Shift Tab from the first goes to
 * the last. For a modal sheet or dialog, where the page behind is inert and focus must not fall out of it.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (control) =>
          !control.hasAttribute('hidden') && control.getAttribute('aria-hidden') !== 'true',
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      // Shift Tab from the first control, or from the container itself (focused when the sheet opens), goes to the last.
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === element)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [ref, active]);
}
