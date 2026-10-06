// S5: docs/api.md §10 items through the public entry (f1-f3), T005 recs 2, 3, 5 and 6, and T039 M3 and M4.
import { describe, expect, it } from 'vitest';
import type { Compiled, ComponentDefinition, Diagnostic, ElementNode, FrontEndResult, Origin, SupportAnswer, TreeNode } from '../src/index.ts';
import { createProject, formatDiagnostic, formatDiagnostics, querySupport } from '../src/index.ts';
import { CATALOGUE, COMMITTED_PROFILES, createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { SupportProfiles } from '../src/internal.ts';
import { sha256HexBytes } from '../src/digest.ts';
import { always, div, expectCatalogued, inputFor, Sources, spanTextOf, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const both = () => createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
const canonical = (c: Compiled<'ios' | 'web'>): string => JSON.stringify({ ok: c.ok, revision: c.revision, digest: c.digest, sources: c.sources, dependencies: c.dependencies, diagnostics: c.diagnostics, targets: c.targets, outputs: c.outputs });
const blockedEverywhere = (c: Compiled<'ios' | 'web'>): boolean => c.outputs.ios.kind === 'blocked' && c.outputs.web.kind === 'blocked' && !c.ok;

describe('(f1) missing assets: a typed diagnostic that blocks every output (docs/api.md §10.1)', () => {
  const base = inputFor(`${FONT} .a { width: 5px; }`, (r) => [div(r, 'a', ['a'])]);
  const bytes = new TextEncoder().encode('logo');
  const asset = { id: 'asset://logo.png', hash: `sha256:${sha256HexBytes(bytes)}`, bytes };
  const src = base.snapshot.sources[0] as FrontEndResult['snapshot']['sources'][number];
  const withSnapshot = (snapshot: Partial<FrontEndResult['snapshot']>, tree: FrontEndResult['tree'] = base.tree): FrontEndResult => ({ ...base, snapshot: { ...base.snapshot, ...snapshot }, tree });
  const cases: readonly { name: string; input: FrontEndResult; message: RegExp }[] = [
    {
      name: 'a stylesheet use naming a source that is not in the snapshot',
      input: withSnapshot({}, base.tree === null ? null : { ...base.tree, styles: [{ id: 's', css: { source: { uri: 'dragon-source://test/missing.css', revision: 'r1', hash: 'sha256:00' }, start: 0, end: 1 }, scope: { kind: 'document' } }] }),
      message: /style use s names source dragon-source:\/\/test\/missing\.css, which is not in the snapshot/,
    },
    { name: 'a resolution whose destination is null', input: withSnapshot({ resolutions: [{ from: src.ref, specifier: './theme.css', kind: 'css', to: null }] }), message: /is unresolved \(to is null\)/ },
    { name: 'a resolution to a source that is absent', input: withSnapshot({ resolutions: [{ from: src.ref, specifier: './theme.css', kind: 'css', to: 'dragon-source://test/theme.css' }] }), message: /names source dragon-source:\/\/test\/theme\.css, which is not in the snapshot/ },
    { name: 'a resolution to an asset that is absent', input: withSnapshot({ resolutions: [{ from: src.ref, specifier: './logo.png', kind: 'asset', to: 'asset://logo.png' }] }), message: /names asset asset:\/\/logo\.png, which is not in the snapshot/ },
    { name: 'an asset whose bytes do not match its hash', input: withSnapshot({ assets: [{ ...asset, hash: 'sha256:0000' }] }), message: /the bytes of asset asset:\/\/logo\.png hash to sha256:[0-9a-f]{64}, not sha256:0000/ },
  ];
  for (const k of cases) {
    it(`${k.name}: DRAGON_MISSING_ASSET, every output blocked`, () => {
      const c = both().compile(k.input);
      const hits = c.diagnostics.filter((d) => d.code === 'DRAGON_MISSING_ASSET');
      expect(hits.length, JSON.stringify(c.diagnostics.map((d) => d.message))).toBe(1);
      expect((hits[0] as Diagnostic).message).toMatch(k.message);
      expect((hits[0] as Diagnostic).target).toBeNull();
      expect(blockedEverywhere(c)).toBe(true);
      expectCatalogued(c.diagnostics);
    });
  }
  it('the code is new and appended; its why is literally true for all three reasons', () => {
    expect(CATALOGUE.DRAGON_MISSING_ASSET.why).toMatch(/source, stylesheet and asset .* in the snapshot with bytes matching its hash/);
  });
  it('a present asset with matching bytes and a resolution to it compile clean', () => {
    const c = both().compile(withSnapshot({ assets: [asset], resolutions: [{ from: src.ref, specifier: './logo.png', kind: 'asset', to: asset.id }, { from: src.ref, specifier: './app.css', kind: 'css', to: src.ref.uri }] }));
    expect(c.diagnostics).toEqual([]);
    expect([c.outputs.ios.kind, c.outputs.web.kind]).toEqual(['analysis-only', 'ready']);
  });
  it('(c) the digest does not depend on the order of assets, resolutions or configured targets', () => {
    const b2 = { ...asset, id: 'asset://b.png' };
    const r1 = { from: src.ref, specifier: './logo.png', kind: 'asset' as const, to: asset.id };
    const r2 = { from: src.ref, specifier: './b.png', kind: 'asset' as const, to: b2.id };
    const a = both().compile(withSnapshot({ assets: [asset, b2], resolutions: [r1, r2] }));
    const b = createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } }).compile(withSnapshot({ assets: [b2, asset], resolutions: [r2, r1] }));
    expect(b.digest).toBe(a.digest);
    expect(canonical(b)).toBe(canonical(a));
  });
});

