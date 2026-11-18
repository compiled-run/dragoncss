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
    }
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
    expect(() => canvases('\nhtml { background: #123456; }\nbody { background: #ffffff; }')).toThrow('body has its own background under html\'s');
    expect(() => canvases('\nbody { background: rgba(0, 0, 0, 0.5); }')).toThrow('the canvas background is translucent');
  });

  it('refuses an input it cannot convert faithfully, naming why', () => {
    expect(() => parseMarklessStyleInput(edit((v) => { v['version'] = 'markless.native-style-input/9'; }))).toThrow('not markless.native-style-input/0');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][2]['arm'] = { branch: 'b0', arm: 'then' }; }))).toThrow('h1:text0: styles inside @if arms');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][3]['classByState'][0]['when'] = { 'state:other': false }; }))).toThrow('h2: classByState names state:other');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][1]['parent'] = 'h9'; }))).toThrow('h1: parent h9 is not an earlier element');
    expect(() => parseMarklessStyleInput(edit((v) => { v['states'][0]['domain'] = [0, 1]; }))).toThrow('only boolean states');
    expect(() => marklessStyleExport(edit((v) => { v['nodes'][3]['classByState'].pop(); }), PATH)).toThrow('h2: classByState has 0 entries');
  });

  it('a CSS error is a refusal naming the declaration, not an export without it', () => {
    expect(() => marklessStyleExport(edit((v) => { v['css'] += '\n.like.mk-1x9vgkx { color: nonsense-colour; }'; }), PATH)).toThrow(/does not compile/);
  });
});
