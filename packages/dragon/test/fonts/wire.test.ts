// The fonts wiring glue (T011 Phase A, notes/T033-txt1c-wiring-spec.md §3): collectFontFaces, projectFonts, familySupport and
// webFontOutput, checked against the Chrome captures (read, not recaptured) and the stated-reference probes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AtRuleContext } from '../../src/css/at-rules.ts';
import { parseFamilyList, readSfnt, serializeFamilyList } from '../../src/fonts/index.ts';
import type { FontFaceIssue, FontMap, FontMapError } from '../../src/fonts/index.ts';
import {
  collectFontFaces, familySupport, FONT_WIRE_PROBLEM_KINDS, pinnedFacesOf, projectFonts, webFontOutput,
} from '../../src/fonts/wire.ts';
import type { FamilyFeatureKey, FontWireProblem, SnapshotAsset } from '../../src/fonts/wire.ts';
import { atRules, capture, resolveFonts, vendorBytes } from './compare.ts';

const SRC = { uri: 'file:///wire.css', revision: 'r1', hash: 'h1' };
const contexts = (css: string): AtRuleContext[] =>
  atRules(css).map((node) => {
    const loc = node.loc as { start: { offset: number }; end: { offset: number } } | undefined;
    return { node, name: String(node['name']), where: 'the stylesheet', span: { source: SRC, start: loc?.start.offset ?? 0, end: loc?.end.offset ?? 0 } };
  });
const collect = (css: string) => collectFontFaces(contexts(css), resolveFonts);

const INTER = ['Inter/Inter-Light.ttf', 'Inter/Inter-Regular.ttf', 'Inter/Inter-Italic.ttf', 'Inter/Inter-Bold.ttf', 'Inter/Inter-BoldItalic.ttf'];
const FILES = [...INTER, 'NotoSansMono/NotoSansMono-Regular.ttf', 'NotoSans/NotoSans-Regular.ttf', 'Roboto/Roboto-Regular.ttf'];
const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
/** Snapshot assets whose ids are the fonts/<file> srcs of the captured maps. */
const ASSETS: SnapshotAsset[] = FILES.map((f) => {
  const bytes = vendorBytes(f);
  return { id: `fonts/${f}`, hash: `sha256:${hex(bytes)}`, bytes };
});
const dataUrl = (f: string): string => `data:font/ttf;base64,${Buffer.from(vendorBytes(f)).toString('base64')}`;
/** Inter VF with its HVAR table tag renamed: a variable font the fence refuses (as in variable-fence.test.ts). */
const NO_HVAR_VF_URL = ((): string => {
  const out = new Uint8Array(readFileSync(new URL('../../../../docs/research/text-spike/fonts/Inter-VF.ttf', import.meta.url)));
  const d = new DataView(out.buffer);
  for (let i = 0; i < d.getUint16(4); i++) {
    const r = 12 + i * 16;
    if (String.fromCharCode(...out.subarray(r, r + 4)) === 'HVAR') out.set([0x58, 0x56, 0x41, 0x52], r);
  }
  return `data:font/ttf;base64,${Buffer.from(out).toString('base64')}`;
})();

const PINNED_MAP = capture<{ map: FontMap }>('pinned.json').map;
const REFERENCE = capture<unknown>('../reference/p2-cssom-rewrite.json') as { map: FontMap };

const kinds = (problems: readonly FontWireProblem[]): string[] => [...new Set(problems.map((p) => (p.kind === 'font-face' ? `font-face:${p.issue.kind}` : p.kind)))].sort();

