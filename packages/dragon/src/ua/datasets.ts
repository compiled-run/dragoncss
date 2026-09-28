// Chrome UA and root defaults keyed by capture platform (docs/api.md §10.1). A reference environment on a platform with no
// captured dataset is refused; it never borrows another platform's values.
import * as darwinArm64Dark from './chrome-145.darwin-arm64.dark.generated.ts';
import * as darwinArm64 from './chrome-145.darwin-arm64.generated.ts';
import type { CapturedTag } from './chrome-145.darwin-arm64.generated.ts';

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
  /** Inherited font properties a UA rule sets per tag that no longhand models (font-weight, font-style). */
  readonly userAgentTextFonts: { readonly [T in CapturedTag]: { readonly [property: string]: string } };
  /** Chrome's minimum logical font size in px, which clamps an em font size under the keyword-sized root. */
  readonly minimumLogicalFontSize: number;
};

/** The platform the committed Chrome references and the UA dataset were captured on. */
export const REFERENCE_PLATFORM = 'darwin-arm64';

const DATASETS: ReadonlyMap<string, UaDataset> = new Map([[darwinArm64.platform, darwinArm64]]);

/** The same capture under html{color-scheme:dark}, keyed by the same platforms. */
const DARK_DATASETS: ReadonlyMap<string, UaDataset> = new Map([[darwinArm64Dark.platform, darwinArm64Dark]]);

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
