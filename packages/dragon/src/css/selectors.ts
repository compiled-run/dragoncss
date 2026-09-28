// Selector parsing: the selector list of a style rule into right-to-left compounds with their specificity. Matching lives in
// analysis/match.ts.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import type { SheetUse } from './stylesheet.ts';

/** [ui-name] (value null) or [ui-name="value"]. */
export type AttributeTest = { readonly name: string; readonly value: string | null };
export type Compound = { readonly tag: string | null; readonly classes: readonly string[]; readonly attributes: readonly AttributeTest[] };
/** Right-to-left: parts[0] is the subject; each later part is joined to the previous by its combinator. */
export type Selector = {
  readonly parts: readonly { readonly compound: Compound; readonly combinator: ' ' | '>' | null }[];
  readonly specificity: readonly [number, number, number];
};

const SELECTOR_FIX = 'Use class compounds, optionally with a tag and [ui-*] or [ui-*="value"], joined by descendant or child combinators.';

// Selectors Level 4 §16 specificity: type, class and attribute compounds joined by descendant or child combinators. In a
// component-scoped sheet every compound needs a class, so it can only match elements carrying the owner's symbols.
export function parseSelectorList(prelude: CssNode, base: Span, use: SheetUse, diagnostics: Diagnostic[]): Selector[] | null {
  const out: Selector[] = [];
  let ok = true;
  const refuse = (node: CssNode, message: string): void => {
    ok = false;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', { origin: authored(spanOf(node, base)), message, manual: SELECTOR_FIX }));
  };
  for (const sel of list(prelude, 'children')) {
    const compounds: { compound: { tag: string | null; classes: string[]; attributes: AttributeTest[] }; combinator: ' ' | '>' | null }[] = [];
    let current = { tag: null as string | null, classes: [] as string[], attributes: [] as AttributeTest[] };
    let pending: ' ' | '>' | null = null;
    let types = 0;
    let classes = 0;
    for (const part of list(sel, 'children')) {
      if (part.type === 'TypeSelector' && part['name'] !== '*') {
        current.tag = String(part['name']).toLowerCase();
        types++;
      } else if (part.type === 'ClassSelector') {
        current.classes.push(String(part['name']));
        classes++;
      } else if (part.type === 'AttributeSelector') {
        const name = String((part['name'] as CssNode)['name']).toLowerCase();
        const matcher = part['matcher'] as string | null;
        const valueNode = part['value'] as CssNode | null;
        if (!/^ui-[a-z0-9-]+$/.test(name) || part['flags'] !== null || (matcher !== null && matcher !== '=')) {
          refuse(part, `attribute selector "${generate(part)}" is not supported: only [ui-*] and [ui-*="value"]`);
          continue;
        }
        const value = valueNode === null ? null : valueNode.type === 'String' ? String(valueNode['value']) : String(valueNode['name']);
        current.attributes.push({ name, value });
        classes++;
      } else if (part.type === 'Combinator' && (part['name'] === ' ' || part['name'] === '>')) {
        compounds.push({ compound: current, combinator: pending });
        pending = part['name'] as ' ' | '>';
        current = { tag: null, classes: [], attributes: [] };
      } else {
        refuse(part, `selector part "${generate(part)}" is not supported in milestone 1`);
      }
    }
    compounds.push({ compound: current, combinator: pending });
    if (use.scope === 'component' && compounds.some((c) => c.compound.classes.length === 0)) {
      refuse(sel, `every compound of "${generate(sel)}" needs a class in a component-scoped sheet, so it can only match the owner's elements`);
    }
    const rightToLeft = compounds.reverse().map((c, i, all) => ({
      compound: c.compound,
      combinator: i === 0 ? null : (all[i - 1] as { combinator: ' ' | '>' | null }).combinator,
    }));
    out.push({ parts: rightToLeft, specificity: [0, classes, types] });
  }
  return ok ? out : null;
}
