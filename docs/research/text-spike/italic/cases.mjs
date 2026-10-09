// Italic corpus (TXT1a-1 R6, notes/T056-txt1a-spec.md): the spike's Latin paragraphs (../corpus.mjs) in Inter Italic (400) and
// Bold Italic (700) from vendor/fonts/Inter, at the spike's sizes plus 23.3 px, and the spike's widths. Emits out/cases.json.
import fs from 'node:fs';
import { latin, widths } from '../corpus.mjs';
export const fonts = {
  InterItalic: { family: 'Inter', weight: 400, style: 'italic', file: 'Inter-Italic.ttf' },
  InterBoldItalic: { family: 'Inter', weight: 700, style: 'italic', file: 'Inter-BoldItalic.ttf' },
};
export const sizes = [12, 16, 17, 23.3, 24];
export function cases() {
  const out = [];
  for (const [font, f] of Object.entries(fonts))
    for (const [pid, text] of Object.entries(latin))
      for (const size of sizes) for (const width of widths)
        out.push({ id: `${font}/${pid}/${size}/${width}`, font, family: f.family, weight: f.weight, style: f.style, file: f.file, para: pid, text: text.replace(/[ \t\n]+/g, ' '), lang: 'en', size, width });
  return out;
}
if (process.argv[1].endsWith('italic/cases.mjs')) {
  const c = cases();
  fs.writeFileSync(new URL('./out/cases.json', import.meta.url), JSON.stringify(c));
  console.log(c.length, 'cases');
}
