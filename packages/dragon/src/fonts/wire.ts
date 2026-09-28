// The glue compile() calls to wire the fonts module in (T011, notes/T033-txt1c-wiring-spec.md §3): collect the @font-face rules,
// project the font map and manifest, key each font-family value by how it resolves, and build the web @font-face output.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { AtRuleContext } from '../css/at-rules.ts';
import { sha256HexBytes } from '../digest.ts';
import { asciiLower } from './css-tokens.ts';
import { descriptorText } from './cssom.ts';
import { DESCRIPTOR_NAMES, FONT_FACE_ERRORS, parseFontFace } from './font-face.ts';
import type { DeclaredFace, FontAssetResolver, FontFaceIssue, FontFaceResult } from './font-face.ts';
import { parseFamilyList, serializeString } from './family-list.ts';
import type { FamilyList } from './family-list.ts';
import { rewriteFamilyList, validateFontMap } from './font-map.ts';
import type { EntryResolution, FontMap, FontMapError, PinnedFace } from './font-map.ts';
import { buildManifest, manifestDigestInput } from './manifest.ts';
import type { FontManifest } from './manifest.ts';
import { foldFamily } from './selection.ts';

/** Where a font problem comes from: an authored @font-face rule, or one face of a pinned font map entry. */
export type FontProblemSource =
  | { readonly kind: 'rule'; readonly context: AtRuleContext; readonly order: number }
  | { readonly kind: 'map'; readonly key: string; readonly face: number };

/** Every font problem of the wiring, typed. Phase B maps each to a diagnostic code. */
export type FontWireProblem =
  /** blocking: the issue stops a build (FONT_FACE_ERRORS); the diagnostic catalogue decides the code and severity. */
  | { readonly kind: 'font-face'; readonly blocking: boolean; readonly source: FontProblemSource; readonly issue: FontFaceIssue }
  | { readonly kind: 'font-map-invalid'; readonly error: FontMapError }
  | { readonly kind: 'pinned-family-declared'; readonly family: string; readonly keys: readonly string[] }
  | { readonly kind: 'face-not-in-manifest'; readonly family: string; readonly hash: string };

export const FONT_WIRE_PROBLEM_KINDS: readonly FontWireProblem['kind'][] = ['font-face', 'font-map-invalid', 'pinned-family-declared', 'face-not-in-manifest'];

/** An asset of the source snapshot, as SourceSnapshot.assets holds it. */
export type SnapshotAsset = { readonly id: string; readonly hash: string; readonly bytes: Uint8Array };

export type CollectedFontFaces = { readonly results: readonly FontFaceResult[]; readonly problems: readonly FontWireProblem[] };

/**
 * Parses the accepted @font-face at-rules in document order with font-face.ts. resolveUrl maps a relative src URL to its snapshot
 * asset. Contexts of any other at-rule are skipped.
 */
export function collectFontFaces(contexts: readonly AtRuleContext[], resolveUrl: FontAssetResolver): CollectedFontFaces {
  const results: FontFaceResult[] = [];
  const problems: FontWireProblem[] = [];
  for (const context of contexts) {
    if (asciiLower(context.name) !== 'font-face') continue;
    const order = results.length;
    const result = parseFontFace(context.node, order, resolveUrl);
    results.push(result);
    for (const issue of result.issues) problems.push({ kind: 'font-face', blocking: FONT_FACE_ERRORS.has(issue.kind), source: { kind: 'rule', context, order }, issue });
  }
  return { results, problems };
}

/** One face of a pinned map entry, parsed like an authored @font-face rule of the pinned family. */
export type PinnedFaceResult = { readonly key: string; readonly family: string; readonly index: number; readonly result: FontFaceResult };

export type ProjectedFonts = {
  /** The validated map, or null when the project has none or it is invalid. */
  readonly map: FontMap | null;
  /** The manifest of the authored and pinned faces, or null when a face has a build error or the map is invalid. */
  readonly manifest: FontManifest | null;
  /** The value added to the compilation digest; null when there are no faces and no map. */
  readonly digestInput: unknown;
  readonly pinned: readonly PinnedFaceResult[];
  readonly problems: readonly FontWireProblem[];
};

