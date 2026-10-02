// The line-break reference (notes/T015-p4-review-p5-plan.md section 4 item 4): the committed break vectors are the engine's own
// export for every case at every device DPR; the export equals the device-side inline_placeLines offsets run by the committed
// generated engine in host Swift and host Kotlin; Chrome's committed breaks equal the break vectors; and the break check names
// every mismatch break-mismatch.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { programInput } from 'dragon';
import { DPRS } from '../src/dpr.ts';
import type { ChromeBreakText } from '../src/line-breaks.ts';
import { alignUnits, BREAK_MISMATCH, breakVector, breakVectorDir, breakVectorPath, breakVectorText, checkDumpBreaks, chromeLines, compareVectorWithChrome, engineTextLines, expectedBreaksDir, hostBreakLine, leafTexts, parseHostBreaks, readBreakVector, readChromeBreaks, runHostBreaks } from '../src/line-breaks.ts';
import { plantDumpFault } from '../src/native-compare.ts';
import { nativeCases, referenceMeasurer, relabelledReferenceDumps } from '../src/native-host.ts';

const cases = nativeCases();
const m = referenceMeasurer();
const inputOf = (n: (typeof cases)[number], dpr: number) => programInput(n.programs.uikit, n.case.environment.viewport, dpr);

describe('break vectors', () => {
  it('one committed break vector per case per device DPR, each the engine export as written (a second run is diff-clean)', () => {
    for (const dpr of DPRS) {
      expect(readdirSync(breakVectorDir(dpr)).filter((f) => f.endsWith('.json')).length, `DPR ${dpr}`).toBe(cases.length);
      for (const n of cases) {
        const text = breakVectorText(breakVector(n.case.id, dpr, engineTextLines(inputOf(n, dpr), m)));
        expect(readFileSync(breakVectorPath(n.case.id, dpr), 'utf8'), `${n.case.id}@${dpr}`).toBe(text);
      }
    }
  });
  it('every text leaf is found under its container: text-wrap-spaces exports each leaf, with lines', () => {
    const n = cases.find((c) => c.case.id === 'text-wrap-spaces');
    if (n === undefined) throw new Error('no text-wrap-spaces');
    const t = engineTextLines(inputOf(n, 3), m);
    expect(t.map((x) => x.id)).toEqual([...leafTexts(n.programs.uikit.root).keys()]);
    expect(t.every((x) => x.lines.length > 0 && x.container === x.id.split(':')[0])).toBe(true);
  });
  it('both backends run one engine input, so one break vector serves both targets', () => {
    for (const n of cases) expect(JSON.stringify(n.programs.uikit.root), n.case.id).toBe(JSON.stringify(n.programs['android-views'].root));
  });
  it.each(['swift', 'kotlin'] as const)('the export equals the device-side inline_placeLines offsets of the generated engine in host %s, for every case at every DPR', (lang) => {
    const keyed = DPRS.flatMap((dpr) => cases.map((n) => ({ key: `${n.case.id}@${dpr}`, n, dpr })));
    const got = parseHostBreaks(runHostBreaks(lang, keyed.map((k) => hostBreakLine(k.key, inputOf(k.n, k.dpr)))));
    expect(got.size).toBe(keyed.length);
    let texts = 0;
    for (const k of keyed) {
      const v = readBreakVector(k.n.case.id, k.dpr);
      const host = got.get(k.key);
      expect(host, k.key).toBeDefined();
      expect([...(host ?? new Map()).entries()], k.key).toEqual(v?.texts.map((t) => [t.id, t.lines]));
      texts += v?.texts.length ?? 0;
    }
    expect(texts).toBeGreaterThan(keyed.length);
  }, 900_000);
});

