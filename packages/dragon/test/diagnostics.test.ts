import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ComponentDefinition, Diagnostic, DiagnosticCode, DraftTree, ElementNode, FrontEndResult, SourceFile, TreeNode } from '../src/index.ts';
import { createProject, formatDiagnostic } from '../src/index.ts';
import { applyFix, CATALOGUE, compiledCases, DIAGNOSTIC_CODES, iosLayoutProjection, MAX_STATE_ASSIGNMENTS } from '../src/internal.ts';
import { sha256Hex } from '../src/digest.ts';
import { always, and, eq, expectCatalogued, not, Sources, spanTextOf } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const both = () => createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });

// Codes shipped in S2 (cfcec43); a code may be added after them but never removed, renamed or reused (docs/api.md §9).
const S2_CODES = [
  'DRAGON_CONFIG_INVALID', 'DRAGON_INPUT_INVALID', 'DRAGON_PRODUCER_ERROR', 'DRAGON_INCOMPLETE_INPUT', 'DRAGON_SOURCE_HASH_MISMATCH',
  'DRAGON_SPAN_INVALID', 'DRAGON_TREE_SCHEMA', 'DRAGON_TREE_UNSUPPORTED', 'DRAGON_CSS_PARSE', 'DRAGON_CSS_INVALID_VALUE',
  'DRAGON_UNSUPPORTED_AT_RULE', 'DRAGON_UNSUPPORTED_SELECTOR', 'DRAGON_UNSUPPORTED_IMPORTANT', 'DRAGON_UNSUPPORTED_PROPERTY',
  'DRAGON_UNSUPPORTED_VALUE', 'DRAGON_UNSUPPORTED_ELEMENT', 'DRAGON_UNSUPPORTED_ATTRIBUTE', 'DRAGON_UNSUPPORTED_FONT', 'DRAGON_LOWERING_FAILED',
];

describe('the diagnostic catalogue (docs/api.md §6.1)', () => {
  it('has exactly one entry per DiagnosticCode, each with a message, a reason and a fix', () => {
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
    expect(Object.keys(CATALOGUE).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
    for (const code of DIAGNOSTIC_CODES) {
      const e = CATALOGUE[code];
      expect(e.message.length, code).toBeGreaterThan(0);
      expect(e.why.length, code).toBeGreaterThan(0);
      expect(e.fix.title.length, code).toBeGreaterThan(0);
      if (e.fix.kind === 'manual') expect(e.fix.manual.length, code).toBeGreaterThan(0);
    }
  });

  it('the committed code list only grows: S2 codes and the committed list are prefixes, in order, of the live list', () => {
    const committed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'diagnostic-codes.json'), 'utf8')) as string[];
    expect(DIAGNOSTIC_CODES.slice(0, S2_CODES.length)).toEqual(S2_CODES);
    expect(DIAGNOSTIC_CODES.slice(0, committed.length)).toEqual(committed);
    expect([...DIAGNOSTIC_CODES]).toEqual(committed);
  });
});

// !important is supported (css-cascade-5 §6.4), so the second edit fix is another unsupported property.
const CSS_FIX = '.a { width: 10px; clear: left; }\n.b { float: left; }\n';

