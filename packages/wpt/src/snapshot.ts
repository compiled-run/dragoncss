// Script-driven numeric tests: the ORIGINAL page runs in the pinned Chrome 145 with its own scripts and helper scripts, and
// every checkLayout call is intercepted to snapshot the DOM at that moment (elements, attributes as scripts left them, inline
// styles as scripts set them, <style> text as scripts modified it) together with the values check-layout reads. Each state
// becomes its own Dragon fixture case with the checks as the test ran them.
//
// Only deterministic scripts qualify. Instrumentation installed before any page script records every use, from test code (not
// from testharness.js or check-layout-th.js), of timers, animation frames, events, animations, scrolling, resizing, observers,
// clocks and randomness, I/O, the top layer, shadow roots and CSSOM sheet mutation; any use refuses the test with a precise
// "script:<what>" reason. The page is captured twice in fresh contexts and both captures must be identical.
//
// Captures are committed under packages/wpt/snapshots/ (like the parity lane's committed Chrome captures), so wpt:check runs
// without Chrome; wpt:run recaptures them into out/snapshots/ and wpt:update-expectations copies them in.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Browser, ChromeCheck, ChromeOutcome } from './chrome.ts';
import { withinTolerance } from './assertions.ts';
import type { DomDocument, DomElement, DomNode } from './dom.ts';
import { XHTML_NS } from './dom.ts';
import { packagePath } from './paths.ts';
import type { Check, DeadRuleFaults, ReadWpt, Sidecar, Translation } from './translate.ts';
import { CHECK_ATTRIBUTES, NO_DEAD_RULE_FAULTS, translateDocument, WPT_VIEWPORT } from './translate.ts';

/** One element of a snapshot: local name, namespace, attributes in order, children (text as strings), check-layout values. */
export type SnapshotNode = {
  readonly t: string;
  /** The namespace URI; absent for the XHTML namespace (almost every element), '' for none. */
  readonly ns?: string;
  readonly a: readonly (readonly [string, string])[];
  readonly c: readonly (SnapshotNode | string)[];
  /** The values check-layout reads for each check attribute present on the element, read by Chrome at this state. */
  readonly v?: { readonly [attribute: string]: number | string };
};

export type SnapshotState = {
  /** The checkLayout selector list of this call. */
  readonly call: string;
  /** How many nodes document.querySelectorAll matched in Chrome: check-layout's subtests for this call. */
  readonly matched: number;
  readonly tree: SnapshotNode;
};

export type SnapshotResult =
  | { readonly refused: string; readonly flags?: readonly string[] }
  | {
      readonly states: readonly SnapshotState[];
      /** testharness's harness status and its subtests in order (pass when status is 0). */
      readonly harness: { readonly status: number; readonly tests: readonly { readonly name: string; readonly pass: boolean }[] };
    };

export type SnapshotFile = {
  readonly source: string;
  readonly wpt: string;
  /** Chrome's version string, from its user agent. */
  readonly chrome: string;
  /** sha256 of the test file's source, so a changed file is never read against an old capture. */
  readonly sha256: string;
  readonly result: SnapshotResult;
};

/** Planted capture faults, for the tests: each one must make a script-driven check fail or be refused. */
export type SnapshotFaults = {
  /** Drops every style="" attribute from the snapshot (so styles scripts set inline are lost). */
  readonly dropStyleAttributes: boolean;
  /** Replaces every state's tree with the first state's tree (a dynamic test snapshotted once). */
  readonly firstStateOnly: boolean;
};
export const NO_SNAPSHOT_FAULTS: SnapshotFaults = { dropStyleAttributes: false, firstStateOnly: false };

/** Static refusals that mean the test has script logic, helper scripts or handlers: such tests take the snapshot path. */
export const needsSnapshot = (missing: string): boolean => missing === 'translate:script' || missing.startsWith('translate:script-src:') || missing === 'translate:event-attribute';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------------------------------------------------------------
// In the page.

