// Fixture group fonts (TXT1-C, notes/T033-txt1c-wiring-spec.md §3 B8). The rejects join the parity corpus. The layout fixtures are
// web-only (FONT_FIXTURES): native targets refuse every font but Ahem until TXT1a, so they run the chrome-dual lane alone
// (fonts-run.ts), at 400x300 in both directions with Chrome's UA root font. Pinned generics compare against the stated reference
// (font-reference.ts); declared @font-face families and the platform-mode system-ui render natively in both documents.
// Dragon has no font-weight or font-style longhand yet, so the weights and styles come from the UA: h1 to h3 are bold, address
// is italic. Light (300) cannot be reached.
import { createHash } from 'node:crypto';
import type { FontMap, FrontEndResult } from 'dragon';
import type { FixtureSpec } from '../fixtures.ts';
import { FONT_REFERENCE_MAP, VENDOR_FONTS, vendorFontBytes } from '../font-reference.ts';
import { layout, reject } from './define.ts';
import { TEXT_CALIBRATION } from './text-calibration.ts';
import { INLINE_TAGS } from './inline-tags.ts';
import { TEXT_WEIGHT } from './text-weight.ts';
import { FONT_SHORTHAND } from './font-shorthand.ts';
import { TEXT_LATIN } from './text-latin.ts';

/** A web-only fonts fixture: its font map (null: none), and the face Chrome must render each element's text with in both documents. */
export type FontFixture = {
  readonly spec: FixtureSpec;
  readonly map: FontMap | null;
  /** data-dragon-id to postScriptName; 'platform' is a face that is not a web font, the same in both documents. */
  readonly faces: { readonly [id: string]: string };
};

const font = (id: string, map: FontMap | null, faces: FontFixture['faces']): FontFixture => ({ spec: layout(id, ['ltr', 'rtl'], 'ua-default'), map, faces });

export const FONT_FIXTURES: readonly FontFixture[] = [
  font('fonts-pinned-sans', FONT_REFERENCE_MAP, { regular: 'Inter-Regular', bold: 'Inter-Bold', italic: 'Inter-Italic', 'bold-italic': 'Inter-BoldItalic' }),
  font('fonts-pinned-mono', FONT_REFERENCE_MAP, { mono: 'NotoSansMono-Regular', both: 'NotoSansMono-Regular' }),
  font('fonts-lato', FONT_REFERENCE_MAP, { regular: 'Lato-Regular', bold: 'Lato-Bold', italic: 'Lato-Regular' }),
  font('fonts-declared', null, { regular: 'Roboto-Regular', bold: 'Inter-Bold' }),
  font('fonts-platform', FONT_REFERENCE_MAP, { text: 'platform' }),
  // T133: em and i over Lato, which has no italic face (synthetic oblique, refused on native), and i inside b (Lato-Bold).
  font('fonts-tags', FONT_REFERENCE_MAP, { regular: 'Lato-Regular', em: 'Lato-Regular', i: 'Lato-Regular', b: 'Lato-Bold', bi: 'Lato-Bold' }),
  // TXT-W1: synthesized text, which native refuses (DRAGON_SYNTHETIC_FONT_STYLE); Chrome draws the base face, emboldened or skewed.
  font('fonts-weight-synthetic', FONT_REFERENCE_MAP, { lit: 'Lato-Regular', lo20: 'Lato-Regular', lbi: 'Lato-Bold', mb: 'NotoSansMono-Regular', m600: 'NotoSansMono-Regular', mi: 'NotoSansMono-Regular' }),
  // TDEC-a: decorated text, drawn on web only until TDEC-b; decoration-capture.ts proves the decoration pixels against Chrome.
  font('text-decoration-lines', FONT_REFERENCE_MAP, Object.fromEntries([...['l1', 'l2', 'l3', 'l4', 't1', 't2', 't3', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'c1', 'c2', 's1'].map((id) => [id, 'Lato-Regular']), ['i1', 'Inter-Regular'], ['i2', 'Inter-Bold']])),
  font('text-decoration-boxes', FONT_REFERENCE_MAP, Object.fromEntries(['b1a', 'b1b', 'b2a', 'b2b', 'b2c', 'b3a', 'b3b', 'b4a', 'b4b', 'b5c', 'b5b'].map((id) => [id, 'Lato-Regular']))),
  font('text-decoration-wrap', FONT_REFERENCE_MAP, { w: 'Lato-Regular' }),
  font('text-decoration-north-star', FONT_REFERENCE_MAP, { yt: 'Lato-Regular', gp: 'Lato-Regular' }),
  font('text-decoration-ahem', FONT_REFERENCE_MAP, { a1: 'Ahem', a2: 'Ahem', a3: 'Ahem' }),
  // The skip-ink probe: Ahem's glyph boxes cross an auto underline, so the engine refuses it (skip-ink-intercepts, TDEC-d).
  font('text-decoration-ahem-auto', FONT_REFERENCE_MAP, { a: 'Ahem' }),
];