describe('guarded fixes', () => {
  const src = new Sources({ 'app.dg': 'component App { <html><body><div a /><div b /></body></html> }', 'app.css': CSS_FIX });
  const input = (s: Sources) => s.input({
    modules: [{ id: 'm', source: s.ref('app.dg').uri }],
    components: [{
      id: 'App', module: 'm', params: [], states: [], slots: [], origin: s.at('app.dg', 'component App'),
      root: [{ kind: 'element', id: 'html', tag: 'html', classes: [], attributes: [], origin: s.at('app.dg', '<html>'), children: [
        { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], origin: s.at('app.dg', '<body>'), children: [
          { kind: 'element', id: 'a', tag: 'div', classes: [{ value: [{ when: always, value: { owner: 'doc', sheet: 'css', name: 'a' } }], origin: s.at('app.dg', '<div a') }], attributes: [], children: [], origin: s.at('app.dg', '<div a') },
          { kind: 'element', id: 'b', tag: 'div', classes: [{ value: [{ when: always, value: { owner: 'doc', sheet: 'css', name: 'b' } }], origin: s.at('app.dg', '<div b') }], attributes: [], children: [], origin: s.at('app.dg', '<div b') },
        ] },
      ] }],
    }],
    documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['css'], initial: [] }],
    styles: [{ id: 'css', css: s.whole('app.css'), scope: { kind: 'document' } }],
  });

  it('edit fixes carry revision and hash, apply atomically, and are refused when stale', () => {
    const c = both().compile(input(src));
    expectCatalogued(c.diagnostics);
    const clear = c.diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_PROPERTY' && d.message.startsWith('clear'));
    const property = c.diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_PROPERTY' && d.message.startsWith('float'));
    if (clear === undefined || property === undefined || clear.fix === null || property.fix === null) throw new Error('missing fixes');
    if ('manual' in clear.fix || 'manual' in property.fix) throw new Error('expected edit fixes');
    expect(clear.fix.edits[0]?.span.source).toEqual(src.ref('app.css'));
    const applied = applyFix({ title: 'both', edits: [...clear.fix.edits, ...property.fix.edits] }, c.sources);
    if (applied.kind !== 'applied') throw new Error(applied.kind);
    expect(applied.texts.get(src.ref('app.css').uri)).toBe('.a { width: 10px; ; }\n.b { ; }\n');

    const edited = new Sources({ 'app.dg': 'component App { <html><body><div a /><div b /></body></html> }', 'app.css': `${CSS_FIX}/* edited */\n` }, 'r2');
    const staleRevision = applyFix(clear.fix, [...edited.files.values()]);
    expect(staleRevision).toMatchObject({ kind: 'stale' });
    expect(staleRevision.kind === 'stale' && staleRevision.reason).toMatch(/revision r2/);
    const sameRevision = [...edited.files.values()].map((f): SourceFile => ({ ...f, ref: { ...f.ref, revision: 'r1' } }));
    const staleHash = applyFix(clear.fix, sameRevision);
    expect(staleHash).toMatchObject({ kind: 'stale' });
    expect(staleHash.kind === 'stale' && staleHash.reason).toMatch(/hash/);
    const lying = [...edited.files.values()].map((f): SourceFile => ({ ...f, ref: src.ref(f.displayPath) }));
    expect(applyFix(clear.fix, lying)).toMatchObject({ kind: 'stale' });
    expect(applyFix({ title: 't', manual: 'do it' }, c.sources)).toEqual({ kind: 'manual', instruction: 'do it' });
  });

  it('MF3: two edits that start at one offset in one source, either an insertion, are refused as stale in both orders', () => {
    const files = [...src.files.values()];
    const css = src.ref('app.css');
    const at = (start: number, end: number, replacement: string) => ({ span: { source: css, start, end }, replacement });
    const pairs = [
      [at(3, 3, 'X'), at(3, 3, 'Y')],
      [at(3, 3, 'Y'), at(3, 3, 'X')],
      [at(3, 3, 'X'), at(3, 5, 'Z')],
      [at(3, 5, 'Z'), at(3, 3, 'X')],
    ];
    for (const edits of pairs) {
      const r = applyFix({ title: 'two edits', edits }, files);
      expect(r.kind, JSON.stringify(edits.map((e) => [e.span.start, e.span.end, e.replacement]))).toBe('stale');
      expect(r.kind === 'stale' && r.reason).toMatch(/offset 3/);
    }
    // An insertion where another edit ends, or two edits at different offsets, has one result whatever the order.
    for (const edits of [[at(1, 3, 'Q'), at(3, 3, 'X')], [at(3, 3, 'X'), at(1, 3, 'Q')]]) {
      const r = applyFix({ title: 'adjacent', edits }, files);
      expect(r.kind === 'applied' && r.texts.get(css.uri)).toBe(`.QX{ width: 10px; clear: left; }\n.b { float: left; }\n`);
    }
  });

  it('formatDiagnostic locates origins through the source registry, lines and columns 1-based', () => {
    const c = both().compile(input(src));
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_PROPERTY' && x.message.startsWith('float')) as Diagnostic;
    const text = formatDiagnostic(d, c.sources);
    expect(text.split('\n')[0]).toBe('app.css:2:6: error DRAGON_UNSUPPORTED_PROPERTY: float is not supported in milestone 1');
    expect(text).toContain(`  why: ${CATALOGUE.DRAGON_UNSUPPORTED_PROPERTY.why}`);
    expect(text).toContain('  fix: Remove the declaration (1 guarded edit)');
    const unlocated: Diagnostic = { ...d, target: 'ios', origin: { kind: 'unlocated', reason: 'configuration' } };
    expect(formatDiagnostic(unlocated, c.sources).split('\n')[0]).toBe('<unlocated: configuration>: error DRAGON_UNSUPPORTED_PROPERTY [ios]: float is not supported in milestone 1');
  });
});

