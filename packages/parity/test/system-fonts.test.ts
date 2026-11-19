// System fonts on Markless native targets (docs/system-fonts.md): the Android image reader and fonts.xml, CSS weight matching, the
// Core Text helper's output, the export's shape, and the measured advances and line heights against the platform probe numbers in
// test/system-fonts/ (how each was produced is in its "how" field; the probe sources are in test/system-fonts/probes).
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TextFont } from '@dragon/layout';
import { GLYPH_STRIDE, LU_PER_PX } from '@dragon/layout';
import { SYSTEM_FACES, systemFaceId } from 'dragon';
import { pathToFileURL } from 'node:url';
import { repoPath } from '../src/paths.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import { androidImagePartitions, bytesSource, Ext4, gptPartitions, superPartitions } from '../src/system-fonts/android-image.ts';
import { ANDROID_SYSTEM_IMAGE, AndroidSystemFiles, androidSystemImagePath } from '../src/system-fonts/android.ts';
import { coreTextHelper, CoreTextUnavailable, iosRuntimeRoot } from '../src/system-fonts/coretext.ts';
import { parseFontsXml } from '../src/system-fonts/fonts-xml.ts';
import { systemMeasurer } from '../src/system-fonts/measurer.ts';
import { matchWeight, systemFontsFor } from '../src/system-fonts/provider.ts';
import { IOS_ROLE_FACES } from '../src/system-fonts/web-generics.ts';

