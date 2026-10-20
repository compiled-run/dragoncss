// TDEC-b (notes/T148J-tdec.md): native decorations. The compiler accepts on ios and android the solid decorations the device
// draws, and refuses, per decorated text, the rest (skip-ink intercepts beyond the Ahem slice of TDEC-d); the text-decoration paint module writes them on
// the inline formatting context's container box; the emitters call the module's public writer, and the support code places the rects
// with the translated text-decoration.ts after the text pass. Chrome agreement of the geometry is the decoration capture (TDEC-a);
// the device pixels are the 'decoration' point kind (device step pending).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { skipInkThicknessProven } from '../src/analysis/computed-checks.ts';
import { emitNativeSupport } from '../src/emit/native-support.ts';
import { TEXT_DECORATION_EMITTER } from '../src/emit/paint/text-decoration.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import type { TextDecorationWrite } from '../src/lower/paint/text-decoration.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const project = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function compile(css: string, tree: (r: SourceRef) => TreeNode[]) {
  return project().compile(inputFor(`body { font-family: Ahem; font-size: 16px; } ${css}`, tree));
}

const native = (c: object) => c as { diagnostics: { code: string; target: unknown; message: string }[]; outputs: Record<string, { kind: string }> };
const codes = (c: object): string[] => native(c).diagnostics.map((d) => `${d.code} ${String(d.target)}`);

describe('TDEC-b: what ios and android draw', () => {
  const one = (css: string) => compile(css, (r) => [el(r, 'u', 'div', ['u'], [text(r, 't', 'XX')])]);
  it('draws a line-through, and an under or overline with skip-ink none, on both targets', () => {
    const plain = compile('', (r) => [el(r, 'u', 'div', ['u'], [text(r, 't', 'XX')])]);
    expect(native(plain).outputs['ios']?.kind).not.toBe('blocked');
    for (const css of ['.u { text-decoration: line-through; }', '.u { text-decoration: underline; text-decoration-skip-ink: none; }', '.u { text-decoration: overline; text-decoration-skip-ink: none; }', '.u { text-decoration: underline overline line-through; text-decoration-skip-ink: none; text-decoration-thickness: 3px; }', '.u { text-decoration: underline; text-decoration-skip-ink: none; text-decoration-thickness: 20%; text-underline-offset: 10%; }', '.u { text-decoration: none; }']) {
      const c = one(css);
      expect(codes(c), css).toEqual([]);
      // Each target's output is what the same case without decorations gives (Android builds analysis-only here): nothing blocks it.
      for (const t of ['ios', 'android', 'web']) expect(native(c).outputs[t]?.kind, `${css} ${t}`).toBe(native(plain).outputs[t]?.kind);
    }
  });
  it('draws an Ahem underline with skip-ink auto at any offset (TDEC-d) while its thickness is one the capture proves', () => {
    for (const css of ['.u { text-decoration: underline; }', '.u { text-decoration: underline; text-underline-offset: 3px; }', '.u { text-decoration: underline; text-underline-offset: -2px; text-decoration-thickness: 3px; }', '.u { text-decoration: underline line-through; text-decoration-thickness: 15%; }']) {
      expect(codes(one(css)), css).toEqual([]);
    }
  });
  it('refuses an overline with skip-ink auto, or an underline thicker than the capture proves (TDEC-d), on ios and android only', () => {
    // 4px is 16.5 device px at DPR 4; an auto thickness of a 40px font is 16.
    for (const css of ['.u { text-decoration: overline; }', '.u { text-decoration: underline; text-decoration-thickness: 4px; }', '.u { text-decoration: underline; font-size: 40px; }']) {
      const c = one(css);
      expect(codes(c), css).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
      expect(native(c).diagnostics[0]?.message, css).toMatch(/skip-ink-intercepts: .* TDEC-d/);
      expect(native(c).outputs['web']?.kind, css).toBe('ready');
    }
  });
  it('draws double lines (TDEC-c), and refuses skip-ink auto over a double under or overline (TDEC-d) on ios and android only', () => {
    for (const css of ['.u { text-decoration: underline overline double; text-decoration-skip-ink: none; }', '.u { text-decoration: line-through double; }', '.u { text-decoration: underline; text-decoration-style: double; text-decoration-skip-ink: none; text-decoration-thickness: 15%; }']) {
      expect(codes(one(css)), css).toEqual([]);
    }
    const c = one('.u { text-decoration: underline double; }');
    expect(codes(c)).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
    expect(native(c).diagnostics[0]?.message).toMatch(/skip-ink-intercepts: .* TDEC-d/);
    expect(native(c).outputs['web']?.kind).toBe('ready');
  });
  it('accepts dotted, dashed and wavy where no line draws them, and refuses a drawn one on every target at its declaration (TDEC-c)', () => {
    for (const css of ['.u { text-decoration-style: dotted; }', '.u { text-decoration: dashed; }', '.u { text-decoration-line: none; text-decoration-style: wavy; }']) {
      const c = one(css);
      expect(codes(c), css).toEqual([]);
      expect(native(c).outputs['web']?.kind, css).toBe('ready');
    }
    for (const style of ['dotted', 'dashed', 'wavy']) {
      const c = one(`.u { text-decoration: line-through ${style}; }`);
      expect(codes(c), style).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
      expect(native(c).diagnostics[0]?.message, style).toBe(`text-decoration-style: ${style} draws the line-through of u over text u:text0, and TDEC-c draws solid and double lines only`);
    }
    // A child inherits no style: its parent's dotted line over the child's text is refused, and the child's own solid line is drawn.
    const nested = compile('.u { text-decoration: underline dotted; } .s { text-decoration: line-through; }', (r) => [el(r, 'u', 'div', ['u'], [el(r, 's', 'span', ['s'], [text(r, 't', 'XX')])])]);
    expect(native(nested).diagnostics.filter((d) => d.message.startsWith('text-decoration-style')).map((d) => d.message)).toEqual(Array(3).fill('text-decoration-style: dotted draws the underline of u over text s:text0, and TDEC-c draws solid and double lines only'));
  });
  it('refuses decorated text that is not visible', () => {
    const c = one('.u { text-decoration: line-through; visibility: hidden; }');
    expect(codes(c)).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
    expect(native(c).diagnostics[0]?.message).toMatch(/it is hidden/);
  });
});

