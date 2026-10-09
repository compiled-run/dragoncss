// Chrome UA and root defaults keyed by capture platform (docs/api.md §10.1). A reference environment on a platform with no
// captured dataset is refused; it never borrows another platform's values.
import * as darwinArm64Dark from './chrome-145.darwin-arm64.dark.generated.ts';
import * as darwinArm64 from './chrome-145.darwin-arm64.generated.ts';
import type { CapturedTag } from './chrome-145.darwin-arm64.generated.ts';
import { UNSTYLED_TAGS } from '../analysis/elements.ts';
import { TEXT_FONT_LONGHANDS } from './uncaptured.ts';
export { TEXT_FONT_LONGHANDS, UNCAPTURED_LONGHANDS } from './uncaptured.ts';

export type { CapturedTag } from './chrome-145.darwin-arm64.generated.ts';

export type UaDataset = {
  readonly platform: string;
  readonly chromeVersion: string;
  readonly computed: { readonly [T in CapturedTag]: { readonly [property: string]: string } };
  readonly userAgentLonghands: { readonly [T in CapturedTag]: readonly string[] };
  readonly borderWidthKeywords: { readonly [keyword: string]: string };
  /** Declared UA values per tag and element direction: a captured value, or "<n>em" of the font size it is relative to. */
  readonly userAgentDeclared: { readonly [T in CapturedTag]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } };
  /** Ancestor tags under which a Chrome UA rule gives the tag values userAgentDeclared does not model. */
  readonly userAgentContexts: { readonly [T in CapturedTag]: readonly string[] };
  /**
   * The font-weight and font-style a UA rule sets per tag, as html.css specifies them (UA_TEXT_FONT_RULES: bold, bolder, italic),
   * for the captured tags and the phrasing tags that read dragon-unstyled (b, strong, em, i). resolve.ts computes them like author
   * values; the capture holds them only as computed under the medium root, which a value relative to the parent cannot be read from.
   */
  readonly userAgentTextFonts: { readonly [T in CapturedTag]: TextFontRow } & { readonly [K in PhrasingKey]?: TextFontRow };
  /** Chrome's minimum logical font size in px, which clamps an em font size under the keyword-sized root. */
  readonly minimumLogicalFontSize: number;
};

type TextFontRow = { readonly [property: string]: string };

/** The platform the committed Chrome references and the UA dataset were captured on. */
export const REFERENCE_PLATFORM = 'darwin-arm64';

/**
 * Chromium 145 html.css: h1 to h6 { font-weight: bold }, b and strong { font-weight: bolder }, address, em and i { font-style: italic }.
 * Each tag's properties must be exactly those of its captured row (checked when the dataset is built), and each value computes to
 * the captured one under the medium root (test/font-weight.test.ts).
 */
export const UA_TEXT_FONT_RULES: { readonly [tag: string]: TextFontRow } = {
  h1: { 'font-weight': 'bold' }, h2: { 'font-weight': 'bold' }, h3: { 'font-weight': 'bold' }, h4: { 'font-weight': 'bold' }, h5: { 'font-weight': 'bold' }, h6: { 'font-weight': 'bold' },
  b: { 'font-weight': 'bolder' }, strong: { 'font-weight': 'bolder' },
  address: { 'font-style': 'italic' }, em: { 'font-style': 'italic' }, i: { 'font-style': 'italic' },
};

/**
 * A captured dataset whose text-font table holds the specified html.css value of every captured tag's row and of every phrasing tag
 * that reads dragon-unstyled. A captured row that sets a property no rule above names (or the reverse) throws, so a new capture
 * cannot be read through a stale rule table.
 */
function withSpecifiedTextFonts(ds: typeof darwinArm64 | typeof darwinArm64Dark): UaDataset {
  const captured: [string, TextFontRow][] = [...Object.entries(ds.userAgentTextFonts), ...Object.entries(ds.phrasingKeyTextFonts).filter(([tag]) => UNSTYLED_TAGS.has(tag))];
  const rows = captured.map(([tag, row]): [string, TextFontRow] => {
    const rule = UA_TEXT_FONT_RULES[tag] ?? {};
    const keys = (r: TextFontRow): string => Object.keys(r).sort().join(',');
    if (keys(rule) !== keys(row) || Object.keys(row).some((p) => !(TEXT_FONT_LONGHANDS as readonly string[]).includes(p))) {
      throw new Error(`${ds.platform} ${tag}: the captured UA text font {${keys(row)}} does not match the html.css rule {${keys(rule)}}`);
    }
    return [tag, rule];
  });
  return { ...ds, userAgentTextFonts: Object.fromEntries(rows) as UaDataset['userAgentTextFonts'] };
}

const DATASETS: ReadonlyMap<string, UaDataset> = new Map([[darwinArm64.platform, withSpecifiedTextFonts(darwinArm64)]]);