describe('(f2) querySupport from the public entry (docs/api.md §6.3)', () => {
  it('possibilities: a declaration with supported rows needs context and lists them with proofs; none gives unsupported', () => {
    const flex = querySupport({ kind: 'possibilities', target: { kind: 'web' }, css: 'display: flex' });
    if (flex.kind !== 'needs-context') throw new Error(flex.kind);
    expect(flex.declaration).toBe('display: flex');
    expect(flex.candidates.length).toBeGreaterThan(3);
    for (const c of flex.candidates) {
      expect(c.feature).toBe('display:flex');
      expect(c.status).not.toBe('unsupported');
      for (const p of c.proofs) {
        expect(p.tolerance).toBe(p.lane === 'chrome-dual' ? 'dual-exact' : 'gate-1-device-px');
        expect(p.cases.length).toBeGreaterThan(0);
      }
    }
    expect(flex.candidates.map((c) => c.context)).toContain('block/ltr');
    const gap = querySupport({ kind: 'possibilities', target: { kind: 'ios', minimum: '15.0' }, css: 'gap: 7px' });
    if (gap.kind !== 'needs-context') throw new Error(gap.kind);
    expect([...new Set(gap.candidates.map((c) => c.feature))].sort()).toEqual(['column-gap:<length-px>', 'row-gap:<length-px>']);
    expect(gap.candidates.some((c) => c.proofs.some((p) => p.lane === 'linux-dragon-layout' && p.tolerance === 'gate-1-device-px'))).toBe(true);
    expect(querySupport({ kind: 'possibilities', target: { kind: 'web' }, css: 'display: inline-grid' })).toMatchObject({ kind: 'unsupported', declaration: 'display: inline-grid' });
  });
  it('possibilities: malformed CSS, several declarations and a bad target are invalid queries', () => {
    expect(querySupport({ kind: 'possibilities', target: { kind: 'web' }, css: 'width: -1px' }).kind).toBe('invalid-query');
    expect(querySupport({ kind: 'possibilities', target: { kind: 'web' }, css: 'width: 1px; height: 2px' }).kind).toBe('invalid-query');
    expect(querySupport({ kind: 'possibilities', target: { kind: 'android' } as unknown as { kind: 'web' }, css: 'width: 1px' }).kind).toBe('invalid-query');
    expect(querySupport({ kind: 'possibilities', target: { kind: 'ios' } as unknown as { kind: 'web' }, css: 'width: 1px' }).kind).toBe('invalid-query');
  });
  it('resolved: the checked element\'s decision in every matching case, from the result\'s profiles', () => {
    const c = both().compile(inputFor(`${FONT} .a { width: 50px; }`, (r) => [div(r, 'a', ['a'])]));
    const web = querySupport({ kind: 'resolved', result: c, target: 'web', node: 'a', instance: 'doc', assignment: [], property: 'width' });
    expect(web).toMatchObject({ kind: 'decided', cases: [{ assignment: [], decision: { feature: 'width:<length-px>', context: 'block/ltr', status: 'exact' } }] });
    const ios = querySupport({ kind: 'resolved', result: c, target: 'ios', node: 'a', instance: 'doc', assignment: [], property: 'width' });
    if (ios.kind !== 'decided') throw new Error(ios.kind);
    expect(ios.cases[0]?.decision?.proofs.map((p) => [p.lane, p.tolerance])).toEqual([['linux-dragon-layout', 'gate-1-device-px']]);
    // No author declaration: no decision.
    expect(querySupport({ kind: 'resolved', result: c, target: 'web', node: 'a', instance: 'doc', assignment: [], property: 'height' })).toMatchObject({ kind: 'decided', cases: [{ decision: null }] });
  });
  it('resolved: blocked results, unknown nodes, states, properties and targets', () => {
    const blocked = both().compile(inputFor('.g { display: inline-grid; }', (r) => [div(r, 'g', ['g'])]));
    const b = querySupport({ kind: 'resolved', result: blocked, target: 'web', node: 'g', instance: 'doc', assignment: [], property: 'display' });
    expect(b.kind).toBe('blocked');
    const c = both().compile(inputFor(`${FONT} .a { width: 50px; }`, (r) => [div(r, 'a', ['a'])]));
    const q = (over: Record<string, unknown>): SupportAnswer => querySupport({ kind: 'resolved', result: c, target: 'web', node: 'a', instance: 'doc', assignment: [], property: 'width', ...over } as Parameters<typeof querySupport>[0]);
    expect(q({ node: 'nope' }).kind).toBe('invalid-query');
    expect(q({ instance: 'other' }).kind).toBe('invalid-query');
    expect(q({ property: 'float' }).kind).toBe('invalid-query');
    expect(q({ assignment: [{ state: { instance: 'doc', state: 'open' }, value: true }] })).toMatchObject({ kind: 'invalid-query', diagnostics: [{ code: 'DRAGON_STATE_UNKNOWN' }] });
    const webOnly = createProject({ projectId: 'test', targets: { web: {} } }).compile(inputFor(`${FONT} .a { width: 50px; }`, (r) => [div(r, 'a', ['a'])]));
    expect(querySupport({ kind: 'resolved', result: webOnly, target: 'ios' as 'web', node: 'a', instance: 'doc', assignment: [], property: 'width' }).kind).toBe('invalid-query');
    expect(querySupport({ kind: 'resolved', result: { ...c } as typeof c, target: 'web', node: 'a', instance: 'doc', assignment: [], property: 'width' }).kind).toBe('invalid-query');
  });
});

