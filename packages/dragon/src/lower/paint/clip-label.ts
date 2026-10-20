// The accessibility label of a box its empty clip rect hides (MASK-CLIP, the visually-hidden pattern): the text of its subtree's text
// leaves, the same strings the native text views label themselves with (DragonTextView.dragonSetText), in tree order, leaving out the
// texts Chrome does not expose (visibility: hidden, analysis/paint-values/clip-label.ts hiddenTexts). Leaves of one inline formatting
// context run together, so "Hello <b>world</b>" reads as written, and an atomic inline (inline-block, inline-flex, inline-grid) runs in
// with them where it stands; each block's text is one phrase, phrases are joined by a space, as a screen reader reads the lines of
// Chrome's tree one after another. Runs of ASCII white space collapse to one space, trimmed at each phrase's ends; a <br> is a space.
import type { InlineChild, LayoutBox, LayoutNode } from '@dragon/layout';

const SPACES = /[ \t\n\r\f]+/g;

const isAtomicInline = (b: LayoutBox): boolean => b.style.display === 'inline-block' || b.style.display === 'inline-flex' || b.style.display === 'inline-grid';

/** The label of a box's subtree text without the hidden texts (by text address), or null when no phrase has text in it. */
export function clipLabelOf(box: LayoutNode, hidden: ReadonlySet<string> = new Set()): string | null {
  const phrases: string[] = [];
  const inline = (c: InlineChild, run: string[]): void => {
    if (c.kind === 'text') {
      if (!hidden.has(c.id)) run.push(c.text);
    } else if (c.kind === 'br') run.push(' ');
    else for (const k of c.children) inline(k, run);
  };
  // A phrase ends where its block's run ends, or where a block-level box (an out-of-flow one among inline content) starts.
  const flush = (run: string[]): void => {
    const phrase = run.join('').replace(SPACES, ' ').trim();
    if (phrase !== '') phrases.push(phrase);
    run.length = 0;
  };
  const block = (b: LayoutNode): void => {
    if (b.kind === 'replaced') return;
    const run: string[] = [];
    for (const c of b.children) {
      if (c.kind === 'replaced') continue;
      if (c.kind === 'box' && isAtomicInline(c)) run.push(clipLabelOf(c, hidden) ?? '');
      else if (c.kind === 'box') {
        flush(run);
        block(c);
      } else inline(c, run);
    }
    flush(run);
  };
  block(box);
  return phrases.length === 0 ? null : phrases.join(' ');
}
