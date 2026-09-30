// TXT1-C Phase B (notes/T033-txt1c-wiring-spec.md §3 B1-B7): @font-face accepted and collected, the font map in the project
// configuration, the font manifest in the digest, font-family keyed by how it resolves, unmapped families refused for every target,
// the web output rewritten through the map with its @font-face prelude and font assets, and the four planted compiler faults.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Compiled, FontMap, FrontEndResult, TreeNode } from '../src/index.ts';
import { createProject, querySupport } from '../src/index.ts';
import type { CompilerFaults } from '../src/internal.ts';
import { compiledFeatures, createProjectWith, iosProfile, NO_FAULTS, WEB_CSS_PATH, webProfile } from '../src/internal.ts';
import { featureOf } from '../src/css/values.ts';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { parseFontFace } from '../src/fonts/font-face.ts';
import type { DeclaredFace } from '../src/fonts/font-face.ts';
import { selectionRequest } from '../src/fonts/selection.ts';
import { renderedFaces } from '../src/fonts/wire.ts';
import { div, DOC, inputFor, text } from './helpers.ts';

const vendor = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../vendor/fonts/${file}`, import.meta.url)));
const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const INTER_VF = new Uint8Array(readFileSync(new URL('../../../docs/research/text-spike/fonts/Inter-VF.ttf', import.meta.url)));
const FILES: Record<string, Uint8Array> = {
  'fonts/Inter-Regular.ttf': vendor('Inter/Inter-Regular.ttf'),
  'fonts/Inter-Bold.ttf': vendor('Inter/Inter-Bold.ttf'),
  'fonts/NotoSansMono-Regular.ttf': vendor('NotoSansMono/NotoSansMono-Regular.ttf'),
  'fonts/Lato-Regular.ttf': vendor('Lato/Lato-Regular.ttf'),
  'fonts/Inter-VF.ttf': INTER_VF,
};
const MAP: FontMap = {
  generics: {
    'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [{ src: 'fonts/Inter-Regular.ttf', weight: '400' }, { src: 'fonts/Inter-Bold.ttf', weight: '700' }] },
    monospace: { mode: 'pinned', family: 'Dragon Mono', faces: [{ src: 'fonts/NotoSansMono-Regular.ttf' }] },
    'system-ui': { mode: 'platform' },
  },
  families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: 'fonts/Lato-Regular.ttf', weight: '400' }] } },
};

/** A one-text-node document whose snapshot carries the font files as assets; each src specifier resolves from the stylesheet. */
function fontInput(css: string, opts: { files?: Record<string, Uint8Array>; urls?: readonly string[]; body?: TreeNode[]; text?: string } = {}): FrontEndResult {
  const base = inputFor(css, (r) => opts.body ?? [div(r, 'a', ['a'], [text(r, 't', opts.text ?? 'Ab')])]);
  const files = opts.files ?? FILES;
  const ref = base.snapshot.sources[0]?.ref;
  if (ref === undefined) throw new Error('no source');
  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      assets: Object.entries(files).map(([id, bytes]) => ({ id, hash: `sha256:${hex(bytes)}`, bytes })),
      resolutions: (opts.urls ?? []).map((specifier) => ({ from: ref, specifier, kind: 'asset' as const, to: specifier })),
    },
  };
}

type Web = 'web';
const compileWith = (input: FrontEndResult, fonts: FontMap | undefined, faults: Partial<CompilerFaults> = {}, targets: object = { web: {} }): Compiled<Web> =>
  createProjectWith({ projectId: 'test', targets: targets as { web: {} }, ...(fonts === undefined ? {} : { fonts }) }, { faults: { ...NO_FAULTS, ...faults }, profiles: 'derive', direction: 'ltr' }).compile(input) as Compiled<Web>;
const cssOf = (c: Compiled<Web>): string => {
  if (c.outputs.web.kind !== 'ready') throw new Error(`web ${c.outputs.web.kind}: ${c.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  return c.outputs.web.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? '';
};
const codes = (c: Compiled<Web>): string[] => c.diagnostics.map((d) => `${d.code}${d.target === null ? '' : ` [${d.target}]`}`);
const webFeatures = (c: Compiled<Web>): readonly string[] => compiledFeatures(c, 'web', []).filter((k) => k.startsWith('font-family:'));

