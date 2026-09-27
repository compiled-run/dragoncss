// Rules of the Chrome reference platform that CSS does not define, held by nodes that match Chrome exactly at 1/64 px. The 1 device
// px gate cannot see them, so each rule has a planted fault (EngineFaults) that makes its nodes non-exact. Both rules were measured
// on macOS (darwin-arm64) Chrome 145.0.7632.6 and are not claimed for any other platform (notes/T036-s4a-review-s4b-plan.md).

export type PlatformRule = {
  readonly id: string;
  /** The capture platform the rule was measured on. */
  readonly platform: 'darwin-arm64';
  readonly rule: string;
  readonly source: string;
  readonly fault: 'metricHalfUp' | 'untruncatedFontSize';
  readonly branches: readonly { readonly id: string; readonly description: string }[];
  /** A node whose exact 1/64 px match with Chrome depends on the rule on one branch. */
  readonly nodes: readonly { readonly branch: string; readonly fixture: string; readonly node: string }[];
};

export const platformRules: readonly PlatformRule[] = [
  {
    id: 'ahem-metric-half-down',
    platform: 'darwin-arm64',
    rule: 'Ahem ascent and descent round to the nearest whole px, with an exact half rounded down (units.ts roundFontMetricToWholePx).',
    source: 'third_party/blink/renderer/platform/fonts/font_metrics.cc at 145.0.7632.6 rounds with SkScalarRoundToScalar (halves up, lines 111-112), so the half-down result on macOS is taken to come from the CoreText metric values; inferred, not traced. Lines 114-126 move 1 px from ascent to descent on Linux, ChromeOS, Android and Fuchsia, which this rule does not claim.',
    fault: 'metricHalfUp',
    branches: [{ id: 'half-down', description: 'a descent of exactly n + 0.5 px rounds to n: 12.5px, 17.5px and 22.5px Ahem have glyph boxes 12, 17 and 22 px tall, not 13, 18 and 23' }],
    nodes: [
      { branch: 'half-down', fixture: 'text-fractional-font-size', node: 's1:text0:line1' },
      { branch: 'half-down', fixture: 'text-fractional-font-size', node: 'half2:text0:line0' },
      { branch: 'half-down', fixture: 'text-fractional-font-size', node: 'h3b:text0:line0' },
    ],
  },
  {
    id: 'font-size-truncation',
    platform: 'darwin-arm64',
    rule: 'Glyph advances and metrics use the font size times 100, truncated (units.ts platformFontSize); line-height numbers still multiply the computed size.',
    source: 'third_party/blink/renderer/platform/fonts/font_description.cc lines 268-279 at 145.0.7632.6 (EffectiveFontSize: floorf(size * PrecisionMultiplier()) / PrecisionMultiplier()) with font_cache_key.h line 53 (kFontSizePrecisionMultiplier = 100). The code is not platform-specific, but the rule is measured only on darwin-arm64 (notes/T035-slice-4a.md), so it is keyed there.',
    fault: 'untruncatedFontSize',
    branches: [{ id: 'size-truncation', description: '10.625px measures as 10.62px, 10.629px as 10.62px and 11.1111px as 11.11px: advances end 1 LU short, and the 10.629px glyph box is 10 px tall, not 11' }],
    nodes: [
      { branch: 'size-truncation', fixture: 'text-fractional-font-size', node: 'half:text0:line0' },
      { branch: 'size-truncation', fixture: 'text-fractional-font-size', node: 'q:text0:line1' },
      { branch: 'size-truncation', fixture: 'text-fractional-font-size', node: 'q2:text0:line0' },
    ],
  },
];

/** The platform rules per capture platform. A platform with no entry has no rules, and its measurer is refused (platform.ts). */
export const PLATFORM_RULES: ReadonlyMap<string, readonly PlatformRule[]> = new Map([['darwin-arm64', platformRules]]);