// The shared toolchain refusal (packages/translate/src/native.ts), loaded by path as pointer-vectors-java.test.ts does.
const { missingToolchain } = (await import(pathToFileURL(repoPath('packages/translate/src/native.ts')).href)) as { readonly missingToolchain: (subject: string, missing: string) => string };

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./system-fonts/${name}`, import.meta.url), 'utf8')) as T;

// A tiny disk: GPT, a liblp super partition holding one logical partition, and in it an ext4 file system with /system/etc/fonts.xml.
const u16 = (b: Uint8Array, at: number, v: number): void => new DataView(b.buffer).setUint16(at, v, true);
const u32 = (b: Uint8Array, at: number, v: number): void => new DataView(b.buffer).setUint32(at, v, true);
const u64 = (b: Uint8Array, at: number, v: number): void => new DataView(b.buffer).setBigUint64(at, BigInt(v), true);
const sha = (b: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(b).digest());

function ext4Image(file: Uint8Array): Uint8Array {
  const bs = 1024;
  const img = new Uint8Array(64 * bs);
  const sb = 1024;
  u32(img, sb + 0, 16);
  u32(img, sb + 4, 64);
  u32(img, sb + 20, 1);
  u32(img, sb + 24, 0);
  u32(img, sb + 32, 8192);
  u32(img, sb + 40, 16);
  u16(img, sb + 56, 0xef53);
  u16(img, sb + 88, 128);
  u32(img, sb + 96, 0x2 | 0x40);
  u32(img, 2 * bs + 8, 5);
  const inode = (n: number, mode: number, size: number, start: number, blocks: number): void => {
    const at = 5 * bs + (n - 1) * 128;
    u16(img, at, mode);
    u32(img, at + 4, size);
    u32(img, at + 0x20, 0x80000);
    u16(img, at + 0x28, 0xf30a);
    u16(img, at + 0x2a, 1);
    u16(img, at + 0x2c, 4);
    u32(img, at + 0x34, 0);
    u16(img, at + 0x38, blocks);
    u32(img, at + 0x3c, start);
  };
  const dir = (block: number, entries: readonly [string, number][]): void => {
    let o = block * bs;
    entries.forEach(([name, n], k) => {
      const rec = k === entries.length - 1 ? block * bs + bs - o : (8 + name.length + 3) & ~3;
      u32(img, o, n);
      u16(img, o + 4, rec);
      img[o + 6] = name.length;
      img.set(new TextEncoder().encode(name), o + 8);
      o += rec;
    });
  };
  inode(2, 0x41ed, bs, 10, 1);
  dir(10, [['.', 2], ['..', 2], ['system', 12]]);
  inode(12, 0x41ed, bs, 11, 1);
  dir(11, [['.', 12], ['..', 2], ['etc', 13]]);
  inode(13, 0x41ed, bs, 12, 1);
  dir(12, [['.', 13], ['..', 12], ['fonts.xml', 14]]);
  inode(14, 0x81a4, file.length, 20, Math.ceil(file.length / bs));
  img.set(file, 20 * bs);
  return img;
}

function superImage(fs: Uint8Array): Uint8Array {
  const at = 64 * 512;
  const sup = new Uint8Array(at + fs.length);
  u32(sup, 4096, 0x616c4467);
  u32(sup, 4096 + 4, 52);
  u32(sup, 4096 + 40, 65536);
  u32(sup, 4096 + 44, 2);
  u32(sup, 4096 + 48, 4096);
  const tables = new Uint8Array(52 + 24);
  tables.set(new TextEncoder().encode('system'), 0);
  u32(tables, 44, 1);
  u64(tables, 52, fs.length / 512);
  u64(tables, 52 + 12, at / 512);
  const header = new Uint8Array(128);
  u32(header, 0, 0x414c5030);
  u16(header, 4, 10);
  u32(header, 8, 128);
  u32(header, 44, tables.length);
  header.set(sha(tables), 48);
  u32(header, 80, 0);
  u32(header, 84, 1);
  u32(header, 88, 52);
  u32(header, 92, 52);
  u32(header, 96, 1);
  u32(header, 100, 24);
  header.set(sha(header), 12);
  sup.set(header, 4096 + 8192);
  sup.set(tables, 4096 + 8192 + 128);
  sup.set(fs, at);
  return sup;
}

function gptDisk(sup: Uint8Array): Uint8Array {
  const first = 64;
  const disk = new Uint8Array(first * 512 + sup.length);
  disk.set(new TextEncoder().encode('EFI PART'), 512);
  u64(disk, 512 + 72, 2);
  u32(disk, 512 + 80, 4);
  u32(disk, 512 + 84, 128);
  const e = 2 * 512;
  disk[e] = 1;
  u64(disk, e + 32, first);
  u64(disk, e + 40, first + sup.length / 512 - 1);
  disk.set(Array.from(new TextEncoder().encode('super')).flatMap((c) => [c, 0]), e + 56);
  disk.set(sup, first * 512);
  return disk;
}

const XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- a comment -->
<familyset version="23">
  <family name="sans-serif">
    <font weight="400" style="normal">Roboto-Regular.ttf
      <axis tag="wght" stylevalue="400" />
    </font>
    <font weight="700" style="normal">Roboto-Regular.ttf<axis tag="wght" stylevalue="700"/></font>
  </family>
  <alias name="helvetica" to="sans-serif" />
  <family name="serif"><font weight="400" style="italic" index="1" postScriptName="X">Serif.ttc</font></family>
  <family lang="und-Zsye"><font weight="400" style="normal">NotoColorEmoji.ttf</font></family>
</familyset>
`;

