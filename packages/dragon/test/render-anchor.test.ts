// The image-rendering, anchor-position and svg-extra families are accepted at their initial values alone, on every target; every
// other value is kept (the grammar takes any value, so Dragon never drops what Chrome keeps) and refused where it applies. The Chrome
// cases are render-anchor-initial, svg-extra-initial and the reject-* cases of fixture-groups/scroll-containment.ts
// (packages/parity/fixtures); packages/parity/test/render-anchor-parse.test.ts pins the parse against Chrome 145.
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
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/render-anchor.css', revision: 'r1', hash: 'sha256:0' };
const ALL = [...IMAGE_RENDERING_LONGHANDS, ...ANCHOR_POSITION_LONGHANDS, ...SVG_EXTRA_LONGHANDS];
const INITIAL = { ...IMAGE_RENDERING_INITIAL, ...ANCHOR_POSITION_INITIAL, ...SVG_EXTRA_INITIAL };

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
];

describe('the image-rendering, anchor-position and svg-extra families', () => {
  it('follow color-scheme in the registry, are paint-role rows, inherit and animate as Chrome 145 does, and know their initial values', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf('color-scheme') + 1)).toEqual(ALL);
    expect(ALL).toHaveLength(20);
    for (const p of ALL) expect(PROPERTY_ROLE[p], p).toBe('paint');
    const inherited = ['image-rendering', 'text-anchor', 'dominant-baseline', 'shape-rendering', 'color-interpolation', 'color-interpolation-filters', 'color-rendering'];
    for (const p of ALL) expect(INHERITED.has(p), p).toBe(inherited.includes(p));
    for (const p of ALL) expect(ANIMATION_KINDS[p], p).toBe(['stop-opacity', 'flood-opacity', 'baseline-shift'].includes(p) ? UNADMITTED : DISCRETE);
    // The grammar's initial value (webref's, or Chrome's where they differ) computes to the one each family accepts.
    for (const p of ALL) expect(isInitialValue(INITIAL[p], initialValue(p, referenceDataset())), p).toBe(true);
    expect(isInitialValue(numInitial(1), { kind: 'number', value: 1 })).toBe(true);
    expect(isInitialValue(numInitial(1), { kind: 'number', value: 0.5 })).toBe(false);
    expect(isInitialValue(numInitial(1), { kind: 'percentage', value: 100 })).toBe(false);
  });

  it('parse an initial spelling to the initial values, and keep every other value as written', () => {
    expect(parsed('image-rendering: Auto')).toEqual(['image-rendering: auto']);
    expect(parsed('image-rendering: pixelated')).toEqual(['image-rendering: ?pixelated']);
    expect(parsed('position-try: none')).toEqual(['position-try-order: normal', 'position-try-fallbacks: none']);
    expect(parsed('position-try: normal none')).toEqual(['position-try-order: normal', 'position-try-fallbacks: none']);
    expect(parsed('position-try: most-width --a')).toEqual(['position-try-order: ?most-width --a', 'position-try-fallbacks: ?most-width --a']);
    expect(parsed('position-try: none normal')).toEqual(['position-try-order: ?none normal', 'position-try-fallbacks: ?none normal']);
    expect(parsed('position-anchor: auto')).toEqual(['position-anchor: ?auto']);
    expect(parsed('anchor-name: --a')).toEqual(['anchor-name: ?--a']);
    expect(parsed('stop-opacity: 1')).toEqual(['stop-opacity: 1']);
    expect(parsed('stop-opacity: 0.5')).toEqual(['stop-opacity: ?0.5']);
    expect(parsed('stop-opacity: 100%')).toEqual(['stop-opacity: ?100%']);
    expect(parsed('baseline-shift: 0')).toEqual(['baseline-shift: 0px']);
    expect(parsed('baseline-shift: sub')).toEqual(['baseline-shift: ?sub']);
    expect(parsed('shape-rendering: crispEdges')).toEqual(['shape-rendering: ?crispEdges']);
    // Values webref lists though Chrome drops them are kept and refused, never dropped.
    expect(parsed('position-visibility: anchor-visible')).toEqual(['position-visibility: ?anchor-visible']);
    expect(parsed('image-rendering: smooth')).toEqual(['image-rendering: ?smooth']);
  });

  it('accept the initial values on every target, from any spelling and through the CSS-wide keywords', () => {
    for (const d of INITIAL_DECLS) expect(errorsAt(d), d).toEqual([]);
    expect(errorsAt('image-rendering: initial; position-try: unset; anchor-name: revert; stop-opacity: initial', NO_FAULTS, 'image-rendering: inherit; text-anchor: inherit; stop-opacity: inherit; position-anchor: inherit')).toEqual([]);
    // The later declaration wins.
    expect(errorsAt('image-rendering: pixelated; image-rendering: auto')).toEqual([]);
    expect(errorsAt('--o: 1; flood-opacity: var(--o)')).toEqual([]);
  });

  it('refuse every other value on every target, once per element and family, computed', () => {
    for (const d of ['image-rendering: pixelated', 'image-rendering: crisp-edges', 'image-rendering: -webkit-optimize-contrast', 'anchor-name: --a', 'anchor-scope: all', 'position-anchor: auto',
      'position-area: top', 'position-try: flip-block', 'position-try-order: most-width', 'position-try-fallbacks: --a', 'position-visibility: always', 'stop-opacity: 0.5', 'flood-opacity: 0',
      'mask-type: alpha', 'text-anchor: middle', 'dominant-baseline: middle', 'alignment-baseline: baseline', 'baseline-shift: 2px', 'shape-rendering: crispEdges', 'color-interpolation: linearRGB',
      'color-interpolation-filters: sRGB', 'color-rendering: optimizeSpeed', 'buffered-rendering: static']) {
      // An inherited one is refused on the child as well.
      expect(errorsAt(d), d).toEqual(INHERITED.has(d.split(':')[0] as never) ? [...REFUSED, ...REFUSED].sort() : REFUSED);
    }
    expect(errorsAt('anchor-name: --a; position-area: top')).toEqual(REFUSED);
    expect(errorsAt('image-rendering: pixelated; anchor-name: --a; text-anchor: end')).toEqual(Array(5).fill(REFUSED).flat().sort());
    expect(errorsAt('--r: --a; anchor-name: var(--r)')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { image-rendering: pixelated; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^image-rendering: pixelated on <div> a is unsupported: Dragon scales images only as image-rendering: auto does; only auto is accepted$/);
  });

  it('refuse an inherited value on the child too, and a non-inherited one only where it is set', () => {
    const at = (css: string): string[] => {
      const c = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${css}`, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
      return [...new Set(c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0] as string))].sort();
    };
    expect(at('.s { image-rendering: pixelated; }')).toEqual(['image-rendering: pixelated on <div> a', 'image-rendering: pixelated on <div> b']);
    expect(at('.s { text-anchor: middle; }')).toEqual(['text-anchor: middle on <div> a', 'text-anchor: middle on <div> b']);
    expect(at('.s { anchor-name: --a; }')).toEqual(['anchor-name: --a on <div> a']);
  });

  it('plant each family\'s fault: its non-initial value compiles, and only its own', () => {
    expect(errorsAt('image-rendering: pixelated', { ...NO_FAULTS, imageRenderingAccepted: true })).toEqual([]);
    expect(errorsAt('position-area: top', { ...NO_FAULTS, anchorPositionAccepted: true })).toEqual([]);
    expect(errorsAt('shape-rendering: crispEdges', { ...NO_FAULTS, svgExtraAccepted: true })).toEqual([]);
    expect(errorsAt('anchor-name: --a', { ...NO_FAULTS, imageRenderingAccepted: true, svgExtraAccepted: true })).toEqual(REFUSED);
  });
});