describe('(f3) whole-snapshot replacement (docs/api.md §8)', () => {
  const component = (s: Sources, file: string, id: string, root: TreeNode[]): ComponentDefinition => ({ id, module: file.replace(/\.dg$/, ''), params: [], states: [], slots: [], root, origin: s.at(file, `component ${id}`) });
  const html = (s: Sources, body: TreeNode[]): ElementNode => ({ kind: 'element', id: 'html', tag: 'html', classes: [], attributes: [], origin: s.at('app.dg', '<html>'), children: [{ kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], origin: s.at('app.dg', '<body>'), children: body }] });
  const box = (s: Sources, file: string, id: string, owner: string): ElementNode => ({ kind: 'element', id, tag: 'div', classes: [{ value: [{ when: always, value: { owner, sheet: 'sheet', name: 'box' } }], origin: s.at(file, 'class="box"') }], attributes: [], children: [], origin: s.at(file, '<div') });
  // A: two modules and sources (app.dg calls Card from card.dg). B: card.dg and its module removed. A2: an invalid edit of A. A3: A2 fixed.
  function snapshotA(css: string): { s: Sources; input: FrontEndResult } {
    const s = new Sources({ 'app.dg': 'component App { <html><body><div class="box" /><Card card /></body></html> }', 'card.dg': 'component Card { <div class="box" /> }', 'app.css': css });
    const input = s.input({
      modules: [{ id: 'app', source: s.ref('app.dg').uri }, { id: 'card', source: s.ref('card.dg').uri }],
      components: [
        component(s, 'app.dg', 'App', [html(s, [box(s, 'app.dg', 'main', 'doc'), { kind: 'call', id: 'card', component: 'Card', args: [], aliases: [], slots: [], origin: s.at('app.dg', '<Card card />') }])]),
        component(s, 'card.dg', 'Card', [box(s, 'card.dg', 'inner', 'doc')]),
      ],
      documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['sheet'], initial: [] }],
      styles: [{ id: 'sheet', css: s.whole('app.css'), scope: { kind: 'document' } }],
    });
    return { s, input };
  }
  function snapshotB(): FrontEndResult {
    const s = new Sources({ 'app.dg': 'component App { <html><body><div class="box" /></body></html> }', 'app.css': `${FONT} .box { width: 30px; height: 4px; }` });
    return s.input({
      modules: [{ id: 'app', source: s.ref('app.dg').uri }],
      components: [component(s, 'app.dg', 'App', [html(s, [box(s, 'app.dg', 'main', 'doc')])])],
      documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['sheet'], initial: [] }],
      styles: [{ id: 'sheet', css: s.whole('app.css'), scope: { kind: 'document' } }],
    });
  }
  const explains = (c: Compiled<'ios' | 'web'>): string => JSON.stringify(['main', 'inner'].flatMap((node) => ['web', 'ios'].map((target) => c.explain({ target: target as 'web', at: { node, instance: node === 'inner' ? 'doc/card' : 'doc' }, property: 'width' }))));
  it('compiling A and then B (a module and its source removed) on one project equals a fresh project\'s compile of B', () => {
    const project = both();
    const a = project.compile(snapshotA(`${FONT} .box { width: 30px; height: 4px; }`).input);
    expect(a.ok).toBe(true);
    expect(a.dependencies.filter((d) => d.kind === 'source').length).toBe(3);
    const b = project.compile(snapshotB());
    const fresh = both().compile(snapshotB());
    expect(canonical(b)).toBe(canonical(fresh));
    expect(explains(b)).toBe(explains(fresh));
    expect(b.dependencies.filter((d) => d.kind === 'source').length).toBe(2);
    expect(explains(b)).toContain('"kind":"not-found"');
  });
  it('A, then an invalid A\' (outputs blocked, never relabelled current), then a fixed A\'\' equals a fresh compile of A\'\'', () => {
    const project = both();
    const a = project.compile(snapshotA(`${FONT} .box { width: 30px; height: 4px; }`).input);
    const broken = project.compile(snapshotA(`${FONT} .box { width: 30px; height: 4px; float: left; }`).input);
    expect(broken.ok).toBe(false);
    expect([broken.outputs.ios.kind, broken.outputs.web.kind]).toEqual(['blocked', 'blocked']);
    expect(broken.digest).not.toBe(a.digest);
    expect(JSON.stringify(broken.outputs)).not.toContain(a.digest);
    const fixedInput = snapshotA(`${FONT} .box { width: 31px; height: 4px; }`).input;
    const fixed = project.compile(fixedInput);
    const fresh = both().compile(fixedInput);
    expect(canonical(fixed)).toBe(canonical(fresh));
    expect(explains(fixed)).toBe(explains(fresh));
    expect(fixed.ok).toBe(true);
  });
});

