// Chrome UA and root defaults keyed by capture platform (docs/api.md §10.1). A reference environment on a platform with no
// captured dataset is refused; it never borrows another platform's values.
import * as darwinArm64 from './chrome-145.darwin-arm64.generated.ts';
import type { CapturedTag } from './chrome-145.darwin-arm64.generated.ts';

export type { CapturedTag } from './chrome-145.darwin-arm64.generated.ts';

export type UaDataset = {
  readonly platform: string;
  readonly chromeVersion: string;
  readonly computed: { readonly [T in CapturedTag]: { readonly [property: string]: string } };
  readonly userAgentLonghands: { readonly [T in CapturedTag]: readonly string[] };
  readonly borderWidthKeywords: { readonly [keyword: string]: string };
};

/** The platform the committed Chrome references and the UA dataset were captured on. */
export const REFERENCE_PLATFORM = 'darwin-arm64';

const DATASETS: ReadonlyMap<string, UaDataset> = new Map([[darwinArm64.platform, darwinArm64]]);

export type UaDatasetChoice =
  | { readonly kind: 'ok'; readonly dataset: UaDataset }
  | { readonly kind: 'refused'; readonly code: 'no-ua-dataset'; readonly platform: string; readonly reason: string };

export function uaDatasetFor(platform: string): UaDatasetChoice {
  const dataset = DATASETS.get(platform);
  if (dataset === undefined) return { kind: 'refused', code: 'no-ua-dataset', platform, reason: `no Chrome UA dataset was captured on ${platform}; run pnpm run ua:capture there` };
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
