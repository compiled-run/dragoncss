// Stage 1 of docs/api.md §4.1: cascade, inheritance and browser defaults per element. No native properties here.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { parseColorNode, perturbColor, serializeColor } from '../css/color.ts';
import { properties as grammar } from '../css/grammar.generated.ts';
import type { Longhand } from '../css/properties.ts';
import { COLOR_LONGHANDS, INHERITED, LONGHANDS } from '../css/properties.ts';
import type { CssValue, Declaration, Rule, Selector } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { CapturedTag } from '../ua/chrome-145.generated.ts';
import { computed as capturedUa, userAgentLonghands } from '../ua/chrome-145.generated.ts';
import type { Span } from '../types.ts';
import type { LinkedElement, LinkedText } from './link.ts';

export type Origin = 'author' | 'inherited' | 'user-agent' | 'initial';

export type ResolvedValue = {
  readonly value: CssValue;
  readonly origin: Origin;
  readonly span: Span | null;
  /** The winning declaration and the value it declared (possibly a CSS-wide keyword); null when no author rule matched. */
  readonly declaration: Declaration | null;
  readonly declared: CssValue | null;
  /** Author declarations that matched this element for this longhand and lost the cascade. */
  readonly losing: readonly Declaration[];
};

export type ResolvedElement = {
  readonly kind: 'element';
  readonly element: LinkedElement;
  readonly props: ReadonlyMap<Longhand, ResolvedValue>;
  readonly children: readonly (ResolvedElement | ResolvedText)[];
};

/** Literal text after CSS white-space: normal collapsing; whitespace-only runs are dropped. */
export type ResolvedText = { readonly kind: 'text'; readonly node: LinkedText; readonly text: string };

export const SUPPORTED_TAGS: ReadonlySet<string> = new Set(['html', 'body', 'div']);

const valueCache = new Map<string, CssValue>();

/** Parses a single captured or initial value string ("8px", "auto", "0") into a CssValue. */
export function parseValueText(property: Longhand, text: string): CssValue {
  const key = `${property}\u0000${text}`;
  const hit = valueCache.get(key);
  if (hit !== undefined) return hit;
  const node = parse(text, { context: 'value' });
  const children = (node['children'] as { toArray(): CssNode[] }).toArray().filter((n) => n.type !== 'WhiteSpace');
  let v: CssValue;
  const only = children[0];
  const isColor = (COLOR_LONGHANDS as readonly string[]).includes(property);
  const color = isColor && only !== undefined && children.length === 1 ? parseColorNode(only) : null;
  if (color !== null && color.ok) v = color.kind === 'keyword' ? { kind: 'keyword', value: color.keyword } : { kind: 'color', value: color.value, syntax: color.syntax };
  else if (children.length !== 1 || only === undefined) v = { kind: 'other', type: 'list', text };
  else if (only.type === 'Identifier') v = property === 'font-family' ? { kind: 'family', value: String(only['name']) } : { kind: 'keyword', value: String(only['name']).toLowerCase() };
  else if (only.type === 'Dimension') v = { kind: 'length', value: Number(only['value']), unit: String(only['unit']).toLowerCase() };
  else if (only.type === 'Percentage') v = { kind: 'percentage', value: Number(only['value']) };
  else if (only.type === 'Number') {
    const n = Number(only['value']);
    v = n === 0 && !['flex-grow', 'flex-shrink', 'order', 'line-height'].includes(property) ? { kind: 'length', value: 0, unit: 'px' } : { kind: 'number', value: n };
  } else v = { kind: 'other', type: only.type, text };
  valueCache.set(key, v);
  return v;
}

// css-cascade-5 §7.1: initial values come from the pinned @webref/css grammar. color (CanvasText, css-color-4 §6.2) and
// font-family (UA-dependent, css-fonts-4 §2.1) have environment-dependent initial values, taken from Chrome's captured root.
function initialValue(property: Longhand): CssValue {
  if (property === 'color' || property === 'font-family') return parseValueText(property, capturedUa.html[property] as string);
  const g = grammar[property];
  if (g === undefined) throw new Error(`no webref entry for ${property}`);
  return parseValueText(property, g.initial);
}

