// The project font map: each generic family (and optionally a named platform family) is either pinned to bundled faces, which
// the web output also uses (exact), or left to the platform (caveat). A family that is neither declared with @font-face nor in the
// map is an unmapped-family result: Dragon never silently uses a font installed on the machine.
import { asciiLower, tokenize } from './css-tokens.ts';
import { GENERIC_FAMILY_KEYWORDS, parseDescriptor } from './font-face.ts';
import { serializeFamilyName, serializeString } from './family-list.ts';
import type { FamilyEntry, FamilyList } from './family-list.ts';
import { foldFamily } from './selection.ts';

export const GENERIC_KEYS = [
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
] as const;
export type GenericKey = (typeof GENERIC_KEYS)[number];

/** One bundled face of a pinned entry: its src (a relative asset URL or a data: URL) and optional descriptor text. */
export type PinnedFace = {
  readonly src: string;
  readonly weight?: string;
  readonly style?: string;
  readonly stretch?: string;
  readonly unicodeRange?: string;
};
export type FontMapEntry = { readonly mode: 'pinned'; readonly family: string; readonly faces: readonly PinnedFace[] } | { readonly mode: 'platform' };
export type FontMap = { readonly generics: { readonly [K in GenericKey]?: FontMapEntry }; readonly families?: { readonly [name: string]: FontMapEntry } };

export type FontMapError =
  | { readonly kind: 'unknown-generic'; readonly key: string }
  | { readonly kind: 'invalid-entry'; readonly key: string; readonly reason: string }
  | { readonly kind: 'invalid-face-descriptor'; readonly key: string; readonly descriptor: string; readonly text: string }
  | { readonly kind: 'pinned-family-conflict'; readonly family: string; readonly keys: readonly string[] };

export type SupportLabel = 'exact' | 'caveat';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates a font map given as untyped configuration; every problem is a typed error. */
export function validateFontMap(raw: unknown): { readonly ok: true; readonly map: FontMap } | { readonly ok: false; readonly errors: readonly FontMapError[] } {
  const errors: FontMapError[] = [];
  if (!isObj(raw) || !isObj(raw['generics']) || (raw['families'] !== undefined && !isObj(raw['families']))) {
    return { ok: false, errors: [{ kind: 'invalid-entry', key: '(map)', reason: 'a font map is { generics: {...}, families?: {...} }' }] };
  }
  const pinnedBy = new Map<string, string[]>();
  const check = (key: string, e: unknown): void => {
    if (!isObj(e) || (e['mode'] !== 'pinned' && e['mode'] !== 'platform')) {
      errors.push({ kind: 'invalid-entry', key, reason: 'mode must be "pinned" or "platform"' });
      return;
    }
    if (e['mode'] === 'platform') {
      if (Object.keys(e).length !== 1) errors.push({ kind: 'invalid-entry', key, reason: 'a platform entry has only mode' });
      return;
    }
    if (Object.keys(e).some((k) => !['mode', 'family', 'faces'].includes(k))) {
      errors.push({ kind: 'invalid-entry', key, reason: 'a pinned entry is exactly { mode, family, faces }' });
      return;
    }
    const family = e['family'];
    const faces = e['faces'];
    if (typeof family !== 'string' || family.length === 0) {
      errors.push({ kind: 'invalid-entry', key, reason: 'a pinned entry needs a non-empty family' });
      return;
    }
    if (!Array.isArray(faces) || faces.length === 0) {
      errors.push({ kind: 'invalid-entry', key, reason: 'a pinned entry needs at least one face' });
      return;
    }
    pinnedBy.set(family, [...(pinnedBy.get(family) ?? []), key]);
    for (const f of faces) {
      if (!isObj(f) || typeof f['src'] !== 'string' || Object.keys(f).some((k) => !['src', 'weight', 'style', 'stretch', 'unicodeRange'].includes(k))) {
        errors.push({ kind: 'invalid-entry', key, reason: 'a face is { src, weight?, style?, stretch?, unicodeRange? } with string values' });
        continue;
      }
      for (const [prop, descriptor] of [['weight', 'font-weight'], ['style', 'font-style'], ['stretch', 'font-stretch'], ['unicodeRange', 'unicode-range']] as const) {
        const text = f[prop];
        if (text === undefined) continue;
        if (typeof text !== 'string' || typeof parseDescriptor(descriptor, text) === 'symbol') errors.push({ kind: 'invalid-face-descriptor', key, descriptor, text: String(text) });
      }
    }
  };
  for (const [key, e] of Object.entries(raw['generics'])) {
    if (!(GENERIC_KEYS as readonly string[]).includes(key)) errors.push({ kind: 'unknown-generic', key });
    else check(key, e);
  }
  for (const [key, e] of Object.entries((raw['families'] ?? {}) as Record<string, unknown>)) check(key, e);
  // Two keys may share a pinned family only if they pin the same faces; otherwise the rewritten web CSS would be ambiguous.
  for (const [family, keys] of pinnedBy) {
    if (keys.length < 2) continue;
    const entries = keys.map((k) => JSON.stringify(((raw['generics'] as Record<string, unknown>)[k] ?? (raw['families'] as Record<string, unknown>)[k])));
    if (new Set(entries).size > 1) errors.push({ kind: 'pinned-family-conflict', family, keys });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, map: raw as unknown as FontMap };
}

