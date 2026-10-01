// Captures Chrome 145's form control data for FORM-0 and compares the forms reference functions with it:
// - the range value matrix (min, max, step, value attribute -> input.value and valueAsNumber);
// - the range geometry matrix: input, container, track and thumb box models through CDP (DOM.getDocument pierce, DOM.getBoxModel);
// - the button matrix: button, text and child element rects;
// - the devolve probe at DPR 2: control pixels against a CSS twin box with the control's computed background and border;
// - the UA shadow styles of the range's container, track and thumb (CSS.getMatchedStylesForNode, user-agent origin).
// Writes packages/dragon/test/forms/chrome-145/*.json and packages/dragon/src/forms/{appearance,ua-shadow}.generated.ts.
// --check requires a byte-identical recapture and every comparison to pass; --plant <name> compares with that fault planted.
// Run with: node --conditions=dragon-internal scripts/capture-form-data.ts [--check] [--plant thumb-unmirrored|step-tie-down|devolve-ignored]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { authorStyleOf, compareForms, FORM_PLANTS, NO_FORM_FAULTS } from '../packages/dragon/src/forms/index.ts';
import type {
  Box,
  ButtonCapture,
  ButtonCase,
  ButtonChildren,
  Captures,
  DevolveCapture,
  DevolveCase,
  DevolvePoint,
  DevolveSet,
  Direction,
  FormFaults,
  RangeAttributes,
  RangeGeometryCapture,
  RangeGeometryCase,
  RangeValueCapture,
  RangeValueRow,
  Rect,
} from '../packages/dragon/src/forms/index.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<typeof openPage>>;
type CDPSession = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

const OUT_DIR = 'packages/dragon/test/forms/chrome-145';
const APPEARANCE_PATH = 'packages/dragon/src/forms/appearance.generated.ts';
const UA_SHADOW_PATH = 'packages/dragon/src/forms/ua-shadow.generated.ts';

const args = process.argv.slice(2);
const check = args.includes('--check');
const plantAt = args.indexOf('--plant');
const plant = plantAt >= 0 ? args[plantAt + 1] : undefined;
if (plantAt >= 0 && (plant === undefined || FORM_PLANTS[plant] === undefined)) {
  console.error(`--plant needs one of ${Object.keys(FORM_PLANTS).join(', ')}`);
  process.exit(2);
}
const faults: FormFaults = plant === undefined ? NO_FORM_FAULTS : { ...NO_FORM_FAULTS, [FORM_PLANTS[plant] as keyof FormFaults]: true };

const DIRECTIONS: readonly Direction[] = ['ltr', 'rtl'];

/** CSS px from the page to LU; every captured length must be a whole LU. */
function lu(px: number, what: string): number {
  const v = px * 64;
  if (!Number.isInteger(v)) throw new Error(`${what}: ${px}px is not a whole LayoutUnit`);
  return v;
}

function quadRect(q: readonly number[], what: string): Rect {
  const [x1, y1, , , x3, y3] = q as [number, number, number, number, number, number];
  return [lu(x1, what), lu(y1, what), lu(x3 - x1, what), lu(y3 - y1, what)];
}

// ---------------------------------------------------------------- range value matrix

