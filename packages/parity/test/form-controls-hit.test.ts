// FORM hit: the compiler's R13 control check (interaction.ts hitUnmodelledControl, hitRetargetsParts) and the hit table
// (rt-hit.ts hitRefusal, hitControlBox) must agree on every layout case: the compiler refuses a case's interaction rules for a
// control exactly when the table would refuse that control, and it skips exactly the shadow parts the table retargets.
import { describe, expect, it } from 'vitest';
import type { ResolvedElement } from '../../dragon/src/analysis/resolve.ts';
import { hitRetargetsParts, hitUnmodelledControl } from '../../dragon/src/analysis/interaction.ts';
import { internalRecord } from '../../dragon/src/project.ts';
import { hitRefusal } from '../src/hit-capture.ts';
import { nativeCases } from '../src/native-host.ts';

const CONTROL_REFUSAL = / is a form control, which the hit table does not model yet /;

/** Every element of a resolved tree in preorder. */
function elements(root: ResolvedElement): ResolvedElement[] {
  return [root, ...root.children.flatMap((c) => (c.kind === 'element' ? elements(c as ResolvedElement) : []))];
}

describe('the compiler and the hit table agree on form controls', () => {
  it('refuse the same control cases, and retarget the same parts', () => {
    let controls = 0;
    let retargeting = 0;
    for (const n of nativeCases()) {
      const record = internalRecord(n.compiled);
      const resolved = record?.cases.find((c) => c.resolved !== null)?.resolved ?? null;
      if (resolved === null) continue;
      const table = hitRefusal(n);
      const tableRefusesControl = table !== null && CONTROL_REFUSAL.test(table);
      const compilerRefuses = hitUnmodelledControl(resolved) !== null;
      // A control the table never reaches (a case it refuses for an earlier box) proves nothing either way.
      if (table !== null && !tableRefusesControl) continue;
      const all = elements(resolved);
      if (all.some((e) => ['button', 'input', 'select'].includes(e.element.tag))) controls++;
      expect([n.case.id, compilerRefuses], n.case.id).toEqual([n.case.id, tableRefusesControl]);
      for (const e of all.filter(hitRetargetsParts)) {
        retargeting++;
        const ids = new Set(n.programs.uikit.nodes.map((x) => x.id));
        expect([...ids].some((id) => id.startsWith(`${e.element.address}::`)), `${n.case.id} ${e.element.address} has UA shadow parts`).toBe(true);
      }
    }
    expect(controls).toBeGreaterThan(10);
    expect(retargeting).toBeGreaterThan(5);
  });
});