describe('TDEC-d: the skip-ink thickness bound', () => {
  const px = (value: number) => ({ kind: 'length', value, unit: 'px' }) as const;
  it('needs the thickness at DPR 4 within 13 device px, after roundf for a length', () => {
    expect(skipInkThicknessProven({ kind: 'keyword', value: 'auto' }, 32)).toBe(true);
    expect(skipInkThicknessProven({ kind: 'keyword', value: 'auto' }, 33)).toBe(false);
    expect(skipInkThicknessProven(px(3), 16)).toBe(true);
    expect(skipInkThicknessProven(px(3.2), 16)).toBe(false);
    expect(skipInkThicknessProven({ kind: 'percentage', value: 15 }, 20)).toBe(true);
    expect(skipInkThicknessProven({ kind: 'percentage', value: 20 }, 20)).toBe(false);
    expect(skipInkThicknessProven({ kind: 'keyword', value: 'from-font' }, 16)).toBe(false);
  });
});

describe('TDEC-b: the text-decoration write', () => {
  const programs = (css: string, tree: (r: SourceRef) => TreeNode[]) => {
    const c = compile(css, tree);
    expect(codes(c)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };
  it('writes each decorated text of a formatting context on its container, the outermost decorating box first', () => {
    const p = programs('.u { text-decoration: line-through; color: rgb(0, 0, 255); } .i { text-decoration: underline; text-decoration-skip-ink: none; text-decoration-color: rgb(255, 0, 0); text-decoration-thickness: 2px; text-underline-offset: 50%; }', (r) => [el(r, 'u', 'div', ['u'], [text(r, 't', 'AB '), el(r, 'i', 'span', ['i'], [text(r, 's', 'CD')])])]);
    for (const b of ['uikit', 'android-views'] as const) {
      const writes = p[b].nodes.flatMap((n) => n.writes.filter((w) => w.kind === 'text-decoration').map((w) => [n.id, w] as const));
      expect(writes.map(([id]) => id), b).toEqual(['u']);
      const w = writes[0]?.[1] as TextDecorationWrite & { key: string; css: readonly string[] };
      expect(w.key).toBe('dragonTextDecoration');
      expect(w.css).toContain('text-decoration-line');
      expect(w.entries).toEqual([
        { text: 'u:text0', box: null, lines: ['line-through'], color: { r: 0, g: 0, b: 255, alpha: 255 }, thickness: { kind: 'auto' }, underlineOffset: { kind: 'auto' }, skipInk: true, style: 'solid' },
        { text: 'i:text0', box: null, lines: ['line-through'], color: { r: 0, g: 0, b: 255, alpha: 255 }, thickness: { kind: 'auto' }, underlineOffset: { kind: 'auto' }, skipInk: true, style: 'solid' },
        { text: 'i:text0', box: 'i', lines: ['underline'], color: { r: 255, g: 0, b: 0, alpha: 255 }, thickness: { kind: 'px', value: 2 }, underlineOffset: { kind: 'percent', value: 50 }, skipInk: false, style: 'solid' },
      ]);
      // The text nodes keep their own writes only.
      expect(p[b].nodes.filter((n) => n.kind === 'text').every((n) => n.writes.every((w) => w.kind === 'font' || w.kind === 'text-color')), b).toBe(true);
    }
  });
  it('has no write for undecorated text', () => {
    const p = programs('', (r) => [el(r, 'u', 'div', [], [text(r, 't', 'XX')])]);
    expect(p.uikit.nodes.some((n) => n.writes.some((w) => w.kind === 'text-decoration'))).toBe(false);
  });
});

describe('TDEC-b: emission and support', () => {
  const w = {
    kind: 'text-decoration',
    entries: [{ text: 'u:text0', box: 'i', lines: ['underline', 'line-through'], color: { r: 1, g: 2, b: 3, alpha: 255 }, thickness: { kind: 'px', value: 1.5 }, underlineOffset: { kind: 'auto' }, skipInk: true, style: 'double' }],
  } as never;
  it('calls the public writer with the written spec on both backends', () => {
    expect(TEXT_DECORATION_EMITTER.lines.uikit('v1', {} as never, w)).toEqual(['  dragonSetTextDecorations(t, v1, [DragonTextDecorationSpec("u:text0", "i", ["underline", "line-through"], DragonRGBA8(1, 2, 3, 255), DragonDecorationLength("px", 1.5), DragonDecorationLength("auto", 0.0), true, "double")])']);
    expect(TEXT_DECORATION_EMITTER.lines['android-views']('v1', {} as never, w)).toEqual(['  dragonSetTextDecorations(t, v1, listOf(DragonTextDecorationSpec("u:text0", "i", listOf("underline", "line-through"), DragonRGBA8(1, 2, 3, 255), DragonDecorationLength("px", 1.5), DragonDecorationLength("auto", 0.0), true, "double")))']);
  });
  it('reads back the spec as written, in order', () => {
    expect(TEXT_DECORATION_EMITTER.applied({} as never, 'uikit', w, 2, {} as never)).toEqual([{ text: 'u:text0', box: 'i', lines: ['underline', 'line-through'], color: [1, 2, 3, 255], thickness: ['px', 1.5], offset: ['auto', 0], skipInk: true, style: 'double', ordered: true }]);
  });
  it('runs the after-text hook from the text pass and places the views with the translated decorationRects', () => {
    for (const b of ['uikit', 'android-views'] as const) {
      const files = emitNativeSupport(b);
      const all = files.map((f) => f.text).join('\n');
      expect(all, b).toContain('dragonAfterText(cv, tv, DragonTextGeometry(');
      expect(all, b).toMatch(/fun dragonAfterText|func dragonAfterText/);
      expect(all, b).toContain('  dragonAfterTextDecoration(v, tv, g)\n');
      expect(all, b).toContain('textDecoration_decorationRects(input, faults)');
      // TDEC-d: skip-ink auto clips the translated skipInkClips over the Ahem ink of the text pass's code points and pens.
      expect(all, b).toContain('textDecoration_skipInkClips(r, ink, faults)');
      expect(all, b).toMatch(/textDecoration_columnClipped\(x, clipped\)/);
      expect(all, b).toMatch(/DragonTextGeometry\((id: )?id, (lines: )?geometry, (cps: )?geometryCps, (pens: )?geometryPens/);
      expect(files.some((f) => /DragonPaintTextDecoration\.(swift|kt)$/.test(f.path)), b).toBe(true);
    }
  });
});
