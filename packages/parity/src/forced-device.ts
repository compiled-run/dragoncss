// SELD-R2 PR 5 (step 5a): the forced interaction cases the device check lanes run beside the layout cases. A case here forces
// :focus or :focus-visible in a case of an INTERACTION_FORCED fixture with no focusable element, so only forcing reaches the state;
// it proves the forced-only interaction rows (profile-rows.ts deriveInteractionRows). On the device it is a plain layout case: the
// interaction state's own native programs, drawn without the interaction runtime. Its Chrome references are taken with the state
// forced (CSS.forcePseudoState), folded into authoredPrepare so every capture that runs a case's prepare script forces it too.
import { interactionPartitionOf, interactionRowFeature } from 'dragon';
import type { ParityCase } from './cases.ts';
import { forcedCasesOf } from './cases.ts';
import { layoutCases } from './dpr.ts';
import { INTERACTION_FORCED } from './fixture-groups/interaction.ts';
import type { FixtureSpec } from './fixtures.ts';
import { nativeCompileOnce } from './native-compile.ts';
import { authoredPrepareOf } from './pipeline.ts';
import { shapedCaseIds } from './text-latin-run.ts';

/** A forced device case: its fixture, the case (forcing folded into authoredPrepare) and the focus row features it proves. */
export type ForcedDeviceCase = { readonly spec: FixtureSpec; readonly case: ParityCase; readonly features: readonly string[] };

let forced: readonly ForcedDeviceCase[] | null = null;

/** Every forced device case, in layout case order and then partition state order. */
export function forcedDeviceCases(): readonly ForcedDeviceCase[] {
  if (forced !== null) return forced;
  const out: ForcedDeviceCase[] = [];
  // A shaped case is no device case until TXT1a-2 phase R (targets.ts vectorCaseIds), so neither are its forced cases.
  const shaped = shapedCaseIds();
  for (const f of layoutCases()) {
    if (!INTERACTION_FORCED.has(f.spec.id)) continue;
    for (const c of f.cases) {
      if (shaped.has(c.id)) continue;
      const p = interactionPartitionOf(nativeCompileOnce(f.spec, c.environment.direction), c.assignment);
      if (p === null || p.elements.some((e) => e.focusable)) continue;
      for (const fc of forcedCasesOf(f.spec, c, p)) {
        const features = [...new Set((fc.forced ?? []).flatMap((x) => (x.pseudo === 'focus' || x.pseudo === 'focus-visible' ? [interactionRowFeature(x.pseudo)] : [])))];
        if (features.length === 0) continue;
        const { forced: _forced, ...rest } = fc;
        out.push({ spec: f.spec, case: { ...rest, authoredPrepare: authoredPrepareOf(fc) ?? null }, features });
      }
    }
  }
  forced = out;
  return out;
}

/** The ids of every forced device case. */
export const forcedDeviceCaseIds = (): string[] => forcedDeviceCases().map((c) => c.case.id);