// A valid base document; each malformed or invalid case changes one thing in a copy of it.
const APP = [
  'component App(open: boolean = false) { <html><body><Toggle t /><Toggle u /></body></html> }',
  'component Toggle(checked: boolean = false) { <div box class="toggle {checked ? \'on\' : \'\'}" /> }',
  '<b>raw</b> <widget /> <div dup /> <Loop self />',
].join('\n');
const DOC_CSS = 'body { margin: 0; }\n';
const TOGGLE_CSS = '.toggle { width: 20px; height: 10px; }\n.on { width: 40px; }\n';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

function baseInput(s: Sources): FrontEndResult {
  const toggleRoot: ElementNode = {
    kind: 'element', id: 'box', tag: 'div', attributes: [], children: [], origin: s.at('app.dg', '<div box'),
    classes: [
      { value: [{ when: always, value: { owner: 'Toggle', sheet: 'toggle', name: 'toggle' } }], origin: s.at('app.dg', '<div box') },
      { value: [{ when: eq('checked', true), value: { owner: 'Toggle', sheet: 'toggle', name: 'on' } }, { when: not(eq('checked', true)), value: null }], origin: s.at('app.dg', "checked ? 'on' : ''") },
    ],
  };
  const call = (id: string): TreeNode => ({ kind: 'call', id, component: 'Toggle', args: [], aliases: [], slots: [], origin: s.at('app.dg', `<Toggle ${id} />`) });
  const tree: Omit<DraftTree, 'schema' | 'schemaRevision'> = {
    modules: [{ id: 'm', source: s.ref('app.dg').uri }],
    components: [
      {
        id: 'App', module: 'm', params: [], slots: [], origin: s.at('app.dg', 'component App'),
        states: [{ id: 'open', domain: [false, true], initial: false, origin: s.at('app.dg', 'open: boolean = false') }],
        root: [{ kind: 'element', id: 'html', tag: 'html', classes: [], attributes: [], origin: s.at('app.dg', '<html>'), children: [
          { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], origin: s.at('app.dg', '<body>'), children: [call('t'), call('u')] },
        ] }],
      },
      {
        id: 'Toggle', module: 'm', params: [], slots: [], origin: s.at('app.dg', 'component Toggle'),
        states: [{ id: 'checked', domain: [false, true], initial: false, origin: s.at('app.dg', 'checked: boolean = false') }],
        root: [toggleRoot],
      },
    ],
    documents: [{ id: 'doc', rootInstance: 'App', documentElement: 'html', styles: ['doc', 'toggle'], initial: [] }],
    styles: [
      { id: 'doc', css: s.whole('doc.css'), scope: { kind: 'document' } },
      { id: 'toggle', css: s.whole('toggle.css'), scope: { kind: 'component', owner: 'Toggle' } },
    ],
  };
  return s.input(tree);
}

const sources = (): Sources => new Sources({ 'app.dg': APP, 'doc.css': DOC_CSS, 'toggle.css': TOGGLE_CSS });

function mutated(change: (input: Mutable<FrontEndResult>, s: Sources) => void): FrontEndResult {
  const s = sources();
  const input = structuredClone(baseInput(s)) as unknown as Mutable<FrontEndResult>;
  change(input, s);
  return input as unknown as FrontEndResult;
}

const tree = (i: Mutable<FrontEndResult>): Mutable<DraftTree> => i.tree as Mutable<DraftTree>;
const toggle = (i: Mutable<FrontEndResult>): Mutable<ComponentDefinition> => tree(i).components[1] as Mutable<ComponentDefinition>;
const app = (i: Mutable<FrontEndResult>): Mutable<ComponentDefinition> => tree(i).components[0] as Mutable<ComponentDefinition>;
const body = (i: Mutable<FrontEndResult>): Mutable<ElementNode> => ((app(i).root[0] as Mutable<ElementNode>).children[0]) as Mutable<ElementNode>;

