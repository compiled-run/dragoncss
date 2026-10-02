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
  ...[...TEXT_LATIN, ...TEXT_CALIBRATION].map((f) => [f.id, FONT_REFERENCE_MAP] as const),
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