// css-cascade-5 §6.3 (user-agent origin): the captured table pins, per tag, the longhands a Chrome UA rule sets.
function userAgentValue(tag: CapturedTag, property: Longhand): CssValue | null {
  if (!userAgentLonghands[tag].includes(property)) return null;
  const own = capturedUa[tag][property];
  if (own === undefined) throw new Error(`no captured value for ${tag} ${property}`);
  return parseValueText(property, own);
}

/** Origin of every longhand on an element with no author rules, as the resolver decides it; pinned by ua.test.ts. */
export function defaultOrigin(tag: CapturedTag, property: Longhand, isRoot: boolean): Origin {
  if (userAgentValue(tag, property) !== null) return 'user-agent';
  return INHERITED.has(property) && !isRoot ? 'inherited' : 'initial';
}

// A class selector matches only class symbols of the rule's own owner and sheet (docs/api.md §3.1); [ui-*] tests the attribute.
function compoundMatches(el: LinkedElement, rule: Rule, c: Selector['parts'][number]['compound'], faults: CompilerFaults): boolean {
  if (c.tag !== null && c.tag !== el.tag) return false;
  const classes = faults.variantCollapse && c.classes.length >= 2 ? c.classes.slice(0, -1) : c.classes;
  if (!classes.every((k) => el.classes.some((s) => s.owner === rule.owner && s.sheet === rule.sheet && s.name === k))) return false;
  return c.attributes.every((a) => {
    const v = el.attributes.get(a.name);
    return v !== undefined && (a.value === null || a.value === v);
  });
}

// Selectors-4 §3.3: right-to-left matching over the logical ancestor chain, with backtracking for descendant combinators.
function selectorMatches(rule: Rule, sel: Selector, chain: readonly LinkedElement[], index: number, part: number, faults: CompilerFaults): boolean {
  const p = sel.parts[part];
  const el = chain[index];
  if (p === undefined || el === undefined) return false;
  if (!compoundMatches(el, rule, p.compound, faults)) return false;
  const next = sel.parts[part + 1];
  if (next === undefined) return true;
  if (next.combinator === '>') return selectorMatches(rule, sel, chain, index - 1, part + 1, faults);
  for (let i = index - 1; i >= 0; i--) if (selectorMatches(rule, sel, chain, i, part + 1, faults)) return true;
  return false;
}

type Candidate = { readonly declaration: Declaration; readonly value: CssValue; readonly specificity: readonly [number, number, number] };

function beats(a: Candidate, b: Candidate): boolean {
  for (let i = 0; i < 3; i++) {
    const x = a.specificity[i] as number;
    const y = b.specificity[i] as number;
    if (x !== y) return x > y;
  }
  return a.declaration.order > b.declaration.order;
}

/** css-text-3 §4.1.1 white-space: normal. S1 lines are single, so leading and trailing spaces are removed too. */
export function collapseWhiteSpace(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '');
}

// css-display-3 §2.7: the root element's display is blockified (Chrome reports block for html even under display: initial).
function blockifyRoot(v: ResolvedValue): ResolvedValue {
  return v.value.kind === 'keyword' && v.value.value === 'inline' ? { ...v, value: { kind: 'keyword', value: 'block' } } : v;
}

