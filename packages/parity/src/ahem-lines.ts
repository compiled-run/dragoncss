// Ahem text lines as the device's text pass hands them to the after-text hooks (TXT-FX): per line the code points, the absolute
// device-px glyph pens, the zoomed size and the baseline, placed as pixel-reference.ts glyphLines places the glyphs. Kept apart from
// pixel-reference.ts (whose paint-samples registry reads paint-samples/text-shadow.ts, which reads this), so a test can import the
// text-shadow samples first.
import type { LayoutBox } from '@dragon/layout';
import { pieceGlyphs, zoomFontSize } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import { engineTextLines } from './line-breaks.ts';
import { glyphMeasurer } from './native-host.ts';

/** Each text leaf's css font family and size and its text, by text id. */
export function cssFontSizes(root: LayoutBox): Map<string, { family: string; size: number; text: string }> {
  const out = new Map<string, { family: string; size: number; text: string }>();
  // Text leaves sit in their block container or, through any depth of inline boxes, inside it (INL1a).
  const inline = (c: Exclude<LayoutBox['children'][number], LayoutBox>): void => {
    if (c.kind === 'text') out.set(c.id, { family: c.font.family, size: c.font.size, text: c.text });
    else if (c.kind === 'inline') for (const k of c.children) inline(k);
  };
  const walk = (b: LayoutBox): void => {
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else inline(c);
    }
  };
  walk(root);
  return out;
}

/** One line of Ahem text as the device's after-text hook sees it: code points, absolute device-px pens, zoomed size and baseline. */
export type AhemLineInput = { readonly id: string; readonly text: string; readonly cps: readonly number[]; readonly xs: readonly number[]; readonly size: number; readonly baseline: number };

/** Every Ahem text line of a program at a DPR, placed as glyphLines places it (the inputs of the translated ahemLineInk). */
export function ahemLineInputs(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): AhemLineInput[] {
  const input = programInput(p, viewport, dpr);
  const sizes = cssFontSizes(input.root);
  const m = glyphMeasurer();
  const out: AhemLineInput[] = [];
  for (const t of engineTextLines(input, m)) {
    const css = sizes.get(t.id);
    if (css === undefined) throw new Error(`no text leaf ${t.id}`);
    if (css.family !== 'Ahem') continue;
    const metrics = m.metrics(t.textFont);
    for (const [j, line] of t.lines.entries()) {
      const start = [...css.text.slice(0, line.start)].length;
      const shaped = pieceGlyphs(m, css.text, t.textFont, start, start + line.cps.length);
      if (!shaped.ok) throw new Error(`${t.id} line ${j}: ${shaped.reason}`);
      if (shaped.xs.length !== line.cps.length) throw new Error(`${t.id} line ${j}: ${shaped.xs.length} glyphs for ${line.cps.length} code points`);
      const xs = line.cps.map((_cp, n) => line.rect.x / 64 + (shaped.xs[n] as number) + (line.shifts.length === 0 ? 0 : (line.shifts[n] as number)));
      out.push({ id: `${t.id}:line${j}`, text: t.id, cps: [...line.cps], xs, size: zoomFontSize(css.size, dpr), baseline: line.snapped.top + metrics.ascent / 64 });
    }
  }
  return out;
}
