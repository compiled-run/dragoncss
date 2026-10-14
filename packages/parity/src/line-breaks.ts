// The line-break reference (notes/T015-p4-review-p5-plan.md section 4 item 4): the engine's per-line start and end of every text
// node in UTF-16 units, exported through the engine's own placeLines exactly as the device reads them back
// (DragonTree.apply in emit/native-support.ts), committed as break vectors; Chrome's breaks from single-code-unit Range rects
// grouped by line; and the break check of a device dump against both. Every mismatch is the failure kind break-mismatch.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { Ctx, InlineChild, LayoutBox, LayoutInput, LayoutRect, LU, PlacedLine, TextFont, TextLeaf, TextMeasurer } from '@dragon/layout';
import { absoluteRects, fromCssPx, layout, inlineLeaves, leafFontOf, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, resolveBorder, resolvedInput, resolvePadding, snapEdges } from '@dragon/layout';
import type { TextTransform } from 'dragon';
import { applyTextTransform, NO_FAULTS } from 'dragon';
import { dprLabel } from './dpr.ts';
import type { NativeDump } from './native-dump.ts';
import { breakLineGroups } from './native-dump.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { applyTransformTwin } from './transform-capture.ts';

export const BREAK_MISMATCH = 'break-mismatch';

/**
 * One line of a text node as the engine breaks it: UTF-16 [start, end), the painted code points, the absolute line rect and its
 * snapped edges, and the ellipsis that follows the text on a truncated line (TXT2-f): its absolute x in LU, code points and font.
 * shifts: on a justified line, per code point of cps, the px its glyphs move right by the expansions before it (LinePiece.shifts).
 */
export type EngineLine = {
  readonly start: number;
  readonly end: number;
  readonly cps: readonly number[];
  readonly shifts: readonly number[];
  readonly rect: LayoutRect;
  readonly snapped: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** The first piece's content top below its line box top in LU (the half-leading, or more beside a taller atomic inline). */
  readonly halfLeading: number;
  readonly ellipsis: { readonly x: number; readonly cps: readonly number[]; readonly font: TextFont } | null;
  /** Per engine line rect of the line, the UTF-16 [start, end) a device dumps for it: each piece's, twice for a truncated one. */
  readonly fragments: readonly (readonly [number, number])[];
};
/** font is the leaf's font; textFont is the font the measurer reads for it, with its resolved letter-spacing (inline.ts leafFontOf). */
export type EngineText = { readonly id: string; readonly container: string; readonly font: TextLeaf['font']; readonly textFont: TextFont; readonly lines: readonly EngineLine[] };

const isLine = (r: LayoutRect): boolean => r.parent !== null && r.id.startsWith(`${r.parent}:line`);

/**
 * Every text node's lines, as the device computes them: the engine's layout of the input, the zoomed input's boxes, the content
 * width of the text's container (border box minus borders and paddings, percentages of the parent's), then placeLines over the
 * container's leaves; a line where the leaf shows nothing has no piece and is skipped.
 */
