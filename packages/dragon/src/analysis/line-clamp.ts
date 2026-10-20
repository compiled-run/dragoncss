// TXT2-g (notes/T149-txt2-spec.md R11): Chrome 145's legacy line clamp. display: -webkit-box with -webkit-box-orient: vertical and
// a -webkit-line-clamp other than none computes to flow-root (Blink StyleAdjuster::AdjustStyleForDisplay); its content ends after
// line N, and line N ends in an ellipsis when content follows (packages/layout/src/inline.ts clampsLine, block.ts nestedClamp).
// Any other -webkit-box stays Chrome's legacy flexbox, which Dragon refuses. The engine takes the block's own inline content, or
// block children of inline content one level down, left to right, with overflow: hidden (Tailwind's line-clamp-N); the rest is
// refused here with the reason.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Longhand } from '../css/properties.ts';
import type { CompilerFaults } from '../faults.ts';
import { glyphFill } from '../lower/paint/colors.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

const keywordOf = (v: ResolvedValue | undefined): string => (v !== undefined && v.value.kind === 'keyword' ? v.value.value : '');
const prop = (el: ResolvedElement, p: Longhand): ResolvedValue => el.props.get(p) as ResolvedValue;
const display = (el: ResolvedElement): string => keywordOf(prop(el, 'display'));

/** Whether the element's -webkit-box-orient and -webkit-line-clamp make a -webkit-box clamp lines (ComputedStyle::HasLineClamp). */
const clamps = (props: ReadonlyMap<Longhand, ResolvedValue>): boolean =>
  keywordOf(props.get('-webkit-box-orient')) === 'vertical' && props.get('-webkit-line-clamp')?.value.kind === 'number';

/** Blink StyleAdjuster: the line-clamp pattern's -webkit-box computes to flow-root and -webkit-inline-box to inline-block, in place. */
export function adjustLineClampDisplay(props: Map<Longhand, ResolvedValue>): void {
  const d = props.get('display') as ResolvedValue;
  const k = keywordOf(d);
  if ((k !== '-webkit-box' && k !== '-webkit-inline-box') || !clamps(props)) return;
  props.set('display', { ...d, value: { kind: 'keyword', value: k === '-webkit-box' ? 'flow-root' : 'inline-block' } });
}

/** The specified display keyword: -webkit-box or -webkit-inline-box for the clamp (ComputedStyle::IsSpecifiedDisplayWebkitBox). */
const specifiedDisplay = (el: ResolvedElement): string => {
  const d = prop(el, 'display');
  return d.declared?.kind === 'keyword' ? d.declared.value : '';
};

/**
 * Whether the element is a line-clamp container: a specified display: -webkit-box, or a -webkit-inline-box that is blockified (a
 * flex item, float or absolutely positioned box), that computes to flow-root. A display: flow-root with the companions never
 * clamps in Chrome, since HasLineClamp reads the specified display.
 */
export function isLineClampContainer(el: ResolvedElement): boolean {
  const s = specifiedDisplay(el);
  return keywordOf(prop(el, 'display')) === 'flow-root' && (s === '-webkit-box' || s === '-webkit-inline-box') && clamps(el.props);
}

/** LayoutStyle.lineClamp of the element: N for a line-clamp container, else 0 (lower/ios-layout.ts). */
export function lineClampOf(el: ResolvedElement): number {
  const n = prop(el, '-webkit-line-clamp').value;
  return isLineClampContainer(el) && n.kind === 'number' ? n.value : 0;
}

/**
 * The authored display the web output writes for a line-clamp container: -webkit-box, since a written flow-root drops the clamp in
 * Chrome. Planted compiler fault webkitBoxEmittedAsFlowRoot writes the computed flow-root.
 */
export function webDisplayOf(el: ResolvedElement, faults: Pick<CompilerFaults, 'webkitBoxEmittedAsFlowRoot'>): string | null {
  return isLineClampContainer(el) && !faults.webkitBoxEmittedAsFlowRoot ? specifiedDisplay(el) : null;
}