const MINS = [null, '0', '10', '-5', 'abc', '50', '0.1'];
const MAXES = [null, '100', '10', '20', 'x', '50'];
const STEPS = [null, '1', '10', '0.1', '3', 'any', '0', '-1', '2.5', '0.3'];
const VALUES = [null, '', '0', '33', '7.5', '150', '-20', 'abc', '1e1', '.5', '+5', '5.', '49.95', '15', '0.35'];
// Fractions past Decimal's 18-digit coefficient: Blink's FromString counts leading fractional zeroes against the limit and drops
// later digits without an exponent adjustment, so 0.0000000000000000001 parses to zero (a Macroscope finding on #11 asked
// otherwise; Chrome answers here).
const LONG_FRACTIONS: readonly RangeAttributes[] = [
  { min: '-1', max: '1', step: 'any', value: '0.0000000000000000001' },
  { min: '-1', max: '1', step: 'any', value: '-0.00000000000000000012345' },
  { min: '0', max: '1', step: 'any', value: '0.1234567890123456789' },
  { min: '0', max: '1', step: 'any', value: '0.99999999999999999999' },
  { min: '0', max: '1', step: 'any', value: '0.000000000000000001' },
  { min: '0.0000000000000000001', max: '1', step: 'any', value: '0' },
  { min: '-1', max: '1', step: '0.0000000000000000001', value: '0.4' },
  { min: '0', max: '100', step: '0.0000000000000000003', value: '33' },
];
// Step rounding at the ends of the range: the nearest step value falls outside [min, max] (min=0 when absent, step base = value).
const RANGE_END_STEPS: readonly RangeAttributes[] = [
  { min: null, max: null, step: '6', value: '-20' },
  { min: null, max: '10', step: '4', value: '15' },
  { min: null, max: '1', step: '10', value: '5' },
  { min: null, max: '1', step: '10', value: '-5' },
  { min: null, max: '3', step: '10', value: '-2' },
];

async function captureRangeValues(page: Page, chrome: string): Promise<RangeValueCapture> {
  const attrs: RangeAttributes[] = [];
  for (const min of MINS) for (const max of MAXES) for (const step of STEPS) for (const value of VALUES) attrs.push({ min, max, step, value });
  attrs.push(...LONG_FRACTIONS, ...RANGE_END_STEPS);
  // Parsed markup, as a compiled page has it: attribute changes made by script after type=range re-sanitise a stored value.
  const markup = attrs.map((a) => `<input type="range"${attrMarkup(a)}>`).join('');
  const got = await page.evaluate((html: string) => {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return [...holder.querySelectorAll('input')].map((input) => [input.value, String(input.valueAsNumber)] as [string, string]);
  }, markup);
  if (got.length !== attrs.length) throw new Error(`parsed ${got.length} range inputs, wanted ${attrs.length}`);
  const rows: RangeValueRow[] = attrs.map((a, k) => {
    const [value, asNumber] = got[k] as [string, string];
    return [a.min, a.max, a.step, a.value, value, asNumber];
  });
  return { chrome, rows };
}

// ---------------------------------------------------------------- range geometry matrix

type GeometrySpec = { readonly id: string; readonly direction: Direction; readonly css: RangeGeometryCase['css']; readonly attrs: RangeAttributes };

const GEOMETRY_VALUES: readonly RangeAttributes[] = [
  { min: null, max: null, step: null, value: null },
  { min: '0', max: '100', step: null, value: '30' },
  { min: '0', max: '10', step: '3', value: '5' },
  { min: '20', max: '10', step: null, value: '15' },
  { min: '0', max: '1', step: 'any', value: '0.37' },
  { min: null, max: null, step: null, value: '100' },
];
const SWEEP_VALUES: readonly RangeAttributes[] = [
  { min: '0', max: '100', step: null, value: '30' },
  { min: '0', max: '100', step: null, value: '71' },
  { min: '0', max: '3', step: null, value: '1' },
];
const THUMB_SIZES = ['', 'width:16px;height:16px', 'width:10px;height:24px', 'width:30px;height:6px'];
const BOX_SWEEP: readonly { input: string; track: string }[] = [
  { input: 'width:200px', track: '' },
  { input: 'width:173px', track: '' },
  { input: 'height:30px', track: '' },
  { input: 'padding:5px 7px', track: '' },
  { input: 'border:3px solid', track: '' },
  { input: 'box-sizing:border-box;width:180px;padding:2px 5px;border:4px solid', track: '' },
  { input: '', track: 'height:4px' },
  { input: '', track: 'height:20px' },
  { input: '', track: 'padding:0 5px' },
  { input: 'width:151px', track: 'height:4px;border:2px solid;padding:0 3px' },
];

