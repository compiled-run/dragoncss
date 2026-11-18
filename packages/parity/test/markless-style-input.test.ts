// A Markless component's style input (markless.native-style-input/0) to dragon.native-style-export/1
// (packages/parity/src/markless-style-input.ts): the input is the one @markless/mobile's nativeStyleInput writes for the
// attributes rung, its ids reach the export unchanged, and a class that follows a state switches the writes between assignments.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { NATIVE_STYLE_EXPORT_SCHEMA } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/attributes.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const edit = (f: (v: Record<string, any>) => void): string => {
  const v = JSON.parse(TEXT) as Record<string, any>;
  f(v);
  return JSON.stringify(v);
};

describe('markless.native-style-input/0 to dragon.native-style-export/1', () => {
  it('exports both targets with the input\'s ids and cells, one complete assignment per state value', () => {
    const { exported } = marklessStyleExport(TEXT, PATH);
    expect(exported.schema).toBe(NATIVE_STYLE_EXPORT_SCHEMA);
    expect(exported.component).toBe('App');
    expect(exported.fonts.map((f) => f.file)).toEqual(['vendor/fonts/Inter/Inter-Bold.ttf', 'vendor/fonts/Inter/Inter-Regular.ttf']);
    const ids = JSON.parse(TEXT).nodes.map((n: { id: string }) => n.id) as string[];
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t];
      if (x === undefined) throw new Error(`no ${t}`);
      expect(x.readiness.kind, t).toBe('analysis-only');
      expect(x.states).toEqual([{ key: 'state:liked', domain: [false, true] }]);
      expect(x.assignments.map((a) => a.values)).toEqual([{ 'state:liked': false }, { 'state:liked': true }]);
      expect(x.initial).toBe(0);
      expect(x.next).toEqual([[[0, 1]], [[0, 1]]]);
      for (const a of x.assignments) expect(a.nodes.map((n) => n.id)).toEqual(['html', 'body', ...ids]);
      // .like.on paints the Heart button #ef476f only while liked; the Clear button keeps #e9ecef in both.
      const bg = (a: number, id: string): unknown => x.assignments[a]?.nodes.find((n) => n.id === id)?.writes.find((w) => w['kind'] === 'background-color')?.['color'];
      expect([bg(0, 'h2'), bg(1, 'h2')]).toEqual([{ r: 233, g: 236, b: 239, alpha: 255 }, { r: 239, g: 71, b: 111, alpha: 255 }]);
      expect([bg(0, 'h3'), bg(1, 'h3')]).toEqual([{ r: 233, g: 236, b: 239, alpha: 255 }, { r: 233, g: 236, b: 239, alpha: 255 }]);
      // Its buttons are block buttons, whose scrollable overflow is their plain box's (overflow-controls), so the page's range is
      // decided: the page is shorter than the viewport.
      expect(x.assignments.map((a) => a.pageScroll), t).toEqual([{ minX: 0, maxX: 0, minY: 0, maxY: 0 }, { minX: 0, maxX: 0, minY: 0, maxY: 0 }]);
    }
    expect(exported.warnings.filter((w) => w.code === 'DRAGON_PAGE_SCROLL_UNDECIDED')).toEqual([]);
  });

  it('gives each assignment the canvas colour Chrome paints: html\'s background, else body\'s, else white', () => {
    const canvases = (css: string, t: 'ios' | 'android' = 'ios'): unknown[] => marklessStyleExport(edit((v) => { v['css'] += css; }), PATH).exported.targets[t]?.assignments.map((a) => a.canvas) ?? [];
    const white = { r: 255, g: 255, b: 255, alpha: 255 };
    const navy = { r: 18, g: 52, b: 86, alpha: 255 };
    expect(canvases('')).toEqual([white, white]);
    expect(canvases('\nbody { background: #123456; }')).toEqual([navy, navy]);
    expect(canvases('\nhtml { background-color: #123456; }', 'android')).toEqual([navy, navy]);
    const dark = marklessStyleExport(edit((v) => { v['css'] += '\nbody { background: #ffffff; }\n@media (prefers-color-scheme: dark) { body { background: #123456; } }'; }), PATH).exported.targets.ios;
    const bands = dark?.assignments.map((a) => a.values['@env#band']) ?? [];
    expect(new Set(bands)).toEqual(new Set([0, 1]));
    expect(dark?.assignments.map((a) => a.canvas)).toEqual(bands.map((b) => (b === 0 ? white : navy)));
    // A body background under html's, and a translucent canvas: packages/parity/test/markless-root-paint.test.ts, against Chrome's pixels.
    expect(canvases('\nhtml { background: #123456; }\nbody { background: #ffffff; }')).toEqual([navy, navy]);
  });

  it('refuses an input it cannot convert faithfully, naming why', () => {
    expect(() => parseMarklessStyleInput(edit((v) => { v['version'] = 'markless.native-style-input/9'; }))).toThrow('not markless.native-style-input/0');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][2]['arm'] = { branch: 'b0', arm: 'then' }; }))).toThrow('h1:text0: styles inside @if arms');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][3]['classByState'][0]['when'] = { 'state:other': false }; }))).toThrow('h2: classByState names state:other');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][1]['parent'] = 'h9'; }))).toThrow('h1: parent h9 is not an earlier element');
    expect(() => parseMarklessStyleInput(edit((v) => { v['states'][0]['domain'] = [0, 1]; }))).toThrow('a list of distinct strings');
    expect(() => marklessStyleExport(edit((v) => { v['nodes'][3]['classByState'].pop(); }), PATH)).toThrow('h2: classByState has 0 entries');
  });

  it('a CSS error is a refusal naming the declaration, not an export without it', () => {
    expect(() => marklessStyleExport(edit((v) => { v['css'] += '\n.like.mk-1x9vgkx { color: nonsense-colour; }'; }), PATH)).toThrow(/does not compile/);
  });

  it('a page whose range the engine does not decide has pageScroll null, the node it stopped at, and a warning', () => {
    const exported = marklessStyleExport(edit((v) => {
      v['nodes'].push({ kind: 'element', id: 'h9', element: 'input', parent: 'h0', attributes: { type: 'range' } });
      v['css'] += '\ninput { display: block; appearance: none; } input::-webkit-slider-thumb { appearance: none; }';
    }), PATH).exported;
    for (const t of ['ios', 'android'] as const) {
      const a = exported.targets[t]?.assignments[0];
      expect(a?.pageScroll, t).toBeNull();
      expect(a?.pageScrollUndecided?.nodeId, t).toBe('h9');
    }
    expect(exported.warnings.filter((w) => w.code === 'DRAGON_PAGE_SCROLL_UNDECIDED').length).toBe(2);
  });

  it('a box with overflow auto carries its scroll range, and the page its own, in device px per target', () => {
    const row = (id: string, parent: string) => ({ kind: 'element', id, element: 'p', parent, attributes: { class: 'row' } });
    const input = (extra: number): string => JSON.stringify({
      version: 'markless.native-style-input/0', component: 'Scroll', states: [],
      css: '.page { padding: 16px; } .box { height: 200px; overflow-y: auto; border: 1px solid #000; } .row { height: 60px; }',
      nodes: [
        { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
        { kind: 'element', id: 'h1', element: 'div', parent: 'h0', attributes: { class: 'box' } },
        ...['h2', 'h3', 'h4', 'h5'].map((id) => row(id, 'h1')),
        ...Array.from({ length: extra }, (_, k) => row(`x${k}`, 'h0')),
      ],
    });
    const short = marklessStyleExport(input(0), 'scroll.json').exported;
    const long = marklessStyleExport(input(20), 'scroll.json').exported;
    // Four 60px rows with 1em margins in a 200px box: 120 CSS px to scroll; the page is shorter than the viewport.
    for (const [t, dpr] of [['ios', 3], ['android', 2.625]] as const) {
      const a = short.targets[t]?.assignments[0];
      const box = a?.nodes.find((n) => n.id === 'h1');
      expect(box?.writes.filter((w) => w['kind'] === 'scroll-container'), t).toEqual([{ kind: 'scroll-container', key: 'dragonScroll.range', x: true, y: true }]);
      expect(box?.scrollRange, t).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 120 * dpr });
      expect(a?.nodes.filter((n) => n.scrollRange !== undefined).map((n) => n.id), t).toEqual(['h1']);
      expect(a?.pageScroll, t).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
    }
    // Twenty more rows below the box: nothing overflows the html box here, so the range is its height less the viewport's, within the
    // one device px the two edges' snapping can differ by at 2.625.
    for (const t of ['ios', 'android'] as const) {
      const x = long.targets[t];
      const html = x?.assignments[0]?.nodes.find((n) => n.id === 'html')?.frame;
      expect(html?.height, t).toBeGreaterThan((x?.viewport.height ?? 0) * (x?.dpr ?? 0));
      const page = x?.assignments[0]?.pageScroll;
      expect([page?.minX, page?.maxX, page?.minY], t).toEqual([0, 0, 0]);
      expect(Math.abs((page?.maxY ?? NaN) - ((html?.height ?? 0) - (x?.viewport.height ?? 0) * (x?.dpr ?? 0))), t).toBeLessThanOrEqual(1);
    }
  });
});
