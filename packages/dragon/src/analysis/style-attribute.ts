// css-style-attr §4: an element's style attribute applies its declarations to that element alone, as author declarations attached
// to it (css-cascade-5 §6.2), which beat every declaration a selector maps at the same importance. The value may follow state, so
// each value is parsed once and the same declarations reach the cascade (resolve.ts) and the support checks (project.ts).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Declaration, Rule } from '../css/stylesheet.ts';
import { parseStyleAttribute } from '../css/stylesheet.ts';
import { isRevertLayer, rollsBack } from './layers.ts';
import type { AttributeBinding, ComponentDefinition, Diagnostic, ElementNode, Span, TreeNode } from '../types.ts';
import type { LinkedElement } from './link.ts';

type Parsed = { readonly declarations: readonly Declaration[]; readonly diagnostics: readonly Diagnostic[] };
const PARSED = new WeakMap<AttributeBinding, Map<string, Parsed>>();

/** Where an attribute's declarations are reported: the attribute's own span, else its element's. */
function spanOf(attribute: AttributeBinding, element: ElementNode): Span {
  if (attribute.origin.kind === 'authored') return attribute.origin.span;
  if (element.origin.kind === 'authored') return element.origin.span;
  throw new Error(`${element.id}: a style attribute with no authored origin, on an element with none`);
}

/**
 * Dragon reads these from the stylesheets' rules (animations.ts, logical.ts elementDirection), not from the cascade's winners, so a
 * style attribute declaring one would be dropped; it is refused instead.
 */
const RULE_READ = new Set(['direction', 'unicode-bidi']);

function parsed(attribute: AttributeBinding, element: ElementNode, text: string): Parsed {
  let byText = PARSED.get(attribute);
  if (byText === undefined) PARSED.set(attribute, (byText = new Map()));
  let p = byText.get(text);
  if (p === undefined) {
    const at = spanOf(attribute, element);
    const diagnostics: Diagnostic[] = [];
    const all = parseStyleAttribute(text, at, diagnostics);
    const declarations: Declaration[] = [];
    for (const d of all) {
      const ruleRead = d.animation !== undefined || d.longhands.some((lh) => RULE_READ.has(lh.property)) || RULE_READ.has(d.property);
      // css-cascade-5 §6.4: a style attribute is a layer above the unlayered rules, so its revert-layer never acts as revert.
      if (!ruleRead && isRevertLayer(d) && !rollsBack(d)) {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ATTRIBUTE', {
          origin: authored(at),
          message: `attribute style on ${element.id} is not supported: its ${d.alias ?? d.property} declaration holds revert-layer, which Dragon rolls back only as a plain value that is not !important, not reached through var(), and not on a custom property`,
          manual: `Move ${d.alias ?? d.property}: ${d.text} into a stylesheet rule that selects ${element.id}.`,
        }));
        continue;
      }
      if (!ruleRead) {
        declarations.push(d);
        continue;
      }
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ATTRIBUTE', {
        origin: authored(at),
        message: `attribute style on ${element.id} is not supported: its ${d.alias ?? d.property} declaration is one Dragon reads from stylesheet rules only (${d.animation !== undefined ? 'transitions and animations' : 'direction and unicode-bidi'})`,
        manual: `Move ${d.alias ?? d.property}: ${d.text} into a stylesheet rule that selects ${element.id}.`,
      }));
    }
    byText.set(text, (p = { declarations, diagnostics }));
  }
  return p;
}

/** The element-attached declarations of an element's style attribute in this case; none without one. */
export function attachedDeclarations(el: LinkedElement): readonly Declaration[] {
  const text = el.attributes.get('style');
  if (text === undefined) return [];
  const attribute = el.node.attributes.find((a) => a.name === 'style');
  if (attribute === undefined) throw new Error(`${el.address}: a style value with no style attribute`);
  return parsed(attribute, el.node, text).declarations;
}

/**
 * Every value of every style attribute in the templates (both arms of a branch, every slot's children), as a rule with no selector
 * for the support checks, which read rules; its parse and refusal diagnostics go to `out`, once per value.
 */
export function styleAttributeRules(components: Iterable<ComponentDefinition>, out: Diagnostic[]): Rule[] {
  const rules: Rule[] = [];
  const walk = (owner: string, nodes: readonly TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'element') {
        for (const a of n.attributes) {
          if (a.name !== 'style') continue;
          for (const text of new Set(a.value.flatMap((c) => (c.value === null ? [] : [c.value])))) {
            const p = parsed(a, n, text);
            out.push(...p.diagnostics);
            rules.push({ sheet: 'style-attribute', owner, selectors: [], declarations: p.declarations });
          }
        }
        walk(owner, n.children);
      } else if (n.kind === 'branch') {
        walk(owner, n.then);
        walk(owner, n.else);
      } else if (n.kind === 'call') {
        for (const s of n.slots) walk(owner, s.children);
      }
    }
  };
  for (const c of components) walk(c.id, c.root);
  return rules;
}
