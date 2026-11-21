// FORM-b select in a Markless page drawn in an author web font (Lato WOFF2): the style export resolves the select's normal line
// height and its device border widths with the export's own measurer (layout.ts resolvedInput). The compiler maps ex, ch and cap
// only over Ahem, so form-b-select-measurer.test.ts covers those lengths in Lato at the engine.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ControlBox, LayoutBox, LayoutInput, LineStrut } from '@dragon/layout';
import { deviceShapedMeasurer, LU_PER_PX, NO_ENGINE_FAULTS, resolvedInput } from '@dragon/layout';
import { inSelectOptions, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { MarklessPlan } from '../src/markless-plan.ts';
import type { ExportNode } from '../src/native-style-export.ts';
import { scrollerRefusals } from '../src/native-style-export.ts';
import { fontDataOf, hostShaper, registerFace } from '../src/text-shaper-host.ts';

const LATO = new Uint8Array(readFileSync(new URL('../../dragon/test/fonts/woff/Lato-Regular.woff2', import.meta.url)));
const read = (file: string): Uint8Array => {
  if (file !== '../styles/fonts/Lato-Regular.woff2') throw new Error(`no file ${file}`);
  return LATO;
};

const FACE = "@font-face { font-family: 'Harbour Lato'; src: url('./fonts/Lato-Regular.woff2') format('woff2'); font-weight: 400; }\nbody { margin: 0; font-family: 'Harbour Lato'; color: #1d2a24; }\nselect { font: inherit; color: inherit; }\n";
const FIELD = '.page { padding: 24px; }\n.field { display: block; width: 100%; padding: 12px 14px; border: 1px solid #c9c2ad; border-radius: 10px; background: #fffdf7; }\n';

type Node = { kind: 'element'; id: string; element: string; parent: string | null; attributes: Record<string, string> } | { kind: 'text'; id: string; parent: string; text: string };
const SELECT: Node[] = [
  { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
  { kind: 'element', id: 'h3', element: 'select', parent: 'h0', attributes: { class: 'field', 'aria-label': 'Tag' } },
  { kind: 'element', id: 'h4', element: 'option', parent: 'h3', attributes: {} },
  { kind: 'text', id: 'h4:text0', parent: 'h4', text: 'Work' },
  { kind: 'element', id: 'h6', element: 'option', parent: 'h3', attributes: {} },
  { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Home' },
];

const input = (css: string, nodes: readonly Node[] = SELECT): string =>
  JSON.stringify({ version: 'markless.native-style-input/0', component: 'Tagging', nodes, css: FACE + css, states: [], fonts: [{ url: './fonts/Lato-Regular.woff2', file: '../styles/fonts/Lato-Regular.woff2' }] });

/** The export with its plan, and a measurer holding the decoded Lato it measured with. */
function exported(css: string, nodes?: readonly Node[]) {
  const out = marklessStyleExport(input(css, nodes), 'select-web-font.json', read, 'system', undefined, true);
  const ids = out.decoded.map((d) => registerFace(d.bytes));
  expect(ids.length).toBe(1);
  return { ...out, measurer: deviceShapedMeasurer(new Map(ids.map((id) => [id, fontDataOf(id)])), hostShaper) };
}

/** A plan variant's engine input at a target's device, as the device function builds it. */
function planInput(plan: MarklessPlan, k: number, viewport: { width: number; height: number }, dpr: number): LayoutInput {
  const a = plan.assignments[k] as unknown as { variant: number };
  const v = plan.variants[a.variant] as unknown as { rootFontSize: number; root: LayoutBox };
  return { viewport, devicePixelRatio: dpr, viewportUnits: { small: viewport, large: viewport, dynamic: viewport }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: v.rootFontSize, root: v.root };
}

function find(b: LayoutBox | ControlBox, id: string): LayoutBox | ControlBox | null {
  if (b.id === id) return b;
  for (const k of b.children) {
    if (k.kind !== 'box' && k.kind !== 'control') continue;
    const f = find(k, id);
    if (f !== null) return f;
  }
  return null;
}

const nodeOf = (nodes: readonly ExportNode[], id: string): ExportNode => {
  const n = nodes.find((x) => x.id === id);
  if (n === undefined) throw new Error(`no exported node ${id}`);
  return n;
};

describe('FORM-b select in a Markless page drawn in Lato WOFF2', () => {
  it('exports with the device border widths and the arrow, and the inner line height is Lato ascent + descent', () => {
    const { exported: x, measurer } = exported(FIELD);
    for (const t of ['ios', 'android'] as const) {
      const target = x.targets[t]!;
      const nodes = target.assignments[0]!.nodes;
      const select = nodeOf(nodes, 'h3');
      const b = select.borderWidths;
      expect(b !== null && ['top', 'right', 'bottom', 'left'].every((k) => (b[k] ?? 0) > 0), `${t}: ${JSON.stringify(b)}`).toBe(true);
      expect(select.writes.some((w) => w['key'] === 'dragonSelectArrow'), t).toBe(true);
      const resolved = resolvedInput(planInput(target.plan!, 0, target.viewport, target.dpr), measurer, NO_ENGINE_FAULTS);
      const box = find(resolved.root, 'h3');
      if (box === null || box.kind !== 'control' || box.control.kind !== 'select-menulist') throw new Error(`${t}: h3 is not a menulist select`);
      expect(box.control.arrowWidth, t).toBeGreaterThan(0);
      const inner = box.children.find((k): k is ControlBox => k.kind === 'control' && k.control.kind === 'select-inner');
      if (inner === undefined) throw new Error(`${t}: the select has no inner element`);
      const font = box.control.font;
      const m = measurer.metrics({ family: font.family, size: font.size, letterSpacing: 0, wordSpacing: 0, smallCaps: false });
      expect((inner.strut as LineStrut).lineHeight, t).toEqual({ kind: 'px', value: (m.ascent + m.descent) / LU_PER_PX });
      expect((m.ascent + m.descent) / LU_PER_PX, `${t}: Lato's normal line is not its em, as Ahem's is`).not.toBe(font.size);
    }
  });

  it('requires no scroll range of the clipped inner element, and still refuses a scroll container whose range is undecided', () => {
    expect(() => exported(FIELD)).not.toThrow();
    const scroller: Node[] = [SELECT[0]!, { kind: 'element', id: 'h1', element: 'div', parent: 'h0', attributes: { class: 'scroller' } }, ...SELECT.slice(1).map((n) => (n.id === 'h3' ? { ...n, parent: 'h1' } : n))];
    expect(() => exported(`${FIELD}.scroller { overflow: auto; height: 40px; }\n`, scroller)).toThrow(/overflow auto or scroll on h1: the native scroll view's range is not decided at h3: a select-menulist form control/);
    const program = { nodes: [{ id: 'list', writes: [{ kind: 'scroll-container' }] }, { id: 'h3::inner', writes: [{ kind: 'padding-box-clip' }] }] } as unknown as Parameters<typeof scrollerRefusals>[0];
    const refused = [{ id: 'list', nodeId: 'h3', detail: 'undecided' }, { id: 'h3::inner', nodeId: 'h3', detail: 'undecided' }];
    expect(scrollerRefusals(program, refused)).toEqual([refused[0]]);
  });

  it('gives an option inside a select, and their text, no box, and still requires an option anywhere else', () => {
    const { exported: x } = exported(FIELD);
    const ids = x.targets.ios!.assignments[0]!.nodes.map((n) => n.id);
    for (const id of ['h4', 'h4:text0', 'h6', 'h6:text0']) expect(ids).not.toContain(id);
    const loose: Node[] = [...SELECT, { kind: 'element', id: 'h8', element: 'option', parent: 'h0', attributes: {} }, { kind: 'text', id: 'h8:text0', parent: 'h8', text: 'Elsewhere' }];
    const shown = exported(FIELD, loose).exported.targets.ios!.assignments[0]!.nodes.map((n) => n.id);
    expect(shown).toEqual(expect.arrayContaining(['h8', 'h8:text0']));
    const nested: Node[] = [...loose, { kind: 'element', id: 'h9', element: 'optgroup', parent: 'h3', attributes: {} }, { kind: 'element', id: 'h10', element: 'option', parent: 'h9', attributes: {} }, { kind: 'text', id: 'h10:text0', parent: 'h10', text: 'Grouped' }];
    const parsed = parseMarklessStyleInput(input(FIELD, nested));
    const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
    const listed = parsed.nodes.filter((n) => inSelectOptions(byId, n)).map((n) => n.id);
    expect(listed).toEqual(['h4', 'h4:text0', 'h6', 'h6:text0', 'h9', 'h10', 'h10:text0']);
  });
});
