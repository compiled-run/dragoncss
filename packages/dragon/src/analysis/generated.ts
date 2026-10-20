// GEN-a (notes/T151-gen-spec.md R2-R4, R8, R12): ::before and ::after boxes with string content. resolve.ts builds each as an
// element of the resolved tree; this file decides when a box is generated and what text it holds (R3), which hosts may generate
// one (R4), the rule-level refusals of generated boxes, and that a box and its text are the same in every state and band (R12).
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { list } from '../css/ast.ts';
import { parseSerializedString } from '../css/escapes.ts';
import { STRING_VALUE_TYPE } from '../css/properties/lists.ts';
import type { GeneratedPseudo } from '../css/selectors.ts';
import { GENERATED_PSEUDOS } from '../css/selectors.ts';
import type { CssValue, Declaration, Rule } from '../css/stylesheet.ts';
import type { GenAFaults } from '../faults/gen-a.ts';
import type { Diagnostic, Origin } from '../types.ts';
import { GENERATED_TAGS } from './elements.ts';
import { isReplacedTag } from './elements/replaced.ts';
import type { LinkedElement, LinkedText } from './link.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/** The form controls whose ::before and ::after Chrome generates only for some types (GEN-P family2 before-on-void). */
const CONTROL_TAGS: ReadonlySet<string> = new Set(['input', 'button', 'select', 'textarea']);

/** The package that owns state- and band-dependent generated content (R12, R15). */
export const STATE_CONTENT_OWNER = 'state-dependent generated content (GEN-d8)';

/**
 * R4: why a host may not generate a ::before or ::after box, naming the owner and the probe evidence, or null for a supported
 * non-replaced, non-control tag other than the root. root: the host is the root element.
 */
export function hostRefusal(tag: string, root: boolean): string | null {
  if (isReplacedTag(tag)) return `<${tag}> is a replaced element: Chrome 145 generates no ::before or ::after box on img or iframe (GEN-P family2 before-on-void), and css-content-3 leaves generated content inside a replaced box undefined (the replaced-element package REPL)`;
  if (CONTROL_TAGS.has(tag)) return `<${tag}> is a form control: Chrome 145 generates the box on range, checkbox and button inputs but not on text inputs, select or textarea (GEN-P family2 before-on-void), which needs its own proof (the form-control package FORM)`;
  if (root) return `the root element's ::before and ::after boxes are siblings of body (GEN-P family2 before-on-void), which Dragon does not model (the generated-content package GEN-d)`;
  return null;
}

/** css-content-3 §2: the first <string> of a content declaration's text (the planted fault contentFirstStringOnly), or null. */
function firstString(text: string): string | null {
  const node = parse(text, { context: 'value' }) as CssNode;
  const s = list(node, 'children').find((c) => c.type === 'String');
  return s === undefined ? null : String(s['value']);
}

/**
 * R3: the text of the box a ::before or ::after generates, or null when it generates none. content computes to none from normal
 * on these pseudo-elements, and a list of strings is one string (css/properties/lists.ts joined it); every other content value
 * was refused at its declaration. display: none generates no box.
 */
export function generatedText(content: ResolvedValue, display: CssValue, faults: GenAFaults): string | null {
  if (display.kind === 'keyword' && display.value === 'none') return null;
  const v = content.value;
  if (v.kind !== 'other' || v.type !== STRING_VALUE_TYPE) return null;
  const joined = parseSerializedString(v.text);
  if (faults.contentFirstStringOnly && content.declaration !== null && content.substitution === undefined) return firstString(content.declaration.text) ?? joined;
  return joined;
}

/** The address and template node id of a generated box: "<host>::before" (R2). */
export const generatedAddress = (host: string, pseudo: GeneratedPseudo): string => `${host}::${pseudo}`;

/** The element resolve.ts builds for a host's ::before or ::after box: located at the host, with no class or attribute (R2). */
export function generatedElement(host: LinkedElement, pseudo: GeneratedPseudo, children: readonly LinkedText[]): LinkedElement {
  return { kind: 'element', address: generatedAddress(host.address, pseudo), node: host.node, instance: host.instance, owner: host.owner, tag: `::${pseudo}`, classes: [], attributes: new Map(), children };
}