/** An invalid map: a pinned entry with no faces. */
const INVALID_MAP = { generics: { 'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [] } } } as unknown as FontMap;

export const FONTS: readonly FixtureSpec[] = [
  reject('reject-fonts-unmapped', 'DRAGON_FONT_UNMAPPED_FAMILY', "'Nope', sans-serif", 'font-family: "Nope",sans-serif: the family "Nope" is neither declared'),
  reject('reject-fonts-quoted-generic', 'DRAGON_FONT_UNMAPPED_FAMILY', '"sans-serif"', 'font-family: "sans-serif": the family "sans-serif" is neither declared'),
  reject('reject-fonts-remote-url', 'DRAGON_FONT_REMOTE_URL', '@font-face { font-family: Remote; src: url("https://example.com/remote.ttf"); }', '@font-face 1: src url(https://example.com/remote.ttf) is a remote URL'),
  reject('reject-fonts-local', 'DRAGON_FONT_LOCAL', '@font-face { font-family: Local; src: local("Inter"); }', '@font-face 1: src local(Inter) names an installed font'),
  reject('reject-fonts-unresolved-asset', 'DRAGON_FONT_UNRESOLVED_ASSET', '@font-face { font-family: Missing; src: url("missing.ttf"); }', '@font-face 1: src url(missing.ttf) does not resolve'),
  reject('reject-fonts-map-invalid', 'DRAGON_FONT_MAP_INVALID', null, 'fonts entry sans-serif: a pinned entry needs at least one face'),
];

const MAPS: ReadonlyMap<string, FontMap> = new Map([
  ...FONT_FIXTURES.flatMap((f) => (f.map === null ? [] : [[f.spec.id, f.map] as const])),
  ['reject-fonts-quoted-generic', FONT_REFERENCE_MAP],
  ['reject-fonts-map-invalid', INVALID_MAP],
  // TXT1a-2: the real-font FIXTURES groups compile with the reference map.
  ...[...TEXT_LATIN, ...TEXT_CALIBRATION, ...INLINE_TAGS.filter((f) => f.kind === 'layout'), ...TEXT_WEIGHT.filter((f) => f.kind === 'layout'), ...FONT_SHORTHAND.filter((f) => f.kind === 'layout')].map((f) => [f.id, FONT_REFERENCE_MAP] as const),
]);

/** The font map a fixture compiles with; undefined for every fixture outside this group. */
export const fontMapOf = (id: string): FontMap | undefined => MAPS.get(id);

/** The input with every pinned face of the map whose src names a vendored font added as a snapshot asset (once each). */
export function withFontMapAssets(input: FrontEndResult, map: FontMap): FrontEndResult {
  const srcs = [...Object.values(map.generics), ...Object.values(map.families ?? {})].flatMap((e) => (e !== undefined && e.mode === 'pinned' && Array.isArray(e.faces) ? e.faces.map((f) => f.src) : []));
  const have = new Set(input.snapshot.assets.map((a) => a.id));
  const added = [...new Set(srcs)].filter((src) => src.startsWith(VENDOR_FONTS) && !have.has(src)).map((id) => {
    const bytes = new Uint8Array(vendorFontBytes(id.slice(VENDOR_FONTS.length)));
    return { id, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes };
  });
  return added.length === 0 ? input : { ...input, snapshot: { ...input.snapshot, assets: [...input.snapshot.assets, ...added] } };
}
