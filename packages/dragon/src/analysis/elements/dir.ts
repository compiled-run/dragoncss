// SEL-dir: the dir attribute (HTML §3.2.6.4) and the directionality :dir() matches (Selectors-4 §9.1). Chrome 145's behaviour is
// captured in css/selector-validity.generated.ts (DIR_ATTRIBUTE_DIRECTIONALITY, DIR_ATTRIBUTE_UNICODE_BIDI).
import type { Longhand } from '../../css/properties.ts';
import { DIR_ATTRIBUTE_UNICODE_BIDI } from '../../css/selector-validity.generated.ts';
import type { Directionality } from '../../css/selector-validity.generated.ts';
import type { Declaration } from '../../css/stylesheet.ts';
import type { CssValue } from '../../css/values.ts';
import type { LinkedElement } from '../link.ts';
import { CONTROL_TAGS } from './controls.ts';
import { isReplacedTag, SVG_SHAPE_TAGS } from './replaced.ts';

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The directionality a dir value sets, or null when it sets none: ltr and rtl compare ASCII case-insensitively and are not
 * trimmed, as an enumerated attribute's keywords (HTML §2.3.3). caseSensitive is the planted fault dirCaseSensitive.
 */
export function dirKeyword(value: string, caseSensitive = false): Directionality | null {
  const v = caseSensitive ? value : asciiLower(value);
  return v === 'ltr' || v === 'rtl' ? v : null;
}

/** The directionality of path's last element: that of its nearest ancestor-or-self with a dir of ltr or rtl, else ltr. */
export function directionality(path: readonly { readonly attributes: ReadonlyMap<string, string> }[], faults: { readonly dirNotInherited: boolean; readonly dirCaseSensitive: boolean }): Directionality {
  const from = faults.dirNotInherited ? path.length - 1 : 0;
  for (let i = path.length - 1; i >= from; i--) {
    const value = path[i]?.attributes.get('dir');
    const d = value === undefined ? null : dirKeyword(value, faults.dirCaseSensitive);
    if (d !== null) return d;
  }
  return 'ltr';
}

/**
 * Why dir on this tag cannot compile, or null. On html Chrome's environment rule (:where(html) { direction }, docs/api.md §7)
 * is an author rule that beats the hint; an SVG element gets neither hint nor isolate (DIR_ATTRIBUTE_UNICODE_BIDI); body,
 * controls, fieldsets and replaced elements have no fixture that proves them.
 */
export function dirTagRefusal(tag: string): string | null {
  if (tag === 'html') return 'on the root, the environment direction is an author rule that beats the dir hint in Chrome; put dir on an element inside body';
  if (tag === 'svg' || SVG_SHAPE_TAGS.includes(tag)) return 'Chrome gives dir on an SVG element no direction and no unicode-bidi, which Dragon does not model';
  if (tag === 'body' || isReplacedTag(tag) || CONTROL_TAGS.includes(tag) || tag === 'fieldset' || tag === 'legend' || tag === 'dialog') return `no Chrome comparison proves dir on <${tag}> yet; put dir on a block or inline element that holds it`;
  return null;
}

/** Why a dir value cannot compile, or null: auto reads the text's first strong character, and any other value Chrome ignores. */
export function dirValueRefusal(value: string): string | null {
  if (dirKeyword(value) !== null) return null;
  if (asciiLower(value) === 'auto') return 'auto takes its direction from the first strong character of the text (HTML §3.2.6.4), which Dragon does not read yet';
  return 'the value is not ltr, rtl or auto (an enumerated value is not trimmed), so Chrome ignores it, and Dragon does not model an ignored dir';
}

/** HTML §15.3.6: the direction hint of an element's dir, on the tags dirTagRefusal accepts. */
export function dirHint(tag: string, attributes: ReadonlyMap<string, string>): Directionality | null {
  const value = attributes.get('dir');
  return value === undefined || dirTagRefusal(tag) !== null ? null : dirKeyword(value);
}

/**
 * The stand-in declaration of the direction hint, located at the dir attribute, so the profile check reads it as it reads the
 * same direction written in CSS (as elements/svg.ts svgHintDeclaration does for SVG paint attributes); null for any other hint.
 */
export function dirHintDeclaration(el: LinkedElement, property: Longhand, value: CssValue): Declaration | null {
  if (property !== 'direction' || dirHint(el.tag, el.attributes) === null) return null;
  const attr = el.node.attributes.find((a) => a.name === 'dir');
  const text = el.attributes.get('dir');
  if (attr === undefined || text === undefined || attr.origin.kind !== 'authored') return null;
  const span = attr.origin.span;
  return { property, text, span, valueSpan: span, longhands: [{ property, value, explicit: true }], order: -1, presentationHint: true };
}

/** html.css's [dir] rule as Chrome 145 computes it (DIR_ATTRIBUTE_UNICODE_BIDI): the UA unicode-bidi of an element with a dir hint. */
export function dirUnicodeBidi(tag: string, direction: Directionality): string {
  const row = DIR_ATTRIBUTE_UNICODE_BIDI[tag];
  if (row === undefined) throw new Error(`the dir capture has no unicode-bidi row for <${tag}>`);
  return row[direction];
}
