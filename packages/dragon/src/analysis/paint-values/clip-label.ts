// The visually-hidden pattern on the native targets (MASK-CLIP): a box whose clip rect() is empty at every size paints nothing, nor
// does any descendant, while Chrome keeps the subtree's text in its accessibility tree: clip is not one of the style facts that hide
// a node there (AXObject::IsHiddenViaStyle reads display, visibility and content-visibility), so screen readers read it. Natively the
// box view then takes the clip label write (lower/paint/clip.ts): it draws nothing and is one accessibility element whose label is
// the subtree's text. That stands for Chrome's tree only when the text is plain: the refusals below name what one label would lose.
import { clipHidesBox } from '../../css/properties/clip-rect.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import type { ResolvedValue } from '../computed.ts';
import { valueToString } from '../computed.ts';
import { GENERATED_TAGS } from '../elements.ts';
import { isFocusable } from '../interaction.ts';
import type { ResolvedElement } from '../resolve.ts';

/** Tags whose Chrome accessibility role screen readers do not announce over the text: their text reads the same as one label. */
const PLAIN_TAGS: ReadonlySet<string> = new Set(['div', 'span', 'p', 'b', 'i', 'em', 'strong', 'small', 'br', ...GENERATED_TAGS]);

/** Attributes that change the node, name or role Chrome exposes, which one label of the text would not carry. */
const A11Y_ATTRIBUTE = /^(aria-.+|role|title|tabindex|lang|contenteditable|alt)$/;

const keywordOf = (el: ResolvedElement, p: 'display' | 'position'): string => {
  const v = el.props.get(p)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

/** A zero width, height, max-width or max-height of the box: a view with no area is not visible to the user on Android, so TalkBack skips it. */
function zeroSize(el: ResolvedElement): string | null {
  for (const p of ['width', 'height', 'max-width', 'max-height'] as const) {
    const v = el.props.get(p)?.value;
    if (v !== undefined && (v.kind === 'length' || v.kind === 'percentage') && v.value === 0) return `${p} ${valueToString(v)}`;
  }
  return null;
}

/**
 * Why the text of a box its clip hides cannot be carried as one accessibility label of the box view, or null when it can: the first
 * such fact in preorder, the box's own first. Text under display: none is in no accessibility tree and is not looked at.
 */
export function clipLabelRefusal(box: ResolvedElement): string | null {
  const zero = zeroSize(box);
  if (zero !== null) return `it has ${zero}, and a view with no area is not visible to the user (View.isVisibleToUser), so TalkBack would skip its label`;
  const visit = (e: ResolvedElement, root: boolean): string | null => {
    if (keywordOf(e, 'display') === 'none') return null;
    const who = root ? 'it' : e.element.address;
    const tag = e.element.tag;
    if (isFocusable(e.element)) return `${who} is focusable, and a label cannot take focus or act as <${tag}> does`;
    if (!PLAIN_TAGS.has(tag)) return `${who} is <${tag}>, whose role or content Chrome exposes beyond its text`;
    const attribute = [...e.element.attributes.keys()].find((a) => A11Y_ATTRIBUTE.test(a));
    if (attribute !== undefined) return `${who} has the ${attribute} attribute, which changes what Chrome exposes beyond its text`;
    if (!root) {
      const visibility = (e.props.get('visibility') as ResolvedValue).value;
      if (!paintsOwn(visibilityOf(visibility))) return `${who} is ${valueToString(visibility)}, which Chrome leaves out of its accessibility tree while its text would stay in the label`;
      if (keywordOf(e, 'position') === 'fixed') return `${who} is fixed, and its view may be hosted outside the box view`;
      if (clipHidesBox(e) === true) return `${who} is hidden by its own clip too, and nested labels are not proven`;
    }
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      const found = visit(c, false);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(box, true);
}
