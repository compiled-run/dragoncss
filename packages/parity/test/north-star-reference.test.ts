// The north-star device lane's Chrome reference (examples/music-player; notes/T010-north-star-plan.md, WP2 NS-REF), checked
// without Chrome: the case list is the manifest derivation, every capture file is present with its sha256, every PNG has the
// raster size, and the PNG cover stand-ins regenerate byte-identically from their dependency-free generator.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CHROME_VERSION, chromeArgsAt, PLAYWRIGHT_VERSION } from '../src/chrome.ts';
import { ZOOM_GUARD } from '../src/dpr.ts';
import { repoPath } from '../src/paths.ts';

// The example is its own TypeScript project, which this one does not reference; its modules are loaded at run time.
type FreeState = { readonly id: string };
type Platform = { readonly id: string; readonly viewport: { readonly width: number; readonly height: number }; readonly dprs: readonly number[] };
type LaneCase = { readonly id: string; readonly kind: 'state' | 'forced' | 'frame'; readonly forced: { readonly pseudo: string; readonly selector: string } | null };
type Capture = { readonly platform: Platform; readonly dpr: number; readonly case: LaneCase; readonly png: string; readonly dump: string };
type Font = { readonly familyName: string; readonly postScriptName: string; readonly isCustomFont: boolean };
type Manifest = {
  LANE_PLATFORMS: readonly Platform[];
  LANE_DPRS: readonly number[];
  LANE_MANIFEST_FILE: string;
  PIXEL_MANIFEST_FILE: string;
  DUMP_SCHEMA: string;
  PIXEL_SCHEMA: string;
  RASTER_RULE: { readonly rule: string };
  laneCases(css: string): readonly LaneCase[];
  laneCaptures(css: string): readonly Capture[];
  laneManifest(css: string): unknown;
  laneJson(value: unknown): string;
  forcedSubjects(css: string): readonly unknown[];
  rasterSize(css: number, dpr: number): number;
  pngSize(png: Uint8Array): { width: number; height: number };
  sha256(bytes: Uint8Array | string): string;
  fontKey(fonts: readonly Font[]): string;
};
type Covers = { COVER_IDS: readonly string[]; COVER_WIDTH: number; COVER_HEIGHT: number; coverFile(id: string): string; coverPng(id: string): Uint8Array; coverPixels(id: string): Uint8Array };
type Snapshot = { FREE_STATES: readonly FreeState[]; readSnapshot(): { html: string; css: string } };

const exampleDir = repoPath('examples/music-player');
const load = async <T,>(file: string): Promise<T> => (await import(pathToFileURL(join(exampleDir, file)).href)) as T;
const lane = await load<Manifest>('tools/lane-manifest.ts');
const covers = await load<Covers>('tools/cover-png.ts');
const snapshot = await load<Snapshot>('tools/snapshot.ts');
const { css } = snapshot.readSnapshot();
const read = (file: string): Buffer => readFileSync(join(exampleDir, file));

type PixelFile = { file: string; platform: string; dpr: number; case: string; kind: 'png' | 'dump'; sha256: string; bytes: number; width?: number; height?: number };
type PixelManifest = {
  schema: string;
  chrome: string;
  playwright: string;
  flags: Record<string, readonly string[]>;
  zoomGuard: Record<string, string>;
  rasterRule: { rule: string };
  fontKey: string;
  fonts: readonly Font[];
  covers: readonly { videoId: string; file: string; sha256: string; bytes: number; width: number; height: number }[];
  counts: Record<string, number>;
  files: readonly PixelFile[];
};
const pixels = JSON.parse(read(lane.PIXEL_MANIFEST_FILE).toString('utf8')) as PixelManifest;
const captures = lane.laneCaptures(css);
const cases = lane.laneCases(css);

type Dump = {
  schema: string;
  chrome: string;
  platform: string;
  dpr: number;
  case: string;
  forced: { target: string } | null;
  properties: readonly string[];
  fonts: Record<string, readonly Font[]>;
  elements: readonly { id: string; values: readonly string[] }[];
  texts: readonly { id: string; data: string; lines: readonly { start: number; end: number }[] }[];
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [relative(exampleDir, p)];
  });
}

describe('north-star lane manifest', () => {
  it('lane/manifest.json is the committed derivation', () => {
    expect(read(lane.LANE_MANIFEST_FILE).toString('utf8')).toBe(lane.laneJson(lane.laneManifest(css)));
  });

  it('cases: 4 free states x 2 scroll positions, one forced case per :hover/:focus subject, and the animation frames', () => {
    const count = (k: LaneCase['kind']): number => cases.filter((c) => c.kind === k).length;
    expect(count('state')).toBe(snapshot.FREE_STATES.length * 2);
    expect(snapshot.FREE_STATES.length).toBe(4);
    expect(count('forced')).toBe(lane.forcedSubjects(css).length);
    expect(cases.filter((c) => c.forced?.pseudo === 'hover').length).toBe(4);
    expect(cases.filter((c) => c.forced?.pseudo === 'focus').length).toBe(1);
    expect(count('frame')).toBe(7);
  });

  it('matrix: iOS 390x844 at 2 and 3; Android 412x915 at 2, 2.625 and 3', () => {
    expect(lane.LANE_PLATFORMS.map((p) => [p.id, p.viewport.width, p.viewport.height, [...p.dprs]])).toEqual([
      ['ios', 390, 844, [2, 3]],
      ['android', 412, 915, [2, 2.625, 3]],
    ]);
    expect(captures.length).toBe(5 * cases.length);
  });
});