export function engineTextLines(input: LayoutInput, measurer: TextMeasurer): EngineText[] {
  const result = layout(input, measurer);
  if (result.kind !== 'ok') throw new Error(`the engine refused the input: ${result.unsupported.code} at ${result.unsupported.nodeId}`);
  const boxes = result.boxes;
  const abs = absoluteRects(boxes);
  const snappedList = snapEdges(boxes);
  const snapped = new Map(boxes.map((b, i) => [b.id, snappedList[i] as EngineLine['snapped']]));
  // Resolved with the layout's own measurer (layout.ts resolvedInput), so ex, ch, cap and lh of a real face read that face.
  const zoomed = resolvedInput(input, measurer, NO_ENGINE_FAULTS);
  const zBoxes = new Map<string, LayoutBox>();
  const zParent = new Map<string, string>();
  // A text leaf's container is the block container of its inline formatting context, through any inline boxes.
  const textContainer = new Map<string, string>();
  // Every other node of the input: boxes, inline boxes and <br>s, which have rects but no lines of their own.
  const notText = new Set<string>();
  const walkInline = (c: InlineChild, container: string): void => {
    if (c.kind === 'text') textContainer.set(c.id, container);
    else {
      notText.add(c.id);
      if (c.kind === 'inline') for (const k of c.children) walkInline(k, container);
    }
  };
  const walk = (b: LayoutBox): void => {
    notText.add(b.id);
    zBoxes.set(b.id, b);
    for (const c of b.children) {
      if (c.kind === 'box') {
        zParent.set(c.id, b.id);
        walk(c);
      } else if (c.kind === 'replaced') notText.add(c.id);
      else walkInline(c, b.id);
    }
  };
  walk(zoomed.root);
  const rects = new Map<string, LayoutRect>();
  for (const r of boxes) if (!isLine(r)) rects.set(r.id, r);
  const cache = new Map<string, LU>();
  const contentWidth = (id: string): LU => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const z = zBoxes.get(id);
    const r = rects.get(id);
    if (z === undefined || r === undefined) throw new Error(`no box ${id}`);
    const parent = zParent.get(id);
    const cb = parent === undefined ? fromCssPx(zoomed.viewport.width) : contentWidth(parent);
    const pad = resolvePadding(z.style, cb);
    const bor = resolveBorder(z.style, zoomed.devicePixelRatio);
    const w = (r.width - bor.left - bor.right - pad.left - pad.right) as LU;
    cache.set(id, w);
    return w;
  };
  const ctx: Ctx = { measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
  const out: EngineText[] = [];
  for (const r of boxes) {
    if (isLine(r)) continue;
    if (!textContainer.has(r.id)) {
      if (notText.has(r.id)) continue;
      throw new Error(`rect ${r.id} is not a node of the layout input`);
    }
    const pId = textContainer.get(r.id);
    const p = pId === undefined ? undefined : zBoxes.get(pId);
    if (pId === undefined || p === undefined) throw new Error(`text ${r.id} has no container`);
    const leaves = inlineLeaves(p);
    const li = leaves.findIndex((t) => t.id === r.id);
    if (li < 0) throw new Error(`no leaf ${r.id}`);
    const leaf = leaves[li] as TextLeaf;
    const scalars = [...leaf.text];
    const utf16 = (cp: number): number => scalars.slice(0, cp).reduce((n, s) => n + s.length, 0);
    const placed: readonly PlacedLine[] = placeLines(ctx, p, contentWidth(pId));
    const pieces = boxes.filter((b) => isLine(b) && b.parent === r.id);
    const own: EngineLine[] = [];
    // A leaf of preserved text (TXT2-c) can have several pieces on one line (its text, hanging spaces, line feeds): one line here,
    // from its first piece's start to its last piece's end, at its first piece's rect. TXT2-f: a truncated piece has two fragments
    // on its line, its whole run and then its painted part (inline.ts collectFragments).
    let used = 0;
    for (const line of placed) {
      const mine = line.pieces.filter((q) => q.leaf === li);
      const first = mine[0];
      const last = mine[mine.length - 1];
      if (first === undefined || last === undefined) continue;
      const piece = pieces[used];
      let n = 0;
      for (const q of mine) n += q.truncated ? 2 : 1;
      if (piece === undefined || used + n > pieces.length) throw new Error(`${r.id}: the engine's breaks give more lines than its layout (${pieces.length})`);
      used += n;
      const a = abs.get(piece.id);
      const e = snapped.get(piece.id);
      if (a === undefined || e === undefined) throw new Error(`no absolute rect for ${piece.id}`);
      const el = line.ellipsis !== null && line.ellipsis.leaf === li ? line.ellipsis : null;
      const ellipsis = el === null ? null : { x: a.x + el.x - first.x, cps: [...el.text].map((ch) => ch.codePointAt(0) as number), font: el.font };
      const cps = mine.flatMap((q) => scalars.slice(q.start, q.paintEnd).map((ch) => ch.codePointAt(0) as number));
      // Only a line of collapsed text is justified, and it has one piece per leaf; preserved pieces have no shifts.
      const shifts = mine.flatMap((q) => q.shifts);
      const fragments = mine.flatMap((q) => Array.from({ length: q.truncated ? 2 : 1 }, () => [utf16(q.start), utf16(q.end)] as const));
      own.push({ start: utf16(first.start), end: utf16(last.end), cps, shifts, rect: a, snapped: { left: e.left, top: e.top, right: e.right, bottom: e.bottom }, halfLeading: first.top - line.top, ellipsis, fragments });
    }
    if (used !== pieces.length) throw new Error(`${r.id}: the engine's breaks give ${used} fragments, its layout ${pieces.length}`);
    out.push({ id: r.id, container: pId, font: leaf.font, textFont: leafFontOf(leaf), lines: own });
  }
  return out;
}

// ---------------------------------------------------------------- break vectors

/** A case's committed break vector: per text node, per line [start, end) in UTF-16 units of the node's text. */
export type BreakVector = { readonly case: string; readonly dpr: number; readonly texts: readonly { readonly id: string; readonly lines: readonly (readonly [number, number])[] }[] };

export const breakVectorDir = (dpr: number): string => repoPath(`packages/layout/break-vectors/${dprLabel(dpr)}`);
/** Case ids may hold "#": the file name is the case id as it is. */
export const breakVectorPath = (caseId: string, dpr: number): string => `${breakVectorDir(dpr)}/${caseId}.json`;

export function breakVector(caseId: string, dpr: number, texts: readonly EngineText[]): BreakVector {
  return { case: caseId, dpr, texts: texts.map((t) => ({ id: t.id, lines: t.lines.map((l) => [l.start, l.end] as const) })) };
}

/** One line per text node, so a diff names the node. */
export function breakVectorText(v: BreakVector): string {
  const texts = v.texts.map((t) => `    ${JSON.stringify(t)}`).join(',\n');
  return `{\n  "case": ${JSON.stringify(v.case)},\n  "dpr": ${JSON.stringify(v.dpr)},\n  "texts": [${texts.length === 0 ? '' : `\n${texts}\n  `}]\n}\n`;
}

