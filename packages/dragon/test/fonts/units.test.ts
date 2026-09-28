// Unit proofs of the fonts module: typed refusals, the manifest digest, the font map, the unit-marked planted faults, and the
// part of selection only ties reach (Blink's hash-map order).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CssNode } from 'css-tree';
import { canonicalJson, sha256Hex } from '../../src/digest.ts';
import {
  bestSegmentedFace, buildManifest, faceMetrics, manifestDigestInput, parseFamilyList, parseFontFace, readSfnt, rewriteFamilyList,
  segmentedFaces, selectionRequest, validateFontMap, withFault,
} from '../../src/fonts/index.ts';
import type { DeclaredFace, FontAssetResolver, FontFaceResult, FontMap } from '../../src/fonts/index.ts';
import { atRules, capture, resolveFonts, vendorBytes } from './compare.ts';

const REGULAR = vendorBytes('Inter/Inter-Regular.ttf');
const faceOf = (css: string, resolve: FontAssetResolver = resolveFonts, faults = withFault('remoteUrlAccepted')): FontFaceResult =>
  parseFontFace(atRules(css)[0] as CssNode, 0, resolve, { ...faults, remoteUrlAccepted: false });
const results = (css: string, resolve: FontAssetResolver = resolveFonts, faults = { ...withFault('remoteUrlAccepted'), remoteUrlAccepted: false }): FontFaceResult[] =>
  atRules(css).map((n, i) => parseFontFace(n, i, resolve, faults));
const digestOf = (rs: readonly FontFaceResult[], faults = { ...withFault('remoteUrlAccepted'), remoteUrlAccepted: false }): string => {
  const m = buildManifest(rs, faults);
  if (!m.ok) throw new Error('no manifest');
  return sha256Hex(canonicalJson(manifestDigestInput(m.manifest)));
};
/** A copy of a font with one table tag renamed (the table stays; only its tag changes). */
function renameTable(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const out = new Uint8Array(bytes);
  const d = new DataView(out.buffer);
  for (let i = 0; i < d.getUint16(4); i++) {
    const r = 12 + i * 16;
    if (String.fromCharCode(...out.subarray(r, r + 4)) === from) for (let k = 0; k < 4; k++) out[r + k] = to.charCodeAt(k);
  }
  return out;
}

describe('sfnt', () => {
  it('reads every vendored font as static TrueType with its postScriptName', () => {
    for (const f of ['Inter/Inter-Light.ttf', 'Inter/Inter-Regular.ttf', 'Roboto/Roboto-Regular.ttf', 'NotoSans/NotoSans-Regular.ttf', 'NotoSansMono/NotoSansMono-Regular.ttf']) {
      const r = readSfnt(vendorBytes(f));
      expect(r.ok && !r.font.variable && r.font.outlines === 'truetype' && r.font.names.postScriptName === f.split('/')[1]?.replace('.ttf', '')).toBe(true);
    }
  });

  it('refuses WOFF, WOFF2 and collections as unsupported-container', () => {
    for (const [magic, container] of [['wOFF', 'woff'], ['wOF2', 'woff2'], ['ttcf', 'collection']] as const) {
      const bytes = new Uint8Array(REGULAR);
      for (let k = 0; k < 4; k++) bytes[k] = magic.charCodeAt(k);
      expect(readSfnt(bytes)).toEqual({ ok: false, refusal: { kind: 'unsupported-container', container } });
    }
  });

  it('refuses metrics of variable fonts and glyph bounds of CFF outlines', () => {
    const variable = readSfnt(renameTable(REGULAR, 'gasp', 'fvar'));
    const cff = readSfnt(renameTable(REGULAR, 'glyf', 'CFF '));
    if (!variable.ok || !cff.ok) throw new Error('unreadable');
    expect(faceMetrics(variable.font, 16, 1)).toEqual({ ok: false, refusal: { kind: 'variable-font' } });
    expect(cff.font.outlines).toBe('cff');
    expect(faceMetrics(cff.font, 16, 1)).toEqual({ ok: false, refusal: { kind: 'cff-bounds', glyph: cff.font.glyphForCodePoint(0x78) } });
  });
});

