// The layout cases waiting on their iOS support-profile rows. A case whose enforced iOS compile is refused only by support-profile
// rows waits on the rows the host round derives (regen-on-ci runs the Chrome steps, then lanes-host, then the Chrome steps again):
// the vectors steps write no vector for it this round, the manifests count it out (lanes.ts checkManifests), and the next round,
// with the rows promoted, writes and counts it. A refusal for an unproven context (DRAGON_UNPROVEN_CONTEXT: the feature's row lacks
// that context, as when all: unset makes a box inline) waits the same way: the context row is one the host round derives.
import { layoutCases } from './dpr.ts';
import { enforcedCompile } from './pipeline.ts';

const PROFILE_ONLY = /is unsupported \(support profile /;
/**
 * The face features (project.ts FACE_FEATURES): a native refusal of one is a font refusal the engine lane defers (TXT1a-2 phase R
 * maps the real faces, so an unproven face is a profile refusal now, not DRAGON_UNSUPPORTED_FONT), so it holds no vector back.
 */
const FACE_FEATURES = ['font-family:', 'font-weight:', 'font-style:', 'font-synthesis-weight:', 'font-synthesis-style:', 'font-synthesis-small-caps:'];
const faceRefusal = (d: { readonly profile: { readonly feature: string } | null }): boolean => d.profile !== null && FACE_FEATURES.some((f) => d.profile?.feature.startsWith(f) === true);

let pending: ReadonlySet<string> | null = null;
/** The ids of the layout cases whose enforced iOS compile is refused by support-profile rows and nothing else. */
export function profilePendingCaseIds(): ReadonlySet<string> {
  if (pending === null) {
    pending = new Set(layoutCases().flatMap((f) => f.cases.filter((c) => {
      const errors = enforcedCompile(f.spec, c.environment.direction).diagnostics.filter((d) => d.severity === 'error' && d.target === 'ios' && !faceRefusal(d));
      return errors.length > 0 && errors.every((d) => d.code === 'DRAGON_UNPROVEN_CONTEXT' || PROFILE_ONLY.test(d.message));
    }).map((c) => c.id)));
  }
  return pending;
}
