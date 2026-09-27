// Text measurers keyed by capture platform (docs/decisions.md, Linux lane scope). Chrome's font metric rounding differs per
// platform, so a platform with no registered rules is refused with a typed code; it is never measured with another platform's rules.
import type { PlatformRule } from './platform-rules.ts';
import { PLATFORM_RULES } from './platform-rules.ts';
import type { TextMeasurer } from './text.ts';
import { ahemMeasurer } from './text.ts';

/** The platform the committed Chrome references were captured on. */
export const REFERENCE_PLATFORM = 'darwin-arm64';

export type MeasurerChoice =
  | { readonly kind: 'ok'; readonly platform: string; readonly key: string; readonly measurer: TextMeasurer; readonly rules: readonly PlatformRule[] }
  | { readonly kind: 'refused'; readonly code: 'no-platform-rules'; readonly platform: string; readonly detail: string };

const MEASURERS: ReadonlyMap<string, { readonly key: string; readonly measurer: TextMeasurer }> = new Map([
  ['darwin-arm64', { key: 'ahem/darwin-arm64', measurer: ahemMeasurer }],
]);

/** The Ahem measurer with the platform rules of one capture platform, or a typed refusal. */
export function measurerFor(platform: string): MeasurerChoice {
  const m = MEASURERS.get(platform);
  const rules = PLATFORM_RULES.get(platform);
  if (m === undefined || rules === undefined) {
    return { kind: 'refused', code: 'no-platform-rules', platform, detail: `no platform rules are registered for ${platform}; its font metric rounding is unmeasured` };
  }
  return { kind: 'ok', platform, key: m.key, measurer: m.measurer, rules };
}
