// color-scheme (css-color-adjust-1 §2.1) is accepted where its scheme changes nothing (css/properties/color-scheme.ts). A computed
// value that names dark is refused, once per element, where the element paints with the scheme's system colours (measured against
// Chrome 145): the root (its canvas and text colour), a link (its UA colour), a form control, an element or SVG shape whose colour is
// initial (CanvasText), an auto outline (Chrome's focus ring takes the scheme's colours, even beside an author colour), and on the
// web a scroll container, whose scrollbar Chrome draws dark. The value is checked computed, so one that is
// inherited or arrives through var() is checked too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { namesDark } from '../css/properties/color-scheme.ts';
import type { Diagnostic } from '../types.ts';
import { isAnyLink } from './text-decoration.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** The form controls Chrome 145 colours with system colours (their UA rules name Field, ButtonFace and the like). */
const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(['input', 'button', 'select', 'option', 'optgroup', 'textarea', 'progress', 'meter', 'fieldset', 'dialog']);

/** What a dark scheme recolours on the element, for each target; null where it recolours nothing. */
function darkPaint(el: ResolvedElement, isRoot: boolean, target: string): string | null {
  const tag = el.element.tag;
  if (isRoot) return 'the root, whose canvas and text colour it darkens';
  if (isAnyLink(el.element) || (tag === 'area' && el.element.attributes.has('href'))) return 'a link, whose UA colour it lightens';
  if (FORM_CONTROL_TAGS.has(tag)) return 'a form control, whose UA colours it darkens';
  if ((el.props.get('color') as ResolvedValue).origin === 'initial') return 'an element whose color is initial (CanvasText), which it turns white';
  const outline = (el.props.get('outline-style') as ResolvedValue | undefined)?.value;
  if (outline !== undefined && outline.kind === 'keyword' && outline.value === 'auto') return 'an auto outline, whose focus ring colours it changes';
  if (target === 'web') {
    const scrolls = (['overflow-x', 'overflow-y'] as const).some((p) => { const v = (el.props.get(p) as ResolvedValue).value; return v.kind === 'keyword' && (v.value === 'scroll' || v.value === 'auto'); });
    if (scrolls) return 'a scroll container, whose scrollbar Chrome draws dark';
  }
  return null;
}

/** Refuses a color-scheme that names dark on an element whose paint the dark scheme changes. */
export function checkColorScheme(el: ResolvedElement, isRoot: boolean, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('color-scheme') as ResolvedValue | undefined;
  if (v === undefined || !namesDark(v.value)) return;
  // An inherited value carries the span of the declaration it came from, so the refusal points there.
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : v.span !== null ? authored(v.span) : el.element.node.origin;
  for (const t of targets) {
    const what = darkPaint(el, isRoot, t);
    if (what === null) continue;
    const id = `${t}|color-scheme|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `color-scheme: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: its used scheme can be dark, and ${el.element.address} is ${what}, which Dragon does not draw yet; a scheme that names no dark (normal, light, light only) is accepted, and dark is accepted on boxes it does not recolour`,
      manual: `Set color-scheme: light on ${el.element.address}, or give it explicit colours and move color-scheme below it.`,
      basis: 'computed-value',
    }));
  }
}