export function readBreakVector(caseId: string, dpr: number): BreakVector | null {
  const p = breakVectorPath(caseId, dpr);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as BreakVector) : null;
}

// ---------------------------------------------------------------- Chrome breaks

/**
 * Chrome's breaks of one text node: its DOM text, its line count (Range client rects, as capture.ts counts them) and, per UTF-16
 * code unit, the line of the unit's first client rect (the line box whose vertical centre is nearest the rect's, since line boxes
 * may overlap), or -1 when the unit has no rect; blank lists the units whose first rect is zero-width (a collapsed or hanging
 * space). A soft wrap's space has a zero-width rect at the end of its line and another at the start of the next; the first counts,
 * as the engine counts the space into the line it ends.
 */
export type ChromeBreakText = {
  readonly id: string;
  readonly data: string;
  readonly lines: number;
  readonly units: readonly number[];
  readonly blank: readonly number[];
  /** TXT2-e: the computed text-transform of the node's parent when it is not none (Chrome renders data transformed). */
  readonly transform?: string;
};
export type ChromeBreaks = { readonly case: string; readonly chrome: string; readonly dpr: number; readonly texts: readonly ChromeBreakText[] };

export const expectedBreaksDir = (dpr: number, platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-breaks/${platform}/${dprLabel(dpr)}`);
export const expectedBreaksPath = (caseId: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${expectedBreaksDir(dpr, platform)}/${caseId}.breaks.json`;

export function chromeBreaksText(b: ChromeBreaks): string {
  const texts = b.texts.map((t) => `    ${JSON.stringify(t)}`).join(',\n');
  return `{\n  "case": ${JSON.stringify(b.case)},\n  "chrome": ${JSON.stringify(b.chrome)},\n  "dpr": ${JSON.stringify(b.dpr)},\n  "texts": [${texts.length === 0 ? '' : `\n${texts}\n  `}]\n}\n`;
}

export function readChromeBreaks(caseId: string, dpr: number): ChromeBreaks | null {
  const p = expectedBreaksPath(caseId, dpr);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as ChromeBreaks) : null;
}

/**
 * Reads the open page: the text nodes named as capture.ts names them, and each code unit's line (single-code-unit Ranges). A text
 * node's lines are its client rects joined per line (a soft hyphen break's generated hyphen rect shares its line's top), and a unit
 * after U+00AD takes the line of its last rect, since Chrome lists the previous line's hyphen first in that unit's Range.
 */
export async function captureBreakTexts(page: Page): Promise<ChromeBreakText[]> {
  // PNT2: text in a transformed box is read on the transform twin, so each line keeps its untransformed rect.
  await applyTransformTwin(page, []);
  return page.evaluate(() => {
    const out: { id: string; data: string; lines: number; units: number[]; blank: number[]; transform?: string }[] = [];
    const isBlank = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';
    for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
      const id = el.getAttribute('data-dragon-id') as string;
      let k = 0;
      let spaces = 0;
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const t = child as Text;
        const whole = document.createRange();
        whole.selectNodeContents(t);
        const lines: DOMRect[] = [];
        for (const r of Array.from(whole.getClientRects())) {
          const last = lines[lines.length - 1];
          if (last !== undefined && Math.abs(last.y - r.y) < 0.001 && Math.abs(last.height - r.height) < 0.001) continue;
          lines.push(r);
        }
        const blankNode = isBlank(t.data);
        const textId = blankNode ? `${id}:space${spaces++}` : `${id}:text${k++}`;
        if (blankNode && lines.length === 0) continue;
        const units: number[] = [];
        const blank: number[] = [];
        for (let i = 0; i < t.data.length; i++) {
          const r = document.createRange();
          r.setStart(t, i);
          r.setEnd(t, i + 1);
          const rects = Array.from(r.getClientRects());
          const pick = i > 0 && t.data.charCodeAt(i - 1) === 0xad && rects.length > 1 ? rects[rects.length - 1] : rects[0];
          if (pick === undefined || lines.length === 0) {
            units.push(-1);
            continue;
          }
          const cy = pick.y + pick.height / 2;
          let best = 0;
          lines.forEach((l, j) => {
            const b = lines[best] as DOMRect;
            if (Math.abs(l.y + l.height / 2 - cy) < Math.abs(b.y + b.height / 2 - cy)) best = j;
          });
          units.push(best);
          if (pick.width === 0) blank.push(i);
        }
        const transform = getComputedStyle(el).textTransform;
        out.push(transform === 'none' ? { id: textId, data: t.data, lines: lines.length, units, blank } : { id: textId, data: t.data, lines: lines.length, units, blank, transform });
      }
    }
    return out;
  });
}

const WHITE = /[ \t\n\r\f]/;

/**
 * The engine offset of every DOM code unit of a text node, or -1: the engine text is the DOM text after white-space phase I
 * (a white-space sequence becomes one space, kept by its first unit, or nothing), so non-white units map one to one in order and
 * an engine space maps to the first unit of its DOM white-space sequence. Null when the texts cannot be aligned.
 */
