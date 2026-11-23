// A page text that changes on the phone collapses its white space over its whole inline formatting context, as Chrome does
// (harness.ts withPhaseOne over the plan's text facts). Each case is built at its first strings, laid out on the device with its
// changed strings, and compared with Chrome and with a fresh build of the page written with those strings.
import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import type { GlyphShaper } from '@dragon/layout';
import { collapseInlineContext } from '@dragon/layout';
import { launchChrome } from '../src/chrome.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { vendorFontBytes } from '../src/font-reference.ts';
import { captureMarklessAssignment } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { marklessFontFiles, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { ExportTarget } from '../src/native-style-export.ts';
import { systemFontReference } from '../src/system-fonts/reference.ts';
import { systemFontsFor } from '../src/system-fonts/provider.ts';
import { hostShaper } from '../src/text-shaper-host.ts';

type RowTextFaults = { readonly givenTextCollapsedAlone: boolean; readonly fixedTextsAsLaidOut: boolean };
type Shaper = GlyphShaper;
const harness = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as {
  runMarklessRowsLayout(line: string, shaper: Shaper): string;
  runMarklessRowsLayoutWithFaults(line: string, shaper: Shaper, faults: RowTextFaults): string;
  marklessPhaseOneSelfCheck(line: string, faults: RowTextFaults): string;
};
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };
const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

/** The phone's shaper for text the plan did not record: the page's author face as the build shapes it, else the platform's. */
const deviceShaper = (t: 'ios' | 'android', dpr: number): Shaper => {
  const system = systemFontsFor(t, dpr).shaper;
  return { shape: (face, ...rest) => (face.startsWith('sha256:') ? hostShaper : system).shape(face, ...rest) };
};

const NO_FAULTS: RowTextFaults = { givenTextCollapsedAlone: false, fixedTextsAsLaidOut: false };
const ALONE: RowTextFaults = { givenTextCollapsedAlone: true, fixedTextsAsLaidOut: false };
const LAID_OUT: RowTextFaults = { givenTextCollapsedAlone: false, fixedTextsAsLaidOut: true };

describe('phase I over a context, against the strings Chrome 145 keeps (the probe in the spec, Ahem at 10px)', () => {
  const cases: readonly (readonly [string, readonly (string | null)[], readonly (string | null)[]])[] = [
    ['a trailing space beside a span stays', ['Total 3 taps, ', 'more'], ['Total 3 taps, ', 'more']],
    ['a leading space after a span stays', ['more', ' 3 taps'], ['more', ' 3 taps']],
    ['a double space across a boundary keeps the first', ['a ', ' b'], ['a ', 'b']],
    ['an empty text between spans adds nothing', ['a', '', 'b'], ['a', '', 'b']],
    ['a space-only text between spans goes', ['a ', ' ', 'b'], ['a ', '', 'b']],
    ['the start of the block', [' a', 'b'], ['a', 'b']],
    ['the end of the block', ['a', 'b '], ['a', 'b']],
    ['nbsp at both edges stays', ['\u00a0a\u00a0', 'b'], ['\u00a0a\u00a0', 'b']],
    ['a space before <br> hangs and one after it goes', ['a ', null, ' b', 'c'], ['a ', null, 'b', 'c']],
    ['a segment break is a space', ['a\n', 'b'], ['a ', 'b']],
    ['a segment break next to U+200B goes', ['a\n', '\u200bb'], ['a', '\u200bb']],
    ['a segment break between CJK characters stays a space', ['一\n', '二'], ['一 ', '二']],
    ['the spaces on both sides of an atomic inline stay', ['a ', '\ufffc', ' b'], ['a ', '\ufffc', ' b']],
    ['a context of white space only keeps nothing', [' ', '  '], ['', '']],
    ['tabs across a boundary', ['a\t', '\tb'], ['a ', 'b']],
    ['a text that stops ending in a space gives the span its own back', ['Total 4', ' more'], ['Total 4', ' more']],
    ['a text that ends in a space takes the span\'s', ['Total 3 ', ' more'], ['Total 3 ', 'more']],
  ];
  for (const [name, runs, want] of cases) it(name, () => expect(collapseInlineContext(runs)).toEqual(want));
});

