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
    rule: 'Ascent and descent are Core Text\'s 16.16 fraction of the em times the size, rounded to the nearest whole px with halves up (units.ts roundCoreTextMetricToWholePx); Ahem\'s 200/1000 quantises below 0.2, so an exact half px Ahem descent rounds down, as roundFontMetricToWholePx gives up to 662.5 px.',
    source: 'Traced (notes/T082-txt1s.md §1, docs/research/text-spike/metric-rounding): CTFontGetAscent and CTFontGetDescent through Skia\'s call sequence return (round(units * 65536 / upem) * upem / 65536) * (size / upem) for Ahem, 5 Inter and 2 Lato faces at every size from 0.01 to 192 px in hundredths (0 mismatches), Skia stores it as a float, and third_party/blink/renderer/platform/fonts/font_metrics.cc at 145.0.7632.6 rounds it with SkScalarRoundToScalar (floorf(x + 0.5f), lines 111-112); Chrome matches on all 129 probed rows at DPR 1, 2, 2.625 and 3. Lines 114-126 move 1 px from ascent to descent on Linux, ChromeOS, Android and Fuchsia, which this rule does not claim.',
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

/** A node whose exact zoomed-LU match with Chrome at dpr depends on a DPR platform rule. */
export type DprPlatformRuleNode = { readonly fixture: string; readonly node: string; readonly dpr: number };

/** A platform rule that only shows at a device pixel ratio other than 1, with the nodes that distinguish it at that ratio. */
export type DprPlatformRule = {
  readonly id: string;
  readonly platform: 'darwin-arm64';
  readonly rule: string;
  readonly source: string;
  readonly fault: 'viewportUnitsUnceiled';
  readonly nodes: readonly DprPlatformRuleNode[];
};

/**
 * R6 (V1 of the value model, notes/T006-value-model-spec.md): Blink sizes the viewport, and so the initial containing block (R1), in
 * whole device px, and viewport units read that size over the zoom. At a ratio where w * z is not whole, vw and vh are not the CSS
 * viewport over 100. The DPR-1 registry above cannot hold it: at DPR 1 both readings agree.
 */
export const dprPlatformRules: readonly DprPlatformRule[] = [
  {
    id: 'viewport-device-ceil',
    platform: 'darwin-arm64',
    rule: 'Viewport units read float(ceil(w * z) / z) CSS px (units.ts viewportUnitBase): at 2.625 a 300px viewport is 788 / 2.625 px for vh, not 300.',
    source: 'third_party/blink/renderer/core/frame/local_frame_view.cc lines 893-907 at 145.0.7632.6 (SmallViewportSizeForViewportUnits: ViewWidth(kIncludeScrollbars), whole device px, over the float zoom, into a gfx::SizeF), core/layout/layout_view.cc lines 909-931 (SubtractUnconditionalScrollbarsFromViewportUnits, nothing to subtract with hidden scrollbars) and core/css/css_length_resolver.cc ZoomedComputedPixels (value * ViewportWidthPercent() * Zoom()). Measured on the Chrome 145 oracle (values-viewport-units at DPR 2.625).',
    fault: 'viewportUnitsUnceiled',
    nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((node): DprPlatformRuleNode => ({ fixture: 'values-viewport-units', node, dpr: 2.625 })),
  },
];
