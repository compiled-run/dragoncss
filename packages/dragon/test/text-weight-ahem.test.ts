// TXT-W on native over Ahem: Chrome draws Ahem's one regular face at every computed font-weight below 600 (its synthetic bold starts
// at 600, and keeps every advance), so native lays that text out and draws it; from 600 on native refuses it. The Chrome cases are
// text-weight-ahem (packages/parity/fixtures); this file holds the boundary and the ahemSyntheticBoldFrom700 plant.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
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

const REFUSED = ['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT'];

describe('font-weight over Ahem on native', () => {
  it('accepts every computed weight below 600 on ios, android and web', () => {
    for (const w of ['1', '100', '300', '400', '500', '599', '599.9', 'normal', 'lighter']) expect(errorsAt(w), w).toEqual([]);
  });

  it('refuses weights from 600, bold and bolder on ios and android only, where Chrome synthesizes the bold', () => {
    for (const w of ['600', '650', '699', '700', 'bold', 'bolder', '1000']) expect(errorsAt(w), w).toEqual(REFUSED);
  });

  it('plant ahemSyntheticBoldFrom700: native accepts 600 to 699, which Chrome draws in synthetic bold, and still refuses 700', () => {
    const plant = { ...NO_FAULTS, ahemSyntheticBoldFrom700: true };
    for (const w of ['600', '699']) {
      expect(errorsAt(w), w).toEqual(REFUSED);
      expect(errorsAt(w, plant), w).toEqual([]);
    }
    expect(errorsAt('700', plant)).toEqual(REFUSED);
    expect(errorsAt('599', plant)).toEqual([]);
  });

  it('the shipped support rows (enforce mode) accept the weights text-weight-ahem proves and still refuse 700', () => {
    for (const w of ['300', '400', '500', 'lighter']) expect(errorsAt(w, NO_FAULTS, 'enforce'), w).toEqual([]);
    expect(errorsAt('700', NO_FAULTS, 'enforce')).toEqual(REFUSED);
  });
});
