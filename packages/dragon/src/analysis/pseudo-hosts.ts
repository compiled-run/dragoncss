// GEN-a (notes/T151-gen-spec.md R5): the statically empty pseudo-elements (::backdrop, ::file-selector-button and the input
// parts; ::placeholder styles a text field's placeholder part since FORM-c) are accepted as rules that match no box only when no element of the compiled tree can host one. This walks
// every template node, both arms of every branch and every slot, and refuses each such selector when a host may exist.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { SelectorPseudoElement } from '../css/selectors.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { AttributeBinding, Diagnostic, TreeNode } from '../types.ts';

const DATE_TYPES: readonly string[] = ['date', 'time', 'datetime-local', 'month', 'week'];

/** The input types whose UA shadow tree holds the part a statically empty pseudo-element selects; none for ::backdrop. */
function hostInputTypes(pseudo: string): readonly string[] {
  if (pseudo === 'backdrop') return [];
  if (pseudo === 'file-selector-button') return ['file'];
  if (pseudo === '-webkit-search-decoration') return ['search'];
  if (pseudo === '-webkit-inner-spin-button' || pseudo === '-webkit-outer-spin-button') return ['number', ...DATE_TYPES];
  return DATE_TYPES;
}

/** The values an attribute may take in some reachable state; null: absent in some state. */
const valuesOf = (a: AttributeBinding): readonly (string | null)[] => a.value.map((arm) => arm.value);

/** Why an element may host the statically empty pseudo-element pseudo, or null. */
function hostReason(tag: string, attributes: readonly AttributeBinding[], hostTopLayer: boolean, pseudo: string): string | null {
  if (pseudo === 'backdrop' && tag === 'dialog' && !hostTopLayer) return '<dialog> renders in the top layer with a ::backdrop';
  const attr = (name: string): AttributeBinding | undefined => attributes.find((a) => a.name === name);
  const present = (name: string): boolean => {
    const a = attr(name);
    return a !== undefined && valuesOf(a).some((v) => v !== null);
  };
  if (pseudo === 'backdrop' && present('popover')) return 'a [popover] element renders in the top layer with a ::backdrop';
  if (tag === 'input') {
    const type = attr('type');
    const types = type === undefined ? [] : valuesOf(type).filter((v): v is string => v !== null).map((v) => v.toLowerCase());
    const hosts = hostInputTypes(pseudo);
    const hit = types.find((t) => hosts.includes(t));
    if (hit !== undefined) return `<input type=${hit}> has the UA part ::${pseudo} selects`;
  }
  return null;
}

/** The first element of the templates that may host the statically empty pseudo-element pseudo, with why. */
function firstHost(nodes: readonly TreeNode[], hostTopLayer: boolean, pseudo: string): { readonly id: string; readonly reason: string } | null {
  for (const n of nodes) {
    let found: { id: string; reason: string } | null = null;
    if (n.kind === 'element') {
      const reason = hostReason(n.tag, n.attributes, hostTopLayer, pseudo);
      found = reason !== null ? { id: n.id, reason } : firstHost(n.children, hostTopLayer, pseudo);
    } else if (n.kind === 'branch') {
      found = firstHost(n.then, hostTopLayer, pseudo) ?? firstHost(n.else, hostTopLayer, pseudo);
    } else if (n.kind === 'call') {
      for (const s of n.slots) found ??= firstHost(s.children, hostTopLayer, pseudo);
    }
    if (found !== null) return found;
  }
  return null;
}

/** The package that owns a statically empty pseudo-element once a host exists. */
const ownerOf = (name: string): string => (name === 'backdrop' ? 'the top-layer package for dialog and popover' : 'the form-control package FORM');

/**
 * R5: refuses a statically empty pseudo-element selector when some template element may host that pseudo-element (the planted fault
 * staticEmptyIgnoresHost skips the check). templates: the root nodes of every component. hostTopLayer: the host presents the top
 * layer, so a <dialog> is shown modal and its ::backdrop is a box resolve.ts builds; the backdrop rules style it.
 */
export function checkStaticEmptyHosts(rules: readonly Rule[], templates: readonly (readonly TreeNode[])[], faults: CompilerFaults, diagnostics: Diagnostic[], hostTopLayer = false): void {
  if (faults.staticEmptyIgnoresHost) return;
  const selectors = rules.flatMap((r) => r.selectors).filter((s) => s.pseudoElement !== null && s.pseudoElement.kind === 'static-empty');
  if (selectors.length === 0) return;
  for (const s of selectors) {
    const p = s.pseudoElement as SelectorPseudoElement;
    let host: { readonly id: string; readonly reason: string } | null = null;
    for (const t of templates) host ??= firstHost(t, hostTopLayer, p.name);
    if (host === null) continue;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
      origin: authored(p.span),
      message: `::${p.name} is accepted only when no element can host it, but ${host.id} may: ${host.reason} (${ownerOf(p.name)})`,
      manual: `Remove the ::${p.name} rule, or the element that hosts it.`,
    }));
  }
}
