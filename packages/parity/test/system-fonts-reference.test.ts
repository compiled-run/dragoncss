// The Chrome reference of an Android export with system faces (system-fonts/reference.ts) against the instance the provider shapes:
// for every system face the provider resolves from the SDK image, Chrome's width of one string through the reference's generics
// equals its width with that face's file at the provider's axes set on the element, which Chrome applies over any it derives.
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SYSTEM_FACES } from 'dragon';
import { launchChrome } from '../src/chrome.ts';
import { fontDataUrl } from '../src/font-reference.ts';
import type { SystemFontEntry } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';
import { AndroidSystemFiles, androidSystemImagePath } from '../src/system-fonts/android.ts';
import { androidInstance, fvarAxes, SystemFaceRefused, systemFontsFor } from '../src/system-fonts/provider.ts';
import { systemFontReference } from '../src/system-fonts/reference.ts';

const { missingToolchain } = (await import(pathToFileURL(repoPath('packages/translate/src/native.ts')).href)) as { readonly missingToolchain: (subject: string, missing: string) => string };

const TEXT = 'The quick brown fox jumps';

const imagePresent = (): boolean => {
  try {
    androidSystemImagePath();
    return true;
  } catch {
    return false;
  }
};

describe('the Android system font reference in Chrome', () => {
  it('draws every system face the provider resolves at the axes the provider shapes it with', async () => {
    if (!imagePresent()) {
      missingToolchain('system fonts (Android)', 'the Android SDK system image');
      return;
    }
    const files = new AndroidSystemFiles();
    const sys = systemFontsFor('android', 1);
    const faces: { id: string; role: string; weight: number; style: string; entry: SystemFontEntry; axes: Record<string, number>; url: string }[] = [];
    for (const [id, r] of SYSTEM_FACES) {
      let d;
      try {
        d = sys.descriptor(id);
      } catch (e) {
        if (e instanceof SystemFaceRefused) continue;
        throw e;
      }
      if (d.platform !== 'android') throw new Error(`${id}: not an Android descriptor`);
      const { platform: _, ...android } = d;
      const bytes = files.read(`/system/fonts/${d.file}`).bytes;
      faces.push({ id, role: r.role, weight: r.weight, style: r.style, entry: { id, android }, axes: androidInstance(d.axes, fvarAxes(bytes, d.index)), url: fontDataUrl(bytes) });
    }
    expect(faces.some((f) => f.style === 'italic' && Object.keys(f.axes).includes('ital')), 'an italic face on a variable file with an ital axis').toBe(true);

    const browser = await launchChrome();
    const settings = (axes: Record<string, number>): string => Object.entries(axes).map(([t, v]) => `'${t}' ${v}`).join(',') || 'normal';
    const wrong: string[] = [];
    try {
      // One page per face: each carries its file as a data URL, and Roboto's 2.4 MB repeated per face exhausts one page.
      for (const f of faces) {
        const page = await browser.newPage();
        await page.setContent(`<style>.r{${f.role === 'default' ? '' : `font-family:${f.role};`}font-weight:${f.weight};font-style:${f.style}}
@font-face{font-family:"Exact";src:url("${f.url}")}
span{font-size:40px;white-space:pre}</style><div><span id="r" class="r">${TEXT}</span></div><div><span id="x" style="font-family:Exact;font-weight:400;font-style:normal;font-variation-settings:${settings(f.axes)}">${TEXT}</span></div>`);
        await systemFontReference('android', [f.entry], () => files)(page);
        const [reference, axes, loaded] = await page.evaluate(async () => {
          const spans = ['r', 'x'].map((id) => document.getElementById(id)!);
          await Promise.all(spans.map((s) => document.fonts.load(`${getComputedStyle(s).fontStyle} ${getComputedStyle(s).fontWeight} 40px ${getComputedStyle(s).fontFamily}`)));
          await document.fonts.ready;
          return [...spans.map((s) => s.getBoundingClientRect().width), [...document.fonts].filter((ff) => ff.status === 'loaded').map((ff) => ff.family)] as [number, number, string[]];
        });
        await page.close();
        expect(loaded.length, `${f.id}: the reference's face and the file at the provider's axes both load (${loaded.join(', ')})`).toBe(2);
        if (reference !== axes) wrong.push(`${f.id} (${f.entry.android!.file} ${JSON.stringify(f.axes)}): reference ${reference}px, at the provider's axes ${axes}px`);
      }
    } finally {
      await browser.close();
    }
    expect(wrong).toEqual([]);
  }, 120_000);
});
