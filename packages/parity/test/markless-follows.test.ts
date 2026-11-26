// REPL-r2a on the device: a Markless page whose img has a src set at run time and a height that follows its image. The export
// marks it (runtime-image follows), and the device function (harness.ts runMarklessLayout) lays the page out again with each
// decoded image's natural size, moving only block positions.
import { describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { marklessStyleExport } from '../src/markless-style-input.ts';

const { runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };

// The checkin /checkins/[id] shape: a 100% wide photo with a max-height, and a box below it.
const PAGE = JSON.stringify({
  version: 'markless.native-style-input/0',
  component: 'Detail',
  css: 'main { display: block; margin: 0; } img { display: block; width: 100%; max-height: 320px; object-fit: cover; } .below { height: 40px; }',
  states: [],
  nodes: [
    { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
    { kind: 'element', id: 'h1', element: 'img', parent: 'h0', attributes: { alt: '' }, runtimeSrc: { absent: false } },
    { kind: 'element', id: 'h2', element: 'div', parent: 'h0', attributes: { class: 'below' } },
  ],
});
const AT = { viewport: { width: 402, height: 778 }, dpr: 3 };

describe('REPL-r2a: a Markless img that follows its image', () => {
  const exported = marklessStyleExport(PAGE, 'follows.native-style-input.json', undefined, 'system', { ios: AT, android: AT }, true).exported;
  const t = exported.targets.ios!;
  const names = new Map(t.planNames?.[0] ?? []);
  const frames = (naturals: string | null): Map<string, number[]> | string => {
    const line = `{"assignment":0,"dpr":3,"viewport":{"width":402,"height":778},"safeArea":{"top":0,"right":0,"bottom":0,"left":0},"plan":${JSON.stringify(t.plan)}${naturals === null ? '' : `,"naturals":${naturals}`}}`;
    const out = JSON.parse(runMarklessLayout(line)) as unknown[];
    if (out[0] !== 'ok') return String(out[1]);
    return new Map((out[2] as unknown[][]).map((n) => [names.get(n[0] as string) ?? (n[0] as string), ((n[1] as string[]) ?? []).map((v) => hexBits(v))]));
  };
  const imgId = [...names].find(([, v]) => v === 'h1')?.[0] ?? 'h1';

  it('is exported as following its image', () => {
    expect(JSON.stringify(t)).toContain('"follows":true');
  });

  it('lays out at 0 by 0 while loading, then follows each image, moving the box below it', () => {
    const loading = frames(null);
    if (typeof loading === 'string') throw new Error(loading);
    expect(loading.get('h1')?.[3]).toBe(0);
    expect(frames(`{"${imgId}":null}`)).toEqual(loading);
    const landscape = frames(`{"${imgId}":[4000,3000]}`);
    const portrait = frames(`{"${imgId}":[3000,4000]}`);
    if (typeof landscape === 'string' || typeof portrait === 'string') throw new Error(String(landscape));
    // Frames are in device px (3x): 402 CSS px wide, 4000x3000 gives 301.5 CSS px, a portrait image clamps at 320.
    expect(landscape.get('h1')?.slice(2)).toEqual([1206, 904.5]);
    expect(portrait.get('h1')?.slice(2)).toEqual([1206, 960]);
    expect(landscape.get('h2')?.[1]).toBe(904.5);
    expect(landscape.get('h2')?.[2]).toBe(loading.get('h2')?.[2]);
  });

  it('refuses a natural size for an id that does not follow its image', () => {
    expect(frames('{"nope":[1,1]}')).toMatch(/not an img of the plan that follows its image/);
  });
});

// An abspos box whose width follows its containing block's height, which the img sets: the build sweep refuses it, and with that
// comparison planted off (runtimeFollowsWidthUnchecked) only the device's check against the 0 by 0 layout stops it.
const ABSPOS = JSON.stringify({
  version: 'markless.native-style-input/0',
  component: 'Detail',
  css: 'main { display: block; margin: 0; position: relative; } img { display: block; width: 100%; max-height: 320px; } .ab { position: absolute; top: 0; bottom: 0; left: 0; aspect-ratio: 1 / 1; }',
  states: [],
  nodes: [
    { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
    { kind: 'element', id: 'h1', element: 'img', parent: 'h0', attributes: { alt: '' }, runtimeSrc: { absent: false } },
    { kind: 'element', id: 'h2', element: 'div', parent: 'h0', attributes: { class: 'ab' } },
  ],
});

describe('REPL-r2a ruling 1(c): the device stops a layout whose image moves a box inline', () => {
  const AT2 = { ios: AT, android: AT };
  it('the build refuses the page, naming the box', () => {
    expect(() => marklessStyleExport(ABSPOS, 'abspos.native-style-input.json', undefined, 'system', AT2, true)).toThrow(/its image changes the inline size or position of h2/);
  });
  const t = marklessStyleExport(ABSPOS, 'abspos.native-style-input.json', undefined, 'system', AT2, true, { ...NO_FAULTS, runtimeFollowsWidthUnchecked: true }).exported.targets.ios!;
  const names = new Map(t.planNames?.[0] ?? []);
  const imgId = [...names].find(([, v]) => v === 'h1')?.[0] ?? 'h1';
  const run = (natural: readonly number[], faults = NO_ENGINE_FAULTS): unknown[] =>
    JSON.parse(runMarklessLayout(`{"assignment":0,"dpr":3,"viewport":{"width":402,"height":778},"safeArea":{"top":0,"right":0,"bottom":0,"left":0},"plan":${JSON.stringify(t.plan)},"naturals":{"${imgId}":${JSON.stringify(natural)}},"faults":${JSON.stringify(faults)}}`)) as unknown[];

  it('under runtimeFollowsWidthUnchecked it compiles, and the device stops at its first image', () => {
    expect(JSON.stringify(t)).toContain('"follows":true');
    expect(run([4000, 3000])).toEqual(['harness-error', expect.stringMatching(/^an image that follows its image changes the inline size or position of \S+ \(runtime-image-size\)$/)]);
  });
  it('and lays it out, its box widened, under runtimeFollowsDeviceCheckSkipped too', () => {
    expect(run([4000, 3000], { ...NO_ENGINE_FAULTS, runtimeFollowsDeviceCheckSkipped: true })[0]).toBe('ok');
  });
});