const CASES: readonly { readonly name: string; readonly code: DiagnosticCode; readonly span: string | null; readonly input: () => FrontEndResult }[] = [
  {
    name: 'a recovered producer error', code: 'DRAGON_PRODUCER_ERROR', span: '<b>raw</b>',
    input: () => mutated((i, s) => {
      i.diagnostics = [{ code: 'PARSE_RECOVERED', severity: 'error', target: null, origin: s.at('app.dg', '<b>raw</b>') as never, message: 'unexpected tag, recovered', why: 'recovered', related: [], fix: null, profile: null }];
    }),
  },
  {
    name: 'an unknown node kind', code: 'DRAGON_TREE_NODE_KIND', span: '<widget />',
    input: () => mutated((i, s) => { body(i).children.push({ kind: 'widget', id: 'w', origin: s.at('app.dg', '<widget />') } as never); }),
  },
  {
    name: 'raw HTML', code: 'DRAGON_TREE_RAW_HTML', span: '<b>raw</b>',
    input: () => mutated((i, s) => { body(i).children.push({ kind: 'raw-html', id: 'r', html: '<b>raw</b>', origin: s.at('app.dg', '<b>raw</b>') } as never); }),
  },
  {
    name: 'duplicate node ids', code: 'DRAGON_TREE_DUPLICATE_ID', span: '<div dup />',
    input: () => mutated((i, s) => {
      const box = toggle(i).root[0] as Mutable<ElementNode>;
      box.children.push({ kind: 'element', id: 'box', tag: 'div', classes: [], attributes: [], children: [], origin: s.at('app.dg', '<div dup />') as never });
    }),
  },
  {
    name: 'an alias cycle', code: 'DRAGON_ALIAS_CYCLE', span: '<Toggle t />',
    input: () => mutated((i) => {
      const [t, u] = body(i).children as Mutable<{ aliases: { local: { instance: string; state: string }; caller: { instance: string; state: string } }[] }>[];
      (t as { aliases: unknown[] }).aliases = [{ local: { instance: '.', state: 'checked' }, caller: { instance: 'doc/u', state: 'checked' } }];
      (u as { aliases: unknown[] }).aliases = [{ local: { instance: '.', state: 'checked' }, caller: { instance: 'doc/t', state: 'checked' } }];
    }),
  },
  {
    name: 'an alias domain mismatch', code: 'DRAGON_ALIAS_DOMAIN', span: '<Toggle t />',
    input: () => mutated((i) => {
      (app(i).states[0] as { domain: unknown[] }).domain = [false, true, 'maybe'];
      (body(i).children[0] as { aliases: unknown[] }).aliases = [{ local: { instance: '.', state: 'checked' }, caller: { instance: '.', state: 'open' } }];
    }),
  },
  {
    name: 'an initial value outside its domain', code: 'DRAGON_STATE_VALUE_DOMAIN', span: 'checked: boolean = false',
    input: () => mutated((i) => { (toggle(i).states[0] as { initial: unknown }).initial = 'false'; }),
  },
  {
    name: 'a document initial value outside its domain', code: 'DRAGON_STATE_VALUE_DOMAIN', span: 'component App',
    input: () => mutated((i) => { (tree(i).documents[0] as { initial: unknown[] }).initial = [{ state: { instance: 'doc/t', state: 'checked' }, value: 1 }]; }),
  },
  {
    name: 'overlapping choice arms', code: 'DRAGON_CHOICE_OVERLAP', span: "checked ? 'on' : ''",
    input: () => mutated((i) => { ((toggle(i).root[0] as Mutable<ElementNode>).classes[1] as { value: unknown[] }).value = [{ when: eq('checked', true), value: { owner: 'Toggle', sheet: 'toggle', name: 'on' } }, { when: always, value: null }]; }),
  },
  {
    name: 'missing choice arms', code: 'DRAGON_CHOICE_MISSING', span: "checked ? 'on' : ''",
    input: () => mutated((i) => { ((toggle(i).root[0] as Mutable<ElementNode>).classes[1] as { value: unknown[] }).value = [{ when: eq('checked', true), value: { owner: 'Toggle', sheet: 'toggle', name: 'on' } }]; }),
  },
  {
    name: 'an unknown state reference', code: 'DRAGON_STATE_UNKNOWN', span: "checked ? 'on' : ''",
    input: () => mutated((i) => { ((toggle(i).root[0] as Mutable<ElementNode>).classes[1] as { value: unknown[] }).value = [{ when: eq('hovered', true), value: null }, { when: not(eq('hovered', true)), value: null }]; }),
  },
  ...([[false, -0], [false, Number.NaN], [false, Number.POSITIVE_INFINITY], [], [true, true]] as const).map((domain) => ({
    name: `the invalid domain ${JSON.stringify(domain.map(String))}`, code: 'DRAGON_STATE_DOMAIN_INVALID' as const, span: 'checked: boolean = false',
    input: () => mutated((i) => { (toggle(i).states[0] as { domain: unknown[] }).domain = [...domain]; }),
  })),
  {
    name: 'a stale source hash', code: 'DRAGON_SOURCE_HASH_MISMATCH', span: null,
    input: () => mutated((i) => { ((i.snapshot.sources[2] as Mutable<SourceFile>).ref).hash = `sha256:${sha256Hex('.toggle { }')}`; }),
  },
  {
    name: 'a span outside its source', code: 'DRAGON_SPAN_INVALID', span: null,
    input: () => mutated((i) => { ((toggle(i).root[0] as Mutable<ElementNode>).origin as { span: { end: number } }).span.end = APP.length + 5; }),
  },
  {
    name: 'a component call cycle', code: 'DRAGON_CALL_CYCLE', span: '<Loop self />',
    input: () => mutated((i, s) => { (toggle(i).root[0] as Mutable<ElementNode>).children.push({ kind: 'call', id: 'self', component: 'Toggle', args: [], aliases: [], slots: [], origin: s.at('app.dg', '<Loop self />') as never }); }),
  },
  {
    name: 'conflicting initial values through an alias', code: 'DRAGON_INITIAL_CONFLICT', span: 'component App',
    input: () => mutated((i) => {
      (body(i).children[0] as { aliases: unknown[] }).aliases = [{ local: { instance: '.', state: 'checked' }, caller: { instance: '.', state: 'open' } }];
      (tree(i).documents[0] as { initial: unknown[] }).initial = [{ state: { instance: 'doc', state: 'open' }, value: true }, { state: { instance: 'doc/t', state: 'checked' }, value: false }];
    }),
  },
  {
    name: 'a class symbol owned by another component', code: 'DRAGON_CLASS_OWNER', span: '<body>',
    input: () => mutated((i, s) => { (body(i).classes as unknown[]).push({ value: [{ when: always, value: { owner: 'Toggle', sheet: 'toggle', name: 'toggle' } }], origin: s.at('app.dg', '<body>') }); }),
  },
  {
    name: 'a call to an unknown component', code: 'DRAGON_TREE_REFERENCE', span: '<Toggle u />',
    input: () => mutated((i) => { (body(i).children[1] as { component: string }).component = 'Missing'; }),
  },
  {
    name: 'a wrong schema revision', code: 'DRAGON_TREE_SCHEMA', span: null,
    input: () => mutated((i) => { tree(i).schemaRevision = '0.1'; }),
  },
  {
    name: 'a state space above the limit', code: 'DRAGON_STATE_SPACE_LIMIT', span: 'component App',
    input: () => mutated((i, s) => {
      (app(i).states as unknown[]).push(...Array.from({ length: 10 }, (_, k) => ({ id: `s${k}`, domain: [false, true], initial: false, origin: s.at('app.dg', 'open: boolean = false') })));
    }),
  },
];

