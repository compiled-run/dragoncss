// Every declaration of a page stylesheet with its span, its rule's selector span and rule span, and its enclosing at-rule.
// Handles what real pages use and the north-star inventory does not: @font-face blocks and declarations straight inside at-rules.
import { createRequire } from 'node:module';

type Loc = { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } };
type Node = { readonly type: string; readonly loc?: Loc | null; readonly [key: string]: unknown };
const csstree = createRequire(new URL('../../../packages/dragon/package.json', import.meta.url))('css-tree') as {
  parse(text: string, options: { positions: boolean }): Node;
};

export type Span = { readonly start: number; readonly end: number };
export type Decl = {
  readonly property: string;
  readonly value: string;
  readonly span: Span;
  readonly selector: string;
  readonly selectorSpan: Span;
  readonly ruleSpan: Span;
  readonly atRule: string | null;
  readonly atRuleSpan: Span | null;
};

const kids = (n: Node | null | undefined): Node[] => {
  const c = n?.['children'] as { toArray?: () => Node[] } | undefined;
  return c === undefined || c === null ? [] : typeof c.toArray === 'function' ? c.toArray() : (c as unknown as Node[]);
};
const spanOf = (n: Node): Span => ({ start: (n.loc as Loc).start.offset, end: (n.loc as Loc).end.offset });

export function declarations(css: string): Decl[] {
  const out: Decl[] = [];
  const ast = csstree.parse(css, { positions: true });
  const visit = (n: Node, at: { text: string; span: Span } | null): void => {
    if (n.type === 'Rule') {
      const sel = spanOf(n['prelude'] as Node);
      for (const d of kids(n['block'] as Node)) {
        if (d.type === 'Declaration') {
          const v = spanOf(d['value'] as Node);
          out.push({ property: String(d['property']), value: css.slice(v.start, v.end).trim(), span: spanOf(d), selector: css.slice(sel.start, sel.end), selectorSpan: sel, ruleSpan: spanOf(n), atRule: at?.text ?? null, atRuleSpan: at?.span ?? null });
        } else visit(d, at);
      }
    } else if (n.type === 'Atrule') {
      const prelude = n['prelude'] as Node | null;
      const text = `@${String(n['name'])}${prelude === null ? '' : ` ${css.slice(spanOf(prelude).start, spanOf(prelude).end).trim()}`}`;
      const span = spanOf(n);
      for (const d of kids(n['block'] as Node)) {
        if (d.type === 'Declaration') {
          const v = spanOf(d['value'] as Node);
          out.push({ property: String(d['property']), value: css.slice(v.start, v.end).trim(), span: spanOf(d), selector: text, selectorSpan: { start: span.start, end: span.start + text.length }, ruleSpan: span, atRule: text, atRuleSpan: span });
        } else visit(d, { text, span });
      }
    }
  };
  for (const top of kids(ast)) visit(top, null);
  return out;
}
