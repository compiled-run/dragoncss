// Compares the media module with the Chrome capture: mediaText, matchMedia at every viewport and root, and the band partition.
import { band, bandAt, evaluateMediaQueryList, parseMediaQueryList, serialiseMediaQueryList } from '../../src/media/index.ts';
import type { MediaFaults } from '../../src/media/index.ts';
import { chromeNumber } from './chrome-number.ts';
import { CORPUS } from './corpus.ts';
import type { Capture } from './corpus.ts';

export type Mismatch = { readonly kind: 'mediaText' | 'matches' | 'band'; readonly subject: string; readonly detail: string };

export type Comparison = { readonly comparisons: number; readonly mismatches: readonly Mismatch[]; readonly refused: readonly string[] };

export function compareCapture(capture: Capture, faults: MediaFaults): Comparison {
  const mismatches: Mismatch[] = [];
  const refused: string[] = [];
  let comparisons = 0;
  const expect = (ok: boolean, m: Mismatch): void => {
    comparisons++;
    if (!ok) mismatches.push(m);
  };

  for (const q of capture.queries) {
    const list = parseMediaQueryList(q.query, faults);
    const text = serialiseMediaQueryList(list, chromeNumber);
    expect(text === q.mediaText, { kind: 'mediaText', subject: q.query, detail: `${JSON.stringify(text)} != Chrome ${JSON.stringify(q.mediaText)}` });
    let isRefused = false;
    for (const root of capture.roots) {
      const bits = q.matches[String(root)] as string;
      capture.points.forEach(([width, height], k) => {
        const r = evaluateMediaQueryList(list, { width, height, rootFontSize: root }, faults);
        if (r.kind === 'refused') {
          isRefused = true;
          return;
        }
        const chrome = bits[k] === '1';
        expect(r.matches === chrome, { kind: 'matches', subject: q.query, detail: `${width}x${height} root ${root}px: ${r.matches} != Chrome ${chrome}` });
      });
    }
    if (isRefused) refused.push(q.query);
  }

  for (const captured of capture.bands) {
    const sheet = CORPUS.bandSheets.find((s) => s.name === captured.sheet);
    if (sheet === undefined) throw new Error(`capture has an unknown band sheet ${captured.sheet}`);
    const partition = band(sheet.queries.map((q) => parseMediaQueryList(q, faults)), faults);
    comparisons++;
    if (partition.kind !== 'bands') {
      mismatches.push({ kind: 'band', subject: sheet.name, detail: `refused: ${partition.detail}` });
      continue;
    }
    const texts = partition.bands.map((b) => b.condition);
    const capturedTexts = captured.conditions.map((c) => c.text);
    expect(JSON.stringify(texts) === JSON.stringify(capturedTexts), { kind: 'band', subject: sheet.name, detail: `conditions ${JSON.stringify(texts)} != captured ${JSON.stringify(capturedTexts)}` });
    for (const c of captured.conditions) {
      const text = serialiseMediaQueryList(parseMediaQueryList(c.text, faults), chromeNumber);
      expect(text === c.mediaText && c.mediaText !== 'not all', { kind: 'band', subject: `${sheet.name} ${c.text}`, detail: `mediaText ${text} != Chrome ${c.mediaText}` });
    }
    for (const root of capture.roots) {
      capture.points.forEach(([width, height], k) => {
        const chrome = captured.conditions.flatMap((c, i) => (c.matches[String(root)]?.[k] === '1' ? [i] : []));
        const ours = bandAt(partition, { width, height });
        const want = ours === null ? [] : [ours.index];
        expect(JSON.stringify(chrome) === JSON.stringify(want), { kind: 'band', subject: sheet.name, detail: `${width}x${height} root ${root}px: band ${JSON.stringify(want)} != Chrome ${JSON.stringify(chrome)}` });
      });
      // Every band holds a captured viewport, where Chrome matches that band's condition and no other.
      for (const b of partition.bands) {
        const inside = capture.points.flatMap(([width, height], k) => (bandAt(partition, { width, height })?.index === b.index ? [k] : []));
        const exact = inside.filter((k) => JSON.stringify(captured.conditions.flatMap((c, i) => (c.matches[String(root)]?.[k] === '1' ? [i] : []))) === JSON.stringify([b.index]));
        expect(inside.length > 0 && exact.length === inside.length, {
          kind: 'band',
          subject: `${sheet.name} band ${b.index}`,
          detail: `root ${root}px: ${inside.length} captured viewports inside, ${exact.length} where Chrome matches only this band`,
        });
      }
    }
  }
  return { comparisons, mismatches, refused };
}
