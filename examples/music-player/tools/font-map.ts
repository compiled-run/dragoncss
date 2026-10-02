// The north star's font map (T033, T036), shared by the Dragon check (tools/check.ts) and the Chrome reference
// (tools/capture-chrome.ts), so the compiled screen and its stated reference pin the same faces from the same bytes.
import type { FontMap } from '../../../packages/dragon/src/index.ts';

const asset = (file: string): string => `vendor/fonts/${file}`;

/**
 * 'Lato' is the vendored Lato 2.015 Regular and Bold, and sans-serif is pinned to "Dragon Sans", the five static Inter 4.1 faces.
 * Face srcs are repository paths under vendor/fonts.
 */
export const FONTS: FontMap = {
  generics: {
    'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [
      { src: asset('Inter/Inter-Light.ttf'), weight: '300' }, { src: asset('Inter/Inter-Regular.ttf'), weight: '400' },
      { src: asset('Inter/Inter-Italic.ttf'), weight: '400', style: 'italic' }, { src: asset('Inter/Inter-Bold.ttf'), weight: '700' },
      { src: asset('Inter/Inter-BoldItalic.ttf'), weight: '700', style: 'italic' },
    ] },
  },
  families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: asset('Lato/Lato-Regular.ttf'), weight: '400' }, { src: asset('Lato/Lato-Bold.ttf'), weight: '700' }] } },
};

/** Every pinned face src of the map, in map order (generics, then families), each once. */
export function pinnedFaceSrcs(map: FontMap): readonly string[] {
  const out: string[] = [];
  for (const e of [...Object.values(map.generics), ...Object.values(map.families ?? {})]) {
    if (e === undefined || e.mode !== 'pinned') continue;
    for (const f of e.faces) if (!out.includes(f.src)) out.push(f.src);
  }
  return out;
}