function geometrySpecs(): GeometrySpec[] {
  const out: GeometrySpec[] = [];
  for (const direction of DIRECTIONS) {
    for (const inputApp of ['none', 'auto']) {
      for (const thumbApp of ['', 'appearance:none', 'appearance:auto']) {
        for (const size of THUMB_SIZES) {
          for (const attrs of GEOMETRY_VALUES) {
            const thumb = [thumbApp, size].filter((s) => s !== '').join(';');
            out.push({ id: `g${out.length}`, direction, css: { input: `appearance:${inputApp}`, thumb, track: '' }, attrs });
          }
        }
      }
    }
    for (const box of BOX_SWEEP) {
      for (const attrs of SWEEP_VALUES) {
        const input = ['appearance:none', box.input].filter((s) => s !== '').join(';');
        out.push({ id: `g${out.length}`, direction, css: { input, thumb: 'width:16px;height:16px', track: box.track }, attrs });
      }
    }
  }
  return out;
}

const attrMarkup = (a: RangeAttributes): string =>
  (['min', 'max', 'step', 'value'] as const)
    .filter((k) => a[k] !== null)
    .map((k) => ` ${k}="${(a[k] as string).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join('');

type DomNode = {
  readonly nodeId: number;
  readonly nodeName: string;
  readonly attributes?: readonly string[];
  readonly children?: readonly DomNode[];
  readonly shadowRoots?: readonly DomNode[];
};

function findById(root: DomNode, out: Map<string, DomNode>): void {
  const attrs = root.attributes ?? [];
  for (let k = 0; k + 1 < attrs.length; k += 2) if (attrs[k] === 'id') out.set(attrs[k + 1] as string, root);
  for (const c of root.children ?? []) findById(c, out);
}

function rangeShadow(input: DomNode, what: string): { container: DomNode; track: DomNode; thumb: DomNode } {
  const root = input.shadowRoots?.[0];
  const container = root?.children?.[0];
  const track = container?.children?.[0];
  const thumb = track?.children?.[0];
  if (container === undefined || track === undefined || thumb === undefined) throw new Error(`${what}: CDP exposed no user-agent shadow container/track/thumb`);
  return { container, track, thumb };
}

async function boxOf(cdp: CDPSession, node: DomNode, what: string): Promise<Box> {
  const r = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as { model: { border: number[]; content: number[] } };
  return { border: quadRect(r.model.border, `${what} border`), content: quadRect(r.model.content, `${what} content`) };
}

async function openCdp(page: Page): Promise<{ cdp: CDPSession; ids: Map<string, DomNode> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const doc = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
  const ids = new Map<string, DomNode>();
  findById(doc.root, ids);
  return { cdp, ids };
}

async function captureRangeGeometry(browser: Browser, chrome: string): Promise<RangeGeometryCapture> {
  const specs = geometrySpecs();
  const cases: RangeGeometryCase[] = [];
  for (const direction of DIRECTIONS) {
    const mine = specs.filter((s) => s.direction === direction);
    const rules = mine.map((s) => `#${s.id}{${s.css.input}}#${s.id}::-webkit-slider-thumb{${s.css.thumb}}#${s.id}::-webkit-slider-runnable-track{${s.css.track}}`).join('\n');
    const body = mine.map((s) => `<div class="c"><input type="range" id="${s.id}"${attrMarkup(s.attrs)}></div>`).join('\n');
    const html = `<!DOCTYPE html><html><head><style>body{margin:0;font-size:10px}.c{margin:0 0 4px}\n${rules}</style></head><body>\n${body}\n</body></html>`;
    const page = await openPage(browser, html, { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction, rootFont: 'ahem' });
    const { cdp, ids } = await openCdp(page);
    const values = await page.evaluate((list: string[]) => list.map((id) => (document.getElementById(id) as HTMLInputElement).value), mine.map((s) => s.id));
    for (const [k, s] of mine.entries()) {
      const input = ids.get(s.id);
      if (input === undefined) throw new Error(`${s.id}: not in the pierced document`);
      const shadow = rangeShadow(input, s.id);
      cases.push({
        ...s,
        value: values[k] as string,
        boxes: {
          input: await boxOf(cdp, input, `${s.id} input`),
          container: await boxOf(cdp, shadow.container, `${s.id} container`),
          track: await boxOf(cdp, shadow.track, `${s.id} track`),
          thumb: await boxOf(cdp, shadow.thumb, `${s.id} thumb`),
        },
      });
    }
    await page.context().close();
  }
  return { chrome, cases };
}

