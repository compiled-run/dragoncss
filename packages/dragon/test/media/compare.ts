// Compares the media module with the Chrome capture: mediaText, matchMedia at every viewport and root, and the band partition;
// then the same at every fractional frame (MQ-R0), where each frame's media size is Chrome's float value (R3).
import { band, bandAt, DESKTOP_DEVICE, emulatedMediaViewport, evaluateMediaQueryList, mediaViewport, parseMediaQueryList, serialiseMediaQueryList, TOUCH_DEVICE } from '../../src/media/index.ts';
import type { MediaDevice, MediaFaults } from '../../src/media/index.ts';
import { chromeNumber } from './chrome-number.ts';
import { CORPUS } from './corpus.ts';
import type { Capture, EnvDevice, FrameKind } from './corpus.ts';

type Viewport = { readonly width: number; readonly height: number };

/** The media viewport Chrome evaluates in a captured frame: an iframe of whole device px, or an emulated main frame. */
export function frameViewport(frame: readonly [FrameKind, number, number, number], faults: MediaFaults): Viewport {
  const [kind, width, height, dpr] = frame;
  if (kind === 'iframe') return mediaViewport({ width, height }, dpr, faults);
  if (kind === 'main') return emulatedMediaViewport({ width, height }, dpr, faults);
  throw new Error(`unknown frame kind ${String(kind)}`);
}

const label = (frame: readonly [FrameKind, number, number, number]): string => `${frame[0]} ${frame[1]}x${frame[2]} at DPR ${frame[3]}`;

export type Mismatch = { readonly kind: 'mediaText' | 'matches' | 'band'; readonly subject: string; readonly detail: string; readonly fractional?: true };

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
  compareFractional(capture, faults, (ok, m) => expect(ok, { ...m, fractional: true }), refused);
  compareEnvironment(capture, faults, expect, refused);
  return { comparisons, mismatches, refused };
}

/** The readings of a captured device (M7): a desktop page has a mouse, a touch or mobile page a touch screen alone. */
export function deviceOf([dpr, kind, reducedMotion]: EnvDevice): MediaDevice {
  return { ...(kind === 'desktop' ? DESKTOP_DEVICE : TOUCH_DEVICE), dpr, reducedMotion };
}

/** MQ-R2: every environment row and band on every captured device. */
function compareEnvironment(capture: Capture, faults: MediaFaults, expect: (ok: boolean, m: Mismatch) => void, refused: string[]): void {
  const { devices } = capture.environment;
  const label = (d: EnvDevice): string => `${d[1]} DPR ${d[0]} ${d[2]}`;
  const bitsOf = (subject: string, matches: string): string => {
    if (matches.length !== devices.length || /[^01]/.test(matches)) throw new Error(`${subject}: ${matches.length} match bits for ${devices.length} devices`);
    return matches;
  };
  for (const q of capture.environment.queries) {
    const list = parseMediaQueryList(q.query, faults);
    const text = serialiseMediaQueryList(list, chromeNumber);
    expect(text === q.mediaText, { kind: 'mediaText', subject: q.query, detail: `${JSON.stringify(text)} != Chrome ${JSON.stringify(q.mediaText)}` });
    const bits = bitsOf(q.query, q.matches);
    devices.forEach((d, k) => {
      const r = evaluateMediaQueryList(list, { ...CORPUS.environment.viewport, device: deviceOf(d) }, faults);
      if (r.kind === 'refused') {
        if (!refused.includes(q.query)) refused.push(q.query);
        return;
      }
      const chrome = bits[k] === '1';
      expect(r.matches === chrome, { kind: 'matches', subject: q.query, detail: `${label(d)}: ${r.matches} != Chrome ${chrome}` });
    });
  }
  for (const captured of capture.environment.bands) {
    const sheet = CORPUS.environment.bandSheets.find((s) => s.name === captured.sheet);
    if (sheet === undefined) throw new Error(`capture has an unknown environment band sheet ${captured.sheet}`);
    const partition = band(sheet.queries.map((q) => parseMediaQueryList(q, faults)), faults);
    if (partition.kind !== 'bands') {
      expect(false, { kind: 'band', subject: sheet.name, detail: `refused: ${partition.detail}` });
      continue;
    }
    expect(JSON.stringify(partition.bands.map((b) => b.condition)) === JSON.stringify(captured.conditions.map((c) => c.text)), { kind: 'band', subject: sheet.name, detail: 'conditions differ from the captured ones' });
    for (const c of captured.conditions) {
      const text = serialiseMediaQueryList(parseMediaQueryList(c.text, faults), chromeNumber);
      expect(text === c.mediaText && c.mediaText !== 'not all', { kind: 'band', subject: `${sheet.name} ${c.text}`, detail: `mediaText ${text} != Chrome ${c.mediaText}` });
    }
    const chromeAt = (k: number): number[] => captured.conditions.flatMap((c, i) => (bitsOf(c.text, c.matches)[k] === '1' ? [i] : []));
    const ours = devices.map((d) => bandAt(partition, CORPUS.environment.viewport, faults, deviceOf(d))?.index ?? null);
    devices.forEach((d, k) => {
      const want = ours[k] === null ? [] : [ours[k]];
      expect(JSON.stringify(chromeAt(k)) === JSON.stringify(want), { kind: 'band', subject: sheet.name, detail: `${label(d)}: band ${JSON.stringify(want)} != Chrome ${JSON.stringify(chromeAt(k))}` });
    });
    // Every band holds a captured device, unless the sheet names why Chrome cannot emulate one; then at least one band is unreached.
    const unreached = partition.bands.filter((b) => !ours.includes(b.index));
    expect(sheet.unreachable === undefined ? unreached.length === 0 : unreached.length > 0, {
      kind: 'band',
      subject: sheet.name,
      detail: sheet.unreachable === undefined ? `bands ${unreached.map((b) => b.index).join(', ')} hold no captured device` : `every band holds a captured device, but the sheet says ${sheet.unreachable}`,
    });
  }
}

