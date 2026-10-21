// TXT2-tj: the engine's glyph positions on the justified lines of text-justify-values-ahem and text-justify-mixed-ahem (fixture group
// text-justify), shared by text-justify-values.test.ts (a live Chrome) and text-justify-engine.test.ts (offline).
import type { EngineFaults, LayoutBox, LU, PlacedLine, TextLeaf } from '@dragon/layout';
import { ahemMeasurer, inlineLeaves, layout, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, zoomInput } from '@dragon/layout';
import { engineLayoutProjection, NO_FAULTS } from 'dragon';
import { layoutCases } from '../src/dpr.ts';
import { compileFixture } from '../src/pipeline.ts';

export const ID = 'text-justify-values-ahem';
/** The ltr-only fixture whose line mixes inter-character with auto (refused in rtl). */
export const MIXED_ID = 'text-justify-mixed-ahem';

/** The blocks of each fixture that hold text, by id. */
export const FIXTURE_BLOCKS = {
  [ID]: ['auto', 'word', 'none', 'char', 'rem', 'dist', 'mixn', 'inhc', 'off', 'rc', 'rn'],
  [MIXED_ID]: ['mixc'],
} as const;
export const BLOCKS = [...FIXTURE_BLOCKS[ID], ...FIXTURE_BLOCKS[MIXED_ID]] as const;

/**
 * Each block's lines, each as the css px left of every non-space character from the block's content-box left, in the engine at DPR 1
 * left to right: the piece's x, the advances before the character and its justification shift.
 */
export function engineGlyphs(faults: EngineFaults = NO_ENGINE_FAULTS): Record<string, number[][]> {
  return Object.assign({}, fixtureGlyphs(ID, faults), fixtureGlyphs(MIXED_ID, faults)) as Record<string, number[][]>;
}

function fixtureGlyphs(id: keyof typeof FIXTURE_BLOCKS, faults: EngineFaults): Record<string, number[][]> {
  const blocks: readonly string[] = FIXTURE_BLOCKS[id];
  const f = layoutCases().find((x) => x.spec.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  const c = f.cases.find((x) => x.environment.direction === 'ltr');
  if (c === undefined) throw new Error(`no ltr case of ${id}`);
  const compiled = compileFixture(f.spec, NO_FAULTS, 'derive', 'ltr').compiled;
  const p = engineLayoutProjection(compiled, c.environment, c.assignment);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const r = layout(p.input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  const widths = new Map(r.boxes.map((b) => [b.id, b.width]));
  const ctx = { measurer: ahemMeasurer, devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS };
  const out: Record<string, number[][]> = {};
  const walk = (b: LayoutBox): void => {
    if (blocks.includes(b.id)) {
      const leaves: readonly TextLeaf[] = inlineLeaves(b);
      out[b.id] = placeLines(ctx, b, widths.get(b.id) as LU).map((l: PlacedLine) => {
        const xs: number[] = [];
        for (const piece of l.pieces) {
          const leaf = leaves[piece.leaf] as TextLeaf;
          for (let i = piece.start; i < piece.visibleEnd; i++) {
            if (leaf.text[i] === ' ') continue;
            xs.push(piece.x / 64 + (i - piece.start) * leaf.font.size + (piece.shifts[i - piece.start] ?? 0));
          }
        }
        return xs;
      });
    }
    for (const k of b.children) if (k.kind === 'box') walk(k);
  };
  walk(zoomInput(p.input, NO_ENGINE_FAULTS).root);
  return out;
}