describe('the font map in the project configuration', () => {
  it('fonts is an accepted configuration key; each problem of an invalid map is DRAGON_FONT_MAP_INVALID', () => {
    const input = fontInput('');
    expect(codes(compileWith(input, MAP))).toEqual([]);
    const bad = { generics: { 'sans-serif': { mode: 'pinned', family: '', faces: [] }, nope: { mode: 'platform' } } } as unknown as FontMap;
    const c = compileWith(input, bad);
    expect(codes(c)).toEqual(['DRAGON_FONT_MAP_INVALID', 'DRAGON_FONT_MAP_INVALID']);
    expect(c.diagnostics.map((d) => d.message)).toEqual(['fonts entry sans-serif: a pinned entry needs a non-empty family', 'fonts.generics.nope is not a generic family (the generics are serif, sans-serif, monospace, cursive, fantasy, system-ui, ui-serif, ui-sans-serif, ui-monospace, ui-rounded, math, emoji, fangsong)']);
    expect(c.outputs.web.kind).toBe('blocked');
    expect(codes(compileWith(input, 42 as unknown as FontMap))).toEqual(['DRAGON_FONT_MAP_INVALID']);
    const extra = { generics: { monospace: { mode: 'pinned', family: 'M', faces: [{ src: 'fonts/NotoSansMono-Regular.ttf' }], fallback: 'x' } } } as unknown as FontMap;
    expect(compileWith(input, extra).diagnostics.map((d) => d.message)).toEqual(['fonts entry monospace: a pinned entry is exactly { mode, family, faces }']);
  });

  it('a pinned face whose src is neither a snapshot asset nor a data: URL is DRAGON_FONT_UNRESOLVED_ASSET', () => {
    const c = compileWith(fontInput('', { files: {} }), { generics: { monospace: { mode: 'pinned', family: 'M', faces: [{ src: 'fonts/missing.ttf' }] } } });
    expect(codes(c)).toEqual(['DRAGON_FONT_UNRESOLVED_ASSET']);
    expect(c.diagnostics[0]?.origin).toEqual({ kind: 'unlocated', reason: 'configuration fonts entry monospace, face 0' });
  });

  it('an @font-face family that a map entry pins is DRAGON_FONT_MAP_INVALID', () => {
    const c = compileWith(fontInput('@font-face { font-family: "dragon sans"; src: url(fonts/Inter-Regular.ttf) }', { urls: ['fonts/Inter-Regular.ttf'] }), MAP);
    expect(codes(c)).toEqual(['DRAGON_FONT_MAP_INVALID']);
    expect(c.diagnostics[0]?.message).toMatch(/pin the family "Dragon Sans", which an @font-face rule also declares/);
  });
});