/** The same capture under html{color-scheme:dark}, keyed by the same platforms. */
const DARK_DATASETS: ReadonlyMap<string, UaDataset> = new Map([[darwinArm64Dark.platform, withSpecifiedTextFonts(darwinArm64Dark)]]);

/** The text font a UA rule gives an element's tag (userAgentTextFonts); empty for a tag no such rule names. */
export function textFontsOf(ua: UaDataset, tag: string): TextFontRow {
  return (ua.userAgentTextFonts as { readonly [tag: string]: TextFontRow | undefined })[tag] ?? {};
}

export type UaDatasetChoice =
  | { readonly kind: 'ok'; readonly dataset: UaDataset }
  | { readonly kind: 'refused'; readonly code: 'no-ua-dataset'; readonly platform: string; readonly reason: string };

export function uaDatasetFor(platform: string): UaDatasetChoice {
  const dataset = DATASETS.get(platform);
  if (dataset === undefined) return { kind: 'refused', code: 'no-ua-dataset', platform, reason: `no Chrome UA dataset was captured on ${platform}; run pnpm run ua:capture there` };
  return { kind: 'ok', dataset };
}

/** The dark dataset (html{color-scheme:dark}) for a platform; refused like uaDatasetFor where none was captured. */
export function darkDatasetFor(platform: string): UaDatasetChoice {
  const dataset = DARK_DATASETS.get(platform);
  if (dataset === undefined) return { kind: 'refused', code: 'no-ua-dataset', platform, reason: `no dark Chrome UA dataset was captured on ${platform}; run pnpm run ua:capture there` };
  return { kind: 'ok', dataset };
}

/** The reference platform's dataset; it is always registered. */
export function referenceDataset(): UaDataset {
  const r = uaDatasetFor(REFERENCE_PLATFORM);
  if (r.kind !== 'ok') throw new Error(r.reason);
  return r.dataset;
}

/** Thrown by createProjectWith for a reference environment whose platform has no dataset. */
export class ReferencePlatformUnavailable extends Error {
  readonly code = 'no-ua-dataset';
  readonly platform: string;
  constructor(platform: string, reason: string) {
    super(reason);
    this.platform = platform;
  }
}

// INL-U: the phrasing keys (br, strong, b, em, i, code, small, sub, sup, label) and their font sizes, in tables of their own.
export type { PhrasingKey } from './chrome-145.darwin-arm64.generated.ts';

type PhrasingDirs = { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } };

/** The phrasing-key tables of one dataset; every table is keyed by PhrasingKey. */
export type PhrasingUaData = {
  readonly platform: string;
  readonly colorScheme: string;
  readonly phrasingKeySpecs: { readonly [K in PhrasingKey]: { readonly tag: string; readonly attributes: { readonly [name: string]: string } } };
  readonly phrasingKeyComputed: { readonly [K in PhrasingKey]: { readonly [property: string]: string } };
  readonly phrasingKeyLonghands: { readonly [K in PhrasingKey]: readonly string[] };
  /** A captured value, "<n>em", or a relative font-size keyword (smaller, larger). */
  readonly phrasingKeyDeclared: { readonly [K in PhrasingKey]: PhrasingDirs };
  readonly phrasingKeyContexts: { readonly [K in PhrasingKey]: readonly string[] };
  readonly phrasingKeyTextFonts: { readonly [K in PhrasingKey]: { readonly [property: string]: string } };
  readonly phrasingKeyUnmodelled: { readonly [K in PhrasingKey]: PhrasingDirs };
  readonly phrasingKeyForced: { readonly [K in PhrasingKey]: PhrasingDirs };
  /** Computed font-size per key, parent family and parent font-size. */
  readonly elementKeyFontSizes: { readonly [K in PhrasingKey]: { readonly [family: string]: { readonly [parentFontSize: string]: string } } };
};
type PhrasingKey = import('./chrome-145.darwin-arm64.generated.ts').PhrasingKey;

const PHRASING_DATA: ReadonlyMap<string, { readonly light: PhrasingUaData; readonly dark: PhrasingUaData }> = new Map([
  [darwinArm64.platform, { light: darwinArm64, dark: darwinArm64Dark }],
]);

export type PhrasingUaDataChoice =
  | { readonly kind: 'ok'; readonly data: PhrasingUaData }
  | { readonly kind: 'refused'; readonly code: 'no-ua-dataset'; readonly platform: string; readonly reason: string };

/** The phrasing-key tables for a platform and color scheme; refused like uaDatasetFor where none was captured. */
export function phrasingDataFor(platform: string, scheme: 'light' | 'dark' = 'light'): PhrasingUaDataChoice {
  const pair = PHRASING_DATA.get(platform);
  if (pair === undefined) return { kind: 'refused', code: 'no-ua-dataset', platform, reason: `no Chrome UA dataset with phrasing keys was captured on ${platform}; run pnpm run ua:capture there` };
  return { kind: 'ok', data: pair[scheme] };
}
