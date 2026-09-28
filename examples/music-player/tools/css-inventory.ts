// Inventory of the north-star stylesheet: every declaration with its source span, rule and enclosing at-rule, and every CSS
// feature it uses (properties, value functions, units, selector parts, at-rules and media features) with its use count.
// css-tree 3.2.1 is resolved from packages/dragon, which already depends on it; nothing is installed for the example.
import { createRequire } from 'node:module';
import { repoPath } from './snapshot.ts';

type Loc = { readonly start: { readonly offset: number; readonly line: number; readonly column: number }; readonly end: { readonly offset: number } };
type Node = { readonly type: string; readonly loc?: Loc | null; readonly [key: string]: unknown };
type CssTree = {
  parse(text: string, options: { positions: boolean; onParseError?: (e: { message: string }) => void }): Node;
  walk(ast: Node, visit: (node: Node) => void): void;
};

const csstree = createRequire(repoPath('packages/dragon/package.json'))('css-tree') as CssTree;

export type Span = { readonly start: number; readonly end: number };

export type CssDeclaration = {
  readonly index: number;
  readonly property: string;
  readonly value: string;
  readonly line: number;
  readonly span: Span;
  /** The rule's selector list as written. */
  readonly selector: string;
  readonly selectorSpan: Span;
  /** The whole rule, selector through closing brace. */
  readonly ruleSpan: Span;
  /** The enclosing at-rule ("@media screen and (max-width: 768px)", "@keyframes album-spin") or null. */
  readonly atRule: string | null;
  readonly atRuleSpan: Span | null;
  /** Value features of this declaration (functions, units, notable keywords). */
  readonly features: readonly string[];
};

export type CssInventory = {
  readonly declarations: readonly CssDeclaration[];
  /** Feature key -> number of uses in the stylesheet (see featureKey kinds below), sorted by key. */
  readonly features: Readonly<Record<string, number>>;
  readonly rules: number;
};

const children = (n: Node | null | undefined): Node[] => {
  if (n === null || n === undefined) return [];
  const c = n['children'];
  return Array.isArray(c) ? (c as Node[]) : c !== null && c !== undefined && typeof (c as { toArray?: unknown }).toArray === 'function' ? (c as { toArray(): Node[] }).toArray() : [];
};

const spanOf = (n: Node): Span => {
  if (n.loc === null || n.loc === undefined) throw new Error(`${n.type} has no position`);
  return { start: n.loc.start.offset, end: n.loc.end.offset };
};

const KEYWORDS = new Set(['inherit', 'transparent', 'infinite', 'paused', 'running', 'none', 'auto']);

function valueFeatures(value: Node, property: string, out: string[]): void {
  if (property.startsWith('--')) {
    out.push('value:custom-property-definition');
    return;
  }
  csstree.walk(value, (n) => {
    if (n.type === 'Function') out.push(`function:${String(n['name'])}()`);
    else if (n.type === 'Dimension') out.push(`unit:${String(n['unit'])}`);
    else if (n.type === 'Percentage') out.push('unit:%');
    else if (n.type === 'Hash') out.push('color:#hex');
    else if (n.type === 'Identifier' && KEYWORDS.has(String(n['name']))) out.push(`keyword:${String(n['name'])}`);
  });
}

function selectorFeatures(list: Node, out: string[]): void {
  const selectors = children(list);
  if (selectors.length > 1) out.push('selector:list');
  for (const sel of selectors) {
    let classesInCompound = 0;
    const flush = (): void => {
      if (classesInCompound > 1) out.push('selector:compound-classes');
      classesInCompound = 0;
    };
    for (const part of children(sel)) {
      switch (part.type) {
        case 'TypeSelector':
          out.push(String(part['name']) === '*' ? 'selector:universal *' : `selector:type ${String(part['name'])}`);
          break;
        case 'ClassSelector':
          classesInCompound++;
          out.push('selector:class');
          break;
        case 'IdSelector':
          out.push('selector:id');
          break;
        case 'PseudoClassSelector':
          out.push(`selector:pseudo-class :${String(part['name'])}`);
          break;
        case 'PseudoElementSelector':
          out.push(`selector:pseudo-element ::${String(part['name'])}`);
          break;
        case 'AttributeSelector': {
          const name = (part['name'] as Node)['name'];
          out.push(`selector:attribute [${String(name)}=]`);
          break;
        }
        case 'Combinator':
          flush();
          out.push(String(part['name']) === ' ' ? 'selector:descendant combinator' : `selector:combinator ${String(part['name'])}`);
          break;
        default:
          out.push(`selector:${part.type}`);
      }
    }
    flush();
  }
}

