// The unicode-bidi refusal (css-writing-modes-4 §2.2, UAX #9): native lays text out in its logical order within each run of one
// direction and never reads unicode-bidi (lower/ios-layout.ts), so on iOS and Android an author's unicode-bidi compiles only where
// Chrome's run order is the one normal gives:
// - normal anywhere;
// - embed or isolate on a block-level box or an atomic inline, where it reaches only its own content, which it already embeds at
//   its own direction (§2.4.2: the box's paragraphs take the box's direction);
// - any value on a box whose direction is ltr, whose parent's is ltr, and whose paragraph holds no right-to-left character: every
//   character then resolves to an even level, so no run is reversed, overridden to ltr or not. An inline box inside another
//   inline box is the exception: its embedding level splits the outer box into one fragment per level run on a line (Chrome 145
//   reports each as a client rect), and native lays an inline box out as one fragment per line.
// Everything else is refused (an rtl context, where an isolate or override changes the order of Latin words and neutrals, a
// right-to-left character in the paragraph, or an inline box nested in another). The UA's unicode-bidi (isolate on the block-level
// HTML elements) is refused under the same rule once the author makes its box display: inline, at that display declaration: in an
// rtl paragraph Chrome then orders the isolate's edge spaces inside it and splits the box into fragments (Chrome 145 reports
// <div style="display:inline">YY </div> in rtl as two client rects), which native does not. On a block it is never refused.
// The parity lanes compile the refused values on native anyway (project.ts, lane-only): such a case proves web rows only.
import { authored, diagnostic, unlocated } from '../diagnostics/catalogue.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import type { ResolvedElement, ResolvedText } from './resolve.ts';

// UAX #9 classes R, AL and AN (Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic and their presentation forms, and the
// right-to-left supplementary blocks), and the explicit formatting characters RLM, ALM, LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI and PDI.
const RIGHT_TO_LEFT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u200F\u061C\u202A-\u202E\u2066-\u2069]|[\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

const keywordOf = (el: ResolvedElement, p: 'unicode-bidi' | 'direction' | 'display'): string => {
  const v = (el.props.get(p) as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

/** Whether any text under el holds a right-to-left character. */
function holdsRightToLeft(el: ResolvedElement | ResolvedText): boolean {
  if (el.kind === 'text') return RIGHT_TO_LEFT.test(el.text);
  return el.children.some(holdsRightToLeft);
}

/** Refuses, per native target, every element whose author unicode-bidi native would not lay out as Chrome orders it. */
export function checkBidi(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  // paragraph: the nearest block-level ancestor-or-self, whose inline content is the paragraph an inline box's text belongs to.
  const walk = (el: ResolvedElement, parentDirection: string, parentInline: boolean, paragraph: ResolvedElement): void => {
    const display = keywordOf(el, 'display');
    const inline = display === 'inline';
    const own = inline ? paragraph : el;
    const direction = keywordOf(el, 'direction');
    const v = el.props.get('unicode-bidi') as ResolvedValue | undefined;
    if (v === undefined) throw new Error(`${el.element.address}: unicode-bidi did not resolve`);
    const k = keywordOf(el, 'unicode-bidi');
    const rightToLeft = direction !== 'ltr' || parentDirection !== 'ltr' || holdsRightToLeft(own);
    const reorders = k !== 'normal' && !(!inline && (k === 'embed' || k === 'isolate')) && (rightToLeft || (inline && parentInline));
    const authorBidi = v.declaration !== null && v.origin === 'author';
    const displayDeclaration = (el.props.get('display') as ResolvedValue | undefined)?.declaration ?? null;
    // The UA's value on an inline box: only a right-to-left context reorders it (Chrome 145 lays the UA isolate of a div made
    // inline inside a span over ltr Latin text out as one fragment).
    if (authorBidi ? reorders : inline && k !== 'normal' && rightToLeft) {
      const span = authorBidi ? (v.declaration as NonNullable<typeof v.declaration>).valueSpan : displayDeclaration?.valueSpan;
      const origin = span === undefined ? unlocated(`the UA's unicode-bidi: ${k} on the inline box <${el.element.tag}> ${el.element.address}`) : authored(span);
      const what = authorBidi ? `unicode-bidi: ${k}` : `The UA's unicode-bidi: ${k}`;
      for (const t of targets) {
        if (t === 'web') continue;
        const id = `${t}|unicode-bidi|${el.element.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin,
          target: t,
          message: `${what} on <${el.element.tag}> ${el.element.address} can reorder its text in Chrome (it is in a right-to-left context, its paragraph holds right-to-left text, or it is an inline box inside another whose fragments it splits), and ${t} lays text out in logical order, one fragment per inline box and line`,
          manual: authorBidi ? 'Remove unicode-bidi, or use it only on left-to-right Latin text.' : 'Set unicode-bidi: normal on the inline box, or keep it block-level.',
          basis: 'computed-value',
        }));
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, direction, inline, own);
  };
  walk(root, keywordOf(root, 'direction'), false, root);
}