describe('north-star Chrome reference', () => {
  it('pinned Chrome, the lane flags and the zoom guard at every DPR', () => {
    expect(pixels.schema).toBe(lane.PIXEL_SCHEMA);
    expect(pixels.chrome).toBe(CHROME_VERSION);
    expect(pixels.playwright).toBe(PLAYWRIGHT_VERSION);
    expect(Object.keys(pixels.flags).map(Number).sort()).toEqual([...lane.LANE_DPRS].sort());
    for (const d of lane.LANE_DPRS) {
      expect(pixels.flags[String(d)]).toEqual(chromeArgsAt(d));
      expect(pixels.zoomGuard[String(d)]).toBe(ZOOM_GUARD.get(d));
    }
  });

  it('counts per platform and DPR equal the manifest derivation', () => {
    const want: Record<string, number> = {};
    for (const c of captures) {
      const key = c.png.slice(0, c.png.lastIndexOf('/'));
      want[key] = (want[key] ?? 0) + 1;
    }
    expect(pixels.counts).toEqual(want);
    expect(Object.values(want).every((n) => n === cases.length)).toBe(true);
  });

  it('every capture file is listed, present and equal to its sha256; nothing else is under chrome/', () => {
    const want = captures.flatMap((c) => [c.png, c.dump]).sort();
    expect(pixels.files.map((f) => f.file).sort()).toEqual(want);
    expect(filesUnder(join(exampleDir, 'chrome')).sort()).toEqual([...want, lane.PIXEL_MANIFEST_FILE].sort());
    for (const f of pixels.files) {
      const bytes = read(f.file);
      expect(lane.sha256(bytes), f.file).toBe(f.sha256);
      expect(bytes.length, f.file).toBe(f.bytes);
    }
  });

  it('every PNG has the raster size ceil(css px x DPR), 1081.5 included', () => {
    expect(pixels.rasterRule.rule).toBe(lane.RASTER_RULE.rule);
    expect(lane.rasterSize(412, 2.625)).toBe(1082);
    for (const c of captures) {
      const size = lane.pngSize(read(c.png));
      expect(size, c.png).toEqual({ width: lane.rasterSize(c.platform.viewport.width, c.dpr), height: lane.rasterSize(c.platform.viewport.height, c.dpr) });
    }
  });

  it('dumps: case identity, forced targets, values per property, and line offsets partitioning each text node', () => {
    for (const c of captures) {
      const d = JSON.parse(read(c.dump).toString('utf8')) as Dump;
      expect([d.schema, d.chrome, d.platform, d.dpr, d.case]).toEqual([lane.DUMP_SCHEMA, CHROME_VERSION, c.platform.id, c.dpr, c.case.id]);
      if (c.case.forced === null) expect(d.forced).toBeNull();
      else expect(d.elements.map((e) => e.id)).toContain(d.forced?.target);
      for (const e of d.elements) expect(e.values.length).toBe(d.properties.length);
      expect(d.texts.length).toBeGreaterThan(0);
      for (const t of d.texts) {
        expect(t.lines.length, `${c.dump} ${t.id}`).toBeGreaterThan(0);
        expect(t.lines[0]?.start).toBe(0);
        expect(t.lines[t.lines.length - 1]?.end).toBe(t.data.length);
        t.lines.forEach((l, i) => {
          expect(l.end).toBeGreaterThan(l.start);
          if (i > 0) expect(l.start).toBe(t.lines[i - 1]?.end);
        });
      }
    }
  });

  it('font key: the sha256 of the distinct platform fonts, and every dump uses only those fonts', () => {
    expect(lane.fontKey(pixels.fonts)).toBe(pixels.fontKey);
    const known = new Set(pixels.fonts.map((f) => `${f.familyName}\t${f.postScriptName}\t${f.isCustomFont}`));
    for (const c of captures) {
      const d = JSON.parse(read(c.dump).toString('utf8')) as Dump;
      for (const f of Object.values(d.fonts).flat()) expect(known.has(`${f.familyName}\t${f.postScriptName}\t${f.isCustomFont}`), c.dump).toBe(true);
    }
  });
});

describe('north-star cover stand-ins', () => {
  it('regenerate byte-identically and match the pixel manifest', () => {
    expect(pixels.covers.map((c) => c.videoId)).toEqual([...covers.COVER_IDS]);
    expect(filesUnder(join(exampleDir, 'covers')).sort()).toEqual(covers.COVER_IDS.map((id) => covers.coverFile(id)).sort());
    for (const row of pixels.covers) {
      const png = covers.coverPng(row.videoId);
      expect(Buffer.compare(Buffer.from(png), read(row.file)), row.file).toBe(0);
      expect(lane.sha256(png)).toBe(row.sha256);
      expect(lane.pngSize(png)).toEqual({ width: 1280, height: 720 });
      expect([row.width, row.height]).toEqual([covers.COVER_WIDTH, covers.COVER_HEIGHT]);
    }
  });

  it('decode (node:zlib, test only) to the generator pixels with filter 0 on every row', () => {
    for (const id of covers.COVER_IDS) {
      const png = covers.coverPng(id);
      const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const idat: Uint8Array[] = [];
      for (let o = 8; o < png.length; ) {
        const len = dv.getUint32(o);
        if (String.fromCharCode(...png.subarray(o + 4, o + 8)) === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
        o += 12 + len;
      }
      const raw = inflateSync(Buffer.concat(idat));
      const px = covers.coverPixels(id);
      const row = covers.COVER_WIDTH * 3;
      expect(raw.length).toBe((row + 1) * covers.COVER_HEIGHT);
      for (let y = 0; y < covers.COVER_HEIGHT; y++) {
        expect(raw[y * (row + 1)]).toBe(0);
        expect(Buffer.compare(raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)), Buffer.from(px.subarray(y * row, (y + 1) * row)))).toBe(0);
      }
    }
  });
});
