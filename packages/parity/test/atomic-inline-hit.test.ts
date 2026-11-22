// HIT-atomic-inline: the compiler's R13 box check (interaction.ts hitUnmodelledBox, holdsAtomicLine) and the hit table (rt-hit.ts
// hitRefusal) must agree on every layout case: the compiler refuses a case's interaction rules for an atomic inline's block exactly
// when the table refuses that case for an atomic inline, and every other atomic-inline case the table models.
import { describe, expect, it } from 'vitest';
import type { ResolvedElement } from '../../dragon/src/analysis/resolve.ts';
import { hitUnmodelledBox } from '../../dragon/src/analysis/interaction.ts';
import { internalRecord } from '../../dragon/src/project.ts';
import { hitRefusal } from '../src/hit-capture.ts';
import { nativeCases } from '../src/native-host.ts';

const ATOMIC_REFUSAL = / is an atomic inline outside an inline formatting context, | has percentage padding around atomic inlines, /;
const ATOMIC_DISPLAYS = ['inline-block', 'inline-flex', 'inline-grid'];

/** Every element of a resolved tree in preorder. */
function elements(root: ResolvedElement): ResolvedElement[] {
  return [root, ...root.children.flatMap((c) => (c.kind === 'element' ? elements(c as ResolvedElement) : []))];
}

const display = (e: ResolvedElement): string => {
  const v = e.props.get('display');
  return v !== undefined && v.value.kind === 'keyword' ? v.value.value : '';
};

describe('the compiler and the hit table agree on atomic inlines', () => {
  it('refuse the same atomic-inline cases, and the table models the rest', () => {
    let atomic = 0;
    let modelled = 0;
    for (const n of nativeCases()) {
      const record = internalRecord(n.compiled);
      const resolved = record?.cases.find((c) => c.resolved !== null)?.resolved ?? null;
      if (resolved === null) continue;
      const table = hitRefusal(n);
      const tableRefuses = table !== null && ATOMIC_REFUSAL.test(table);
      // A case the table refuses for an earlier reason proves nothing either way.
      if (table !== null && !tableRefuses) continue;
      const compilerRefuses = hitUnmodelledBox(resolved)?.pkg === 'INL2a';
      expect([n.case.id, compilerRefuses], n.case.id).toEqual([n.case.id, tableRefuses]);
      if (!elements(resolved).some((e) => ATOMIC_DISPLAYS.includes(display(e)))) continue;
      atomic++;
      if (table === null) modelled++;
    }
    expect(atomic).toBeGreaterThan(10);
    expect(modelled).toBe(atomic);
  });
});
