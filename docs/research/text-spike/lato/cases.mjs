// Lato corpus (T036): the spike's Latin paragraphs (../corpus.mjs) in Lato 2.015 Regular (400) and Bold (700), at the
// spike's sizes plus the north-star demo's (0.7rem, 0.78rem, 1.35rem, 2rem at 16px), and the spike's widths. Emits out/cases.json.
import fs from 'node:fs';
import { latin, widths } from '../corpus.mjs';
export const fonts = {
  Lato: { family: 'Lato', weight: 400, file: 'Lato-Regular.ttf' },
  LatoBold: { family: 'Lato', weight: 700, file: 'Lato-Bold.ttf' },
};
export const sizes = [11.2, 12, 12.48, 16, 17, 21.6, 24, 32];
export function cases() {
  const out = [];
  for (const [font, f] of Object.entries(fonts))
    for (const [pid, text] of Object.entries(latin))
      for (const size of sizes) for (const width of widths)
        out.push({ id: `${font}/${pid}/${size}/${width}`, font, family: f.family, weight: f.weight, file: f.file, para: pid, text: text.replace(/[ \t\n]+/g, ' '), lang: 'en', size, width });
  return out;
}
if (process.argv[1].endsWith('lato/cases.mjs')) {
  const c = cases();
  fs.writeFileSync(new URL('./out/cases.json', import.meta.url), JSON.stringify(c));
  console.log(c.length, 'cases');
}
