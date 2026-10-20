// The anchor-position, svg-extra, view-transition and animation-extra families are accepted at their initial values alone, on every target; every
// other value is kept (the grammar takes any value, so Dragon never drops what Chrome keeps) and refused where it applies. The Chrome
// cases are render-anchor-initial, svg-extra-initial and the reject-* cases of fixture-groups/scroll-containment.ts
// (packages/parity/fixtures); packages/parity/test/render-anchor-parse.test.ts pins the parse against Chrome 145. image-rendering registers
// with them, and its values are image-rendering.test.ts's.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue, valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE, UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS, PROPERTY_ROLE } from '../src/css/properties.ts';
import { ANCHOR_POSITION_INITIAL, ANCHOR_POSITION_LONGHANDS } from '../src/css/properties/anchor-position.ts';
import { IMAGE_RENDERING_INITIAL, IMAGE_RENDERING_LONGHANDS } from '../src/css/properties/image-rendering.ts';
import { isInitialValue, NON_INITIAL_VALUE_TYPE, numInitial } from '../src/css/properties/initial-only.ts';
import { SVG_EXTRA_INITIAL, SVG_EXTRA_LONGHANDS } from '../src/css/properties/svg-extra.ts';
import { VIEW_TRANSITION_INITIAL, VIEW_TRANSITION_LONGHANDS } from '../src/css/properties/view-transition.ts';
import { ANIMATION_EXTRA_INITIAL, ANIMATION_EXTRA_LONGHANDS } from '../src/css/properties/animation-extra.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/render-anchor.css', revision: 'r1', hash: 'sha256:0' };
const ALL = [...IMAGE_RENDERING_LONGHANDS, ...ANCHOR_POSITION_LONGHANDS, ...SVG_EXTRA_LONGHANDS, ...VIEW_TRANSITION_LONGHANDS, ...ANIMATION_EXTRA_LONGHANDS];
const INITIAL = { ...IMAGE_RENDERING_INITIAL, ...ANCHOR_POSITION_INITIAL, ...SVG_EXTRA_INITIAL, ...VIEW_TRANSITION_INITIAL, ...ANIMATION_EXTRA_INITIAL };

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
  'image-rendering: auto',
  'image-rendering: AUTO; anchor-name: none; anchor-scope: None; position-anchor: none; position-area: none',
  'position-try: none; position-visibility: anchors-visible',
  'position-try: normal NONE; position-try-order: normal; position-try-fallbacks: none',
  'stop-opacity: 1; flood-opacity: 1.0; mask-type: luminance; text-anchor: start; dominant-baseline: auto; alignment-baseline: auto',
  'baseline-shift: 0; shape-rendering: auto; color-interpolation: sRGB; color-interpolation-filters: linearRGB; color-rendering: auto; buffered-rendering: auto',
  'baseline-shift: 0px; color-interpolation: srgb; color-interpolation-filters: LINEARRGB',
  'view-transition-name: none; view-transition-class: NONE; view-transition-group: normal; interpolate-size: numeric-only; timeline-scope: none',
];

