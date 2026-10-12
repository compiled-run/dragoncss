// P4 item 4 (notes/T013-p3-review-p4-plan.md section 2): expected dumps per backend and device DPR from the program alone. Colours
// are RGBA8; border widths come from the engine at the device scale (initial widths are 3 device px, R5); the clip is the padding
// box; both backends cover the same CSS longhands on every node; the digest is the sha256 of the canonical expected dump.
import { describe, expect, it } from 'vitest';
import type { LU } from '@dragon/layout';
import { layout, LU_PER_PX, measurerFor, NO_ENGINE_FAULTS, opacityAlpha8, outlineOffsetPx, outlineRings, outlineWidthPx, platformFontSize, replacedPaint, resolveBorder, resolvePadding, roundedShape, scrollRanges, snapEdges, zoomFontSize, zoomInput } from '@dragon/layout';
import type { ExpectedEngine } from '../src/internal.ts';
import { appliedKeyMap, createProjectWith, cssCoverage, expectedDigest, expectedDump, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const CSS = 'body { margin: 0; color: navy; } .long { width: 50px; height: 20px; border-style: solid; border-top-color: gold; } .thin { border: 0.5px solid red; width: 10px; } .clip { overflow: hidden; border: 2px solid; padding: 3px; height: 10px; }';
const input = inputFor(CSS, (r) => [div(r, 'long', ['long']), div(r, 'thin', ['thin']), div(r, 'clip', ['clip'], [div(r, 'kid', [])])]);
const m = measurerFor('darwin-arm64');
if (m.kind !== 'ok') throw new Error(m.code);
const VIEW = { width: 400, height: 300 };
const engine: ExpectedEngine = { layout, measurer: m.measurer, snapEdges, zoomInput, noFaults: NO_ENGINE_FAULTS, resolveBorder, resolvePadding: (st, cb) => resolvePadding(st, cb as LU), replacedPaint, opacityAlpha8, luPerPx: LU_PER_PX, platformFontSize, zoomFontSize, float32: Math.fround, scrollRanges, paint: { roundedShape, outlineRings, outlineWidthPx, outlineOffsetPx } };

function programs() {
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('expected dumps', () => {
  it('initial border widths are 3 device px at every scale: 1 pt at scale 3 on iOS, 3 px on Android', () => {
    const p = programs();
    for (const dpr of [2, 3]) {
      const ios = expectedDump(p.uikit, 'c', VIEW, dpr, engine).nodes.find((n) => n.id === 'long');
      expect(ios?.applied['dragonBorder.widths']).toEqual([3 / dpr, 3 / dpr, 3 / dpr, 3 / dpr]);
    }
    for (const dpr of [2, 3, 2.625]) {
      const android = expectedDump(p['android-views'], 'c', VIEW, dpr, engine).nodes.find((n) => n.id === 'long');
      expect(android?.applied['dragonBorder.widthsPx']).toEqual([3, 3, 3, 3]);
    }
    expect(expectedDump(p.uikit, 'c', VIEW, 3, engine).nodes.find((n) => n.id === 'long')?.applied['dragonBorder.widths']).toEqual([1, 1, 1, 1]);
  });
  it('a 0.5px border is one device px (the engine snap helper): 1/3 pt at 3 and 1 px on Android at 2.625', () => {
    const p = programs();
    expect(expectedDump(p.uikit, 'c', VIEW, 3, engine).nodes.find((n) => n.id === 'thin')?.applied['dragonBorder.widths']).toEqual([1 / 3, 1 / 3, 1 / 3, 1 / 3]);
    expect(expectedDump(p['android-views'], 'c', VIEW, 2.625, engine).nodes.find((n) => n.id === 'thin')?.applied['dragonBorder.widthsPx']).toEqual([1, 1, 1, 1]);
  });
  it('colours are RGBA8 on both, the clip is the padding box, and the native classes are the backend\'s', () => {
    const p = programs();
    const ios = expectedDump(p.uikit, 'c', VIEW, 3, engine);
    const android = expectedDump(p['android-views'], 'c', VIEW, 3, engine);
    const iosLong = ios.nodes.find((n) => n.id === 'long');
    expect(iosLong?.applied['dragonBorder.colors']).toEqual([[255, 215, 0, 255], [0, 0, 128, 255], [0, 0, 128, 255], [0, 0, 128, 255]]);
    expect(android.nodes.find((n) => n.id === 'long')?.applied['dragonBorder.colors']).toEqual(iosLong?.applied['dragonBorder.colors']);
    expect(iosLong?.native).toBe('DragonBoxView');
    expect(android.nodes.find((n) => n.id === 'long')?.native).toBe('dev.dragon.views.DragonBoxView');
    // .clip at scale 3: 2px borders are 6 device px; the border box is 400 css px wide and 2+3+10+3+2 = 20 tall.
    expect(ios.nodes.find((n) => n.id === 'clip')?.applied['dragonClip.frame']).toEqual([2, 2, 396, 16]);
    expect(android.nodes.find((n) => n.id === 'clip')?.applied['dragonClip.clipBounds']).toEqual([6, 6, 1194, 54]);
  });
  it('ios and android cover identical CSS longhands on every node, and every applied key maps to longhands', () => {
    const p = programs();
    expect([...cssCoverage(p.uikit)]).toEqual([...cssCoverage(p['android-views'])]);
    expect([...appliedKeyMap(p.uikit).values()].every((c) => c.length > 0)).toBe(true);
  });
  it('the digest is deterministic and changes with the scale', () => {
    const p = programs();
    const a = expectedDigest(expectedDump(p.uikit, 'c', VIEW, 3, engine));
    expect(expectedDigest(expectedDump(p.uikit, 'c', VIEW, 3, engine))).toBe(a);
    expect(expectedDigest(expectedDump(p.uikit, 'c', VIEW, 2, engine))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('OVFL-B: the scroll range in the expected dump', () => {
  const scrolling = inputFor('body { margin: 0; } .s { overflow: auto; width: 50px; height: 20px; } .w { width: 200px; height: 10px; }', (r) => [div(r, 's', ['s'], [div(r, 'w', ['w'])]), div(r, 'h', [])]);
  const program = () => {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(scrolling);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs.uikit;
  };
  const refusing = (id: string): ExpectedEngine => ({ ...engine, scrollRanges: (i, mm) => {
    const r = scrollRanges(i, mm);
    if (r.kind !== 'ok') return r;
    return { kind: 'ok', ranges: r.ranges.filter((g) => g.id !== id), refused: [...r.refused, { id, nodeId: 'i', detail: 'an inline box (R16, INL1a)' }] };
  } });

  it('a scroll view reads the engine range in whole device px', () => {
    expect(expectedDump(program(), 'c', VIEW, 2, engine).nodes.find((n) => n.id === 's')?.applied['dragonScroll.range']).toEqual([0, 300, 0, 0]);
  });
  it('an engine refusal stops the dump only for a node that is a scroll view, naming the node and the reason', () => {
    expect(() => expectedDump(program(), 'c', VIEW, 2, refusing('s'))).toThrow('c@2: the engine refused the scroll range of s at i: an inline box (R16, INL1a)');
    expect(expectedDump(program(), 'c', VIEW, 2, refusing('h')).nodes.find((n) => n.id === 's')?.applied['dragonScroll.range']).toEqual([0, 300, 0, 0]);
  });
});
