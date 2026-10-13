// Element attributes: every attribute is element data for selector matching (analysis/link.ts, analysis/match.ts), but only a
// rendering-neutral attribute compiles without a diagnostic. An attribute is neutral when HTML §15 (Rendering) gives it no
// presentational hint and no UA style rule on the supported tags, and a parity fixture pair proves it: the same tree with and
// without the attribute gives identical Chrome captures in both directions (packages/parity/src/fixture-groups/attributes.ts).
import { svgAttributeHandled, svgAttributeOwner } from './analysis/elements/svg.ts';

export type NeutralAttribute = {
  /** An exact name, or a prefix ending in "-" for a family (data-*, aria-*, ui-*). */
  readonly name: string;
  /** Tags on which the attribute is not neutral, and so stays refused. */
  readonly exceptOn: readonly string[];
  /** Why HTML §15 gives it no rendering on the supported tags. */
  readonly html: string;
  /** The parity fixture that carries it; its pair without the attribute is attr-neutral-none. */
  readonly proof: string;
};

export const NEUTRAL_ATTRIBUTES: readonly NeutralAttribute[] = [
  { name: 'id', exceptOn: [], html: 'HTML §15 has no rule or presentational hint keyed on id; it only names the element (HTML §3.2.6).', proof: 'attr-neutral-id' },
  { name: 'data-', exceptOn: [], html: 'HTML §3.2.6.6: custom data attributes are for the page\'s scripts and styles; HTML §15 has no rule keyed on them.', proof: 'attr-neutral-data' },
  { name: 'aria-', exceptOn: [], html: 'ARIA attributes (HTML §3.2.8) expose accessibility semantics; HTML §15 has no rule keyed on them.', proof: 'attr-neutral-aria' },
  { name: 'role', exceptOn: [], html: 'role (HTML §3.2.8) is accessibility semantics; HTML §15 has no rule keyed on it.', proof: 'attr-neutral-role' },
  { name: 'title', exceptOn: [], html: 'title (HTML §3.2.6.1) is advisory information shown as a tooltip; HTML §15 has no rule keyed on it.', proof: 'attr-neutral-title' },
  { name: 'ui-', exceptOn: [], html: 'ui-* is Dragon\'s state-attribute convention; HTML defines no such attribute, so HTML §15 has no rule keyed on it.', proof: 'attr-neutral-ui' },
  { name: 'rel', exceptOn: ['a', 'area', 'link'], html: 'rel is defined only on a, area, link and form (HTML §4.6.6); HTML §15 styles only hyperlinks, so elsewhere it has no rendering.', proof: 'attr-neutral-rel' },
  { name: 'target', exceptOn: ['a', 'area', 'link'], html: 'target is defined only on a, area and form (HTML §4.6.5); HTML §15 styles only hyperlinks, so elsewhere it has no rendering.', proof: 'attr-neutral-target' },
];

/**
 * Attributes a replaced element renders, which REPL-a handles (HTML §4.8.3, §4.8.5, §15.4.5): src gives the image bytes or the
 * document the iframe's web view loads (an absolute https URL, analysis/elements/replaced.ts iframeSrcRefusal), width and
 * height are presentational hints, and alt renders nothing for an image that decodes, which every accepted image does.
 * The list ordinal attributes, which GEN-c handles.
 */
export const HANDLED_ATTRIBUTES: { readonly [tag: string]: readonly string[] } = {
  img: ['src', 'alt', 'width', 'height'],
  iframe: ['src', 'width', 'height'],
  // GEN-c (notes/T151-gen-spec.md R14): ol start and reversed and li value set list item ordinals (HTML §4.4.5, §4.4.8), which
  // analysis/ordinals.ts computes; HTML §15 gives them no presentational hint, so their only rendering is the marker text.
  ol: ['start', 'reversed'],
  li: ['value'],
};

/** The package that owns the rendering effect of a refused attribute. */
const OWNERS: Readonly<Record<string, string>> = {
  type: 'the form-control package FORM-a',
  min: 'the form-control package FORM-a',
  max: 'the form-control package FORM-a',
  value: 'the form-control package FORM-a',
  src: 'the replaced-element package REPL',
  alt: 'the replaced-element package REPL',
  width: 'the replaced-element package REPL',
  height: 'the replaced-element package REPL',
  href: 'the inline and link package INL1 (an href makes the :link UA rules apply)',
  lang: 'the text package TXT1-C (lang feeds locale font fallback)',
  dir: 'the bidi package (dir sets direction and unicode-bidi)',
  hidden: 'the display package (hidden applies display: none)',
  style: 'the style-attribute package SOV',
};

// HTML lowercases attribute names, so a name with ASCII uppercase would not match its lowercased selector as it does in Chrome.
const matchesName = (entry: NeutralAttribute, name: string): boolean =>
  !/[A-Z]/.test(name) && (entry.name.endsWith('-') ? name.startsWith(entry.name) && name.length > entry.name.length : name === entry.name);

/** The neutral-table entry that admits this attribute on this tag, or undefined. */
export function neutralAttribute(tag: string, name: string): NeutralAttribute | undefined {
  return NEUTRAL_ATTRIBUTES.find((e) => matchesName(e, name) && !e.exceptOn.includes(tag));
}

/** null when the attribute is rendering-neutral on the tag; otherwise why it is refused, naming the package that owns its effect. */
export function attributeRefusal(tag: string, name: string): string | null {
  if (neutralAttribute(tag, name) !== undefined) return null;
  if (Object.hasOwn(HANDLED_ATTRIBUTES, tag) && (HANDLED_ATTRIBUTES[tag] as readonly string[]).includes(name)) return null;
  // SVG-a1: the SVG tags' geometry and presentation attributes (analysis/elements/svg.ts), and the packages of the others.
  if (svgAttributeHandled(tag, name)) return null;
  const svgOwner = svgAttributeOwner(tag, name);
  if (svgOwner !== null) return `its rendering effect belongs to ${svgOwner}`;
  const owner = (Object.hasOwn(OWNERS, name) ? OWNERS[name] : undefined) ?? ((name === 'rel' || name === 'target') ? 'the inline and link package INL1 (on a hyperlink it changes link behaviour)' : null);
  return owner === null
    ? 'its rendering effect is not proven neutral (it is not in the rendering-neutral table, packages/dragon/src/attributes.ts)'
    : `its rendering effect belongs to ${owner}`;
}