/** The support label of a map entry. */
export const supportOf = (e: FontMapEntry): SupportLabel => (e.mode === 'pinned' ? 'exact' : 'caveat');

/** How one family-list entry resolves. */
export type EntryResolution =
  | { readonly kind: 'declared'; readonly family: string }
  | { readonly kind: 'pinned'; readonly key: string; readonly family: string; readonly support: 'exact' }
  | { readonly kind: 'platform'; readonly key: string; readonly support: 'caveat' }
  | { readonly kind: 'unmapped-family'; readonly entry: FamilyEntry };

export type RewriteResult = {
  /** The web font-family value: pinned generics and families replaced by their bundled family, quoted. */
  readonly value: string;
  /** The @font-face rules the web output must carry for the pinned entries used. */
  readonly fontFaceRules: readonly string[];
  readonly resolutions: readonly EntryResolution[];
};

/**
 * Rewrites a font-family list for web output. declared: the families declared with @font-face (matched case-insensitively, as
 * Blink's FontFaceCache does). Generic keywords only match declared families when quoted, so an unquoted generic goes to the map.
 * urlFor: the web URL of a pinned face's src (T005b decides where the bytes are emitted).
 */
export function rewriteFamilyList(list: FamilyList, map: FontMap, declared: ReadonlySet<string>, urlFor: (src: string) => string = (s) => s): RewriteResult {
  const out: string[] = [];
  const rules: string[] = [];
  const pinnedUsed = new Set<string>();
  const declaredFolded = new Set([...declared].map(foldFamily));
  const resolutions: EntryResolution[] = [];
  const use = (key: string, e: FontMapEntry, original: string): void => {
    if (e.mode === 'platform') {
      resolutions.push({ kind: 'platform', key, support: 'caveat' });
      out.push(original);
      return;
    }
    resolutions.push({ kind: 'pinned', key, family: e.family, support: 'exact' });
    out.push(serializeString(e.family));
    if (pinnedUsed.has(e.family)) return;
    pinnedUsed.add(e.family);
    for (const f of e.faces) rules.push(fontFaceRule(e.family, f, urlFor));
  };
  for (const entry of list) {
    if (entry.kind === 'generic') {
      const e = map.generics[entry.keyword as GenericKey];
      if (e === undefined) {
        resolutions.push({ kind: 'unmapped-family', entry });
        out.push(entry.keyword);
      } else use(entry.keyword, e, entry.keyword);
      continue;
    }
    const original = serializeFamilyName(entry.name);
    if (declaredFolded.has(foldFamily(entry.name))) {
      resolutions.push({ kind: 'declared', family: entry.name });
      out.push(original);
      continue;
    }
    // ui-serif, ui-monospace, emoji and the other newer generics are family names to Chrome 145's parser. A family entry named
    // like a parser generic (sans-serif...) was quoted, so it names a family, never the generic.
    const generic = (GENERIC_KEYS as readonly string[]).includes(entry.name) && isBareIdent(entry.name) && !isParserGeneric(entry.name) ? map.generics[entry.name as GenericKey] : undefined;
    const namedKey = Object.keys(map.families ?? {}).find((k) => foldFamily(k) === foldFamily(entry.name));
    const named = namedKey === undefined ? undefined : map.families?.[namedKey];
    const e = generic ?? named;
    if (e === undefined) {
      resolutions.push({ kind: 'unmapped-family', entry });
      out.push(original);
    } else use(entry.name, e, original);
  }
  return { value: out.join(', '), fontFaceRules: rules, resolutions };
}

const isParserGeneric = (name: string): boolean => (GENERIC_FAMILY_KEYWORDS as readonly string[]).includes(asciiLower(name));

const isBareIdent = (name: string): boolean => {
  const t = tokenize(name);
  return t.length === 1 && t[0]?.type === 'ident';
};

function fontFaceRule(family: string, f: PinnedFace, urlFor: (src: string) => string): string {
  const parts = [`font-family:${serializeString(family)}`, `src:url(${serializeString(urlFor(f.src))})`];
  if (f.weight !== undefined) parts.push(`font-weight:${f.weight}`);
  if (f.style !== undefined) parts.push(`font-style:${f.style}`);
  if (f.stretch !== undefined) parts.push(`font-stretch:${f.stretch}`);
  if (f.unicodeRange !== undefined) parts.push(`unicode-range:${f.unicodeRange}`);
  return `@font-face{${parts.join(';')}}`;
}