/** The CSS text of a pinned face as an @font-face rule; src is a snapshot asset id or a data: URL. */
export function pinnedFaceCss(family: string, f: PinnedFace): string {
  const parts = [`font-family:${serializeString(family)}`, `src:url(${serializeString(f.src)})`];
  if (f.weight !== undefined) parts.push(`font-weight:${f.weight}`);
  if (f.style !== undefined) parts.push(`font-style:${f.style}`);
  if (f.stretch !== undefined) parts.push(`font-stretch:${f.stretch}`);
  if (f.unicodeRange !== undefined) parts.push(`unicode-range:${f.unicodeRange}`);
  return `@font-face{${parts.join(';')}}`;
}

const atRuleNode = (css: string): CssNode => {
  const sheet = parse(css, { positions: false, parseValue: true }) as unknown as { children: { toArray(): CssNode[] } };
  const node = sheet.children.toArray()[0];
  if (node === undefined || node.type !== 'Atrule') throw new Error(`not an at-rule: ${css}`);
  return node;
};

/**
 * Validates the project font map, parses every pinned face (its src is a snapshot asset id or a data: URL; anything else is
 * unresolved-asset), and builds the manifest of the authored and pinned faces. rawMap is the untyped config value (undefined: none).
 */
export function projectFonts(rawMap: unknown, faces: readonly FontFaceResult[], assets: readonly SnapshotAsset[]): ProjectedFonts {
  const problems: FontWireProblem[] = [];
  let map: FontMap | null = null;
  let mapInvalid = false;
  if (rawMap !== undefined) {
    const v = validateFontMap(rawMap);
    if (v.ok) map = v.map;
    else {
      mapInvalid = true;
      for (const error of v.errors) problems.push({ kind: 'font-map-invalid', error });
    }
  }
  const byId = new Map(assets.map((a) => [a.id, a]));
  const resolveId: FontAssetResolver = (specifier) => {
    const a = byId.get(specifier);
    return a === undefined ? null : { id: a.id, bytes: a.bytes };
  };
  const pinned: PinnedFaceResult[] = [];
  const pinnedKeys = new Map<string, string[]>();
  if (map !== null) {
    const entries = [...Object.entries(map.generics), ...Object.entries(map.families ?? {})];
    const seen = new Set<string>();
    for (const [key, e] of entries) {
      if (e === undefined || e.mode !== 'pinned') continue;
      pinnedKeys.set(e.family, [...(pinnedKeys.get(e.family) ?? []), key]);
      // Keys that share a pinned family pin the same faces (validateFontMap), so each family's faces are parsed once.
      if (seen.has(e.family)) continue;
      seen.add(e.family);
      e.faces.forEach((f, index) => {
        const result = parseFontFace(atRuleNode(pinnedFaceCss(e.family, f)), index, resolveId);
        pinned.push({ key, family: e.family, index, result });
        for (const issue of result.issues) problems.push({ kind: 'font-face', blocking: FONT_FACE_ERRORS.has(issue.kind), source: { kind: 'map', key, face: index }, issue });
      });
    }
  }
  // An authored family with a pinned family's name would merge with the pinned faces in the rewritten web CSS.
  const declared = new Set(faces.flatMap((r) => (r.face === null ? [] : [foldFamily(r.face.family)])));
  for (const [family, keys] of [...pinnedKeys].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (declared.has(foldFamily(family))) problems.push({ kind: 'pinned-family-declared', family, keys });
  }
  const built = mapInvalid ? null : buildManifest([...faces, ...pinned.map((p) => p.result)]);
  const manifest = built !== null && built.ok ? built.manifest : null;
  const empty = faces.length === 0 && rawMap === undefined;
  return { map, manifest, digestInput: empty || manifest === null ? null : manifestDigestInput(manifest), pinned, problems };
}

/** The resolution kind of a font-family value, as its support-profile feature key. It never contains an author family name. */
export type FamilyFeatureKey = 'font-family:<pinned>' | 'font-family:<declared>' | 'font-family:<platform>' | 'font-family:<unmapped>';