describe('Chrome breaks', () => {
  it('one committed capture per case per device DPR, and the break vectors equal them on every case', () => {
    let equal = 0;
    for (const dpr of DPRS) {
      expect(existsSync(expectedBreaksDir(dpr))).toBe(true);
      for (const n of cases) {
        const v = readBreakVector(n.case.id, dpr);
        const c = readChromeBreaks(n.case.id, dpr);
        expect(c?.dpr).toBe(dpr);
        if (v === null || c === null) continue;
        const r = compareVectorWithChrome(v, c, leafTexts(n.programs.uikit.root));
        expect(r.problems, `${n.case.id}@${dpr}`).toEqual([]);
        if (r.problems.length === 0) equal++;
      }
    }
    expect(equal).toBe(cases.length * DPRS.length);
  });
  it('the DOM text aligns with the collapsed engine text: a white-space run maps to its first unit, collapsed units to nothing', () => {
    expect(alignUnits('\n   XX   XX\n XX  ', 'XX XX XX')).toEqual([-1, -1, -1, -1, 0, 1, 2, -1, -1, 3, 4, 5, -1, 6, 7, -1, -1]);
    expect(alignUnits('XX YY', 'XX ZZ')).toBeNull();
    // Every DOM unit must be consumed: a truncated engine text is not an alignment; collapsed trailing white space is.
    expect(alignUnits('aX', 'a')).toBeNull();
    expect(alignUnits('XX \n ', 'XX')).toEqual([0, 1, -1, -1, -1]);
  });
  it("a hanging space ends its line but never starts the next; U+200B is shown, so it starts a line", () => {
    const t: ChromeBreakText = { id: 'a:text0', data: 'XX XX XX', lines: 3, units: [0, 0, 0, 1, 1, 1, 2, 2], blank: [2, 5] };
    expect(chromeLines(t, 'XX XX XX')).toEqual([[0, 3], [3, 6], [6, 8]]);
    const lead: ChromeBreakText = { id: 'a:text1', data: ' YY', lines: 1, units: [0, 0, 0], blank: [0] };
    expect(chromeLines(lead, ' YY')).toEqual([[1, 3]]);
    const zwsp: ChromeBreakText = { id: 'a:text2', data: '\u200b', lines: 1, units: [0], blank: [0] };
    expect(chromeLines(zwsp, '\u200b')).toEqual([[0, 1]]);
  });
  it('Chrome text the vector lacks is a break-mismatch when Chrome shows it; text that only collapses away is not', () => {
    const n = cases.find((c) => c.case.id === 'text-wrap-spaces');
    const v = readBreakVector('text-wrap-spaces', 3);
    const c = readChromeBreaks('text-wrap-spaces', 3);
    if (n === undefined || v === null || c === null) throw new Error('no text-wrap-spaces data');
    const shown = { ...c, texts: [...c.texts, { id: 'w9:text0', data: 'XX', lines: 1, units: [0, 0], blank: [] }] };
    const r = compareVectorWithChrome(v, shown, leafTexts(n.programs.uikit.root));
    expect(r.problems.map((p) => p.detail)).toEqual(['w9:text0: Chrome shows text "XX" that the break vector does not have']);
    const collapsed = { ...c, texts: [...c.texts, { id: 'w9:space0', data: ' ', lines: 1, units: [0], blank: [0] }] };
    expect(compareVectorWithChrome(v, collapsed, leafTexts(n.programs.uikit.root)).problems).toEqual([]);
    // U+200B has a zero-width rect but is shown (as chromeLines counts it), so a missing U+200B node is a mismatch.
    const zwsp = { ...c, texts: [...c.texts, { id: 'w9:text1', data: '\u200b', lines: 1, units: [0], blank: [0] }] };
    expect(compareVectorWithChrome(v, zwsp, leafTexts(n.programs.uikit.root)).problems.map((p) => p.text)).toEqual(['w9:text1']);
  });
  it('a vector that disagrees with Chrome is a break-mismatch naming the node and both line lists', () => {
    const n = cases.find((c) => c.case.id === 'text-wrap-spaces');
    const v = readBreakVector('text-wrap-spaces', 3);
    const c = readChromeBreaks('text-wrap-spaces', 3);
    if (n === undefined || v === null || c === null) throw new Error('no text-wrap-spaces data');
    const shifted = { ...v, texts: v.texts.map((t, i) => (i === 0 ? { ...t, lines: [[0, 2], ...t.lines.slice(1)] as const } : t)) };
    const r = compareVectorWithChrome(shifted as typeof v, c, leafTexts(n.programs.uikit.root));
    expect(r.problems.map((p) => p.kind)).toEqual([BREAK_MISMATCH]);
    expect(r.problems[0]?.detail).toMatch(/^w1:text0: engine lines \[\[0,2\],\[3,6\],\[6,8\]\], Chrome \[\[0,3\],\[3,6\],\[6,8\]\]$/);
  });
});

describe('the break check of a dump', () => {
  it('passes a dump carrying the break vector and catches break-shifted as break-mismatch', () => {
    const v = readBreakVector('text-wrap-spaces', 3);
    const d = relabelledReferenceDumps('ios', 3).find((x) => x.case.id === 'text-wrap-spaces');
    if (v === null || d === undefined) throw new Error('no text-wrap-spaces data');
    const lines = new Map(v.texts.map((t) => [t.id, t.lines]));
    const dump = { ...d, nodes: d.nodes.map((x) => ({ ...x, lines: x.lines.map((l, j) => ({ ...l, start: lines.get(x.id)?.[j]?.[0] ?? null, end: lines.get(x.id)?.[j]?.[1] ?? null })) })) };
    expect(checkDumpBreaks(dump, v).problems).toEqual([]);
    expect(checkDumpBreaks(dump, v).compared).toBe(v.texts.reduce((k, t) => k + t.lines.length, 0));
    const planted = plantDumpFault('break-shifted', dump, { engine: [], passingSamples: [] });
    expect(planted).not.toBeNull();
    const r = checkDumpBreaks(planted ?? dump, v);
    expect(r.problems.map((p) => p.kind)).toEqual([BREAK_MISMATCH]);
    expect(r.problems[0]?.detail).toMatch(/^w1:text0: device lines \[\[0,2\],\[2,6\],\[6,8\]\], break vector \[\[0,3\],\[3,6\],\[6,8\]\]$/);
  });
});