describe('the Android system image reader', () => {
  it('reads a file through GPT, the super partition\'s liblp metadata and ext4 extents', () => {
    const disk = bytesSource(gptDisk(superImage(ext4Image(new TextEncoder().encode(XML)))));
    expect([...gptPartitions(disk).keys()]).toEqual(['super']);
    expect([...superPartitions(gptPartitions(disk).get('super') as ReturnType<typeof bytesSource>).keys()]).toEqual(['system']);
    const system = androidImagePartitions(disk).get('system') as Ext4;
    expect(new TextDecoder().decode(system.readFile('/system/etc/fonts.xml'))).toBe(XML);
    expect(system.list('/system/etc')).toEqual(['fonts.xml']);
    expect(system.lookup('/system/fonts')).toBeNull();
    expect(() => system.readFile('/system/etc')).toThrow('is a directory, not a regular file');
  });

  it('refuses a super partition whose metadata checksum does not match, and a disk that is not GPT', () => {
    const sup = superImage(ext4Image(new TextEncoder().encode(XML)));
    sup[4096 + 8192 + 128] = (sup[4096 + 8192 + 128] as number) ^ 1;
    expect(() => superPartitions(bytesSource(sup))).toThrow('tables checksum does not match');
    expect(() => gptPartitions(bytesSource(new Uint8Array(4096)))).toThrow('not a GPT disk');
  });

  it('reads the SDK\'s own image: fonts.xml, and the Roboto it names for sans-serif', () => {
    let path: string;
    try {
      path = androidSystemImagePath();
    } catch (e) {
      missingToolchain('system fonts (Android)', (e as Error).message);
      return;
    }
    const files = new AndroidSystemFiles(path);
    const xml = files.fontsXml();
    const sans = xml.families.get('sans-serif')!.fonts;
    expect(sans.find((f) => f.weight === 700)).toMatchObject({ file: 'Roboto-Regular.ttf', axes: { ital: 0, wdth: 100, wght: 700 } });
    expect(xml.aliases.get('times new roman')).toEqual({ to: 'serif', weight: null });
    expect(files.read('/system/fonts/Roboto-Regular.ttf').sha256).toBe('9ca9debb09459bf4e3e7f826f5cd0f35f253902b85684921fce2ba3f28dd0f50');
    expect(ANDROID_SYSTEM_IMAGE.api).toBe(36);
  });
});

describe('fonts.xml', () => {
  it('reads each named family\'s fonts with their axes, index and PostScript name, and the aliases', () => {
    const x = parseFontsXml(XML);
    expect([...x.families.keys()]).toEqual(['sans-serif', 'serif']);
    expect(x.families.get('sans-serif')!.fonts).toEqual([
      { file: 'Roboto-Regular.ttf', weight: 400, style: 'normal', index: 0, axes: { wght: 400 }, postScriptName: null },
      { file: 'Roboto-Regular.ttf', weight: 700, style: 'normal', index: 0, axes: { wght: 700 }, postScriptName: null },
    ]);
    expect(x.families.get('serif')!.fonts[0]).toMatchObject({ file: 'Serif.ttc', style: 'italic', index: 1, postScriptName: 'X' });
    expect(x.aliases.get('helvetica')).toEqual({ to: 'sans-serif', weight: null });
  });

  it('refuses what is not fonts.xml', () => {
    expect(() => parseFontsXml('<fonts/>')).toThrow('not <familyset>');
    expect(() => parseFontsXml('<familyset><family name="a"><font>../x.ttf</font></family></familyset>')).toThrow('not a file name');
    expect(() => parseFontsXml('<familyset><family name="a"></familyset>')).toThrow('does not close');
    expect(() => parseFontsXml('<familyset><family name="a"><font style="oblique">a.ttf</font></family></familyset>')).toThrow('style="oblique"');
  });
});