const DATA_ATTRIBUTE: Readonly<Record<string, string>> = Object.fromEntries(
  CHECK_ATTRIBUTES.map((a) => [a, a === 'offset-x' || a === 'offset-y' || a === 'total-x' || a === 'total-y' ? `data-${a}` : `data-expected-${a}`]),
);

/**
 * Installed with addInitScript before any page script. Records test-code uses of non-deterministic APIs in
 * window.__dragonFlags, and intercepts window.checkLayout (defined by check-layout-th.js) to snapshot each state.
 */
export const INSTRUMENT_JS = `(() => {
  Error.stackTraceLimit = 64;
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const HARNESS = /\\/resources\\/(testharness|testharnessreport|check-layout-th)\\.js/;
  const flags = [];
  const states = [];
  Object.defineProperty(window, '__dragonSnapshot', { value: { flags, states } });
  // The first frame with a URL is the immediate page-level caller. Frames of this init script and of the automation's own
  // injected scripts carry none; every page script (inline, external or an event handler attribute) does.
  const fromTest = () => {
    const lines = (new Error().stack || '').split('\\n').slice(1);
    for (const line of lines) if (/https?:\\/\\//.test(line)) return !HARNESS.test(line);
    return false;
  };
  const flag = (f) => { if (f !== null && fromTest() && !flags.includes(f)) flags.push(f); };
  const wrap = (obj, name, f) => {
    if (obj === undefined || obj === null) return;
    const d = Object.getOwnPropertyDescriptor(obj, name);
    if (d === undefined || typeof d.value !== 'function') return;
    const orig = d.value;
    Object.defineProperty(obj, name, { ...d, value: function (...args) { flag(typeof f === 'function' ? f(args) : f); return orig.apply(this, args); } });
  };
  const wrapSetter = (obj, name, f) => {
    if (obj === undefined || obj === null) return;
    const d = Object.getOwnPropertyDescriptor(obj, name);
    if (d === undefined || d.set === undefined) return;
    Object.defineProperty(obj, name, { ...d, set: function (v) { flag(f); return d.set.call(this, v); } });
  };
  const wrapGetter = (obj, name, f) => {
    if (obj === undefined || obj === null) return;
    const d = Object.getOwnPropertyDescriptor(obj, name);
    if (d === undefined || d.get === undefined) return;
    Object.defineProperty(obj, name, { ...d, get: function () { flag(f); return d.get.call(this); } });
  };
  const wrapCtor = (name, f) => {
    const C = window[name];
    if (typeof C !== 'function') return;
    const W = new Proxy(C, { construct(t, args, nt) { flag(f); return Reflect.construct(t, args, nt); } });
    Object.defineProperty(window, name, { value: W, writable: true, configurable: true });
  };
  for (const n of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback']) wrap(window, n, 'script:timing:' + n);
  wrap(EventTarget.prototype, 'addEventListener', (a) => (a[0] === 'load' || a[0] === 'DOMContentLoaded' ? null : 'script:event:' + String(a[0])));
  wrap(EventTarget.prototype, 'dispatchEvent', 'script:event:dispatch');
  for (const n of ['click', 'focus', 'blur']) wrap(HTMLElement.prototype, n, 'script:event:' + n);
  wrap(Element.prototype, 'animate', 'script:animation');
  wrapCtor('Animation', 'script:animation');
  wrapCtor('KeyframeEffect', 'script:animation');
  for (const n of ['scroll', 'scrollTo', 'scrollBy', 'scrollIntoView', 'scrollIntoViewIfNeeded']) { wrap(Element.prototype, n, 'script:scroll'); wrap(window, n, 'script:scroll'); }
  for (const n of ['scrollTop', 'scrollLeft']) wrapSetter(Element.prototype, n, 'script:scroll');
  wrap(window, 'resizeTo', 'script:resize');
  wrap(window, 'resizeBy', 'script:resize');
  wrapCtor('ResizeObserver', 'script:resize-observer');
  wrapCtor('IntersectionObserver', 'script:intersection-observer');
  wrap(Math, 'random', 'script:nondeterministic:Math.random');
  wrap(Date, 'now', 'script:nondeterministic:Date.now');
  wrap(Performance.prototype, 'now', 'script:nondeterministic:performance.now');
  wrap(Crypto.prototype, 'getRandomValues', 'script:nondeterministic:crypto');
  wrap(window, 'fetch', 'script:io:fetch');
  wrap(XMLHttpRequest.prototype, 'open', 'script:io:xhr');
  wrap(window, 'open', 'script:io:window-open');
  wrap(window, 'postMessage', 'script:io:postMessage');
  if (window.HTMLDialogElement) wrap(HTMLDialogElement.prototype, 'showModal', 'script:top-layer:showModal');
  for (const n of ['showPopover', 'togglePopover']) wrap(HTMLElement.prototype, n, 'script:top-layer:popover');
  wrap(Element.prototype, 'requestFullscreen', 'script:top-layer:fullscreen');
  wrap(Element.prototype, 'attachShadow', 'script:shadow-dom');
  for (const n of ['insertRule', 'deleteRule', 'addRule', 'removeRule', 'replace', 'replaceSync']) wrap(CSSStyleSheet.prototype, n, 'script:cssom-sheet');
  for (const n of ['insertRule', 'deleteRule']) wrap(CSSGroupingRule.prototype, n, 'script:cssom-sheet');
  wrapGetter(CSSStyleRule.prototype, 'style', 'script:cssom-sheet');
  wrapSetter(CSSStyleRule.prototype, 'selectorText', 'script:cssom-sheet');
  wrapSetter(StyleSheet.prototype, 'disabled', 'script:cssom-sheet');
  wrapSetter(Document.prototype, 'adoptedStyleSheets', 'script:cssom-sheet');
  if (window.CSS) wrap(CSS, 'registerProperty', 'script:register-property');
  wrapCtor('FontFace', 'script:font-face-api');

  const DATA = ${JSON.stringify(DATA_ATTRIBUTE)};
  const read = (el, a) => {
    const cs = getComputedStyle(el);
    switch (a) {
      case 'width': return el.offsetWidth;
      case 'height': return el.offsetHeight;
      case 'offset-x': return el.offsetLeft;
      case 'offset-y': return el.offsetTop;
      case 'client-width': return el.clientWidth;
      case 'client-height': return el.clientHeight;
      case 'scroll-width': return el.scrollWidth;
      case 'scroll-height': return el.scrollHeight;
      case 'bounding-client-rect-width': return el.getBoundingClientRect().width;
      case 'bounding-client-rect-height': return el.getBoundingClientRect().height;
      case 'total-x': return el.clientLeft + el.offsetLeft;
      case 'total-y': return el.clientTop + el.offsetTop;
      case 'display': return cs.display;
      default: return cs.getPropertyValue(a).slice(0, -2);
    }
  };
  let scrolled = false;
  const walk = (el) => {
    const node = { t: el.localName, a: [], c: [] };
    if (el.namespaceURI !== XHTML) node.ns = el.namespaceURI || '';
    for (const at of el.attributes) node.a.push([at.name, at.value]);
    const v = {};
    let any = false;
    for (const a in DATA) {
      const x = el.getAttribute(DATA[a]);
      if (x) { v[a] = read(el, a); any = true; }
    }
    if (any) node.v = v;
    if (el.shadowRoot) flags.includes('snapshot:shadow-root') || flags.push('snapshot:shadow-root');
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) scrolled = true;
    for (const ch of el.childNodes) {
      if (ch.nodeType === 1) {
        if (ch.localName === 'script' && ch.namespaceURI === XHTML) continue;
        node.c.push(walk(ch));
      } else if (ch.nodeType === 3 || ch.nodeType === 4) node.c.push(ch.data);
    }
    return node;
  };
  const capture = (call) => {
    let matched = 0;
    try { matched = call ? document.querySelectorAll(call).length : 0; } catch (e) { matched = -1; }
    scrolled = window.scrollX !== 0 || window.scrollY !== 0;
    const tree = walk(document.documentElement);
    states.push({
      call: String(call), matched, tree, compatMode: document.compatMode, scrolled,
      animations: document.getAnimations().length, adopted: document.adoptedStyleSheets.length,
    });
  };
  let real;
  const hooked = function (selectorList) {
    capture(selectorList);
    return real.apply(this, arguments);
  };
  Object.defineProperty(window, 'checkLayout', { configurable: true, get() { return real === undefined ? undefined : hooked; }, set(fn) { real = fn; } });
  let stepTimeout;
  Object.defineProperty(window, 'step_timeout', { configurable: true, get() { return stepTimeout === undefined ? undefined : function () { flag('script:timing:step_timeout'); return stepTimeout.apply(this, arguments); }; }, set(fn) { stepTimeout = fn; } });
})();`;