export function inventory(css: string): CssInventory {
  const errors: string[] = [];
  const ast = csstree.parse(css, { positions: true, onParseError: (e) => errors.push(e.message) });
  if (errors.length > 0) throw new Error(`styles.css does not parse: ${errors.join('; ')}`);
  const declarations: CssDeclaration[] = [];
  const counts = new Map<string, number>();
  const count = (k: string): void => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  let rules = 0;
  const visitRule = (rule: Node, at: { text: string; span: Span; keyframes: boolean } | null): void => {
    rules++;
    const prelude = rule['prelude'] as Node;
    const selectorSpan = spanOf(prelude);
    const selector = css.slice(selectorSpan.start, selectorSpan.end);
    const selFeatures: string[] = [];
    if (at !== null && at.keyframes) selFeatures.push(`keyframe-selector:${selector.trim()}`);
    else selectorFeatures(prelude, selFeatures);
    for (const f of selFeatures) count(f);
    for (const d of children(rule['block'] as Node)) {
      if (d.type !== 'Declaration') throw new Error(`unexpected ${d.type} in a rule block`);
      const property = String(d['property']);
      const span = spanOf(d);
      const valueNode = d['value'] as Node;
      const vs = spanOf(valueNode);
      const features: string[] = [];
      valueFeatures(valueNode, property, features);
      for (const f of features) count(f);
      count(property.startsWith('--') ? 'property:--* (custom property)' : `property:${property}`);
      declarations.push({
        index: declarations.length,
        property,
        value: css.slice(vs.start, vs.end).trim(),
        line: (d.loc as Loc).start.line,
        span,
        selector,
        selectorSpan,
        ruleSpan: spanOf(rule),
        atRule: at === null ? null : at.text,
        atRuleSpan: at === null ? null : at.span,
        features: [...new Set(features)].sort(),
      });
    }
  };
  for (const top of children(ast)) {
    if (top.type === 'Rule') visitRule(top, null);
    else if (top.type === 'Atrule') {
      const name = String(top['name']);
      count(`at-rule:@${name}`);
      const prelude = top['prelude'] as Node;
      const text = `@${name} ${css.slice(spanOf(prelude).start, spanOf(prelude).end).trim()}`;
      if (name === 'media') {
        csstree.walk(prelude, (n) => {
          if (n.type === 'MediaQuery' && n['mediaType'] !== null) count(`media-type:${String(n['mediaType'])}`);
          if (n.type === 'Feature') count(`media-feature:(${String(n['name'])})`);
        });
      }
      for (const r of children(top['block'] as Node)) {
        if (r.type !== 'Rule') throw new Error(`unexpected ${r.type} in @${name}`);
        visitRule(r, { text, span: spanOf(top), keyframes: name === 'keyframes' });
      }
    } else throw new Error(`unexpected top-level ${top.type}`);
  }
  const features: Record<string, number> = {};
  for (const k of [...counts.keys()].sort()) features[k] = counts.get(k) as number;
  return { declarations, features, rules };
}

/** Longhands every box dump reports beside the authored properties, so geometry and text can be compared without the CSS. */
const CORE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-color', 'border-top-style',
  'top', 'right', 'bottom', 'left', 'z-index', 'overflow-x', 'overflow-y', 'opacity', 'transform', 'transform-origin',
  'color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'white-space', 'overflow-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-direction', 'flex-wrap',
  'align-items', 'justify-content', 'row-gap', 'column-gap', 'aspect-ratio', 'object-fit', 'border-radius', 'box-shadow',
  'animation-name', 'animation-play-state', 'transition-property', 'text-decoration-color', 'text-underline-offset', 'appearance',
];

/** The authored (non-custom) properties of the stylesheet plus CORE_PROPERTIES, sorted and deduplicated. */
export function usedProperties(css: string): readonly string[] {
  const authored = inventory(css).declarations.map((d) => d.property).filter((p) => !p.startsWith('--') && !p.startsWith('-webkit-') && !p.startsWith('-moz-'));
  return [...new Set([...authored, ...CORE_PROPERTIES])].sort();
}
