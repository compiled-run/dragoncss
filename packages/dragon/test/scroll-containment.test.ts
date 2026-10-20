// The containment family is accepted at its initial values alone, on every target (the overscroll family, registered with it,
// takes every value Chrome parses: test/overscroll.test.ts); every other value is kept (the grammar takes any value, so Dragon never
// drops what Chrome keeps) and refused where it applies. Scroll snapping takes Chrome 145's parse and is accepted at every value
// wherever nothing snaps; an active snap pair (a scroll container with a snap type and a snap area) is refused on iOS and Android,
// which snap nothing yet, and compiles on web. The container-query family parses as Chrome does, and every container-name and
// container-type: inline-size compile. The Chrome cases are scroll-initial-longhands, scroll-snap-values, containment-initial and the
// reject-* cases of fixture-groups/scroll-containment.ts, and the container-query group (packages/parity/fixtures);
// packages/parity/test/scroll-containment-parse.test.ts and container-query-parse.test.ts pin the parse against Chrome 145.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE, UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { isLonghand, isShorthand, LONGHANDS, PROPERTY_ROLE } from '../src/css/properties.ts';
import { CONTAINER_QUERY_LONGHANDS } from '../src/css/properties/container-query.ts';
import { CONTAINMENT_LONGHANDS } from '../src/css/properties/containment.ts';
import { isInitialValue, NON_INITIAL_VALUE_TYPE, ZERO_LENGTH } from '../src/css/properties/initial-only.ts';
import { OVERSCROLL_LONGHANDS } from '../src/css/properties/overscroll.ts';
import { SCROLL_SNAP_LONGHANDS, SCROLL_SNAP_SHORTHANDS } from '../src/css/properties/scroll-snap.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/scroll-containment.css', revision: 'r1', hash: 'sha256:0' };
const ALL = [...OVERSCROLL_LONGHANDS, ...SCROLL_SNAP_LONGHANDS, ...CONTAINMENT_LONGHANDS, ...CONTAINER_QUERY_LONGHANDS];

/** The longhands one declaration sets as `property: value` (`?` marks a kept non-initial value, [ltr] or [rtl] a direction), or its diagnostics' codes. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}${l.direction === undefined ? '' : `[${l.direction}]`}: ${l.value.kind === 'other' && l.value.type === NON_INITIAL_VALUE_TYPE ? '?' : ''}${valueToString(l.value)}`);
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

/**
 * The errors, as `<target> <code>`, and their messages, for a tree under body: s (class s) holding i (class i) and n (class n), i
 * holding k (class k), each with Ahem text, beside o (class o). html and body take the classes h and b.
 */
function snap(css: string, faults: CompilerFaults = NO_FAULTS): { readonly errors: string[]; readonly messages: string[] } {
  const all = `.b { font-family: Ahem; font-size: 10px; margin: 0; } ${css}`;
  const input = inputFor(all, (r) => [
    el(r, 's', 'div', ['s'], [el(r, 'i', 'div', ['i'], [el(r, 'k', 'div', ['k'], [text(r, 'kt', 'XX')])]), el(r, 'n', 'div', ['n'], [text(r, 'nt', 'XX')])]),
    el(r, 'o', 'div', ['o'], [text(r, 'ot', 'XX')]),
  ]);
  const tree = input.tree as NonNullable<typeof input.tree>;
  const app = tree.components[0] as (typeof tree.components)[number];
  const root = app.root[0] as ElementNode;
  const classed = (e: ElementNode, name: string): ElementNode => ({ ...e, classes: [staticClass({ owner: DOC, sheet: 's', name }, e.origin)] });
  const html: ElementNode = { ...classed(root, 'h'), children: [classed(root.children[0] as ElementNode, 'b')] };
  const c = project(faults).compile({ ...input, tree: { ...tree, components: [{ ...app, root: [html] }] } });
  const errors = c.diagnostics.filter((d) => d.severity === 'error');
  return { errors: errors.map((d) => `${String(d.target)} ${d.code}`).sort(), messages: [...new Set(errors.map((d) => d.message.replace(` on ${String(d.target)} `, ' on <target> ')))].sort() };
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];
const NATIVE = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];
const SCROLLER = 'overflow: auto; height: 20px';
const INITIAL_DECLS = [
  'overscroll-behavior: auto; overflow-anchor: auto; overscroll-behavior-inline: AUTO; overscroll-behavior-block: auto',
  'contain: none; content-visibility: visible; contain-intrinsic-size: none none; contain-intrinsic-inline-size: none; contain-intrinsic-block-size: none',
  'container: none / normal',
  'container: NONE; container-type: normal; container-name: none',
];

