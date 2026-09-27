// Stage 1 of docs/api.md §4.1: cascade, inheritance and browser defaults per element. No native properties here.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { properties as grammar } from '../css/grammar.generated.ts';
import type { Longhand } from '../css/properties.ts';
import { INHERITED, LONGHANDS } from '../css/properties.ts';
import type { CssValue, Declaration, Rule, Selector } from '../css/stylesheet.ts';
import type { CapturedTag } from '../ua/chrome-145.generated.ts';
import { computed as capturedUa } from '../ua/chrome-145.generated.ts';
import type { ElementNode, Span, TextNode } from '../types.ts';

export type Origin = 'author' | 'inherited' | 'user-agent' | 'initial';

export type ResolvedValue = { readonly value: CssValue; readonly origin: Origin; readonly span: Span | null };

export type ResolvedElement = {
  readonly kind: 'element';
  readonly node: ElementNode;
  readonly props: ReadonlyMap<Longhand, ResolvedValue>;
  readonly children: readonly (ResolvedElement | ResolvedText)[];
};

/** Literal text after CSS white-space: normal collapsing; whitespace-only runs are dropped. */
export type ResolvedText = { readonly kind: 'text'; readonly node: TextNode; readonly text: string };

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
  if (children.length !== 1 || only === undefined) v = { kind: 'other', type: 'list', text };
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

// css-cascade-5 §7.1: initial values come from the pinned @webref/css grammar.
function initialValue(property: Longhand): CssValue {
  const g = grammar[property];
  if (g === undefined) throw new Error(`no webref entry for ${property}`);
  return parseValueText(property, g.initial);
}

// css-cascade-5 §6.3 (user-agent origin): a tag's captured Chrome value that differs from an element with no UA rules is a UA rule.
function userAgentValue(tag: CapturedTag, property: Longhand): CssValue | null {
  const own = capturedUa[tag][property];
  const plain = capturedUa['dragon-unstyled'][property];
  if (own === undefined || plain === undefined) throw new Error(`no captured value for ${tag} ${property}`);
  return own === plain ? null : parseValueText(property, own);
}

function compoundMatches(el: ElementNode, c: Selector['parts'][number]['compound']): boolean {
  if (c.tag !== null && c.tag !== el.tag) return false;
  return c.classes.every((k) => el.classes.includes(k));
}

// Selectors-4 §3.3: right-to-left matching over the logical ancestor chain, with backtracking for descendant combinators.
function selectorMatches(sel: Selector, chain: readonly ElementNode[], index: number, part: number): boolean {
  const p = sel.parts[part];
  const el = chain[index];
  if (p === undefined || el === undefined) return false;
  if (!compoundMatches(el, p.compound)) return false;
  const next = sel.parts[part + 1];
  if (next === undefined) return true;
  if (next.combinator === '>') return selectorMatches(sel, chain, index - 1, part + 1);
  for (let i = index - 1; i >= 0; i--) if (selectorMatches(sel, chain, i, part + 1)) return true;
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

// css-cascade-5 §4-§7: the winning declaration, inheritance, then user-agent or initial values, for every longhand.
export function resolveTree(root: ElementNode, rules: readonly Rule[]): ResolvedElement {
  const visit = (el: ElementNode, chain: ElementNode[], parent: ResolvedElement | null): ResolvedElement => {
    const here = [...chain, el];
    const winners = new Map<Longhand, Candidate>();
    for (const rule of rules) {
      for (const sel of rule.selectors) {
        if (!selectorMatches(sel, here, here.length - 1, 0)) continue;
        for (const d of rule.declarations) {
          for (const lh of d.longhands) {
            const cand: Candidate = { declaration: d, value: lh.value, specificity: sel.specificity };
            const prev = winners.get(lh.property);
            if (prev === undefined || beats(cand, prev)) winners.set(lh.property, cand);
          }
        }
      }
    }
    const props = new Map<Longhand, ResolvedValue>();
    const tag = el.tag as CapturedTag;
    const fromParent = (p: Longhand): ResolvedValue => {
      if (parent === null) return { value: parseValueText(p, capturedUa.html[p] as string), origin: 'initial', span: null };
      const pv = parent.props.get(p) as ResolvedValue;
      return { value: pv.value, origin: 'inherited', span: pv.span };
    };
    const defaultFor = (p: Longhand): ResolvedValue => {
      const ua = userAgentValue(tag, p);
      return ua === null ? { value: initialValue(p), origin: 'initial', span: null } : { value: ua, origin: 'user-agent', span: null };
    };
    for (const p of LONGHANDS) {
      const w = winners.get(p);
      const inherited = INHERITED.has(p);
      if (w !== undefined && !(w.value.kind === 'keyword' && ['inherit', 'initial', 'unset'].includes(w.value.value))) {
        props.set(p, { value: w.value, origin: 'author', span: w.declaration.span });
      } else if (w !== undefined && w.value.kind === 'keyword') {
        const kw = w.value.value;
        const useInherit = kw === 'inherit' || (kw === 'unset' && inherited);
        const r = useInherit ? fromParent(p) : { value: initialValue(p), origin: 'initial' as const, span: null };
        props.set(p, { ...r, span: w.declaration.span });
      } else if (inherited) {
        props.set(p, parent === null ? (userAgentValue(tag, p) === null ? fromParent(p) : defaultFor(p)) : fromParent(p));
      } else {
        props.set(p, defaultFor(p));
      }
    }
    const self: { kind: 'element'; node: ElementNode; props: Map<Longhand, ResolvedValue>; children: (ResolvedElement | ResolvedText)[] } = {
      kind: 'element',
      node: el,
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
    case 'other':
      return v.text;
  }
}