describe('T005 rec 2: a shorthand-set longhand names the authored shorthand, its span, the unproven longhand and what to write instead', () => {
  // A copy of the profiles without column-gap in single-line flex columns reproduces T005's gap trap.
  const drop = (feature: string, context: string): SupportProfiles => ({
    ios: { ...COMMITTED_PROFILES.ios, rows: COMMITTED_PROFILES.ios.rows.filter((r) => !(r.feature === feature && r.context === context)) },
    web: { ...COMMITTED_PROFILES.web, rows: COMMITTED_PROFILES.web.rows.filter((r) => !(r.feature === feature && r.context === context)) },
  });
  it('gap in a flex column with column-gap unproven: "write row-gap: 7px instead of gap", located at the gap value, with the declaration related', () => {
    const input = inputFor(`${FONT} .c { display: flex; flex-direction: column; gap: 7px; }`, (r) => [div(r, 'c', ['c'], [div(r, 'k', [])])]);
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles: drop('column-gap:<length-px>', 'flex-column-single-line/ltr') }).compile(input);
    const d = c.diagnostics.filter((x) => x.code === 'DRAGON_UNPROVEN_CONTEXT');
    expect(d.length).toBe(1);
    const only = d[0] as Diagnostic;
    expect(only.message.startsWith('column-gap:<length-px> (set by gap: 7px) on c is used in the flex-column-single-line/ltr context, which is not proven')).toBe(true);
    expect(only.message).toMatch(/gap sets column-gap, which is unproven here, so write row-gap: 7px instead of gap$/);
    expect(spanTextOf(input, only)).toBe('7px');
    expect(only.related.map((r) => [spanTextOf(input, { ...only, origin: r.origin }), r.message])).toEqual([['gap: 7px', 'declaration gap: 7px applied to c']]);
  });
});