describe('the initial-only scroll and containment families', () => {
  it('follow transform-extra and zoom in the registry, are paint-role rows, animate as Chrome 145 does and know their initial values', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf('zoom') + 1, LONGHANDS.indexOf('zoom') + 1 + ALL.length)).toEqual(ALL);
    expect(ALL).toHaveLength(24);
    // container-type changes layout, so it keys its rows by the box's context, except at normal (analysis/context.ts layoutInert).
    for (const p of ALL) expect(PROPERTY_ROLE[p], p).toBe((CONTAINER_QUERY_LONGHANDS as readonly string[]).includes(p) ? 'item' : 'paint');
    for (const p of ALL) expect(ANIMATION_KINDS[p], p).toBe(p === 'contain-intrinsic-width' || p === 'contain-intrinsic-height' ? UNADMITTED : DISCRETE);
    expect(isInitialValue(ZERO_LENGTH, { kind: 'length', value: 0, unit: 'px' })).toBe(true);
    expect(isInitialValue(ZERO_LENGTH, { kind: 'length', value: 0, unit: 'em' })).toBe(false);
    expect(isInitialValue(ZERO_LENGTH, { kind: 'length', value: 1, unit: 'px' })).toBe(false);
    expect(isInitialValue({ kind: 'keyword', value: 'auto' }, { kind: 'keyword', value: 'none' })).toBe(false);
    expect(isInitialValue({ kind: 'keyword', value: 'auto' }, { kind: 'other', type: NON_INITIAL_VALUE_TYPE, text: 'auto' })).toBe(false);
  });

  it('parse an initial spelling to the initial values, and keep every other value as written', () => {
    expect(parsed('contain: none none')).toEqual(['contain: ?none none']);
    expect(parsed('contain-intrinsic-size: none')).toEqual(['contain-intrinsic-width: none', 'contain-intrinsic-height: none']);
    expect(parsed('contain-intrinsic-size: auto none')).toEqual(['contain-intrinsic-width: ?auto none', 'contain-intrinsic-height: ?auto none']);
    expect(parsed('container: none')).toEqual(['container-name: none', 'container-type: normal']);
    expect(parsed('container: none / Normal')).toEqual(['container-name: none', 'container-type: normal']);
    expect(parsed('container: none / size')).toEqual(['container-name: none', 'container-type: size']);
    expect(parsed('container: Card a / SCROLL-STATE inline-size')).toEqual(['container-name: Card a', 'container-type: inline-size scroll-state']);
    expect(parsed('container: none normal')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parsed('container-name: a b a')).toEqual(['container-name: a b a']);
    expect(parsed('container-type: anchored size')).toEqual(['container-type: size anchored']);
    for (const d of ['container-name: a none', 'container-name: and', 'container-type: size inline-size', 'container-type: normal size', 'container: a /']) expect(parsed(d), d).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('accept the initial values on every target, from any spelling and through the CSS-wide keywords', () => {
    for (const d of INITIAL_DECLS) expect(errorsAt(d), d).toEqual([]);
    expect(errorsAt('contain: initial; container: revert; overscroll-behavior: initial', NO_FAULTS, 'contain: inherit; container-type: inherit')).toEqual([]);
    expect(errorsAt('overflow: auto; height: 5px; overscroll-behavior: auto; overflow-anchor: auto')).toEqual([]);
    // The later declaration wins between a shorthand and its longhand.
    expect(errorsAt('container: card / size; container: none')).toEqual([]);
  });

  it('key container-name, and container-type: normal, by the element\'s direction alone, so the committed rows prove them in any box', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { container: none; } .f { display: flex; flex-direction: column; } .h { display: none; }';
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(
      inputFor(css, (r) => [el(r, 'p', 'div', [], [el(r, 'i', 'span', ['s'], [text(r, 't', 'X')])]), el(r, 'f', 'div', ['f'], [el(r, 'fi', 'div', ['s'])]), el(r, 'h', 'div', ['h'], [el(r, 'hi', 'div', ['s'])])]),
    );
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`)).toEqual([]);
  });

  it('compile every container-name and container-type: inline-size, from any spelling and through var() and inherit', () => {
    for (const d of ['container-type: inline-size', 'container-name: card', 'container: card', 'container: a b / INLINE-SIZE', '--t: inline-size; container-type: var(--t)', 'display: flex; container-type: inline-size', 'position: absolute; container-type: inline-size']) {
      expect(errorsAt(d), d).toEqual([]);
    }
    expect(errorsAt('container-type: inline-size', NO_FAULTS, 'container-type: inherit; display: inline-block')).toEqual([]);
  });

  it('refuse every other container-type, and inline-size where no box is contained, naming why', () => {
    const at = (css: string, html: (r: SourceRef) => TreeNode[]): string[] => project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${css}`, html)).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message.split(' is unsupported: ')[1] ?? d.message);
    const one = (css: string, tag = 'div') => at(`.s { ${css} }`, (r) => [el(r, 'a', 'div', [], [text(r, 't', 'X'), el(r, 's', tag, ['s'], [text(r, 'u', 'XX')])])]);
    for (const d of ['container-type: size', 'container-type: scroll-state', 'container: a / inline-size scroll-state', 'container-type: anchored']) {
      expect(one(d), d).toEqual(Array(3).fill('Dragon implements inline-size query containers only, not size containment or scroll-state and anchored queries'));
    }
    expect(one('container-type: inline-size', 'span')).toEqual(Array(3).fill('inline-size containment does not apply to a display: inline element, which Dragon does not model'));
    expect(one('container-type: inline-size; display: contents')[0]).toBe('inline-size containment does not apply to a display: contents element, which Dragon does not model');
    expect(at('.s { container-type: inline-size; width: 4px; height: 4px; }', (r) => [el(r, 'i', 'img', ['s'])]).filter((m) => m.startsWith('inline-size containment'))).toEqual(Array(3).fill('inline-size containment drops the natural size of <img>, which Dragon does not model'));
  });

  it('refuse every other value on every target, once per element and family, computed', () => {
    for (const d of ['contain: paint', 'content-visibility: hidden', 'content-visibility: auto',
      'contain-intrinsic-size: 10px', 'contain-intrinsic-block-size: auto none', 'container-type: size', 'container: card / scroll-state']) {
      expect(errorsAt(d), d).toEqual(REFUSED);
    }
    expect(errorsAt('contain: paint; content-visibility: hidden')).toEqual(REFUSED);
    expect(errorsAt('contain: paint; container-type: size')).toEqual([...REFUSED, ...REFUSED].sort());
    expect(errorsAt('--t: size; container-type: var(--t)')).toEqual(REFUSED);
  });

  it('refuse a value a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { contain: layout; } .c { contain: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['contain: layout on <div> a', 'contain: layout on <div> a', 'contain: layout on <div> a', 'contain: layout on <div> b', 'contain: layout on <div> b', 'contain: layout on <div> b']);
  });

  it('plant each family\'s fault: its non-initial value compiles, and only its own', () => {
    expect(errorsAt('content-visibility: hidden', { ...NO_FAULTS, containmentAccepted: true })).toEqual([]);
    // Native lowering has no size containment, so it fails there instead of the refusal.
    expect(errorsAt('container-type: size', { ...NO_FAULTS, containerQueryAccepted: true })).toEqual(['android DRAGON_LOWERING_FAILED', 'ios DRAGON_LOWERING_FAILED']);
    expect(errorsAt('container-type: size', { ...NO_FAULTS, containmentAccepted: true })).toEqual(REFUSED);
    expect(errorsAt('container-type: size', { ...NO_FAULTS, scrollSnapAccepted: true })).toEqual(REFUSED);
  });
});

