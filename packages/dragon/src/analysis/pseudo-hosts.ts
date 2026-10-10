// GEN-a (notes/T151-gen-spec.md R5): the statically empty pseudo-elements (::backdrop, ::file-selector-button, ::placeholder and
// the input parts) are accepted as rules that match no box only when no element of the compiled tree can host one. This walks
// every template node, both arms of every branch and every slot, and refuses each such selector when a host may exist.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { SelectorPseudoElement } from '../css/selectors.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { AttributeBinding, Diagnostic, TreeNode } from '../types.ts';

/** Input types whose UA shadow tree holds a part a statically empty pseudo-element selects (or a placeholder). */
const HOST_INPUT_TYPES: ReadonlySet<string> = new Set(['file', 'date', 'time', 'datetime-local', 'month', 'week', 'search', 'number']);

/** The values an attribute may take in some reachable state; null: absent in some state. */
const valuesOf = (a: AttributeBinding): readonly (string | null)[] => a.value.map((arm) => arm.value);

/** Why an element may host a statically empty pseudo-element, or null. */
function hostReason(tag: string, attributes: readonly AttributeBinding[]): string | null {
  if (tag === 'dialog') return '<dialog> renders in the top layer with a ::backdrop';
  const attr = (name: string): AttributeBinding | undefined => attributes.find((a) => a.name === name);
  const present = (name: string): boolean => {
    const a = attr(name);
    return a !== undefined && valuesOf(a).some((v) => v !== null);
  };
  if (present('popover')) return 'a [popover] element renders in the top layer with a ::backdrop';
  if ((tag === 'input' || tag === 'textarea') && present('placeholder')) return `<${tag}> with a placeholder attribute has a ::placeholder`;
  if (tag === 'input') {
    const type = attr('type');
    const types = type === undefined ? [] : valuesOf(type).filter((v): v is string => v !== null).map((v) => v.toLowerCase());
    const hit = types.find((t) => HOST_INPUT_TYPES.has(t));
    if (hit !== undefined) return `<input type=${hit}> has UA parts the input pseudo-elements select`;
  }
  return null;
}

/** The first element of the templates that may host a statically empty pseudo-element, with why. */
function firstHost(nodes: readonly TreeNode[]): { readonly id: string; readonly reason: string } | null {
  for (const n of nodes) {
    let found: { id: string; reason: string } | null = null;
    if (n.kind === 'element') {
      const reason = hostReason(n.tag, n.attributes);
      found = reason !== null ? { id: n.id, reason } : firstHost(n.children);
    } else if (n.kind === 'branch') {
      found = firstHost(n.then) ?? firstHost(n.else);
    } else if (n.kind === 'call') {
      for (const s of n.slots) found ??= firstHost(s.children);
    }
    if (found !== null) return found;
  }
  return null;
}

/** The package that owns a statically empty pseudo-element once a host exists. */
const ownerOf = (name: string): string => (name === 'backdrop' ? 'the top-layer package for dialog and popover' : 'the form-control package FORM');

/**
 * R5: refuses every statically empty pseudo-element selector when some template element may host it (the planted fault
 * staticEmptyIgnoresHost skips the check). templates: the root nodes of every component.
 */
export function checkStaticEmptyHosts(rules: readonly Rule[], templates: readonly (readonly TreeNode[])[], faults: CompilerFaults, diagnostics: Diagnostic[]): void {
  if (faults.staticEmptyIgnoresHost) return;
  const selectors = rules.flatMap((r) => r.selectors).filter((s) => s.pseudoElement !== null && s.pseudoElement.kind === 'static-empty');
  if (selectors.length === 0) return;
  let host: { readonly id: string; readonly reason: string } | null = null;
  for (const t of templates) host ??= firstHost(t);
  if (host === null) return;
  for (const s of selectors) {
    const p = s.pseudoElement as SelectorPseudoElement;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
      origin: authored(p.span),
      message: `::${p.name} is accepted only when no element can host it, but ${host.id} may: ${host.reason} (${ownerOf(p.name)})`,
      manual: `Remove the ::${p.name} rule, or the element that hosts it.`,
    }));
  }
}