describe('@font-face src', () => {
  it('refuses remote URLs, local() fonts and unresolved assets with typed errors', () => {
    for (const [src, kind] of [['url(https://x.test/a.ttf)', 'remote-url'], ['url(//x.test/a.ttf)', 'remote-url'], ['url(file:///a.ttf)', 'remote-url'], ['local(Inter)', 'local-font'], ['url(missing.ttf)', 'unresolved-asset']] as const) {
      const r = faceOf(`@font-face{font-family:A;src:${src}, url("fonts/Inter/Inter-Regular.ttf")}`);
      expect(r.face?.source).toBeNull();
      expect(r.issues.map((i) => i.kind)).toContain(kind);
    }
  });

  it('decodes data: URLs as bundled bytes', () => {
    const b64 = Buffer.from(REGULAR).toString('base64');
    const r = faceOf(`@font-face{font-family:A;src:url("data:font/ttf;base64,${b64}")}`);
    expect(r.face?.source?.kind).toBe('data');
    expect(r.face?.source?.font.names.postScriptName).toBe('Inter-Regular');
  });

  it('never skips an unreadable first src (skipUnreadableSrc, unit fault)', () => {
    const woff2 = new Uint8Array(REGULAR);
    for (let k = 0; k < 4; k++) woff2[k] = 'wOF2'.charCodeAt(k);
    const resolve: FontAssetResolver = (s) => (s === 'a.woff2' ? { id: 'a', bytes: woff2 } : resolveFonts(s));
    const css = '@font-face{font-family:A;src:url(a.woff2) format("woff2"), url("fonts/Inter/Inter-Regular.ttf")}';
    const good = parseFontFace(atRules(css)[0] as CssNode, 0, resolve);
    expect(good.face?.source).toBeNull();
    expect(good.issues).toContainEqual({ kind: 'unreadable-font', url: 'a.woff2', refusal: { kind: 'unsupported-container', container: 'woff2' } });
    const faulted = parseFontFace(atRules(css)[0] as CssNode, 0, resolve, withFault('skipUnreadableSrc'));
    expect(faulted.face?.source?.font.names.postScriptName).toBe('Inter-Regular');
  });

  it('reports font-feature-settings and font-variation-settings as not applied, font-display as no effect', () => {
    const r = faceOf('@font-face{font-family:A;src:url("fonts/Inter/Inter-Regular.ttf");font-feature-settings:"liga" 0;font-variation-settings:"wght" 500;font-display:swap}');
    expect(r.issues.map((i) => i.kind)).toEqual(['descriptor-not-applied', 'descriptor-not-applied', 'no-effect']);
  });
});

describe('manifest', () => {
  const css = '@font-face{font-family:A;src:url("fonts/Inter/Inter-Regular.ttf")}\n@font-face{font-family:A;font-weight:700;src:url("fonts/Inter/Inter-Bold.ttf")}\n@font-face{font-family:B;src:url("fonts/Roboto/Roboto-Regular.ttf")}';
  const reordered = css.split('\n').reverse().join('\n');

  it('records family, descriptors, asset id, sha256 hash, postScriptName and table facts', () => {
    const m = buildManifest(results(css));
    if (!m.ok) throw new Error('no manifest');
    expect(m.manifest.faces).toHaveLength(3);
    const bold = m.manifest.faces.find((f) => f.postScriptName === 'Inter-Bold');
    expect(bold?.hash).toBe(`sha256:${capture<{ fonts: Record<string, string> }>('metrics.json').fonts['Inter/Inter-Bold.ttf']}`);
    expect(bold?.assetId).toBe('asset:fonts/Inter/Inter-Bold.ttf');
    expect(bold?.facts.unitsPerEm).toBe(2048);
    expect(bold?.descriptors).toEqual({ family: 'A', weight: { kind: 'numbers', values: [700] } });
  });

  it('changes the digest when one byte of a font changes', () => {
    const changed = new Uint8Array(vendorBytes('Roboto/Roboto-Regular.ttf'));
    changed[changed.length - 1] = (changed[changed.length - 1] as number) ^ 1;
    const resolve: FontAssetResolver = (s) => (s === 'fonts/Roboto/Roboto-Regular.ttf' ? { id: 'asset:fonts/Roboto/Roboto-Regular.ttf', bytes: changed } : resolveFonts(s));
    expect(digestOf(results(css, resolve))).not.toBe(digestOf(results(css)));
  });

  it('does not change the digest when the rules are reordered (manifestOrderSensitive, unit fault, does)', () => {
    expect(digestOf(results(reordered))).toBe(digestOf(results(css)));
    const f = withFault('manifestOrderSensitive');
    expect(digestOf(results(reordered, resolveFonts, f), f)).not.toBe(digestOf(results(css, resolveFonts, f), f));
  });

  it('never produces a manifest for a remote URL (remoteUrlAccepted, unit fault, does)', () => {
    const remote = `${css}\n@font-face{font-family:C;src:url(https://fonts.example/c.ttf)}`;
    expect(buildManifest(results(remote))).toEqual({ ok: false, errors: [{ kind: 'remote-url', url: 'https://fonts.example/c.ttf' }] });
    const f = withFault('remoteUrlAccepted');
    expect(buildManifest(atRules(remote).map((n, i) => parseFontFace(n, i, resolveFonts, f)), f).ok).toBe(true);
  });

  it('records the typed metrics refusal of a variable face', () => {
    const resolve: FontAssetResolver = (s) => (s === 'v.ttf' ? { id: 'v', bytes: renameTable(REGULAR, 'gasp', 'fvar') } : null);
    const m = buildManifest(results('@font-face{font-family:V;src:url(v.ttf)}', resolve));
    expect(m.ok && m.manifest.faces[0]?.metricsRefusal).toEqual({ kind: 'variable-font' });
  });
});