describe('system faces', () => {
  it('name every role at the nine weights, and refuse other weights', () => {
    expect(SYSTEM_FACES.size).toBe(5 * 9 * 2);
    expect(systemFaceId('serif', 700, 'normal')).toBe('system:serif:700');
    expect(systemFaceId('serif', 450, 'normal')).toBeNull();
  });

  it('match a weight as css-fonts-4 §5.2 does', () => {
    const faces = [{ weight: 300 }, { weight: 400 }, { weight: 600 }, { weight: 900 }];
    expect([100, 400, 450, 500, 700, 800].map((w) => matchWeight(faces, w)?.weight)).toEqual([300, 400, 400, 400, 900, 900]);
    expect(matchWeight([{ weight: 500 }, { weight: 700 }], 400)?.weight).toBe(500);
  });

  it('draw iOS sans-serif at 100 to 300 in Helvetica-Light, as css-fonts-4 §5.2 picks among Helvetica\'s upright faces', () => {
    const ps = (w: number): string | undefined => {
      const f = matchWeight(IOS_ROLE_FACES['sans-serif'], w)?.face;
      return f?.kind === 'name' ? f.postScriptName : undefined;
    };
    expect([100, 200, 300, 400, 500, 600, 700, 900].map(ps)).toEqual(['Helvetica-Light', 'Helvetica-Light', 'Helvetica-Light', 'Helvetica', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Bold', 'Helvetica-Bold']);
  });
});

type IosFixture = { readonly fonts: readonly { readonly id: string; readonly weight: number; readonly size: number; readonly postScriptName: string; readonly safariFamilies: readonly string[]; readonly safariLineMetrics: { readonly lineHeight: readonly number[]; readonly inlineBoxHeight: readonly number[] }; readonly lines: readonly { readonly text: string; readonly safariWidth: number; readonly glyphs: readonly number[]; readonly x: readonly number[] }[] }[] };
type AndroidFixture = { readonly how: { readonly density: number }; readonly entries: readonly { readonly id: string; readonly weight: number; readonly cssPx: number; readonly devicePx: number; readonly chromeFamilies: readonly string[]; readonly blinkWidthsCss: readonly { readonly text: string; readonly chrome: Readonly<Record<string, number>> }[]; readonly blinkLineHeightCss: number; readonly linear: { readonly lines: readonly { readonly text: string; readonly runAdvance: number; readonly glyphIds: readonly number[]; readonly x: readonly number[] }[] } }[] };

const ROLE_OF_SAFARI: Readonly<Record<string, 'system-ui' | 'sans-serif' | 'serif' | 'monospace'>> = { 'system-ui': 'system-ui', 'sans-serif': 'sans-serif', serif: 'serif', monospace: 'monospace' };
const font = (family: string, size: number): TextFont => ({ family, size, letterSpacing: 0, wordSpacing: 0, smallCaps: false }) as unknown as TextFont;
const shaped = (g: readonly number[]): { glyphs: number[]; xs: number[]; width: number } => {
  const glyphs: number[] = [];
  const xs: number[] = [];
  let pen = 0;
  for (let i = 0; i < g.length; i += GLYPH_STRIDE) {
    glyphs.push(g[i] as number);
    xs.push((pen + (g[i + 4] as number)) / 65536);
    pen += g[i + 2] as number;
  }
  return { glyphs, xs, width: pen / 65536 };
};

type RuntimeFace = { readonly postScriptName: string; readonly family: string; readonly weight: number; readonly italic: boolean };

/** Every face of every font file under a directory, read from each face's name, head and OS/2 tables. */
function runtimeFaces(dir: string): RuntimeFace[] {
  const out: RuntimeFace[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(ttf|ttc|otf|otc)$/i.test(entry.name)) continue;
    const fd = openSync(join(entry.parentPath, entry.name), 'r');
    try {
      const at = (pos: number, n: number): DataView => {
        const b = Buffer.alloc(n);
        if (readSync(fd, b, 0, n, pos) !== n) throw new Error(`${entry.name}: ${n} bytes at ${pos} are past the end of the file`);
        return new DataView(b.buffer, b.byteOffset, n);
      };
      const head = at(0, 12);
      const offsets = head.getUint32(0) === 0x74746366 ? Array.from({ length: head.getUint32(8) }, (_, i) => at(12 + 4 * i, 4).getUint32(0)) : [0];
      for (const o of offsets) {
        const n = at(o + 4, 2).getUint16(0);
        const records = at(o + 12, n * 16);
        const tables = new Map<string, { offset: number; length: number }>();
        for (let i = 0; i < n; i++) tables.set(String.fromCharCode(...[0, 1, 2, 3].map((k) => records.getUint8(i * 16 + k))), { offset: records.getUint32(i * 16 + 8), length: records.getUint32(i * 16 + 12) });
        const nameT = tables.get('name');
        const headT = tables.get('head');
        if (nameT === undefined || headT === undefined) throw new Error(`${entry.name}: a face at ${o} has no name or head table`);
        const name = at(nameT.offset, nameT.length);
        const names = new Map<number, string>();
        for (let i = 0; i < name.getUint16(2); i++) {
          const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((k) => name.getUint16(6 + 12 * i + k)) as [number, number, number, number, number, number];
          const bytes = new Uint8Array(name.buffer, name.byteOffset + name.getUint16(4) + offset, length);
          if (platform === 3 && encoding === 1 && language === 0x409) names.set(id, new TextDecoder('utf-16be').decode(bytes));
          else if (platform === 1 && encoding === 0 && language === 0 && !names.has(id)) names.set(id, new TextDecoder('latin1').decode(bytes));
        }
        const macStyle = at(headT.offset + 44, 2).getUint16(0);
        const os2T = tables.get('OS/2');
        const os2 = os2T === undefined ? null : at(os2T.offset, 64);
        out.push({
          postScriptName: names.get(6) ?? '',
          family: names.get(16) ?? names.get(1) ?? '',
          // A face with no OS/2 table (Courier) has only head.macStyle's bold and italic bits.
          weight: os2 === null ? (macStyle & 1 ? 700 : 400) : os2.getUint16(4),
          italic: os2 === null ? (macStyle & 2) !== 0 : (os2.getUint16(62) & 1) !== 0,
        });
      }
    } finally {
      closeSync(fd);
    }
  }
  return out;
}

describe('iOS system faces against Safari and Core Text in the iOS 27.2 simulator', () => {
  it('list every upright face the iOS runtime has in each named role\'s family, at the weight its file declares', () => {
    let root: string;
    try {
      root = iosRuntimeRoot().root;
    } catch (e) {
      missingToolchain('system fonts (iOS)', (e as Error).message);
      return;
    }
    const all = runtimeFaces(join(root, 'System/Library/Fonts'));
    const psOf = (f: (typeof IOS_ROLE_FACES)['serif'][number]): string | null => (f.face.kind === 'name' ? f.face.postScriptName : null);
    for (const [role, faces] of Object.entries(IOS_ROLE_FACES)) {
      if (faces.every((f) => psOf(f) === null)) continue;
      expect(faces.every((f) => psOf(f) !== null && f.style === 'normal'), role).toBe(true);
      const families = new Set(faces.map((f) => all.find((r) => r.postScriptName === psOf(f))?.family));
      expect([...families], role).toHaveLength(1);
      const family = [...families][0] as string;
      const runtime = all.filter((r) => r.family === family && !r.italic).map((r) => `${r.weight} ${r.postScriptName}`).sort();
      expect(faces.map((f) => `${f.weight} ${psOf(f)}`).sort(), `${role}: ${family}`).toEqual(runtime);
    }
  });

  const darwin = process.platform === 'darwin';
  const faces = fixture<IosFixture>('ios-coretext.json').fonts.flatMap((f) => {
    const role = f.safariFamilies.map((s) => ROLE_OF_SAFARI[s]).find((r) => r !== undefined);
    return role === undefined ? [] : [{ ...f, role }];
  });

  it('covers every role the web column needs', () => {
    expect([...new Set(faces.map((f) => `${f.role} ${f.weight}`))].sort()).toEqual(['monospace 400', 'monospace 700', 'sans-serif 400', 'sans-serif 700', 'serif 400', 'serif 700', 'system-ui 400', 'system-ui 700']);
  });

  it('the helper fails by name off macOS', () => {
    const own = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(() => coreTextHelper()).toThrow(CoreTextUnavailable);
      expect(() => coreTextHelper()).toThrow('measured with Core Text on macOS at build time, and this build runs on linux');
    } finally {
      Object.defineProperty(process, 'platform', own);
    }
  });

  it('gives the simulator\'s glyphs and positions, Safari\'s widths and Safari\'s line heights', () => {
    if (!darwin) {
      missingToolchain('system fonts (iOS)', 'Core Text runs on macOS only');
      return;
    }
    const sys = systemFontsFor('ios', 1);
    for (const f of faces) {
      const id = systemFaceId(f.role, f.weight, 'normal') as string;
      const m = systemMeasurer(sys, { font: { family: id } }, [], 1);
      const metrics = m.metrics(font(id, f.size));
      const where = `${f.postScriptName} ${f.size}`;
      expect((metrics.ascent + metrics.descent + metrics.lineGap) / LU_PER_PX, where).toBe(f.safariLineMetrics.lineHeight[0]);
      expect((metrics.ascent + metrics.descent) / LU_PER_PX, where).toBe(f.safariLineMetrics.inlineBoxHeight[0]);
      for (const l of f.lines) {
        const s = shaped(sys.shaper.shape(id, f.size, l.text, 0, l.text.length, 'Latn', false, 'en-US', []));
        expect(s.glyphs, `${where} ${l.text}`).toEqual(l.glyphs);
        // The simulator's x are Core Text's; Dragon's drop kerning Core Text puts on a space, as Safari does.
        expect(Math.abs(s.width - l.safariWidth), `${where} ${l.text}`).toBeLessThan(1e-3);
        const w = m.measure(l.text, font(id, f.size));
        expect(w.ok && Math.abs(w.measure.width / LU_PER_PX - l.safariWidth) <= 1 / 64, `${where} ${l.text}: the engine's width`).toBe(true);
      }
    }
  });

  it('the export\'s glyph ids are the simulator\'s', () => {
    if (!darwin) {
      missingToolchain('system fonts (iOS)', 'Core Text runs on macOS only');
      return;
    }
    const sys = systemFontsFor('ios', 3);
    for (const f of faces.filter((x) => x.size === 17)) {
      const id = systemFaceId(f.role, f.weight, 'normal') as string;
      for (const l of f.lines) expect(shaped(sys.shaper.shape(id, f.size * 3, l.text, 0, l.text.length, 'Latn', false, 'en-US', [])).glyphs).toEqual(l.glyphs);
    }
  });
});

