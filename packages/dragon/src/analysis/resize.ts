// The resize refusal: css-ui-4 §5.1 applies resize to a box whose overflow is not visible, and Chrome 145 also to an iframe; there
// it draws a resizer in the corner and lets the user drag the box's size. Native draws no resizer and resizes nothing, so on iOS and
// Android a computed resize other than none is refused on a scroll container or an iframe. On any other box Chrome ignores it,
// as native does, so it compiles.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import type { ResolvedElement } from './resolve.ts';

const isScrollKeyword = (v: ResolvedValue): boolean => v.value.kind === 'keyword' && (v.value.value === 'hidden' || v.value.value === 'auto' || v.value.value === 'scroll');

/**
 * Refuses, per native target, a resize other than none on el when el is an iframe or a scroll container. propagated is the element
 * whose overflow went to the viewport (css-overflow-3 §3.3), which is then no scroll container itself.
 */
export function checkResize(el: ResolvedElement, propagated: ResolvedElement | null, nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('resize') as ResolvedValue | undefined;
  if (v === undefined) throw new Error(`${el.element.address}: resize did not resolve`);
  if (v.value.kind !== 'keyword') throw new Error(`${el.element.address}: resize did not compute to a keyword`);
  const k = v.value.value;
  if (k === 'none') return;
  const iframe = el.element.tag === 'iframe';
  // Overflow makes only a block, flex or grid container a scroll container (css-overflow-3 §3); an inline box with overflow hidden
  // scrolls nothing, so Chrome draws no resizer on it.
  const display = el.props.get('display') as ResolvedValue | undefined;
  const inline = display?.value.kind === 'keyword' && (display.value.value === 'inline' || display.value.value === 'contents');
  const scroller = el !== propagated && !inline && (isScrollKeyword(el.props.get('overflow-x') as ResolvedValue) || isScrollKeyword(el.props.get('overflow-y') as ResolvedValue));
  if (!iframe && !scroller) return;
  const where = iframe ? `the iframe ${el.element.address}` : `the scroll container ${el.element.address}`;
  for (const t of nativeTargets) {
    const id = `${t}|resize|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan),
      target: t,
      message: `${where} has resize ${k}, so Chrome draws a resizer on it that the user can drag; ${t} draws no resizer, so Dragon compiles resize on a scroll container or an iframe at none only`,
      manual: `Remove resize from ${el.element.address}, set it to none, or leave its overflow visible.`,
      basis: 'computed-value',
    }));
  }
}
