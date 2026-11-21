// Dashed and dotted borders in the Markless export: each box with a visible dashed or dotted side carries the drawing operations
// Dragon's native paint runs (paint-dash.ts), and every device pixel of its border band those operations cover wholly or not at
// all equals Chrome's pixel exactly, at both proof devices. The input is the one @markless/mobile writes for the u17 rung.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crispSide } from '../src/border-crisp.ts';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { pixelAt } from '../src/native-compare.ts';
import type { ExportNode } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';
import { decodePng } from '../src/pixel-reference.ts';

const PATH = 'examples/markless-styles/input/borders-dashed.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const edit = (f: (v: Record<string, any>) => void): string => {
  const v = JSON.parse(TEXT) as Record<string, any>;
  f(v);
  return JSON.stringify(v);
};
type Rgba = { r: number; g: number; b: number; alpha: number };

describe('dashed and dotted borders in a Markless export', () => {
  const input = parseMarklessStyleInput(TEXT);
  const { exported } = marklessStyleExport(TEXT, PATH);

  it('gives every box with a dashed or dotted side its border operations, and no other box', () => {
    for (const t of ['ios', 'android'] as const) {
      const nodes = exported.targets[t]!.assignments[0]!.nodes;
      const styled = nodes.filter((n) => (n.writes.find((w) => w['kind'] === 'border-styles')?.['styles'] as string[] | undefined)?.some((s) => s === 'dashed' || s === 'dotted'));
      expect(styled.length).toBe(3);
      expect(nodes.filter((n) => n.borderOps !== undefined).map((n) => n.id)).toEqual(styled.map((n) => n.id));
      for (const n of styled) expect(n.borderOps!.ops.some((o) => o.op === 'fill' || o.op === 'dot')).toBe(true);
    }
  });

  it('paints every crisp border pixel as Chrome does, on both proof devices', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dragon-dashed-'));
    try {
      const report = await compareMarklessExport(input, exported, dir);
      expect(report.rows.filter((r) => !r.pass)).toEqual([]);
      for (const t of ['ios', 'android'] as const) {
        const img = decodePng(readFileSync(join(dir, `${t}-0.png`)));
        const nodes = exported.targets[t]!.assignments[0]!.nodes;
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const abs = (n: ExportNode): { x: number; y: number } => {
          const p = n.parent === null ? { x: 0, y: 0 } : abs(byId.get(n.parent)!);
          return { x: p.x + n.frame!.x, y: p.y + n.frame!.y };
        };
        let crisp = 0;
        const wrong: string[] = [];
        for (const n of nodes) {
          if (n.borderOps === undefined) continue;
          const a = abs(n);
          const left = Math.round(a.x + n.borderOps.origin.x);
          const top = Math.round(a.y + n.borderOps.origin.y);
          const colors = n.writes.find((w) => w['kind'] === 'border-colors')!['colors'] as Rgba[];
          const { width: w, height: h } = n.borderOps.size;
          const [wt, wr, wb, wl] = n.borderOps.widths as [number, number, number, number];
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            // Only the border band: a pixel there no operation reaches is the white canvas (none of these boxes has a background).
            if (x >= wl && x < w - wr && y >= wt && y < h - wb) continue;
            const side = crispSide(n.borderOps.ops, x, y);
            if (side === null) continue;
            const want = side < 0 ? [255, 255, 255, 255] : [colors[side]!.r, colors[side]!.g, colors[side]!.b, colors[side]!.alpha];
            const got = pixelAt(img, left + x, top + y);
            crisp++;
            if (got.some((v, i) => v !== want[i])) wrong.push(`${n.id} (${x},${y}) ${got.join()} != ${want.join()}`);
          }
        }
        expect(crisp, t).toBeGreaterThan(5000);
        expect(wrong.slice(0, 20), t).toEqual([]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is refused on a rounded box, by Dragon\'s compile, naming the package', () => {
    expect(() => marklessStyleExport(edit((v) => { v['css'] += '\n.dashed { border-radius: 8px; }'; }), PATH)).toThrow('rounded dashed borders are PNT1b');
  });
});