describe('font-family resolution', () => {
  it('an unmapped family or generic is DRAGON_FONT_UNMAPPED_FAMILY for every target, located at the value, with a fix naming the map and @font-face', () => {
    const c = compileWith(fontInput(".a { font-family: 'Nope', cursive }"), MAP, {}, { web: {}, ios: { minimum: '15.0' } });
    expect(codes(c)).toEqual(['DRAGON_FONT_UNMAPPED_FAMILY', 'DRAGON_FONT_UNMAPPED_FAMILY']);
    expect(c.diagnostics.map((d) => d.message)).toEqual([
      'font-family: "Nope",cursive: the family "Nope" is neither declared with @font-face nor in the font map, so it would be a font installed on the machine',
      'font-family: "Nope",cursive: the generic cursive is neither declared with @font-face nor in the font map, so it would be a font installed on the machine',
    ]);
    const fixes = c.diagnostics.map((d) => (d.fix !== null && 'manual' in d.fix ? d.fix.manual : ''));
    expect(fixes[0]).toMatch(/@font-face/);
    expect(fixes[1]).toMatch(/Dragon Sans/);
    expect(c.outputs.web.kind).toBe('blocked');
    expect(c.targets).toEqual({ web: 'blocked', ios: 'blocked' });
  });

  it('a font-family holding var() is checked after substitution', () => {
    const c = compileWith(fontInput('.a { --f: Nope; font-family: var(--f) }'), MAP);
    expect(codes(c)).toContain('DRAGON_FONT_UNMAPPED_FAMILY');
    expect(c.diagnostics.find((d) => d.code === 'DRAGON_FONT_UNMAPPED_FAMILY')?.message).toMatch(/^font-family: var\(--f\) \(substituted: "Nope"\): the family "Nope"/);
  });

  it('with no font map every generic is unmapped: there is no built-in default', () => {
    expect(codes(compileWith(fontInput('.a { font-family: sans-serif }'), undefined))).toEqual(['DRAGON_FONT_UNMAPPED_FAMILY']);
  });

  it('a quoted generic name ("sans-serif") names a family, never the pinned generic', () => {
    const c = compileWith(fontInput('.a { font-family: "sans-serif" }'), MAP);
    expect(codes(c)).toEqual(['DRAGON_FONT_UNMAPPED_FAMILY']);
    expect(c.diagnostics[0]?.message).toMatch(/the family "sans-serif"/);
  });

  it('keys font-family by resolution kind and never by an author family name; the single family Ahem keeps font-family:Ahem', () => {
    const at = '@text-in-block/ltr';
    const key = (css: string): readonly string[] => webFeatures(compileWith(fontInput(`@font-face { font-family: Mine; src: url(fonts/Inter-Regular.ttf) } ${css}`, { urls: ['fonts/Inter-Regular.ttf'] }), MAP));
    expect(key('.a { font-family: sans-serif }')).toEqual([`font-family:<pinned>${at}`]);
    expect(key(".a { font-family: 'Lato', sans-serif }")).toEqual([`font-family:<pinned>${at}`]);
    expect(key('.a { font-family: Mine, monospace }')).toEqual([`font-family:<declared>${at}`]);
    expect(key('.a { font-family: system-ui }')).toEqual([`font-family:<platform>${at}`]);
    expect(key('.a { font-family: Ahem }')).toEqual([`font-family:Ahem${at}`]);
    expect(key('.a { font-family: "Ahem" }')).toEqual([`font-family:Ahem${at}`]);
    expect(featureOf('font-family', { kind: 'other', type: 'family-list', text: 'sans-serif' })).toBe('font-family:<family-list>');
  });

  it('checkValues reports an unmapped family only as DRAGON_FONT_UNMAPPED_FAMILY, not also as DRAGON_UNSUPPORTED_VALUE', () => {
    const c = createProject({ projectId: 'test', targets: { web: {} }, fonts: MAP }).compile(fontInput('.a { font-family: Nope }'));
    expect(codes(c as Compiled<Web>)).toEqual(['DRAGON_FONT_UNMAPPED_FAMILY']);
  });

  it('without a web row the pinned key is unsupported; resolved support queries read the font key the case used', () => {
    const input = fontInput('.a { font-family: sans-serif }');
    const without = { ...webProfile, rows: webProfile.rows.filter((r) => r.feature !== 'font-family:<pinned>') };
    const blocked = createProjectWith({ projectId: 'test', targets: { web: {} }, fonts: MAP }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles: { web: without, ios: iosProfile } }).compile(input);
    expect(blocked.diagnostics.map((d) => [d.code, d.profile?.feature])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'font-family:<pinned>']]);
    const row = { feature: 'font-family:<pinned>', context: 'text-in-block/ltr', status: 'exact' as const, proofs: [] };
    const web = { ...without, rows: [...without.rows, row] };
    const c = createProjectWith({ projectId: 'test', targets: { web: {} }, fonts: MAP }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles: { web, ios: iosProfile } }).compile(input);
    expect(c.diagnostics).toEqual([]);
    const answer = querySupport({ kind: 'resolved', result: c, target: 'web', instance: DOC, node: 'a', property: 'font-family', assignment: [] });
    expect(answer.kind === 'decided' && answer.cases.map((x) => x.decision?.feature)).toEqual(['font-family:<pinned>']);
  });

  it('a font-family holding var() is keyed after substitution by how it resolves, so an enforced profile accepts a pinned generic', () => {
    const row = { feature: 'font-family:<pinned>', context: 'text-in-block/ltr', status: 'exact' as const, proofs: [] };
    const web = { ...webProfile, rows: [...webProfile.rows.filter((r) => r.feature !== 'font-family:<pinned>'), row] };
    const c = createProjectWith({ projectId: 'test', targets: { web: {} }, fonts: MAP }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles: { web, ios: iosProfile } }).compile(fontInput('.a { --f: sans-serif; font-family: var(--f) }'));
    expect(c.diagnostics).toEqual([]);
  });
});

