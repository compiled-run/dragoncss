// A Markless page holding @markless/ui's base.visuallyhidden, whose look is its inline style attribute (css-style-attr): the input
// is the one @markless/mobile writes for the u18 rung. The span's writes clip it to nothing and keep its text exposed; every frame
// is compared with Chrome.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/visually-hidden.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const hidden = input.nodes.find((n) => n.kind === 'element' && n.attributes['style'] !== undefined)!.id;

describe('a Markless style attribute: base.visuallyhidden', () => {
  const { exported } = marklessStyleExport(TEXT, PATH);

  it('clips the span to nothing, inside its own padding box, and keeps its text exposed', () => {
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      const span = x.assignments[0]!.nodes.find((n) => n.id === hidden)!;
      const kinds = span.writes.map((w) => w['kind']);
      expect(kinds).toEqual(expect.arrayContaining(['padding-box-clip', 'clip-path-inset', 'clip-text']));
      expect(span.writes.find((w) => w['kind'] === 'clip-path-inset')?.['edges']).toEqual(Array(4).fill({ value: 50, unit: '%' }));
      expect(span.writes.find((w) => w['kind'] === 'clip-text')?.['texts']).toEqual(['Read by the screen reader only']);
      expect(span.frame?.width).toBe(x.dpr);
      expect(span.frame?.height).toBe(x.dpr);
    }
  });

  it('places every box where Chrome does, within 1 device px', async () => {
    const report = await compareMarklessExport(input, exported);
    expect(report.compared).toBeGreaterThan(20);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    expect(report.rows.some((r) => r.id === hidden)).toBe(true);
  });
});
