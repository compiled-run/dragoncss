// FORM-textarea-edit (notes/FORM-textarea-edit-spec.md): an editable <textarea> the host edits natively. Chrome 145 lays out and
// paints an editable textarea exactly as a readonly one, so the engine's readonly layout serves both; the device layout exports
// the facts the host's own text view takes (text-editors: scrollport, insets, scroll extent, line height, baseline), checked here
// against Chrome; and the styles the host view cannot match are refused under host editing. This proves the compile gate and the
// exported facts only: that UITextView and EditText wrap a value as Dragon does is the phone rung's claim (Markless side).
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic } from 'dragon';
import * as dragon from 'dragon';
import { ahemMeasurer, layout as engineLayout } from '@dragon/layout';
import { ahemFontFace, launchChrome } from '../src/chrome.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import { PLAN_DENSITIES } from '../src/markless-plan.ts';
import type { MarklessPlan } from '../src/markless-plan.ts';

const { runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };
const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

const DPRS = [1, 2, 2.625, 3] as const;
const FIELD = 'display: block; width: 60px; height: 12px; font: inherit; line-height: 12px; padding: 3px 4px; border: 1px solid #333; margin: 0 0 4px; resize: none; scrollbar-width: none; appearance: none; background-color: #fff; color: #000;';
const CSS = `body { margin: 0; font-family: Ahem; font-size: 10px; }\ntextarea { ${FIELD} }`;
/** The values the Judge named (as HTML text: &#13;&#10; is a CRLF in the source), each wrapping at the 6-character editor. Emoji are excluded: no face here holds them. */
const VALUES: readonly (readonly [string, string])[] = [
  ['hard', 'XX XX\nXXX'],
  ['trailing', 'XX XXX\n'],
  ['spaces', 'XXXX   XXXX  '],
  ['word', 'XXXXXXXXXXXXXXXX'],
  ['crlf', 'XX&#13;&#10;XX'],
  ['long', 'XX XXXX XXXXXXX XX XXX XXXX XX X\n\nXX'],
];

const page = (body: string, css = CSS): string => `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${css}\n</style>\n</head>\n<body data-dragon-id="body">\n${body}\n</body>\n</html>\n`;
/** The page as Chrome loads it: Ahem from the vendored face, which Dragon's ahem root font stands for. */
const chromePage = (body: string, css = CSS): string => page(body, `${ahemFontFace()}\n${css}`);
async function load(p: Page, html: string): Promise<void> {
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
}
const areas = (attrs: string): string => VALUES.map(([id, v]) => `<textarea data-dragon-id="${id}" id="${id}"${attrs}>${v}</textarea>`).join('\n');

function compile(id: string, html: string, hostTextEditing: boolean): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', ...(hostTextEditing ? { hostTextEditing } : {}) });
  return project.compile(fixtureToInput(id, html));
}
const errors = (c: Compiled<string>): string[] => c.diagnostics.filter((d: Diagnostic) => d.severity === 'error').map((d) => `${d.target ?? 'all'} ${d.code} ${d.message}`);

