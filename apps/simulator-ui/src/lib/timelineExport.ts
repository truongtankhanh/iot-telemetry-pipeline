import type { ScenarioItem } from '../api/types';
import { browserDownload, type DownloadHost, downloadText } from './eventExport';
import { fromScenario, type ScenarioDocument, toDocument } from './timelineEditor';

/**
 * The export of a scenario: the document as a JSON file, made in the browser from what the page already holds. The text is
 * the same bytes the simulator writes to its scenarios folder (two-space JSON, the file's key order, a final newline), so an
 * exported file can be dropped into that folder or imported on the Scenarios page as it is. Nothing is asked of the simulator.
 */

export const SCENARIO_MIME = 'application/json;charset=utf-8';

/** The text of a scenario file. */
export const scenarioJson = (document: ScenarioDocument): string =>
  `${JSON.stringify(document, null, 2)}\n`;

/**
 * `bad-afternoon.json`. A saved scenario's name is already a file name; a name still being typed may not be (capitals,
 * spaces, nothing at all), so it is cut down to what a file name can safely hold, and `scenario` stands in for none.
 */
export function scenarioFileName(name: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${safe === '' ? 'scenario' : safe}.json`;
}

/** Hands the document to the person as a file. */
export function downloadScenario(
  document: ScenarioDocument,
  host: DownloadHost = browserDownload,
): void {
  downloadText(scenarioFileName(document.name), scenarioJson(document), SCENARIO_MIME, host);
}

/** The document of a scenario of the library (its card carries more than the file does). */
export const documentOfItem = (
  item: Pick<ScenarioItem, 'name' | 'description' | 'anomalies'>,
): ScenarioDocument => toDocument(fromScenario(item));
