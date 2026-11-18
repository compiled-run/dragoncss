// An author web font in a Markless style input: @font-face src urls that name files of the app, carried as `fonts` and read by the
// caller, resolve to snapshot assets, so Dragon measures with the file's own tables and the export lists each face with its file.
// The faces are files no Dragon checkout bundles, so nothing here leans on the vendored Lato.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { DECODED_FONTS_DIR, marklessFontFiles, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { vendorFontBytes } from '../src/font-reference.ts';
import { repoPath } from '../src/paths.ts';
import { androidSystemImagePath } from '../src/system-fonts/android.ts';

const { missingToolchain } = (await import(pathToFileURL(repoPath('packages/translate/src/native.ts')).href)) as { readonly missingToolchain: (subject: string, missing: string) => string };

const FACES = `@font-face { font-family: 'Harbour Lato'; src: url('./fonts/Lato-Regular.ttf') format('truetype'); font-weight: 400; }
@font-face { font-family: 'Harbour Lato'; src: url('./fonts/Lato-Bold.ttf') format('truetype'); font-weight: 700; }
body { margin: 0; font-family: 'Harbour Lato', sans-serif; }
`;
const PAGE = `.almanac { padding: 24px; }\n.heading { font-size: 28px; font-weight: 700; }\n.body { font-size: 18px; }\n`;
const FONTS = [{ url: './fonts/Lato-Regular.ttf', file: '../styles/fonts/Lato-Regular.ttf' }, { url: './fonts/Lato-Bold.ttf', file: '../styles/fonts/Lato-Bold.ttf' }];

const input = (css: string, fonts?: readonly { url: string; file: string }[]): string =>
  JSON.stringify({
    version: 'markless.native-style-input/0',
    component: 'Almanac',
    nodes: [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'almanac' } },
      { kind: 'element', id: 'h2', element: 'h1', parent: 'h0', attributes: { class: 'heading' } },
      { kind: 'text', id: 'h2:text0', parent: 'h2', text: 'Tide almanac' },
      { kind: 'element', id: 'h3', element: 'p', parent: 'h0', attributes: { class: 'body' } },
      { kind: 'text', id: 'h3:text0', parent: 'h3', text: 'Lato for the body, regular weight' },
      { kind: 'element', id: 'h4', element: 'p', parent: 'h0', attributes: { class: 'body' } },
      { kind: 'text', id: 'h4:text0', parent: 'h4', text: 'Waffles, quays and fjords' },
    ],
    css,
    states: [],
    ...(fonts === undefined ? {} : { fonts }),
  });

/** Vendored Lato with another head checkSumAdjustment: the same face in a file no Dragon checkout bundles. */
function authorCopy(file: string): Uint8Array {
  const bytes = new Uint8Array(vendorFontBytes(file));
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = Array.from({ length: d.getUint16(4) }, (_, i) => 12 + i * 16).find((e) => d.getUint32(e) === 0x68656164);
  if (at === undefined) throw new Error(`${file} has no head table`);
  const adjustment = d.getUint32(at + 8) + 8;
  d.setUint32(adjustment, d.getUint32(adjustment) ^ 1);
  return bytes;
}