type RawState = SnapshotState & { readonly compatMode: string; readonly scrolled: boolean; readonly animations: number; readonly adopted: number };
type RawCapture = {
  readonly flags: readonly string[];
  readonly states: readonly RawState[];
  readonly harness: { status: number; tests: { name: string; status: number }[] } | null;
  readonly userAgent: string;
};

async function captureOnce(browser: Browser, origin: string, path: string): Promise<RawCapture> {
  const context = await browser.newContext({ viewport: { ...WPT_VIEWPORT }, deviceScaleFactor: 1 });
  try {
    await context.addInitScript(INSTRUMENT_JS);
    const page = await context.newPage();
    await page.goto(`${origin}/${path}`, { waitUntil: 'load' });
    const done = await page.waitForFunction(() => (window as unknown as { __dragonWpt?: unknown }).__dragonWpt !== undefined, undefined, { timeout: 20_000 }).then(() => true, () => false);
    return await page.evaluate((finished: boolean) => {
      const w = window as unknown as { __dragonWpt?: { status: number; tests: { name: string; status: number }[] }; __dragonSnapshot: { flags: string[]; states: RawState[] } };
      return { flags: [...w.__dragonSnapshot.flags], states: w.__dragonSnapshot.states, harness: finished ? (w.__dragonWpt ?? null) : null, userAgent: navigator.userAgent };
    }, done);
  } finally {
    await context.close();
  }
}