describe('T005 rec 3: diagnostics inside an unsupported at-rule are reported in the same pass', () => {
  // A width @media is native too since MQ-R1, so the unsupported at-rule here is @container, which every target refuses.
  const R3 = 'body { margin: 0; }\n@container (min-width: 300px) {\n  .caption { width: 80px; }\n}\n.caption { font-size: 10px; line-height: 12px; color: #24292e; margin-right: 6mm; }\n';
  it('T005 R3 through the public entry: DRAGON_UNSUPPORTED_AT_RULE, DRAGON_UNSUPPORTED_FONT and DRAGON_UNPROVEN_CONTEXT in one pass, every output blocked', () => {
    const input = inputFor(R3, (r) => [div(r, 'caption', ['caption'], [text(r, 't', 'CAPTION TEXT')])]);
    const c = both().compile(input);
    const codes = [...new Set(c.diagnostics.map((d) => d.code))].sort();
    expect(codes).toEqual(['DRAGON_UNPROVEN_CONTEXT', 'DRAGON_UNSUPPORTED_AT_RULE', 'DRAGON_UNSUPPORTED_FONT']);
    expect(spanTextOf(input, c.diagnostics.find((d) => d.code === 'DRAGON_UNPROVEN_CONTEXT') as Diagnostic)).toBe('6mm');
    expect(blockedEverywhere(c)).toBe(true);
    expectCatalogued(c.diagnostics);
  });
  it('the enclosed rules are analysed with the block unwrapped, top-level and nested: their diagnostics are related entries that start with the code, and nothing is emitted', () => {
    // A top-level @media is conditional since MQ-a, so the unsupported top-level at-rule here is @container.
    const css = `${FONT}\n@container (min-width: 1px) { .a { display: inline-grid; } }\n.b { width: 5px; @supports (display: flex) { margin-right: 6mm; } }\n`;
    const input = inputFor(css, (r) => [div(r, 'a', ['a']), div(r, 'b', ['b'])]);
    const c = both().compile(input);
    const atRules = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_AT_RULE');
    expect(atRules.length).toBe(2);
    const [media, supports] = atRules as [Diagnostic, Diagnostic];
    expect(media.related.map((r) => r.message)).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_VALUE \[ios\]: display: inline-grid is unsupported/), expect.stringMatching(/^DRAGON_UNSUPPORTED_VALUE \[web\]: display: inline-grid is unsupported/)]);
    expect(supports.related.map((r) => r.message)).toEqual([expect.stringMatching(/^DRAGON_UNPROVEN_CONTEXT \[ios\]: margin-right:<length-mm> on b is used in the block\/ltr context/), expect.stringMatching(/^DRAGON_UNPROVEN_CONTEXT \[web\]: margin-right:<length-mm> on b/)]);
    for (const r of [...media.related, ...supports.related]) expect(spanTextOf(input, { ...media, origin: r.origin })).toMatch(/^(inline-grid|6mm)$/);
    // The unwrapped rules never reach the top-level diagnostics or an output.
    expect(c.diagnostics.map((d) => d.code).sort()).toEqual(['DRAGON_UNSUPPORTED_AT_RULE', 'DRAGON_UNSUPPORTED_AT_RULE']);
    expect(blockedEverywhere(c)).toBe(true);
  });
});

