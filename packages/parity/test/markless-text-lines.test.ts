// A text node's lines in the export are the glyphs Dragon shaped for the whole run, so a host draws them instead of reshaping.
import { describe, expect, it } from 'vitest';
import { GLYPH_STRIDE, platformFontSize, REFERENCE_LANGUAGE } from '@dragon/layout';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import type { ExportNode } from '../src/native-style-export.ts';
import { hostShaper } from '../src/text-shaper-host.ts';

const input = (width: string): string =>
  JSON.stringify({
    version: 'markless.native-style-input/0',
    component: 'Shelf',
    nodes: [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'shelf' } },
      { kind: 'element', id: 'h1', element: 'span', parent: 'h0', attributes: { class: 'tag' } },
      { kind: 'text', id: 'h1:text0', parent: 'h1', text: 'Basil, in stock' },
      { kind: 'element', id: 'h2', element: 'span', parent: 'h0', attributes: { class: 'tag' } },
      { kind: 'text', id: 'h2:text0', parent: 'h2', text: 'Thyme, low' },
      { kind: 'element', id: 'h3', element: 'p', parent: 'h0', attributes: { class: 'narrow' } },
      { kind: 'text', id: 'h3:text0', parent: 'h3', text: 'Basil and thyme grow on the sunny shelf by the window' },
    ],
    css: `body { margin: 0; font-family: sans-serif; }
.shelf { padding: 24px; }
.tag { display: block; margin-top: 12px; padding: 6px 10px; font-size: 15px; font-weight: 700; }
.narrow { width: ${width}; font-size: 15px; }`,
    states: [],
  });

const nodesOf = (text: string): readonly ExportNode[] => marklessStyleExport(text, 'shelf.native-style-input.json').exported.targets.android!.assignments[0]!.nodes;

describe('a text node carries its lines as Dragon shaped them', () => {
  const nodes = nodesOf(input('120px'));
  const node = (id: string): ExportNode => nodes.find((n) => n.id === id) as ExportNode;

  for (const [id, text, width] of [['h1:text0', 'Basil, in stock', 264.32], ['h2:text0', 'Thyme, low', 222.23]] as const) {
    it(`${text}: one line, the whole run as HarfBuzz shapes it, as wide as its frame`, () => {
      const n = node(id);
      // The engine's frame is in LayoutUnits (1/64 px) of the run's float advance.
      expect(Math.abs(n.frame!.width - width)).toBeLessThan(1 / 32);
      expect(n.lines).toHaveLength(1);
      const runs = n.lines![0]!.runs;
      expect(runs).toHaveLength(1);
      const run = runs[0]!;
      expect(run.face).toMatch(/^sha256:/);
      expect(run.size).toBe(platformFontSize(15 * 2.625));
      const g = hostShaper.shape(run.face, run.size, text, 0, text.length, 'Latn', false, REFERENCE_LANGUAGE, []);
      const ids: number[] = [];
      const xs: number[] = [];
      let pen = 0;
      for (let o = 0; o < g.length; o += GLYPH_STRIDE) {
        ids.push(g[o] as number);
        xs.push(pen / 65536);
        pen += g[o + 2] as number;
      }
      expect(run.glyphs).toEqual(ids);
      expect(run.xs).toEqual(xs);
      expect(Math.abs(pen / 65536 - n.frame!.width)).toBeLessThan(1 / 64);
      expect(n.lines![0]!.baseline).toBeGreaterThan(n.lines![0]!.top);
    });
  }

  it('a wrapped text node has one entry per engine line, each starting at the frame left', () => {
    const n = node('h3:text0');
    const lines = n.lines!;
    expect(lines.length).toBeGreaterThan(2);
    for (const [k, l] of lines.entries()) {
      expect(l.runs[0]!.xs[0]).toBeCloseTo(0, 6);
      if (k > 0) expect(l.top).toBeGreaterThan(lines[k - 1]!.top);
    }
    expect(lines.flatMap((l) => l.runs.flatMap((r) => r.glyphs)).length).toBeLessThanOrEqual('Basil and thyme grow on the sunny shelf by the window'.length);
    expect(lines[lines.length - 1]!.baseline).toBeLessThan(n.frame!.height);
  });

  it('an element has no lines', () => {
    expect(node('h1').lines).toBeUndefined();
  });
});
