// TXT2-g (notes/T149-txt2-spec.md R11) against the pinned Chrome's committed captures: the engine's clamped blocks and truncated
// fragments equal Chrome's rects on every line-clamp case at DPR 1, 2, 3 and 2.625, the three engine plants are caught, and the
// compiler's web output keeps the authored -webkit-box (planted webkitBoxEmittedAsFlowRoot writes flow-root). No Chrome runs here.
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox } from '@dragon/layout';
import { fromCssPx, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines } from '@dragon/layout';
import { engineLayoutProjection, NO_FAULTS } from 'dragon';
import type { DprCaseOutcome } from '../src/dpr.ts';
import { committedDprCapture, DPRS, layoutCases, runDprCase } from '../src/dpr.ts';
import { LINE_CLAMP } from '../src/fixture-groups/line-clamp.ts';
import { compileFixture, webCssOf } from '../src/pipeline.ts';
import { committedPixels } from '../src/pixel-reference.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';

const own = new Set(LINE_CLAMP.filter((f) => f.kind === 'layout').map((f) => f.id));
const corpus = layoutCases().filter((f) => own.has(f.spec.id));
const compiled = new Map(corpus.map((f) => [f.spec.id, compileFixture(f.spec, NO_FAULTS, 'enforce').compiled]));

/** Every case's outcome at DPR 1 and every DPR lane, with the given engine faults. */
function outcomes(faults: EngineFaults): DprCaseOutcome[] {
  return corpus.flatMap((f) => f.cases.flatMap((c) => [1, ...DPRS].map((dpr) => runDprCase(c, compiled.get(f.spec.id) as NonNullable<ReturnType<typeof compiled.get>>, dpr, committedDprCapture(c.id, dpr), faults))));
}

const failing = (faults: EngineFaults): string[] => outcomes(faults).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}`);

describe('TXT2-g: -webkit-line-clamp against Chrome 145', () => {
  it('covers the two layout fixtures, ltr only, each case compiled with no error', () => {
    expect([...own].sort()).toEqual(['line-clamp-lines', 'line-clamp-nested']);
    expect(corpus.map((f) => f.cases.length)).toEqual([1, 1]);
    for (const [id, c] of compiled) expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), id).toEqual([]);
  });

  it('the engine lays out every case as Chrome does: the clamped heights, line N cut for the ellipsis, the hidden lines below', () => {
    expect(outcomes(NO_ENGINE_FAULTS).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`)).toEqual([]);
    // Chrome ends l1 after its second line (two 10px lines) and still lays out the hidden lines below it.
    const capture = committedDprCapture('line-clamp-lines', 1);
    const node = (id: string) => capture.nodes.find((n) => n.id === id);
    expect(node('l1')?.height).toBe(20);
    expect(node('l2')?.height).toBe(20);
  });

  it('planted faults clampHeightIncludesHiddenLines, clampEllipsisMissingWhenLineFits and clampEllipsisOnExactLastLine are caught', () => {
    expect(failing({ ...NO_ENGINE_FAULTS, clampHeightIncludesHiddenLines: true })).toContain('line-clamp-lines@1');
    expect(failing({ ...NO_ENGINE_FAULTS, clampEllipsisOnExactLastLine: true })).toContain('line-clamp-lines@1');
  });

  it('planted fault clampEllipsisMissingWhenLineFits is caught against Chrome\'s pixels: l6\'s line 1 fits with the ellipsis', () => {
    // No rect shows an ellipsis that cuts nothing, so Chrome's DPR 2 pixels do: the U+2026 Chrome draws after l6's "XXX" (x 30 to 40).
    const f = corpus.find((x) => x.spec.id === 'line-clamp-lines') as NonNullable<(typeof corpus)[number]>;
    const c = f.cases[0] as NonNullable<(typeof f.cases)[number]>;
    const p = engineLayoutProjection(compiled.get(f.spec.id) as NonNullable<ReturnType<typeof compiled.get>>, c.environment, c.assignment);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const find = (b: LayoutBox): LayoutBox | undefined => (b.id === 'l6' ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== undefined));
    const l6 = find(p.input.root) as LayoutBox;
    const ellipsisAt = (faults: EngineFaults): number | null => {
      const ctx = { measurer: referenceShapedMeasurer(faults), devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS };
      const e = placeLines(ctx, l6, fromCssPx(100))[0]?.ellipsis ?? null;
      return e === null ? null : e.x / 64;
    };
    const top = committedDprCapture('line-clamp-lines', 1).nodes.find((n) => n.id === 'l6')?.y as number;
    const img = committedPixels(c.id, 2);
    if (img === null) throw new Error('no line-clamp-lines pixels at DPR 2');
    const ink = (x: number, y: number): boolean => (img.data[(y * 2 * img.width + x * 2) * 4] as number) < 128;
    expect(ink(35, top + 5)).toBe(true);
    expect(ink(45, top + 5)).toBe(false);
    expect(ellipsisAt(NO_ENGINE_FAULTS)).toBe(30);
    expect(ellipsisAt({ ...NO_ENGINE_FAULTS, clampEllipsisMissingWhenLineFits: true })).toBeNull();
  });

  it('the web output writes the authored display: -webkit-box, and planted webkitBoxEmittedAsFlowRoot writes flow-root', () => {
    const spec = LINE_CLAMP.find((f) => f.id === 'line-clamp-lines') as NonNullable<(typeof LINE_CLAMP)[number]>;
    const css = webCssOf(compileFixture(spec, NO_FAULTS, 'enforce').compiled) ?? '';
    expect(css).toContain('display: -webkit-box;');
    expect(css).not.toContain('flow-root');
    expect(webCssOf(compileFixture(spec, { ...NO_FAULTS, webkitBoxEmittedAsFlowRoot: true }, 'enforce').compiled) ?? '').toContain('display: flow-root;');
  });
});