describe('T005 rec 5: formatDiagnostics groups diagnostics that differ only in their target', () => {
  it('display: inline-grid on ios and web renders as one block listing both targets; the objects stay one per target; formatDiagnostic is unchanged', () => {
    const c = both().compile(inputFor('.g { display: inline-grid; }', (r) => [div(r, 'g', ['g'])]));
    expect(c.diagnostics.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios'], ['DRAGON_UNSUPPORTED_VALUE', 'web']]);
    const grouped = formatDiagnostics(c.diagnostics, c.sources);
    const single = formatDiagnostic(c.diagnostics[0] as Diagnostic, c.sources);
    expect(single.split('\n')[0]).toMatch(/: error DRAGON_UNSUPPORTED_VALUE \[ios\]: display: inline-grid is unsupported/);
    expect(grouped.split('\n')[0]).toBe(single.split('\n')[0]?.replace('[ios]', '[ios, web]'));
    expect(grouped.split('\n').slice(1)).toEqual(single.split('\n').slice(1));
    expect(grouped.match(/DRAGON_UNSUPPORTED_VALUE/g)?.length).toBe(1);
    // Diagnostics that differ in more than the target stay separate blocks, each exactly as formatDiagnostic renders it.
    const two = both().compile(inputFor('.g { display: inline-grid; float: left; }', (r) => [div(r, 'g', ['g'])]));
    expect(formatDiagnostics(two.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_PROPERTY'), two.sources)).toBe(formatDiagnostic(two.diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_PROPERTY') as Diagnostic, two.sources));
  });
});

describe('T005 rec 6: unsupported-value and unproven-context messages list the supported alternatives in context, from the profile rows', () => {
  it('display: inline-grid in block flow lists block, flex, grid and none', () => {
    const c = both().compile(inputFor('.g { display: inline-grid; }', (r) => [div(r, 'g', ['g'])]));
    for (const d of c.diagnostics) expect(d.message).toMatch(/^display: inline-grid is unsupported \(support profile m1-s5\); in block\/ltr use block, flex, grid or none$/);
  });
  it('margin-right: 6mm in block flow lists the margin-right values proven there', () => {
    const c = both().compile(inputFor(`${FONT} .a { margin-right: 6mm; }`, (r) => [div(r, 'a', ['a'])]));
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNPROVEN_CONTEXT' && x.target === 'ios') as Diagnostic;
    expect(d.message).toMatch(/; margin-right values proven in block\/ltr: .*<length-px>/);
  });
});

