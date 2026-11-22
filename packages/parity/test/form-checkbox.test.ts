// FORM-checkbox: Chrome 145's themed checkbox against Dragon's drawing of it (layout controls.ts checkboxMarks, forms/checkbox.ts
// checkboxColors) at DPR 1, 2, 3 and 2.625, the refusals the slice keeps, and the tap path a host builds on: a tap on the label's text
// hits the text inside the label in Chrome and in the hit table, and Chrome toggles the checkbox's form value and its dirty
// checkedness from it.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkboxMarks } from '@dragon/layout';
import type { CheckboxMarks } from '@dragon/layout';
import { createProjectWith, NO_FAULTS } from 'dragon';
import type { Rgba8 } from '../../dragon/src/css/color.ts';
import { checkboxColors } from '../../dragon/src/forms/checkbox.ts';
import type { CheckboxColors } from '../../dragon/src/forms/checkbox.ts';
import { launchChrome } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { caseHitTable } from '../src/hit-capture.ts';
import { nativeCases } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { hitTest, NO_HIT_FAULTS } from '../../layout/src/rt-hit.ts';

const DPRS = [1, 2, 3, 2.625] as const;
const WHITE: Rgba8 = { r: 255, g: 255, b: 255, alpha: 255 };

type Variant = { readonly name: string; readonly width: number; readonly height: number; readonly checked: boolean; readonly accent: Rgba8 | null };
const ORANGE: Rgba8 = { r: 194, g: 65, b: 12, alpha: 255 };
const LIGHT_ORANGE: Rgba8 = { r: 251, g: 146, b: 60, alpha: 255 };
const VARIANTS: readonly Variant[] = [
  { name: '13 unchecked', width: 13, height: 13, checked: false, accent: null },
  { name: '13 checked', width: 13, height: 13, checked: true, accent: null },
  { name: '22 unchecked accent', width: 22, height: 22, checked: false, accent: ORANGE },
  { name: '22 checked accent', width: 22, height: 22, checked: true, accent: ORANGE },
  { name: '22 checked light accent', width: 22, height: 22, checked: true, accent: LIGHT_ORANGE },
  { name: '22 unchecked light accent', width: 22, height: 22, checked: false, accent: LIGHT_ORANGE },
  { name: '30x22 checked', width: 30, height: 22, checked: true, accent: null },
];
const css = (c: Rgba8): string => `rgb(${c.r}, ${c.g}, ${c.b})`;

type Pixels = { readonly width: number; readonly data: readonly number[] };

/** Signed distance from (px, py) to a rounded rect (negative inside). */
function roundRectDistance(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const k = Math.min(r, w / 2, h / 2);
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - k);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - k);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - k;
}

/** Whether (px, py) is inside the check's butt-capped stroke by at least 1 px, or outside it by at least 1 px (miter joins allowed for). */
function checkCover(m: CheckboxMarks, px: number, py: number): 'in' | 'out' | 'edge' {
  const p = m.check;
  let inside = false;
  let nearest = Infinity;
  for (let s = 0; s < 2; s++) {
    const [ax, ay, bx, by] = [p[2 * s] as number, p[2 * s + 1] as number, p[2 * s + 2] as number, p[2 * s + 3] as number];
    const len = Math.hypot(bx - ax, by - ay);
    const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len;
    const perp = Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / len;
    if (t >= 1 && t <= len - 1 && perp <= m.checkWidth / 2 - 1) inside = true;
    const tc = Math.max(0, Math.min(len, t));
    nearest = Math.min(nearest, Math.hypot(px - (ax + ((bx - ax) * tc) / len), py - (ay + ((by - ay) * tc) / len)));
  }
  if (inside) return 'in';
  const joint = Math.hypot(px - (p[2] as number), py - (p[3] as number));
  return nearest >= m.checkWidth / 2 + 1 && joint >= 2 * m.checkWidth + 1 ? 'out' : 'edge';
}