const mapTree = (n: SnapshotNode, f: (n: SnapshotNode) => SnapshotNode): SnapshotNode => f({ ...n, c: n.c.map((c) => (typeof c === 'string' ? c : mapTree(c, f))) });

/** The result of one raw capture: its refusal, in a fixed order of precedence, or its states. */
export function resultOf(raw: RawCapture, faults: SnapshotFaults = NO_SNAPSHOT_FAULTS): SnapshotResult {
  const flags = [...raw.flags].sort();
  if (flags.length > 0) return { refused: flags[0] as string, flags };
  if (raw.harness === null) return { refused: 'snapshot:harness-incomplete' };
  if (raw.harness.status !== 0) return { refused: `snapshot:harness-status:${raw.harness.status}` };
  if (raw.states.length === 0) return { refused: 'snapshot:no-checklayout' };
  if (raw.states.some((s) => s.matched < 0)) return { refused: 'snapshot:checklayout-selector' };
  if (raw.states.reduce((n, s) => n + s.matched, 0) !== raw.harness.tests.length) return { refused: 'snapshot:other-subtests' };
  if (raw.states.some((s) => s.compatMode !== 'CSS1Compat')) return { refused: 'snapshot:quirks-mode' };
  if (raw.states.some((s) => s.scrolled)) return { refused: 'snapshot:scrolled' };
  if (raw.states.some((s) => s.animations > 0)) return { refused: 'snapshot:animation-running' };
  if (raw.states.some((s) => s.adopted > 0)) return { refused: 'script:cssom-sheet' };
  let states: SnapshotState[] = raw.states.map((s) => ({ call: s.call, matched: s.matched, tree: s.tree }));
  if (faults.dropStyleAttributes) states = states.map((s) => ({ ...s, tree: mapTree(s.tree, (n) => ({ ...n, a: n.a.filter(([k]) => k !== 'style') })) }));
  if (faults.firstStateOnly) states = states.map((s) => ({ ...s, tree: (states[0] as SnapshotState).tree }));
  return { states, harness: { status: raw.harness.status, tests: raw.harness.tests.map((t) => ({ name: t.name, pass: t.status === 0 })) } };
}

