// MQ-R0 (notes/T067 R3, R4): the native fold of every committed media fixture is resolved at the nominal 400x300 viewport, while
// Chrome's emulated frame at a device DPR is ceil(css px x DPR) device px. The guard proves no fixture changes band between the two;
// the totality test proves every whole device-px size at every DPR lies in exactly one band, whose truths equal direct evaluation.
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import { band, bandAt, emulatedMediaViewport, evaluateFeature, mediaSize, NO_MEDIA_FAULTS, parseMediaQueryList } from '../src/media/index.ts';
import type { BandPartition, MediaFaults } from '../src/media/index.ts';

/** Parity's fixture viewport (packages/parity/src/fixtures.ts ENVIRONMENT) and the DPRs of the host and the device matrix. */
const NOMINAL = { width: 400, height: 300 } as const;
const DPRS = [1, 2, 2.625, 3] as const;
const FIXTURES = new URL('../../parity/fixtures/', import.meta.url);
const NORTH_STAR = new URL('../../../examples/music-player/styles.css', import.meta.url);

type Partition = Extract<BandPartition, { kind: 'bands' }>;

/** The @media preludes of a stylesheet, nested ones included. */
function preludes(css: string): string[] {
  const out: string[] = [];
  const children = (node: CssNode | null | undefined): CssNode[] => {
    const c = node?.['children'] as { toArray(): CssNode[] } | null | undefined;
    return c === null || c === undefined ? [] : c.toArray();
  };
  const visit = (node: CssNode): void => {
    if (node.type === 'Atrule' && String(node['name']).toLowerCase() === 'media') {
      const loc = (node['prelude'] as CssNode | null | undefined)?.loc;
      out.push(loc === null || loc === undefined ? '' : css.slice(loc.start.offset, loc.end.offset));
    }
    for (const c of [...children(node), ...children(node['block'] as CssNode | null | undefined)]) visit(c);
  };
  visit(parse(css, { positions: true }));
  return out;
}

/** Every committed sheet with @media that band() partitions: the layout fixtures' style blocks and the north star. */
function sheets(faults: MediaFaults = NO_MEDIA_FAULTS): { readonly name: string; readonly partition: Partition }[] {
  const out: { name: string; partition: Partition }[] = [];
  const add = (name: string, css: string): void => {
    const lists = preludes(css).map((p) => parseMediaQueryList(p));
    if (lists.length === 0) return;
    const p = band(lists, faults);
    // A refused partition never reaches a fold (the compiler refuses the sheet); the reject fixtures are those.
    if (p.kind === 'bands') out.push({ name, partition: p });
  };
  for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith('.html')).sort()) {
    const html = readFileSync(new URL(f, FIXTURES), 'utf8');
    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] as string).join('\n');
    if (css.includes('@media')) add(f, css);
  }
  add('north-star', readFileSync(NORTH_STAR, 'utf8'));
  return out;
}

const SHEETS = sheets();

/** Whether a partition maps every whole device-px size in [0, max]^2 at a DPR to one band whose truths equal direct evaluation. */
function totality(p: Partition, dpr: number, max: number, faults: MediaFaults = NO_MEDIA_FAULTS): string | null {
  const sizes = Array.from({ length: max + 1 }, (_, px) => mediaSize(px, dpr));
  const ratio = p.atoms.some((a) => a.axis === 'ratio');
  const truths = (v: { width: number; height: number }): string => p.atoms.map((a) => (evaluateFeature(a.feature, v, faults) ? '1' : '0')).join('');
  const check = (width: number, height: number): string | null => {
    const v = { width, height };
    const b = bandAt(p, v, faults);
    if (b === null) return `${width}x${height} at DPR ${dpr} is in no band`;
    const want = truths(v);
    return b.truth.map((t) => (t ? '1' : '0')).join('') === want ? null : `${width}x${height} at DPR ${dpr}: band ${b.index} is not ${want}`;
  };
  if (!ratio) {
    // Width and height atoms read one axis each, so the axes are checked apart, against a fixed size on the other.
    for (const w of sizes) {
      const e = check(w, sizes[0] as number);
      if (e !== null) return e;
    }
    for (const h of sizes) {
      const e = check(sizes[0] as number, h);
      if (e !== null) return e;
    }
    return null;
  }
  for (const w of sizes) {
    for (const h of sizes) {
      const e = check(w, h);
      if (e !== null) return e;
    }
  }
  return null;
}

describe('MQ-R0: the R3 guard', () => {
  it('reads the committed media fixtures and the north star', () => {
    expect(SHEETS.map((s) => s.name)).toEqual(expect.arrayContaining(['media-max-width.html', 'media-two-axis.html', 'media-orientation.html', 'media-aspect-ratio.html', 'media-epsilon.html', 'north-star']));
  });

  it.each(DPRS)('no committed fixture changes band between 400x300 and Chrome\'s emulated frame at DPR %s', (dpr) => {
    const emulated = emulatedMediaViewport(NOMINAL, dpr);
    const moved = SHEETS.filter((s) => bandAt(s.partition, NOMINAL)?.index !== bandAt(s.partition, emulated)?.index).map((s) => s.name);
    expect(moved).toEqual([]);
  });

  it('the guard sees the 300.19 px height: a height atom at 300 would move between them at DPR 2.625', () => {
    const p = band([parseMediaQueryList('(max-height: 300px)')]);
    if (p.kind !== 'bands') throw new Error(p.detail);
    expect(emulatedMediaViewport(NOMINAL, 2.625).height).toBeGreaterThan(300 + 1 / 64);
    expect(bandAt(p, NOMINAL)?.index).not.toBe(bandAt(p, emulatedMediaViewport(NOMINAL, 2.625))?.index);
    expect(bandAt(p, NOMINAL)?.index).toBe(bandAt(p, emulatedMediaViewport(NOMINAL, 3))?.index);
  });
});

describe('MQ-R0: R4 totality over whole device px', () => {
  it.each(DPRS)('every size in [0, 2048] device px at DPR %s lies in one band of every sheet, with the band\'s truths', (dpr) => {
    const problems = SHEETS.flatMap((s) => {
      const e = totality(s.partition, dpr, 2048);
      return e === null ? [] : [`${s.name}: ${e}`];
    });
    expect(problems).toEqual([]);
  }, 120_000);

  it('bandGapAtBoundary leaves a whole size of a committed sheet in no band', () => {
    const faults = { ...NO_MEDIA_FAULTS, bandGapAtBoundary: true };
    const gaps = sheets(faults).flatMap((s) => {
      const e = totality(s.partition, 1, 2048, faults);
      return e !== null && /is in no band/.test(e) ? [s.name] : [];
    });
    expect(gaps.length).toBeGreaterThan(0);
  });
});