describe('collectFontFaces', () => {
  it('parses the @font-face contexts in document order and skips other at-rules', () => {
    const got = collect('@font-face{font-family:A;src:url(fonts/Inter/Inter-Regular.ttf)}@media (x){}@FONT-FACE{font-family:B;src:url(fonts/Inter/Inter-Bold.ttf);font-weight:700}');
    expect(got.results.map((r) => [r.face?.family, r.face?.order])).toEqual([['A', 0], ['B', 1]]);
    expect(got.results[1]?.face?.source?.font.names.postScriptName).toBe('Inter-Bold');
    expect(got.problems).toEqual([]);
  });

  it('reports every @font-face issue kind as a typed problem with its rule, blocking exactly the build errors', () => {
    const rule = (body: string): string => `@font-face{font-family:A;src:url(fonts/Inter/Inter-Regular.ttf);${body}}`;
    const css = [
      rule('font-weight:0'),
      rule('color:red'),
      rule('font-weight:calc(400)'),
      rule('.x{color:red}'),
      rule('font-feature-settings:"liga" 0'),
      rule('font-display:swap'),
      '@font-face{font-family:A}',
      '@font-face{font-family:A;src:url(https://example.com/a.ttf)}',
      '@font-face{font-family:A;src:url(missing.ttf)}',
      '@font-face{font-family:A;src:local(Inter)}',
      '@font-face{font-family:A;src:url(data:font/ttf;base64,AAAAAAAA)}',
      `@font-face{font-family:A;src:url(${NO_HVAR_VF_URL})}`,
    ].join('\n');
    const all: { readonly [K in FontFaceIssue['kind']]: boolean } = {
      'invalid-descriptor': false, 'unknown-descriptor': false, 'unsupported-descriptor': true, 'unexpected-content': false,
      'descriptor-not-applied': false, 'no-effect': false, 'rule-dropped': false, 'remote-url': true, 'unresolved-asset': true,
      'local-font': true, 'unreadable-font': true, 'variable-font-refused': true,
    };
    const got = collect(css);
    const seen = new Map<string, boolean>();
    for (const p of got.problems) {
      if (p.kind !== 'font-face') throw new Error(p.kind);
      expect(p.source.kind).toBe('rule');
      if (p.source.kind === 'rule') expect(p.source.context.span.end).toBeGreaterThan(p.source.context.span.start);
      seen.set(p.issue.kind, p.blocking);
    }
    expect(Object.fromEntries([...seen].sort())).toEqual(Object.fromEntries(Object.entries(all).sort()));
  });
});

