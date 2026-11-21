// color-scheme (css-color-adjust-1 §2.1) is accepted where its scheme changes nothing (css/properties/color-scheme.ts). A computed
// value that names dark is refused, once per element, where the element paints with the scheme's system colours (measured against
// Chrome 145): the root (its canvas and text colour), a link (its UA colour), a form control, an element or SVG shape whose colour is
// initial (CanvasText), an auto outline (Chrome's focus ring takes the scheme's colours, even beside an author colour), and on the
// web a scroll container, whose scrollbar Chrome draws dark. The value is checked computed, so one that is
// inherited or arrives through var() is checked too.
// Where the output paints the canvas (hostCanvas), native draws the root's used scheme from its UA dataset (markless-color-scheme.test.ts).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { namesDark, usedColorScheme } from '../css/properties/color-scheme.ts';
import type { Diagnostic } from '../types.ts';
import { isAnyLink } from './text-decoration.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { environmentOf, valueToString } from './resolve.ts';

/** The form controls Chrome 145 colours with system colours (their UA rules name Field, ButtonFace and the like). */
const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(['input', 'button', 'select', 'option', 'optgroup', 'textarea', 'progress', 'meter', 'fieldset', 'dialog']);

/** What a dark scheme recolours on the element, and whether native draws it from the root's scheme's UA dataset; null for nothing. */
function darkPaint(el: ResolvedElement, isRoot: boolean, target: string): { readonly what: string; readonly drawn: boolean } | null {
  const tag = el.element.tag;
  if (isRoot) return { what: 'the root, whose canvas and text colour it darkens', drawn: true };
  if (isAnyLink(el.element) || (tag === 'area' && el.element.attributes.has('href'))) return { what: 'a link, whose UA colour it lightens', drawn: tag === 'a' };
  if (FORM_CONTROL_TAGS.has(tag)) return { what: 'a form control, whose UA colours it darkens', drawn: tag === 'button' && !el.element.attributes.has('disabled') };
  if ((el.props.get('color') as ResolvedValue).origin === 'initial') return { what: 'an element whose color is initial (CanvasText), which it turns white', drawn: true };
  const outline = (el.props.get('outline-style') as ResolvedValue | undefined)?.value;
  if (outline !== undefined && outline.kind === 'keyword' && outline.value === 'auto') return { what: 'an auto outline, whose focus ring colours it changes', drawn: false };
  if (target === 'web') {
    const scrolls = (['overflow-x', 'overflow-y'] as const).some((p) => { const v = (el.props.get(p) as ResolvedValue).value; return v.kind === 'keyword' && (v.value === 'scroll' || v.value === 'auto'); });
    if (scrolls) return { what: 'a scroll container, whose scrollbar Chrome draws dark', drawn: false };
  }
  return null;
}

/** Refuses a color-scheme on an element whose paint its used scheme changes and Dragon does not draw in that scheme. */
export function checkColorScheme(el: ResolvedElement, root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('color-scheme') as ResolvedValue | undefined;
  if (v === undefined) return;
  const env = environmentOf(root);
  // The scheme a native target draws the page in, where the output paints the canvas; null where it draws only light.
  const drawnScheme = env.hostCanvas === true ? env.ua.colorScheme : null;
  const used = usedColorScheme(v.value, env.colorScheme ?? null);
  const dark = namesDark(v.value);
  if (!dark && drawnScheme !== 'dark') return;
  // An inherited value carries the span of the declaration it came from, so the refusal points there.
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : v.span !== null ? authored(v.span) : el.element.node.origin;
  for (const t of targets) {
    const paint = darkPaint(el, el === root, t);
    if (paint === null) continue;
    const native = t === 'ios' || t === 'android';
    if (!native && !dark) continue;
    if (native && drawnScheme !== null && used === drawnScheme && paint.drawn) continue;
    const id = `${t}|color-scheme|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const why = native && drawnScheme !== null
      ? used === null
        ? `its used scheme follows the device's colour-scheme preference, which no @media band of this page fixes`
        : used !== drawnScheme ? `its used scheme (${used}) is not the page's (${drawnScheme}), and Dragon draws one scheme per page` : `its used scheme is ${used}`
      : 'its used scheme can be dark';
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `color-scheme: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: ${why}, and ${el.element.address} is ${paint.what}, which Dragon does not draw ${native && drawnScheme !== null ? 'in that scheme' : 'yet'}; a scheme that names no dark (normal, light, light only) is accepted, and dark is accepted on boxes it does not recolour`,
      manual: `Set color-scheme: light on ${el.element.address}, or give it explicit colours and move color-scheme below it.`,
      basis: 'computed-value',
    }));
  }
}