// ---------------------------------------------------------------- UA shadow styles

type UaRule = { readonly selectors: readonly string[]; readonly declarations: readonly (readonly [string, string, boolean])[] };

async function captureUaShadow(browser: Browser): Promise<{ parts: Record<string, UaRule[]>; themeThumb: { width: number; height: number }; noneThumb: { width: number; height: number } }> {
  const html = `<!DOCTYPE html><html><head><style>body{margin:0}#none{appearance:none}#none::-webkit-slider-thumb{appearance:none}</style></head><body><input type="range" id="auto"><input type="range" id="none"></body></html>`;
  const page = await openPage(browser, html, { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ahem' });
  const { cdp, ids } = await openCdp(page);
  const auto = rangeShadow(ids.get('auto') as DomNode, 'auto');
  const none = rangeShadow(ids.get('none') as DomNode, 'none');
  const parts: Record<string, UaRule[]> = {};
  type Matched = {
    matchedCSSRules: {
      rule: { origin: string; selectorList: { selectors: { text: string }[] }; style: { cssProperties: { name: string; value: string; important?: boolean; implicit?: boolean }[] } };
      matchingSelectors: number[];
    }[];
  };
  for (const [name, node] of Object.entries(auto)) {
    const m = (await cdp.send('CSS.getMatchedStylesForNode', { nodeId: node.nodeId })) as Matched;
    parts[name] = m.matchedCSSRules
      .filter((r) => r.rule.origin === 'user-agent')
      .map((r) => ({
        selectors: r.matchingSelectors.map((i) => (r.rule.selectorList.selectors[i] as { text: string }).text),
        declarations: r.rule.style.cssProperties.filter((p) => p.implicit !== true).map((p) => [p.name, p.value, p.important === true] as const),
      }));
  }
  const size = async (n: DomNode, what: string): Promise<{ width: number; height: number }> => {
    const b = await boxOf(cdp, n, what);
    return { width: b.border[2] / 64, height: b.border[3] / 64 };
  };
  const result = { parts, themeThumb: await size(auto.thumb, 'auto thumb'), noneThumb: await size(none.thumb, 'none thumb') };
  await page.context().close();
  return result;
}

// ---------------------------------------------------------------- button matrix

type ButtonSpec = { readonly id: string; readonly direction: Direction; readonly css: string; readonly children: ButtonChildren };

const BUTTON_CHILDREN: readonly ButtonChildren[] = ['text', 'element', 'both'];
const BUTTON_BOXES = ['', 'padding:0;border:0', 'padding:4px 9px 6px 3px;border:3px solid'];
const BUTTON_HEIGHTS = ['', 'min-height:60px', 'min-height:60.046875px', 'height:12px'];
const BLOCK_ALIGNS = ['', 'text-align:left', 'text-align:right', 'text-align:center', 'align-content:end'];
const FLEX_ALIGNS: readonly string[] = [
  ...['', 'justify-content:center', 'justify-content:flex-end', 'justify-content:space-between'].flatMap((j) =>
    ['', 'align-items:center', 'align-items:flex-end', 'align-items:flex-start'].map((a) => [j, a].filter((s) => s !== '').join(';')),
  ),
  ...['', 'justify-content:center', 'justify-content:flex-end', 'justify-content:space-between'].flatMap((j) =>
    ['', 'align-items:center'].map((a) => ['flex-direction:column', j, a].filter((s) => s !== '').join(';')),
  ),
];

function buttonSpecs(): ButtonSpec[] {
  const out: ButtonSpec[] = [];
  const push = (direction: Direction, parts: string[], children: ButtonChildren): void => {
    out.push({ id: `b${out.length}`, direction, css: parts.filter((s) => s !== '').join(';'), children });
  };
  for (const direction of DIRECTIONS) {
    for (const children of BUTTON_CHILDREN) {
      for (const display of ['display:block', 'display:inline-block']) {
        for (const box of BUTTON_BOXES) for (const h of BUTTON_HEIGHTS) for (const a of BLOCK_ALIGNS) push(direction, [display, box, h, a], children);
      }
      for (const box of BUTTON_BOXES.slice(1)) {
        for (const h of ['', 'min-height:60.046875px']) for (const a of FLEX_ALIGNS) push(direction, ['display:flex', box, h, a], children);
      }
    }
  }
  return out;
}

async function captureButtons(browser: Browser, chrome: string): Promise<ButtonCapture> {
  const specs = buttonSpecs();
  const cases: ButtonCase[] = [];
  for (const direction of DIRECTIONS) {
    const mine = specs.filter((s) => s.direction === direction);
    const inner = (c: ButtonChildren): string => (c === 'text' ? 'XXX' : c === 'element' ? '<span class="e"></span>' : 'XXX<span class="e"></span>');
    const body = mine.map((s) => `<div class="p"><button id="${s.id}" style="${s.css}">${inner(s.children)}</button></div>`).join('\n');
    const html = `<!DOCTYPE html><html><head><style>body{margin:0;font-size:10px}.p{display:flex;align-items:flex-start;margin:0 0 4px}button{font:inherit;width:120px;margin:0}.e{display:block;width:20px;height:8px}</style></head><body>\n${body}\n</body></html>`;
    const page = await openPage(browser, html, { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction, rootFont: 'ahem' });
    const got = await page.evaluate((list: string[]) => {
      const r = (d: DOMRect): number[] => [d.x, d.y, d.width, d.height];
      return list.map((id) => {
        const b = document.getElementById(id) as HTMLButtonElement;
        const cs = getComputedStyle(b);
        const text = b.firstChild !== null && b.firstChild.nodeType === Node.TEXT_NODE ? b.firstChild : null;
        let textRect: number[] | null = null;
        if (text !== null) {
          const range = document.createRange();
          range.selectNodeContents(text);
          textRect = r(range.getBoundingClientRect());
        }
        const e = b.querySelector('.e');
        const px = (v: string): number => parseFloat(v);
        return {
          computed: {
            display: cs.display,
            textAlign: cs.textAlign,
            flexDirection: cs.flexDirection,
            justifyContent: cs.justifyContent,
            alignItems: cs.alignItems,
            padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
            border: [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)],
          },
          button: r(b.getBoundingClientRect()),
          text: textRect,
          element: e === null ? null : r(e.getBoundingClientRect()),
        };
      });
    }, mine.map((s) => s.id));
    for (const [k, s] of mine.entries()) {
      const g = got[k] as (typeof got)[number];
      const rect = (v: number[] | null, what: string): Rect | null => (v === null ? null : quadRect([v[0] as number, v[1] as number, 0, 0, (v[0] as number) + (v[2] as number), (v[1] as number) + (v[3] as number)], `${s.id} ${what}`));
      const four = (v: number[], what: string): [number, number, number, number] => v.map((x) => lu(x, `${s.id} ${what}`)) as [number, number, number, number];
      cases.push({
        ...s,
        computed: { ...g.computed, padding: four(g.computed.padding, 'padding'), border: four(g.computed.border, 'border') },
        rects: { button: rect(g.button, 'button') as Rect, text: rect(g.text, 'text'), element: rect(g.element, 'element') },
      });
    }
    await page.context().close();
  }
  return { chrome, cases };
}

// ---------------------------------------------------------------- devolve probe (DPR 2)

/** Chrome screenshots: 8-bit RGB or RGBA, non-interlaced, five scanline filters. Returns 0xRRGGBB per pixel. */
function decodePng(png: Uint8Array): { width: number; height: number; rgb: Uint32Array } {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (data[8] !== 8 || data[12] !== 0 || channels === 0) throw new Error('unexpected screenshot PNG format');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (out[y * stride + x - channels] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] as number) : 0;
      let v = raw[y * (stride + 1) + 1 + x] as number;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  const rgb = new Uint32Array(width * height);
  for (let i = 0; i < width * height; i++) rgb[i] = ((out[i * channels] as number) << 16) | ((out[i * channels + 1] as number) << 8) | (out[i * channels + 2] as number);
  return { width, height, rgb };
}