export type FamilySupport =
  | { readonly kind: 'resolved'; readonly list: FamilyList; readonly resolutions: readonly EntryResolution[]; readonly key: FamilyFeatureKey }
  | { readonly kind: 'invalid' };

/** The key is the least supported kind in the list: an unmapped entry is a build error, a platform entry is caveat. */
const KEY_RANK: readonly EntryResolution['kind'][] = ['unmapped-family', 'platform', 'declared', 'pinned'];
const KEY_OF: { readonly [K in EntryResolution['kind']]: FamilyFeatureKey } = {
  'unmapped-family': 'font-family:<unmapped>',
  platform: 'font-family:<platform>',
  declared: 'font-family:<declared>',
  pinned: 'font-family:<pinned>',
};

/**
 * How a font-family value resolves against the map and the declared families. Null for the single family Ahem, whose existing
 * font-family:Ahem feature key is kept.
 */
export function familySupport(listText: string, map: FontMap | null, declared: ReadonlySet<string>): FamilySupport | null {
  const list = parseFamilyList(listText);
  if (list === null) return { kind: 'invalid' };
  const only = list[0];
  if (list.length === 1 && only?.kind === 'family' && foldFamily(only.name) === foldFamily('Ahem')) return null;
  const { resolutions } = rewriteFamilyList(list, map ?? { generics: {} }, declared);
  const worst = KEY_RANK.find((k) => resolutions.some((r) => r.kind === k)) ?? 'unmapped-family';
  return { kind: 'resolved', list, resolutions, key: KEY_OF[worst] };
}

/** A web output asset: the bundled font bytes, written at path beside dragon.css. */
export type WebFontAsset = { readonly path: string; readonly hash: string; readonly bytes: Uint8Array };
export type WebFontOutput = { readonly css: string; readonly assets: readonly WebFontAsset[]; readonly problems: readonly FontWireProblem[] };

/** The file extension of an sfnt by its version tag. */
function extensionOf(bytes: Uint8Array): string {
  const tag = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  return tag === 'OTTO' ? 'otf' : 'ttf';
}

/** The pinned faces of the given pinned families, in map order. */
export function pinnedFacesOf(projected: ProjectedFonts, families: ReadonlySet<string>): DeclaredFace[] {
  return projected.pinned.flatMap((p) => (families.has(p.family) && p.result.face !== null ? [p.result.face] : []));
}

/**
 * The web @font-face rules and their assets: the used pinned faces in map order, then every accepted authored face in declaration
 * order (the order Chrome's ties depend on). Each src is url("fonts/<sha256-hex-16>.<ext>"); the assets are sorted by path.
 */
export function webFontOutput(usedPinned: readonly DeclaredFace[], declaredFaces: readonly DeclaredFace[], manifest: FontManifest): WebFontOutput {
  const inManifest = new Set(manifest.faces.map((f) => f.hash));
  const assets = new Map<string, WebFontAsset>();
  const problems: FontWireProblem[] = [];
  const rules: string[] = [];
  for (const face of [...usedPinned, ...[...declaredFaces].sort((a, b) => a.order - b.order)]) {
    if (face.source === null) continue;
    const hex = sha256HexBytes(face.source.bytes);
    const hash = `sha256:${hex}`;
    if (!inManifest.has(hash)) problems.push({ kind: 'face-not-in-manifest', family: face.family, hash });
    const path = `fonts/${hex.slice(0, 16)}.${extensionOf(face.source.bytes)}`;
    assets.set(path, { path, hash, bytes: face.source.bytes });
    const parts = [`font-family:${serializeString(face.family)}`, `src:url(${serializeString(path)})`];
    for (const name of DESCRIPTOR_NAMES) {
      if (name === 'font-family' || name === 'src') continue;
      const text = descriptorText(face.descriptors, name);
      if (text !== '') parts.push(`${name}:${text}`);
    }
    rules.push(`@font-face{${parts.join(';')}}`);
  }
  const sorted = [...assets.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { css: rules.join('\n'), assets: sorted, problems };
}
