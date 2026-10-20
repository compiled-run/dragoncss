// SELD-R2 PR 5 (step 5a): the forced interaction cases the device check lanes run beside the layout cases. A case here forces
// :focus or :focus-visible in a case of an INTERACTION_FORCED fixture with no focusable element, so only forcing reaches the state;
// it proves the forced-only interaction rows (profile-rows.ts deriveInteractionRows). On the device it is a plain layout case: the
// interaction state's own native programs, drawn without the interaction runtime. Its Chrome references are taken with the state
// forced (CSS.forcePseudoState), folded into authoredPrepare so every capture that runs a case's prepare script forces it too.
import { createHash } from 'node:crypto';
import type { ForcedPseudo } from 'dragon';
import { focusReachableIn, interactionPartitionOf, interactionRowFeature } from 'dragon';
import type { ParityCase } from './cases.ts';
import { forcedCasesOf } from './cases.ts';
import { layoutCases } from './dpr.ts';
import { INTERACTION_FORCED } from './fixture-groups/interaction.ts';
import type { FixtureSpec } from './fixtures.ts';
import { directionSuffix } from './fixtures.ts';
import { nativeCompileOnce } from './native-compile.ts';
import { authoredPrepareOf } from './pipeline.ts';
import { shapedCaseIds } from './text-latin-run.ts';

/**
 * A forced device case: its fixture; the case, forcing folded into authoredPrepare, with its device id "<case>~fx<digest>" (the
 * direction suffix last), keyed by a digest of its interaction state's key, so device evidence carried across a partition change
 * never stands for another state; hostId, the host forced case "<case>~ix<k>" whose chrome-dual outcome and device-traces script
 * it shares; the pseudo-classes it forces; and the focus row features it proves.
 */
export type ForcedDeviceCase = {
  readonly spec: FixtureSpec;
  readonly case: ParityCase;
  readonly hostId: string;
  readonly force: readonly ForcedPseudo[];
  readonly features: readonly string[];
};

/** The state digest of a forced device case id: the first 12 hex digits of the SHA-256 of its interaction state's key. */
export const stateDigest = (key: string): string => createHash('sha256').update(key).digest('hex').slice(0, 12);

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
      const compiled = nativeCompileOnce(f.spec, c.environment.direction);
      // As the gate decides it: no focusable element in any case of the document and no rule that may make a scroller.
      if (focusReachableIn(compiled)) continue;
      const p = interactionPartitionOf(compiled, c.assignment);
      if (p === null || p.elements.some((e) => e.focusable)) continue;
      for (const fc of forcedCasesOf(f.spec, c, p)) {
        const features = [...new Set((fc.forced ?? []).flatMap((x) => (x.pseudo === 'focus' || x.pseudo === 'focus-visible' ? [interactionRowFeature(x.pseudo)] : [])))];
        if (features.length === 0) continue;
        const { forced: force = [], ...rest } = fc;
        if (fc.interaction === undefined) throw new Error(`${fc.id}: a forced case without an interaction state`);
        const id = `${f.spec.id}${f.spec.format === 'tree' ? `#${c.index}` : ''}~fx${stateDigest(fc.interaction)}${directionSuffix(c.environment.direction)}`;
        out.push({ spec: f.spec, case: { ...rest, id, authoredPrepare: authoredPrepareOf(fc) ?? null }, hostId: fc.id, force, features });
      }
    }
  }
  forced = out;
  return out;
}

/** The ids of every forced device case. */
export const forcedDeviceCaseIds = (): string[] => forcedDeviceCases().map((c) => c.case.id);