/** The pixels Dragon's drawing decides with a 1 px margin, and how many of them Chrome's screenshot paints otherwise. */
function compare(shot: Pixels, v: Variant, dpr: number, colors: CheckboxColors): { readonly judged: number; readonly wrong: string[] } {
  const w = Math.round(v.width * dpr);
  const h = Math.round(v.height * dpr);
  const m = checkboxMarks(w, h, dpr);
  const wrong: string[] = [];
  let judged = 0;
  for (let y = 0; y < h + 4; y++) {
    for (let x = 0; x < w + 4; x++) {
      const [cx, cy] = [x + 0.5, y + 0.5];
      // The border is a stroke of width bw centred on the square inset bw / 2 with radius r: its outer edge is the square with radius
      // r + bw / 2, its inner edge the square inset bw with radius r - bw / 2; the background is the square inset 0.2 zoom with radius r.
      const bw = m.borderWidth;
      const fill = roundRectDistance(cx, cy, m.x, m.y, m.side, m.side, m.radius);
      const strokeOuter = roundRectDistance(cx, cy, m.x, m.y, m.side, m.side, m.radius + bw / 2);
      const background = roundRectDistance(cx, cy, m.x + m.backgroundInset, m.y + m.backgroundInset, m.side - 2 * m.backgroundInset, m.side - 2 * m.backgroundInset, m.radius);
      const outer = v.checked ? Math.min(fill, background) : Math.min(strokeOuter, background);
      let want: Rgba8 | null = null;
      if (outer >= 1) want = WHITE;
      else if (v.checked && fill <= -1) {
        const c = checkCover(m, cx, cy);
        want = c === 'in' ? colors.checked.check : c === 'out' ? colors.checked.fill : null;
      } else if (!v.checked) {
        const inner = roundRectDistance(cx, cy, m.x + bw, m.y + bw, m.side - 2 * bw, m.side - 2 * bw, Math.max(0, m.radius - bw / 2));
        if (inner <= -1) want = colors.unchecked.background;
        else if (inner >= 1 && strokeOuter <= -1) want = colors.unchecked.border;
      }
      if (want === null) continue;
      judged++;
      const i = (y * shot.width + x) * 4;
      const got = [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
      if (got[0] !== want.r || got[1] !== want.g || got[2] !== want.b) wrong.push(`(${x}, ${y}) ${got.join(',')} want ${want.r},${want.g},${want.b}`);
    }
  }
  return { judged, wrong };
}

const compile = (html: string, interactionLanes = false): string[] =>
  createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, interactionLanes })
    .compile(fixtureToInput('form-checkbox', html))
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message);

const page = (style: string, body: string): string =>
  `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\n* { box-sizing: border-box; }\ninput { display: block; }\n${style}\n</style>\n</head>\n<body data-dragon-id="body">${body}</body>\n</html>\n`;
const NOTES_ROW = '<form data-dragon-id="f"><label data-dragon-id="l" class="check"><input data-dragon-id="c" type="checkbox" name="pinned"><span data-dragon-id="t">Pin to the top</span></label></form>';
const NOTES_CSS = '.check { display: flex; align-items: center; gap: 10px; min-height: 44px; } .check input { width: 22px; height: 22px; accent-color: #c2410c; } :focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }';

