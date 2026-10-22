import { describe, expect, it, vi } from 'vitest';
import scenariosFixture from '../api/fixtures/scenarios.json';
import type { ScenarioLibraryView } from '../api/types';
import type { DownloadHost } from './eventExport';
import {
  documentOfItem,
  downloadScenario,
  SCENARIO_MIME,
  scenarioFileName,
  scenarioJson,
} from './timelineExport';

const document = {
  name: 'bad-afternoon',
  description: 'A hot afternoon.',
  anomalies: [
    {
      deviceId: 'dc-env-01',
      metric: 'temperature_c' as const,
      value: 29.2,
      startAt: 45,
      duration: 60,
      shape: 'ramp' as const,
    },
  ],
};

describe('scenarioJson', () => {
  it('is two-space JSON with a final newline, as the simulator writes a scenario file', () => {
    const text = scenarioJson(document);
    expect(text.endsWith('}\n')).toBe(true);
    expect(
      text.startsWith('{\n  "name": "bad-afternoon",\n  "description": "A hot afternoon.",'),
    ).toBe(true);
    expect(JSON.parse(text)).toEqual(document);
  });

  it('keeps the file’s key order', () => {
    expect(Object.keys(JSON.parse(scenarioJson(document)) as object)).toEqual([
      'name',
      'description',
      'anomalies',
    ]);
  });
});

describe('scenarioFileName', () => {
  it('is the name of a saved scenario with .json', () => {
    expect(scenarioFileName('bad-afternoon')).toBe('bad-afternoon.json');
  });

  it('cuts a name that is still being typed down to what a file name can hold', () => {
    expect(scenarioFileName('Bad Afternoon!')).toBe('bad-afternoon.json');
    expect(scenarioFileName('../etc/passwd')).toBe('etc-passwd.json');
    expect(scenarioFileName('')).toBe('scenario.json');
    expect(scenarioFileName('!!!')).toBe('scenario.json');
    expect(scenarioFileName('a'.repeat(80))).toBe(`${'a'.repeat(64)}.json`);
  });
});

describe('downloadScenario', () => {
  it('hands the file to the browser through the host it is given, and lets the URL go', () => {
    const link = { href: '', download: '', click: vi.fn() };
    const host: DownloadHost = {
      createObjectURL: vi.fn(() => 'blob:scenario'),
      revokeObjectURL: vi.fn(),
      createLink: () => link,
    };
    downloadScenario(document, host);
    expect(link.href).toBe('blob:scenario');
    expect(link.download).toBe('bad-afternoon.json');
    expect(link.click).toHaveBeenCalledOnce();
    expect(host.revokeObjectURL).toHaveBeenCalledWith('blob:scenario');
    const blob = vi.mocked(host.createObjectURL).mock.calls[0]![0];
    expect(blob.type).toBe(SCENARIO_MIME);
    expect(blob.size).toBe(new Blob([scenarioJson(document)]).size);
  });
});

describe('documentOfItem', () => {
  it('keeps the three fields of the file and none of the card’s', () => {
    const item = (scenariosFixture as unknown as ScenarioLibraryView).scenarios[0]!;
    const written = documentOfItem(item);
    expect(Object.keys(written)).toEqual(['name', 'description', 'anomalies']);
    expect(written.name).toBe(item.name);
    expect(written.anomalies).toHaveLength(item.anomalies.length);
  });
});
