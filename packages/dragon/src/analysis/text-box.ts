// css-inline-3 §5.1-§5.2 text-box-trim and text-box-edge at build time. The engine trims a block's own inline content
// (packages/layout/src/inline.ts trimLineStart, trimmedLineEnd): the first line's box starts at the strut font's ascent above its
// baseline, and the content ends at the last line's descent below its baseline, or at the baseline for an alphabetic under edge,
// as Blink's ApplyTextBoxTrim does; fixture group text-box proves it against Chrome. Every target refuses the rest at the
// declaration, so the web output never shows a trim the native ones do not: a trim that is not on a plain in-flow block of
// collapsible text and inline boxes in a block outside any flex or grid container (Chrome trims the first and last lines of nested
// blocks too, and a flex or grid item is sized by its trimmed content), and a cap or ex over edge, which Ahem's metrics cannot tell
// from text.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { TextBoxFaults } from '../faults/text-box.ts';
import type { Diagnostic } from '../types.ts';
import { isReplacedTag } from './elements/replaced.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { parentsOf } from './text-shadow-apart.ts';

const keywordOf = (v: ResolvedValue | undefined): string => (v !== undefined && v.value.kind === 'keyword' ? v.value.value : '');
const prop = (el: ResolvedElement, p: Parameters<ResolvedElement['props']['get']>[0]): string => keywordOf(el.props.get(p) as ResolvedValue | undefined);

/** Each tree's parent map, built once for the first trim checked in it. */
const PARENTS = new WeakMap<ResolvedElement, Map<ResolvedElement, ResolvedElement>>();

/** The nearest flex or grid container above el, whose item Chrome sizes by its trimmed content, or null. */
function flexOrGridAncestor(el: ResolvedElement, root: ResolvedElement): ResolvedElement | null {
  let parents = PARENTS.get(root);
  if (parents === undefined) {
    parents = parentsOf(root);
    PARENTS.set(root, parents);
  }
  for (let a = parents.get(el); a !== undefined; a = parents.get(a)) {
    if (['flex', 'grid', 'inline-flex', 'inline-grid'].includes(prop(a, 'display'))) return a;
  }
  return null;
}

/**
 * Why the engine does not trim el's text box, or null where it does. parent: the box el's box sits in, or null for the root; root:
 * the tree's root, whose ancestors of el are checked for a flex or grid container.
 */
function refusal(el: ResolvedElement, parent: ResolvedElement | null, root: ResolvedElement): string | null {
  const display = prop(el, 'display');
  if (display !== 'block') return `its display is ${display}; Dragon trims a block's own lines only`;
  if (parent !== null && prop(parent, 'display') !== 'block') return `it sits in a display: ${prop(parent, 'display')} box; Dragon trims a block in a block only`;
  const container = flexOrGridAncestor(el, root);
  if (container !== null) return `it sits inside the ${prop(container, 'display')} container <${container.element.tag}> ${container.element.address}, whose item Chrome sizes by its trimmed content`;
  const position = prop(el, 'position');
  if (position !== 'static' && position !== 'relative') return `it is position: ${position}`;
  if (prop(el, 'float') !== 'none') return 'it floats';
  if (prop(el, 'overflow-x') !== 'visible' || prop(el, 'overflow-y') !== 'visible') return 'its overflow is not visible';
  if (prop(el, 'white-space-collapse') !== 'collapse') return 'its white space is preserved';
  if (prop(el, 'text-overflow') === 'ellipsis') return 'it has text-overflow: ellipsis';
  if (el.props.get('-webkit-line-clamp')?.value.kind === 'number') return 'it has a -webkit-line-clamp';
  const edge = prop(el, 'text-box-edge');
  if (edge.startsWith('cap') || edge.startsWith('ex')) return `its text-box-edge is ${edge}, whose ${edge.startsWith('cap') ? 'cap height' : 'x-height'} over edge no Ahem fixture can tell from text`;
  const inner = (e: ResolvedElement): string | null => {
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      const d = prop(c, 'display');
      if (d === 'none') continue;
      if (d !== 'inline') return `it holds <${c.element.tag}> ${c.element.address}, which is display: ${d}; Chrome trims the first and last lines of nested blocks, which Dragon does not`;
      if (isReplacedTag(c.element.tag)) return `it holds the replaced element <${c.element.tag}> ${c.element.address}`;
      const p = prop(c, 'position');
      if (p !== 'static' && p !== 'relative') return `it holds <${c.element.tag}> ${c.element.address}, which is position: ${p}`;
      if (prop(c, 'float') !== 'none') return `it holds the float <${c.element.tag}> ${c.element.address}`;
      const deeper = inner(c);
      if (deeper !== null) return deeper;
    }
    return null;
  };
  return inner(el);
}

export function checkTextBox(el: ResolvedElement, parent: ResolvedElement | null, root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: TextBoxFaults): void {
  if (faults.textBoxTrimAccepted) return;
  const v = el.props.get('text-box-trim') as ResolvedValue | undefined;
  const trim = keywordOf(v);
  if (v === undefined || trim === 'none' || trim === '') return;
  const why = refusal(el, parent, root);
  if (why === null) return;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    const id = `${t}|text-box-trim|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `text-box-trim: ${trim} on <${el.element.tag}> ${el.element.address} is not laid out on ${t}: ${why}`,
      manual: `Remove text-box-trim from <${el.element.tag}> ${el.element.address}, or put it on a plain block that holds only text and inline boxes, with text-box-edge auto, text or text alphabetic.`,
      basis: 'computed-value',
    }));
  }
}