/** Vendored font bytes with another head checkSumAdjustment: the same face in a file no Dragon checkout bundles. */
function authorCopy(file: string): Uint8Array {
  const bytes = new Uint8Array(vendorFontBytes(file));
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = Array.from({ length: d.getUint16(4) }, (_, i) => 12 + i * 16).find((e) => d.getUint32(e) === 0x68656164);
  if (at === undefined) throw new Error(`${file} has no head table`);
  const adjustment = d.getUint32(at + 8) + 8;
  d.setUint32(adjustment, d.getUint32(adjustment) ^ 1);
  return bytes;
}

const FONTS = { Ahem: authorCopy('Ahem.ttf'), Lato: authorCopy('Lato/Lato-Regular.ttf') } as const;
type Font = keyof typeof FONTS;

type Node = MarklessStyleInput['nodes'][number];
const el = (id: string, element: string, parent: string, cls?: string): Node => ({ kind: 'element', id, element, parent, attributes: cls === undefined ? {} : { class: cls } });
const tx = (id: string, parent: string, text: string): Node => ({ kind: 'text', id, parent, text });

/**
 * A page of one shrink-to-fit bordered paragraph h1 holding `nodes`, in `font` at 16px. Its inline boxes have no border, which the
 * engine refuses (INL1b), and their own letter-spacing, as the engine refuses adjacent texts in one font (Blink shapes them as one
 * run): a space's width then shows which box owns it.
 */
function page(font: Font, nodes: readonly Node[], css = ''): string {
  return JSON.stringify({
    version: 'markless.native-style-input/0',
    component: 'Space',
    nodes: [{ kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} }, el('h1', 'p', 'h0'), ...nodes],
    css: `@font-face { font-family: 'Space'; src: url('./fonts/Space.ttf') format('truetype'); }
body { margin: 0; font-family: 'Space', sans-serif; font-size: 16px; line-height: 20px; }
main { padding: 8px; }
p { display: inline-block; margin: 0; border: 1px solid #000000; }
span, i { letter-spacing: 2px; font-style: normal; }
b { letter-spacing: 5px; font-weight: 400; }
${css}`,
    states: [],
    fonts: [{ url: './fonts/Space.ttf', file: `../fonts/${font}.ttf` }],
  });
}
const reader = (font: Font) => (file: string): Uint8Array => {
  if (file !== `../fonts/${font}.ttf`) throw new Error(`no file ${file}`);
  return FONTS[font];
};

type Case = { readonly name: string; readonly nodes: readonly Node[]; readonly given: Readonly<Record<string, string>>; readonly css?: string };
const CASES: readonly Case[] = [
  // A control: the page at its build strings, which only the build lays out.
  { name: '0 unchanged', nodes: [tx('h1:text0', 'h1', 'Total 2 taps,'), el('h2', 'span', 'h1'), tx('h2:text0', 'h2', 'more')], given: {} },
  { name: '1 trailing space beside a span', nodes: [tx('h1:text0', 'h1', 'Total 2 taps,'), el('h2', 'span', 'h1'), tx('h2:text0', 'h2', 'more')], given: { 'h1:text0': 'Total 3 taps, ' } },
  { name: '3 double space across a boundary', nodes: [tx('h1:text0', 'h1', 'a'), el('h2', 'span', 'h1'), tx('h2:text0', 'h2', ' b')], given: { 'h1:text0': 'a ' } },
  { name: '3 double space across a close tag', nodes: [el('h2', 'span', 'h1'), tx('h2:text0', 'h2', 'a'), tx('h1:text1', 'h1', ' b')], given: { 'h2:text0': 'a ' } },
  { name: '5 a fixed space-only text phase I dropped comes back', nodes: [el('h2', 'b', 'h1'), tx('h2:text0', 'h2', 'x '), tx('h1:text1', 'h1', ' '), el('h3', 'i', 'h1'), tx('h3:text0', 'h3', 'b')], given: { 'h2:text0': 'x' } },
  { name: '8 from ending in a space to not', nodes: [tx('h1:text0', 'h1', 'Total 3 '), el('h2', 'span', 'h1'), tx('h2:text0', 'h2', ' more')], given: { 'h1:text0': 'Total 4' } },
  { name: '8 from not ending in a space to ending in one', nodes: [tx('h1:text0', 'h1', 'Total 4'), el('h2', 'span', 'h1'), tx('h2:text0', 'h2', ' more')], given: { 'h1:text0': 'Total 3 ' } },
];