describe('scroll snapping, scroll-padding and scroll-margin', () => {
  it('register the physical longhands, and map the flow-relative names and the box shorthands onto them', () => {
    expect(SCROLL_SNAP_LONGHANDS).toEqual(['scroll-padding-top', 'scroll-padding-right', 'scroll-padding-bottom', 'scroll-padding-left', 'scroll-margin-top', 'scroll-margin-right', 'scroll-margin-bottom', 'scroll-margin-left', 'scroll-snap-type', 'scroll-snap-align', 'scroll-snap-stop']);
    for (const s of SCROLL_SNAP_SHORTHANDS) expect([isShorthand(s), isLonghand(s)], s).toEqual([true, false]);
    expect(parsed('scroll-padding: 0 20px')).toEqual(['scroll-padding-top: 0px', 'scroll-padding-right: 20px', 'scroll-padding-bottom: 0px', 'scroll-padding-left: 20px']);
    expect(parsed('scroll-padding: 1px 2px 3px')).toEqual(['scroll-padding-top: 1px', 'scroll-padding-right: 2px', 'scroll-padding-bottom: 3px', 'scroll-padding-left: 2px']);
    expect(parsed('scroll-padding: auto 5%')).toEqual(['scroll-padding-top: auto', 'scroll-padding-right: 5%', 'scroll-padding-bottom: auto', 'scroll-padding-left: 5%']);
    expect(parsed('scroll-margin: 1em -2px')).toEqual(['scroll-margin-top: 1em', 'scroll-margin-right: -2px', 'scroll-margin-bottom: 1em', 'scroll-margin-left: -2px']);
    expect(parsed('scroll-padding-inline-start: 3px')).toEqual(['scroll-padding-left[ltr]: 3px', 'scroll-padding-right[rtl]: 3px']);
    expect(parsed('scroll-margin-inline: 1px 2px')).toEqual(['scroll-margin-left[ltr]: 1px', 'scroll-margin-right[rtl]: 1px', 'scroll-margin-right[ltr]: 2px', 'scroll-margin-left[rtl]: 2px']);
    expect(parsed('scroll-padding-block: auto 3px')).toEqual(['scroll-padding-top: auto', 'scroll-padding-bottom: 3px']);
    expect(parsed('scroll-margin-block-end: 9px')).toEqual(['scroll-margin-bottom: 9px']);
  });

  it('parse as Chrome 145 does: keywords as one value, lengths, percentages for padding alone, and calculations', () => {
    expect(parsed('scroll-snap-type: x proximity')).toEqual(['scroll-snap-type: x']);
    expect(parsed('scroll-snap-type: Y MANDATORY')).toEqual(['scroll-snap-type: y mandatory']);
    expect(parsed('scroll-snap-type: inline')).toEqual(['scroll-snap-type: inline']);
    expect(parsed('scroll-snap-align: start start')).toEqual(['scroll-snap-align: start']);
    expect(parsed('scroll-snap-align: none START')).toEqual(['scroll-snap-align: none start']);
    expect(parsed('scroll-snap-stop: Always')).toEqual(['scroll-snap-stop: always']);
    expect(parsed('scroll-padding-top: 0')).toEqual(['scroll-padding-top: 0px']);
    expect(parsed('scroll-padding-top: calc(10% + 1em)')).toEqual(['scroll-padding-top: calc(10% + 1em)']);
    expect(parsed('scroll-margin-top: calc(1em + 2px)')).toEqual(['scroll-margin-top: calc(1em + 2px)']);
    for (const d of ['scroll-snap-type: pair', 'scroll-snap-type: none mandatory', 'scroll-snap-type: mandatory x', 'scroll-snap-align: left', 'scroll-snap-align: start end center', 'scroll-snap-stop: none',
      'scroll-padding-top: -1px', 'scroll-padding-top: 5', 'scroll-padding: 1px 2px 3px 4px 5px', 'scroll-padding-inline: 1px 2px 3px', 'scroll-margin-top: 10%', 'scroll-margin-top: auto',
      'scroll-margin-top: calc(10% + 1px)', 'scroll-margin-block: 0 0 0']) {
      expect(parsed(d), d).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });

  it('accept every value on every target wherever nothing snaps', () => {
    // scroll-padding, scroll-margin and scroll-snap-stop anywhere, on a snapping container and its areas too.
    expect(snap(`.s { ${SCROLLER}; scroll-padding: 10px 5%; scroll-margin: 1em -2px; scroll-snap-stop: always; } .i { scroll-margin-top: 80px; scroll-padding-inline: 2rem 1px; scroll-snap-stop: always; }`).errors).toEqual([]);
    // A snap type on a box that does not scroll, with an aligned child.
    expect(snap('.s { scroll-snap-type: x mandatory; } .i { scroll-snap-align: start; }').errors).toEqual([]);
    // A snap type on an inline box with overflow, which is no scroll container.
    expect(snap('.s, .i, .k, .n { display: inline; } .s { overflow: auto; scroll-snap-type: y mandatory; } .i { scroll-snap-align: start; }').errors).toEqual([]);
    // A scroll container with a snap type and no snap area.
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: both mandatory; } .i { scroll-snap-align: none; }`).errors).toEqual([]);
    // Alignments with no snapping container: a scroller without a snap type, and the viewport with none.
    expect(snap(`.s { ${SCROLLER}; } .i { scroll-snap-align: center end; } .o { scroll-snap-align: start; }`).errors).toEqual([]);
    // An area whose box is not rendered.
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; } .i { display: none; scroll-snap-align: start; }`).errors).toEqual([]);
    // An aligned element with no box of its own (display: contents) or a non-replaced inline box: Chrome snaps to neither.
    // (Both fail native lowering for other reasons in this tree, so only the snap refusal is asserted absent.)
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; } .i { display: contents; scroll-snap-align: start; }`).messages.filter((m) => m.includes('SCROLL-SNAP'))).toEqual([]);
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; } .n { display: inline; scroll-snap-align: start; }`).messages.filter((m) => m.includes('SCROLL-SNAP'))).toEqual([]);
    // A snap type of none from the cascade, a CSS-wide keyword or var().
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; scroll-snap-type: none; } .i { scroll-snap-align: start; }`).errors).toEqual([]);
    expect(snap(`.s { ${SCROLLER}; --t: none; scroll-snap-type: var(--t); } .i { scroll-snap-align: start; scroll-snap-type: inherit; }`).errors).toEqual([]);
  });

  it('refuse an active snap pair once per container on iOS and Android, and compile it on web', () => {
    const pair = snap(`.s { ${SCROLLER}; scroll-snap-type: x mandatory; } .i { scroll-snap-align: start; } .n { scroll-snap-align: end; }`);
    expect(pair.errors).toEqual(NATIVE);
    expect(pair.messages).toEqual(['scroll snapping in s (scroll-snap-type: x mandatory, with i aligned start) is not implemented on <target> yet (SCROLL-SNAP): Chrome snaps the scroll position even at rest']);
    // proximity (Chrome may snap), overflow hidden and an area aligned on one axis only.
    expect(snap('.s { overflow: hidden; height: 20px; scroll-snap-type: y; } .n { scroll-snap-align: none center; }').errors).toEqual(NATIVE);
    // Through var() and inherit.
    expect(snap(`.s { ${SCROLLER}; --t: y mandatory; scroll-snap-type: var(--t); } .i { --a: center; scroll-snap-align: var(--a); }`).errors).toEqual(NATIVE);
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: block; scroll-snap-align: end; } .i { scroll-snap-align: inherit; }`).errors).toEqual(NATIVE);
    // An atomic inline is a snap area.
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; } .n { display: inline-block; scroll-snap-align: start; }`).errors).toEqual(NATIVE);
    // The plant accepts it.
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: x mandatory; } .i { scroll-snap-align: start; }`, { ...NO_FAULTS, scrollSnapAccepted: true }).errors).toEqual([]);
  });

  it('pair an area with its nearest scroll container only, except a positioned area, which may snap any around it', () => {
    // i scrolls and holds the area k: only i snaps it, so a snap type on s alone snaps nothing, and one on i does.
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; } .i { ${SCROLLER}; } .k { scroll-snap-align: start; }`).errors).toEqual([]);
    const inner = snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; } .i { ${SCROLLER}; scroll-snap-type: x; } .k { scroll-snap-align: start; } .n { scroll-snap-align: end; }`);
    expect(inner.errors).toEqual([...NATIVE, ...NATIVE].sort());
    expect(inner.messages).toEqual([
      'scroll snapping in i (scroll-snap-type: x, with k aligned start) is not implemented on <target> yet (SCROLL-SNAP): Chrome snaps the scroll position even at rest',
      'scroll snapping in s (scroll-snap-type: y mandatory, with n aligned end) is not implemented on <target> yet (SCROLL-SNAP): Chrome snaps the scroll position even at rest',
    ]);
    // A box that does not scroll between the container and its area leaves them paired.
    expect(snap(`.s { ${SCROLLER}; scroll-snap-type: y mandatory; } .k { scroll-snap-align: start; }`).errors).toEqual(NATIVE);
    // An absolutely positioned area inside i may have a containing block outside it, so s may snap it.
    expect(snap(`.s { ${SCROLLER}; position: relative; scroll-snap-type: y mandatory; } .i { ${SCROLLER}; } .k { position: absolute; scroll-snap-align: start; }`).errors).toEqual(NATIVE);
  });

  it('take the viewport\'s snap type from html alone, not from body', () => {
    const html = snap('.h { scroll-snap-type: y mandatory; } .o { scroll-snap-align: start; }');
    expect(html.errors).toEqual(NATIVE);
    expect(html.messages).toEqual(['scroll snapping in the viewport (scroll-snap-type: y mandatory on html, with o aligned start) is not implemented on <target> yet (SCROLL-SNAP): Chrome snaps the scroll position even at rest']);
    // body's snap type does not propagate to the viewport, and body is no scroll container while the viewport takes its overflow.
    expect(snap('.b { scroll-snap-type: y mandatory; } .o { scroll-snap-align: start; }').errors).toEqual([]);
    expect(snap('.b { overflow: auto; scroll-snap-type: y mandatory; } .o { scroll-snap-align: start; }').errors).toEqual([]);
    // With html's overflow not visible, body's own overflow makes it a scroll container, which snaps.
    expect(snap('.h { overflow: hidden; } .b { overflow: auto; height: 50px; scroll-snap-type: y mandatory; } .o { scroll-snap-align: start; }').errors).toEqual(NATIVE);
    // An area inside an element scroller is not the viewport's.
    expect(snap(`.h { scroll-snap-type: y mandatory; } .s { ${SCROLLER}; } .i { scroll-snap-align: start; }`).errors).toEqual([]);
  });
});