// css-cascade-5 §4-§7: the winning declaration, inheritance, then user-agent or initial values, for every longhand.
// Logical ancestry is the linked tree: projected children match under their insertion parent (docs/api.md §3.1).
export function resolveTree(root: LinkedElement, rules: readonly Rule[], faults: CompilerFaults): ResolvedElement {
  const visit = (el: LinkedElement, chain: LinkedElement[], parent: ResolvedElement | null): ResolvedElement => {
    const here = [...chain, el];
    const winners = new Map<Longhand, Candidate>();
    const matched = new Map<Longhand, Declaration[]>();
    for (const rule of rules) {
      for (const sel of rule.selectors) {
        if (!selectorMatches(rule, sel, here, here.length - 1, 0, faults)) continue;
        for (const d of rule.declarations) {
          for (const lh of d.longhands) {
            const cand: Candidate = { declaration: d, value: lh.value, specificity: sel.specificity };
            const prev = winners.get(lh.property);
            if (prev === undefined || beats(cand, prev)) winners.set(lh.property, cand);
            const all = matched.get(lh.property) ?? [];
            if (!all.includes(d)) all.push(d);
            matched.set(lh.property, all);
          }
        }
      }
    }
    const props = new Map<Longhand, ResolvedValue>();
    const tag = el.tag as CapturedTag;
    const none = { declaration: null, declared: null, losing: [] } as const;
    const fromParent = (p: Longhand): ResolvedValue => {
      if (parent === null) return { value: parseValueText(p, capturedUa.html[p] as string), origin: 'initial', span: null, ...none };
      const pv = parent.props.get(p) as ResolvedValue;
      return { value: pv.value, origin: 'inherited', span: pv.span, ...none };
    };
    const defaultFor = (p: Longhand): ResolvedValue => {
      const ua = userAgentValue(tag, p);
      return ua === null ? { value: initialValue(p), origin: 'initial', span: null, ...none } : { value: ua, origin: 'user-agent', span: null, ...none };
    };
    for (const p of LONGHANDS) {
      const w = winners.get(p);
      const inherited = INHERITED.has(p);
      const author = w === undefined ? none : { declaration: w.declaration, declared: w.value, losing: (matched.get(p) as Declaration[]).filter((d) => d !== w.declaration) };
      // css-color-4 §4.4: currentcolor as the value of color behaves as inherit.
      const currentColorOnColor = p === 'color' && w !== undefined && w.value.kind === 'keyword' && w.value.value === 'currentcolor';
      if (w !== undefined && !currentColorOnColor && !(w.value.kind === 'keyword' && ['inherit', 'initial', 'unset'].includes(w.value.value))) {
        props.set(p, { value: w.value, origin: 'author', span: w.declaration.span, ...author });
      } else if (w !== undefined && w.value.kind === 'keyword') {
        const kw = w.value.value;
        const useInherit = kw === 'inherit' || currentColorOnColor || (kw === 'unset' && inherited);
        const r = useInherit ? fromParent(p) : { value: initialValue(p), origin: 'initial' as const, span: null };
        props.set(p, { ...r, span: w.declaration.span, ...author });
      } else if (inherited) {
        props.set(p, parent === null ? (userAgentValue(tag, p) === null ? fromParent(p) : defaultFor(p)) : fromParent(p));
      } else {
        props.set(p, defaultFor(p));
      }
      const set = props.get(p) as ResolvedValue;
      if (faults.colourOnly && set.origin !== 'inherited' && set.value.kind === 'color') {
        props.set(p, { ...set, value: { ...set.value, value: perturbColor(set.value.value) } });
      }
    }
    if (parent === null) props.set('display', blockifyRoot(props.get('display') as ResolvedValue));
    const self: { kind: 'element'; element: LinkedElement; props: Map<Longhand, ResolvedValue>; children: (ResolvedElement | ResolvedText)[] } = {
      kind: 'element',
      element: el,
      props,
      children: [],
    };
    for (const child of el.children) {
      if (child.kind === 'element') self.children.push(visit(child, here, self));
      else {
        const text = collapseWhiteSpace(child.text);
        if (text.length > 0) self.children.push({ kind: 'text', node: child, text });
      }
    }
    return self;
  };
  return visit(root, [], null);
}

export function valueToString(v: CssValue): string {
  switch (v.kind) {
    case 'keyword':
    case 'family':
      return v.value;
    case 'length':
      return `${v.value}${v.unit}`;
    case 'percentage':
      return `${v.value}%`;
    case 'number':
      return String(v.value);
    case 'color':
      return serializeColor(v.value);
    case 'other':
      return v.text;
  }
}
