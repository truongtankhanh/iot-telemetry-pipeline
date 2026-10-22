import type { ReactNode } from 'react';
import { anomaliesOf } from '../../lib/timelineEditor';
import { type ExpectedImpact, useExpectedImpact } from '../lab/useExpectedImpact';
import { type EditorCommands, useEditorCommands } from './useEditorCommands';
import { type ScenarioEditor, useScenarioEditor } from './useScenarioEditor';

/** What the page's hooks give a part of the page. */
export interface PartContext {
  editor: ScenarioEditor;
  commands: EditorCommands;
  impact: ExpectedImpact;
}

/**
 * One part of the editor page (the canvas, the inspector…) with the page's hooks behind it, so that a test can render that part
 * alone. Used by the tests only (`timelineTestSupport.tsx`); it is a component of its own so that the support file, which
 * exports functions, does not also define one.
 */
export function EditorPart({ part }: { part: (context: PartContext) => ReactNode }) {
  const editor = useScenarioEditor();
  const commands = useEditorCommands(editor);
  const impact = useExpectedImpact(anomaliesOf(editor.doc));
  return <>{part({ editor, commands, impact })}</>;
}
