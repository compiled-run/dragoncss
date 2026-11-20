// What a modal <dialog> needs from the engine, measured against live Chrome: an absolutely positioned box sized by min-content,
// max-content or fit-content in either axis (Chrome's modal dialog is width and height fit-content, centred by auto margins between
// zero insets), and block buttons inside a scroll container (a modal dialog's overflow is forced to auto, and dialogs hold buttons).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import { scrollMetricsWithFaults } from '../../layout/src/overflow.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from 'dragon';
import { launchOverlayChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import type { ScrollRecord } from '../src/scroll-metrics.ts';
import { captureScrollMetrics, elementRecord, SCROLL_DPRS, scrollProblems, viewportDirectionOf, viewportRecord } from '../src/scroll-metrics.ts';

type Node = { kind: 'element'; id: string; element: string; parent: string | null; attributes: Record<string, string> } | { kind: 'text'; id: string; parent: string; text: string };
const el = (id: string, element: string, parent: string | null, cls?: string): Node => ({ kind: 'element', id, element, parent, attributes: cls === undefined ? {} : { class: cls } });
const text = (parent: string, t: string): Node => ({ kind: 'text', id: `${parent}:text0`, parent, text: t });
const input = (css: string, nodes: Node[]): string => JSON.stringify({ version: 'markless.native-style-input/0', component: 'App', states: [], css, nodes });

describe('min-content, max-content and fit-content on an absolutely positioned box', () => {
  const css = [
    '.f { position: fixed; inset: 0; margin: auto; border: 3px solid #000; padding: 1em; background: #fff; }',
    '.fit { width: fit-content; height: fit-content; max-width: calc(100% - 6px - 2em); max-height: calc(100% - 6px - 2em); }',
    '.minw { width: min-content; height: max-content; top: 40px; bottom: auto; }',
    '.maxw { width: max-content; height: min-content; left: 10px; right: auto; }',
    '.a { position: absolute; top: 0; left: 0; right: 0; width: fit-content; height: fit-content; margin: 0 auto; }',
    '.tall { height: 2000px; }',
  ].join('\n');
  const cases: [string, Node[]][] = [
    ['a centred fit-content box between zero insets', [el('h0', 'main', null), el('h1', 'div', 'h0', 'f fit'), el('h2', 'p', 'h1'), text('h2', 'Delete this draft and every note in it?')]],
    ['fit-content clamped by a max-height that follows the viewport', [el('h0', 'main', null), el('h1', 'div', 'h0', 'f fit'), el('h2', 'div', 'h1', 'tall')]],
    ['min-content width and max-content height', [el('h0', 'main', null), el('h1', 'div', 'h0', 'f minw'), text('h1', 'Two words')]],
    ['max-content width and min-content height', [el('h0', 'main', null), el('h1', 'div', 'h0', 'f maxw'), text('h1', 'A longer line that stays on one line')]],
    ['fit-content in an absolute containing block', [el('h0', 'main', null), el('h1', 'div', 'h0', 'a'), text('h1', 'Centred')]],
  ];
  for (const [name, nodes] of cases) {
    it(`${name}: every box where Chrome puts it, within 1 device px`, async () => {
      const text = input(css, nodes);
      const { exported } = marklessStyleExport(text, `top-layer-layout/${name}`);
      const report = await compareMarklessExport(parseMarklessStyleInput(text), exported);
      expect(report.compared).toBeGreaterThan(0);
      expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    });
  }

  it('refuses a height keyword on a box that is not absolutely positioned, naming it', () => {
    expect(() => marklessStyleExport(input('.b { height: fit-content; }', [el('h0', 'div', null, 'b')]), 'refusal')).toThrow(/height: fit-content on .*which is not absolutely positioned, is not laid out/);
  });
});

describe('block buttons in a scroll container', () => {
  const html = `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; font-family: Ahem; font-size: 10px; }
.s { overflow: auto; width: 120px; height: 50px; border: 2px solid #000; padding: 4px; }
button { display: block; font-family: inherit; font-size: inherit; padding: 3px 6px; border: 1px solid #000; background: #eee; margin: 0 0 6px; }
.wide { width: 40px; }
.far { margin-left: 100px; }
</style>
</head>
<body data-dragon-id="body">
<div data-dragon-id="s1" class="s"><button data-dragon-id="b1">Keep</button><button data-dragon-id="b2">Delete</button><button data-dragon-id="b3">Cancel</button></div>
<div data-dragon-id="s2" class="s"><div data-dragon-id="w"><button data-dragon-id="b4" class="far">Far</button></div></div>
<div data-dragon-id="s3" class="s"><button data-dragon-id="b5" class="wide">XXXXXXXXXX</button></div>
</body>
</html>
`;
  const compiled = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport }).compile(fixtureToInput('top-layer-buttons', html));
  const engine = (dpr: number): readonly ScrollRecord[] => {
    const projection = iosLayoutProjection(compiled, { ...ENVIRONMENT, devicePixelRatio: dpr }, []);
    if (projection.kind === 'blocked') throw new Error(projection.reason);
    const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
    if (!validated.ok) throw new Error(JSON.stringify(validated.errors));
    const m = measurerFor(REFERENCE_PLATFORM);
    if (m.kind !== 'ok') throw new Error(m.detail);
    const r = scrollMetricsWithFaults(validated.input, m.measurer, viewportDirectionOf(validated.input), NO_ENGINE_FAULTS);
    if (r.kind === 'refused') throw new Error(`${r.nodeId}: ${r.detail}`);
    return [viewportRecord(r.viewport, dpr), ...r.containers.map((x) => elementRecord(x, dpr))];
  };

  it('compiles: a block button no longer makes every scroll container undecided', () => {
    expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
  });

  for (const dpr of SCROLL_DPRS) {
    describe(`at DPR ${dpr}`, () => {
      let browser: Browser;
      beforeAll(async () => {
        browser = await launchOverlayChrome(dpr);
      }, 120_000);
      afterAll(async () => {
        await browser?.close();
      });
      it('scrollWidth, scrollHeight, clientWidth and clientHeight equal Chrome on every container', async () => {
        const chrome = await captureScrollMetrics(browser, 'top-layer-buttons', html, { ...ENVIRONMENT, devicePixelRatio: dpr });
        expect(chrome.records.map((r) => r.id)).toEqual(['viewport', 's1', 's2', 's3']);
        expect(chrome.records.some((r) => r.id !== 'viewport' && (r.scrollHeight > r.clientHeight || r.scrollWidth > r.clientWidth))).toBe(true);
        expect(scrollProblems(engine(dpr), chrome.records)).toEqual([]);
      });
    });
  }
});
