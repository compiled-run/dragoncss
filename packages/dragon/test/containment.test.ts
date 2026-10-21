// CONTAIN: contain parses every value Chrome 145 keeps to its canonical serialization, compiles where Dragon lays it out, and is refused
// where it does not (analysis/containment.ts). The Chrome cases are containment-layout and reject-contain-size-flex of
// fixture-groups/scroll-containment.ts (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/containment.css', revision: 'r1', hash: 'sha256:0' };

/** contain's computed value for one written value, or its diagnostics' codes. */
function parsed(v: string): string {
  const css = `.a { contain: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code).join(' ');
  const l = rules[0]?.declarations[0]?.longhands ?? [];
  return l.map((x) => valueToString(x.value)).join(' ');
}

const project = () =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error's message up to ' is unsupported' (or its code), for .s on <div> a holding .c on <div> b holding Ahem text. */
function errorsAt(outer: string, inner = '', tag = 'div'): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${outer}; } .c { ${inner} }`;
  const c = project().compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', tag, ['c'], [text(r, 't', 'XX')])])]));
  return [...new Set(c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message.split(':').slice(0, 2).join(':').split(' is unsupported')[0]}`))].sort();
}

describe('contain', () => {
  it('parses to the canonical order, writing the full sets as strict and content, and drops what Chrome drops', () => {
    expect(['none', 'NONE', 'Strict', 'content', 'paint LAYOUT', 'style size', 'inline-size layout', 'size layout style paint', 'paint style layout', 'size paint layout style']
      .map(parsed)).toEqual(['none', 'none', 'strict', 'content', 'layout paint', 'size style', 'inline-size layout', 'strict', 'content', 'strict']);
    for (const v of ['none none', 'none layout', 'layout layout', 'size inline-size', 'strict layout', 'content paint', 'view-transition', '1px', 'layout, paint']) expect(parsed(v), v).toBe('DRAGON_CSS_INVALID_VALUE');
  });

  it('compiles layout, paint and style containment, and size containment with layout on a block', () => {
    for (const d of ['contain: layout', 'contain: paint', 'contain: style', 'contain: content', 'contain: strict; width: 50px', 'contain: size layout', 'contain: inline-size layout style paint']) {
      expect(errorsAt(d), d).toEqual([]);
    }
    // On an inline box only style containment applies, so size containment there needs no layout containment.
    expect(errorsAt('', 'contain: size', 'span')).toEqual([]);
  });

  it('refuses what Dragon does not lay out, at the contain declaration', () => {
    expect(errorsAt('contain: size')).toEqual(['DRAGON_UNSUPPORTED_VALUE contain: size on <div> a']);
    expect(errorsAt('display: flex; contain: strict')).toEqual(['DRAGON_UNSUPPORTED_VALUE contain: strict on <div> a']);
    expect(errorsAt('display: grid', 'contain: strict')).toEqual(['DRAGON_UNSUPPORTED_VALUE contain: strict on <div> b']);
    // An absolutely positioned item is not laid out by its flex container.
    expect(errorsAt('display: flex; position: relative', 'contain: strict; position: absolute')).toEqual([]);
    expect(errorsAt('contain: layout', 'position: fixed')).toEqual(['DRAGON_UNSUPPORTED_VALUE contain: layout on <div> a']);
    expect(errorsAt('contain: paint', 'position: absolute')).toEqual([]);
  });

  it('refuses a contained block in a line-clamp container, whose lines Chrome does not count, and a shadow on a contained box', () => {
    const clamp = 'display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden';
    expect(errorsAt(clamp)).toEqual([]);
    for (const c of ['contain: layout', 'contain: paint', 'contain: size layout']) expect(errorsAt(clamp, c).length, c).toBeGreaterThan(0);
    expect([...new Set(errorsAt('contain: layout; box-shadow: 1px 1px red').map((m) => m.split(';')[0]))]).toEqual(['DRAGON_UNSUPPORTED_VALUE a has a box-shadow and contain: layout or paint']);
  });

  it('keeps style containment on <body>, where it only scopes list item ordinals', () => {
    const at = (d: string): string[] => {
      const css = `body { font-family: Ahem; font-size: 10px; ${d}; }`;
      return project().compile(inputFor(css, (r) => [el(r, 'a', 'div', [], [text(r, 't', 'XX')])])).diagnostics.filter((x) => x.severity === 'error').map((x) => x.message.split(' is unsupported')[0] as string);
    };
    expect(at('contain: style')).toEqual([]);
    expect(at('contain: layout').length).toBeGreaterThan(0);
  });
});
