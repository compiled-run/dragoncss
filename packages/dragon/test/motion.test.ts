// The motion path family (MOTION, css-motion-1 §2) is accepted at its initial values alone, on every target; every other value is
// kept (the grammar takes any value, so Dragon never drops what Chrome keeps) and refused where it applies. The Chrome cases are
// motion-initial and the reject-motion-* cases of fixture-groups/motion.ts (packages/parity/fixtures); the parse is pinned in
// packages/parity/test/motion-parse.test.ts.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue, valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS, PROPERTY_ROLE, SHORTHANDS } from '../src/css/properties.ts';
import { isInitialValue, NON_INITIAL_VALUE_TYPE } from '../src/css/properties/initial-only.ts';
import { MULTICOL_LONGHANDS } from '../src/css/properties/multicol.ts';
import { MOTION_INITIAL, MOTION_LONGHANDS, MOTION_SHORTHANDS } from '../src/css/properties/motion.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/motion.css', revision: 'r1', hash: 'sha256:0' };

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
const INITIAL = ['offset-path: none', 'offset-distance: 0px', 'offset-position: normal', 'offset-anchor: auto', 'offset-rotate: auto'];

describe('the initial-only motion path family', () => {
  it('follows multicol in the registry, is paint-role rows, animates as Chrome 145 does and knows its initial values', () => {
    const at = LONGHANDS.indexOf(MULTICOL_LONGHANDS[MULTICOL_LONGHANDS.length - 1] as (typeof LONGHANDS)[number]) + 1;
    expect(LONGHANDS.slice(at, at + MOTION_LONGHANDS.length)).toEqual([...MOTION_LONGHANDS]);
    for (const s of MOTION_SHORTHANDS) expect(SHORTHANDS, s).toContain(s);
    for (const p of MOTION_LONGHANDS) {
      expect(PROPERTY_ROLE[p], p).toBe('paint');
      expect(INHERITED.has(p), p).toBe(false);
      // The resolver's initial value (from the grammar) is the one the family accepts.
      expect(isInitialValue(MOTION_INITIAL[p], initialValue(p, referenceDataset())), p).toBe(true);
      expect(ANIMATION_KINDS[p], p).toEqual(UNADMITTED);
    }
  });

  it('parses an initial spelling to the initial values, and keeps every other value as written', () => {
    expect(parsed('offset: none')).toEqual(INITIAL);
    expect(parsed('OFFSET: NONE')).toEqual(INITIAL);
    expect(parsed('offset-path: None')).toEqual(['offset-path: none']);
    for (const v of ['0', '0px', '0PX']) expect(parsed(`offset-distance: ${v}`), v).toEqual(['offset-distance: 0px']);
    expect(parsed('offset-position: NORMAL')).toEqual(['offset-position: normal']);
    expect(parsed('offset-anchor: Auto')).toEqual(['offset-anchor: auto']);
    expect(parsed('offset-rotate: AUTO')).toEqual(['offset-rotate: auto']);
    expect(parsed('offset: none none')).toEqual(MOTION_LONGHANDS.map((p) => `${p}: ?none none`));
    expect(parsed('offset: normal')[0]).toBe('offset-path: ?normal');
    expect(parsed('offset: path("M 0 0 H 10") 50%')[0]).toBe('offset-path: ?path("M 0 0 H 10") 50%');
    expect(parsed('offset-path: ray(45deg)')).toEqual(['offset-path: ?ray(45deg)']);
    expect(parsed('offset-distance: 0%')).toEqual(['offset-distance: ?0%']);
    expect(parsed('offset-distance: 10px')).toEqual(['offset-distance: ?10px']);
    expect(parsed('offset-rotate: auto 0deg')).toEqual(['offset-rotate: ?auto 0deg']);
    expect(parsed('offset-rotate: 30deg')).toEqual(['offset-rotate: ?30deg']);
    expect(parsed('offset-position: auto')).toEqual(['offset-position: ?auto']);
    expect(parsed('offset-anchor: center')).toEqual(['offset-anchor: ?center']);
  });

  it('accepts the initial values on every target, from any spelling and through the CSS-wide keywords', () => {
    for (const d of ['offset: none', 'offset-path: none; offset-distance: 0; offset-position: normal; offset-anchor: auto; offset-rotate: auto', 'OFFSET-DISTANCE: 0PX; OFFSET-ROTATE: Auto']) {
      expect(errorsAt(d), d).toEqual([]);
    }
    expect(errorsAt('offset: initial; offset-anchor: unset; offset-rotate: revert', NO_FAULTS, 'offset-path: inherit; offset-distance: inherit; offset-rotate: inherit')).toEqual([]);
    // The later declaration wins between a shorthand and its longhand.
    expect(errorsAt('offset-path: ray(45deg); offset: none')).toEqual([]);
    expect(errorsAt('--p: none; offset-path: var(--p)')).toEqual([]);
  });

  it('refuses every other value on every target, once per element, computed', () => {
    for (const d of ['offset-path: ray(45deg)', 'offset-path: path("M 0 0 H 10")', 'offset-distance: 10px', 'offset-distance: 0%', 'offset-position: auto',
      'offset-position: 10px 20px', 'offset-anchor: center', 'offset-rotate: 30deg', 'offset-rotate: reverse', 'offset: ray(45deg) 10px']) {
      expect(errorsAt(d), d).toEqual(REFUSED);
    }
    expect(errorsAt('offset-path: ray(45deg); offset-rotate: 30deg; offset-distance: 10px')).toEqual(REFUSED);
    expect(errorsAt('offset-distance: 5px; column-count: 2')).toEqual([...REFUSED, ...REFUSED].sort());
    expect(errorsAt('--d: 5px; offset-distance: var(--d)')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { offset-rotate: 30deg; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toBe('offset-rotate: 30deg on <div> a is unsupported: Dragon composes no motion path offset transform yet; only auto is accepted');
  });

  it('refuses a value a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { offset-anchor: center; } .c { offset-anchor: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['offset-anchor: center on <div> a', 'offset-anchor: center on <div> a', 'offset-anchor: center on <div> a', 'offset-anchor: center on <div> b', 'offset-anchor: center on <div> b', 'offset-anchor: center on <div> b']);
  });

  it('plants its fault: a non-initial motion value compiles, and only the motion family\'s', () => {
    expect(errorsAt('offset-path: ray(45deg); offset-distance: 10px', { ...NO_FAULTS, motionAccepted: true })).toEqual([]);
    expect(errorsAt('offset-distance: 10px', { ...NO_FAULTS, multicolAccepted: true })).toEqual(REFUSED);
    expect(errorsAt('column-count: 2', { ...NO_FAULTS, motionAccepted: true })).toEqual(REFUSED);
  });
});
