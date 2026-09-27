import { describe, expect, it } from 'vitest';
import * as publicEntry from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { compiledFeatures, iosLayoutProjection } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const ios = () => createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' } } });

describe('createProject().compile() and check()', () => {
  it('compiles supported CSS to an analysis-only ios output with a layout projection', () => {
    const css = '.a { width: 50px; height: 10px; }';
    const c = ios().compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
    expect(c.ok).toBe(true);
    expect(c.targets.ios).toBe('checked');
    expect(c.outputs.ios.kind).toBe('analysis-only');
    const p = iosLayoutProjection(c, { width: 400, height: 300 });
    expect(p.kind).toBe('ready');
    expect(c.explain({ target: 'ios', node: 'a', property: 'width' })).toMatchObject({ kind: 'resolved', value: '50px', origin: 'author' });
    expect(c.explain({ target: 'ios', node: 'body', property: 'margin-top' })).toMatchObject({ value: '8px', origin: 'user-agent' });
    expect(c.explain({ target: 'ios', node: 'a', property: 'min-width' })).toMatchObject({ value: 'auto', origin: 'initial' });
    expect(compiledFeatures(c, 'ios')).toEqual(['height:<length>', 'width:<length>']);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('rejects display: grid with a typed diagnostic, a UTF-16 span and a blocked ios output', () => {
    const css = '.g { display: grid; }';
    const c = ios().compile(inputFor(css, (r) => [div(r, 'g', ['g'])]));
    expect(c.ok).toBe(false);
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(d).toBeDefined();
    if (d === undefined || d.span === null) throw new Error('no span');
    expect(css.slice(d.span.start, d.span.end)).toBe('grid');
    expect(d.targets).toEqual(['ios']);
    expect(d.fix).toMatch(/block|flex|none/);
    expect(c.outputs.ios.kind).toBe('blocked');
    expect(iosLayoutProjection(c, { width: 400, height: 300 }).kind).toBe('blocked');
  });

  it('check() reports the same diagnostics without outputs', () => {
    const input = inputFor('.g { float: left; }', (r) => [div(r, 'g', ['g'])]);
    const r = ios().check(input);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_PROPERTY']);
    expect('outputs' in r).toBe(false);
  });

  it('web has no proven features in S1, so authored CSS blocks it', () => {
    const c = createProject({ projectId: 'test', targets: { web: {} } }).compile(inputFor('.a { width: 1px; }', (r) => [div(r, 'a', ['a'])]));
    expect(c.targets.web).toBe('blocked');
  });

  it('is deterministic: the same snapshot gives the same digest', () => {
    const input = inputFor('.a { width: 1px; }', (r) => [div(r, 'a', ['a'])]);
    expect(ios().compile(input).digest).toBe(ios().compile(input).digest);
  });

  it('verifies source hashes and propagates producer errors', () => {
    const bad = inputFor('.a{}', () => [], { hash: 'sha256:00' });
    expect(ios().check(bad).diagnostics.map((d) => d.code)).toContain('DRAGON_SOURCE_HASH_MISMATCH');
    const good = inputFor('.a{}', () => []);
    const withError = { ...good, diagnostics: [{ code: 'DRAGON_INPUT_INVALID' as const, severity: 'error' as const, message: 'parse failed', span: null, targets: [], fix: null }] };
    const r = ios().compile(withError);
    expect(r.diagnostics.map((d) => d.code)).toContain('DRAGON_PRODUCER_ERROR');
    expect(r.outputs.ios.kind).toBe('blocked');
  });

  it('diagnoses unknown targets before compiling', () => {
    const p = createProject({ projectId: 'test', targets: { android: {} } as unknown as { ios: { minimum: string } } });
    expect(p.check(inputFor('', () => [])).diagnostics.map((d) => d.code)).toEqual(['DRAGON_CONFIG_INVALID']);
  });

  it('rejects unsupported elements, attributes, selectors and !important', () => {
    const css = '#x { width: 1px; } .a { height: 1px !important; }';
    const c = ios().compile(inputFor(css, (r) => [{ ...div(r, 'a', ['a']), tag: 'span', attributes: [{ name: 'style', value: 'width:1px' }] }]));
    expect(c.diagnostics.map((d) => d.code).sort()).toEqual([
      'DRAGON_UNSUPPORTED_ATTRIBUTE', 'DRAGON_UNSUPPORTED_ELEMENT', 'DRAGON_UNSUPPORTED_IMPORTANT', 'DRAGON_UNSUPPORTED_SELECTOR',
    ]);
  });

  it('cascades by specificity then order, and writes inherited text styles onto text nodes', () => {
    const css = 'div { width: 1px; } .a { width: 2px; } div { width: 3px; } body { font-family: Ahem; font-size: 20px; line-height: 1.5; }';
    const c = ios().compile(inputFor(css, (r) => [div(r, 'a', ['a'], [{ kind: 'text', id: 'a:text0', text: '  XX \n X ', origin: { source: r, start: 0, end: 0 } }])]));
    expect(c.explain({ target: 'ios', node: 'a', property: 'width' })).toMatchObject({ value: '2px' });
    const p = iosLayoutProjection(c, { width: 400, height: 300 });
    if (p.kind !== 'ready') throw new Error(p.reason);
    const a = p.input.root.children[0]?.kind === 'box' ? p.input.root.children[0].children[0] : undefined;
    const text = a?.kind === 'box' ? a.children[0] : undefined;
    expect(text).toEqual({ kind: 'text', id: 'a:text0', text: 'XX X', font: { family: 'Ahem', size: 20 }, lineHeight: { kind: 'number', value: 1.5 } });
  });

  it('the public entry exposes only the public API', () => {
    expect(Object.keys(publicEntry).sort()).toEqual(['TREE_SCHEMA_REVISION', 'createProject']);
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
      if (d === undefined || d.span === null) throw new Error('no span');
      expect(css.slice(d.span.start, d.span.end)).toBe(value);
    });
  }
  it('negative margins are valid CSS', () => {
    const c = ios().check(inputFor('.a { margin-top: -1px; }', (r) => [div(r, 'a', ['a'])]));
    expect(c.diagnostics.map((d) => d.code)).not.toContain('DRAGON_CSS_INVALID_VALUE');
  });
});