describe('projectFonts', () => {
  it('builds the manifest of the authored and pinned faces, resolving pinned src as an asset id or a data: URL', () => {
    const map = { generics: { 'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [{ src: 'fonts/Inter/Inter-Regular.ttf', weight: '400' }, { src: dataUrl('Inter/Inter-Bold.ttf'), weight: '700' }] } } };
    const got = projectFonts(map, collect('@font-face{font-family:Brand;src:url(fonts/Roboto/Roboto-Regular.ttf)}').results, ASSETS);
    expect(got.problems).toEqual([]);
    expect(got.map).toEqual(map);
    expect(got.manifest?.faces.map((f) => [f.family, f.postScriptName, f.assetId]).sort()).toEqual([
      ['Brand', 'Roboto-Regular', 'asset:fonts/Roboto/Roboto-Regular.ttf'],
      ['Dragon Sans', 'Inter-Bold', null],
      ['Dragon Sans', 'Inter-Regular', 'fonts/Inter/Inter-Regular.ttf'],
    ]);
    expect(got.pinned.map((p) => [p.key, p.family, p.index])).toEqual([['sans-serif', 'Dragon Sans', 0], ['sans-serif', 'Dragon Sans', 1]]);
    expect(got.digestInput).not.toBeNull();
  });

  it('parses the faces of a pinned family shared by two keys once', () => {
    const entry = { mode: 'pinned', family: 'Shared', faces: [{ src: 'fonts/Inter/Inter-Regular.ttf' }] };
    const got = projectFonts({ generics: { 'sans-serif': entry, 'ui-sans-serif': entry } }, [], ASSETS);
    expect(got.pinned.length).toBe(1);
    expect(got.manifest?.faces.length).toBe(1);
  });

  it('refuses a pinned src that is not a snapshot asset id or a data: URL', () => {
    const map = { generics: { monospace: { mode: 'pinned', family: 'M', faces: [{ src: 'Inter-Regular.ttf' }, { src: 'https://example.com/a.ttf' }] } } };
    const got = projectFonts(map, [], ASSETS);
    expect(got.problems.map((p) => (p.kind === 'font-face' ? [p.issue.kind, p.blocking, p.source] : p.kind))).toEqual([
      ['unresolved-asset', true, { kind: 'map', key: 'monospace', face: 0 }],
      ['remote-url', true, { kind: 'map', key: 'monospace', face: 1 }],
    ]);
    expect(got.manifest).toBeNull();
    expect(got.digestInput).toBeNull();
  });

  it('reports every font map error kind, and an invalid map gives no manifest', () => {
    const faces = [{ src: 'fonts/Inter/Inter-Regular.ttf' }];
    const raw = {
      generics: { nope: { mode: 'platform' }, serif: { mode: 'other' }, monospace: { mode: 'pinned', family: 'X', faces: [{ src: 'fonts/Inter/Inter-Regular.ttf', weight: 'heavy' }] }, 'sans-serif': { mode: 'pinned', family: 'Y', faces } },
      families: { Brand: { mode: 'pinned', family: 'Y', faces: [{ src: 'fonts/Inter/Inter-Bold.ttf' }] } },
    };
    const got = projectFonts(raw, [], ASSETS);
    const all: { readonly [K in FontMapError['kind']]: true } = { 'unknown-generic': true, 'invalid-entry': true, 'invalid-face-descriptor': true, 'pinned-family-conflict': true };
    expect([...new Set(got.problems.map((p) => (p.kind === 'font-map-invalid' ? p.error.kind : p.kind)))].sort()).toEqual(Object.keys(all).sort());
    expect(got.map).toBeNull();
    expect(got.manifest).toBeNull();
    expect(got.digestInput).toBeNull();
  });

  it('reports an authored family that has a pinned family name', () => {
    const got = projectFonts(PINNED_MAP, collect('@font-face{font-family:"dragon sans";src:url(fonts/Inter/Inter-Regular.ttf)}').results, ASSETS);
    expect(got.problems).toEqual([{ kind: 'pinned-family-declared', family: 'Dragon Sans', keys: ['sans-serif'] }]);
  });

  it('digestInput: null with no faces and no map, set with a map alone', () => {
    expect(projectFonts(undefined, [], ASSETS).digestInput).toBeNull();
    expect(projectFonts(undefined, [], []).digestInput).toBeNull();
    expect(projectFonts({ generics: { serif: { mode: 'platform' } } }, [], []).digestInput).toEqual({ version: 1, faces: [] });
  });

  it('digestInput: one changed byte changes it', () => {
    const css = '@font-face{font-family:A;src:url(fonts/Inter/Inter-Regular.ttf)}';
    const base = projectFonts(PINNED_MAP, collect(css).results, ASSETS).digestInput;
    const changed = (bytes: Uint8Array): Uint8Array => {
      const out = bytes.slice();
      out[out.length - 1] = ((out[out.length - 1] ?? 0) + 1) & 0xff;
      return out;
    };
    const authored = collectFontFaces(contexts(css), (s) => {
      const r = resolveFonts(s);
      return r === null ? null : { id: r.id, bytes: changed(r.bytes) };
    }).results;
    expect(projectFonts(PINNED_MAP, authored, ASSETS).digestInput).not.toEqual(base);
    const assets = ASSETS.map((a) => (a.id === 'fonts/NotoSansMono/NotoSansMono-Regular.ttf' ? { ...a, bytes: changed(a.bytes) } : a));
    expect(projectFonts(PINNED_MAP, collect(css).results, assets).digestInput).not.toEqual(base);
    expect(projectFonts(PINNED_MAP, collect(css).results, ASSETS).digestInput).toEqual(base);
  });

  it('digestInput: reordering the rules does not change it', () => {
    const rules = [
      '@font-face{font-family:A;src:url(fonts/Inter/Inter-Regular.ttf)}',
      '@font-face{font-family:A;src:url(fonts/Inter/Inter-Bold.ttf);font-weight:700}',
      '@font-face{font-family:B;src:url(fonts/Roboto/Roboto-Regular.ttf);unicode-range:U+0-7F}',
    ];
    const a = projectFonts(PINNED_MAP, collect(rules.join('')).results, ASSETS).digestInput;
    const b = projectFonts(PINNED_MAP, collect([...rules].reverse().join('')).results, ASSETS).digestInput;
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });
});

const ALL_KEYS: readonly FamilyFeatureKey[] = ['font-family:<pinned>', 'font-family:<declared>', 'font-family:<platform>', 'font-family:<unmapped>'];

describe('familySupport', () => {
  it('returns null for the single family Ahem and invalid for a list Chrome rejects', () => {
    expect(familySupport('Ahem', PINNED_MAP, new Set())).toBeNull();
    expect(familySupport('"Ahem"', null, new Set())).toBeNull();
    expect(familySupport('Ahem, sans-serif', PINNED_MAP, new Set())?.kind).toBe('resolved');
    expect(familySupport('A, , B', PINNED_MAP, new Set())).toEqual({ kind: 'invalid' });
  });

  it('keys each value by the least supported resolution kind, never by an author family name', () => {
    const cases: [string, FamilyFeatureKey][] = [
      ['sans-serif', 'font-family:<pinned>'],
      ['"Brand Face", monospace', 'font-family:<pinned>'],
      ['Mine, sans-serif', 'font-family:<declared>'],
      ['"Mine"', 'font-family:<declared>'],
      ['serif', 'font-family:<platform>'],
      ['Mine, serif', 'font-family:<platform>'],
      ["'Lato', sans-serif", 'font-family:<unmapped>'],
      ['Lato', 'font-family:<unmapped>'],
      ['cursive', 'font-family:<unmapped>'],
      ['Mine, Lato, serif', 'font-family:<unmapped>'],
    ];
    const got = cases.map(([text]) => {
      const s = familySupport(text, PINNED_MAP, new Set(['mine']));
      if (s === null || s.kind !== 'resolved') throw new Error(text);
      for (const e of s.list) if (e.kind === 'family') expect(s.key.toLowerCase()).not.toContain(e.name.toLowerCase());
      return s.key;
    });
    expect(got).toEqual(cases.map(([, k]) => k));
    expect([...new Set(got)].sort()).toEqual([...ALL_KEYS].sort());
  });

  it('with no map every generic is unmapped', () => {
    const s = familySupport('sans-serif', null, new Set());
    expect(s?.kind === 'resolved' && s.key).toBe('font-family:<unmapped>');
  });

  it("equals Chrome's resolution on the pinned.json rows", () => {
    type Font = { postScriptName: string; isCustomFont: boolean };
    const cap = capture<{ map: FontMap; requests: { family: string; rewritten: string; chrome: Font[] }[] }>('pinned.json');
    const psOf = (family: string): string[] => {
      const e = [...Object.values(cap.map.generics), ...Object.values(cap.map.families ?? {})].find((x) => x?.mode === 'pinned' && x.family === family);
      if (e === undefined || e.mode !== 'pinned') throw new Error(family);
      return e.faces.map((f) => {
        const r = readSfnt(vendorBytes(f.src.slice('fonts/'.length)));
        if (!r.ok) throw new Error(f.src);
        return r.font.names.postScriptName ?? '';
      });
    };
    for (const r of cap.requests) {
      const s = familySupport(r.family, cap.map, new Set());
      if (s === null || s.kind !== 'resolved') throw new Error(r.family);
      // Chrome skips the entries with no face (unmapped) and renders from the first one that has faces.
      const used = s.resolutions.find((x) => x.kind !== 'unmapped-family');
      if (used?.kind === 'pinned') {
        expect(r.chrome.length, r.family).toBe(1);
        expect(r.chrome[0]?.isCustomFont, r.family).toBe(true);
        expect(psOf(used.family), r.family).toContain(r.chrome[0]?.postScriptName);
      } else expect(r.chrome.every((f) => !f.isCustomFont), r.family).toBe(true);
      expect(s.key).toBe(s.resolutions.some((x) => x.kind === 'unmapped-family') ? 'font-family:<unmapped>' : 'font-family:<pinned>');
    }
  });

  it("equals Chrome's parse and serialization on the parsing.json family rows", () => {
    const cap = capture<{ families: { value: string; parentComputed: string; computed: string }[] }>('parsing.json');
    for (const f of cap.families) {
      const s = familySupport(f.value, PINNED_MAP, new Set());
      if (f.computed === f.parentComputed) expect(s, f.value).toEqual({ kind: 'invalid' });
      else if (s === null) expect(f.computed).toBe('Ahem');
      else {
        if (s.kind !== 'resolved') throw new Error(f.value);
        expect(serializeFamilyList(s.list), f.value).toBe(f.computed);
        expect(s.resolutions.length).toBe(s.list.length);
      }
    }
  });
});

describe('webFontOutput', () => {
  const authoredCss = [
    '@font-face{font-family:Brand;src:url(fonts/Roboto/Roboto-Regular.ttf);font-display:swap;unicode-range:U+0-7F}',
    '@font-face{font-family:"Brand";src:url(fonts/Inter/Inter-Bold.ttf);font-weight:600 800;font-feature-settings:"liga" 0}',
    '@font-face{font-family:Other;src:url(fonts/Roboto/Roboto-Regular.ttf)}',
  ].join('');
  const authored = collect(authoredCss).results;
  const projected = projectFonts(PINNED_MAP, authored, ASSETS);
  const declared = authored.flatMap((r) => (r.face === null ? [] : [r.face]));

  it('writes the used pinned faces in map order, then the authored faces in declaration order, with content-hashed paths', () => {
    if (projected.manifest === null) throw new Error('no manifest');
    const out = webFontOutput(pinnedFacesOf(projected, new Set(['Dragon Sans'])), declared, projected.manifest);
    const path = (f: string): string => `fonts/${hex(vendorBytes(f)).slice(0, 16)}.ttf`;
    expect(out.problems).toEqual([]);
    expect(out.css.split('\n')).toEqual([
      `@font-face{font-family:"Dragon Sans";src:url("${path('Inter/Inter-Light.ttf')}");font-weight:300}`,
      `@font-face{font-family:"Dragon Sans";src:url("${path('Inter/Inter-Regular.ttf')}");font-weight:400}`,
      `@font-face{font-family:"Dragon Sans";src:url("${path('Inter/Inter-Italic.ttf')}");font-weight:400;font-style:italic}`,
      `@font-face{font-family:"Dragon Sans";src:url("${path('Inter/Inter-Bold.ttf')}");font-weight:700}`,
      `@font-face{font-family:"Dragon Sans";src:url("${path('Inter/Inter-BoldItalic.ttf')}");font-weight:700;font-style:italic}`,
      `@font-face{font-family:"Brand";src:url("${path('Roboto/Roboto-Regular.ttf')}");unicode-range:U+0-7F;font-display:swap}`,
      `@font-face{font-family:"Brand";src:url("${path('Inter/Inter-Bold.ttf')}");font-weight:600 800;font-feature-settings:"liga" 0}`,
      `@font-face{font-family:"Other";src:url("${path('Roboto/Roboto-Regular.ttf')}")}`,
    ]);
    const paths = out.assets.map((a) => a.path);
    expect(paths).toEqual([...new Set(paths)].sort());
    expect(paths.length).toBe(6);
    for (const a of out.assets) {
      expect(a.hash).toBe(`sha256:${hex(a.bytes)}`);
      expect(a.path).toBe(`fonts/${a.hash.slice('sha256:'.length, 'sha256:'.length + 16)}.ttf`);
    }
  });

  it('is deterministic, and its rules parse back to the same faces from the emitted assets', () => {
    if (projected.manifest === null) throw new Error('no manifest');
    const used = pinnedFacesOf(projected, new Set(['Dragon Mono', 'Dragon Sans']));
    const a = webFontOutput(used, declared, projected.manifest);
    const b = webFontOutput(used, [...declared].reverse(), projected.manifest);
    expect(b).toEqual(a);
    const byPath = new Map(a.assets.map((x) => [x.path, x]));
    const back = collectFontFaces(contexts(a.css), (s) => {
      const x = byPath.get(s);
      return x === undefined ? null : { id: x.path, bytes: x.bytes };
    });
    expect(back.problems.filter((p) => p.kind !== 'font-face' || p.blocking)).toEqual([]);
    const summary = (fs: readonly { family: string; capabilities: unknown; ranges: unknown; source: { bytes: Uint8Array } | null }[]) =>
      fs.map((f) => [f.family, f.capabilities, f.ranges, f.source === null ? null : hex(f.source.bytes)]);
    expect(summary(back.results.flatMap((r) => (r.face === null ? [] : [r.face])))).toEqual(summary([...used, ...declared]));
  });

  it('with no faces the output is empty', () => {
    expect(webFontOutput([], [], { version: 1, faces: [] })).toEqual({ css: '', assets: [], problems: [] });
  });

  it('reports a face missing from the manifest', () => {
    const out = webFontOutput([], declared.slice(0, 1), { version: 1, faces: [] });
    expect(out.problems).toEqual([{ kind: 'face-not-in-manifest', family: 'Brand', hash: `sha256:${hex(vendorBytes('Roboto/Roboto-Regular.ttf'))}` }]);
  });
});

describe('problem kinds', () => {
  it('every wiring problem kind is reachable', () => {
    const all: { readonly [K in FontWireProblem['kind']]: true } = { 'font-face': true, 'font-map-invalid': true, 'pinned-family-declared': true, 'face-not-in-manifest': true };
    expect([...FONT_WIRE_PROBLEM_KINDS].sort()).toEqual(Object.keys(all).sort());
    const authored = collect('@font-face{font-family:"Dragon Sans";src:url(https://example.com/a.ttf)}');
    const reached = [
      ...authored.problems,
      ...projectFonts({ generics: { nope: { mode: 'platform' } } }, [], ASSETS).problems,
      ...projectFonts(PINNED_MAP, collect('@font-face{font-family:"Dragon Sans";src:url(fonts/Inter/Inter-Regular.ttf)}').results, ASSETS).problems,
      ...webFontOutput([], collect('@font-face{font-family:A;src:url(fonts/Inter/Inter-Regular.ttf)}').results.flatMap((r) => (r.face === null ? [] : [r.face])), { version: 1, faces: [] }).problems,
    ];
    expect([...new Set(reached.map((p) => p.kind))].sort()).toEqual(Object.keys(all).sort());
    expect(kinds(authored.problems)).toEqual(['font-face:remote-url']);
  });
});

describe('stated-reference probes (reference/*.json)', () => {
  type Header = { chrome: string; platform: string; fonts: Record<string, string>; launches: { dpr: number; flags: string[] }[] };
  const FILES_REF = ['p1-set-font-families.json', 'p2-cssom-rewrite.json', 'p3-control.json'];

  it.each(FILES_REF)('%s records Chrome 145 on darwin-arm64 with the current font bytes', (file) => {
    const h = capture<Header>(`../reference/${file}`);
    expect(h.chrome).toBe('145.0.7632.6');
    expect(h.platform).toBe('darwin-arm64');
    expect(h.launches).toEqual([{ dpr: 1, flags: expect.arrayContaining(['--force-device-scale-factor=1']) as unknown }]);
    for (const [f, sha] of Object.entries(h.fonts)) expect(hex(new Uint8Array(readFileSync(new URL(`../../../../vendor/fonts/${f}`, import.meta.url))))).toBe(sha);
  });

  it('P2: Chrome renders every node from the expected face after the CSSOM rewrite', () => {
    const p2 = capture<{ cases: { id: string; ok: boolean }[] }>('../reference/p2-cssom-rewrite.json');
    expect(p2.cases.length).toBeGreaterThan(0);
    expect(p2.cases.filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
  });

  it('P3: the rewrite leaves every computed value and box of the control document identical', () => {
    const p3 = capture<{ identical: boolean; before: string; after: string; computedValues: number; visits: { before: string; after: string }[] }>('../reference/p3-control.json');
    expect(p3.identical).toBe(true);
    expect(p3.after).toBe(p3.before);
    expect(p3.computedValues).toBeGreaterThan(0);
    expect(p3.visits.every((v) => v.before === v.after)).toBe(true);
  });

  it('the reference map is the pinned sans-serif of T033 §1.1', () => {
    const e = REFERENCE.map.generics['sans-serif'];
    expect(e?.mode === 'pinned' && [e.family, e.faces.map((f) => [f.src, f.weight, f.style ?? 'normal'])]).toEqual(['Dragon Sans', [
      ['fonts/Inter/Inter-Light.ttf', '300', 'normal'], ['fonts/Inter/Inter-Regular.ttf', '400', 'normal'], ['fonts/Inter/Inter-Italic.ttf', '400', 'italic'],
      ['fonts/Inter/Inter-Bold.ttf', '700', 'normal'], ['fonts/Inter/Inter-BoldItalic.ttf', '700', 'italic'],
    ]]);
    expect(parseFamilyList('sans-serif')).toEqual([{ kind: 'generic', keyword: 'sans-serif' }]);
  });
});