/** The one text child of a generated box: "<host>::before:text0", authored at its content declaration (R2). */
export function generatedTextNode(host: LinkedElement, pseudo: GeneratedPseudo, text: string, content: ResolvedValue): LinkedText {
  const origin: Origin = content.declaration === null ? host.node.origin : authored(content.declaration.valueSpan);
  const address = `${generatedAddress(host.address, pseudo)}:text0`;
  return { kind: 'text', address, node: { kind: 'text', id: `${host.node.id}::${pseudo}:text0`, text, origin }, instance: host.instance, owner: host.owner, text };
}

/** Whether a resolved element is a ::before or ::after box resolve.ts built. */
export const isGeneratedElement = (el: ResolvedElement): boolean => GENERATED_TAGS.has(el.element.tag);

/**
 * Rule-level refusals of generated boxes: a transition or animation in a rule that styles ::before or ::after has no frame fixture,
 * so it is refused on every target rather than dropped (the animation analysis cascades elements only).
 */
export function generatedRuleRefusals(rules: readonly Rule[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const rule of rules) {
    const pseudo = rule.selectors.find((s) => s.pseudoElement !== null && s.pseudoElement.kind === 'generated')?.pseudoElement;
    if (pseudo === undefined || pseudo === null) continue;
    for (const d of rule.declarations) {
      if (d.animation === undefined) continue;
      out.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: authored(d.span),
        message: `${d.alias ?? d.property} in a rule that styles ::${pseudo.name} is not supported yet: no frame fixture proves a transition or animation of a generated box (${STATE_CONTENT_OWNER})`,
        manual: `Animate a real element, or remove ${d.alias ?? d.property} from the ::${pseudo.name} rule.`,
      }));
    }
  }
  return out;
}

type Generated = { readonly text: string | null; readonly declaration: Declaration | null; readonly host: Origin };

/** Per host address, the content of each generated box of one resolution (text null: no box). */
function generatedBoxes(root: ResolvedElement): Map<string, Map<GeneratedPseudo, Generated>> {
  const out = new Map<string, Map<GeneratedPseudo, Generated>>();
  const walk = (el: ResolvedElement): void => {
    if (isGeneratedElement(el)) return;
    const host = el.element.node.origin;
    const own = new Map<GeneratedPseudo, Generated>(GENERATED_PSEUDOS.map((p) => [p, { text: null, declaration: null, host }]));
    for (const c of el.children) {
      if (c.kind !== 'element') continue;
      if (!isGeneratedElement(c)) {
        walk(c);
        continue;
      }
      const content = c.props.get('content') as ResolvedValue;
      const text = content.value.kind === 'other' ? content.value.text : '';
      own.set(c.element.tag.slice(2) as GeneratedPseudo, { text, declaration: content.declaration, host });
    }
    out.set(el.element.address, own);
  };
  walk(root);
  return out;
}

/**
 * R12: a generated box's existence and its text must be the same in every reachable state, interaction state and media band in
 * which its host exists; anything else is state-dependent content, refused naming GEN-d8. Styles of a box that exists in every
 * resolution follow the state programs as an element's do.
 */
export function checkGeneratedIdentity(resolutions: readonly ResolvedElement[], diagnostics: Diagnostic[]): void {
  const seen = new Map<string, Map<GeneratedPseudo, Generated>>();
  const reported = new Set<string>();
  for (const r of resolutions) {
    for (const [host, boxes] of generatedBoxes(r)) {
      const first = seen.get(host);
      if (first === undefined) {
        seen.set(host, boxes);
        continue;
      }
      for (const pseudo of GENERATED_PSEUDOS) {
        const a = first.get(pseudo) as Generated;
        const b = boxes.get(pseudo) as Generated;
        if (a.text === b.text) continue;
        const id = `${host}::${pseudo}`;
        if (reported.has(id)) continue;
        reported.add(id);
        const declaration = a.declaration ?? b.declaration;
        const shown = (g: Generated): string => (g.text === null ? 'no box' : `content ${g.text}`);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: declaration === null ? a.host : authored(declaration.valueSpan),
          message: `the ::${pseudo} box of ${host} differs between reachable states or media bands (${shown(a)} in one, ${shown(b)} in another): ${STATE_CONTENT_OWNER} is not supported yet`,
          manual: `Give ${host}::${pseudo} the same content in every state, and change only its styles, or use a real element whose text the state sets.`,
          basis: 'computed-value',
        }));
      }
    }
  }
}
