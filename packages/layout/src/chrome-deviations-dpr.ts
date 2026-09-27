// Chrome deviations that only show at a device pixel ratio other than 1 (notes/T010-p2-triage.md ruling 1, owner decision D1). At
// DPR 1 the spec reading and Chrome agree, so the DPR-1 registry (chrome-deviations.ts) and its "distinguished at DPR 1" check
// cannot hold them. The shape is the same as chrome-deviations.ts, plus the pixel ratio of every node and control. Every node must
// match Chrome exactly in zoomed LU (1/64 device px) at its DPR, every declared branch needs at least one node, and the planted
// spec-reading fault (EngineFaults) makes every registered node non-exact. blink cites the source at 145.0.7632.6.

export type DprDeviationFault = 'initialLineWidthZoomed';

/** A node whose exact zoomed-LU match with Chrome at dpr distinguishes Blink from the spec text on one branch. */
export type DprDeviationNode = { readonly branch: string; readonly fixture: string; readonly node: string; readonly dpr: number };

/** An exact node on which Chrome and the spec reading agree: it keeps its rect relative to relativeTo under the spec fault. */
export type DprDeviationControl = { readonly fixture: string; readonly node: string; readonly dpr: number; readonly relativeTo: string; readonly reason: string };

export type DprDeviationBranch = { readonly id: string; readonly description: string };

export type DprChromeDeviation = {
  readonly id: string;
  readonly specSection: string;
  readonly spec: string;
  /** The Blink behaviour, citing file and lines at 145.0.7632.6. */
  readonly blink: string;
  /** The planted engine fault that applies the spec reading. */
  readonly fault: DprDeviationFault;
  /** How the engine models the Chrome behaviour. */
  readonly model: string;
  readonly branches: readonly DprDeviationBranch[];
  readonly nodes: readonly DprDeviationNode[];
  readonly controls: readonly DprDeviationControl[];
};

/** The pixel ratios the DPR registry proves nodes at: the shared ratios and the Android extra (packages/parity/src/dpr.ts). */
const RATIOS: readonly number[] = [2, 3, 2.625];

/** The nodes of one branch at every registered pixel ratio. */
function atRatios(branch: string, fixture: string, nodes: readonly string[]): DprDeviationNode[] {
  const out: DprDeviationNode[] = [];
  for (const dpr of RATIOS) for (const node of nodes) out.push({ branch, fixture, node, dpr });
  return out;
}

/** Controls of one fixture at every registered pixel ratio. */
function controlsAt(fixture: string, nodes: readonly string[], relativeTo: string, reason: string): DprDeviationControl[] {
  const out: DprDeviationControl[] = [];
  for (const dpr of RATIOS) for (const node of nodes) out.push({ fixture, node, dpr, relativeTo, reason });
  return out;
}

export const dprChromeDeviations: readonly DprChromeDeviation[] = [
  {
    id: 'initial-line-width-unzoomed',
    specSection: 'css-backgrounds-3 §3.3 (border-width: initial medium, computed as an absolute length)',
    spec: 'The initial border width is medium, which computes to an absolute length (3 CSS px in Chrome), so at DPR N it is 3N device px, like an authored medium or 3px.',
    blink:
      'third_party/blink/renderer/core/css/css_properties.json5 lines 2626-2650 at 145.0.7632.6: border-top-width has default_value "3" (type_name int, converter ConvertBorderWidth, affected_by_zoom); outline-width (line 4477) is the same. core/css/resolver/style_builder_converter.cc lines 1961-1994: thin, medium and thick (1, 3, 5) and lengths go through CssToLengthConversionData().ZoomedComputedPixels, then floor. The initial value never passes through the converter, so the stored 3 is already in zoomed px: 3 device px at every pixel ratio (probed: 3 / 3 / 3 / 3 device px at DPR 1 / 2 / 3 / 2.625, getComputedStyle 3px, 1.5px, 1px, 1.14286px).',
    fault: 'initialLineWidthZoomed',
    model: 'R5: the compiler lowers a border width that is initial by provenance to { kind: "device-px", value } with value from the UA dataset medium keyword; zoomInput does not multiply it.',
    branches: [
      { id: 'no-width-declared', description: 'a border style is declared and no border width: the initial width stays 3 device px' },
      { id: 'shorthand-omitted', description: 'a border shorthand omits the width, which it resets to the initial value: 3 device px' },
    ],
    nodes: [
      ...atRatios('no-width-declared', 'border-initial-width', ['i1', 'i4a']),
      ...atRatios('no-width-declared', 'color-border-sides', ['long']),
      ...atRatios('shorthand-omitted', 'border-initial-width', ['i2', 'i3', 'i4']),
    ],
    controls: [
      ...controlsAt('border-initial-width', ['a1', 'a2', 'a3', 'a4'], 'body', 'an authored medium, thin, thick or 3px width is a CSS length that Chrome zooms, as the spec reading does; the controls come first, so nothing above them moves'),
      { fixture: 'border-initial-width', node: 'i1', dpr: 1, relativeTo: 'body', reason: 'at DPR 1 a device px is a CSS px, so both readings give 3px' },
      { fixture: 'border-initial-width', node: 'i4a', dpr: 1, relativeTo: 'body', reason: 'at DPR 1 a device px is a CSS px, so both readings give 3px' },
      { fixture: 'color-border-sides', node: 'long', dpr: 1, relativeTo: 'body', reason: 'at DPR 1 a device px is a CSS px, so both readings give 3px' },
    ],
  },
];