describe('Android system faces against Chrome and Paint on the Android 36 emulator', () => {
  const a = fixture<AndroidFixture>('android-paint.json');
  const ROLE: Readonly<Record<string, 'sans-serif' | 'serif' | 'monospace'>> = { default: 'sans-serif', serif: 'serif', monospace: 'monospace' };

  it('gives Paint\'s glyphs, and Chrome\'s widths within the device gate and its line heights', () => {
    if (!existsSync(androidSystemImagePathOrNull() ?? '')) {
      missingToolchain('system fonts (Android)', `no SDK system image ${JSON.stringify(ANDROID_SYSTEM_IMAGE)}`);
      return;
    }
    const sys = systemFontsFor('android', a.how.density);
    let paintGap = 0;
    let chromeGap = 0;
    for (const e of a.entries) {
      const role = ROLE[e.id] as 'sans-serif' | 'serif' | 'monospace';
      const id = systemFaceId(role, e.weight, 'normal') as string;
      if (role === 'monospace' && e.weight === 700) {
        // Chrome draws DroidSansMono in synthetic bold; native refuses it rather than draw regular.
        expect(() => sys.descriptor(id)).toThrow('no face of weight 600 or more');
        continue;
      }
      const m = systemMeasurer(sys, { font: { family: id } }, [], a.how.density);
      const where = `${e.id} ${e.weight} ${e.cssPx}`;
      const metrics = m.metrics(font(id, e.devicePx));
      expect(Math.abs((metrics.ascent + metrics.descent + metrics.lineGap) / LU_PER_PX - e.blinkLineHeightCss * a.how.density), where).toBeLessThan(1e-3);
      for (const l of e.linear.lines) {
        const s = shaped(sys.shaper.shape(id, e.devicePx, l.text, 0, l.text.length, 'Latn', false, 'en-US', []));
        expect(s.glyphs, `${where} ${l.text}`).toEqual(l.glyphIds);
        paintGap = Math.max(paintGap, Math.abs(s.width - l.runAdvance));
        const chrome = a.entries.find((x) => x === e)!.blinkWidthsCss.find((b) => b.text === l.text)?.chrome;
        const css = chrome === undefined ? undefined : Object.values(chrome)[0];
        if (css === undefined) continue;
        const w = m.measure(l.text, font(id, e.devicePx));
        const gap = w.ok ? Math.abs(w.measure.width / LU_PER_PX - css * a.how.density) : Infinity;
        chromeGap = Math.max(chromeGap, gap);
        expect(gap <= GATE_DEVICE_PX, `${where} ${l.text}: Chrome's width ${css * a.how.density}, Dragon's ${w.ok ? w.measure.width / LU_PER_PX : w.reason}`).toBe(true);
      }
    }
    console.log(`Android: Dragon's widths against Chrome's, largest gap ${chromeGap.toFixed(4)} device px; run advances against Paint.getRunAdvance (Minikin, word by word), largest gap ${paintGap.toFixed(4)} device px`);
  });
});