describe('T039 M3: absolutely positioned boxes beside text are refused with a true message and a why that claims no missing proof', () => {
  const refusal = (display: string): Diagnostic[] => {
    const input = inputFor(`${FONT} .p { position: relative; display: ${display}; } .a { position: absolute; }`, (r) => [div(r, 'p', ['p'], [text(r, 't', 'XX'), div(r, 'a', ['a'])])]);
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    expect(blockedEverywhere(c)).toBe(true);
    const hits = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
    for (const d of hits) expect(spanTextOf(input, d)).toBe('absolute');
    expectCatalogued(c.diagnostics);
    return hits;
  };
  it('in a flex parent: the text is an anonymous flex item and the box is not a flex item', () => {
    const hits = refusal('flex');
    expect(hits.map((d) => d.target).sort()).toEqual(['ios', 'web']);
    for (const d of hits) {
      expect(d.message).toMatch(/beside text in the flex container p: the text becomes an anonymous flex item \(css-flexbox-1 §4\) and the absolutely positioned child is not a flex item \(§4\.1\)/);
      expect(d.message).not.toMatch(/inline formatting context/);
      expect(d.why).toBe(CATALOGUE.DRAGON_UNSUPPORTED_VALUE.computedWhy);
      expect(d.why).not.toMatch(/proof/);
    }
  });
  it('in a block parent: the text\'s inline formatting context', () => {
    for (const d of refusal('block')) {
      expect(d.message).toMatch(/would place it in the text's inline formatting context \(CSS2 §9\.2\.1\.1\)/);
      expect(d.why).toBe(CATALOGUE.DRAGON_UNSUPPORTED_VALUE.computedWhy);
    }
  });
  it('profile refusals keep the profile why', () => {
    const c = both().compile(inputFor('.g { display: inline-grid; }', (r) => [div(r, 'g', ['g'])]));
    for (const d of c.diagnostics) expect(d.why).toBe(CATALOGUE.DRAGON_UNSUPPORTED_VALUE.why);
  });
});

describe('T039 M4: implicitly filled longhands are checked whatever the profile holds', () => {
  it('with every border-top-style:none row removed from a copy of the profiles, border: 3px is refused on border-top-style: none (set by border) at "3px"', () => {
    const strip = (rows: SupportProfiles['ios']['rows']) => rows.filter((r) => r.feature !== 'border-top-style:none');
    const profiles: SupportProfiles = { ios: { ...COMMITTED_PROFILES.ios, rows: strip(COMMITTED_PROFILES.ios.rows) }, web: { ...COMMITTED_PROFILES.web, rows: strip(COMMITTED_PROFILES.web.rows) } };
    expect(COMMITTED_PROFILES.ios.rows.some((r) => r.feature === 'border-top-style:none')).toBe(true);
    const input = inputFor(`${FONT} .a { border: 3px; }`, (r) => [div(r, 'a', ['a'])]);
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles: profiles }).compile(input);
    const hits = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(hits.map((d) => d.target).sort()).toEqual(['ios', 'web']);
    for (const d of hits) {
      expect(d.message.startsWith('border-top-style: none (set by border: 3px) is unsupported')).toBe(true);
      expect(spanTextOf(input, d)).toBe('3px');
    }
    // With the committed profiles the same declaration compiles clean in block flow (G1 proves the filled values there).
    expect(both().compile(input).diagnostics).toEqual([]);
  });
});

describe('the Ahem root environment (docs/api.md §10.1)', () => {
  it('rootFont ahem gives html font-family Ahem with cascade environment, inherited below; the public entry keeps the UA font', () => {
    const input = inputFor('.a { width: 5px; }', (r) => [div(r, 'a', ['a'])]);
    const env = createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem' }).compile(input);
    const at = (c: Compiled<'web'>, node: string) => {
      const r = c.explain({ target: 'web', at: { node, instance: 'doc' }, property: 'font-family' });
      if (r.kind !== 'found') throw new Error(r.kind);
      return r.cases[0];
    };
    expect(at(env, 'html')).toMatchObject({ value: 'Ahem', cascade: 'environment', origin: { kind: 'builtin', dataset: 'reference environment', entry: 'font-family Ahem' } });
    expect(at(env, 'a')).toMatchObject({ value: 'Ahem', cascade: 'inherited' });
    const pub = createProject({ projectId: 'test', targets: { web: {} } }).compile(input);
    expect(at(pub, 'html')).toMatchObject({ value: 'Times', cascade: 'initial' });
    expect(pub.digest).not.toBe(env.digest);
    const origin: Origin | undefined = at(pub, 'html')?.origin;
    expect(origin?.kind).toBe('builtin');
  });
});
