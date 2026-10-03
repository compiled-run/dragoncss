// PNT1-MIX: the stacking check (analysis/paint-values/stacking.ts) and the stacking lowering read the same stacking tree, with the
// layout tree's anonymous boxes. Before, the check's tree put text straight beside a block child, so a box mixing the two failed the
// check's native-order assertion. Checked on every layout case of the corpus, with a planted tree of the old shape.
import { describe, expect, it } from 'vitest';
import type { StackNode } from 'dragon';
import { stackTrees } from 'dragon';
import { stackingOf } from '../../dragon/src/lower/paint/stacking.ts';
import { nativeCases } from '../src/native-host.ts';

/** The tree with every anonymous box replaced by its children: the stacking check's tree before PNT1-MIX. */
const withoutAnonymous = (n: StackNode): StackNode => ({ ...n, children: n.children.flatMap((c) => (/:anon\d+$/.test(c.id) ? c.children : [withoutAnonymous(c)])) });

describe('PNT1-MIX: one stacking tree for the check and the lowering', () => {
  const cases = nativeCases();

  it('the check\'s tree equals the lowering\'s on every layout case of the corpus', () => {
    let compared = 0;
    for (const c of cases) {
      const t = stackTrees(c.compiled, c.case.assignment);
      if (typeof t === 'string') throw new Error(`${c.case.id}: ${t}`);
      expect(t.resolved, c.case.id).toEqual(t.layout);
      compared++;
    }
    expect(compared).toBe(cases.length);
    expect(cases.map((c) => c.case.id)).toEqual(expect.arrayContaining(['stacking-mix', 'stacking-mix-rtl']));
  });

  it('PLANTED: the old tree, text beside the block child, fails the native-order assertion on stacking-mix', () => {
    const c = cases.find((x) => x.case.id === 'stacking-mix');
    if (c === undefined) throw new Error('no stacking-mix case');
    const t = stackTrees(c.compiled, c.case.assignment);
    if (typeof t === 'string') throw new Error(t);
    expect(() => stackingOf(t.resolved)).not.toThrow();
    expect(() => stackingOf(withoutAnonymous(t.resolved))).toThrow(/the placements give the native order .*, not Appendix E's/);
  });
});
