// TXT-TW: the expected lines of text-wrap-balance-ahem (fixture group text-wrap) and the engine's lines of its compiled native input,
// shared by text-wrap-style.test.ts (the engine, offline) and text-wrap-balance.test.ts (a live Chrome).
import type { EngineFaults, LayoutBox, LU, TextLeaf } from '@dragon/layout';
import { ahemMeasurer, layout, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, zoomInput } from '@dragon/layout';
import { engineLayoutProjection, NO_FAULTS } from 'dragon';
import { layoutCases } from '../src/dpr.ts';
import { compileFixture } from '../src/pipeline.ts';

export const ID = 'text-wrap-balance-ahem';

/** Each block's lines under balance or pretty, by block id. */
export const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  b1: ['XX XXX', 'XX XXXX', 'XX X XXX'],
  b2: ['XXXXXX XX', 'XXX XXXX', 'X XXXXX', 'XX XXX'],
  b3: ['XXXX', 'XXXX XX'],
  b4: ['XX XXX', 'XX XXXX', 'XX X XXX'],
  b5: ['XX XXX XX', 'XXXX XX X XXX'],
  b6: ['XX XX XX', 'XX XX XX', 'XX XX XX', 'XX XX XX', 'XX XX XX', 'XX XX XX', 'XX XX XX', 'XX'],
  b7: ['XXXXXXXXXXXXXX', 'XX XX XX'],
  b8i: ['XX XXX', 'XX XXXX', 'XX X XXX'],
  b9: ['XXX XX', 'XXXX', 'X XX', 'XXXXX', 'XXX XX'],
  b10: ['XX XXX XX'],
  p1: ['XXXXX XXX', 'XXXXXX', 'XXX X'],
  p2: ['XXXX XXXX', 'XXXXX X', 'XXXX XXX', 'XX XXXXX', 'X XXX'],
  p3: ['XX XXXX', 'XXX XXXXX', 'XXXX X'],
  p4: ['XXXX XXXX', 'XX'],
  p5: ['XXXXX XXX', 'XXXXXX', 'XXX X'],
  rb: ['XX XXX', 'XX XXXX', 'XX X XXX'],
  rp: ['XXXXX XXX', 'XXXXXX', 'XXX X'],
};

/** The blocks whose balanced or pretty lines differ from the greedy ones. */
export const CHANGED = ['b1', 'b2', 'b3', 'b4', 'b8i', 'b9', 'p1', 'p2', 'p5', 'rb', 'rp'];

/** Each text-wrap-style block's lines in the engine, by id, for the case in direction at dpr. */
export function engineLines(direction: 'ltr' | 'rtl', dpr: number, faults: EngineFaults = NO_ENGINE_FAULTS): Record<string, string[]> {
  const f = layoutCases().find((x) => x.spec.id === ID);
  if (f === undefined) throw new Error(`no fixture ${ID}`);
  const c = f.cases.find((x) => x.environment.direction === direction);
  if (c === undefined) throw new Error(`no ${direction} case of ${ID}`);
  const compiled = compileFixture(f.spec, NO_FAULTS, 'derive', direction).compiled;
  const p = engineLayoutProjection(compiled, c.environment, c.assignment);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const given = { ...p.input, devicePixelRatio: dpr };
  const r = layout(given, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  const widths = new Map(r.boxes.map((b) => [b.id, b.width]));
  const ctx = { measurer: ahemMeasurer, devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS };
  const out: Record<string, string[]> = {};
  const walk = (b: LayoutBox): void => {
    const leaf = b.children.find((k): k is TextLeaf => k.kind === 'text');
    if (leaf !== undefined && b.style.textWrapStyle.kind !== 'auto') {
      out[b.id] = placeLines(ctx, b, widths.get(b.id) as LU).map((l) => {
        const piece = l.pieces[0];
        return piece === undefined ? '' : leaf.text.slice(piece.start, piece.visibleEnd);
      });
    }
    for (const k of b.children) if (k.kind === 'box') walk(k);
  };
  walk(zoomInput(given, NO_ENGINE_FAULTS).root);
  return out;
}
