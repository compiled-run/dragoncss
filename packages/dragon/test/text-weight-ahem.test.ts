// TXT-W on native over Ahem: Chrome draws Ahem's one regular face at every computed font-weight below 600 and in synthetic bold from
// 600 (Skia's fake bold, which keeps every advance), so native lays every weight out and from 600 strokes the glyphs (the program's
// synthetic-bold write). The Chrome cases are text-weight-ahem and text-weight-bold-ahem (packages/parity/fixtures); this file holds the
// boundary and the ahemSyntheticBoldFrom700 plant, and text-weight-bold-ahem.test.ts the writes.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const project = (faults: CompilerFaults, profiles: 'derive' | 'enforce' = 'derive') =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles, direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const body = (r: SourceRef): TreeNode[] => [el(r, 'a', 'div', ['w'], [text(r, 't', 'XX XX')])];

/** Each error as `<target> <code>` for Ahem text at the given font-weight declaration. */
function errorsAt(weight: string, faults: CompilerFaults = NO_FAULTS, profiles: 'derive' | 'enforce' = 'derive'): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .w { font-weight: ${weight}; }`;
  const c = project(faults, profiles).compile(inputFor(css, body));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

/** Whether the native programs embolden the text at the given font-weight declaration (both backends must agree). */
function emboldened(weight: string, faults: CompilerFaults = NO_FAULTS): boolean {
  const css = `body { font-family: Ahem; font-size: 10px; } .w { font-weight: ${weight}; }`;
  const p = nativePrograms(project(faults).compile(inputFor(css, body)), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const [ios, android] = [p.programs.uikit, p.programs['android-views']].map((prog) => prog.nodes.some((n) => n.writes.some((w) => w.kind === 'synthetic-bold')));
  expect(android, weight).toBe(ios);
  return ios as boolean;
}

describe('font-weight over Ahem on native', () => {
  it('accepts every computed weight below 600 on ios, android and web', () => {
    for (const w of ['1', '100', '300', '400', '500', '599', '599.9', 'normal', 'lighter']) expect(errorsAt(w), w).toEqual([]);
  });

  it('accepts weights from 600, bold and bolder on ios and android since TXT-W, emboldening exactly those where Chrome synthesizes the bold', () => {
    // Were refused (DRAGON_UNSUPPORTED_FONT on ios and android) until native drew Ahem's synthetic bold (text-weight-bold-ahem proves it).
    for (const w of ['600', '650', '699', '700', 'bold', 'bolder', '1000']) {
      expect(errorsAt(w), w).toEqual([]);
      expect(emboldened(w), w).toBe(true);
    }
    for (const w of ['1', '400', '599', '599.9', 'normal', 'lighter']) expect(emboldened(w), w).toBe(false);
  });

  it('plant ahemSyntheticBoldFrom700: native draws 600 to 699 unemboldened, which Chrome draws in synthetic bold, and still emboldens 700', () => {
    const plant = { ...NO_FAULTS, ahemSyntheticBoldFrom700: true };
    for (const w of ['600', '699']) {
      expect(emboldened(w), w).toBe(true);
      expect(emboldened(w, plant), w).toBe(false);
      expect(errorsAt(w, plant), w).toEqual([]);
    }
    expect(emboldened('700', plant)).toBe(true);
    expect(emboldened('599', plant)).toBe(false);
  });

  it('the shipped support rows (enforce mode) accept the weights text-weight-ahem and text-weight-bold-ahem prove', () => {
    for (const w of ['300', '400', '500', 'lighter', '600', '700', 'bold', 'bolder']) expect(errorsAt(w, NO_FAULTS, 'enforce'), w).toEqual([]);
  });
});
