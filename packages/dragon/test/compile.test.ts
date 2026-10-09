import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as publicEntry from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS, resolvedColors, webClassMap } from '../src/internal.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import type { Diagnostic } from '../src/index.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf, text as textNode } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const ios = () => createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' } } });

describe('createProject().compile() and check()', () => {
  it('compiles supported CSS to an analysis-only ios output with a layout projection', () => {
    const css = '.a { width: 50px; height: 10px; }';
    const c = ios().compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
    expect(c.ok).toBe(true);
    expect(c.targets.ios).toBe('checked');
    expect(c.outputs.ios.kind).toBe('analysis-only');
    const p = iosLayoutProjection(c, ENV, []);
    expect(p.kind).toBe('ready');
    const width = explainOne(c, 'ios', 'a', 'width');
    expect(width).toMatchObject({ value: '50px', cascade: 'author', support: { feature: 'width:<length-px>', context: 'block/ltr', status: 'exact' } });
    expect(width.origin.kind === 'authored' && css.slice(width.origin.span.start, width.origin.span.end)).toBe('width: 50px');
    expect(explainOne(c, 'ios', 'body', 'margin-top')).toMatchObject({ value: '8px', cascade: 'user-agent', origin: { kind: 'builtin', entry: 'body margin-top' } });
    expect(explainOne(c, 'ios', 'a', 'min-width')).toMatchObject({ value: 'auto', cascade: 'initial', origin: { kind: 'builtin' } });
    expect(compiledFeatures(c, 'ios', [])).toEqual(['height:<length-px>@block/ltr', 'width:<length-px>@block/ltr']);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('rejects display: grid with a typed diagnostic, a UTF-16 span and a blocked ios output', () => {
    const css = '.g { display: grid; }';
    const c = ios().compile(inputFor(css, (r) => [div(r, 'g', ['g'])]));
    expect(c.ok).toBe(false);
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
    if (d === undefined || d.origin.kind !== 'authored') throw new Error('no span');
    expect(css.slice(d.origin.span.start, d.origin.span.end)).toBe('grid');
    expect(d.target).toBe('ios');
    expect(d.fix !== null && 'manual' in d.fix ? d.fix.manual : '').toMatch(/block|flex|none/);
    expect(d.profile).toMatchObject({ target: 'ios', feature: 'display:grid', status: 'unsupported' });
    expectCatalogued(c.diagnostics);
    expect(c.outputs.ios.kind).toBe('blocked');
    expect(iosLayoutProjection(c, ENV, []).kind).toBe('blocked');
  });

  it('check() reports the same diagnostics without outputs', () => {
    const input = inputFor('.g { float: left; }', (r) => [div(r, 'g', ['g'])]);
    const r = ios().check(input);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_PROPERTY']);
    expect('outputs' in r).toBe(false);
  });

  it('web output is ready: one rule per element, every longhand written, no authored selectors, class map internal', () => {
    const css = '.a.b { width: 1px; } body .a { height: 33.3px; }';
    const c = createProject({ projectId: 'test', targets: { web: {} } }).compile(inputFor(css, (r) => [div(r, 'a', ['a', 'b'])]));
    expect(c.targets.web).toBe('checked');
    const out = c.outputs.web;
    if (out.kind !== 'ready') throw new Error(out.kind);
    expect(out.digest).toBe(c.digest);
    expect(out.files.map((f) => f.path)).toEqual(['dragon.css']);
    const text = (out.files[0] as { text: string }).text;
    const rules = text.split('\n').filter((l) => l.endsWith('{'));
    expect(rules).toEqual(['.dg0 {', '.dg1 {', '.dg2 {']);
    expect(text).not.toMatch(/\.a\b|\.b\b|body|html/);
    // Every longhand is written on every rule, except the insets, which are written only when one of them is not auto, and the
    // outline longhands, which are written only when an author declaration sets one (Chrome's UA :focus-visible ring stays).
    const unwritten = ['top', 'right', 'bottom', 'left', 'outline-color', 'outline-style', 'outline-width', 'outline-offset'];
    for (const p of LONGHANDS) expect(text.split(`  ${p}: `).length - 1, p).toBe(unwritten.includes(p) ? 0 : 3);
    expect(text).toContain('  width: 1px;');
    expect(text).toContain('  height: 33.3px;');
    expect(text).toContain('  margin-top: 8px;');
    expect(webClassMap(c, [])).toEqual(new Map([['html', 'dg0'], ['body', 'dg1'], ['a', 'dg2']]));
    expect(Object.keys(c).sort()).not.toContain('classOf');
  });

  it('web and ios share the resolved result; unsupported web features block only web', () => {
    const c = createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } }).compile(inputFor('.a { width: 1px; }', (r) => [div(r, 'a', ['a'])]));
    expect(c.outputs.web.kind).toBe('ready');
    expect(c.outputs.ios.kind).toBe('analysis-only');
    const g = createProject({ projectId: 'test', targets: { web: {} } }).compile(inputFor('.a { float: left; }', (r) => [div(r, 'a', ['a'])]));
    expect(g.outputs.web.kind).toBe('blocked');
  });

  it('checks longhands a shorthand fills (S1 must-fix 3): border: 3px sets border-*-style: none, proven in block flow but not on a relatively positioned box', () => {
    // S4b generator G1 proves every initial value in block and flex contexts, so the filled longhands pass there.
    expect(ios().compile(inputFor('.a { border: 3px; }', (r) => [div(r, 'a', ['a'])])).diagnostics).toEqual([]);
    const input = inputFor('.a { position: relative; border: 3px; }', (r) => [div(r, 'a', ['a'])]);
    const c = ios().compile(input);
    // T005 rec 2: the message starts with the filled longhand, names the shorthand declaration, and says what is unproven.
    const d = c.diagnostics.find((x) => x.message.startsWith('border-top-style:none (set by border: 3px) on a is used in the relative-in-block/ltr context'));
    expect(d?.message).toMatch(/border sets border-top-style, which is unproven here/);
    expect(d?.code).toBe('DRAGON_UNPROVEN_CONTEXT');
    expect(spanTextOf(input, d as Diagnostic)).toBe('3px');
    expect(c.outputs.ios.kind).toBe('blocked');
  });

  it('resolves colours to channels, inherits color and resolves currentcolor borders', () => {
    const css = 'body { color: hsl(120 50% 50%); } .a { background-color: #a1b2c37f; border: 1px solid; border-left-color: rgba(10, 20, 30, 0.3); }';
    const input = inputFor(css, (r) => [div(r, 'a', ['a'])]);
    // S4b: colour rows are keyed @paint/<direction>, not by formatting context, so the enforcing compile accepts hsl() on body.
    expect(ios().compile(input).diagnostics).toEqual([]);
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    expect(c.ok).toBe(true);
    const colors = resolvedColors(c, [])?.get('a');
    expect(colors?.color).toEqual({ r: 64, g: 191, b: 64, alpha: 255 });
    expect(colors?.['background-color']).toEqual({ r: 161, g: 178, b: 195, alpha: 127 });
    expect(colors?.['border-top-color']).toEqual({ r: 64, g: 191, b: 64, alpha: 255 });
    expect(colors?.['border-left-color']).toEqual({ r: 10, g: 20, b: 30, alpha: 77 });
    expect(explainOne(c, 'ios', 'a', 'color')).toMatchObject({ value: 'rgb(64, 191, 64)', cascade: 'inherited', origin: { kind: 'inherited', element: 'body' } });
  });

  it('refuses colour syntax outside the milestone subset with DRAGON_UNSUPPORTED_VALUE on its span', () => {
    for (const value of ['lab(50% 40 59)', 'color-mix(in srgb, red, blue)', 'Canvas', 'light-dark(red, blue)', 'hwb(1 2% 3%)', 'oklch(0.5 0.1 20)']) {
      const css = `.a { color: ${value}; }`;
      const c = createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
      const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
      if (d === undefined || d.origin.kind !== 'authored') throw new Error(`${value}: no diagnostic`);
      expect(css.slice(d.origin.span.start, d.origin.span.end)).toBe(value);
      expect(d.target).toBeNull();
      expect(c.outputs.web.kind).toBe('blocked');
      expect(c.outputs.ios.kind).toBe('blocked');
    }
  });

  it('internal faults: variant collapse ignores the last class of a compound; colour-only moves red channels only', () => {
    const css = '.a { width: 10px; } .a.on { width: 20px; }';
    const input = inputFor(css, (r) => [div(r, 'a', ['a'])]);
    const project = (faults: typeof NO_FAULTS) => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults, profiles: 'enforce', direction: 'ltr' });
    expect(explainOne(project(NO_FAULTS).compile(input), 'ios', 'a', 'width')).toMatchObject({ value: '10px' });
    expect(explainOne(project({ ...NO_FAULTS, variantCollapse: true }).compile(input), 'ios', 'a', 'width')).toMatchObject({ value: '20px' });
    const faulty = resolvedColors(project({ ...NO_FAULTS, colourOnly: true }).compile(input), [])?.get('a');
    expect(faulty?.color).toEqual({ r: 1, g: 0, b: 0, alpha: 255 });
    expect(faulty?.['background-color']).toEqual({ r: 0, g: 0, b: 0, alpha: 0 });
  });

  it('is deterministic: the same snapshot gives the same digest and byte-identical web output', () => {
    const input = inputFor('.a { width: 1px; }', (r) => [div(r, 'a', ['a'])]);
    expect(ios().compile(input).digest).toBe(ios().compile(input).digest);
    const web = () => createProject({ projectId: 'test', targets: { web: {} } }).compile(input).outputs.web;
    expect(JSON.stringify(web())).toBe(JSON.stringify(web()));
  });

  it('verifies source hashes and propagates producer errors', () => {
    const bad = inputFor('.a{}', () => [], { hash: 'sha256:00' });
    expect(ios().check(bad).diagnostics.map((d) => d.code)).toContain('DRAGON_SOURCE_HASH_MISMATCH');
    const good = inputFor('.a{}', () => []);
    const withError = { ...good, diagnostics: [{ code: 'PRODUCER_SYNTAX', severity: 'error' as const, target: null, origin: { kind: 'unlocated' as const, reason: 'test' }, message: 'parse failed', why: '', related: [], fix: null, profile: null }] };
    const r = ios().compile(withError);
    expect(r.diagnostics.map((d) => d.code)).toContain('DRAGON_PRODUCER_ERROR');
    expect(r.outputs.ios.kind).toBe('blocked');
  });

  it('diagnoses unknown targets before compiling', () => {
    const p = createProject({ projectId: 'test', targets: { android: {} } as unknown as { ios: { minimum: string } } });
    expect(p.check(inputFor('', () => [])).diagnostics.map((d) => d.code)).toEqual(['DRAGON_CONFIG_INVALID']);
  });

  it('rejects unsupported elements, attributes and selectors, and accepts !important (css-cascade-5 §6.4)', () => {
    const css = '.a:focus-within { width: 1px; } .a { height: 1px !important; }';
    const c = ios().compile(inputFor(css, (r) => [{ ...div(r, 'a', ['a']), tag: 'pre', attributes: [{ name: 'style', value: [{ when: { kind: 'true' }, value: 'width:1px' }], origin: { kind: 'unlocated', reason: 'test' } }] }]));
    expect(c.diagnostics.map((d) => d.code).sort()).toEqual([
      'DRAGON_UNSUPPORTED_ATTRIBUTE', 'DRAGON_UNSUPPORTED_ELEMENT', 'DRAGON_UNSUPPORTED_SELECTOR',
    ]);
  });

  it('cascades by specificity then order, and writes inherited text styles onto text nodes', () => {
    const css = 'div { width: 1px; } .a { width: 2px; } div { width: 3px; } body { font-family: Ahem; font-size: 20px; line-height: 1.5; }';
    const c = ios().compile(inputFor(css, (r) => [div(r, 'a', ['a'], [textNode(r, 't', '  XX \n X ')])]));
    const width = explainOne(c, 'ios', 'a', 'width');
    expect(width).toMatchObject({ value: '2px' });
    expect(width.losing.length).toBe(2);
    const p = iosLayoutProjection(c, ENV, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const a = p.input.root.children[0]?.kind === 'box' ? p.input.root.children[0].children[0] : undefined;
    const text = a?.kind === 'box' ? a.children[0] : undefined;
    expect(text).toEqual({ kind: 'text', id: 'a:text0', text: 'XX X', font: { family: 'Ahem', size: 20, specifiedSize: { kind: 'px', value: 20 }, absoluteSize: true }, lineHeight: { kind: 'number', value: 1.5 }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' });
  });

  it('the public entry exposes only the public API', () => {
    expect(Object.keys(publicEntry).sort()).toEqual(['TREE_SCHEMA_REVISION', 'createProject', 'formatDiagnostic', 'formatDiagnostics', 'querySupport']);
  });

  it('MF2: the default-condition entry exports none of the internal switches, and createProject takes no options', () => {
    for (const name of ['createProjectWith', 'InternalOptions', 'NO_FAULTS', 'applyFix', 'textTopology', 'iosLayoutProjection', 'REFERENCE_PLATFORM', 'uaDatasetFor', 'COMMITTED_PROFILES']) expect(name in publicEntry, name).toBe(false);
    expect(createProject.length).toBe(1);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, Record<string, string>> };
    expect(pkg.exports).toEqual({ '.': { 'dragon-internal': './src/internal.ts', default: './src/index.ts' } });
  });

  it('MF2: the compilation digest covers the profiles mode, so a derive-mode result never shares a digest with an enforced one', () => {
    const input = inputFor('.a { width: 1px; }', (r) => [div(r, 'a', ['a'])]);
    const config = { projectId: 'test', targets: { ios: { minimum: '15.0' } } } as const;
    const enforced = createProjectWith(config, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(input);
    const derived = createProjectWith(config, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    expect(enforced.digest).toBe(ios().compile(input).digest);
    expect(derived.digest).not.toBe(enforced.digest);
  });
});

describe('webref grammar range checks for milestone properties', () => {
  const rejected: [string, string][] = [
    ['padding-top', '-1px'], ['padding', '-1px'], ['padding-left', '-5%'],
    ['border-top-width', '-1px'], ['border-width', '-2px'],
    ['width', '-1px'], ['height', '-1px'], ['min-width', '-1px'], ['min-height', '-1px'], ['max-width', '-1px'], ['max-height', '-1px'],
    ['flex-grow', '-1'], ['flex-shrink', '-1'], ['flex-basis', '-1px'], ['order', '1.5'],
    ['row-gap', '-1px'], ['column-gap', '-1px'], ['gap', '-1px'],
    ['font-size', '-1px'], ['line-height', '-1'],
    ['display', 'blockish'], ['justify-content', 'middle'],
  ];
  for (const [prop, value] of rejected) {
    it(`${prop}: ${value} is invalid`, () => {
      const css = `.a { ${prop}: ${value}; }`;
      const c = ios().check(inputFor(css, (r) => [div(r, 'a', ['a'])]));
      expect(c.diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      const d = c.diagnostics[0];
      if (d === undefined || d.origin.kind !== 'authored') throw new Error('no span');
      expect(css.slice(d.origin.span.start, d.origin.span.end)).toBe(value);
      expectCatalogued(c.diagnostics);
    });
  }
  it('negative margins are valid CSS', () => {
    const c = ios().check(inputFor('.a { margin-top: -1px; }', (r) => [div(r, 'a', ['a'])]));
    expect(c.diagnostics.map((d) => d.code)).not.toContain('DRAGON_CSS_INVALID_VALUE');
  });
});
