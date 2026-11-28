// Real-face layout pages the iOS test lane cannot build until TXT1a-2 gives the iOS support profile its face rows. Each page's
// enforced iOS compile must be refused by exactly these diagnostics, so the device tests fail the moment Dragon stops refusing it.
import type { Diagnostic } from 'dragon';

export type FaceRefusal = { readonly code: string; readonly feature: string | null };

export const IOS_FACE_REFUSED: ReadonlyMap<string, readonly FaceRefusal[]> = new Map([
  ['controls-text-field-font-definite', [{ code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<pinned>' }]],
  ['controls-text-font', [{ code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<declared>' }, { code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<declared>' }]],
  ['controls-text-font-column-flex', [{ code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<declared>' }, { code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<declared>' }]],
  ['text-font-variant-numeric', [{ code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<pinned>' }, { code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<pinned>' }]],
  ['controls-text-font-grid', [{ code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<declared>' }, { code: 'DRAGON_UNSUPPORTED_VALUE', feature: 'font-family:<declared>' }]],
]);

/** A compile's iOS errors as code and support-profile feature, in diagnostic order. */
export function iosRefusals(diagnostics: readonly Diagnostic[]): readonly FaceRefusal[] {
  return diagnostics.filter((d) => d.severity === 'error' && d.target === 'ios').map((d) => ({ code: d.code, feature: d.profile?.feature ?? null }));
}
