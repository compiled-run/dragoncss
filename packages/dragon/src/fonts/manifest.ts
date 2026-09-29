// The bundled-font manifest: one entry per face Dragon renders from bundled bytes, hashed like analysis/input.ts hashes assets,
// in a canonical order so that it does not depend on the order of the @font-face rules. It enters the compilation digest (T005b).
import { canonicalJson, sha256HexBytes } from '../digest.ts';
import { FONT_FACE_ERRORS } from './font-face.ts';
import type { FontFaceIssue, FontFaceResult } from './font-face.ts';
import { NO_FONT_FAULTS } from './faults.ts';
import type { FontFaults } from './faults.ts';
import type { SfntRefusal, TableFacts } from './sfnt.ts';
import { metricsRefusal } from './sfnt.ts';

export type ManifestEntry = {
  readonly family: string;
  /** The declared descriptors except src (the bytes stand for it). */
  readonly descriptors: { readonly [name: string]: unknown };
  /** The snapshot asset id, or null for a data: URL. */
  readonly assetId: string | null;
  /** sha256:<hex> of the bytes. */
  readonly hash: string;
  readonly byteLength: number;
  readonly postScriptName: string | null;
  readonly facts: TableFacts;
  /** Why metrics cannot be computed for this face yet (variable fonts, TXT1b), or null. */
  readonly metricsRefusal: SfntRefusal | null;
};

export type FontManifest = { readonly version: 1; readonly faces: readonly ManifestEntry[] };

export type ManifestResult =
  | { readonly ok: true; readonly manifest: FontManifest }
  | { readonly ok: false; readonly errors: readonly FontFaceIssue[] };

const byCanonical = (a: unknown, b: unknown): number => {
  const x = canonicalJson(a);
  const y = canonicalJson(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Builds the manifest of the parsed @font-face rules. Any build error (a remote URL, a local() font...) means no manifest. */
export function buildManifest(results: readonly FontFaceResult[], faults: FontFaults = NO_FONT_FAULTS): ManifestResult {
  const errors = results.flatMap((r) => r.issues.filter((i) => FONT_FACE_ERRORS.has(i.kind)));
  if (errors.length > 0) return { ok: false, errors };
  const faces: ManifestEntry[] = [];
  for (const r of results) {
    const face = r.face;
    if (face === null || face.source === null) continue;
    const { src: _src, ...descriptors } = face.descriptors;
    faces.push({
      family: face.family,
      descriptors,
      assetId: face.source.kind === 'asset' ? face.source.assetId : null,
      hash: `sha256:${sha256HexBytes(face.source.bytes)}`,
      byteLength: face.source.bytes.length,
      postScriptName: face.source.font.names.postScriptName,
      facts: face.source.font.facts(),
      metricsRefusal: metricsRefusal(face.source.font),
    });
  }
  return { ok: true, manifest: { version: 1, faces: faults.manifestOrderSensitive ? faces : [...faces].sort(byCanonical) } };
}

/** The exact value T005b adds to analyze()'s digest object, under the key fonts. */
export function manifestDigestInput(manifest: FontManifest): unknown {
  return JSON.parse(canonicalJson(manifest)) as unknown;
}