/** The device ratios each target's plan records text at, as the Judge ruled: 2 and 3, and 2.625 on Android. */
const RATIOS: readonly (readonly ['ios' | 'android', number])[] = [['ios', 2], ['ios', 3], ['android', 2], ['android', 2.625], ['android', 3]];
const VIEWPORT = { width: 402, height: 778 };

/** Each box of a variant tree (plan JSON) with its parent box. */
function parents(v: unknown, parent: string | null, out: Map<string, string | null>): void {
  if (Array.isArray(v)) {
    for (const item of v) parents(item, parent, out);
    return;
  }
  if (v === null || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  const id = typeof o['id'] === 'string' ? (o['id'] as string) : null;
  if (id !== null) out.set(id, parent);
  for (const [k, value] of Object.entries(o)) if (k !== 'style') parents(value, id ?? parent, out);
}

/** The device line for a case's changed page texts on target `x` at ratio dpr. */
function line(x: ExportTarget, dpr: number, given: Readonly<Record<string, string>>): string {
  const names = new Map((x.planNames?.[0] ?? []).map(([d, m]) => [m, d]));
  return JSON.stringify({ assignment: 0, dpr, viewport: VIEWPORT, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, rows: [], texts: Object.entries(given).map(([id, text]) => [names.get(id) ?? id, text]) });
}

/** The device's absolute boxes, by input id, of a layout result on target x. */
function deviceBoxes(out: unknown[], x: ExportTarget): (id: string) => number[] | undefined {
  if (out[0] !== 'ok') throw new Error(JSON.stringify(out));
  const names = new Map((x.planNames?.[0] ?? []).map(([d, m]) => [m, d]));
  const boxes = new Map((out[2] as unknown[][]).map((n) => [n[0] as string, decode(n[1]) as number[]]));
  const tree = new Map<string, string | null>();
  parents((x.plan!.variants[x.plan!.assignments[0]!.variant] as { root: unknown }).root, null, tree);
  const abs = (id: string): number[] | undefined => {
    const own = boxes.get(id);
    if (own === undefined) return undefined;
    const p = tree.get(id) ?? null;
    const pa = p === null ? undefined : abs(p);
    return pa === undefined ? own : [pa[0]! + own[0]!, pa[1]! + own[1]!, own[2]!, own[3]!];
  };
  return (id) => abs(names.get(id) ?? id);
}

const written = (text: string, given: Readonly<Record<string, string>>): MarklessStyleInput => {
  const input = parseMarklessStyleInput(text);
  return { ...input, nodes: input.nodes.map((n) => (n.kind === 'text' && given[n.id] !== undefined ? { ...n, text: given[n.id]! } : n)) };
};

/** Every element of a case's written-out page where Chrome draws it more than GATE_DEVICE_PX away from the device. */
function offFromChrome(device: (id: string) => number[] | undefined, capture: Awaited<ReturnType<typeof captureMarklessAssignment>>, w: MarklessStyleInput, t: 'ios' | 'android', dpr: number): string[] {
  const elements = new Set(w.nodes.filter((n) => n.kind === 'element').map((n) => n.id));
  // The iOS target measures faces as Safari does (markless-style-compare.ts:559-560), so Chrome cannot judge an iOS inline box's height.
  const inline = new Set(w.nodes.filter((n) => n.kind === 'element' && t === 'ios' && ['span', 'b', 'i'].includes(n.element)).map((n) => n.id));
  const off: string[] = [];
  let seen = 0;
  for (const c of capture.nodes) {
    if (c.kind !== 'element' || !c.hasBox || !elements.has(c.id)) continue;
    seen++;
    const d = device(c.id);
    const edges = inline.has(c.id) ? [0, 2] : [0, 1, 2, 3];
    const chrome = [c.x, c.y, c.width, c.height].map((v) => v * dpr);
    if (d === undefined) off.push(`${c.id}: Chrome has a box, the device none`);
    else if (Math.max(...edges.map((i) => Math.abs(chrome[i]! - d[i]!))) > GATE_DEVICE_PX) off.push(`${c.id}: Chrome ${JSON.stringify(chrome.map((v) => Math.round(v * 100) / 100))}, device ${JSON.stringify(d)}`);
  }
  if (seen !== elements.size) off.push(`Chrome drew ${seen} of the ${elements.size} elements`);
  return off;
}

describe('a changed page text beside inline boxes, on the device, against Chrome and against the build', () => {
  // Which case each planted fault of the pass misses Chrome in, by font: a fault must miss Chrome somewhere in each.
  const missed = new Map<string, Set<string>>();
  for (const font of ['Ahem', 'Lato'] as const) {
    for (const c of CASES) {
      it(`${c.name}, in ${font}, at ratios 2 and 3 (and 2.625 on Android)`, async () => {
        const text = page(font, c.nodes, c.css);
        const { exported } = marklessStyleExport(text, 'space.json', reader(font), 'system', undefined, true);
        const w = written(text, c.given);
        const files = new Map(marklessFontFiles(w, reader(font)).map((f) => [f.url, f.bytes]));
        for (const t of ['ios', 'android'] as const) expect(harness.marklessPhaseOneSelfCheck(JSON.stringify(exported.targets[t]!.plan), NO_FAULTS), t).toBe('["ok"]');
        const browsers = new Map<number, Browser>();
        try {
          for (const [t, dpr] of RATIOS) {
            const x = exported.targets[t]!;
            const shaper = deviceShaper(t, dpr);
            const device = deviceBoxes(JSON.parse(harness.runMarklessRowsLayout(line(x, dpr, c.given), shaper)) as unknown[], x);
            // The build of the page written with the changed strings, on the same device.
            const at = { viewport: VIEWPORT, dpr };
            const built = marklessStyleExport(JSON.stringify(w), 'space.json', reader(font), 'system', { ios: at, android: at }).exported.targets[t]!;
            const byId = new Map(built.assignments[0]!.nodes.map((n) => [n.id, n]));
            const absBuilt = (id: string): number[] => {
              const n = byId.get(id)!;
              const f = n.frame!;
              if (n.parent === null || !byId.has(n.parent) || byId.get(n.parent)!.frame === null) return [f.x, f.y, f.width, f.height];
              const p = absBuilt(n.parent);
              return [p[0]! + f.x, p[1]! + f.y, f.width, f.height];
            };
            for (const n of w.nodes) if (n.kind === 'element' && byId.get(n.id)?.frame != null) expect(device(n.id), `${t} ${dpr}x ${n.id} against the build`).toEqual(absBuilt(n.id));
            let browser = browsers.get(dpr);
            if (browser === undefined) {
              browser = await launchChrome(dpr);
              browsers.set(dpr, browser);
            }
            const capture = await captureMarklessAssignment(browser, w, { ...x, dpr, viewport: VIEWPORT }, x.assignments[0]!.values, 'light', { mode: 'system', files, prepare: systemFontReference(t, exported.systemFonts ?? []) });
            expect(offFromChrome(device, capture, w, t, dpr), `${t} at ${dpr}x`).toEqual([]);
            for (const [name, faults] of [['givenTextCollapsedAlone', ALONE], ['fixedTextsAsLaidOut', LAID_OUT]] as const) {
              const out = JSON.parse(harness.runMarklessRowsLayoutWithFaults(line(x, dpr, c.given), shaper, faults)) as unknown[];
              if (offFromChrome(deviceBoxes(out, x), capture, w, t, dpr).length > 0) missed.set(`${name} ${font}`, new Set([...(missed.get(`${name} ${font}`) ?? []), c.name.split(' ')[0]!]));
            }
          }
        } finally {
          for (const b of browsers.values()) await b.close();
        }
      });
    }
    // The planted faults, through Chrome alone. Case 3 holds no fixed text whose source differs from its laid-out string, so only
    // the fault that stops collapsing the context misses it; case 5's restored space needs both the insertion and the collapse.
    it(`the planted faults of the pass miss Chrome, in ${font}`, () => {
      expect([...(missed.get(`givenTextCollapsedAlone ${font}`) ?? [])].sort()).toEqual(['1', '3', '5', '8']);
      expect([...(missed.get(`fixedTextsAsLaidOut ${font}`) ?? [])].sort()).toEqual(['5', '8']);
    });
  }

  it('fails the self-check with givenTextCollapsedAlone, and passes it with fixedTextsAsLaidOut, which only a changed neighbour shows', () => {
    const plans = CASES.map((c) => marklessStyleExport(page('Ahem', c.nodes, c.css), 'space.json', reader('Ahem'), 'system', undefined, true).exported.targets.android!.plan);
    // Each case's plan carries the facts the pass reads: a dropped text (case 5) and a source that differs from its text (cases 3, 8).
    expect(plans.flatMap((p) => p!.texts ?? []).filter((r) => r.length === 5).length).toBeGreaterThan(0);
    expect(plans.flatMap((p) => p!.texts ?? []).filter((r) => r.length === 3).length).toBeGreaterThan(0);
    // Collapsed alone, a fixed " b" beside "a" loses its leading space, which the build kept.
    expect(plans.some((p) => harness.marklessPhaseOneSelfCheck(JSON.stringify(p), ALONE).startsWith('["differs"'))).toBe(true);
    // At the build's own strings phase I gives its own output again, and a dropped text only ever gave a space another text kept.
    for (const p of plans) expect(harness.marklessPhaseOneSelfCheck(JSON.stringify(p), LAID_OUT)).toBe('["ok"]');
  });
});

describe('what the phone refuses by name instead of laying out', () => {
  const run = (text: string, given: Readonly<Record<string, string>>): unknown[] => {
    const x = marklessStyleExport(text, 'space.json', reader('Ahem'), 'system', undefined, true).exported.targets.android!;
    return JSON.parse(harness.runMarklessRowsLayout(line(x, 2.625, given), deviceShaper('android', 2.625))) as unknown[];
  };

  // The hosts make no view for a text with no box at build time (Markless StyleExport.kt and StyleExport.swift draw only the
  // export's framed nodes), so a text empty at build time stays empty, beside other content or alone in its box.
  it('refuses a text that was empty at build time, and keeps it empty', () => {
    for (const nodes of [[tx('h1:text0', 'h1', ''), el('h2', 'span', 'h1'), tx('h2:text0', 'h2', 'b')], [tx('h1:text0', 'h1', '')]]) {
      const text = page('Ahem', nodes);
      const got = run(text, { 'h1:text0': 'x ' });
      expect(got[0], JSON.stringify(got)).toBe('harness-error');
      expect(got[1]).toContain('had no text box at build time');
      expect(run(text, { 'h1:text0': '' })[0]).toBe('ok');
    }
    // Alone in its box, the empty text's paragraph has no strut, so the plan carries the one it would take with text.
    const plan = marklessStyleExport(page('Ahem', [tx('h1:text0', 'h1', '')]), 'space.json', reader('Ahem'), 'system', undefined, true).exported.targets.android!.plan!;
    expect((plan.texts ?? []).filter((r) => r.length === 7).map((r) => r[5])).toEqual(['h1']);
  });

  it('refuses U+000D and U+000C in a changed text, which Chrome does not collapse when script sets them', () => {
    const text = page('Ahem', CASES[0]!.nodes);
    expect(run(text, { 'h1:text0': 'a\rb' })[1]).toContain('U+000D');
    expect(run(text, { 'h1:text0': 'a\fb' })[1]).toContain('U+000C');
  });

  it('refuses a fixed capitalize text right after a changed one, and keeps one after a fixed text', () => {
    const nodes = [tx('h1:text0', 'h1', 'one'), el('h2', 'span', 'h1', 'cap'), tx('h2:text0', 'h2', 'word'), el('h3', 'p', 'h0'), tx('h3:text0', 'h3', 'two ')];
    const text = page('Ahem', nodes, '.cap { text-transform: capitalize; }');
    const got = run(text, { 'h1:text0': 'one-' });
    expect(got[0], JSON.stringify(got)).toBe('harness-error');
    expect(got[1]).toContain('capitalize');
    expect(run(text, { 'h3:text0': 'three' })[0]).toBe('ok');
  });
});