const DEVOLVE_SETS: readonly { set: DevolveSet; css: string; thumbCss: string; controls: readonly ('button' | 'range')[] }[] = [
  { set: 'none', css: '', thumbCss: '', controls: ['button', 'range'] },
  { set: 'background-color', css: 'background-color:rgb(0,128,0)', thumbCss: '', controls: ['button', 'range'] },
  { set: 'border', css: 'border:4px solid rgb(0,0,255)', thumbCss: '', controls: ['button', 'range'] },
  { set: 'appearance-none', css: 'appearance:none', thumbCss: 'appearance:none', controls: ['button', 'range'] },
  { set: 'input-none-thumb-auto', css: 'appearance:none', thumbCss: '', controls: ['range'] },
];
const DEVOLVE_BASE = {
  button: 'width:80px;height:40px;padding:0;margin:0;font:inherit',
  range: 'width:120px;height:20px;margin:0',
} as const;
const COPIED = [
  'background-color',
  'background-image',
  ...['top', 'right', 'bottom', 'left'].flatMap((s) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]),
  ...['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => `border-${c}-radius`),
];

async function captureDevolve(chrome: string): Promise<DevolveCapture> {
  const dpr = 2;
  const specs = (['button', 'range'] as const).flatMap((control) =>
    DEVOLVE_SETS.filter((s) => s.controls.includes(control)).map((s) => ({ control, set: s.set, css: s.css, thumbCss: control === 'range' ? s.thumbCss : '' })),
  );
  const rowTop = (k: number): number => 20 + k * 60;
  const tag = (control: 'button' | 'range', css: string, k: number): string =>
    control === 'button'
      ? `<button id="d${k}" style="position:absolute;left:20px;top:${rowTop(k)}px;${DEVOLVE_BASE.button};${css}"></button>`
      : `<input type="range" id="d${k}" style="position:absolute;left:20px;top:${rowTop(k)}px;${DEVOLVE_BASE.range};${css}">`;
  const body = specs.map((s, k) => `${tag(s.control, s.css, k)}<div id="t${k}" style="position:absolute;left:240px;top:${rowTop(k)}px;box-sizing:border-box"></div>`).join('\n');
  const thumbRules = specs.map((s, k) => (s.thumbCss === '' ? '' : `#d${k}::-webkit-slider-thumb{${s.thumbCss}}`)).join('');
  const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;background:#fff}${thumbRules}</style></head><body>\n${body}\n</body></html>`;
  const height = rowTop(specs.length);
  const browser = await launchChrome(dpr);
  try {
    const page = await openPage(browser, html, { viewport: { width: 400, height }, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ahem' });
    const boxes = await page.evaluate(
      ({ n, props }: { n: number; props: string[] }) => {
        const out: { w: number; h: number; x: number; y: number; bw: number[] }[] = [];
        for (let k = 0; k < n; k++) {
          const c = document.getElementById(`d${k}`) as HTMLElement;
          const t = document.getElementById(`t${k}`) as HTMLElement;
          const cs = getComputedStyle(c);
          const r = c.getBoundingClientRect();
          for (const p of props) t.style.setProperty(p, cs.getPropertyValue(p));
          t.style.width = `${r.width}px`;
          t.style.height = `${r.height}px`;
          out.push({ w: r.width, h: r.height, x: r.x, y: r.y, bw: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat) });
        }
        return out;
      },
      { n: specs.length, props: COPIED },
    );
    await page.evaluate(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    });
    const shot = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: 400, height }, scale: 'device', animations: 'disabled', caret: 'hide' }));
    const pixel = (x: number, y: number): string => {
      const dx = Math.floor(x * dpr);
      const dy = Math.floor(y * dpr);
      if (dx < 0 || dy < 0 || dx >= shot.width || dy >= shot.height) throw new Error(`probe point ${x},${y} is off the screenshot`);
      return `#${(shot.rgb[dy * shot.width + dx] as number).toString(16).padStart(6, '0')}`;
    };
    const cases: DevolveCase[] = specs.map((s, k) => {
      const b = boxes[k] as (typeof boxes)[number];
      const [bt, br, bb, bl] = b.bw as [number, number, number, number];
      const inner = (w: number): number => Math.max(w, 1) - 0.25;
      const at: [string, number, number][] = [
        ['centre', b.w / 2, b.h / 2],
        ['top outer', b.w / 2, 0.25],
        ['top inner', b.w / 2, inner(bt)],
        ['right outer', b.w - 0.25, b.h / 2],
        ['right inner', b.w - inner(br), b.h / 2],
        ['bottom outer', b.w / 2, b.h - 0.25],
        ['bottom inner', b.w / 2, b.h - inner(bb)],
        ['left outer', 0.25, b.h / 2],
        ['left inner', inner(bl), b.h / 2],
        ['top-left corner', 0.25, 0.25],
        ['bottom-right corner', b.w - 0.25, b.h - 0.25],
      ];
      const points: DevolvePoint[] = at.map(([name, x, y]) => ({ name, x, y, control: pixel(b.x + x, b.y + y), twin: pixel(240 + x, b.y + y) }));
      return { control: s.control, set: s.set, css: s.css, thumbCss: s.thumbCss, points, result: points.every((p) => p.control === p.twin) ? 'css' : 'theme' };
    });
    await page.context().close();
    return { chrome, devicePixelRatio: dpr, cases };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------- output

