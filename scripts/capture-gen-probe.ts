// GEN-P (T151): the generated-content and list-marker probe corpus. Measures Chrome 145.0.7632.6 ::before, ::after and ::marker
// at DPR 1, 2, 3 and 2.625, in ltr and rtl, and writes docs/research/gen-spike/probe/<family>.json. Per case and run it records
// the CDP pseudo-element boxes (DOM.getDocument pseudoElements, DOM.getBoxModel border quads) and their computed values
// (CSS.getComputedStyleForNode), getComputedStyle of every labelled element and of its ::before, ::after and ::marker,
// getBoundingClientRect of every labelled element, and DOMSnapshot text boxes divided by the DPR. Every run cross-checks each real
// text box from the snapshot against its Range client rect (1/1024 CSS px, T151 R9) and fails on any difference; every Ahem marker
// of the geometry cases must match the symbol and text marker formulas (blink-notes.md "Marker geometry"). Family 7 screenshots
// disc, circle and square markers on the CPU raster path and stores gray crops for scripts/check-marker-paint-oracle.ts.
// Run with: node --conditions=dragon-internal scripts/capture-gen-probe.ts [--check] [--only=<family id>]
import { readFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { zoomGuard } from '../packages/parity/src/dpr.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { allPrimitives, caseProblems, formatJson, parseProbeArgs, writeOrCheck } from './probe-common.ts';
import { decodePng } from './capture-skia-aa-oracle.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<typeof openPage>>;
type CDPSession = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

export const DPRS = [1, 2, 3, 2.625] as const;
const DIRS = ['ltr', 'rtl'] as const;
type Dir = (typeof DIRS)[number];
export const OUT_DIR = 'docs/research/gen-spike/probe';
const VIEWPORT = { width: 400, height: 300 };
/** Text boxes from the snapshot, divided by the DPR, must equal Range client rects within this many CSS px (T151 R9). */
export const CROSS_CHECK_CSS_PX = 1 / 1024;
const COMPUTED = [
  'display', 'position', 'content', 'color', 'font-family', 'font-size', 'line-height', 'white-space-collapse', 'text-wrap-mode', 'width', 'height',
  'list-style-type', 'list-style-position', 'list-style-image', 'box-sizing',
] as const;
const PSEUDOS = ['::before', '::after', '::marker'] as const;

export type Case = {
  readonly id: string;
  readonly note: string;
  readonly css: string;
  /** Body content; `data-p` labels name the elements a record keys on (html, head and body are named by tag). */
  readonly html: string;
  /** Inter instead of Ahem for the whole page (one case per family). */
  readonly inter?: boolean;
  /** The Ahem marker-geometry assertion: every ::marker in the case must match the formula of this kind. */
  readonly geometry?: 'symbol' | 'text';
};
export type Family = { readonly id: string; readonly title: string; readonly cases: readonly Case[] };

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PREFLIGHT = '*,::after,::before,::backdrop,::file-selector-button{box-sizing:border-box;margin:0;padding:0;border:0 solid}';
const LIST = 'ul,ol{margin:0;padding-inline-start:50px;width:300px}';
export const MARKER_SIZES = [10, 13, 16, 17.3, 23.3, 33.33, 1] as const;
export const SYMBOLS = ['disc', 'circle', 'square'] as const;
/** The text counter styles GEN-c ports (T151 R14) and the values each is probed at. */
const COUNTER_STYLES = ['decimal', 'decimal-leading-zero', 'lower-alpha', 'upper-alpha', 'lower-latin', 'upper-latin', 'lower-roman', 'upper-roman', "'>> '"] as const;
const COUNTER_VALUES = [0, 1, 26, 27, 3999, 4000, -1] as const;

const f1: Case[] = [
  { id: 'content-values', note: 'computed content of strings, concatenation, alt text, counter, attr, quote and url on ::before', css: `#a::before{content:'a' 'b'} #b::before{content:'a' / 'alt'} #c::before{content:counter(x)} #d::before{content:attr(data-x)} #e::before{content:open-quote} #f::before{content:url(${PNG_1X1})}`, html: '<div data-p="a" id="a"></div><div data-p="b" id="b"></div><div data-p="c" id="c"></div><div data-p="d" id="d" data-x="Q"></div><div data-p="e" id="e"></div><div data-p="f" id="f"></div>' },
  { id: 'none-normal', note: 'content none and normal generate no ::before; display alone does not either', css: '#a::before{content:none} #b::before{content:normal} #c::before{display:block}', html: '<div data-p="a" id="a">x</div><div data-p="b" id="b">x</div><div data-p="c" id="c">x</div>' },
  { id: 'on-element', note: 'content on an element: strings are kept as specified with no layout effect, none computes to normal', css: "#a{content:'zzz'} #b{content:none} #c{content:normal}", html: '<div data-p="a" id="a">x</div><div data-p="b" id="b">x</div><div data-p="c" id="c">x</div>' },
  { id: 'empty-string', note: "content '' makes a zero-size inline box", css: "#a{width:200px} #a::before{content:''} #b::before{content:''} ", html: '<div data-p="a" id="a"></div><div data-p="b" id="b">m</div>' },
  { id: 'var-content', note: 'Tailwind 4 shape: --tw-content registered with @property, content: var(--tw-content)', css: "@property --tw-content{syntax:'*';inherits:false;initial-value:''} .t::before{--tw-content:'hi';content:var(--tw-content)} .u::after{content:var(--tw-content)}", html: '<div data-p="t" class="t">m</div><div data-p="u" class="u">m</div>' },
  { id: 'preflight', note: 'the Tailwind 4 preflight first rule generates no box', css: PREFLIGHT, html: '<div data-p="a">m</div><ul data-p="u"><li data-p="l">x</li></ul><input data-p="file" type="file">' },
  { id: 'specificity', note: '#a::before beats .c::before and div::before; legacy single colon', css: "div::before{content:'1'} #a::before{content:'2'} .c::before{content:'3'} #b:before{content:'S'} #b:after{content:'T'}", html: '<div data-p="a" id="a" class="c"></div><div data-p="b" id="b">m</div>' },
  { id: 'inter', note: 'string content in Inter', inter: true, css: "#a::before{content:'Ab '} #a::after{content:' yZ'}", html: '<div data-p="a" id="a">mid</div>' },
];

const f2: Case[] = [
  { id: 'hosts', note: 'which elements generate ::before and ::after', css: "*::before{content:'B'} *::after{content:'A'} body::before,body::after{content:none}", html: `<div data-p="div">d</div><span data-p="span">s</span><img data-p="img" src="${PNG_1X1}"><input data-p="text"><input data-p="range" type="range"><input data-p="checkbox" type="checkbox"><br data-p="br"><hr data-p="hr"><button data-p="button">b</button><iframe data-p="iframe"></iframe><select data-p="select"><option data-p="option">o</option></select><textarea data-p="textarea"></textarea>` },
  { id: 'root-and-body', note: "the root's ::before precedes body; body's own ::before", css: "html::before{content:'R'} body::before{content:'Y'}", html: '<div data-p="a">m</div>' },
  { id: 'inter', note: 'hosts in Inter', inter: true, css: "*::before{content:'B'} body::before{content:none}", html: '<p data-p="p">para</p><button data-p="button">b</button>' },
];

const f3: Case[] = [
  { id: 'inline', note: 'inline ::before and ::after in a wrapping block', css: "#a{width:96px} #a::before{content:'AAAA BBBB'} #a::after{content:'CC DD'}", html: '<div data-p="a" id="a">xx yy</div>' },
  { id: 'block', note: 'display:block ::before with a height, ::after with text', css: "#a{width:100px} #a::before{content:'';display:block;height:10px} #a::after{content:'Q';display:block}", html: '<div data-p="a" id="a">m</div>' },
  { id: 'flex-item', note: 'blockified in a flex container, width honoured', css: "#a{display:flex;width:200px} #a::before{content:'AB';width:50px} #a::after{content:'C'}", html: '<div data-p="a" id="a"><div data-p="k">zz</div></div>' },
  { id: 'grid-item', note: 'blockified in a grid container', css: "#a{display:grid;grid-template-columns:40px 1fr;width:200px} #a::before{content:'G'}", html: '<div data-p="a" id="a"><div data-p="k">zz</div></div>' },
  { id: 'abspos', note: 'absolutely positioned ::after computes to block', css: "#a{position:relative;width:100px;height:50px} #a::after{content:'';position:absolute;inset:0;background:red} #b{position:relative;width:100px;height:50px} #b::after{content:'';position:absolute;left:10px;top:5px;width:20px;height:7px}", html: '<div data-p="a" id="a"><div data-p="c">blk</div></div><div data-p="b" id="b"></div>' },
  { id: 'inline-block', note: 'inline-block ::before with a size', css: "#a{width:200px} #a::before{content:'I';display:inline-block;width:40px;height:20px}", html: '<div data-p="a" id="a">m</div>' },
  { id: 'inherit', note: 'colour and font-size inherit from the host', css: "#a{color:rgb(0,128,0);font-size:20px} #a::before{content:'c'} #b{font-size:10px} #b::after{content:'k';font-size:2em}", html: '<div data-p="a" id="a">m</div><div data-p="b" id="b">m</div>' },
  { id: 'inter', note: 'flex-item ::before in Inter', inter: true, css: "#a{display:flex;width:200px} #a::before{content:'Inter';width:60px}", html: '<div data-p="a" id="a"><div data-p="k">zz</div></div>' },
];

const f4: Case[] = [
  { id: 'collapse', note: "'x  ' + '  m  ' + '  y' lays out as 'x m y'", css: "#a{width:300px} #a::before{content:'x  '} #a::after{content:'  y'}", html: '<div data-p="a" id="a">  m  </div>' },
  { id: 'newline', note: "'\\A' collapses to a space unless white-space preserves it", css: "#b::before{content:'a\\A b'} #c::before{content:'a\\A b';white-space:pre}", html: '<div data-p="b" id="b"></div><div data-p="c" id="c"></div>' },
  { id: 'empty-strings', note: "empty ::before and ::after between text and spaces", css: "#a::before{content:''} #a::after{content:''} #b::before{content:' '} #b::after{content:' '}", html: '<div data-p="a" id="a"> m </div><div data-p="b" id="b">m</div>' },
  { id: 'wrap-3-lines', note: 'leading and trailing spaces at line ends across generated boundaries in a 3-line wrap', css: "#a{width:64px} #a::before{content:'aa bb '} #a::after{content:' ee ff'}", html: '<div data-p="a" id="a"> cc dd </div>' },
  { id: 'inter', note: 'collapse across boundaries in Inter', inter: true, css: "#a{width:300px} #a::before{content:'x  '} #a::after{content:'  y'}", html: '<div data-p="a" id="a">  m  </div>' },
];

const sizeItems = (style: string): string => MARKER_SIZES.map((s, i) => `<li data-p="s${i}" style="font-size:${s}px${style}">x</li>`).join('');
const f5: Case[] = [
  ...SYMBOLS.map((t): Case => ({ id: `geometry-${t}`, note: `${t} markers at every probe size`, geometry: 'symbol', css: `${LIST} li{list-style-type:${t}}`, html: `<ul data-p="u">${sizeItems('')}</ul>` })),
  { id: 'geometry-decimal', note: 'decimal markers at every probe size', geometry: 'text', css: `${LIST}`, html: `<ol data-p="o">${sizeItems('')}</ol>` },
  { id: 'ordinals', note: 'start, value, reversed, negative start', css: LIST, html: '<ol data-p="a"><li data-p="a1">a</li><li data-p="a2">b</li></ol><ol data-p="b" start="9"><li data-p="b1">c</li><li data-p="b2" value="100">d</li><li data-p="b3">e</li></ol><ol data-p="c" reversed><li data-p="c1">f</li><li data-p="c2">g</li><li data-p="c3">h</li></ol><ol data-p="d" start="-2"><li data-p="d1">i</li><li data-p="d2">j</li><li data-p="d3">k</li></ol>' },
  { id: 'list-item-divs', note: 'div list-items continue the body list-item counter; an ol inside a div', css: `${LIST} .li{display:list-item;margin-inline-start:40px;list-style-type:decimal}`, html: '<div data-p="d1" class="li">x</div><div data-p="d2" class="li">y</div><div data-p="w"><ol data-p="o"><li data-p="o1">z</li></ol></div><div data-p="d3" class="li">w</div>' },
  ...COUNTER_STYLES.map((t, k): Case => ({ id: `counter-${t.startsWith("'") ? 'string' : t}`, note: `${t} marker text at ${COUNTER_VALUES.join(', ')}`, css: `${LIST} ol{width:600px;list-style-type:${t}}`, html: `<ol data-p="o${k}">${COUNTER_VALUES.map((v, i) => `<li data-p="v${i}" value="${v}">x</li>`).join('')}</ol>` })),
  { id: 'none-and-empty', note: 'list-style-type none makes no marker; empty items with and without a marker', css: `${LIST} .n{list-style-type:none} .e{display:list-item;list-style:none;margin:0} .f{display:list-item;margin-inline-start:40px}`, html: '<ul data-p="u"><li data-p="n" class="n">a</li></ul><div data-p="e" class="e"></div><div data-p="f" class="f"></div><div data-p="g" class="e">z</div>' },
  { id: 'flex-ul', note: 'an li in a flex ul stays list-item and keeps its marker', css: `${LIST} ul{display:flex}`, html: '<ul data-p="u"><li data-p="a">a</li><li data-p="b" style="display:block">b</li></ul>' },
  { id: 'inter', note: 'disc and decimal markers in Inter (recorded, no formula assertion)', inter: true, css: LIST, html: '<ul data-p="u"><li data-p="a">a</li><li data-p="b" style="font-size:23.3px">b</li></ul><ol data-p="o"><li data-p="c">c</li></ol>' },
];

const f6: Case[] = [
  { id: 'nested-block', note: "the marker aligns with the first child's first baseline through a padded block", css: LIST, html: '<ul data-p="u"><li data-p="a"><div data-p="inner" style="padding-top:10px"><div data-p="deep" style="padding-top:3px">xx</div></div></li></ul>' },
  { id: 'flex-first-child', note: 'the first child is a flex container', css: LIST, html: '<ul data-p="u"><li data-p="a"><div data-p="fl" style="display:flex;padding-top:5px"><span data-p="s" style="font-size:24px">q</span></div></li></ul>' },
  { id: 'inline-block-first-child', note: 'the first line holds an inline-block', css: LIST, html: '<ul data-p="u"><li data-p="a"><span data-p="ib" style="display:inline-block;padding-top:7px;font-size:10px">q<br>r</span></li></ul>' },
  { id: 'line-height', note: 'line-height 40px on the li', css: `${LIST} li{line-height:40px}`, html: '<ul data-p="u"><li data-p="a">c</li></ul><ol data-p="o"><li data-p="b">d</li></ol>' },
  { id: 'push-down', note: 'li font 32px, child font 10px: the marker ascent pushes content down', css: `${LIST} li{font-size:32px}`, html: '<ul data-p="u"><li data-p="a"><span data-p="s" style="font-size:10px">c</span></li><li data-p="b"><div data-p="d" style="font-size:10px">e</div></li></ul>' },
  { id: 'empty-item', note: 'an item with no line boxes top-aligns the marker and grows to its height', css: LIST, html: '<ul data-p="u"><li data-p="a"></li><li data-p="b" style="padding-top:5px"></li></ul>' },
  { id: 'border-left', note: "the offset is taken from the li's border box", css: `${LIST} li{border-left:7px solid;border-right:7px solid;padding-inline-start:3px}`, html: '<ul data-p="u"><li data-p="a">c</li></ul><ol data-p="o"><li data-p="b">d</li></ol>' },
  { id: 'overflow-hidden', note: 'overflow hidden on the li', css: `${LIST} li{overflow:hidden}`, html: '<ul data-p="u"><li data-p="a">c</li></ul>' },
  { id: 'before-on-li', note: '::before on an li with a marker', css: `${LIST} li::before{content:'B'}`, html: '<ul data-p="u"><li data-p="a">a</li></ul>' },
  { id: 'inter', note: 'push-down in Inter', inter: true, css: `${LIST} li{font-size:32px}`, html: '<ul data-p="u"><li data-p="a"><span data-p="s" style="font-size:10px">c</span></li></ul>' },
];

export const FAMILIES: readonly Family[] = [
  { id: 'family1-content', title: 'The computed content value on ::before, ::after and elements', cases: f1 },
  { id: 'family2-hosts', title: 'Which hosts generate ::before and ::after', cases: f2 },
  { id: 'family3-display', title: 'Display, blockification and inheritance of generated boxes', cases: f3 },
  { id: 'family4-whitespace', title: 'White-space collapse across generated-text boundaries', cases: f4 },
  { id: 'family5-markers', title: 'Marker geometry, ordinals and counter-style text', cases: f5 },
  { id: 'family6-alignment', title: 'Marker alignment with the first line or first child', cases: f6 },
];

let interFace: string | null = null;
function interFontFace(): string {
  if (interFace === null) interFace = `@font-face{font-family:Inter;src:url(data:font/ttf;base64,${readFileSync(repoPath('vendor/fonts/Inter/Inter-Regular.ttf')).toString('base64')}) format("truetype")}`;
  return interFace;
}

export function caseHtml(c: Case): string {
  const font = c.inter === true ? `${interFontFace()} html{font-family:Inter}` : '';
  return `<!doctype html><html><head><style>${font} body{margin:0} ${c.css}</style></head><body>${c.html}</body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Marker formulas (blink-notes.md "Marker geometry"): Ahem's ascent is 0.8 em, rounded in zoomed (device) px; the 7 and the
// 1 of the outside margin are device px.

export function ahemAscent(fontSize: number, dpr: number): number {
  return Math.floor(0.8 * fontSize * dpr + 0.5);
}

/** The outside symbol marker box in device px from the li's inline-start border edge: [inline offset outward, width]. */
export function symbolMarker(fontSize: number, dpr: number): { readonly offset: number; readonly width: number } {
  const asc = ahemAscent(fontSize, dpr);
  const third = Math.trunc((asc * 2) / 3);
  return { offset: third + 7 + 1, width: Math.trunc((third + 1) / 2) + 2 };
}

/** RelativeSymbolMarkerRect in device px, relative to the marker text fragment: x, y and the square's side. */
export function symbolRect(fontSize: number, dpr: number): { readonly x: number; readonly y: number; readonly size: number } {
  const asc = ahemAscent(fontSize, dpr);
  const third = Math.trunc((asc * 2) / 3);
  return { x: 1, y: Math.trunc((3 * (asc - third)) / 2), size: Math.trunc((third + 1) / 2) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Capture.

type Rect = readonly [number, number, number, number];
type ElementRecord = { readonly label: string; readonly rect: Rect; readonly computed: Record<string, string>; readonly pseudo: Record<string, Record<string, string>> };
type PseudoRecord = { readonly host: string; readonly type: string; readonly box: Rect | null; readonly computed: Record<string, string> };
type TextRecord = { readonly owner: string; readonly text: string; readonly boxes: readonly (readonly [number, number, number, number, number, number])[] };
export type Run = { readonly elements: readonly ElementRecord[]; readonly pseudo: readonly PseudoRecord[]; readonly text: readonly TextRecord[]; readonly crossCheck: { readonly lines: number; readonly worst: number } };

const fr = (v: number): number => Math.fround(v);
const rect4 = (r: readonly number[]): Rect => [fr(r[0] as number), fr(r[1] as number), fr(r[2] as number), fr(r[3] as number)];

type DomNode = { nodeId: number; nodeType: number; nodeName: string; attributes?: string[]; children?: DomNode[]; pseudoElements?: DomNode[]; pseudoType?: string };

function attrOf(attrs: readonly string[] | undefined, name: string): string | undefined {
  if (attrs === undefined) return undefined;
  for (let k = 0; k + 1 < attrs.length; k += 2) if (attrs[k] === name) return attrs[k + 1];
  return undefined;
}

/** A node's label: its data-p, html/head/body by tag, otherwise its parent's label plus its tag and index among element siblings. */
function labelOf(nodeName: string, dataP: string | undefined, parentLabel: string | null, siblingIndex: number): string {
  if (dataP !== undefined) return dataP;
  const tag = nodeName.toLowerCase();
  if (tag === 'html' || tag === 'head' || tag === 'body') return tag;
  return `${parentLabel ?? ''}/${tag}[${siblingIndex}]`;
}

async function pseudoRecords(cdp: CDPSession): Promise<PseudoRecord[]> {
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const doc = (await cdp.send('DOM.getDocument', { depth: -1 })) as unknown as { root: DomNode };
  const found: { host: string; node: DomNode }[] = [];
  const walk = (n: DomNode, label: string | null): void => {
    for (const p of n.pseudoElements ?? []) found.push({ host: label ?? n.nodeName, node: p });
    let k = 0;
    for (const c of n.children ?? []) {
      if (c.nodeType !== 1) continue;
      walk(c, labelOf(c.nodeName, attrOf(c.attributes, 'data-p'), label, k));
      k++;
    }
  };
  walk(doc.root, null);
  const out: PseudoRecord[] = [];
  for (const { host, node } of found) {
    const type = node.pseudoType;
    if (type === undefined) throw new Error(`pseudo element of ${host} has no pseudoType`);
    let box: Rect | null = null;
    try {
      const m = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as unknown as { model: { border: number[] } };
      const q = m.model.border;
      box = rect4([q[0] as number, q[1] as number, (q[2] as number) - (q[0] as number), (q[5] as number) - (q[1] as number)]);
    } catch (e) {
      // A pseudo element in the DOM with no layout box (display: none); any other failure is a capture error.
      if (!String(e).includes('Could not compute box model')) throw e;
    }
    const cs = (await cdp.send('CSS.getComputedStyleForNode', { nodeId: node.nodeId })) as unknown as { computedStyle: { name: string; value: string }[] };
    const computed: Record<string, string> = {};
    for (const p of COMPUTED) {
      const v = cs.computedStyle.find((e) => e.name === p);
      if (v === undefined) throw new Error(`${host}::${type}: CSS.getComputedStyleForNode has no ${p}`);
      computed[p] = v.value;
    }
    out.push({ host, type, box, computed });
  }
  return out;
}

type PageSide = { readonly elements: ElementRecord[]; readonly textRects: number[][][] };

/** Runs in the page: labelled elements, and the Range client rects of every text node in document order. */
function pageSide(args: { computed: readonly string[]; pseudos: readonly string[] }): PageSide {
  const label = (el: Element, parent: string | null, index: number): string => {
    const p = el.getAttribute('data-p');
    if (p !== null) return p;
    const tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'head' || tag === 'body') return tag;
    return `${parent ?? ''}/${tag}[${index}]`;
  };
  const elements: ElementRecord[] = [];
  const pick = (cs: CSSStyleDeclaration): Record<string, string> => {
    const o: Record<string, string> = {};
    for (const p of args.computed) o[p] = cs.getPropertyValue(p);
    return o;
  };
  const visit = (el: Element, parent: string | null, index: number): void => {
    const l = label(el, parent, index);
    if (el.hasAttribute('data-p') || l === 'html' || l === 'body') {
      const r = el.getBoundingClientRect();
      const pseudo: Record<string, Record<string, string>> = {};
      for (const ps of args.pseudos) {
        const cs = getComputedStyle(el, ps);
        pseudo[ps] = { content: cs.getPropertyValue('content'), display: cs.getPropertyValue('display') };
      }
      elements.push({ label: l, rect: [r.x, r.y, r.width, r.height], computed: pick(getComputedStyle(el)), pseudo });
    }
    let k = 0;
    for (const c of Array.from(el.children)) visit(c, l, k++);
  };
  visit(document.documentElement, null, 0);
  const textRects: number[][][] = [];
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(n);
    textRects.push(Array.from(range.getClientRects()).map((q) => [q.x, q.y, q.width, q.height]));
  }
  return { elements, textRects };
}

type Snapshot = {
  strings: string[];
  documents: {
    nodes: { parentIndex: number[]; nodeType: number[]; nodeName: number[]; attributes: number[][]; pseudoType?: { index: number[]; value: number[] }; shadowRootType?: { index: number[]; value: number[] } };
    layout: { nodeIndex: number[]; text: number[] };
    textBoxes: { layoutIndex: number[]; bounds: number[][]; start: number[]; length: number[] };
  }[];
};

/** Snapshot text boxes per owner, and the cross-check of every real (light DOM) text node against its Range client rects. */
function snapshotText(snap: Snapshot, dpr: number, textRects: readonly (readonly number[][])[]): { text: TextRecord[]; lines: number; worst: number } {
  const d = snap.documents[0];
  if (d === undefined) throw new Error('DOMSnapshot has no document');
  const S = snap.strings;
  const n = d.nodes;
  const pseudo = new Map<number, string>();
  (n.pseudoType?.index ?? []).forEach((i, k) => pseudo.set(i, S[n.pseudoType?.value[k] as number] as string));
  const shadowRoot = new Set<number>(n.shadowRootType?.index ?? []);
  const labels = new Map<number, string>();
  const childCount = new Map<number, number>();
  const inShadow = new Map<number, boolean>();
  const textIndex = new Map<string, number>();
  const textOwner = new Map<number, string>();
  const lightText: number[] = [];
  for (let i = 0; i < n.parentIndex.length; i++) {
    const parent = n.parentIndex[i] as number;
    inShadow.set(i, shadowRoot.has(i) || (parent >= 0 && inShadow.get(parent) === true));
    const name = S[n.nodeName[i] as number] as string;
    const parentLabel = parent >= 0 ? (labels.get(parent) ?? null) : null;
    if (pseudo.has(i)) {
      labels.set(i, `${parentLabel ?? ''}::${pseudo.get(i)}`);
      continue;
    }
    if (n.nodeType[i] === 1) {
      const k = childCount.get(parent) ?? 0;
      childCount.set(parent, k + 1);
      const attrs = (n.attributes[i] ?? []).map((s) => S[s] as string);
      labels.set(i, labelOf(name, attrOf(attrs, 'data-p'), parentLabel, k));
    } else if (parent >= 0 && labels.has(parent)) labels.set(i, parentLabel as string);
    if (n.nodeType[i] === 3) {
      const owner = parentLabel ?? '#document';
      const kind = inShadow.get(i) === true ? 'ua-text' : 'text';
      const k = textIndex.get(`${owner}:${kind}`) ?? 0;
      textIndex.set(`${owner}:${kind}`, k + 1);
      textOwner.set(i, `${owner}:${kind}${k}`);
      if (inShadow.get(i) !== true) lightText.push(i);
    }
  }
  for (const i of pseudo.keys()) textOwner.set(i, `${labels.get(i) as string}:text0`);
  // A <br> is a LayoutBR, a text object of its own.
  for (let i = 0; i < n.parentIndex.length; i++) if (n.nodeType[i] === 1 && S[n.nodeName[i] as number] === 'BR') textOwner.set(i, `${labels.get(i) as string}:br`);
  if (lightText.length !== textRects.length) throw new Error(`cross-check: the snapshot has ${lightText.length} light-DOM text nodes, the page ${textRects.length}`);
  const byNode = new Map<number, number[][]>();
  const recs = new Map<string, { owner: string; text: string; layouts: Set<number>; boxes: [number, number, number, number, number, number][] }>();
  for (let k = 0; k < d.textBoxes.layoutIndex.length; k++) {
    const li = d.textBoxes.layoutIndex[k] as number;
    const node = d.layout.nodeIndex[li] as number;
    const owner = textOwner.get(node);
    if (owner === undefined) throw new Error(`text box ${k} belongs to node ${node}, which is neither a text node, a pseudo element nor a br`);
    const b = d.textBoxes.bounds[k] as number[];
    const css = b.map((v) => v / dpr);
    const list = byNode.get(node) ?? [];
    list.push(css);
    byNode.set(node, list);
    const rec = recs.get(owner) ?? { owner, text: '', layouts: new Set<number>(), boxes: [] };
    if (!rec.layouts.has(li)) {
      rec.layouts.add(li);
      rec.text += S[d.layout.text[li] as number] ?? '';
    }
    rec.boxes.push([fr(css[0] as number), fr(css[1] as number), fr(css[2] as number), fr(css[3] as number), d.textBoxes.start[k] as number, d.textBoxes.length[k] as number]);
    recs.set(owner, rec);
  }
  let lines = 0;
  let worst = 0;
  lightText.forEach((node, t) => {
    const snapRects = byNode.get(node) ?? [];
    const range = textRects[t] as number[][];
    if (snapRects.length !== range.length) throw new Error(`cross-check: ${textOwner.get(node)} has ${snapRects.length} snapshot text boxes and ${range.length} Range client rects`);
    snapRects.forEach((s, j) => {
      lines++;
      for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs((s[c] as number) - ((range[j] as number[])[c] as number)));
    });
  });
  if (worst > CROSS_CHECK_CSS_PX) throw new Error(`cross-check: a snapshot text box differs from its Range client rect by ${worst} CSS px (limit ${CROSS_CHECK_CSS_PX})`);
  return { text: [...recs.values()].map((r) => ({ owner: r.owner, text: r.text, boxes: r.boxes })), lines, worst };
}

async function captureRun(browser: Browser, c: Case, dpr: number, dir: Dir): Promise<Run> {
  const page: Page = await openPage(browser, caseHtml(c), { viewport: VIEWPORT, devicePixelRatio: dpr, direction: dir, rootFont: 'ahem' });
  try {
    const cdp = await page.context().newCDPSession(page);
    const side = await page.evaluate(pageSide, { computed: [...COMPUTED], pseudos: [...PSEUDOS] });
    const pseudo = await pseudoRecords(cdp);
    const snap = (await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: true })) as unknown as Snapshot;
    const { text, lines, worst } = snapshotText(snap, dpr, side.textRects);
    const elements = side.elements.map((e) => ({ ...e, rect: rect4(e.rect) }));
    return { elements, pseudo, text, crossCheck: { lines, worst } };
  } finally {
    await page.context().close();
  }
}

/** The marker formula assertion of a geometry case: returns one line per marker that disagrees. */
export function geometryProblems(c: Case, run: Run, dpr: number, dir: Dir): string[] {
  if (c.geometry === undefined) return [];
  const problems: string[] = [];
  const markers = run.pseudo.filter((p) => p.type === 'marker');
  if (markers.length !== MARKER_SIZES.length) return [`${c.id} dpr ${dpr} ${dir}: ${markers.length} markers, expected ${MARKER_SIZES.length}`];
  const eps = 1e-3;
  markers.forEach((m, i) => {
    const li = run.elements.find((e) => e.label === m.host);
    if (li === undefined || m.box === null) {
      problems.push(`${c.id} ${m.host}: no li record or no marker box`);
      return;
    }
    const size = MARKER_SIZES[i] as number;
    const x = m.box[0] * dpr;
    const w = m.box[2] * dpr;
    const start = dir === 'ltr' ? li.rect[0] * dpr : (li.rect[0] + li.rect[2]) * dpr;
    let wantX: number;
    let wantW: number;
    if (c.geometry === 'symbol') {
      const s = symbolMarker(size, dpr);
      wantW = s.width;
      wantX = dir === 'ltr' ? start - s.offset : start + s.offset - s.width;
    } else {
      const t = run.text.find((r) => r.owner === `${m.host}::marker:text0`);
      if (t === undefined) {
        problems.push(`${c.id} ${m.host}: no marker text`);
        return;
      }
      wantW = t.boxes.reduce((a, b) => a + b[2], 0) * dpr;
      wantX = dir === 'ltr' ? start - wantW : start;
    }
    if (Math.abs(x - wantX) > eps || Math.abs(w - wantW) > eps) problems.push(`${c.id} ${m.host} size ${size} dpr ${dpr} ${dir}: marker x,w ${x},${w} device px, formula ${wantX},${wantW}`);
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Family 7: the symbol pixel oracle.

export type OracleCrop = {
  readonly id: string;
  readonly symbol: (typeof SYMBOLS)[number];
  readonly fontSize: number;
  readonly dpr: number;
  /** The marker text fragment's origin in device px (snapshot text box). */
  readonly fragment: readonly [number, number];
  /** RelativeSymbolMarkerRect moved by the fragment origin and pixel-snapped: left, top, right, bottom in device px. */
  readonly rect: readonly [number, number, number, number];
  readonly crop: readonly [number, number, number, number];
  readonly tileSize: number;
  /** Gray values, one hex string per row. */
  readonly rows: readonly string[];
};
export type OracleFile = { readonly chrome: string; readonly featureStatus: Record<string, Record<string, string>>; readonly crops: readonly OracleCrop[] };

/** LayoutUnit::Round of a value on the 1/64 grid (half up). */
export function roundLayoutUnit(v: number): number {
  const lu = Math.round(v * 64);
  if (Math.abs(lu - v * 64) > 1e-6) throw new Error(`${v} is not on the LayoutUnit grid`);
  return Math.floor((lu + 32) / 64);
}

/** ToPixelSnappedRect of the symbol rect at the fragment origin: [left, top, right, bottom]. */
export function snappedSymbolRect(fontSize: number, dpr: number, fx: number, fy: number): [number, number, number, number] {
  const r = symbolRect(fontSize, dpr);
  const left = roundLayoutUnit(fx + r.x);
  const top = roundLayoutUnit(fy + r.y);
  return [left, top, roundLayoutUnit(fx + r.x + r.size), roundLayoutUnit(fy + r.y + r.size)];
}

const ORACLE_PADDING = 60;
/** cc raster tiles: 256 device px at DPR 1, 512 at DSF >= 2 on macOS (T109); every crop stays inside tile 0. */
const tileSizeAt = (dpr: number): number => (dpr >= 2 ? 512 : 256);

async function softwareRaster(browser: Browser): Promise<Record<string, string>> {
  const cdp = await browser.newBrowserCDPSession();
  const info = (await cdp.send('SystemInfo.getInfo')) as unknown as { gpu: { featureStatus: Record<string, string> } };
  await cdp.detach();
  const fs = info.gpu.featureStatus;
  const want: Record<string, string> = { rasterization: 'disabled_software', gpu_compositing: 'disabled_software', skia_graphite: 'disabled_off' };
  for (const [k, v] of Object.entries(want)) if (fs[k] !== v) throw new Error(`precondition: SystemInfo featureStatus.${k} is ${fs[k]}, not ${v} (Chrome is not rastering on the CPU with Skia)`);
  return want;
}

async function captureOracle(browser: Browser, dpr: number): Promise<OracleCrop[]> {
  const out: OracleCrop[] = [];
  for (const symbol of SYMBOLS) {
    for (const fontSize of MARKER_SIZES) {
      const id = `${symbol}-${fontSize}-dpr${dpr}`;
      const html = `<!doctype html><html><head><style>html,body{margin:0;background:#fff;color:#000} ul{margin:10px 0 0;padding-left:${ORACLE_PADDING}px;list-style-type:${symbol}} li{font-size:${fontSize}px}</style></head><body><ul><li>x</li></ul></body></html>`;
      const page = await openPage(browser, html, { viewport: { width: 120, height: 80 }, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ahem' });
      try {
        const cdp = await page.context().newCDPSession(page);
        const snap = (await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: true })) as unknown as Snapshot;
        const d = snap.documents[0];
        if (d === undefined) throw new Error(`${id}: no document`);
        const markerNodes = new Set((d.nodes.pseudoType?.index ?? []).filter((_, k) => snap.strings[d.nodes.pseudoType?.value[k] as number] === 'marker'));
        const boxes = d.textBoxes.layoutIndex.map((li, k) => ({ node: d.layout.nodeIndex[li] as number, b: d.textBoxes.bounds[k] as number[] })).filter((t) => markerNodes.has(t.node));
        if (boxes.length !== 1) throw new Error(`${id}: ${boxes.length} marker text boxes, expected 1`);
        const fb = (boxes[0] as { b: number[] }).b;
        const fx = fb[0] as number;
        const fy = fb[1] as number;
        const rect = snappedSymbolRect(fontSize, dpr, fx, fy);
        const crop: [number, number, number, number] = [rect[0] - 2, rect[1] - 2, rect[2] + 2, rect[3] + 2];
        const tileSize = tileSizeAt(dpr);
        if (crop[0] < 0 || crop[1] < 0 || crop[2] > tileSize || crop[3] > tileSize) throw new Error(`${id}: crop ${crop} leaves cc tile 0`);
        const img = decodePng(await page.screenshot({ type: 'png' }));
        const rows: string[] = [];
        let ink: [number, number, number, number] | null = null;
        for (let y = crop[1]; y < crop[3]; y++) {
          let row = '';
          for (let x = crop[0]; x < crop[2]; x++) {
            const i = (y * img.w + x) * img.channels;
            const r = img.px[i] as number;
            if (r !== img.px[i + 1] || r !== img.px[i + 2]) throw new Error(`${id}: coloured pixel at ${x},${y}`);
            row += r.toString(16).padStart(2, '0');
            if (r !== 255) ink = ink === null ? [x, y, x + 1, y + 1] : [Math.min(ink[0], x), Math.min(ink[1], y), Math.max(ink[2], x + 1), Math.max(ink[3], y + 1)];
          }
          rows.push(row);
        }
        // The rect model must hold before any pixel is compared: a square fills it exactly, a disc stays inside it.
        const empty = rect[2] <= rect[0] || rect[3] <= rect[1];
        if (symbol === 'square' && (empty ? ink !== null : ink === null || ink.some((v, k) => v !== rect[k]))) throw new Error(`${id}: square ink ${ink} is not the snapped rect ${rect}`);
        if (symbol === 'disc' && ink !== null && (ink[0] < rect[0] || ink[1] < rect[1] || ink[2] > rect[2] || ink[3] > rect[3])) throw new Error(`${id}: disc ink ${ink} leaves the snapped rect ${rect}`);
        out.push({ id, symbol, fontSize, dpr, fragment: [fx, fy], rect, crop, tileSize, rows });
      } finally {
        await page.context().close();
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------

export const ORACLE_FILE = `${OUT_DIR}/family7-symbol-oracle.json`;

async function main(): Promise<void> {
  const args = parseProbeArgs(process.argv.slice(2), ['--check'], ['--only']);
  const only = args.values.get('--only');
  const families = FAMILIES.filter((f) => only === undefined || f.id === only);
  const withOracle = only === undefined || only === 'family7-symbol-oracle';
  if (families.length === 0 && !withOracle) throw new Error(`--only=${only} names no family`);
  const problems = caseProblems(FAMILIES);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const runs = new Map<string, Record<string, Run>>();
  const geometry: string[] = [];
  const crops: OracleCrop[] = [];
  const featureStatus: Record<string, Record<string, string>> = {};
  let lines = 0;
  let worst = 0;
  for (const dpr of DPRS) {
    const browser = await launchChrome(dpr);
    try {
      if (dpr !== 1) await zoomGuard(browser, dpr);
      for (const fam of families) {
        for (const c of fam.cases) {
          for (const dir of DIRS) {
            const run = await captureRun(browser, c, dpr, dir);
            lines += run.crossCheck.lines;
            worst = Math.max(worst, run.crossCheck.worst);
            geometry.push(...geometryProblems(c, run, dpr, dir));
            const key = `${fam.id}/${c.id}`;
            const r = runs.get(key) ?? {};
            r[`dpr-${dpr}/${dir}`] = run;
            runs.set(key, r);
          }
        }
      }
      if (withOracle) {
        featureStatus[`dpr-${dpr}`] = await softwareRaster(browser);
        crops.push(...(await captureOracle(browser, dpr)));
      }
    } finally {
      await browser.close();
    }
    console.log(`DPR ${dpr}: captured`);
  }
  console.log(`cross-check: ${lines} text lines, worst |snapshot / DPR - Range| ${worst} CSS px (limit ${CROSS_CHECK_CSS_PX})`);
  if (geometry.length > 0) throw new Error(`marker geometry disagrees with the formula:\n${geometry.join('\n')}`);
  console.log('marker geometry: every Ahem geometry-case marker matches the formula');
  const outputs: [string, string, string][] = families.map((fam) => {
    const body = { chrome: CHROME_VERSION, dprs: DPRS, dirs: DIRS, id: fam.id, title: fam.title, cases: fam.cases.map((c) => ({ ...c, runs: runs.get(`${fam.id}/${c.id}`) })) };
    return [repoPath(`${OUT_DIR}/${fam.id}.json`), `${formatJson(body, allPrimitives)}\n`, `${OUT_DIR}/${fam.id}.json`];
  });
  if (withOracle) {
    const file: OracleFile = { chrome: CHROME_VERSION, featureStatus, crops };
    outputs.push([repoPath(ORACLE_FILE), `${formatJson(file, allPrimitives)}\n`, ORACLE_FILE]);
  }
  if (!writeOrCheck(outputs, args.flags.has('--check'))) process.exitCode = 1;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('capture-gen-probe.ts')) await main();
