// FORM-b select S3: the translated harness reports each menulist-button select's arrow (layout paint.ts menuListArrows) in its
// engine result, so the vectors suites hold the Swift and Kotlin engines to the TypeScript engine on the controls-select-button
// fixtures at every DPR.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '../../layout/src/input.ts';
import { layout } from '../../layout/src/layout.ts';
import { menuListArrows } from '../../layout/src/paint.ts';
import { ahemMeasurer } from '../../layout/src/text.ts';
import { runEngineCase } from '../harness/harness.ts';
import { bitsHex } from '../harness/host.ts';
import { vectorCase, VECTORS_DIR } from '../src/corpus.ts';
import { DPR_SETS } from '../src/corpus-dpr.ts';

describe('FORM-b select S3: the arrows in the engine result', () => {
  it("reports each arrow after the boxes, which the Swift and Kotlin engines must reproduce", () => {
    for (const file of ['controls-select-button.json', 'controls-select-button-rtl.json']) {
      for (const dir of [VECTORS_DIR, ...DPR_SETS.map((d) => join(VECTORS_DIR, `dpr-${d}`))]) {
        const v = vectorCase(dir, file);
        const input = (JSON.parse(v.line) as { input: LayoutInput }).input;
        const r = layout(input, ahemMeasurer);
        if (r.kind !== 'ok') throw new Error(`${dir}/${file}: refused`);
        const arrows = menuListArrows(input, r.boxes);
        expect(arrows.length, `${dir}/${file}`).toBeGreaterThan(5);
        const out = JSON.parse(runEngineCase(v.line)) as unknown[];
        expect(out[0]).toBe('ok');
        const suffix = out[out.length - 1] as unknown[];
        expect(suffix[0], `${dir}/${file}`).toBe('menulist-arrows');
        expect(suffix[1], `${dir}/${file}`).toEqual(arrows.map((a) => [a.id, bitsHex(a.arrow.strokeWidth), a.arrow.shape.segments.map((g) => (g.kind === 'move' || g.kind === 'line' ? [g.kind, bitsHex(g.x), bitsHex(g.y)] : [g.kind]))]));
      }
    }
  });

  it('leaves a result with no menulist-button select as it was', () => {
    const v = vectorCase(VECTORS_DIR, 'controls-select-none.json');
    const out = JSON.parse(runEngineCase(v.line)) as unknown[];
    expect(out[0]).toBe('ok');
    expect(out.length).toBe(4);
  });
});
