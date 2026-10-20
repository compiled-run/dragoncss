// Chrome UA and root defaults keyed by capture platform (docs/api.md §10.1). A reference environment on a platform with no
// captured dataset is refused; it never borrows another platform's values.
import { REFERENCE_PLATFORM } from './reference-platform.ts';
import * as darwinArm64Dark from './chrome-145.darwin-arm64.dark.generated.ts';
import * as darwinArm64 from './chrome-145.darwin-arm64.generated.ts';
import type { CapturedTag, ElementKey, ReplacedKey } from './chrome-145.darwin-arm64.generated.ts';
import { UNSTYLED_TAGS } from '../analysis/elements.ts';
import { TEXT_FONT_LONGHANDS } from './uncaptured.ts';
export { TEXT_FONT_LONGHANDS, UNCAPTURED_LONGHANDS } from './uncaptured.ts';

export type { CapturedTag, ElementKey, ReplacedKey } from './chrome-145.darwin-arm64.generated.ts';

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
   * The font-weight and font-style a UA rule sets per tag, as html.css specifies them (UA_TEXT_FONT_RULES: bold, bolder, italic),
   * for the captured tags and the phrasing tags that read dragon-unstyled (b, strong, em, i). resolve.ts computes them like author
   * values; the capture holds them only as computed under the medium root, which a value relative to the parent cannot be read from.
   */
  readonly userAgentTextFonts: { readonly [T in CapturedTag]: TextFontRow } & { readonly [K in PhrasingKey]?: TextFontRow };
  /** Chrome's minimum logical font size in px, which clamps an em font size under the keyword-sized root. */
  readonly minimumLogicalFontSize: number;
  /**
   * html.css:1501-1505, a:-webkit-any-link { color: -webkit-link; text-decoration: underline }, as captured on a[href] (an a whose
   * href is unvisited: :visited never matches): the declared colour per direction and the decoration line.
   */
  readonly anyLink: { readonly color: { readonly ltr: string; readonly rtl: string }; readonly line: string };
  /** REPL-0: the replaced keys (iframe, img with a src), in tables of their own; uaRows reads them. */
  readonly replacedKeyComputed: { readonly [K in ReplacedKey]: { readonly [property: string]: string } };
  readonly replacedKeyLonghands: { readonly [K in ReplacedKey]: readonly string[] };
  readonly replacedKeyDeclared: { readonly [K in ReplacedKey]: DirRows };
  readonly replacedKeyContexts: { readonly [K in ReplacedKey]: readonly string[] };
  readonly replacedKeyTextFonts: { readonly [K in ReplacedKey]: { readonly [property: string]: string } };
  readonly replacedKeyForced: { readonly [K in ReplacedKey]: DirRows };
  /** ELB-2: the element keys (button, input, input[type=range], ...), in tables of their own; uaRows reads the control keys. */
  readonly elementKeyComputed: { readonly [K in ElementKey]: { readonly [property: string]: string } };
  readonly elementKeyLonghands: { readonly [K in ElementKey]: readonly string[] };
  readonly elementKeyDeclared: { readonly [K in ElementKey]: DirRows };
  readonly elementKeyContexts: { readonly [K in ElementKey]: readonly string[] };
  readonly elementKeyTextFonts: { readonly [K in ElementKey]: { readonly [property: string]: string } };
  /** ELB-2 userAgentForced for every captured key, by key name. */
  readonly userAgentForced: { readonly [key: string]: DirRows };
};

type TextFontRow = { readonly [property: string]: string };

/** The element keys of the form controls Dragon lays out (FORM-a). */
export type ControlKey = Extract<ElementKey, 'button' | 'input' | 'input[type=range]'>;

/** A row key of the UA dataset: a captured tag, a replaced key (REPL-0) or a control key (FORM-a). */
export type UaKey = CapturedTag | ReplacedKey | ControlKey;

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
  return key === 'iframe' || key === 'img[src]' || key === 'svg' || key === 'path' || key === 'rect' || key === 'circle';
}

function isControlKey(key: UaKey): key is ControlKey {
  return key === 'button' || key === 'input' || key === 'input[type=range]';
}

/**
 * A control key's rows. Its forced display (inline-block) is Chrome's html.css `display: inline-block` on the control, which the
 * ELB-2 reference records as forced because the reference's appearance adjustment hides it; an author display wins over it
 * (probed in Chrome 145, packages/parity/fixtures/controls-button-type.html and the range fixtures), so it is a declared UA value
 * here, and analysis/computed.ts applies the appearance adjustment itself. Its other forced rows (input's overflow: clip) stay
 * forced. A key without the display: inline-block row is an error.
 */
function controlRows(ua: UaDataset, key: ControlKey): UaRows {
  const forced = ua.userAgentForced[key];
  if (forced === undefined) throw new Error(`no forced rows for the ${key} key`);
  const rest = { ltr: { ...forced.ltr }, rtl: { ...forced.rtl } };
  for (const dir of ['ltr', 'rtl'] as const) {
    if (forced[dir]['display'] !== 'inline-block') throw new Error(`the ${key} key's forced rows are ${JSON.stringify(forced)}, without Chrome's display: inline-block`);
    delete rest[dir]['display'];
  }
  const declared = ua.elementKeyDeclared[key];
  return {
    computed: { ...ua.elementKeyComputed[key], display: 'inline-block' },
    longhands: [...ua.elementKeyLonghands[key], 'display'],
    declared: { ltr: { ...declared.ltr, display: 'inline-block' }, rtl: { ...declared.rtl, display: 'inline-block' } },
    contexts: ua.elementKeyContexts[key],
    textFonts: ua.elementKeyTextFonts[key],
    forced: rest,
  };
}

/** The UA rows of a key, from the element tables or the replaced-key tables. */
export function uaRows(ua: UaDataset, key: UaKey): UaRows {
  if (isControlKey(key)) return controlRows(ua, key);
  if (isReplacedKey(key)) {
    return { computed: ua.replacedKeyComputed[key], longhands: ua.replacedKeyLonghands[key], declared: ua.replacedKeyDeclared[key], contexts: ua.replacedKeyContexts[key], textFonts: ua.replacedKeyTextFonts[key], forced: ua.replacedKeyForced[key] };
  }
  return { computed: ua.computed[key], longhands: ua.userAgentLonghands[key], declared: ua.userAgentDeclared[key], contexts: ua.userAgentContexts[key], textFonts: ua.userAgentTextFonts[key], forced: NO_FORCED };
}

// In its own module so the capture scripts' platform check does not import the compiler and re-key on every profile change.
export { REFERENCE_PLATFORM } from './reference-platform.ts';

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
  const declared = ds.elementKeyDeclared['a[href]'];
  const line = ds.userAgentUnmodelled['a[href]']?.ltr['text-decoration-line'];
  if (declared.ltr['color'] === undefined || declared.rtl['color'] === undefined || line === undefined) throw new Error(`${ds.platform}: the a[href] capture has no color or text-decoration-line`);
  return { ...ds, userAgentTextFonts: Object.fromEntries(rows) as UaDataset['userAgentTextFonts'], anyLink: { color: { ltr: declared.ltr['color'], rtl: declared.rtl['color'] }, line } };
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