function androidSystemImagePathOrNull(): string | null {
  try {
    return androidSystemImagePath();
  } catch {
    return null;
  }
}

describe('a Markless export with system fonts', () => {
  const input = JSON.stringify({
    version: 'markless.native-style-input/0',
    component: 'Almanac',
    nodes: [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
      { kind: 'element', id: 'h1', element: 'h1', parent: 'h0', attributes: { class: 'ui' } },
      { kind: 'text', id: 'h1:text0', parent: 'h1', text: 'Tide almanac' },
      { kind: 'element', id: 'h2', element: 'p', parent: 'h0', attributes: {} },
      { kind: 'text', id: 'h2:text0', parent: 'h2', text: 'No font family at all' },
    ],
    css: '.page { padding: 24px; } .ui { font-family: system-ui; font-size: 28px; }',
    states: [],
  });

  it('names system faces in its text runs and lists them apart from the bundled fonts', () => {
    if (process.platform !== 'darwin' || androidSystemImagePathOrNull() === null) {
      missingToolchain('system fonts', 'Core Text (macOS) and the Android SDK system image');
      return;
    }
    const { exported } = marklessStyleExport(input, 'almanac.json', undefined, 'system');
    expect(exported.fonts).toEqual([]);
    expect(exported.systemFonts?.map((e) => e.id)).toEqual(['system:default:400', 'system:system-ui:700']);
    expect(exported.systemFonts?.[0]).toMatchObject({ ios: { face: { kind: 'name', postScriptName: 'TimesNewRomanPSMT' } }, android: { file: 'NotoSerif-Regular.ttf', index: 0, axes: {} } });
    expect(exported.systemFonts?.[1]).toMatchObject({ ios: { face: { kind: 'system', weight: 0.4, design: 'default' } }, android: { file: 'Roboto-Regular.ttf', axes: { ital: 0, wdth: 100, wght: 700 } } });
    for (const t of ['ios', 'android'] as const) {
      const text = exported.targets[t]!.assignments[0]!.nodes.find((n) => n.id === 'h1:text0')!;
      expect(text.lines![0]!.runs.map((r) => r.face)).toEqual(['system:system-ui:700']);
      expect(text.writes.find((w) => w['kind'] === 'font')).toMatchObject({ font: { family: 'system:system-ui:700', size: 28 } });
    }
  });

  it('pinned, it keeps the stated reference\'s bundled Inter', () => {
    const { exported } = marklessStyleExport(input.replace('font-family: system-ui; ', ''), 'almanac.json');
    expect(exported.systemFonts).toBeUndefined();
    expect(exported.fonts.map((f) => f.file)).toContain('vendor/fonts/Inter/Inter-Bold.ttf');
  });
});
