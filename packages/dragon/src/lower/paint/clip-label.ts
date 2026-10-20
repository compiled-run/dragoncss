// The accessibility label of a box its empty clip rect hides (MASK-CLIP, the visually-hidden pattern): the text of its subtree's text
// leaves, the same strings the native text views label themselves with (DragonTextView.dragonSetText), in tree order. Leaves of
// one inline formatting context run together, so "Hello <b>world</b>" reads as written; each block's text is one phrase and phrases
// are joined by a space, as a screen reader reads the lines of Chrome's tree one after another. Runs of ASCII white space collapse to
// one space, trimmed at each phrase's ends; a <br> is a space.
import type { InlineChild, LayoutNode } from '@dragon/layout';

const SPACES = /[ \t\n\r\f]+/g;

/** The label of a box's subtree text, or null when no phrase has text in it. */
export function clipLabelOf(box: LayoutNode): string | null {
  const phrases: string[] = [];
  const inline = (c: InlineChild, run: string[]): void => {
    if (c.kind === 'text') run.push(c.text);
    else if (c.kind === 'br') run.push(' ');
    else for (const k of c.children) inline(k, run);
  };
  const block = (b: LayoutNode): void => {
    if (b.kind === 'replaced') return;
    const run: string[] = [];
    for (const c of b.children) {
      if (c.kind === 'box' || c.kind === 'replaced') block(c);
      else inline(c, run);
    }
    const phrase = run.join('').replace(SPACES, ' ').trim();
    if (phrase !== '') phrases.push(phrase);
  };
  block(box);
  return phrases.length === 0 ? null : phrases.join(' ');
}