describe("FORM-checkbox: Chrome's themed checkbox", () => {
  const browsers = new Map<number, Browser>();
  beforeAll(async () => {
    for (const dpr of DPRS) browsers.set(dpr, await launchChrome(dpr));
  }, 240_000);
  afterAll(async () => {
    for (const b of browsers.values()) await b.close();
  });

  async function shot(dpr: number, v: Variant, dir: 'ltr' | 'rtl' = 'ltr'): Promise<Pixels> {
    const b = browsers.get(dpr) as Browser;
    const p = await b.newPage({ viewport: { width: 40, height: 40 }, deviceScaleFactor: dpr });
    await p.setContent(`<!DOCTYPE html><html dir="${dir}"><body style="margin:0;background:#fff"><input type="checkbox" ${v.checked ? 'checked' : ''} style="display:block;position:absolute;left:0;top:0;margin:0;width:${v.width}px;height:${v.height}px;${v.accent === null ? '' : `accent-color:${css(v.accent)}`}"></body></html>`);
    const png = (await p.screenshot({ clip: { x: 0, y: 0, width: 40, height: 40 } })).toString('base64');
    const decoded = await p.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      return { width: img.width, data: Array.from(g.getImageData(0, 0, img.width, img.height).data) };
    }, png);
    await p.close();
    return decoded;
  }

  for (const dpr of DPRS) {
    it(`paints every pixel Dragon's drawing decides as Chrome does at DPR ${dpr}`, async () => {
      for (const v of VARIANTS) {
        const r = compare(await shot(dpr, v), v, dpr, checkboxColors(v.accent, { checkboxLightCheckOnLightAccent: false }));
        expect(r.judged, `${v.name} @${dpr}`).toBeGreaterThan(v.width * dpr * 2);
        expect(r.wrong.slice(0, 5), `${v.name} @${dpr}`).toEqual([]);
      }
    });
  }

  it('draws the check unmirrored in rtl, as Chrome does', async () => {
    const v = VARIANTS[3] as Variant;
    expect(compare(await shot(2, v, 'rtl'), v, 2, checkboxColors(v.accent, { checkboxLightCheckOnLightAccent: false })).wrong).toEqual([]);
  });

  it('catches the planted checkboxLightCheckOnLightAccent, which keeps a white check under a light accent', async () => {
    const v = VARIANTS[4] as Variant;
    expect(compare(await shot(2, v), v, 2, checkboxColors(v.accent, { checkboxLightCheckOnLightAccent: true })).wrong.length).toBeGreaterThan(10);
  });

  it("compiles the notes form's checkbox row with its :focus-visible rule, and refuses :hover and :active on the checkbox", () => {
    expect(compile(page(NOTES_CSS, NOTES_ROW), true)).toEqual([]);
    expect(compile(page(`${NOTES_CSS} .check:hover { background-color: #eee; }`, NOTES_ROW), true)).toEqual([]);
    for (const pseudo of ['hover', 'active']) {
      const got = compile(page(`${NOTES_CSS} input:${pseudo} { outline: 1px solid red; }`, NOTES_ROW), true);
      expect(got, pseudo).toContainEqual(expect.stringMatching(new RegExp(`^:${pseudo} on the themed checkbox c is not supported`)));
    }
  });

  it('keeps a dark colour scheme, :checked and a zoom refused', () => {
    expect(compile(page('input { color-scheme: dark; }', '<input data-dragon-id="c" type="checkbox">')).length).toBeGreaterThan(0);
    expect(compile(page('input:checked { outline: 1px solid red; }', '<input data-dragon-id="c" type="checkbox">')).length).toBeGreaterThan(0);
    expect(compile(page('body { zoom: 2; }', '<input data-dragon-id="c" type="checkbox">'))).toContainEqual(expect.stringMatching(/^zoom: 2 on body zooms <input type=checkbox> c/));
    expect(compile(page('input { display: block; width: 2px; height: 2px; }', '<input data-dragon-id="c" type="checkbox">'))).toContainEqual(expect.stringMatching(/^width: 2px on <input type=checkbox> c is not supported: Chrome draws a checkbox of 2px or less as a plain square/));
  });

  it("toggles from a tap on the label's text, which the hit table names as Chrome does, and keeps the user's checkedness over the attribute", async () => {
    const b = browsers.get(1) as Browser;
    const ctx = await b.newContext({ hasTouch: true, viewport: { width: ENVIRONMENT.viewport.width, height: ENVIRONMENT.viewport.height } });
    try {
      const p = await ctx.newPage();
      await p.setContent(page(NOTES_CSS, NOTES_ROW));
      const at = await p.evaluate(() => {
        const r = (document.querySelector('[data-dragon-id="t"]') as HTMLElement).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const data = (): Promise<string> => p.evaluate(() => [...new FormData(document.querySelector('form') as HTMLFormElement).entries()].map(([k, v]) => `${k}=${String(v)}`).join('&'));
      const hit = (): Promise<string | null> => p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-dragon-id') ?? null, at);
      expect(await hit()).toBe('t');
      await p.touchscreen.tap(at.x, at.y);
      expect(await data()).toBe('pinned=on');
      await p.touchscreen.tap(at.x, at.y);
      expect(await data()).toBe('');
      // Dirty checkedness (HTML §4.10.5.1.15): after a user toggle, a later checked attribute changes nothing.
      expect(await p.evaluate(() => {
        const c = document.querySelector('input') as HTMLInputElement;
        c.setAttribute('checked', '');
        return c.checked;
      })).toBe(false);
      const fresh = await p.evaluate(() => {
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.setAttribute('checked', '');
        return c.checked;
      });
      expect(fresh).toBe(true);
      const n = nativeCases().find((x) => x.case.id === 'controls-checkbox');
      if (n === undefined) throw new Error('no controls-checkbox native case');
      const table = caseHitTable(n);
      const chromeRow = await (async () => {
        await p.setContent(n.case.authoredHtml);
        return p.evaluate(() => {
          const r = (document.querySelector('[data-dragon-id="ct"]') as HTMLElement).getBoundingClientRect();
          const x = r.x + r.width / 2;
          const y = r.y + r.height / 2;
          return { x, y, id: document.elementFromPoint(x, y)?.getAttribute('data-dragon-id') ?? null };
        });
      })();
      const ours = hitTest(table.nodes, Math.floor(chromeRow.x * 64), Math.floor(chromeRow.y * 64), NO_HIT_FAULTS);
      expect(chromeRow.id).toBe('ct');
      expect(table.ids[ours]?.endsWith('ct') ?? false, `the hit table names ${table.ids[ours]}`).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
