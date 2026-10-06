// Stage 1 of docs/api.md §4.1: cascade, inheritance and browser defaults per element. No native properties here. This file walks
// the tree; the tag table is elements.ts, selector matching match.ts, the cascade cascade.ts and value computation computed.ts,
// all re-exported here so existing imports keep working.
import { perturbColor } from '../css/color.ts';
import { envAsZero } from '../css/env.ts';
import { ENV_VALUE_TYPE } from '../css/values.ts';
import type { Longhand, TextLonghand } from '../css/properties.ts';
import { INHERITED, LONGHANDS, TEXT_LONGHANDS } from '../css/properties.ts';
import type { CssValue, Declaration, Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { UaDataset, UaKey } from '../ua/datasets.ts';
import { uaRows } from '../ua/datasets.ts';
import { blockify } from './blockify.ts';
import { cascadeElement } from './cascade.ts';
import type { ResolveEnvironment, ResolvedValue } from './computed.ts';
import { appearanceDisplay, blockifyRoot, computeGridLengths, computeJustifyItems, computeLengths, computeOverflowPair, declaredUserAgentValue, initialValue, pxOf, parseValueText, substituteVariables, userAgentValue } from './computed.ts';
import { uaTagOf } from './elements.ts';
import { presentationalHints } from './elements/replaced.ts';
import type { LinkedElement, LinkedText } from './link.ts';
import type { InteractionState } from './match.ts';
import { NO_INTERACTION } from './match.ts';
import type { Direction, DirectionContext } from './logical.ts';
import type { CustomProperties } from './variables.ts';

export { SUPPORTED_TAGS } from './elements.ts';
export { selectorMatches } from './match.ts';
export type { CascadeGroupHook, CascadeResult, Candidate } from './cascade.ts';
export { beats, cascadeElement, cascadeGroups } from './cascade.ts';
export type { Origin, ResolveEnvironment, ResolvedValue, RootFont, SubstitutionHook } from './computed.ts';
export type { CustomProperties, Substitution, VarScope } from './variables.ts';
export { declaredUserAgentValue, defaultOrigin, initialValue, isInitialByProvenance, parseValueText, substituteVariables, userAgentValue, valueToString } from './computed.ts';

export type ResolvedElement = {
  readonly kind: 'element';
  readonly element: LinkedElement;
  readonly props: ReadonlyMap<Longhand, ResolvedValue>;
  readonly children: readonly (ResolvedElement | ResolvedText)[];
};

/**
 * Literal text after white-space phase I collapsing over its inline formatting context (collapseInlineRun). Text that collapses
 * to nothing is dropped. props: every inherited text property, taken from the insertion parent with origin inherited.
 */
export type ResolvedText = {
  readonly kind: 'text';
  readonly node: LinkedText;
  readonly text: string;
  readonly props: ReadonlyMap<TextLonghand, ResolvedValue>;
};

const WHITE_SPACE = /[ \t\n\r\f]/;
const ZWSP = '\u200b';

/**
 * css-text-3 §4.1.1 (white-space-collapse: collapse) over the text runs of one inline formatting context, in order: each
 * sequence of white space, across run boundaries too, becomes one space kept by the run where the sequence starts; a sequence
 * with a segment break next to U+200B is removed (§4.1.3). §4.1.2 then removes the spaces at the context's start and end,
 * which always begin and end a line. Returns each run's collapsed text; "" means the run generates nothing.
 */
export function collapseInlineRun(texts: readonly string[]): string[] {
  const chars: { ch: string; run: number }[] = [];
  texts.forEach((t, run) => {
    for (const ch of t) chars.push({ ch, run });
  });
  const out: { ch: string; run: number }[] = [];
  let k = 0;
  while (k < chars.length) {
    const c = chars[k] as { ch: string; run: number };
    if (!WHITE_SPACE.test(c.ch)) {
      out.push(c);
      k++;
      continue;
    }
    let e = k;
    let segmentBreak = false;
    while (e < chars.length && WHITE_SPACE.test((chars[e] as { ch: string }).ch)) {
      const ch = (chars[e] as { ch: string }).ch;
      if (ch === '\n' || ch === '\r') segmentBreak = true;
      e++;
    }
    const before = out[out.length - 1];
    const after = chars[e];
    const nextToZwsp = (before !== undefined && before.ch === ZWSP) || (after !== undefined && after.ch === ZWSP);
    if (!(segmentBreak && nextToZwsp)) out.push({ ch: ' ', run: c.run });
    k = e;
  }
  while (out.length > 0 && (out[0] as { ch: string }).ch === ' ') out.shift();
  while (out.length > 0 && (out[out.length - 1] as { ch: string }).ch === ' ') out.pop();
  return texts.map((_, run) => out.filter((c) => c.run === run).map((c) => c.ch).join(''));
}

/**
 * collapseInlineRun over a whole inline formatting context that may hold line breaks (<br>, null in runs): a white space sequence
 * collapses across run and inline box boundaries, but not across a <br>. The spaces at the start of the context and after a <br>
 * begin a line, and the spaces at its end end one, so §4.1.2 removes them; a space before a <br> is kept, as Blink keeps it (it
 * hangs at the end of its line, INL-P f2-after-space). Without a <br> this is collapseInlineRun.
 */
export function collapseInlineContext(runs: readonly (string | null)[]): (string | null)[] {
  type C = { readonly ch: string; readonly run: number } | { readonly br: true };
  const chars: C[] = [];
  runs.forEach((t, run) => {
    if (t === null) chars.push({ br: true });
    else for (const ch of t) chars.push({ ch, run });
  });
  const out: { ch: string; run: number }[] = [];
  let lineStart = true;
  let k = 0;
  while (k < chars.length) {
    const c = chars[k] as C;
    if ('br' in c) {
      lineStart = true;
      k++;
      continue;
    }
    if (!WHITE_SPACE.test(c.ch)) {
      out.push(c);
      lineStart = false;
      k++;
      continue;
    }
    let e = k;
    let segmentBreak = false;
    while (e < chars.length) {
      const x = chars[e] as C;
      if ('br' in x || !WHITE_SPACE.test(x.ch)) break;
      if (x.ch === '\n' || x.ch === '\r') segmentBreak = true;
      e++;
    }
    const before = lineStart ? undefined : out[out.length - 1];
    const after = chars[e];
    const nextToZwsp = (before !== undefined && before.ch === ZWSP) || (after !== undefined && !('br' in after) && after.ch === ZWSP);
    if (before !== undefined && after !== undefined && !(segmentBreak && nextToZwsp)) out.push({ ch: ' ', run: c.run });
    k = e;
  }
  return runs.map((t, run) => (t === null ? null : out.filter((c) => c.run === run).map((c) => c.ch).join('')));
}

/** CSS2 §9.2.2: an element whose box is an inline box (display: inline after blockification, css-display-3 §2.7). */
const isInlineBox = (el: ResolvedElement): boolean => displayOf(el) === 'inline';

const displayOf = (el: ResolvedElement): string => {
  const v = (el.props.get('display') as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

// css-cascade-5 §4-§7: the winning declaration, inheritance, then user-agent or initial values, for every longhand. interaction:
// the hovered and focused elements the selectors match against (SELD-R2a); none by default.
// Logical ancestry is the linked tree: projected children match under their insertion parent (docs/api.md §3.1).
export function resolveTree(root: LinkedElement, rules: readonly Rule[], faults: CompilerFaults, environment: ResolveEnvironment, interaction: InteractionState = NO_INTERACTION): ResolvedElement {
  let resolvedRoot: ResolvedElement | null = null;
  // css-variables-1 §2: custom properties inherit; each element's are computed from its parent's.
  const customsOf = new WeakMap<ResolvedElement, CustomProperties>();
  // The children of each inline box, waiting for its block container's inline formatting context to collapse their text.
  const pendingInline = new Map<ResolvedElement, readonly (ResolvedElement | LinkedText)[]>();
  const visit = (el: LinkedElement, chain: LinkedElement[], parent: ResolvedElement | null): ResolvedElement => {
    const here = [...chain, el];
    const { winners, matched, scope } = cascadeElement(rules, here, faults, directionContext(parent, faults, environment), parent === null ? new Map() : (customsOf.get(parent) as CustomProperties), interaction);
    const props = new Map<Longhand, ResolvedValue>();
    const tag = uaTagOf(el.tag);
    const none = { declaration: null, declared: null, losing: [] } as const;
    const fromParent = (p: Longhand): ResolvedValue => {
      if (parent === null) return { value: parseValueText(p, environment.ua.computed.html[p] as string), origin: 'initial', span: null, ...none };
      const pv = parent.props.get(p) as ResolvedValue;
      return { value: pv.value, origin: 'inherited', span: pv.span, ...none };
    };
    const defaultFor = (p: Longhand): ResolvedValue => {
      const ua = userAgentValue(tag, p, environment.ua);
      return ua === null ? { value: initialValue(p, environment.ua), origin: 'initial', span: null, ...none } : { value: ua, origin: 'user-agent', span: null, ...none };
    };
    // Longhands no author declaration set: their UA value depends on the element's final direction and font size (below).
    const defaulted = new Set<Longhand>();
    const hints = presentationalHints(el.tag, el.attributes);
    for (const p of LONGHANDS) {
      const raw = winners.get(p);
      const w = raw === undefined ? undefined : substituteVariables(raw, p, el, scope);
      const inherited = INHERITED.has(p);
      // A refused substitution already blocks every target (computed-checks.ts); it keys no profile row.
      const declared = w === undefined || (w.substitution !== undefined && w.substitution.refusal !== null) ? null : w.value;
      const author = w === undefined || raw === undefined ? none : {
        declaration: w.declaration,
        declared,
        losing: (matched.get(p) as readonly Declaration[]).filter((d) => d !== raw.declaration),
        ...(w.substitution === undefined ? {} : { substitution: w.substitution }),
      };
      // css-color-4 §4.4: currentcolor as the value of color behaves as inherit.
      const currentColorOnColor = p === 'color' && w !== undefined && w.value.kind === 'keyword' && w.value.value === 'currentcolor';
      if (w !== undefined && !currentColorOnColor && !(w.value.kind === 'keyword' && ['inherit', 'initial', 'unset'].includes(w.value.value))) {
        props.set(p, { value: w.value, origin: 'author', span: w.declaration.span, ...author });
      } else if (w !== undefined && w.value.kind === 'keyword') {
        const kw = w.value.value;
        const useInherit = kw === 'inherit' || currentColorOnColor || (kw === 'unset' && inherited);
        const r = useInherit ? fromParent(p) : { value: initialValue(p, environment.ua), origin: 'initial' as const, span: null };
        props.set(p, { ...r, span: w.declaration.span, ...author });
      } else if (inherited && parent === null && p === 'direction') {
        // docs/api.md §7: the environment direction is the root's base direction; the harness gives both renderings the same one.
        props.set(p, { value: { kind: 'keyword', value: faults.ignoreEnvironmentDirection ? 'ltr' : environment.direction }, origin: 'environment', span: null, ...none });
      } else if (parent === null && p === 'font-family' && environment.rootFont === 'ahem') {
        // docs/api.md §10.1: the fixture environment sets the root font-family to Ahem, as the harness does in both renderings.
        props.set(p, { value: { kind: 'family', value: 'Ahem' }, origin: 'environment', span: null, ...none });
      } else if (inherited) {
        props.set(p, parent === null ? (userAgentValue(tag, p, environment.ua) === null ? fromParent(p) : defaultFor(p)) : fromParent(p));
        defaulted.add(p);
      } else if (w === undefined && hints.has(p as 'width')) {
        props.set(p, { value: hints.get(p as 'width') as CssValue, origin: 'presentational-hint', span: null, ...none });
      } else {
        props.set(p, defaultFor(p));
        defaulted.add(p);
      }
    }
    const parentFontSize = parent === null ? pxOf(parseValueText('font-size', environment.ua.computed.html['font-size'] as string)) : pxOf((parent.props.get('font-size') as ResolvedValue).value);
    const rootFontSize = resolvedRoot === null ? null : pxOf((resolvedRoot.props.get('font-size') as ResolvedValue).value);
    // The UA em defaults below read the element's computed font-size, so an author em or rem font-size is made px first.
    const fontSize = new Map<Longhand, ResolvedValue>([['font-size', props.get('font-size') as ResolvedValue]]);
    computeLengths(fontSize, parentFontSize, rootFontSize);
    props.set('font-size', fontSize.get('font-size') as ResolvedValue);
    applyDeclaredUserAgent(tag, props, defaulted, parent, environment.ua, fromParent);
    // A replaced key's forced values (iframe overflow: clip) hold whatever the cascade says (ELB-2 userAgentForced).
    applyForcedUserAgent(tag, props, environment.ua);
    for (const p of LONGHANDS) {
      const set = props.get(p) as ResolvedValue;
      if (faults.colourOnly && set.origin !== 'inherited' && set.value.kind === 'color') {
        props.set(p, { ...set, value: { ...set.value, value: perturbColor(set.value.value) } });
      }
      if (faults.envResolvedToZero && set.value.kind === 'other' && set.value.type === ENV_VALUE_TYPE) {
        props.set(p, { ...set, value: { ...set.value, text: envAsZero(set.value.text) } });
      }
    }
    computeLengths(props, parentFontSize, rootFontSize);
    // Blink LayoutTheme::AdjustStyle: an appearance other than none makes an inline or table display inline-block or block.
    props.set('display', appearanceDisplay(props.get('display') as ResolvedValue, props.get('appearance') as ResolvedValue));
    if (parent === null) props.set('display', blockifyRoot(props.get('display') as ResolvedValue));
    blockify(props, parent === null ? null : parent.props, faults);
    computeOverflowPair(props);
    const ownFontSize = pxOf((props.get('font-size') as ResolvedValue).value);
    computeGridLengths(props, ownFontSize, rootFontSize ?? ownFontSize);
    computeJustifyItems(props, parent === null ? null : parent.props);
    const self: { kind: 'element'; element: LinkedElement; props: Map<Longhand, ResolvedValue>; children: (ResolvedElement | ResolvedText)[] } = {
      kind: 'element',
      element: el,
      props,
      children: [],
    };
    if (resolvedRoot === null) resolvedRoot = self;
    customsOf.set(self, scope.customs);
    const kids: (ResolvedElement | LinkedText)[] = el.children.map((child) => (child.kind === 'element' ? visit(child, here, self) : child));
    // CSS2 §9.2.2: an inline box's content belongs to its block container's inline formatting context, which collapses it.
    if (parent !== null && isInlineBox(self)) {
      pendingInline.set(self, kids);
      return self;
    }
    // An inline formatting context is a maximal sequence of text, inline boxes and <br>s; display: none elements generate no box
    // (CSS2 §9.2.4), so they do not end it, and any other element does (CSS2 §9.2.1.1, css-flexbox-1 §4).
    const collapsed = new Map<LinkedText, string>();
    let run: (LinkedText | null)[] = [];
    const flush = (): void => {
      const texts = collapseInlineContext(run.map((t) => (t === null ? null : t.text)));
      run.forEach((t, i) => {
        if (t !== null) collapsed.set(t, texts[i] as string);
      });
      run = [];
    };
    const gather = (items: readonly (ResolvedElement | LinkedText)[]): void => {
      for (const kid of items) {
        if (kid.kind === 'text') run.push(kid);
        else if (displayOf(kid) === 'none') continue;
        else if (isInlineBox(kid)) {
          if (kid.element.tag === 'br') run.push(null);
          gather(pendingInline.get(kid) as readonly (ResolvedElement | LinkedText)[]);
        } else flush();
      }
    };
    gather(kids);
    flush();
    const place = (owner: { children: (ResolvedElement | ResolvedText)[] }, ownerProps: ReadonlyMap<Longhand, ResolvedValue>, items: readonly (ResolvedElement | LinkedText)[]): void => {
      for (const kid of items) {
        if (kid.kind === 'element') {
          owner.children.push(kid);
          const pending = pendingInline.get(kid);
          if (pending !== undefined) place(kid as { children: (ResolvedElement | ResolvedText)[] } & ResolvedElement, kid.props, pending);
          continue;
        }
        const text = collapsed.get(kid);
        if (text === undefined) throw new Error(`${kid.address}: text outside any inline formatting context`);
        if (text.length > 0) owner.children.push({ kind: 'text', node: kid, text, props: textProps(ownerProps, faults, environment.ua) });
      }
    };
    place(self, props, kids);
    return self;
  };
  const resolved = visit(root, [], null);
  resolvedEnvironments.set(resolved, environment);
  return resolved;
}

const resolvedEnvironments = new WeakMap<ResolvedElement, ResolveEnvironment>();

/** The environment a root returned by resolveTree was resolved in; the computed-value checks read its UA dataset. */
export function environmentOf(root: ResolvedElement): ResolveEnvironment {
  const e = resolvedEnvironments.get(root);
  if (e === undefined) throw new Error(`${root.element.address} is not a root returned by resolveTree`);
  return e;
}

/**
 * css-cascade-5 §6.3: a longhand no author declaration set takes the tag's declared UA value for the element's computed direction
 * and font size (font-size first, since the others are relative to it), or else its inherited or initial value.
 */
function applyDeclaredUserAgent(tag: UaKey, props: Map<Longhand, ResolvedValue>, defaulted: ReadonlySet<Longhand>, parent: ResolvedElement | null, ua: UaDataset, fromParent: (p: Longhand) => ResolvedValue): void {
  const none = { span: null, declaration: null, declared: null, losing: [] } as const;
  const dirValue = (props.get('direction') as ResolvedValue).value;
  const direction = dirValue.kind === 'keyword' && dirValue.value === 'rtl' ? 'rtl' : 'ltr';
  const parentFontSize = (parent === null ? fromParent('font-size') : (parent.props.get('font-size') as ResolvedValue)).value;
  const order = [...defaulted].sort((a, b) => Number(b === 'font-size') - Number(a === 'font-size'));
  for (const p of order) {
    const ownFontSize = (props.get('font-size') as ResolvedValue).value;
    const value = declaredUserAgentValue(tag, p, ua, direction, ownFontSize, parentFontSize);
    if (value !== null) props.set(p, { value, origin: 'user-agent', ...none });
    else if ((props.get(p) as ResolvedValue).origin === 'user-agent') props.set(p, INHERITED.has(p) && parent !== null ? fromParent(p) : { value: initialValue(p, ua), origin: 'initial', ...none });
  }
}

function applyForcedUserAgent(tag: UaKey, props: Map<Longhand, ResolvedValue>, ua: UaDataset): void {
  const dirValue = (props.get('direction') as ResolvedValue).value;
  const forced = uaRows(ua, tag).forced[dirValue.kind === 'keyword' && dirValue.value === 'rtl' ? 'rtl' : 'ltr'];
  for (const [p, text] of Object.entries(forced)) {
    const was = props.get(p as Longhand);
    if (was === undefined) throw new Error(`forced UA value for ${p}, which is not a longhand`);
    const value = parseValueText(p as Longhand, text);
    // The author winner lost to the forced value, not to another declaration; the declarations it beat keep their own reason.
    if (was.declaration === null) props.set(p as Longhand, { value, origin: 'user-agent', span: null, declaration: null, declared: null, losing: was.losing });
    else props.set(p as Longhand, { value, origin: 'user-agent', span: null, declaration: null, declared: null, losing: [was.declaration, ...was.losing], forcedOver: was.declaration });
  }
}

/** The direction context of an element (logical.ts), from its parent's computed direction or, at the root, the environment. */
function directionContext(parent: ResolvedElement | null, faults: CompilerFaults, environment: ResolveEnvironment): DirectionContext {
  const keyword = (v: CssValue): Direction => (v.kind === 'keyword' && v.value === 'rtl' ? 'rtl' : 'ltr');
  if (parent !== null) {
    const d = keyword((parent.props.get('direction') as ResolvedValue).value);
    return { undeclared: d, inherited: d };
  }
  return { undeclared: faults.ignoreEnvironmentDirection ? 'ltr' : environment.direction, inherited: keyword(parseValueText('direction', environment.ua.computed.html['direction'] as string)) };
}

// goal.md principle 3: a text node carries each inherited text property itself, inherited from its insertion parent.
function textProps(parent: ReadonlyMap<Longhand, ResolvedValue>, faults: CompilerFaults, ua: UaDataset): Map<TextLonghand, ResolvedValue> {
  const out = new Map<TextLonghand, ResolvedValue>();
  for (const p of TEXT_LONGHANDS) {
    const pv = parent.get(p) as ResolvedValue;
    out.set(p, { value: pv.value, origin: 'inherited', span: pv.span, declaration: null, declared: null, losing: [] });
  }
  // Planted fault dropInheritedText: the text node's font-size is its initial value (medium, 16px computed in Chrome's root).
  if (faults.dropInheritedText) out.set('font-size', { value: parseValueText('font-size', ua.computed.html['font-size'] as string), origin: 'initial', span: null, declaration: null, declared: null, losing: [] });
  return out;
}