/** Whether the web output writes the element's line-clamp longhands: only where one differs from its initial value. */
export function writesLineClamp(el: ResolvedElement): boolean {
  return keywordOf(prop(el, '-webkit-box-orient')) !== 'horizontal' || keywordOf(prop(el, '-webkit-line-clamp')) !== 'none';
}

/** Each element whose box is laid out inside el's inline formatting context (inline boxes and <br>s, through inline boxes). */
function inlineDescendants(el: ResolvedElement): ResolvedElement[] {
  const out: ResolvedElement[] = [];
  for (const c of el.children) {
    if (c.kind !== 'element' || display(c) === 'none') continue;
    out.push(c);
    if (display(c) === 'inline') out.push(...inlineDescendants(c));
  }
  return out;
}

/** The style the ellipsis takes from its block and the native text view from its text: colour, visibility and face. */
const paintOf = (e: ResolvedElement): string => JSON.stringify([glyphFill(e), ...(['visibility', 'font-family', 'font-weight', 'font-style'] as const).map((p) => valueToString(prop(e, p).value))]);

/**
 * The refusals of the legacy -webkit-box and of the line-clamp pattern. hidden: the element is in a display: none subtree, where
 * only the -webkit-box refusal applies.
 */
export function checkLineClamp(el: ResolvedElement, hidden: boolean, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const d = prop(el, 'display');
  const origin = d.declaration !== null ? authored(d.declaration.valueSpan) : el.element.node.origin;
  const k = keywordOf(d);
  const declared = d.declared?.kind === 'keyword' ? d.declared.value : '';
  if (k === '-webkit-box' || k === '-webkit-inline-box') {
    const id = `*|webkit-box|${el.element.address}`;
    if (reported.has(id)) return;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      message: `display: ${k} is unsupported: it selects Chrome's legacy -webkit-box layout, which Dragon does not lay out; Dragon takes display: -webkit-box only as the line clamp, with -webkit-box-orient: vertical and a -webkit-line-clamp`,
      manual: k === '-webkit-box' ? 'Use display: flex, with flex-direction and the flex properties.' : 'Use display: inline-flex, with flex-direction and the flex properties.',
    }));
    return;
  }
  if (hidden) return;
  const at = `-webkit-line-clamp on ${el.element.address}`;
  const refuse = (on: readonly string[], what: string, message: string, manual: string): void => {
    for (const t of on) {
      const id = `${t}|line-clamp-${what}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
    }
  };
  if (k === 'inline-block' && declared === '-webkit-inline-box' && clamps(el.props)) {
    refuse(targets, 'inline', `${at}: display: -webkit-inline-box clamps an inline-block, which Dragon does not clamp yet`, `Use display: -webkit-box on ${el.element.address}, inside a block.`);
    return;
  }
  if (!isLineClampContainer(el)) return;
  if (keywordOf(prop(el, 'overflow-x')) !== 'hidden' || keywordOf(prop(el, 'overflow-y')) !== 'hidden') {
    refuse(targets, 'overflow', `${at} needs overflow: hidden, which clips the lines after the clamp as Chrome paints them`, `Add overflow: hidden to ${el.element.address}.`);
  }
  if (keywordOf(prop(el, 'direction')) === 'rtl') refuse(targets, 'rtl', `${at} clamps rtl lines, which Dragon truncates left to right only`, `Remove -webkit-line-clamp from ${el.element.address}, or make it ltr.`);
  // Blink clamps by both lines and height when the block size is definite or bounded (BlockLineClampData kClampByLinesWithBfcOffset).
  if (keywordOf(prop(el, 'height')) !== 'auto' || keywordOf(prop(el, 'max-height')) !== 'none') {
    refuse(targets, 'height', `${at} has a height or max-height, with which Chrome clamps by height as well as by lines`, `Remove height and max-height from ${el.element.address}.`);
  }
  if (keywordOf(prop(el, 'text-overflow')) === 'ellipsis') refuse(targets, 'text-overflow', `${at} also has text-overflow: ellipsis, which Dragon does not combine with the clamp`, `Remove text-overflow from ${el.element.address}.`);
  // The blocks whose lines the clamp counts: el's own inline content, or its block children one level down (block.ts nestedClamp).
  const blocks: ResolvedElement[] = [el];
  for (const c of el.children) {
    if (c.kind !== 'element' || display(c) === 'none' || display(c) === 'inline') continue;
    const plain = display(c) === 'block' && ['overflow-x', 'overflow-y'].every((p) => keywordOf(prop(c, p as Longhand)) === 'visible') && keywordOf(prop(c, 'position')) === 'static' && keywordOf(prop(c, 'float')) === 'none' && keywordOf(prop(c, 'container-type')) === 'normal';
    // The engine truncates left to right only (inline.ts checkClampContext), so a nested rtl block is refused as the container is.
    if (keywordOf(prop(c, 'direction')) === 'rtl') refuse(targets, 'rtl', `${at} holds the rtl block <${c.element.tag}> ${c.element.address}, whose lines Dragon truncates left to right only`, `Make <${c.element.tag}> ${c.element.address} ltr, or remove -webkit-line-clamp from ${el.element.address}.`);
    if (!plain || inlineDescendants(c).some((g) => display(g) !== 'inline')) {
      refuse(targets, 'nested', `${at} holds <${c.element.tag}> ${c.element.address}, which is not a block of inline content in its formatting context; Chrome counts lines through nested blocks, which Dragon does not yet`, `Make <${c.element.tag}> ${c.element.address} a plain block holding only text and inline boxes, or clamp its text on its own.`);
    } else blocks.push(c);
  }
  for (const b of blocks) {
    for (const g of inlineDescendants(b)) {
      // el's own block children are checked above.
      if (b === el && el.children.includes(g) && display(g) !== 'inline') continue;
      if (g.element.tag === 'br') {
        // Chrome's rect of a <br> after which line N ends in the ellipsis spans the ellipsis (measured, line-clamp-lines at DPR 2).
        refuse(targets, 'br', `${at} holds the forced line break <br> ${g.element.address}, beside which Dragon does not place the ellipsis yet`, `Remove <br> ${g.element.address}, or split the text into blocks.`);
      } else if (display(g) !== 'inline') refuse(targets, 'atomic', `${at} holds the inline-level box <${g.element.tag}> ${g.element.address}, which Dragon does not clamp beside`, `Make <${g.element.tag}> ${g.element.address} display: inline, or move it out of ${el.element.address}.`);
      else if (paintOf(g) !== paintOf(b)) {
        refuse(targets.filter((t) => t === 'ios' || t === 'android'), 'paint', `${at}: the inline box <${g.element.tag}> ${g.element.address} has a colour, visibility or font face other than its block's, and the native runtime draws the ellipsis with the text it follows, not in the block's style`, `Give <${g.element.tag}> ${g.element.address} the colour, visibility and font face of its block.`);
      }
    }
  }
  const texts = (e: ResolvedElement): import('./resolve.ts').ResolvedText[] => e.children.flatMap((c) => (c.kind === 'text' ? [c] : display(c) === 'none' ? [] : texts(c)));
  for (const t of texts(el)) {
    if (keywordOf(t.props.get('white-space-collapse')) !== 'collapse') {
      refuse(targets, 'white-space', `${at} holds preserved white space (${t.node.address}), which Dragon does not clamp yet`, `Remove the white-space value from the text of ${el.element.address}.`);
    }
    // TXT2-b with TXT2-g: how Chrome cuts word-spaced text for the ellipsis has no Chrome comparison (truncate.ts refuses it).
    const ws = t.props.get('word-spacing') as ResolvedValue;
    if (keywordOf(ws) !== 'normal' && !(ws.value.kind === 'length' && ws.value.value === 0)) {
      refuse(targets, 'word-spacing', `${at} holds word-spaced text (${t.node.address}), whose ellipsis Dragon does not place yet`, `Remove word-spacing from the text of ${el.element.address}.`);
    }
    if (keywordOf(t.props.get('letter-spacing')) !== 'normal') {
      refuse(targets, 'letter-spacing', `${at} holds letter-spaced text (${t.node.address}), whose ellipsis Dragon does not place yet`, `Remove letter-spacing from the text of ${el.element.address}.`);
    }
  }
}
