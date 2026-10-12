// TDEC-b (notes/T148J-tdec.md): native decorations. The compiler accepts on ios and android the solid decorations the device
// draws, and refuses, per decorated text, the rest (skip-ink intercepts: TDEC-d); the text-decoration paint module writes them on
// the inline formatting context's container box; the emitters call the module's public writer, and the support code places the rects
// with the translated text-decoration.ts after the text pass. Chrome agreement of the geometry is the decoration capture (TDEC-a);
// the device pixels are the 'decoration' point kind (device step pending).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { underlineClearsAhem } from '../src/analysis/computed-checks.ts';
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
  it('draws an Ahem underline with skip-ink auto once its offset clears the glyphs at every device scale', () => {
    // 0.2 em of 16px is 3.2px of descent: an offset of 4px clears it at DPR 1 and 4 alike, 3px does not.
    expect(codes(one('.u { text-decoration: underline; text-underline-offset: 4px; }'))).toEqual([]);
    expect(codes(one('.u { text-decoration: underline; text-underline-offset: 3px; }'))).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
    // 25% of the decorating box's 16px is 4px.
    expect(codes(one('.u { text-decoration: underline; text-underline-offset: 25%; }'))).toEqual([]);
  });
  it('refuses an underline or overline with skip-ink auto it cannot prove clear (TDEC-d), on ios and android only', () => {
    for (const css of ['.u { text-decoration: underline; }', '.u { text-decoration: overline; text-underline-offset: 20px; }']) {
      const c = one(css);
      expect(codes(c), css).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
      expect(native(c).diagnostics[0]?.message, css).toMatch(/skip-ink-intercepts: .* TDEC-d/);
      expect(native(c).outputs['web']?.kind, css).toBe('ready');
    }
  });
  it('refuses decorated text that is not visible', () => {
    const c = one('.u { text-decoration: line-through; visibility: hidden; }');
    expect(codes(c)).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
    expect(native(c).diagnostics[0]?.message).toMatch(/it is hidden/);
  });
});

describe('TDEC-b: the skip-ink proof', () => {
  const px = (value: number) => ({ kind: 'length', value, unit: 'px' }) as const;
  it('needs the band top below 0.2 em of ink plus the margin at DPR 1 and 4', () => {
    expect(underlineClearsAhem(16, { kind: 'keyword', value: 'auto' }, 16)).toBe(false);
    // auto at a tiny size: gap 1 >= 0.2 * 4 * 4 + 1/32 fails at DPR 4.
    expect(underlineClearsAhem(4, { kind: 'keyword', value: 'auto' }, 4)).toBe(false);
    expect(underlineClearsAhem(1, { kind: 'keyword', value: 'auto' }, 1)).toBe(true);
    expect(underlineClearsAhem(16, px(4), 16)).toBe(true);
    expect(underlineClearsAhem(16, px(3.2), 16)).toBe(false);
    expect(underlineClearsAhem(16, { kind: 'percentage', value: 25 }, 16)).toBe(true);
    expect(underlineClearsAhem(16, { kind: 'percentage', value: 25 }, 12)).toBe(false);
    expect(underlineClearsAhem(16, { kind: 'keyword', value: 'from-font' }, 16)).toBe(false);
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
        { text: 'u:text0', box: null, lines: ['line-through'], color: { r: 0, g: 0, b: 255, alpha: 255 }, thickness: { kind: 'auto' }, underlineOffset: { kind: 'auto' } },
        { text: 'i:text0', box: null, lines: ['line-through'], color: { r: 0, g: 0, b: 255, alpha: 255 }, thickness: { kind: 'auto' }, underlineOffset: { kind: 'auto' } },
        { text: 'i:text0', box: 'i', lines: ['underline'], color: { r: 255, g: 0, b: 0, alpha: 255 }, thickness: { kind: 'px', value: 2 }, underlineOffset: { kind: 'percent', value: 50 } },
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
    entries: [{ text: 'u:text0', box: 'i', lines: ['underline', 'line-through'], color: { r: 1, g: 2, b: 3, alpha: 255 }, thickness: { kind: 'px', value: 1.5 }, underlineOffset: { kind: 'auto' } }],
  } as never;
  it('calls the public writer with the written spec on both backends', () => {
    expect(TEXT_DECORATION_EMITTER.lines.uikit('v1', {} as never, w)).toEqual(['  dragonSetTextDecorations(t, v1, [DragonTextDecorationSpec("u:text0", "i", ["underline", "line-through"], DragonRGBA8(1, 2, 3, 255), DragonDecorationLength("px", 1.5), DragonDecorationLength("auto", 0.0))])']);
    expect(TEXT_DECORATION_EMITTER.lines['android-views']('v1', {} as never, w)).toEqual(['  dragonSetTextDecorations(t, v1, listOf(DragonTextDecorationSpec("u:text0", "i", listOf("underline", "line-through"), DragonRGBA8(1, 2, 3, 255), DragonDecorationLength("px", 1.5), DragonDecorationLength("auto", 0.0))))']);
  });
  it('reads back the spec as written, in order', () => {
    expect(TEXT_DECORATION_EMITTER.applied({} as never, 'uikit', w, 2, {} as never)).toEqual([{ text: 'u:text0', box: 'i', lines: ['underline', 'line-through'], color: [1, 2, 3, 255], thickness: ['px', 1.5], offset: ['auto', 0], ordered: true }]);
  });
  it('runs the after-text hook from the text pass and places the views with the translated decorationRects', () => {
    for (const b of ['uikit', 'android-views'] as const) {
      const files = emitNativeSupport(b);
      const all = files.map((f) => f.text).join('\n');
      expect(all, b).toContain('dragonAfterText(cv, tv, DragonTextGeometry(');
      expect(all, b).toMatch(/fun dragonAfterText|func dragonAfterText/);
      expect(all, b).toContain('  dragonAfterTextDecoration(v, tv, g)\n');
      expect(all, b).toContain('textDecoration_decorationRects(input, faults)');
      expect(files.some((f) => /DragonPaintTextDecoration\.(swift|kt)$/.test(f.path)), b).toBe(true);
    }
  });
});