function compareFractional(capture: Capture, faults: MediaFaults, expect: (ok: boolean, m: Mismatch) => void, refused: string[]): void {
  const { frames } = capture.fractional;
  const viewports = frames.map((f) => frameViewport(f, faults));
  const bitsOf = (subject: string, matches: string): string => {
    if (matches.length !== frames.length || /[^01]/.test(matches)) throw new Error(`${subject}: ${matches.length} match bits for ${frames.length} frames`);
    return matches;
  };
  for (const q of capture.fractional.queries) {
    const list = parseMediaQueryList(q.query, faults);
    const text = serialiseMediaQueryList(list, chromeNumber);
    expect(text === q.mediaText, { kind: 'mediaText', subject: q.query, detail: `${JSON.stringify(text)} != Chrome ${JSON.stringify(q.mediaText)}` });
    const bits = bitsOf(q.query, q.matches);
    viewports.forEach((v, k) => {
      const r = evaluateMediaQueryList(list, { ...v, rootFontSize: 16 }, faults);
      if (r.kind === 'refused') {
        if (!refused.includes(q.query)) refused.push(q.query);
        return;
      }
      const chrome = bits[k] === '1';
      expect(r.matches === chrome, { kind: 'matches', subject: q.query, detail: `${label(frames[k] as Capture['fractional']['frames'][number])} (${v.width}x${v.height}): ${r.matches} != Chrome ${chrome}` });
    });
  }
  for (const captured of capture.fractional.bands) {
    const sheet = CORPUS.fractional.bandSheets.find((s) => s.name === captured.sheet);
    if (sheet === undefined) throw new Error(`capture has an unknown fractional band sheet ${captured.sheet}`);
    const partition = band(sheet.queries.map((q) => parseMediaQueryList(q, faults)), faults);
    if (partition.kind !== 'bands') {
      expect(false, { kind: 'band', subject: sheet.name, detail: `refused: ${partition.detail}` });
      continue;
    }
    const texts = partition.bands.map((b) => b.condition);
    expect(JSON.stringify(texts) === JSON.stringify(captured.conditions.map((c) => c.text)), { kind: 'band', subject: sheet.name, detail: `conditions ${JSON.stringify(texts)} != captured` });
    for (const c of captured.conditions) {
      const text = serialiseMediaQueryList(parseMediaQueryList(c.text, faults), chromeNumber);
      expect(text === c.mediaText && c.mediaText !== 'not all', { kind: 'band', subject: `${sheet.name} ${c.text}`, detail: `mediaText ${text} != Chrome ${c.mediaText}` });
    }
    const chromeAt = (k: number): number[] => captured.conditions.flatMap((c, i) => (bitsOf(c.text, c.matches)[k] === '1' ? [i] : []));
    const ours = viewports.map((v) => bandAt(partition, v, faults)?.index ?? null);
    viewports.forEach((v, k) => {
      const want = ours[k] === null ? [] : [ours[k]];
      expect(JSON.stringify(chromeAt(k)) === JSON.stringify(want), { kind: 'band', subject: sheet.name, detail: `${label(frames[k] as Capture['fractional']['frames'][number])} (${v.width}x${v.height}): band ${JSON.stringify(want)} != Chrome ${JSON.stringify(chromeAt(k))}` });
    });
    // Every band holds a captured frame, where Chrome matches that band's condition and no other.
    for (const b of partition.bands) {
      const inside = ours.flatMap((o, k) => (o === b.index ? [k] : []));
      const exact = inside.filter((k) => JSON.stringify(chromeAt(k)) === JSON.stringify([b.index]));
      expect(inside.length > 0 && exact.length === inside.length, { kind: 'band', subject: `${sheet.name} band ${b.index}`, detail: `${inside.length} captured frames inside, ${exact.length} where Chrome matches only this band` });
    }
  }
}