/** Captures the original test twice in fresh contexts; a capture that differs between the two runs is refused. */
export async function captureSnapshot(browser: Browser, origin: string, path: string, source: string, commit: string, faults: SnapshotFaults = NO_SNAPSHOT_FAULTS): Promise<SnapshotFile> {
  const first = await captureOnce(browser, origin, path);
  const second = await captureOnce(browser, origin, path);
  const chrome = /Chrome\/([\d.]+)/.exec(first.userAgent)?.[1] ?? 'unknown';
  const a = resultOf(first, faults);
  const b = resultOf(second, faults);
  const result: SnapshotResult = JSON.stringify(a) === JSON.stringify(b) ? a : { refused: 'snapshot:nondeterministic' };
  return { source: path, wpt: commit, chrome, sha256: sha256(source), result };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The store.

export const SNAPSHOT_DIR = packagePath('snapshots');
export const RUN_SNAPSHOT_DIR = packagePath('out/snapshots');
export const snapshotFile = (dir: string, path: string): string => join(dir, `${path}.json`);

/** A stored state after the first: per-element changes from the previous state when the element structure is unchanged. */
type Patch = { readonly [elementIndex: string]: { readonly a?: SnapshotNode['a']; readonly v?: SnapshotNode['v'] | null; readonly x?: readonly string[] } };
type StoredState = { readonly call: string; readonly matched: number; readonly tree: SnapshotNode } | { readonly call: string; readonly matched: number; readonly patch: Patch };

const shape = (n: SnapshotNode): unknown => [n.t, n.ns ?? XHTML_NS, n.c.map((c) => (typeof c === 'string' ? 0 : shape(c)))];
const texts = (n: SnapshotNode): string[] => n.c.filter((c): c is string => typeof c === 'string');

/** States after the first are stored as patches of the previous state when only attributes, values or text changed. */
export function encodeStates(states: readonly SnapshotState[]): StoredState[] {
  return states.map((s, i): StoredState => {
    const prev = states[i - 1];
    if (prev === undefined || JSON.stringify(shape(prev.tree)) !== JSON.stringify(shape(s.tree))) return s;
    const before = flatten(prev.tree);
    const after = flatten(s.tree);
    const patch: Record<string, { a?: SnapshotNode['a']; v?: SnapshotNode['v'] | null; x?: string[] }> = {};
    after.forEach((n, k) => {
      const o = before[k] as SnapshotNode;
      const d: { a?: SnapshotNode['a']; v?: SnapshotNode['v'] | null; x?: string[] } = {};
      if (JSON.stringify(o.a) !== JSON.stringify(n.a)) d.a = n.a;
      if (JSON.stringify(o.v ?? null) !== JSON.stringify(n.v ?? null)) d.v = n.v ?? null;
      if (JSON.stringify(texts(o)) !== JSON.stringify(texts(n))) d.x = texts(n);
      if (Object.keys(d).length > 0) patch[String(k)] = d;
    });
    return { call: s.call, matched: s.matched, patch };
  });
}

export function decodeStates(stored: readonly StoredState[]): SnapshotState[] {
  const out: SnapshotState[] = [];
  for (const s of stored) {
    if ('tree' in s) {
      out.push(s);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev === undefined) throw new Error('a snapshot patch needs a previous state');
    const tree = JSON.parse(JSON.stringify(prev.tree)) as SnapshotNode;
    const nodes = flatten(tree) as unknown as { a: SnapshotNode['a']; v?: SnapshotNode['v']; c: (SnapshotNode | string)[] }[];
    for (const [k, d] of Object.entries(s.patch)) {
      const n = nodes[Number(k)];
      if (n === undefined) throw new Error(`snapshot patch names element ${k}, which the previous state does not have`);
      if (d.a !== undefined) n.a = d.a;
      if (d.v !== undefined) {
        if (d.v === null) delete n.v;
        else n.v = d.v;
      }
      if (d.x !== undefined) {
        let t = 0;
        n.c = n.c.map((c) => (typeof c === 'string' ? (d.x?.[t++] as string) : c));
      }
    }
    out.push({ call: s.call, matched: s.matched, tree });
  }
  return out;
}

/** Deterministic text: fixed key order, one state per line (states after the first as patches of the previous one). */
export function serializeSnapshot(f: SnapshotFile): string {
  const head = `{\n  "source": ${JSON.stringify(f.source)},\n  "wpt": ${JSON.stringify(f.wpt)},\n  "chrome": ${JSON.stringify(f.chrome)},\n  "sha256": ${JSON.stringify(f.sha256)},\n`;
  const r = f.result;
  if ('refused' in r) return `${head}  "result": ${JSON.stringify(r)}\n}\n`;
  const states = encodeStates(r.states).map((s) => `      ${JSON.stringify(s)}`).join(',\n');
  return `${head}  "result": {\n    "harness": ${JSON.stringify(r.harness)},\n    "states": [\n${states}\n    ]\n  }\n}\n`;
}

export function parseSnapshot(text: string): SnapshotFile {
  const f = JSON.parse(text) as SnapshotFile;
  if ('refused' in f.result) return f;
  return { ...f, result: { ...f.result, states: decodeStates(f.result.states as unknown as StoredState[]) } };
}

export function readSnapshot(dir: string, path: string): SnapshotFile | null {
  const file = snapshotFile(dir, path);
  return existsSync(file) ? parseSnapshot(readFileSync(file, 'utf8')) : null;
}

export function writeSnapshot(dir: string, f: SnapshotFile): void {
  const file = snapshotFile(dir, f.source);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeSnapshot(f));
}