describe('@font-face rules', () => {
  const faceCodes = (css: string, urls: readonly string[] = []): string[] => codes(compileWith(fontInput(css, { urls }), MAP));
  it('each refused source and descriptor has its own code', () => {
    expect(faceCodes('@font-face { font-family: F; src: url(https://example.com/f.ttf) }')).toEqual(['DRAGON_FONT_REMOTE_URL']);
    expect(faceCodes('@font-face { font-family: F; src: local(Inter) }')).toEqual(['DRAGON_FONT_LOCAL']);
    expect(faceCodes('@font-face { font-family: F; src: url(fonts/nowhere.ttf) }')).toEqual(['DRAGON_FONT_UNRESOLVED_ASSET']);
    expect(faceCodes('@font-face { font-family: F; src: url(data:font/ttf;base64,AAAA) }')).toEqual(['DRAGON_FONT_UNREADABLE']);
    expect(faceCodes('@font-face { font-family: F; src: url(fonts/Inter-Regular.ttf); font-weight: calc(300 + 100) }', ['fonts/Inter-Regular.ttf'])).toEqual(['DRAGON_FONT_UNSUPPORTED_DESCRIPTOR']);
    expect(faceCodes('@font-face { font-family: F; src: url(fonts/Inter-Regular.ttf); font-feature-settings: "liga" 0 }', ['fonts/Inter-Regular.ttf'])).toEqual(['DRAGON_FONT_DESCRIPTOR_NOT_APPLIED']);
    expect(faceCodes('@font-face { font-family: F; src: url(fonts/Inter-Regular.ttf); font-weight: heavy }', ['fonts/Inter-Regular.ttf'])).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(faceCodes('@font-face { src: url(fonts/Inter-Regular.ttf) }', ['fonts/Inter-Regular.ttf'])).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
  it('the descriptor-not-applied warning does not block the web output', () => {
    const c = compileWith(fontInput('@font-face { font-family: F; src: url(fonts/Inter-Regular.ttf); font-feature-settings: "liga" 0 } .a { font-family: F }', { urls: ['fonts/Inter-Regular.ttf'] }), undefined);
    expect(c.diagnostics.map((d) => [d.code, d.severity])).toEqual([['DRAGON_FONT_DESCRIPTOR_NOT_APPLIED', 'warning']]);
    expect(cssOf(c)).toMatch(/font-feature-settings:"liga" 0/);
  });
  it('a comment between @font-face and its block, a preserved /*! */ one included, leaves the prelude empty', () => {
    const face = (between: string): string => `@font-face${between}{ font-family: F; src: url(fonts/Inter-Regular.ttf) } .a { font-family: F }`;
    for (const between of ['/*! license */ ', ' /* a */ /*! b */ ', '\n/*!x*/\n']) expect(faceCodes(face(between), ['fonts/Inter-Regular.ttf'])).toEqual([]);
    expect(faceCodes(face(' /*! license */ x '), ['fonts/Inter-Regular.ttf'])).toEqual(['DRAGON_UNSUPPORTED_AT_RULE', 'DRAGON_FONT_UNMAPPED_FAMILY']);
  });
  it('an @font-face nested in a rule or inside another at-rule keeps the milestone-1 refusal', () => {
    expect(faceCodes('.a { @font-face { font-family: F; src: url(x.ttf) } }')).toEqual(['DRAGON_UNSUPPORTED_AT_RULE']);
  });
});

describe('the variable-font fence at style resolution (T028)', () => {
  const css = (size: number): string => `@font-face { font-family: V; src: url(fonts/Inter-VF.ttf) } .a { font-family: V; font-size: ${size}px }`;
  it('Inter VF is refused where the text size puts opsz outside the validated 14 to 24', () => {
    const c = compileWith(fontInput(css(28), { urls: ['fonts/Inter-VF.ttf'] }), undefined);
    expect(codes(c)).toEqual(['DRAGON_FONT_VARIABLE_REFUSED']);
    expect(c.diagnostics[0]?.message).toBe('font-family V at 28px on a:text0: InterVF opsz 14, 28 is outside the validated range 14 to 24');
  });
  it('and accepted at 16px', () => {
    expect(codes(compileWith(fontInput(css(16), { urls: ['fonts/Inter-VF.ttf'] }), undefined))).toEqual([]);
  });
  it('UA bold text (h1) selects the wght 700 instance, which is refused, while the same face at 400 in a div is accepted', () => {
    const body = (h1: boolean) => (r: Parameters<typeof div>[0]): TreeNode[] => [{ ...div(r, 'a', ['a'], [text(r, 't', 'Ab')]), tag: h1 ? 'h1' : 'div' }];
    const at = (h1: boolean) => {
      const base = fontInput(css(16), { urls: ['fonts/Inter-VF.ttf'] });
      const shaped = inputFor(css(16), body(h1));
      return compileWith({ ...shaped, snapshot: base.snapshot }, undefined);
    };
    expect(codes(at(false))).toEqual([]);
    const refused = at(true).diagnostics.filter((d) => d.code === 'DRAGON_FONT_VARIABLE_REFUSED');
    expect(refused.map((d) => [d.target, d.message])).toEqual([[null, 'font-family V at 16px on a:text0: InterVF wght 400, 700 is outside the validated range 400 to 400']]);
  });
  it('fences only the faces Chrome draws the text with: a later family counts for the characters the earlier ones lack', () => {
    const faces = '@font-face { font-family: S; src: url(fonts/Lato-Regular.ttf) } @font-face { font-family: V; src: url(fonts/Inter-VF.ttf) }';
    const at = (family: string, chars: string) => compileWith(fontInput(`${faces} .a { font-family: ${family}; font-size: 28px }`, { urls: ['fonts/Lato-Regular.ttf', 'fonts/Inter-VF.ttf'], text: chars }), undefined);
    expect(codes(at('S, V', 'Ab'))).toEqual([]);
    // Lato has no U+2713, so Chrome draws it with V.
    expect(at('S, V', 'A\u2713').diagnostics.map((d) => d.message)).toEqual(['font-family V at 28px on a:text0: InterVF opsz 14, 28 is outside the validated range 14 to 24']);
    expect(codes(at('V, S', 'Ab'))).toEqual(['DRAGON_FONT_VARIABLE_REFUSED']);
  });
  it('a tab or segment break counts as a space: a later face whose cmap maps U+000A is not drawn for it', () => {
    const face = (family: string, file: string): DeclaredFace => {
      const node = (parse(`@font-face { font-family: ${family}; src: url(${file}) }`) as CssNode & { children: { first: CssNode | null } }).children.first;
      const f = node === null ? null : parseFontFace(node, 0, (u) => ({ id: u, bytes: FILES[u] as Uint8Array })).face;
      if (f === null || f === undefined || f.source === null) throw new Error(`no face for ${file}`);
      return f;
    };
    const s = face('S', 'fonts/Lato-Regular.ttf');
    const v0 = face('V', 'fonts/Inter-VF.ttf');
    const src = v0.source as NonNullable<DeclaredFace['source']>;
    // Some fonts map control characters; this V maps U+000A, U+0009 and U+000D, which Lato does not.
    const v = { ...v0, source: { ...src, font: { ...src.font, glyphForCodePoint: (cp: number) => ([9, 10, 13].includes(cp) ? 1 : src.font.glyphForCodePoint(cp)) } } };
    const drawn = (t: string) => renderedFaces([s, v], [{ kind: 'declared', family: 'S' }, { kind: 'declared', family: 'V' }], t, selectionRequest(400, 100, { kind: 'normal' })).map((x) => x.family);
    expect(drawn('A\n\tb\r')).toEqual(['S']);
    expect(drawn('A\u2713')).toEqual(['S', 'V']);
  });
});

describe('the web output with fonts', () => {
  const input = fontInput('@font-face { font-family: Mine; src: url(fonts/Lato-Regular.ttf); font-weight: 400 } .a { font-family: sans-serif } .b { font-family: Mine, sans-serif }', {
    urls: ['fonts/Lato-Regular.ttf'],
    body: [],
  });
  const withBody = (i: FrontEndResult): FrontEndResult => {
    const ref = i.snapshot.sources[0]?.ref;
    if (ref === undefined) throw new Error('no source');
    const html = i.tree?.components[0]?.root[0];
    if (html === undefined || html.kind !== 'element') throw new Error('no html');
    const body = html.children[0];
    if (body === undefined || body.kind !== 'element') throw new Error('no body');
    const nodes = [div(ref, 'a', ['a'], [text(ref, 't', 'Ab')]), div(ref, 'b', ['b'], [text(ref, 'u', 'Ab')])];
    const tree = i.tree as NonNullable<FrontEndResult['tree']>;
    return { ...i, tree: { ...tree, components: [{ ...(tree.components[0] as (typeof tree.components)[number]), root: [{ ...html, children: [{ ...body, children: nodes }] }] }] } };
  };
  const full = withBody(input);

  it('pinned generics become their family, and the @font-face rules of the used pinned faces and every declared face follow the header', () => {
    const c = compileWith(full, MAP);
    const css = cssOf(c);
    const [header, ...rest] = css.split('\n');
    expect(header).toMatch(/^\/\* Generated by Dragon from compilation [0-9a-f]{64}\. Do not edit\. \*\/$/);
    const inter = hex(FILES['fonts/Inter-Regular.ttf'] as Uint8Array).slice(0, 16);
    const bold = hex(FILES['fonts/Inter-Bold.ttf'] as Uint8Array).slice(0, 16);
    const lato = hex(FILES['fonts/Lato-Regular.ttf'] as Uint8Array).slice(0, 16);
    expect(rest.slice(0, 3)).toEqual([
      `@font-face{font-family:"Dragon Sans";src:url("fonts/${inter}.ttf");font-weight:400}`,
      `@font-face{font-family:"Dragon Sans";src:url("fonts/${bold}.ttf");font-weight:700}`,
      `@font-face{font-family:"Mine";src:url("fonts/${lato}.ttf");font-weight:400}`,
    ]);
    expect(css).toMatch(/font-family: "Dragon Sans";/);
    expect(css).toMatch(/font-family: Mine, "Dragon Sans";/);
    expect(css).not.toMatch(/Dragon Mono/);
    if (c.outputs.web.kind !== 'ready') throw new Error('blocked');
    expect(c.outputs.web.assets.map((a) => [a.path, a.hash])).toEqual([
      [`fonts/${bold}.ttf`, `sha256:${hex(FILES['fonts/Inter-Bold.ttf'] as Uint8Array)}`],
      [`fonts/${inter}.ttf`, `sha256:${hex(FILES['fonts/Inter-Regular.ttf'] as Uint8Array)}`],
      [`fonts/${lato}.ttf`, `sha256:${hex(FILES['fonts/Lato-Regular.ttf'] as Uint8Array)}`],
    ].sort());
    for (const a of c.outputs.web.assets) expect(`sha256:${hex(a.bytes)}`).toBe(a.hash);
    expect(webFeatures(c)).toEqual(['font-family:<declared>@text-in-block/ltr', 'font-family:<pinned>@text-in-block/ltr']);
  });

  it('a project with no fonts has no @font-face, no assets and no fonts key in its digest', () => {
    const plain = inputFor('.a { font-family: Ahem }', (r) => [div(r, 'a', ['a'], [text(r, 't', 'Ab')])]);
    const c = compileWith(plain, undefined);
    const off = compileWith(plain, undefined, { fontManifestOutOfDigest: true });
    expect(cssOf(c)).not.toMatch(/@font-face/);
    expect(c.outputs.web.kind === 'ready' && c.outputs.web.assets).toEqual([]);
    expect(c.digest).toBe(off.digest);
  });

  it('the font manifest is in the digest: planted fault fontManifestOutOfDigest leaves it out', () => {
    expect(compileWith(full, MAP).digest).not.toBe(compileWith(full, MAP, { fontManifestOutOfDigest: true }).digest);
  });

  it('one changed font byte changes the digest', () => {
    const bytes = new Uint8Array(FILES['fonts/Lato-Regular.ttf'] as Uint8Array);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 1;
    const changed = withBody(fontInput('@font-face { font-family: Mine; src: url(fonts/Lato-Regular.ttf); font-weight: 400 } .a { font-family: sans-serif } .b { font-family: Mine, sans-serif }', {
      urls: ['fonts/Lato-Regular.ttf'], body: [], files: { ...FILES, 'fonts/Lato-Regular.ttf': bytes },
    }));
    expect(compileWith(changed, MAP).digest).not.toBe(compileWith(full, MAP).digest);
  });

  it('planted fault pinnedGenericNotRewritten writes the generic as authored', () => {
    const css = cssOf(compileWith(full, MAP, { pinnedGenericNotRewritten: true }));
    expect(css).toMatch(/font-family: sans-serif;/);
    expect(css).not.toMatch(/font-family: "Dragon Sans";/);
  });

  it('planted fault fontFaceNotEmitted drops the @font-face rules and their assets', () => {
    const c = compileWith(full, MAP, { fontFaceNotEmitted: true });
    expect(cssOf(c)).not.toMatch(/@font-face/);
    expect(c.outputs.web.kind === 'ready' && c.outputs.web.assets).toEqual([]);
  });

  it('planted fault unmappedFamilyAccepted accepts an unmapped family', () => {
    const i = fontInput('.a { font-family: Nope }');
    expect(codes(compileWith(i, MAP))).toEqual(['DRAGON_FONT_UNMAPPED_FAMILY']);
    expect(codes(compileWith(i, MAP, { unmappedFamilyAccepted: true }))).toEqual([]);
  });
});
