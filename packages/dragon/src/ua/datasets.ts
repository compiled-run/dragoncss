// Chrome UA and root defaults keyed by capture platform (docs/api.md §10.1). A reference environment on a platform with no
// captured dataset is refused; it never borrows another platform's values.
import * as darwinArm64Dark from './chrome-145.darwin-arm64.dark.generated.ts';
import * as darwinArm64 from './chrome-145.darwin-arm64.generated.ts';
import type { CapturedTag, ReplacedKey } from './chrome-145.darwin-arm64.generated.ts';
import { UNSTYLED_TAGS } from '../analysis/elements.ts';

export type { CapturedTag, ReplacedKey } from './chrome-145.darwin-arm64.generated.ts';

type DirRows = { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } };

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
   * Inherited font properties a UA rule sets per tag that no longhand models (font-weight, font-style); the phrasing tags that read
   * dragon-unstyled (b, strong, em, i) carry their phrasingKeyTextFonts row, captured under a parent at the initial text font.
   */
  readonly userAgentTextFonts: { readonly [T in CapturedTag]: TextFontRow } & { readonly [K in PhrasingKey]?: TextFontRow };
  /** Chrome's minimum logical font size in px, which clamps an em font size under the keyword-sized root. */
  readonly minimumLogicalFontSize: number;
  /** REPL-0: the replaced keys (iframe, img with a src), in tables of their own; uaRows reads them. */
  readonly replacedKeyComputed: { readonly [K in ReplacedKey]: { readonly [property: string]: string } };
  readonly replacedKeyLonghands: { readonly [K in ReplacedKey]: readonly string[] };
  readonly replacedKeyDeclared: { readonly [K in ReplacedKey]: DirRows };
  readonly replacedKeyContexts: { readonly [K in ReplacedKey]: readonly string[] };
  readonly replacedKeyTextFonts: { readonly [K in ReplacedKey]: { readonly [property: string]: string } };
  readonly replacedKeyForced: { readonly [K in ReplacedKey]: DirRows };
};

type TextFontRow = { readonly [property: string]: string };

/** A row key of the UA dataset: a captured tag, or a replaced key (REPL-0). */
export type UaKey = CapturedTag | ReplacedKey;

/** The UA rows of one key. forced: values Chrome forces whatever the cascade says (ELB-2 userAgentForced); none for a captured tag. */
export type UaRows = {
  readonly computed: { readonly [property: string]: string };
  readonly longhands: readonly string[];
  readonly declared: DirRows;
  readonly contexts: readonly string[];
  readonly textFonts: { readonly [property: string]: string };
  readonly forced: DirRows;
};

const NO_FORCED: DirRows = { ltr: {}, rtl: {} };

function isReplacedKey(key: UaKey): key is ReplacedKey {
  return key === 'iframe' || key === 'img[src]';
}

/** The UA rows of a key, from the element tables or the replaced-key tables. */
export function uaRows(ua: UaDataset, key: UaKey): UaRows {
  if (isReplacedKey(key)) {
    return { computed: ua.replacedKeyComputed[key], longhands: ua.replacedKeyLonghands[key], declared: ua.replacedKeyDeclared[key], contexts: ua.replacedKeyContexts[key], textFonts: ua.replacedKeyTextFonts[key], forced: ua.replacedKeyForced[key] };
  }
  return { computed: ua.computed[key], longhands: ua.userAgentLonghands[key], declared: ua.userAgentDeclared[key], contexts: ua.userAgentContexts[key], textFonts: ua.userAgentTextFonts[key], forced: NO_FORCED };
}

/** The platform the committed Chrome references and the UA dataset were captured on. */
export const REFERENCE_PLATFORM = 'darwin-arm64';

/** A captured dataset whose text-font table also holds the phrasingKeyTextFonts row of every phrasing tag that reads dragon-unstyled. */
function withPhrasingTextFonts(ds: typeof darwinArm64 | typeof darwinArm64Dark): UaDataset {
  const rows = Object.entries(ds.phrasingKeyTextFonts).filter(([tag]) => UNSTYLED_TAGS.has(tag));
  return { ...ds, userAgentTextFonts: { ...ds.userAgentTextFonts, ...Object.fromEntries(rows) } };
}

const DATASETS: ReadonlyMap<string, UaDataset> = new Map([[darwinArm64.platform, withPhrasingTextFonts(darwinArm64)]]);

/** The same capture under html{color-scheme:dark}, keyed by the same platforms. */
const DARK_DATASETS: ReadonlyMap<string, UaDataset> = new Map([[darwinArm64Dark.platform, withPhrasingTextFonts(darwinArm64Dark)]]);

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
