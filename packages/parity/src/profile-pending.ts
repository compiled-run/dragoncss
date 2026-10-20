// The layout cases waiting on their iOS support-profile rows. A case whose enforced iOS compile is refused only by support-profile
// rows waits on the rows the host round derives (regen-on-ci runs the Chrome steps, then lanes-host, then the Chrome steps again):
// the vectors steps write no vector for it this round, the manifests count it out (lanes.ts checkManifests), and the next round,
// with the rows promoted, writes and counts it.
import { layoutCases } from './dpr.ts';
import { enforcedCompile } from './pipeline.ts';

const PROFILE_ONLY = /is unsupported \(support profile /;

let pending: ReadonlySet<string> | null = null;
/** The ids of the layout cases whose enforced iOS compile is refused by support-profile rows and nothing else. */
export function profilePendingCaseIds(): ReadonlySet<string> {
  if (pending === null) {
    pending = new Set(layoutCases().flatMap((f) => f.cases.filter((c) => {
      const errors = enforcedCompile(f.spec, c.environment.direction).diagnostics.filter((d) => d.severity === 'error' && d.target === 'ios');
      return errors.length > 0 && errors.every((d) => PROFILE_ONLY.test(d.message));
    }).map((c) => c.id)));
  }
  return pending;
}