describe('malformed and invalid input blocks every affected output (docs/api.md §2.2, §3.4)', () => {
  it('the base document compiles, with 8 reachable cases (open, t.checked, u.checked)', () => {
    const c = both().compile(baseInput(sources()));
    expect(c.diagnostics).toEqual([]);
    expect(c.ok).toBe(true);
    expect(compiledCases(c).length).toBe(8);
    for (const k of compiledCases(c)) expect(iosLayoutProjection(c, ENV, k.assignment).kind).toBe('ready');
  });
  for (const k of CASES) {
    it(`${k.name}: ${k.code}, located${k.span === null ? ' nowhere (unlocated)' : ` at "${k.span}"`}, no projection and no web files`, () => {
      const input = k.input();
      const c = both().compile(input);
      const hits = c.diagnostics.filter((d) => d.code === k.code);
      expect(hits.length, JSON.stringify(c.diagnostics.map((d) => [d.code, d.message]))).toBeGreaterThan(0);
      const d = hits[0] as Diagnostic;
      if (k.span === null) expect(d.origin.kind).toBe('unlocated');
      else expect(spanTextOf(input, d)).toBe(k.span);
      expect(d.target).toBeNull();
      expectCatalogued(c.diagnostics);
      expect(c.ok).toBe(false);
      expect(c.targets).toEqual({ ios: 'blocked', web: 'blocked' });
      expect(c.outputs.ios.kind).toBe('blocked');
      expect(c.outputs.web.kind).toBe('blocked');
      expect('files' in c.outputs.web).toBe(false);
      expect(iosLayoutProjection(c, ENV, []).kind).toBe('blocked');
      for (const k2 of compiledCases(c)) expect(iosLayoutProjection(c, ENV, k2.assignment).kind).toBe('blocked');
      expect(both().check(input).diagnostics.map((x) => x.code)).toEqual(c.diagnostics.map((x) => x.code));
    });
  }
  it(`the state space limit is ${MAX_STATE_ASSIGNMENTS}: exactly at it compiles every case, one state more blocks`, () => {
    const at = mutated((i, s) => {
      (app(i).states as unknown[]).push(...Array.from({ length: 7 }, (_, k) => ({ id: `s${k}`, domain: [false, true], initial: false, origin: s.at('app.dg', 'open: boolean = false') })));
    });
    const c = createProject({ projectId: 'test', targets: { web: {} } }).compile(at);
    expect(c.ok).toBe(true);
    expect(compiledCases(c).length).toBe(MAX_STATE_ASSIGNMENTS);
  });
  it('conditions compare type plus value: an eq on "true" never matches the boolean true', () => {
    const input = mutated((i) => {
      (toggle(i).states[0] as { domain: unknown[] }).domain = [false, true, 'true', 1];
      ((toggle(i).root[0] as Mutable<ElementNode>).classes[1] as { value: unknown[] }).value = [
        { when: eq('checked', 'true'), value: { owner: 'Toggle', sheet: 'toggle', name: 'on' } },
        { when: not(eq('checked', 'true')), value: null },
      ];
    });
    const c = both().compile(input);
    expect(c.ok).toBe(true);
    expect(compiledCases(c).length).toBe(32);
    const widths = (value: unknown) => {
      const r = c.explain({ target: 'web', at: { node: 'box', instance: 'doc/t' }, property: 'width', assignment: [{ state: { instance: 'doc/t', state: 'checked' }, value: value as never }, { state: { instance: 'doc/u', state: 'checked' }, value: false }, { state: { instance: 'doc', state: 'open' }, value: false }] });
      if (r.kind !== 'found') throw new Error(JSON.stringify(r));
      return r.cases.map((x) => x.value);
    };
    expect(widths(true)).toEqual(['20px']);
    expect(widths('true')).toEqual(['40px']);
    expect(widths(1)).toEqual(['20px']);
    const bad = c.explain({ target: 'web', at: { node: 'box', instance: 'doc/t' }, property: 'width', assignment: [{ state: { instance: 'doc/t', state: 'checked' }, value: 'yes' }] });
    expect(bad.kind).toBe('invalid-query');
    if (bad.kind === 'invalid-query') expect(bad.diagnostics.map((x) => x.code)).toEqual(['DRAGON_STATE_VALUE_DOMAIN']);
  });
  it('a condition value outside the domain is rejected, located at its binding', () => {
    const input = mutated((i) => {
      ((toggle(i).root[0] as Mutable<ElementNode>).classes[1] as { value: unknown[] }).value = [
        { when: and(eq('checked', 'on')), value: null },
        { when: not(eq('checked', 'on')), value: null },
      ];
    });
    const c = both().compile(input);
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_STATE_VALUE_DOMAIN');
    expect(d === undefined ? null : spanTextOf(input, d)).toBe("checked ? 'on' : ''");
    expect(c.outputs.web.kind).toBe('blocked');
  });
});