/** Vendored Lato as WOFF2, made with fontTools (packages/dragon/test/fonts/woff/README.md). */
function woff2(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../dragon/test/fonts/woff/${name}`, import.meta.url)));
}

/** The app's files by their path relative to the input. */
const files: Record<string, Uint8Array> = {
  '../styles/fonts/Lato-Regular.ttf': authorCopy('Lato/Lato-Regular.ttf'),
  '../styles/fonts/Lato-Bold.ttf': authorCopy('Lato/Lato-Bold.ttf'),
  '../styles/fonts/Lato-Regular.woff2': woff2('Lato-Regular.woff2'),
  '../styles/fonts/Lato-Bold.woff2': woff2('Lato-Bold.woff2'),
  '../styles/fonts/Broken.woff2': woff2('Lato-Regular.woff2').subarray(0, 4000),
};
const read = (file: string): Uint8Array => {
  const bytes = files[file];
  if (bytes === undefined) throw new Error(`no file ${file}`);
  return bytes;
};

const textWidths = (text: string, t: 'ios' | 'android'): number[] =>
  marklessStyleExport(text, 'web-font.json', read).exported.targets[t]!.assignments[0]!.nodes.filter((n) => n.kind === 'text').map((n) => n.frame!.width);

describe('an author web font in a Markless style input', () => {
  it('compiles, measures with Lato rather than the pinned Inter, lists each face with its file, and every box matches Chrome within 1 device px', async () => {
    const text = input(FACES + PAGE, FONTS);
    const { exported } = marklessStyleExport(text, 'web-font.json', read);
    const parsed = parseMarklessStyleInput(text);
    const fonts = marklessFontFiles(parsed, read);
    expect(exported.fonts).toEqual(fonts.map((f) => ({ id: f.id, file: f.sfntFile, from: 'input' })).sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(fonts.map((f) => f.sfntFile)).toEqual(fonts.map((f) => f.file));
    expect(fonts.map((f) => f.id)).not.toContain(`sha256:${createHash('sha256').update(vendorFontBytes('Lato/Lato-Regular.ttf')).digest('hex')}`);
    for (const t of ['ios', 'android'] as const) {
      const lato = textWidths(text, t);
      const inter = textWidths(input(`body { margin: 0; font-family: sans-serif; }\n${PAGE}`), t);
      expect(lato.every((w, k) => Math.abs(w - inter[k]!) > 1), `${t}: ${lato.join()} against Inter's ${inter.join()}`).toBe(true);
    }
    const report = await compareMarklessExport(parsed, exported, undefined, 'light', fonts);
    expect(report.compared).toBe(18);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
  });

  it('skips a named family that is not provided, with a warning naming it, and lays out as the family after it alone, matching Chrome', async () => {
    const skipped = FACES.replace("body { margin: 0; font-family: 'Harbour Lato', sans-serif; }", "body { margin: 0; font-family: 'Nowhere Sans', 'Harbour Lato'; }");
    const alone = FACES.replace("body { margin: 0; font-family: 'Harbour Lato', sans-serif; }", "body { margin: 0; font-family: 'Harbour Lato'; }");
    expect(skipped).not.toBe(FACES);
    const text = input(skipped + PAGE, FONTS);
    const { exported } = marklessStyleExport(text, 'fallback.json', read);
    expect(exported.warnings.filter((w) => w.code === 'DRAGON_FONT_FAMILY_NOT_PROVIDED').map((w) => w.message)).toEqual([
      'font-family: "Nowhere Sans","Harbour Lato": the family "Nowhere Sans" is neither declared with @font-face nor in the font map, so every target skips it and draws with the next family in the list',
    ]);
    for (const t of ['ios', 'android'] as const) expect(textWidths(text, t)).toEqual(textWidths(input(alone + PAGE, FONTS), t));
    const report = await compareMarklessExport(parseMarklessStyleInput(text), exported, undefined, 'light', marklessFontFiles(parseMarklessStyleInput(text), read));
    expect(report.compared).toBe(18);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
  });

  it('decodes a WOFF2 src at build time: Dragon measures the decoded Lato, the export lists the decoded sfnt beside the input, and every box matches Chrome loading the .woff2 within 1 device px', async () => {
    const faces = FACES.replaceAll('.ttf', '.woff2').replaceAll("format('truetype')", "format('woff2')");
    const fonts = FONTS.map((f) => ({ url: f.url.replace('.ttf', '.woff2'), file: f.file.replace('.ttf', '.woff2') }));
    const text = input(faces + PAGE, fonts);
    const { exported, decoded } = marklessStyleExport(text, 'woff2.json', read);
    const files = marklessFontFiles(parseMarklessStyleInput(text), read);
    const sha = (b: Uint8Array): string => `sha256:${createHash('sha256').update(b).digest('hex')}`;
    expect(decoded.map((d) => [d.file, sha(d.bytes)])).toEqual(files.map((f) => [`${DECODED_FONTS_DIR}/${f.id.slice('sha256:'.length)}.ttf`, f.id]));
    expect(exported.fonts).toEqual(decoded.map((d) => ({ id: sha(d.bytes), file: d.file, from: 'input' })).sort((a, b) => (a.id < b.id ? -1 : 1)));
    for (const f of files) expect(f.id).not.toBe(sha(f.bytes));
    for (const t of ['ios', 'android'] as const) expect(textWidths(text, t)).toEqual(textWidths(input(FACES + PAGE, FONTS), t));
    const report = await compareMarklessExport(parseMarklessStyleInput(text), exported, undefined, 'light', files);
    expect(report.compared).toBe(18);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
  });

  // Safari 27.2 on an iPhone 17 Pro simulator, and Chrome 133 on a Pixel 7 emulator (Android 36), laid this page out at these boxes.
  it('with system fonts, the iOS target measures the author font as Safari does and Android as Chrome does', () => {
    let image = true;
    try {
      androidSystemImagePath();
    } catch {
      image = false;
    }
    if (process.platform !== 'darwin' || !image) {
      missingToolchain('system fonts', 'Core Text (macOS) and the Android SDK system image');
      return;
    }
    const { exported } = marklessStyleExport(input(FACES + PAGE, FONTS), 'web-font.json', read, 'system');
    const boxes = (t: 'ios' | 'android'): Record<string, [number, number]> => Object.fromEntries(exported.targets[t]!.assignments[0]!.nodes.filter((n) => n.kind === 'text').map((n) => [n.id, [n.frame!.width, n.frame!.height]]));
    const safari: Record<string, readonly [number, number]> = { 'h2:text0': [491.274, 102], 'h3:text0': [771.579, 66], 'h4:text0': [591.975, 66] };
    const chrome: Record<string, readonly [number, number]> = { 'h2:text0': [429.875, 89], 'h3:text0': [674.1719, 57], 'h4:text0': [517.9844, 57] };
    for (const [t, web] of [['ios', safari], ['android', chrome]] as const) {
      const got = boxes(t);
      for (const [id, [w, h]] of Object.entries(web)) {
        expect(got[id]![1], `${t} ${id} height`).toBe(h);
        expect(Math.abs(got[id]![0] - w), `${t} ${id} width ${got[id]![0]} against ${w}`).toBeLessThan(0.02);
      }
    }
  });

  it('refuses a malformed WOFF2 by name', () => {
    const css = `@font-face { font-family: 'Harbour Lato'; src: url('./fonts/Broken.woff2') format('woff2'); }\nbody { font-family: 'Harbour Lato', sans-serif; }`;
    expect(() => marklessStyleExport(input(css, [{ url: './fonts/Broken.woff2', file: '../styles/fonts/Broken.woff2' }]), 'broken.json', read)).toThrow(
      `DRAGON_FONT_UNREADABLE [all] @font-face 1: src url(./fonts/Broken.woff2) is not a readable font (malformed woff2: the header length ${files['../styles/fonts/Lato-Regular.woff2']!.length} is not the file length 4000)`,
    );
  });

  it('keeps a url the input names no file for an unresolved asset', () => {
    expect(() => marklessStyleExport(input(FACES + PAGE, FONTS.slice(0, 1)), 'unresolved.json', read)).toThrow(
      'DRAGON_FONT_UNRESOLVED_ASSET [all] @font-face 2: src url(./fonts/Lato-Bold.ttf) does not resolve to an asset of the source snapshot',
    );
  });

  it('refuses a fonts entry that is not { url, file } relative to the input, a url listed twice, and fonts with no reader', () => {
    expect(() => parseMarklessStyleInput(input(FACES, [{ url: './a.ttf', file: '/abs/a.ttf' }]))).toThrow('fonts: /abs/a.ttf is not a path relative to the input file');
    expect(() => parseMarklessStyleInput(input(FACES, [FONTS[0]!, { ...FONTS[0]!, file: 'other.ttf' }]))).toThrow('fonts: ./fonts/Lato-Regular.ttf is listed twice');
    expect(() => parseMarklessStyleInput(input(FACES, [{ url: './a.ttf' } as never]))).toThrow('bad fonts entry');
    expect(() => marklessStyleExport(input(FACES + PAGE, FONTS), 'no-reader.json')).toThrow('the input names font files, and no reader for them was given');
  });
});
