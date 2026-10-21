// The texts of a box's subtree that Chrome leaves out of its accessibility tree for visibility (MASK-CLIP clip label): imported by the
// analysis and by the lowering alike, so it imports nothing beyond the visibility longhand.
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';

const displayNone = (el: ResolvedElement): boolean => {
  const v = el.props.get('display')?.value;
  return v !== undefined && v.kind === 'keyword' && v.value === 'none';
};

/**
 * The addresses of the texts in a box's subtree whose element is not visible (visibility inherits, so the owner's computed value is
 * the text's), outside display: none: Chrome leaves them out of its accessibility tree, so they are no part of the label.
 */
export function hiddenTexts(box: ResolvedElement): ReadonlySet<string> {
  const out = new Set<string>();
  const visit = (e: ResolvedElement): void => {
    if (displayNone(e)) return;
    const visible = paintsOwn(visibilityOf((e.props.get('visibility') as ResolvedValue).value));
    for (const c of e.children) {
      if (c.kind === 'element') visit(c);
      else if (!visible) out.add(c.node.address);
    }
  };
  visit(box);
  return out;
}

/** The first text in preorder in a box's subtree that Chrome exposes (outside display: none, on a visible element), or null. */
export function exposedTextInside(box: ResolvedElement): string | null {
  const hidden = hiddenTexts(box);
  const visit = (e: ResolvedElement): string | null => {
    if (displayNone(e)) return null;
    for (const c of e.children) {
      const found = c.kind === 'text' ? (hidden.has(c.node.address) ? null : c.node.address) : visit(c);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(box);
}