const HEADER = `// Generated by scripts/capture-form-data.ts from Chrome ${CHROME_VERSION}; do not edit. Regenerate with the script.`;

function appearanceModule(d: DevolveCapture): string {
  const table: Record<string, Record<string, string>> = {};
  for (const c of d.cases) (table[c.control] ??= {})[c.set] = c.result;
  return `${HEADER}
// The devolve probe (R11): at DPR ${d.devicePixelRatio}, each control's pixels at its centre, border and corner points against a div twin
// that has the control's computed background and border. 'css' means every point matched (the control is painted as CSS boxes);
// 'theme' means the platform theme painted it. Blink rule: layout_theme.cc LayoutTheme::AdjustAppearanceWithAuthorStyle and
// IsControlStyled (push button: author background or border devolves; slider: never), at Chrome 145.0.7632.6.
export const APPEARANCE_PROBE = ${JSON.stringify(table, null, 2)} as const;
`;
}

function uaShadowModule(u: Awaited<ReturnType<typeof captureUaShadow>>): string {
  return `${HEADER}
// The user-agent shadow tree of input[type=range]: a container div (flex), the track div (id "track", pseudo
// -webkit-slider-runnable-track, block) and the thumb div (id "thumb", pseudo -webkit-slider-thumb, block), from
// DOM.getDocument({pierce: true}). Rules are the user-agent-origin matches of CSS.getMatchedStylesForNode, in cascade order,
// as [property, value, important]. RANGE_THEME_THUMB is the thumb size LayoutTheme::AdjustSliderThumbSize gives an
// appearance:auto thumb with no author size; RANGE_NONE_THUMB is the size of an appearance:none thumb (in an appearance:none input) with no author size (CSS px).
export const RANGE_UA_SHADOW = ${JSON.stringify(u.parts, null, 2)} as const;

export const RANGE_THEME_THUMB = ${JSON.stringify(u.themeThumb)} as const;

export const RANGE_NONE_THUMB = ${JSON.stringify(u.noneThumb)} as const;
`;
}

