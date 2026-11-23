// White space phase I (css-text-3 §4.1.1-§4.1.3) over one inline formatting context, the one implementation the build and the phone run.

const ZWSP = '\u200b';

/** One character of a context and the run it came from; ch is '' for a <br>. */
type RunChar = { readonly ch: string; readonly run: number };

/** A phase I white space character of white-space-collapse: collapse. */
function isCollapsibleSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** Each run's characters of out, which holds them in run order. */
function joinRuns(out: readonly RunChar[], count: number): string[] {
  const joined: string[] = [];
  let p = 0;
  for (let run = 0; run < count; run++) {
    let s = '';
    while (p < out.length && (out[p] as RunChar).run === run) {
      s = s + (out[p] as RunChar).ch;
      p++;
    }
    joined.push(s);
  }
  return joined;
}

/**
 * Phase I of white-space-collapse: collapse over a whole inline formatting context, null in runs for a <br>: each white space
 * sequence, across run and inline box boundaries but not across a <br>, becomes one space kept by the run where it starts; a
 * sequence with a segment break next to U+200B is removed (§4.1.3). The spaces at the start of the context and after a <br> begin a
 * line, and those at its end end one, so §4.1.2 removes them; a space before a <br> is kept, as Blink keeps it (it hangs).
 */
export function collapseInlineContext(runs: readonly (string | null)[]): (string | null)[] {
  const chars: RunChar[] = [];
  let run = 0;
  for (const t of runs) {
    if (t === null) chars.push({ ch: '', run: -1 });
    else for (const ch of t) chars.push({ ch, run });
    run++;
  }
  const out: RunChar[] = [];
  let lineStart = true;
  let last = '';
  let k = 0;
  while (k < chars.length) {
    const c = chars[k] as RunChar;
    if (c.ch === '') {
      lineStart = true;
      k++;
      continue;
    }
    if (!isCollapsibleSpace(c.ch)) {
      out.push(c);
      last = c.ch;
      lineStart = false;
      k++;
      continue;
    }
    let e = k;
    let segmentBreak = false;
    while (e < chars.length) {
      const x = (chars[e] as RunChar).ch;
      if (x === '' || !isCollapsibleSpace(x)) break;
      if (x === '\n' || x === '\r') segmentBreak = true;
      e++;
    }
    const hasAfter = e < chars.length;
    const nextToZwsp = (!lineStart && last === ZWSP) || (hasAfter && (chars[e] as RunChar).ch === ZWSP);
    if (!lineStart && hasAfter && !(segmentBreak && nextToZwsp)) out.push({ ch: ' ', run: c.run });
    k = e;
  }
  const joined = joinRuns(out, runs.length);
  const texts: (string | null)[] = [];
  let i = 0;
  for (const t of runs) {
    if (t === null) texts.push(null);
    else texts.push(joined[i] as string);
    i++;
  }
  return texts;
}

/**
 * Phase I of white-space-collapse: preserve-breaks over the texts of one inline formatting context (Blink InlineItemsBuilder
 * AppendPreserveNewline, its collapsing state carried from one text to the next): each U+000A stays, every other sequence of spaces
 * and tabs becomes one space kept by the text where it starts, and the spaces at the start, at the end and on either side of each
 * U+000A go (AppendForcedBreakCollapseWhitespace). keepSpaceBeforeNewline is the planted compiler fault preLineKeepsSpaceBeforeNewline.
 */
export function preserveBreaksContext(runs: readonly string[], keepSpaceBeforeNewline: boolean): string[] {
  const chars: RunChar[] = [];
  let run = 0;
  for (const t of runs) {
    for (const ch of t) chars.push({ ch, run });
    run++;
  }
  const out: RunChar[] = [];
  let last = '';
  let k = 0;
  while (k < chars.length) {
    const c = chars[k] as RunChar;
    if (c.ch !== ' ' && c.ch !== '\t') {
      out.push(c);
      last = c.ch;
      k++;
      continue;
    }
    let e = k;
    while (e < chars.length && ((chars[e] as RunChar).ch === ' ' || (chars[e] as RunChar).ch === '\t')) e++;
    const atStart = last === '' || last === '\n';
    const hasAfter = e < chars.length;
    const atNewline = hasAfter && (chars[e] as RunChar).ch === '\n';
    if (!atStart && hasAfter && (!atNewline || keepSpaceBeforeNewline)) out.push({ ch: ' ', run: c.run });
    k = e;
  }
  return joinRuns(out, runs.length);
}