export function alignUnits(dom: string, engine: string): number[] | null {
  const map = new Array<number>(dom.length).fill(-1);
  // Preserved text (TXT2-c, preserve and break-spaces) reaches the engine as authored.
  if (dom === engine) return map.map((_, i) => i);
  let d = 0;
  for (let e = 0; e < engine.length; e++) {
    const ch = engine[e] as string;
    if (ch === '\n') {
      // preserve-breaks keeps each U+000A and removes the white space around it.
      while (d < dom.length && WHITE.test(dom[d] as string) && dom[d] !== '\n') d++;
      if (d >= dom.length || dom[d] !== '\n') return null;
      map[d++] = e;
      continue;
    }
    if (ch === ' ') {
      while (d < dom.length && !WHITE.test(dom[d] as string)) {
        if (dom[d] !== engine[e]) return null;
        d++;
      }
      if (d >= dom.length) return null;
      map[d] = e;
      while (d < dom.length && WHITE.test(dom[d] as string)) d++;
      continue;
    }
    while (d < dom.length && WHITE.test(dom[d] as string)) d++;
    if (d >= dom.length || dom[d] !== ch) return null;
    map[d++] = e;
  }
  // Only white space the collapse removed may follow the last engine character.
  while (d < dom.length && WHITE.test(dom[d] as string)) d++;
  return d === dom.length ? map : null;
}

const TRANSFORMS: ReadonlySet<string> = new Set(['uppercase', 'lowercase', 'capitalize']);

/**
 * TXT2-e: the text Chrome renders for a text node, as the build-time transform the engine text carries (the same
 * applyTextTransform), with each rendered unit on the line of its DOM unit: a code point's rendered units take its DOM units' lines
 * and blanks in order, the last DOM unit repeated when the mapping lengthens it (U+00DF uppercases to "SS"). Uppercase and lowercase
 * map each code point independently of the text before the node (Final_Sigma looks only inside it), so they give one reading.
 * Capitalize maps unit to unit but the first unit's case depends on the character before the node in its inline formatting context,
 * which the capture does not record: the two readings are "a word starts at the node" (previous a space) and "it does not"
 * (previous a letter), and every other unit must match exactly in both. No transform gives the DOM text itself; a transform outside
 * the four keywords gives no reading (the alignment fails).
 */
export function renderedTexts(t: ChromeBreakText): ChromeBreakText[] {
  const transform = t.transform;
  if (transform === undefined || transform === 'none') return [t];
  if (!TRANSFORMS.has(transform)) return [];
  const faults = NO_FAULTS;
  const previous = transform === 'capitalize' ? [' ', 'a'] : [' '];
  const out: ChromeBreakText[] = [];
  for (const p of previous) {
    const whole = applyTextTransform(t.data, transform as TextTransform, p, faults);
    const units: number[] = [];
    const blank: number[] = [];
    const blankDom = new Set(t.blank);
    let d = 0;
    let r = 0;
    for (const cp of Array.from(t.data)) {
      const n = cp.length;
      const m = transform === 'capitalize' ? n : applyTextTransform(cp, transform as TextTransform, ' ', faults).length;
      for (let j = 0; j < m; j++) {
        const from = d + Math.min(j, n - 1);
        units.push(t.units[from] as number);
        if (blankDom.has(from)) blank.push(r + j);
      }
      d += n;
      r += m;
    }
    // A mapping that is not per code point (none of the four keywords has one beyond Final_Sigma's same-length choice) is no reading.
    if (r !== whole.length) continue;
    out.push({ id: t.id, data: whole, lines: t.lines, units, blank });
  }
  return out;
}

/**
 * Chrome's lines in engine offsets. A mapped unit belongs to the line of its first rect; a unit without a rect continues the line
 * of the unit before it. A line starts at its smallest engine offset whose unit is not a white-space unit with a zero-width rect (a
 * hanging or collapsed space never starts a line: the engine starts a line at its first shown character; U+200B is not white space,
 * and a preserved U+000A starts its line) and ends after its largest engine offset.
 */
export function chromeLines(dom: ChromeBreakText, engineText: string): (readonly [number, number])[] | null {
  for (const t of renderedTexts(dom)) {
    const map = alignUnits(t.data, engineText);
    if (map !== null) return linesOf(t, map, engineText);
  }
  return null;
}

function linesOf(t: ChromeBreakText, map: readonly number[], engineText: string): (readonly [number, number])[] {
  const blank = new Set(t.blank);
  const starts: (number | undefined)[] = [];
  const ends: (number | undefined)[] = [];
  let current = -1;
  t.units.forEach((line, d) => {
    if (line >= 0) current = line;
    const e = map[d] as number;
    if (e < 0 || current < 0) return;
    ends[current] = Math.max(ends[current] ?? e + 1, e + 1);
    // A preserved U+000A (TXT2-c) has a zero-width rect and still starts the line it alone is on.
    const shown = !(blank.has(d) && WHITE.test(t.data[d] as string)) || engineText[e] === '\n';
    if (line >= 0 && shown) starts[current] = Math.min(starts[current] ?? e, e);
  });
  const out: (readonly [number, number])[] = [];
  for (let j = 0; j < t.lines; j++) {
    const s = starts[j];
    const e = ends[j];
    if (s !== undefined && e !== undefined) out.push([s, e]);
  }
  return out;
}