/** One JSON value per line for arrays of rows or cases, so diffs stay readable. */
function jsonRows(head: Record<string, unknown>, key: string, rows: readonly unknown[]): string {
  const h = JSON.stringify(head);
  return `${h.slice(0, -1)},${JSON.stringify(key)}:[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

const browser = await launchChrome();
let captures: Captures;
let uaShadow: Awaited<ReturnType<typeof captureUaShadow>>;
try {
  const chrome = browser.version();
  if (chrome !== CHROME_VERSION) throw new Error(`Chrome must be ${CHROME_VERSION}, got ${chrome}`);
  const page = await openPage(browser, '<!DOCTYPE html><html><head></head><body></body></html>', { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ahem' });
  const rangeValue = await captureRangeValues(page, chrome);
  await page.context().close();
  const rangeGeometry = await captureRangeGeometry(browser, chrome);
  const button = await captureButtons(browser, chrome);
  uaShadow = await captureUaShadow(browser);
  const devolve = await captureDevolve(chrome);
  captures = { rangeValue, rangeGeometry, button, devolve };
} finally {
  await browser.close();
}

const outputs: [string, string][] = [
  [`${OUT_DIR}/range-value.json`, jsonRows({ chrome: captures.rangeValue.chrome }, 'rows', captures.rangeValue.rows)],
  [`${OUT_DIR}/range-geometry.json`, jsonRows({ chrome: captures.rangeGeometry.chrome }, 'cases', captures.rangeGeometry.cases)],
  [`${OUT_DIR}/button.json`, jsonRows({ chrome: captures.button.chrome }, 'cases', captures.button.cases)],
  [`${OUT_DIR}/devolve.json`, `${JSON.stringify(captures.devolve, null, 1)}\n`],
  [APPEARANCE_PATH, appearanceModule(captures.devolve)],
  [UA_SHADOW_PATH, uaShadowModule(uaShadow)],
];

let failed = false;
if (check) {
  for (const [path, text] of outputs) {
    let current = '';
    try {
      current = readFileSync(repoPath(path), 'utf8');
    } catch {
      current = '';
    }
    if (current !== text) {
      console.error(`${path} differs from the recapture; rerun without --check`);
      failed = true;
    }
  }
  if (!failed) console.log(`forms capture unchanged: ${outputs.length} files`);
} else {
  mkdirSync(repoPath(OUT_DIR), { recursive: true });
  for (const [path, text] of outputs) writeFileSync(repoPath(path), text);
  console.log(`wrote ${outputs.map(([p]) => p).join(', ')}`);
}

// R11 as a table the probe must reproduce; the reference rule is compared case by case in compareForms.
for (const c of captures.devolve.cases) {
  const s = authorStyleOf(c.set);
  const r11 =
    c.control === 'range'
      ? s.appearance === 'none' && s.thumbAppearance === 'none'
        ? 'css'
        : 'theme'
      : s.appearance === 'none' || s.background || s.border
        ? 'css'
        : 'theme';
  if (c.result !== r11) {
    console.error(`devolve probe contradicts R11: ${c.control} ${c.set} is ${c.result}, R11 says ${r11}`);
    failed = true;
  }
}

const cmp = compareForms(captures, faults);
for (const [name, n] of Object.entries(cmp.counts)) {
  const bad = cmp.mismatches.filter((m) => m.check === name).length;
  console.log(`${name}: ${n - bad}/${n} equal Chrome`);
}
for (const m of cmp.mismatches.slice(0, 20)) console.error(`  ${m.check} ${m.subject}: ${m.detail}`);
if (cmp.mismatches.length > 20) console.error(`  ... ${cmp.mismatches.length - 20} more`);
if (plant !== undefined) console.log(`planted ${plant}: ${cmp.mismatches.length} mismatches`);
if (cmp.mismatches.length > 0) failed = true;
process.exit(failed ? 1 : 0);
