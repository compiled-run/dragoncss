// isolation (compositing-1 §3.3): auto | isolate, accepted at every value on every target. isolate makes a stacking context in the
// z-index 0 layer on any box, positioned or not, and no containing block; Dragon refuses mix-blend-mode, the only thing it otherwise
// changes. The Chrome cases are isolation-values and isolation-stacking (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { CONTAINER_QUERY_LONGHANDS } from '../src/css/properties/container-query.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, expectCatalogued, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/isolation.css', revision: 'r1', hash: 'sha256:0' };

function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.some((d) => d.code === 'DRAGON_CSS_INVALID_VALUE')) return ['dropped'];
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const compile = (css: string, body: (r: SourceRef) => TreeNode[]) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' })
    .compile(inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, body));
const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

/** a (class s) holding b (class c, with Ahem text), then a later sibling z (class z). */
const tree = (r: SourceRef): TreeNode[] => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])]), el(r, 'z', 'div', ['z'])];

describe('isolation', () => {
  it('follows the container-query longhands in the registry and animates discretely', () => {
    expect(LONGHANDS[LONGHANDS.indexOf('isolation') - 1]).toBe(CONTAINER_QUERY_LONGHANDS[CONTAINER_QUERY_LONGHANDS.length - 1]);
    expect(ANIMATION_KINDS.isolation).toBe(DISCRETE);
  });

  it('parses Chrome 145\'s two keywords in any case and drops every other value', () => {
    expect(parsed('isolation: ISOLATE')).toEqual(['isolation: isolate']);
    expect(parsed('isolation: Auto')).toEqual(['isolation: auto']);
    for (const d of ['isolation: none', 'isolation: isolate auto', 'isolation: 1']) expect(parsed(d), d).toEqual(['dropped']);
  });

  it('is accepted at every value on every target, through var() and the CSS-wide keywords', () => {
    for (const d of ['isolation: isolate', 'isolation: auto', '--i: isolate; isolation: var(--i)', 'isolation: initial', 'isolation: isolate; position: relative; z-index: 1']) {
      expect(errors(compile(`.s { ${d}; }`, tree)).map((x) => x.message), d).toEqual([]);
    }
    expect(errors(compile('.s { isolation: isolate; } .c { isolation: inherit; }', tree))).toEqual([]);
  });

  it('makes a non-positioned box a stacking context in the z-index 0 layer, holding its negative z-index child, and no containing block', () => {
    const c = compile('.s { isolation: isolate; height: 20px; } .c { position: relative; z-index: -1; } .z { height: 10px; margin-top: -15px; }', tree);
    expect(errors(c)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const program of [p.programs.uikit, p.programs['android-views']]) {
      const facts = (id: string) => program.nodes.find((n) => n.id === id)?.facts['stacking'] as { createsContext: boolean; layer: string; context: string | null; paintOrder: number };
      expect(facts('a')).toMatchObject({ createsContext: true, layer: 'positioned' });
      expect(facts('b')).toMatchObject({ context: 'a', layer: 'negative' });
      // a paints above the later flow sibling z, and its negative child above a's own background.
      expect(facts('a').paintOrder).toBeGreaterThan(facts('z').paintOrder);
      expect(facts('b').paintOrder).toBeGreaterThan(facts('a').paintOrder);
    }
    // isolation: auto makes nothing.
    const auto = nativePrograms(compile('.s { isolation: auto; } .c { position: relative; z-index: -1; }', tree), []);
    if (auto.kind !== 'ready') throw new Error(auto.reason);
    expect(auto.programs.uikit.nodes.find((n) => n.id === 'a')?.facts['stacking']).toMatchObject({ createsContext: false, layer: 'flow' });
    // An absolute child's containing block stays the initial one: isolate is not a transform.
    expect(errors(compile('.s { isolation: isolate; } .c { position: absolute; top: 0; }', tree))).toEqual([]);
  });

  it('is refused on the native targets only on an inline box, whose content the native runtime places beside its view', () => {
    const para = (r: SourceRef): TreeNode[] => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 'o', 'span', ['f'], [text(r, 't1', 'b')])])];
    const errs = errors(compile('.f { isolation: isolate; }', para));
    expect(errs.map((d) => [d.code, d.target]).sort()).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(errs[0]?.message).toMatch(/^isolation: isolate on the inline box <span> o makes it a stacking context: the native runtime places an inline box's content beside its view/);
    expectCatalogued(errs);
    expect(errors(compile('.f { isolation: auto; }', para))).toEqual([]);
  });

  it('names isolation as the reason a layer item puts an outline out of order on native', () => {
    const errs = errors(compile('.s { isolation: isolate; } .z { outline: 2px solid red; }', tree)).filter((d) => d.message.includes('isolation: isolate'));
    expect(errs.map((d) => d.target).sort()).toEqual(['android', 'ios']);
  });
});
