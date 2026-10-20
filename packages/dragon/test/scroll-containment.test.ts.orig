// The scroll-snap, containment and container-query families are accepted at their initial values alone, on every
// target (the overscroll family, registered with them, takes every value Chrome parses: test/overscroll.test.ts); every other value is kept (the grammar takes any value, so Dragon never drops what Chrome keeps) and refused where it
// applies. The Chrome cases are scroll-initial-longhands, containment-initial and the four reject-* cases of fixture-groups/scroll-containment.ts
// (packages/parity/fixtures); packages/parity/test/scroll-containment-parse.test.ts pins the parse against Chrome 145.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE, UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { LONGHANDS, PROPERTY_ROLE } from '../src/css/properties.ts';
import { CONTAINER_QUERY_LONGHANDS } from '../src/css/properties/container-query.ts';
import { CONTAINMENT_LONGHANDS } from '../src/css/properties/containment.ts';
import { isInitialValue, NON_INITIAL_VALUE_TYPE, ZERO_LENGTH } from '../src/css/properties/initial-only.ts';
import { OVERSCROLL_LONGHANDS } from '../src/css/properties/overscroll.ts';
import { SCROLL_SNAP_LONGHANDS } from '../src/css/properties/scroll-snap.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/scroll-containment.css', revision: 'r1', hash: 'sha256:0' };
const ALL = [...OVERSCROLL_LONGHANDS, ...SCROLL_SNAP_LONGHANDS, ...CONTAINMENT_LONGHANDS, ...CONTAINER_QUERY_LONGHANDS];