describe('the image-rendering, anchor-position, svg-extra, view-transition and animation-extra families', () => {
  it('follow color-scheme in the registry, are paint-role rows, inherit and animate as Chrome 145 does, and know their initial values', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf('color-scheme') + 1)).toEqual(ALL);
    expect(ALL).toHaveLength(25);
    for (const p of ALL) expect(PROPERTY_ROLE[p], p).toBe('paint');
    const inherited = ['image-rendering', 'text-anchor', 'dominant-baseline', 'shape-rendering', 'color-interpolation', 'color-interpolation-filters', 'color-rendering', 'interpolate-size'];
    for (const p of ALL) expect(INHERITED.has(p), p).toBe(inherited.includes(p));
    for (const p of ALL) expect(ANIMATION_KINDS[p], p).toBe(['stop-opacity', 'flood-opacity', 'baseline-shift'].includes(p) ? UNADMITTED : DISCRETE);
    // The grammar's initial value (webref's, or Chrome's where they differ) computes to the one each family accepts.
    for (const p of ALL) expect(isInitialValue(INITIAL[p], initialValue(p, referenceDataset())), p).toBe(true);
    expect(isInitialValue(numInitial(1), { kind: 'number', value: 1 })).toBe(true);
    expect(isInitialValue(numInitial(1), { kind: 'number', value: 0.5 })).toBe(false);
    expect(isInitialValue(numInitial(1), { kind: 'percentage', value: 100 })).toBe(false);
  });

  it('parse an initial spelling to the initial values, and keep every other value as written', () => {
    expect(parsed('position-try: none')).toEqual(['position-try-order: normal', 'position-try-fallbacks: none']);
    expect(parsed('position-try: normal none')).toEqual(['position-try-order: normal', 'position-try-fallbacks: none']);
    // A leading try-order keyword is the order, and the rest the fallbacks, as Chrome 145 expands it.
    expect(parsed('position-try: most-width --a')).toEqual(['position-try-order: ?most-width', 'position-try-fallbacks: ?--a']);
    expect(parsed('position-try: flip-block')).toEqual(['position-try-order: normal', 'position-try-fallbacks: ?flip-block']);
    expect(parsed('position-try: normal --a, flip-inline')).toEqual(['position-try-order: normal', 'position-try-fallbacks: ?--a , flip-inline']);
    expect(parsed('position-try: most-height none')).toEqual(['position-try-order: ?most-height', 'position-try-fallbacks: none']);
    expect(parsed('position-try: none normal')).toEqual(['position-try-order: normal', 'position-try-fallbacks: ?none normal']);
    // An order with no fallbacks is dropped, as Chrome 145 drops it.
    expect(parsed('position-try: normal')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parsed('position-try: most-width')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parsed('position-anchor: auto')).toEqual(['position-anchor: ?auto']);
    expect(parsed('anchor-name: --a')).toEqual(['anchor-name: ?--a']);
    expect(parsed('stop-opacity: 1')).toEqual(['stop-opacity: 1']);
    expect(parsed('stop-opacity: 0.5')).toEqual(['stop-opacity: ?0.5']);
    // Chrome clamps stop-opacity and flood-opacity to [0, 1]: from 1 or 100% up, and a calc() that reaches 1, compute to the initial 1.
    expect(parsed('stop-opacity: 100%')).toEqual(['stop-opacity: 1']);
    expect(parsed('stop-opacity: calc(1)')).toEqual(['stop-opacity: 1']);
    expect(parsed('flood-opacity: calc(0.5 + 0.5)')).toEqual(['flood-opacity: 1']);
    expect(parsed('flood-opacity: 150%')).toEqual(['flood-opacity: 1']);
    expect(parsed('stop-opacity: 2')).toEqual(['stop-opacity: 1']);
    expect(parsed('stop-opacity: 99%')).toEqual(['stop-opacity: ?99%']);
    expect(parsed('flood-opacity: calc(0.5)')).toEqual(['flood-opacity: ?calc(0.5)']);
    expect(parsed('stop-opacity: none')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parsed('baseline-shift: 0')).toEqual(['baseline-shift: 0px']);
    expect(parsed('baseline-shift: sub')).toEqual(['baseline-shift: ?sub']);
    // baseline, a zero length in any unit and a zero length calculation compute to 0px; a zero percentage computes to 0%.
    for (const v of ['baseline', 'BASELINE', '0em', '0vw', 'calc(0px)', 'calc(1px - 1px)', 'calc(0em)', 'calc(2em - 2em)']) expect(parsed(`baseline-shift: ${v}`), v).toEqual(['baseline-shift: 0px']);
    for (const v of ['0%', 'calc(0%)', 'calc(0px + 0%)', 'calc(1em - 10px)', 'calc(1px)']) expect(parsed(`baseline-shift: ${v}`)[0], v).toMatch(/^baseline-shift: \?/);
    expect(parsed('shape-rendering: crispEdges')).toEqual(['shape-rendering: ?crispEdges']);
    // Values webref lists though Chrome drops them are kept and refused, never dropped.
    expect(parsed('position-visibility: anchor-visible')).toEqual(['position-visibility: ?anchor-visible']);
    expect(parsed('view-transition-name: auto')).toEqual(['view-transition-name: ?auto']);
    expect(parsed('timeline-scope: all')).toEqual(['timeline-scope: ?all']);
    expect(parsed('interpolate-size: Numeric-Only')).toEqual(['interpolate-size: numeric-only']);
  });

  it('accept the initial values on every target, from any spelling and through the CSS-wide keywords', () => {
    for (const d of INITIAL_DECLS) expect(errorsAt(d), d).toEqual([]);
    expect(errorsAt('image-rendering: initial; position-try: unset; anchor-name: revert; stop-opacity: initial', NO_FAULTS, 'image-rendering: inherit; text-anchor: inherit; stop-opacity: inherit; position-anchor: inherit')).toEqual([]);
    // The later declaration wins.
    expect(errorsAt('image-rendering: pixelated; image-rendering: auto')).toEqual([]);
    expect(errorsAt('--o: 1; flood-opacity: var(--o)')).toEqual([]);
  });

  it('refuse every other value on every target, once per element and family, computed', () => {
    for (const d of ['anchor-name: --a', 'anchor-scope: all', 'position-anchor: auto',
      'position-area: top', 'position-try: flip-block', 'position-try-order: most-width', 'position-try-fallbacks: --a', 'position-visibility: always', 'stop-opacity: 0.5', 'flood-opacity: 0',
      'mask-type: alpha', 'text-anchor: middle', 'dominant-baseline: middle', 'alignment-baseline: baseline', 'baseline-shift: 2px', 'shape-rendering: crispEdges', 'color-interpolation: linearRGB',
      'color-interpolation-filters: sRGB', 'color-rendering: optimizeSpeed', 'buffered-rendering: static', 'view-transition-name: card', 'view-transition-class: a b', 'view-transition-group: contain',
      'interpolate-size: allow-keywords', 'timeline-scope: --t']) {
      // An inherited one is refused on the child as well.
      expect(errorsAt(d), d).toEqual(INHERITED.has(d.split(':')[0] as never) ? [...REFUSED, ...REFUSED].sort() : REFUSED);
    }
    expect(errorsAt('anchor-name: --a; position-area: top')).toEqual(REFUSED);
    const at = (decl: string): string[] => {
      const c = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
      return [...new Set(c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0] as string))];
    };
    expect(at('position-try: flip-block')).toEqual(['position-try-fallbacks: flip-block on <div> a']);
    expect(at('position-try: most-width --a')).toEqual(['position-try-order: most-width on <div> a']);
    expect(errorsAt('anchor-name: --a; text-anchor: end; interpolate-size: allow-keywords')).toEqual(Array(5).fill(REFUSED).flat().sort());
    expect(errorsAt('--r: --a; anchor-name: var(--r)')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { anchor-name: --a; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^anchor-name: --a on <div> a is unsupported: Dragon implements no anchor positioning yet; only none is accepted$/);
  });

  it('accept the UA view-transition-name: root on the root, and refuse an author one', () => {
    // inputFor puts the elements in html and body.
    const css = 'body { font-family: Ahem; font-size: 10px; }';
    const doc = (decl: string) => project(NO_FAULTS).compile(inputFor(`${css} ${decl}`, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = (decl: string) => doc(decl).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
    expect(errors('')).toEqual([]);
    expect(errors('html { view-transition-name: none; }')).toEqual([]);
    expect(errors('html { view-transition-name: root; }')).toEqual(REFUSED);
    expect(errors('.s { view-transition-name: root; }')).toEqual(REFUSED);
  });

  it('refuse an inherited value on the child too, and a non-inherited one only where it is set', () => {
    const at = (css: string): string[] => {
      const c = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${css}`, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
      return [...new Set(c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0] as string))].sort();
    };
    expect(at('.s { dominant-baseline: middle; }')).toEqual(['dominant-baseline: middle on <div> a', 'dominant-baseline: middle on <div> b']);
    expect(at('.s { text-anchor: middle; }')).toEqual(['text-anchor: middle on <div> a', 'text-anchor: middle on <div> b']);
    expect(at('.s { anchor-name: --a; }')).toEqual(['anchor-name: --a on <div> a']);
  });

  it('plant each family\'s fault: its non-initial value compiles, and only its own', () => {
    expect(errorsAt('position-area: top', { ...NO_FAULTS, anchorPositionAccepted: true })).toEqual([]);
    expect(errorsAt('shape-rendering: crispEdges', { ...NO_FAULTS, svgExtraAccepted: true })).toEqual([]);
    expect(errorsAt('view-transition-name: card', { ...NO_FAULTS, viewTransitionAccepted: true })).toEqual([]);
    expect(errorsAt('timeline-scope: --t', { ...NO_FAULTS, animationExtraAccepted: true })).toEqual([]);
    expect(errorsAt('interpolate-size: allow-keywords', { ...NO_FAULTS, viewTransitionAccepted: true })).toEqual([...REFUSED, ...REFUSED].sort());
    expect(errorsAt('anchor-name: --a', { ...NO_FAULTS, viewTransitionAccepted: true, svgExtraAccepted: true })).toEqual(REFUSED);
  });
});