describe('font map', () => {
  const map: FontMap = {
    generics: { monospace: { mode: 'pinned', family: 'Dragon Mono', faces: [{ src: 'fonts/NotoSansMono/NotoSansMono-Regular.ttf' }] }, serif: { mode: 'platform' } },
    families: { Brand: { mode: 'platform' } },
  };

  it('validates entries with typed errors', () => {
    expect(validateFontMap(map).ok).toBe(true);
    const bad = validateFontMap({ generics: { mono: { mode: 'platform' }, serif: { mode: 'pinned', family: '', faces: [] }, cursive: { mode: 'pinned', family: 'X', faces: [{ src: 'a', weight: 'heavy' }] } } });
    expect(bad.ok ? [] : bad.errors.map((e) => e.kind)).toEqual(['unknown-generic', 'invalid-entry', 'invalid-face-descriptor']);
  });

  it('rewrites pinned entries, keeps platform ones as caveat, and types unmapped families', () => {
    const list = parseFamilyList('Declared, brand, serif, monospace, Unknown, cursive');
    if (list === null) throw new Error('list');
    const r = rewriteFamilyList(list, map, new Set(['declared']), (s) => `/assets/${s}`);
    expect(r.value).toBe('Declared, brand, serif, "Dragon Mono", Unknown, cursive');
    expect(r.fontFaceRules).toEqual(['@font-face{font-family:"Dragon Mono";src:url("/assets/fonts/NotoSansMono/NotoSansMono-Regular.ttf")}']);
    expect(r.resolutions.map((x) => x.kind)).toEqual(['declared', 'platform', 'platform', 'pinned', 'unmapped-family', 'unmapped-family']);
  });
});

describe('selection ties', () => {
  it('Blink hash-map order decides at least one captured request that declaration order would decide differently', () => {
    const cap = capture<{ cases: { css: string; requests: { family: string; weight: number; stretch: number; style: string }[] }[] }>('matching.json');
    let decisive = 0;
    for (const c of cap.cases) {
      const faces = atRules(c.css).map((n, i) => parseFontFace(n, i, resolveFonts).face).filter((f): f is DeclaredFace => f !== null);
      for (const r of c.requests) {
        if (r.style !== 'normal' && r.style !== 'italic') continue;
        const family = parseFamilyList(r.family)?.[0];
        if (family?.kind !== 'family') continue;
        const request = selectionRequest(r.weight, r.stretch, { kind: r.style });
        const hashed = segmentedFaces(faces, family.name);
        const declared = [...hashed].sort((a, b) => (a.faces[0]?.order ?? 0) - (b.faces[0]?.order ?? 0));
        if (bestSegmentedFace(hashed, request) !== bestSegmentedFace(declared, request)) decisive++;
      }
    }
    expect(decisive).toBeGreaterThan(0);
  });
});

describe('fonts module boundary', () => {
  it('has no node: imports (it runs in the compiler core)', () => {
    const dir = new URL('../../src/fonts/', import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8')).not.toMatch(/from ['"]node:|import\(['"]node:/);
  });
});