/** Every WPT path with a snapshot in dir, sorted. */
export function listSnapshots(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.json')) out.push(relative(dir, join(d, e.name)).slice(0, -'.json'.length).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Replaces the committed store with a run's store. */
export function replaceSnapshots(from: string, to: string): number {
  rmSync(to, { recursive: true, force: true });
  const paths = listSnapshots(from);
  for (const p of paths) {
    const f = readSnapshot(from, p) as SnapshotFile;
    writeSnapshot(to, f);
  }
  return paths.length;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Snapshot to fixtures.

export function toDomElement(n: SnapshotNode): DomElement {
  return { tag: n.t, ns: n.ns ?? XHTML_NS, attrs: n.a, children: n.c.map((c): DomNode => (typeof c === 'string' ? { text: c } : toDomElement(c))) };
}

export const snapshotDocument = (s: SnapshotState): DomDocument => ({ root: toDomElement(s.tree), stylesheetPIs: [], origin: 'snapshot' });

/** The elements of a snapshot tree in document order: the translator's element indexes. */
export function flatten(n: SnapshotNode, out: SnapshotNode[] = []): SnapshotNode[] {
  out.push(n);
  for (const c of n.c) if (typeof c !== 'string') flatten(c, out);
  return out;
}

/** Why a snapshot cannot be used for this source, or null when it can. */
export function snapshotProblem(f: SnapshotFile | null, source: string, commit: string): string | null {
  if (f === null) return 'snapshot:missing';
  if (f.wpt !== commit || f.sha256 !== sha256(source)) return 'snapshot:stale';
  return null;
}

/** One translation per state, numbered as check-layout numbers its subtests across calls; one case per state. */
export function translateSnapshot(path: string, states: readonly SnapshotState[], commit: string, readWpt: ReadWpt, deadRuleFaults: DeadRuleFaults = NO_DEAD_RULE_FAULTS): Translation[] {
  let before = 0;
  const first = states[0];
  return states.map((s, i) => {
    const t = translateDocument(path, snapshotDocument(s), commit, readWpt, {
      calls: [s.call], firstTestNumber: before, idSuffix: states.length > 1 ? `.state-${i}` : '', deadRuleFaults,
      ...(deadRuleFaults.dropFirstStateOnly && first !== undefined ? { deadRuleDocument: snapshotDocument(first) } : {}),
    });
    before += s.matched;
    return t;
  });
}

/** Chrome's result on the translated checks, from the values the snapshot read at each state, plus the harness's own subtests. */
export function chromeFromSnapshot(result: Extract<SnapshotResult, { states: unknown }>, sidecars: readonly Sidecar[]): ChromeOutcome {
  const checks: ChromeCheck[] = [];
  const perSubtest: { name: string; pass: boolean }[] = [];
  sidecars.forEach((sidecar, i) => {
    const nodes = flatten((result.states[i] as SnapshotState).tree);
    for (const s of sidecar.subtests) {
      const own = s.checks.map((c: Check): ChromeCheck => {
        const actual = c.attribute === 'data-key' ? null : (nodes[c.element]?.v?.[c.attribute] ?? null);
        if (actual === null) return { actual, pass: false };
        return { actual, pass: typeof actual === 'number' ? withinTolerance(actual, c.expected) : actual === c.expected };
      });
      checks.push(...own);
      perSubtest.push({ name: s.name, pass: own.every((c) => c.pass) });
    }
  });
  const subtests = result.harness.tests.map((t) => ({ name: t.name, pass: t.pass }));
  return { harness: result.harness.status, subtests, checks, agrees: result.harness.status === 0 && JSON.stringify(subtests) === JSON.stringify(perSubtest), deadRulesLive: [] };
}

/**
 * Chrome's confirmation of each state's dropped dead rules (Sidecar.deadRules): the original page runs again with its scripts,
 * and at its k-th checkLayout call (state k) querySelectorAll counts each of that state's dropped selector lists. Returns the lists
 * that matched something, that Chrome could not parse, or whose state the page never reached, as "state <k>: <list>".
 */
export async function liveDeadRulesInSnapshot(browser: Browser, origin: string, path: string, perState: readonly (readonly string[])[]): Promise<string[]> {
  if (perState.every((l) => l.length === 0)) return [];
  const context = await browser.newContext({ viewport: { ...WPT_VIEWPORT }, deviceScaleFactor: 1 });
  try {
    await context.addInitScript(`(() => {
  const lists = ${JSON.stringify(perState)};
  const counts = [];
  Object.defineProperty(window, '__dragonDeadRules', { value: counts });
  let real;
  const hooked = function () {
    const own = lists[counts.length] || [];
    counts.push(own.map((sel) => { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } }));
    return real.apply(this, arguments);
  };
  Object.defineProperty(window, 'checkLayout', { configurable: true, get() { return real === undefined ? undefined : hooked; }, set(fn) { real = fn; } });
})();`);
    const page = await context.newPage();
    await page.goto(`${origin}/${path}`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as unknown as { __dragonWpt?: unknown }).__dragonWpt !== undefined, undefined, { timeout: 20_000 }).catch(() => undefined);
    const counts = await page.evaluate(() => (window as unknown as { __dragonDeadRules: number[][] }).__dragonDeadRules);
    return perState.flatMap((lists, k) => lists.filter((_, i) => counts[k]?.[i] !== 0).map((l) => `state ${k}: ${l}`));
  } finally {
    await context.close();
  }
}
