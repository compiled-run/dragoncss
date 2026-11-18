// An author web font in a Markless style input: @font-face src urls that name files of the app, carried as `fonts` and read by the
// caller, resolve to snapshot assets, so Dragon measures with the file's own tables and the export lists each face with its file.
// The faces are files no Dragon checkout bundles, so nothing here leans on the vendored Lato.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessFontFiles, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { vendorFontBytes } from '../src/font-reference.ts';

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

/** The app's files by their path relative to the input. */
const files: Record<string, Uint8Array> = {
  '../styles/fonts/Lato-Regular.ttf': authorCopy('Lato/Lato-Regular.ttf'),
  '../styles/fonts/Lato-Bold.ttf': authorCopy('Lato/Lato-Bold.ttf'),
  '../styles/fonts/Lato-Regular.woff2': new Uint8Array([0x77, 0x4f, 0x46, 0x32, ...new Array<number>(44).fill(0)]),
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
    expect(exported.fonts).toEqual(fonts.map((f) => ({ id: f.id, file: f.file, from: 'input' })).sort((a, b) => (a.id < b.id ? -1 : 1)));
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

  it('refuses a WOFF2 src by its container', () => {
    const css = `@font-face { font-family: 'Harbour Lato'; src: url('./fonts/Lato-Regular.woff2') format('woff2'); }\nbody { font-family: 'Harbour Lato', sans-serif; }`;
    expect(() => marklessStyleExport(input(css, [{ url: './fonts/Lato-Regular.woff2', file: '../styles/fonts/Lato-Regular.woff2' }]), 'woff2.json', read)).toThrow(
      'DRAGON_FONT_UNREADABLE [all] @font-face 1: src url(./fonts/Lato-Regular.woff2) is not a readable font (unsupported-container woff2)',
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
