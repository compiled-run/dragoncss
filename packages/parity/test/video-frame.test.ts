// MEDIA-EL slice 2: the two-tone streams the lanes sample a video's first frame from (videos/two-tone.ts). Each is an MP4 the
// compiler reads at its frame size, its frame reads back exactly as written, every other stream is refused, and the
// replaced-video-frame fixture holds only these streams, so its frame points are on content the sample rules know.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMp4 } from '../../dragon/src/videos/mp4.ts';
import { decodeTwoTone, FIXTURE_STREAMS, mp4DataUrl, TWO_TONE_LUMA, twoToneMp4 } from '../src/videos/two-tone.ts';
import { repoPath } from '../src/paths.ts';
import type { DeviceEvidence } from '../src/profile-rows.ts';
import { deriveVideoRows, VIDEO_FRAME_CASES } from '../src/profile-rows.ts';
import { PROFILE_NOTES, VIDEO_CONTEXT, VIDEO_STREAM_FEATURE } from 'dragon';

const tone = (img: { width: number; data: Uint8Array }, x: number, y: number): number[] => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('MEDIA-EL slice 2: two-tone streams', () => {
  it('writes an MP4 the compiler reads at its frame size, whose frame reads back sample for sample', () => {
    const white = (x: number, y: number): boolean => (x * 7 + y * 3) % 5 < 2;
    const b = twoToneMp4(48, 32, white);
    expect(parseMp4(b)).toEqual({ ok: true, facts: { width: 48, height: 32, profile: 66, untagged: null } });
    const f = decodeTwoTone(b);
    expect([f.width, f.height]).toEqual([48, 32]);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) expect(tone(f, x, y), `${x},${y}`).toEqual(white(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  });

  it('stores luma clear of both ends of the limited range, never 0, and refuses a frame size off the macroblock grid', () => {
    expect(TWO_TONE_LUMA.black).toBeGreaterThan(0);
    expect(TWO_TONE_LUMA.black).toBeLessThanOrEqual(16);
    expect(TWO_TONE_LUMA.white).toBeGreaterThanOrEqual(235);
    expect(() => twoToneMp4(50, 32, () => true)).toThrow('a two-tone frame is whole macroblocks, not 50x32');
  });

  it('refuses a stream it did not write: an x264 stream of the replaced-video fixture, a truncated one', () => {
    const html = readFileSync(repoPath('packages/parity/fixtures/replaced-video.html'), 'utf8');
    const x264 = /src="data:video\/mp4;base64,([^"]+)"/.exec(html)?.[1];
    if (x264 === undefined) throw new Error('replaced-video has no stream');
    expect(() => decodeTwoTone(new Uint8Array(Buffer.from(x264, 'base64')))).toThrow(/^not a two-tone stream: /);
    const b = FIXTURE_STREAMS['quadrant'] as Uint8Array;
    expect(() => decodeTwoTone(b.subarray(0, b.length - 200))).toThrow();
  });

  it('gives the fixture streams frames no flip or turn maps onto themselves', () => {
    const q = decodeTwoTone(FIXTURE_STREAMS['quadrant'] as Uint8Array);
    expect([q.width, q.height, tone(q, 0, 0)[0], tone(q, 63, 0)[0], tone(q, 0, 47)[0], tone(q, 63, 47)[0]]).toEqual([64, 48, 255, 0, 0, 0]);
    const t = decodeTwoTone(FIXTURE_STREAMS['third'] as Uint8Array);
    expect([t.width, t.height, tone(t, 15, 0)[0], tone(t, 16, 0)[0], tone(t, 47, 31)[0]]).toEqual([48, 32, 255, 0, 0]);
  });

  it('replaced-video-frame holds only the fixture streams, both of them', () => {
    const html = readFileSync(repoPath('packages/parity/fixtures/replaced-video-frame.html'), 'utf8');
    const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1] as string);
    const known = new Map(Object.entries(FIXTURE_STREAMS).map(([name, b]) => [mp4DataUrl(b), name]));
    expect(srcs.filter((s) => !known.has(s))).toEqual([]);
    expect(new Set(srcs.map((s) => known.get(s)))).toEqual(new Set(['quadrant', 'third']));
  });
});

describe('MEDIA-EL slice 2: the native video row', () => {
  const lane = (name: string, cases: readonly string[], failing: readonly string[] = []) => ({ lane: name, perCase: true, passed: failing.length === 0, cases: new Set(cases), failing: new Set(failing) });
  const ev = (lanes: DeviceEvidence['lanes'], unavailable: string | null = null): DeviceEvidence => ({ target: 'android', unavailable, lanes });
  const all = [...VIDEO_FRAME_CASES];

  it('is a caveat through device-pixels when both frame cases pass every per-case device lane at every DPR', () => {
    expect(deriveVideoRows('android', ev([lane('device-frames', all), lane('device-pixels', all)]))).toEqual([{
      feature: VIDEO_STREAM_FEATURE, context: VIDEO_CONTEXT, status: 'caveat', note: PROFILE_NOTES.untaggedVideoColour,
      proofs: [{ aspect: 'layout', lane: 'device-pixels', valueSubset: 'video[src]', context: VIDEO_CONTEXT, cases: all }],
    }]);
  });

  it('is absent when a frame case fails or was not run, the record is unavailable or missing, and on web', () => {
    expect(deriveVideoRows('android', ev([lane('device-pixels', all, ['replaced-video-frame'])]))).toEqual([]);
    expect(deriveVideoRows('android', ev([lane('device-pixels', ['replaced-video-frame'])]))).toEqual([]);
    expect(deriveVideoRows('android', ev([lane('device-pixels', all)], 'android device-pixels did not run'))).toEqual([]);
    expect(deriveVideoRows('ios', null)).toEqual([]);
    expect(deriveVideoRows('web', ev([lane('device-pixels', all)]))).toEqual([]);
  });
});