/** The longhands one declaration sets as `property: value` (`?` marks a kept non-initial value), or its diagnostics' codes. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${l.value.kind === 'other' && l.value.type === NON_INITIAL_VALUE_TYPE ? '?' : ''}${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text in a child of the element the declarations are on. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS, child = ''): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; } .c { ${child} }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];
const INITIAL_DECLS = [
  'overscroll-behavior: auto; overflow-anchor: auto; overscroll-behavior-inline: AUTO; overscroll-behavior-block: auto',
  'scroll-padding: auto auto auto auto; scroll-padding-inline: auto; scroll-padding-block: Auto auto',
  'scroll-margin: 0 0px; scroll-margin-inline: 0; scroll-margin-block: 0px 0; scroll-margin-top: -0',
  'scroll-snap-type: none; scroll-snap-align: NONE; scroll-snap-stop: normal',
  'contain: none; content-visibility: visible; contain-intrinsic-size: none none; contain-intrinsic-inline-size: none; contain-intrinsic-block-size: none',
  'container: none / normal',
  'container: NONE; container-type: normal; container-name: none',
];

describe('the initial-only scroll and containment families', () => {
  it('follow transform-extra and zoom in the registry, are paint-role rows, animate as Chrome 145 does and know their initial values', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf('zoom') + 1, LONGHANDS.indexOf('zoom') + 33)).toEqual(ALL);
    expect(ALL).toHaveLength(32);
    for (const p of ALL) expect(PROPERTY_ROLE[p], p).toBe('paint');
    for (const p of ALL) expect(ANIMATION_KINDS[p], p).toBe(p === 'contain-intrinsic-width' || p === 'contain-intrinsic-height' ? UNADMITTED : DISCRETE);
    expect(isInitialValue(ZERO_LENGTH, { kind: 'length', value: 0, unit: 'px' })).toBe(true);
    expect(isInitialValue(ZERO_LENGTH, { kind: 'length', value: 0, unit: 'em' })).toBe(false);
    expect(isInitialValue(ZERO_LENGTH, { kind: 'length', value: 1, unit: 'px' })).toBe(false);
    expect(isInitialValue({ kind: 'keyword', value: 'auto' }, { kind: 'keyword', value: 'none' })).toBe(false);
    expect(isInitialValue({ kind: 'keyword', value: 'auto' }, { kind: 'other', type: NON_INITIAL_VALUE_TYPE, text: 'auto' })).toBe(false);
  });

  it('parse an initial spelling to the initial values, and keep every other value as written', () => {
    expect(parsed('scroll-padding: auto auto auto')).toEqual(['scroll-padding-top: auto', 'scroll-padding-right: auto', 'scroll-padding-bottom: auto', 'scroll-padding-left: auto']);
    expect(parsed('scroll-padding-inline: auto 0')).toEqual(['scroll-padding-inline-start: ?auto 0', 'scroll-padding-inline-end: ?auto 0']);
    expect(parsed('scroll-margin-block: 0PX')).toEqual(['scroll-margin-block-start: 0px', 'scroll-margin-block-end: 0px']);
    expect(parsed('scroll-margin-left: 0em')).toEqual(['scroll-margin-left: ?0em']);
    expect(parsed('scroll-margin: 0 0 0 0 0')[0]).toBe('scroll-margin-top: ?0 0 0 0 0');
    expect(parsed('scroll-snap-type: x mandatory')).toEqual(['scroll-snap-type: ?x mandatory']);
    expect(parsed('contain: none none')).toEqual(['contain: ?none none']);
    expect(parsed('contain-intrinsic-size: none')).toEqual(['contain-intrinsic-width: none', 'contain-intrinsic-height: none']);
    expect(parsed('contain-intrinsic-size: auto none')).toEqual(['contain-intrinsic-width: ?auto none', 'contain-intrinsic-height: ?auto none']);
    expect(parsed('container: none')).toEqual(['container-name: none', 'container-type: normal']);
    expect(parsed('container: none / Normal')).toEqual(['container-name: none', 'container-type: normal']);
    expect(parsed('container: none / size')).toEqual(['container-name: ?none / size', 'container-type: ?none / size']);
    expect(parsed('container: none normal')).toEqual(['container-name: ?none normal', 'container-type: ?none normal']);
    expect(parsed('container-name: a b')).toEqual(['container-name: ?a b']);
    // Values webref lists though Chrome lacks them are kept and refused, never dropped.
    expect(parsed('scroll-snap-type: bogus')).toEqual(['scroll-snap-type: ?bogus']);
  });

  it('accept the initial values on every target, from any spelling and through the CSS-wide keywords', () => {
    for (const d of INITIAL_DECLS) expect(errorsAt(d), d).toEqual([]);
    expect(errorsAt('contain: initial; scroll-margin: unset; container: revert; overscroll-behavior: initial', NO_FAULTS, 'contain: inherit; scroll-padding: inherit; container-type: inherit')).toEqual([]);
    expect(errorsAt('overflow: auto; height: 5px; scroll-snap-type: none; overscroll-behavior: auto; overflow-anchor: auto')).toEqual([]);
    // The later declaration wins between a shorthand and its longhand.
    expect(errorsAt('scroll-snap-type: y mandatory; scroll-snap-type: none')).toEqual([]);
    expect(errorsAt('container: card / inline-size; container: none')).toEqual([]);
    expect(errorsAt('--z: 0px; scroll-margin: var(--z)')).toEqual([]);
  });

  it('refuse every other value on every target, once per element and family, computed', () => {
    for (const d of ['scroll-padding-top: 4px', 'scroll-padding-inline-end: 10%', 'scroll-margin-left: 2px',
      'scroll-margin-block: 0 1px', 'scroll-snap-type: x mandatory', 'scroll-snap-align: start', 'scroll-snap-stop: always', 'contain: paint', 'content-visibility: hidden', 'content-visibility: auto',
      'contain-intrinsic-size: 10px', 'contain-intrinsic-block-size: auto none', 'container-type: inline-size', 'container-name: card', 'container: card']) {
      expect(errorsAt(d), d).toEqual(REFUSED);
    }
    expect(errorsAt('contain: paint; content-visibility: hidden')).toEqual(REFUSED);
    expect(errorsAt('contain: paint; scroll-padding-top: 4px')).toEqual([...REFUSED, ...REFUSED].sort());
    expect(errorsAt('--t: size; container-type: var(--t)')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { scroll-snap-type: y mandatory; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) {
      expect(d.message).toMatch(/^scroll-snap-type: y mandatory on <div> a is unsupported: Dragon implements no scroll snapping .*; only none is accepted$/);
    }
  });

  it('refuse a value a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { contain: layout; } .c { contain: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['contain: layout on <div> a', 'contain: layout on <div> a', 'contain: layout on <div> a', 'contain: layout on <div> b', 'contain: layout on <div> b', 'contain: layout on <div> b']);
  });

  it('plant each family\'s fault: its non-initial value compiles, and only its own', () => {
    expect(errorsAt('scroll-snap-align: center', { ...NO_FAULTS, scrollSnapAccepted: true })).toEqual([]);
    expect(errorsAt('content-visibility: hidden', { ...NO_FAULTS, containmentAccepted: true })).toEqual([]);
    expect(errorsAt('container-name: card', { ...NO_FAULTS, containerQueryAccepted: true })).toEqual([]);
    expect(errorsAt('container-name: card', { ...NO_FAULTS, containmentAccepted: true })).toEqual(REFUSED);
  });
});
