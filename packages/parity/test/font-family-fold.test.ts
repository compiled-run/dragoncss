// Font family case folding against the pinned Chrome 145: every code point with a case mapping (BMP and astral) and each of its
// single-code-point mappings, as a declared FontFace family and as a used font-family. In each of two rounds one half is declared
// (Ahem) and the other half used; a used family renders in Ahem exactly when Chrome's FontFaceCache folds it onto a declared one,
// which must be exactly when foldFamily keys it onto a declared one. Two plants (Unicode toLowerCase, the former per-code-point
// upper-then-lower folding) must each disagree with Chrome.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foldFamily } from '../../dragon/src/fonts/selection.ts';

type Page = { setContent(html: string): Promise<void>; evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> };
type Browser = { newPage(): Promise<Page & { close(): Promise<void> }>; close(): Promise<void> };
const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;

/** Every code point whose lower or upper case differs from it, with each single-code-point mapping it has. */
function casedCodePoints(): string[] {
  const out = new Set<string>();
  for (let cp = 0; cp <= 0x1ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    const maps = [ch.toLowerCase(), ch.toUpperCase()].filter((m) => m !== ch);
    if (maps.length === 0) continue;
    out.add(ch);
    for (const m of maps) if ([...m].length === 1) out.add(m);
  }
  return [...out].sort();
}

const lowerFold = (s: string): string => s.toLowerCase();
const upperLowerFold = (s: string): string =>
  [...s].map((ch) => {
    const up = ch.toUpperCase();
    const one = [...up].length === 1 ? up : ch;
    const low = one.toLowerCase();
    return [...low].length === 1 ? low : one;
  }).join('');

/** For each used family, whether the fold keys it onto a declared family. */
const predict = (fold: (s: string) => string, declared: readonly string[], used: readonly string[]): boolean[] => {
  const keys = new Set(declared.map(fold));
  return used.map((u) => keys.has(fold(u)));
};

describe('font family case folding matches Chrome 145', () => {
  it('every cased code point folds onto a declared family exactly as Chrome does, and the plants are caught', async () => {
    const chars = casedCodePoints();
    expect(chars.length).toBeGreaterThan(2500);
    const family = (c: string): string => `${c}z`;
    const hasLower = (c: string): boolean => c.toLowerCase() !== c;
    const rounds = [chars.filter(hasLower), chars.filter((c) => !hasLower(c))].map((half, i, all) => ({ declared: half.map(family), used: (all[1 - i] as string[]).map(family) }));
    const ahem = [...readFileSync(new URL('../../../vendor/fonts/Ahem.ttf', import.meta.url))];
    const { launchChrome } = await load<{ launchChrome: () => Promise<Browser> }>('chrome.ts');
    const browser = await launchChrome();
    try {
      const disagreements: Record<string, string[]> = { foldFamily: [], lowerFold: [], upperLowerFold: [] };
      for (const { declared, used } of rounds) {
        // A fresh page per round: setContent keeps the Document, and with it the previous round's document.fonts.
        const page = await browser.newPage();
        await page.setContent('<body></body>');
        const chrome = await page.evaluate(async ({ declared, used, ahem }) => {
          const bytes = new Uint8Array(ahem).buffer;
          for (const f of declared) {
            const face = new FontFace(f, bytes);
            await face.load();
            document.fonts.add(face);
          }
          const spans = used.map((f) => {
            const s = document.createElement('span');
            s.style.fontFamily = `"${f}", monospace`;
            s.style.fontSize = '20px';
            s.textContent = 'xxxx';
            document.body.append(s, document.createElement('br'));
            return s;
          });
          await document.fonts.ready;
          return spans.map((s) => s.getBoundingClientRect().width === 80);
        }, { declared, used, ahem });
        await page.close();
        expect(chrome.some((x) => x) && chrome.some((x) => !x)).toBe(true);
        for (const [name, fold] of [['foldFamily', foldFamily], ['lowerFold', lowerFold], ['upperLowerFold', upperLowerFold]] as const) {
          const dragon = predict(fold, declared, used);
          used.forEach((u, i) => {
            if (dragon[i] !== chrome[i]) disagreements[name]?.push(`${[...u].map((c) => `U+${(c.codePointAt(0) as number).toString(16)}`).join(' ')} chrome ${String(chrome[i])}`);
          });
        }
      }
      expect(disagreements['foldFamily']).toEqual([]);
      expect(disagreements['lowerFold']?.length).toBeGreaterThan(0);
      expect(disagreements['upperLowerFold']?.length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  });
});