/** The engine's boxes in CSS px at a ratio. */
function boxes(c: Compiled<string>, dpr: number): Map<string, { x: number; y: number; width: number; height: number }> {
  const p = dragon.engineLayoutProjection(c, { ...ENVIRONMENT, devicePixelRatio: dpr }, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const r = engineLayout(p.input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  // The engine's units are device px at the ratio.
  const css = 64 * dpr;
  return new Map(r.boxes.map((b) => [b.id, { x: b.x / css, y: b.y / css, width: b.width / css, height: b.height / css }]));
}

type Chrome = { box: number[]; client: number[]; scroll: number[]; pad: number[]; border: number[]; lineHeight: number; shown: boolean };
async function read(p: Page, id: string): Promise<Chrome> {
  return p.evaluate((i) => {
    const t = document.getElementById(i) as HTMLTextAreaElement;
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const n = (s: string) => Number.parseFloat(s);
    return {
      box: [r.x, r.y, r.width, r.height],
      client: [t.clientLeft, t.clientTop, t.clientWidth, t.clientHeight],
      scroll: [t.scrollWidth, t.scrollHeight, t.scrollTop],
      pad: [n(cs.paddingTop), n(cs.paddingRight), n(cs.paddingBottom), n(cs.paddingLeft)],
      border: [n(cs.borderTopWidth), n(cs.borderRightWidth), n(cs.borderBottomWidth), n(cs.borderLeftWidth)],
      lineHeight: n(cs.lineHeight),
      shown: t.matches(':placeholder-shown'),
    };
  }, id);
}

describe('FORM-textarea-edit', () => {
  const browsers = new Map<number, Browser>();
  beforeAll(async () => {
    for (const dpr of DPRS) browsers.set(dpr, await launchChrome(dpr));
  }, 240_000);
  afterAll(async () => {
    for (const b of browsers.values()) await b.close();
  });

  it('Chrome lays out and paints an editable textarea as a readonly one, typed or set, at every ratio (E1-E3, E7)', async () => {
    for (const dpr of DPRS) {
      const p = await (browsers.get(dpr) as Browser).newPage({ viewport: { width: 200, height: 400 } });
      await load(p, chromePage(areas(' readonly=""')));
      const ro = await Promise.all(VALUES.map(([id]) => read(p, id)));
      const roShot = (await p.screenshot()).toString('base64');
      await load(p, chromePage(areas('')));
      const ed = await Promise.all(VALUES.map(([id]) => read(p, id)));
      expect((await p.screenshot()).toString('base64') === roShot, `dpr ${dpr}: unfocused pixels differ`).toBe(true);
      expect(ed, `dpr ${dpr}`).toEqual(ro);
      // Typing the value moves no box and gives the scroll extent of the value set.
      await load(p, chromePage('<textarea id="t"></textarea>'));
      const before = await read(p, 't');
      await p.click('#t');
      expect(await p.evaluate(() => document.getElementById('t')?.matches(':focus-visible')), `dpr ${dpr}`).toBe(true);
      await p.keyboard.type('XX XXXX XXXXXXX XX');
      const typed = await read(p, 't');
      await load(p, chromePage('<textarea id="t" readonly="">XX XXXX XXXXXXX XX</textarea>'));
      const set = await read(p, 't');
      expect([typed.box, typed.scroll[1], typed.shown], `dpr ${dpr}`).toEqual([before.box, set.scroll[1], false]);
      await p.close();
    }
  });

  it("wraps each of the Judge's values as Chrome does, editable under host editing, at every ratio", async () => {
    const c = compile('ta-edit-values', page(areas('')), true);
    expect(errors(c)).toEqual([]);
    for (const dpr of DPRS) {
      const b = boxes(c, dpr);
      const p = await (browsers.get(dpr) as Browser).newPage({ viewport: { width: 400, height: 300 } });
      await load(p, chromePage(areas('')));
      for (const [id] of VALUES) {
        const ch = await read(p, id);
        // The editor's content height (its lines x the line height) is Chrome's scroll height less the block padding.
        expect([id, (b.get(`${id}::editor`) as { height: number }).height], `dpr ${dpr}`).toEqual([id, (ch.scroll[1] as number) - (ch.pad[0] as number) - (ch.pad[2] as number)]);
      }
      await p.close();
    }
  });

  it("exports the host's text-editor facts as Chrome has them: scrollport, insets, scroll extent, line height (R1, R3)", async () => {
    const nodes = [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
      ...VALUES.flatMap(([id, v], k) => [
        { kind: 'element', id: `h${k + 1}`, element: 'textarea', parent: 'h0', attributes: { id } },
        { kind: 'text', id: `h${k + 1}:text0`, parent: `h${k + 1}`, text: v.replace('&#13;&#10;', '\r\n') },
      ]),
    ];
    const text = JSON.stringify({ version: 'markless.native-style-input/0', component: 'Editing', nodes, css: CSS, states: [] });
    const { exported } = marklessStyleExport(text, 'textarea-edit.json', undefined, 'system', undefined, true);
    let checked = 0;
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      const names = new Map(x.planNames?.[0] ?? []);
      for (const dpr of PLAN_DENSITIES[t]) {
        const out = JSON.parse(runMarklessLayout(`{"assignment":0,"dpr":${dpr},"viewport":{"width":400,"height":300},"safeArea":{"top":0,"right":0,"bottom":0,"left":0},"plan":${JSON.stringify(x.plan as MarklessPlan)}}`)) as unknown[];
        expect(out[0], `${t} ${dpr} ${JSON.stringify(out).slice(0, 300)}`).toBe('ok');
        const suffix = out.slice(3).map(decode).find((s) => Array.isArray(s) && s[0] === 'text-editors') as [string, unknown[][]] | undefined;
        expect(suffix, `${t} ${dpr}`).toBeDefined();
        const browser = browsers.get(dpr) ?? (await launchChrome(dpr));
        if (!browsers.has(dpr)) browsers.set(dpr, browser);
        const p = await browser.newPage({ viewport: { width: 400, height: 300 } });
        await load(p, chromePage(areas('')));
        for (const row of suffix![1]) {
          const id = (VALUES[Number((names.get(row[0] as string) ?? (row[0] as string)).slice(1)) - 1] as readonly [string, string])[0];
          const ch = await read(p, id);
          const [, port, insets, maxY, lineHeight] = row as [string, number[], number[], number, number];
          const border = ch.border;
          // The device layout's frames are in device px; Chrome's in CSS px (its snapped border widths and box sizes).
          const css = (v: number): number => v / dpr;
          // Chrome reports a fractional ratio's lengths through float32 rects and 6-digit computed styles, so both sides are read to 1e-4 px.
          const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
          expect([id, port.map((v) => r4(css(v)))], `${t} ${dpr}`).toEqual([id, [border[3], border[0], (ch.box[2] as number) - (border[1] as number) - (border[3] as number), (ch.box[3] as number) - (border[0] as number) - (border[2] as number)].map((v) => r4(v as number))]);
          expect([id, insets.map((v) => r4(css(v))), r4(css(maxY)), r4(css(lineHeight))], `${t} ${dpr}`).toEqual([id, ch.pad.map((v) => r4(v as number)), (ch.scroll[1] as number) - (ch.client[3] as number), ch.lineHeight]);
          checked++;
        }
        await p.close();
      }
    }
    expect(checked).toBeGreaterThan(VALUES.length);
  });

  it('compiles an editable textarea only when the host edits it, and refuses what the host view cannot match (R4)', () => {
    const one = (css: string, attrs = '', value = 'XX'): string[] =>
      errors(compile('ta-edit-refuse', page(`<textarea data-dragon-id="a"${attrs}>${value}</textarea>`, `${CSS}\ntextarea { ${css} }`), true)).filter((e) => e.startsWith('ios ') || e.startsWith('all '));
    expect(one('')).toEqual([]);
    expect(errors(compile('ta-edit-plain', page('<textarea data-dragon-id="a">XX</textarea>'), false)).filter((e) => e.includes('is an editable text control'))).toHaveLength(2);
    // A readonly textarea is Dragon's to draw, so the host-editing refusals do not apply to it.
    expect(one('text-indent: 5px;', ' readonly=""').filter((e) => e.includes('host-edited'))).toEqual([]);
    const cases: readonly (readonly [string, string, string, string])[] = [
      ['letter-spacing: 2px;', '', 'XX', 'letter-spacing: 2px on the host-edited <textarea> a'],
      ['word-spacing: 3px;', '', 'XX', 'word-spacing: 3px on the host-edited <textarea> a'],
      ['text-indent: 5px;', '', 'XX', 'text-indent: 5px on the host-edited <textarea> a'],
      ['text-align: justify;', '', 'XX', 'text-align: justify on the host-edited <textarea> a'],
      ['direction: rtl;', '', 'XX', 'direction: rtl on the host-edited <textarea> a'],
      // dir (auto included) and wrap are refused on every element by the attribute table, before the editing checks.
      ['', ' dir="auto"', 'XX', 'attribute dir on a is not supported'],
      ['', ' wrap="off"', 'XX', 'attribute wrap on a is not supported'],
      // A tab is refused for every preserved white space (tab stops are not laid out yet).
      ['', '', 'XX\tXX', 'a tab in a::editor:text0'],
      ['padding-left: 5%;', '', 'XX', 'padding-left: 5% on the host-edited <textarea> a'],
    ];
    for (const [css, attrs, value, message] of cases) expect(one(css, attrs, value), `${message} ${JSON.stringify(one(css, attrs, value))}`).toContainEqual(expect.stringContaining(message));
  });
});
