// white-space.ts against verbatim copies of the build's phase I as it stood in packages/dragon/src/analysis/resolve.ts before the move.
import { describe, expect, it } from 'vitest';
import { collapseInlineContext, preserveBreaksContext } from '../src/index.ts';

const WHITE_SPACE = /[ \t\n\r\f]/;
const ZWSP = '\u200b';

function oracleCollapseInlineContext(runs: readonly (string | null)[]): (string | null)[] {
  type C = { readonly ch: string; readonly run: number } | { readonly br: true };
  const chars: C[] = [];
  runs.forEach((t, run) => {
    if (t === null) chars.push({ br: true });
    else for (const ch of t) chars.push({ ch, run });
  });
  const out: { ch: string; run: number }[] = [];
  let lineStart = true;
  let k = 0;
  while (k < chars.length) {
    const c = chars[k] as C;
    if ('br' in c) {
      lineStart = true;
      k++;
      continue;
    }
    if (!WHITE_SPACE.test(c.ch)) {
      out.push(c);
      lineStart = false;
      k++;
      continue;
    }
    let e = k;
    let segmentBreak = false;
    while (e < chars.length) {
      const x = chars[e] as C;
      if ('br' in x || !WHITE_SPACE.test(x.ch)) break;
      if (x.ch === '\n' || x.ch === '\r') segmentBreak = true;
      e++;
    }
    const before = lineStart ? undefined : out[out.length - 1];
    const after = chars[e];
    const nextToZwsp = (before !== undefined && before.ch === ZWSP) || (after !== undefined && !('br' in after) && after.ch === ZWSP);
    if (before !== undefined && after !== undefined && !(segmentBreak && nextToZwsp)) out.push({ ch: ' ', run: c.run });
    k = e;
  }
  return runs.map((t, run) => (t === null ? null : out.filter((c) => c.run === run).map((c) => c.ch).join('')));
}

function oraclePreserveBreaks(runs: readonly string[], preLineKeepsSpaceBeforeNewline: boolean): string[] {
  type C = { ch: string; run: number };
  const chars: C[] = [];
  runs.forEach((t, run) => {
    for (const ch of t as string) chars.push({ ch, run });
  });
  const out: C[] = [];
  let k = 0;
  while (k < chars.length) {
    const c = chars[k] as C;
    if (c.ch !== ' ' && c.ch !== '\t') {
      out.push(c);
      k++;
      continue;
    }
    let e = k;
    while (e < chars.length && ((chars[e] as C).ch === ' ' || (chars[e] as C).ch === '\t')) e++;
    const before = out[out.length - 1];
    const after = chars[e];
    const atStart = before === undefined || before.ch === '\n';
    const atNewline = after !== undefined && after.ch === '\n';
    if (!atStart && after !== undefined && (!atNewline || preLineKeepsSpaceBeforeNewline)) out.push({ ch: ' ', run: c.run });
    k = e;
  }
  return runs.map((_, run) => out.filter((c) => c.run === run).map((c) => c.ch).join(''));
}

/** mulberry32: a fixed seed, so a failure names a run list that reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [' ', ' ', ' ', '\t', '\n', '\n', '\r', '\f', '\u200b', '\u00a0', '\ufffc', 'a', 'b', 'x', '一', '\u{1f600}'];

function runText(next: () => number): string {
  const n = Math.floor(next() * 7);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(next() * ALPHABET.length)] as string;
  return s;
}

function runList(next: () => number, nulls: boolean): (string | null)[] {
  const n = Math.floor(next() * 6);
  const runs: (string | null)[] = [];
  for (let i = 0; i < n; i++) runs.push(nulls && next() < 0.2 ? null : runText(next));
  return runs;
}

const COUNT = 20000;

describe('white-space.ts matches the phase I it replaced', () => {
  it(`collapseInlineContext over ${COUNT} generated run lists with <br>s`, () => {
    const next = rng(0x5eed1);
    let nulls = 0;
    for (let i = 0; i < COUNT; i++) {
      const runs = runList(next, true);
      if (runs.includes(null)) nulls++;
      expect(collapseInlineContext(runs), JSON.stringify(runs)).toEqual(oracleCollapseInlineContext(runs));
    }
    expect(nulls).toBeGreaterThan(COUNT / 4);
  });

  for (const fault of [false, true]) {
    it(`preserveBreaksContext over ${COUNT} generated run lists, preLineKeepsSpaceBeforeNewline ${fault}`, () => {
      const next = rng(fault ? 0x5eed3 : 0x5eed2);
      for (let i = 0; i < COUNT; i++) {
        const runs = runList(next, false) as string[];
        expect(preserveBreaksContext(runs, fault), JSON.stringify(runs)).toEqual(oraclePreserveBreaks(runs, fault));
      }
    });
  }

  it('the fault changes the result of a space before a preserved U+000A', () => {
    expect(preserveBreaksContext(['a ', '\nb'], false)).toEqual(['a', '\nb']);
    expect(preserveBreaksContext(['a ', '\nb'], true)).toEqual(['a ', '\nb']);
  });

  it('the hand cases: across runs, across a <br>, U+200B beside a segment break, U+00A0 and an atomic inline', () => {
    expect(collapseInlineContext([' a ', ' b '])).toEqual(['a ', 'b']);
    expect(collapseInlineContext(['a ', null, ' b'])).toEqual(['a ', null, 'b']);
    expect(collapseInlineContext(['a\n', '\u200bb'])).toEqual(['a', '\u200bb']);
    expect(collapseInlineContext(['a\t', '\u00a0 b'])).toEqual(['a ', '\u00a0 b']);
    expect(collapseInlineContext(['a ', '\ufffc', ' b'])).toEqual(['a ', '\ufffc', ' b']);
    expect(collapseInlineContext([])).toEqual([]);
  });
});