export type BreakProblem = { readonly kind: typeof BREAK_MISMATCH; readonly text: string; readonly detail: string };
export type BreakResult = { readonly compared: number; readonly problems: readonly BreakProblem[] };

const same = (a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The break vectors against Chrome's breaks: every engine text node needs a Chrome text node with the same lines. */
export function compareVectorWithChrome(v: BreakVector, chrome: ChromeBreaks, engineTexts: ReadonlyMap<string, string>): BreakResult {
  const problems: BreakProblem[] = [];
  let compared = 0;
  const byId = new Map(chrome.texts.map((t) => [t.id, t]));
  for (const t of v.texts) {
    compared++;
    const c = byId.get(t.id);
    const text = engineTexts.get(t.id);
    if (c === undefined || text === undefined) {
      problems.push({ kind: BREAK_MISMATCH, text: t.id, detail: `${t.id}: ${c === undefined ? 'Chrome has no text node' : 'no engine text'} for the break vector` });
      continue;
    }
    const lines = chromeLines(c, text);
    if (lines === null) problems.push({ kind: BREAK_MISMATCH, text: t.id, detail: `${t.id}: the DOM text ${JSON.stringify(c.data)}${c.transform === undefined ? '' : ` (text-transform: ${c.transform})`} does not collapse to the engine text ${JSON.stringify(text)}` });
    else if (!same(lines, t.lines)) problems.push({ kind: BREAK_MISMATCH, text: t.id, detail: `${t.id}: engine lines ${JSON.stringify(t.lines)}, Chrome ${JSON.stringify(lines)}` });
  }
  // Chrome text the vector lacks: a mismatch when Chrome shows any of it (a unit with a rect of non-zero width). Text that only
  // collapses away (every unit without a rect or with a zero-width one) generates no engine leaf.
  const inVector = new Set(v.texts.map((t) => t.id));
  for (const c of chrome.texts) {
    if (inVector.has(c.id)) continue;
    const blank = new Set(c.blank);
    // The chromeLines rule: only a white-space unit with a zero-width rect is not shown; U+200B is shown.
    if (c.units.some((line, i) => line >= 0 && !(blank.has(i) && WHITE.test(c.data[i] as string)))) {
      compared++;
      problems.push({ kind: BREAK_MISMATCH, text: c.id, detail: `${c.id}: Chrome shows text ${JSON.stringify(c.data)} that the break vector does not have` });
    }
  }
  return { compared, problems };
}

/** A device dump's line start and end against the break vector, node by node and line by line. */
export function checkDumpBreaks(dump: NativeDump, v: BreakVector): BreakResult {
  const problems: BreakProblem[] = [];
  let compared = 0;
  const byId = new Map(dump.nodes.map((n) => [n.id, n]));
  for (const t of v.texts) {
    const n = byId.get(t.id);
    if (n === undefined) {
      problems.push({ kind: BREAK_MISMATCH, text: t.id, detail: `${t.id}: the dump has no text node for the break vector` });
      continue;
    }
    // TXT2-f, TXT2-c: the fragments of one line (a truncated piece's two, preserved text's pieces) are one line break-wise.
    const got = breakLineGroups(n.lines).map((g) => [n.lines[g[0] as number]?.start ?? null, n.lines[g[g.length - 1] as number]?.end ?? null] as const);
    compared += t.lines.length;
    if (!same(got as (readonly [number, number])[], t.lines)) problems.push({ kind: BREAK_MISMATCH, text: t.id, detail: `${t.id}: device lines ${JSON.stringify(got)}, break vector ${JSON.stringify(t.lines)}` });
  }
  for (const n of dump.nodes) if (n.kind === 'text' && !v.texts.some((t) => t.id === n.id)) problems.push({ kind: BREAK_MISMATCH, text: n.id, detail: `${n.id}: a device text node the break vector does not have` });
  return { compared, problems };
}

/** The text of every leaf of an engine input, by id. */
export function leafTexts(root: LayoutBox): Map<string, string> {
  const out = new Map<string, string>();
  const walkInline = (c: InlineChild): void => {
    if (c.kind === 'text') out.set(c.id, c.text);
    else if (c.kind === 'inline') for (const k of c.children) walkInline(k);
  };
  const walk = (b: LayoutBox): void => {
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else if (c.kind !== 'replaced') walkInline(c);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------- the device-side breaks on the host (Swift and Kotlin)

/**
 * One input line of the host break program: a key, the engine input as JSON (the harness decoder reads it), and the shape
 * transcript of the input (text-latin-run.ts shapingOf), tab separated: the host replays HarfBuzz, as the translate harness does (R3).
 */
export const hostBreakLine = (key: string, input: LayoutInput, shaping: unknown): string => `${key}\t${JSON.stringify(input)}\t${JSON.stringify(shaping)}`;

// The device-side text loop of DragonTree.apply (emit/native-support.ts), over the committed generated engine and the generated
// harness's JSON decoder: the same zoomed boxes, content widths, placeLines pieces, and UTF-16 offsets.
const SWIFT_BREAKS = String.raw`import Foundation

func dragonIsLine(_ r: LayoutRect) -> Bool {
  guard let p = r.parent else { return false }
  return r.id.description.hasPrefix(p.description + ":line")
}

func dragonBreaks(_ input: LayoutInput, _ measurer: TextMeasurer) throws -> String {
  let result = try layout_layout(input, measurer)
  guard let ok = result as? LayoutResult_ok else { return "refused" }
  let boxes = ok.boxes.items
  let zoomed = try layout_zoomInput(input, block_NO_ENGINE_FAULTS)
  var zBoxes: [String: LayoutBox] = [:]
  var zParent: [String: String] = [:]
  var replaced: Set<String> = []
  // A text leaf's container is the block container of its inline formatting context, through any inline boxes.
  // Inline boxes and <br>s: nodes with rects but no lines of their own.
  var notText = Set<String>()
  func walkInline(_ c: any U_InlineBox_LineBreak_TextLeaf, _ container: String) {
    if let t = c as? TextLeaf { zParent[t.id.description] = container }
    else if let ib = c as? InlineBox { notText.insert(ib.id.description); for k in ib.children.items { walkInline(k, container) } }
    else if let lb = c as? LineBreak { notText.insert(lb.id.description) }
  }
  func walk(_ b: LayoutBox) {
    zBoxes[b.id.description] = b
    for c in b.children.items {
      if let cb = c as? LayoutBox { zParent[cb.id.description] = b.id.description; walk(cb) }
      else if let t = c as? TextLeaf { zParent[t.id.description] = b.id.description }
      else if let rl = c as? ReplacedLeaf { replaced.insert(rl.id.description) }
      else if let ib = c as? InlineBox { notText.insert(ib.id.description); for k in ib.children.items { walkInline(k, b.id.description) } }
      else if let lb = c as? LineBreak { notText.insert(lb.id.description) }
    }
  }
  walk(zoomed.root)
  var rects: [String: LayoutRect] = [:]
  var order: [String] = []
  for r in boxes where !dragonIsLine(r) { rects[r.id.description] = r; order.append(r.id.description) }
  var contentCache: [String: Double] = [:]
  func contentWidth(_ id: String) throws -> Double {
    if let c = contentCache[id] { return c }
    guard let z = zBoxes[id], let r = rects[id] else { fatalError("no box \(id)") }
    let cb = try zParent[id].map { try contentWidth($0) } ?? units_fromCssPx(zoomed.viewport.width)
    let pad = try box_resolvePadding(z.style, cb)
    let bor = try box_resolveBorder(z.style, zoomed.devicePixelRatio)
    let w = r.width - bor.left - bor.right - pad.left - pad.right
    contentCache[id] = w
    return w
  }
  var out: [String] = []
  for id in order where zBoxes[id] == nil && !replaced.contains(id) {
    if zParent[id] == nil {
      if notText.contains(id) { continue }
      fatalError("rect \(id) is not a node of the layout input")
    }
    guard let pId = zParent[id], let p = zBoxes[pId] else { fatalError("text \(id) has no container") }
    let ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS)
    let ifc = try inline_buildIfc(ctx, p)
    let leaves = ifc.leaves.items
    guard let li = leaves.firstIndex(where: { $0.id.description == id }) else { fatalError("no leaf \(id)") }
    let scalars = Array(leaves[li].text.description.unicodeScalars)
    func utf16(_ cp: Int) -> Int { return scalars[0..<cp].reduce(0) { $0 + $1.utf16.count } }
    let placed = try inline_placeIfcLines(ctx, p, ifc, try contentWidth(pId)).items
    var lines: [String] = []
    for line in placed {
      let mine = line.pieces.items.filter { Int($0.leaf) == li }
      guard let first = mine.first, let last = mine.last else { continue }
      lines.append("[\(utf16(Int(first.start))),\(utf16(Int(last.end)))]")
    }
    out.append("\(id)\t[\(lines.joined(separator: ","))]")
  }
  return out.joined(separator: "\n")
}

let text = String(decoding: FileManager.default.contents(atPath: CommandLine.arguments[1])!, as: UTF8.self)
guard (try platform_measurerFor(JsString(CommandLine.arguments[3]))) is MeasurerChoice_ok else { fatalError("no measurer") }
var out = ""
for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
  let fields = line.split(separator: "\t", omittingEmptySubsequences: false)
  if fields.count != 3 { fatalError("a break line needs a key, an input and a shape transcript") }
  let key = String(fields[0])
  let input = try harness_decodeInput(harness_parseJson(JsString(String(fields[1]))))
  // The shaped measurer over a replayed HarfBuzz (R3); a call the transcript lacks is a harness error.
  let measurer = try harness_replayMeasurer(try harness_decodeShaping(harness_parseJson(JsString(String(fields[2]))), JsString("$.shaping")), block_NO_ENGINE_FAULTS)
  out += "#\t" + key + "\n" + (try dragonBreaks(input, measurer)) + "\n"
}
FileManager.default.createFile(atPath: CommandLine.arguments[2], contents: out.data(using: .utf8))
`;

const KOTLIN_BREAKS = String.raw`@file:JvmName("BreaksMainKt")

package dev.dragon.layout

import java.io.File

fun dragonIsLine(r: LayoutRect): Boolean {
  val p = r.parent ?: return false
  return r.id.startsWith(p + ":line")
}

fun dragonBreaks(input: LayoutInput, measurer: TextMeasurer): String {
  val result = layout_layout(input, measurer)
  val ok = result as? LayoutResult_ok ?: return "refused"
  val boxes = ok.boxes
  val zoomed = layout_zoomInput(input, block_NO_ENGINE_FAULTS)
  val zBoxes = HashMap<String, LayoutBox>()
  val zParent = HashMap<String, String>()
  val replaced = HashSet<String>()
  // A text leaf's container is the block container of its inline formatting context, through any inline boxes.
  // Inline boxes and <br>s: nodes with rects but no lines of their own.
  val notText = HashSet<String>()
  fun walkInline(c: U_InlineBox_LineBreak_TextLeaf, container: String) {
    if (c is TextLeaf) zParent[c.id] = container
    else if (c is InlineBox) { notText.add(c.id); for (k in c.children) walkInline(k, container) }
    else if (c is LineBreak) notText.add(c.id)
  }
  fun walk(b: LayoutBox) {
    zBoxes[b.id] = b
    for (c in b.children) {
      if (c is LayoutBox) { zParent[c.id] = b.id; walk(c) }
      else if (c is TextLeaf) zParent[c.id] = b.id
      else if (c is ReplacedLeaf) replaced.add(c.id)
      else if (c is InlineBox) { notText.add(c.id); for (k in c.children) walkInline(k, b.id) }
      else if (c is LineBreak) notText.add(c.id)
    }
  }
  walk(zoomed.root)
  val rects = HashMap<String, LayoutRect>()
  val order = ArrayList<String>()
  for (r in boxes) if (!dragonIsLine(r)) { rects[r.id] = r; order.add(r.id) }
  val contentCache = HashMap<String, Double>()
  fun contentWidth(id: String): Double {
    val cached = contentCache[id]
    if (cached != null) return cached
    val z = zBoxes[id] ?: throw IllegalStateException("no box " + id)
    val r = rects[id] ?: throw IllegalStateException("no rect " + id)
    val parent = zParent[id]
    val cb = if (parent != null) contentWidth(parent) else units_fromCssPx(zoomed.viewport.width)
    val pad = box_resolvePadding(z.style, cb)
    val bor = box_resolveBorder(z.style, zoomed.devicePixelRatio)
    val w = r.width - bor.left - bor.right - pad.left - pad.right
    contentCache[id] = w
    return w
  }
  val out = ArrayList<String>()
  for (id in order) {
    if (zBoxes.containsKey(id) || replaced.contains(id)) continue
    if (!zParent.containsKey(id)) {
      if (notText.contains(id)) continue
      throw IllegalStateException("rect " + id + " is not a node of the layout input")
    }
    val pId = zParent[id] ?: throw IllegalStateException("text " + id + " has no container")
    val p = zBoxes[pId] ?: throw IllegalStateException("no container " + pId)
    val ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS)
    val ifc = inline_buildIfc(ctx, p)
    val leaves = ifc.leaves
    val li = leaves.indexOfFirst { it.id == id }
    if (li < 0) throw IllegalStateException("no leaf " + id)
    val leafText = leaves[li].text
    fun utf16(cp: Int): Int = leafText.offsetByCodePoints(0, cp)
    val placed = inline_placeIfcLines(ctx, p, ifc, contentWidth(pId))
    val lines = ArrayList<String>()
    for (line in placed) {
      val mine = line.pieces.filter { it.leaf.toInt() == li }
      if (mine.isEmpty()) continue
      lines.add("[" + utf16(mine.first().start.toInt()) + "," + utf16(mine.last().end.toInt()) + "]")
    }
    out.add(id + "\t[" + lines.joinToString(",") + "]")
  }
  return out.joinToString("\n")
}

fun main(args: Array<String>) {
  if (platform_measurerFor(args[2]) !is MeasurerChoice_ok) throw IllegalStateException("no measurer")
  val sb = StringBuilder()
  for (line in File(args[0]).readText(Charsets.UTF_8).split('\n')) {
    if (line.isEmpty()) continue
    val fields = line.split('\t')
    if (fields.size != 3) throw IllegalStateException("a break line needs a key, an input and a shape transcript")
    val input = harness_decodeInput(harness_parseJson(fields[1]))
    // The shaped measurer over a replayed HarfBuzz (R3); a call the transcript lacks is a harness error.
    val measurer = harness_replayMeasurer(harness_decodeShaping(harness_parseJson(fields[2]), "\$.shaping"), block_NO_ENGINE_FAULTS)
    sb.append("#\t").append(fields[0]).append('\n').append(dragonBreaks(input, measurer)).append('\n')
  }
  File(args[1]).writeText(sb.toString(), Charsets.UTF_8)
}
`;

/** Parses the host program's output: key -> text id -> lines. */
export function parseHostBreaks(text: string): Map<string, Map<string, (readonly [number, number])[]>> {
  const out = new Map<string, Map<string, (readonly [number, number])[]>>();
  let current: Map<string, (readonly [number, number])[]> | null = null;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const [a, b] = line.split('\t') as [string, string | undefined];
    if (a === '#' && b !== undefined) {
      current = new Map();
      out.set(b, current);
    } else if (current !== null && b !== undefined) current.set(a, JSON.parse(b) as (readonly [number, number])[]);
    else throw new Error(`host break program: bad line ${line}`);
  }
  return out;
}

/**
 * Builds (cached on the sources) and runs the host break program in Swift or Kotlin over the given lines; returns its output. The
 * program is the device-side loop over the committed generated engine and harness decoder; nothing of packages/translate changes.
 */
export function runHostBreaks(lang: 'swift' | 'kotlin', lines: readonly string[], platform: string = REFERENCE_PLATFORM): string {
  const gen = repoPath('packages/layout/generated');
  const sources: [string, string][] = lang === 'swift'
    ? [...listDir(`${gen}/swift/Sources/DragonLayout`, '.swift'), ...['Harness.swift', 'Host.swift'].map((f): [string, string] => [`${gen}/swift/Sources/DragonLayoutHarness/${f}`, readFileSync(`${gen}/swift/Sources/DragonLayoutHarness/${f}`, 'utf8')]), ['Breaks/main.swift', SWIFT_BREAKS]]
    : [...listDir(`${gen}/kotlin/src/main/kotlin/dev/dragon/layout`, '.kt'), ...['Harness.kt', 'Host.kt'].map((f): [string, string] => [`${gen}/kotlin/harness/dev/dragon/layout/${f}`, readFileSync(`${gen}/kotlin/harness/dev/dragon/layout/${f}`, 'utf8')]), ['Breaks/BreaksMain.kt', KOTLIN_BREAKS]];
  const h = createHash('sha256');
  for (const [p, t] of sources) h.update(p.slice(p.lastIndexOf('/') + 1)).update('\0').update(t).update('\0');
  const dir = repoPath(`packages/parity/out/native/breaks/${lang}-${h.digest('hex').slice(0, 16)}`);
  const artifact = join(dir, lang === 'swift' ? 'breaks' : 'breaks.jar');
  if (!existsSync(artifact)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    const files = sources.map(([p, t], i) => {
      const f = join(dir, 'src', `${String(i).padStart(3, '0')}-${p.slice(p.lastIndexOf('/') + 1)}`);
      writeFileSync(f, t);
      return f;
    });
    if (lang === 'swift') {
      // main.swift must keep its name to hold the top-level code.
      const main = join(dir, 'src', 'main.swift');
      writeFileSync(main, SWIFT_BREAKS);
      const r = spawnSync('xcrun', ['swiftc', '-Onone', '-suppress-warnings', '-module-name', 'DragonBreaks', ...files.filter((f) => !f.endsWith('-main.swift')), main, '-o', `${artifact}.tmp`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) throw new Error(`swiftc (host breaks) failed: ${`${r.stdout}${r.stderr}`.slice(-3000)}`);
    } else {
      const javaHome = process.env['JAVA_HOME'];
      if (javaHome === undefined) throw new Error('JAVA_HOME is not set');
      const r = spawnSync('kotlinc', ['-J-Xmx4g', '-nowarn', '-include-runtime', '-d', join(dir, 'tmp-breaks.jar'), ...files], { encoding: 'utf8', env: { ...process.env, JAVA_HOME: javaHome }, maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) throw new Error(`kotlinc (host breaks) failed: ${`${r.stdout}${r.stderr}`.slice(-3000)}`);
      renameSync(join(dir, 'tmp-breaks.jar'), `${artifact}.tmp`);
    }
    renameSync(`${artifact}.tmp`, artifact);
  }
  const input = join(dir, `input-${process.pid}.txt`);
  const output = join(dir, `output-${process.pid}.txt`);
  writeFileSync(input, `${lines.join('\n')}\n`);
  const javaHome = process.env['JAVA_HOME'] ?? '';
  const r = lang === 'swift'
    ? spawnSync(artifact, [input, output, platform], { encoding: 'utf8' })
    : spawnSync(join(javaHome, 'bin', 'java'), ['-Xss64m', '-cp', artifact, 'dev.dragon.layout.BreaksMainKt', input, output, platform], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`host breaks (${lang}) failed: ${`${r.stdout}${r.stderr}`.slice(-3000)}`);
  const text = readFileSync(output, 'utf8');
  rmSync(input, { force: true });
  rmSync(output, { force: true });
  return text;
}

function listDir(dir: string, ext: string): [string, string][] {
  return readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f): [string, string] => [`${dir}/${f}`, readFileSync(`${dir}/${f}`, 'utf8')]);
}
