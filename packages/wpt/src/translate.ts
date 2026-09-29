// Translates one check-layout WPT test into a Dragon HTML fixture (the strict subset packages/parity/src/fixture-reader.ts
// reads) plus a sidecar of the checks. Harness nodes are removed, every <style> becomes the one sheet, inline style="" and #id
// selectors are lifted into generated classes, and a cascade guard refuses the test when the lift could change a winner.
// Anything else the fixture cannot express is a refusal; feature support is left to Dragon's compiler.
// The input is a document tree (src/dom.ts): an HTML page, an XHTML or XML page (src/xml.ts), or Chrome's DOM snapshot of the
// page after its scripts ran (src/snapshot.ts), in which case the checkLayout calls come from the snapshot, not from the scripts.
import type { ComplexSelector, Declaration, Match, MatchElement, SheetItem, Specificity } from './css-lite.ts';
import { groupsOverlap, matches, parseSelectorList, readDeclarations, readSheet, rewriteIds, specificity, stripComments } from './css-lite.ts';
import type { DomDocument, DomElement } from './dom.ts';
import { isElement, parseHtmlDocument, XHTML_NS } from './dom.ts';
import { parseXmlDocument, XmlError } from './xml.ts';

/** WPT runs every test in an 800x600 viewport at device pixel ratio 1 (wptrunner's default window). */
export const WPT_VIEWPORT = { width: 800, height: 600 } as const;

/** check-layout-th.js checkExpectedValues order; data-key is its checkDataKeys typo guard. */
export const CHECK_ATTRIBUTES = [
  'width', 'height', 'offset-x', 'offset-y', 'client-width', 'client-height', 'scroll-width', 'scroll-height',
  'bounding-client-rect-width', 'bounding-client-rect-height', 'total-x', 'total-y', 'display',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
] as const;
export type CheckAttribute = (typeof CHECK_ATTRIBUTES)[number] | 'data-key';

const dataName = (a: (typeof CHECK_ATTRIBUTES)[number]): string => (a === 'offset-x' || a === 'offset-y' ? `data-${a}` : a === 'total-x' || a === 'total-y' ? `data-${a}` : `data-expected-${a}`);
const VALID_DATA = new Set(['data-anchor-polyfill', ...CHECK_ATTRIBUTES.map(dataName)]);

export type Check = {
  /** The data-dragon-id of the checked element in the fixture. */
  readonly node: string;
  /** The element's index in document order in the original page (document.getElementsByTagName('*')). */
  readonly element: number;
  readonly attribute: CheckAttribute;
  /** The attribute text, as check-layout reads it. */
  readonly expected: string;
};

export type Subtest = { readonly name: string; readonly target: string; readonly checks: readonly Check[] };

export type Sidecar = {
  readonly source: string;
  readonly wpt: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly subtests: readonly Subtest[];
  /**
   * The selector lists of the style rules the translator dropped as dead (no selector can match any element of this document
   * state), in sheet order; absent when none was dropped. wpt:run with Chrome confirms each one matches nothing in the original page.
   */
  readonly deadRules?: readonly string[];
};

export type Translation =
  | { readonly kind: 'refused'; readonly missing: string }
  | {
      readonly kind: 'fixture';
      readonly id: string;
      readonly html: string;
      readonly sidecar: Sidecar;
      /** 'translate:specificity-rewrite' when lifting could change which declaration wins, else null. */
      readonly guard: string | null;
      /** Element data-dragon-id to tag, parent id (null for html) and index in document order of the source tree. */
      readonly elements: ReadonlyMap<string, { readonly tag: string; readonly parent: string | null; readonly index: number }>;
    };

const HARNESS_SCRIPT = /\/resources\/(testharness|testharnessreport|check-layout-th)\.js$/;
const AHEM_SHEET = /\/fonts\/ahem\.css$/i;

type El = {
  readonly ns: string;
  readonly tag: string;
  readonly attrs: Map<string, string>;
  readonly parent: El | null;
  previous: El | null;
  readonly children: (El | { readonly text: string })[];
  readonly index: number;
  id: string;
  removed: boolean;
};

const refuse = (missing: string): Translation => ({ kind: 'refused', missing });

/** The checkLayout selector lists a harness script calls, or null when it holds any other logic. */
export function harnessCalls(code: string): string[] | null {
  let c = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const calls: string[] = [];
  c = c.replace(/checkLayout\s*\(\s*(['"`])((?:(?!\1)[^\\])*)\1\s*(?:,\s*(?:true|false)\s*)?\)/g, (_m, _q: string, sel: string) => {
    calls.push(sel);
    return ' ';
  });
  const rest = c.replace(/setup\s*\(\s*\{\s*explicit_done\s*:\s*true\s*\}\s*\)|window\.onload|document\.fonts\.ready\.then|document\.fonts\.ready|window\.addEventListener|document\.addEventListener|addEventListener|(['"])(load|DOMContentLoaded)\1|\bfunction\b|\basync\b|\bawait\b|=>|\bdone\b|\.then|[{}();,=\s]/g, '');
  return rest === '' ? calls : null;
}

/** A fixture id for a WPT path: the path with characters outside [A-Za-z0-9/._-] replaced. */
export const fixtureIdOf = (path: string): string => `wpt/${path.replace(/[^A-Za-z0-9/._-]/g, '_')}`;

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

type GuardRule = { readonly selectors: readonly ComplexSelector[] | null; readonly declarations: readonly Declaration[] };

const cmpKey = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < a.length; i++) if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) < (b[i] as number) ? -1 : 1;
  return 0;
};
const maxSpec = (a: Specificity | null, b: Specificity): Specificity => (a === null || cmpKey(b, a) > 0 ? b : a);

/**
 * The cascade guard: for every element, every pair of interacting declarations must keep its order when #id selectors count as
 * classes and each inline style becomes a class rule after every sheet rule. Unevaluable selectors are assumed to match.
 */
export function cascadeChanges(elements: readonly MatchElement[], rules: readonly GuardRule[], inline: ReadonlyMap<MatchElement, readonly Declaration[]>): boolean {
  const INLINE: Specificity = [1e6, 0, 0];
  const LIFTED: Specificity = [0, 1, 0];
  for (const el of elements) {
    const entries: { property: string; before: number[]; after: number[] }[] = [];
    rules.forEach((r, order) => {
      let before: Specificity | null = null;
      let after: Specificity | null = null;
      if (r.selectors === null) {
        before = [0, 0, 0];
        after = [0, 0, 0];
      } else {
        for (const s of r.selectors) {
          const m: Match = matches(el, s);
          if (m === false) continue;
          before = maxSpec(before, specificity(s, false));
          after = maxSpec(after, specificity(s, true));
        }
      }
      if (before === null || after === null) return;
      r.declarations.forEach((d, j) => {
        const imp = d.important ? 1 : 0;
        entries.push({ property: d.property, before: [imp, ...(before as Specificity), order, j], after: [imp, ...(after as Specificity), order, j] });
      });
    });
    (inline.get(el) ?? []).forEach((d, j) => {
      const imp = d.important ? 1 : 0;
      entries.push({ property: d.property, before: [imp, ...INLINE, rules.length, j], after: [imp, ...LIFTED, rules.length, j] });
    });
    for (let i = 0; i < entries.length; i++) {
      for (let k = i + 1; k < entries.length; k++) {
        const a = entries[i] as (typeof entries)[number];
        const b = entries[k] as (typeof entries)[number];
        if (!groupsOverlap(a.property, b.property)) continue;
        if (Math.sign(cmpKey(a.before, b.before)) !== Math.sign(cmpKey(a.after, b.after))) return true;
      }
    }
  }
  return false;
}

/** Reads a WPT file by its path from the WPT root ("css/support/grid.css"); null when it does not exist. */
export type ReadWpt = (path: string) => string | null;

/** A stylesheet href resolved against the test's URL, as a path from the WPT root; null when it leaves the WPT root. */
export function resolveHref(testPath: string, href: string): string | null {
  const u = new URL(href, `http://wpt.invalid/${testPath}`);
  if (u.host !== 'wpt.invalid' || u.search !== '' || u.hash !== '') return null;
  return decodeURIComponent(u.pathname.slice(1));
}

export type TranslateOptions = {
  /**
   * 'check-layout' (default): the test's checkLayout calls become subtests. 'reftest': no checks; the fixture alone is wanted
   * (src/reftest.ts), and any script is refused.
   */
  readonly mode?: 'check-layout' | 'reftest';
  /**
   * Snapshot mode: the checkLayout selector lists Chrome saw called at this DOM state. Scripts and event handler attributes are
   * then dropped unread, because the snapshot already holds what they did.
   */
  readonly calls?: readonly string[];
  /** check-layout's running test number before this state's calls (it counts across calls). */
  readonly firstTestNumber?: number;
  /** Appended to the fixture id, for one case per snapshot state. */
  readonly idSuffix?: string;
  /** Planted dead-rule faults, for the tests (default: none). */
  readonly deadRuleFaults?: DeadRuleFaults;
  /** The document the dead-rule judgement reads instead of this one: only the dropFirstStateOnly plant sets it. */
  readonly deadRuleDocument?: DomDocument;
};

/** Planted dead-rule faults: each must be caught by Chrome's querySelectorAll confirmation (translate:dead-rule-live). */
export type DeadRuleFaults = {
  /** Also drops rules a selector of which definitely matches an element. */
  readonly dropLiveRule: boolean;
  /** Also drops rules with an unknown selector (outside the subset, or with a pseudo-class or pseudo-element) that nothing definitely matches. */
  readonly dropUnknownSelector: boolean;
  /** Snapshot tests: judges every state's rules on the first state's document (src/snapshot.ts translateSnapshot). */
  readonly dropFirstStateOnly: boolean;
};
export const NO_DEAD_RULE_FAULTS: DeadRuleFaults = { dropLiveRule: false, dropUnknownSelector: false, dropFirstStateOnly: false };

const foldCase = (s: string): string => s.toLowerCase();

/** An element with its tag and attribute values case-folded (and so are its ancestors and previous siblings). */
function foldElement(el: MatchElement, memo: Map<MatchElement, MatchElement>): MatchElement {
  const hit = memo.get(el);
  if (hit !== undefined) return hit;
  const attrs = new Map<string, string>();
  for (const [k, v] of el.attrs) attrs.set(foldCase(k), foldCase(v));
  const out: MatchElement = { tag: foldCase(el.tag), attrs, parent: el.parent === null ? null : foldElement(el.parent, memo), previous: el.previous === null ? null : foldElement(el.previous, memo) };
  memo.set(el, out);
  return out;
}

const foldSelector = (s: ComplexSelector): ComplexSelector => ({
  combinators: s.combinators,
  compounds: s.compounds.map((k) => ({
    ...k,
    tag: k.tag === null ? null : foldCase(k.tag),
    ids: k.ids.map((id) => ({ ...id, value: foldCase(id.value) })),
    classes: k.classes.map(foldCase),
    attributes: k.attributes.map((t) => ({ ...t, name: foldCase(t.name), value: foldCase(t.value) })),
  })),
});

/** Every element of a document tree in document order, as css-lite match elements. */
export function matchElementsOf(doc: DomDocument): MatchElement[] {
  const out: MatchElement[] = [];
  const walk = (node: DomElement, parent: MatchElement | null, previous: MatchElement | null): MatchElement => {
    const el: MatchElement = { tag: node.tag, attrs: new Map(node.attrs), parent, previous };
    out.push(el);
    let prev: MatchElement | null = null;
    for (const c of node.children) if (isElement(c)) prev = walk(c, el, prev);
    return el;
  };
  walk(doc.root, null, null);
  return out;
}

/**
 * Whether a style rule is provably dead: its selector list parsed, no selector has a pseudo-class or pseudo-element, and css-lite
 * returns a definite false for every selector on every element. Matching is case-folded (tags, ids, classes, attribute names and
 * values), so quirks-mode and HTML's case-insensitive attribute values can only keep a rule, never drop a live one.
 */
export function deadRule(selectors: readonly ComplexSelector[] | null, elements: readonly MatchElement[], faults: DeadRuleFaults = NO_DEAD_RULE_FAULTS): boolean {
  // The dropUnknownSelector plant also drops rules outside the parsed subset.
  if (selectors === null || selectors.length === 0) return selectors === null && faults.dropUnknownSelector;
  const memo = new Map<MatchElement, MatchElement>();
  const folded = elements.map((e) => foldElement(e, memo));
  for (const s of selectors) {
    if (s.compounds.some((k) => k.pseudos.length > 0 || k.pseudoElements > 0) && !faults.dropUnknownSelector) return false;
    const f = foldSelector(s);
    for (const el of folded) {
      const m = matches(el, f);
      if (m === true && !faults.dropLiveRule) return false;
      if (m === 'unknown' && !faults.dropUnknownSelector) return false;
    }
  }
  return true;
}

/** The document tree of a WPT file by its extension, or the refusal when it cannot be read. */
export function parseWptDocument(path: string, source: string): DomDocument | { readonly missing: string } {
  if (/\.svg$/.test(path)) return { missing: 'translate:svg-document' };
  if (/\.(xht|xhtml|xml)$/.test(path)) {
    try {
      return parseXmlDocument(source);
    } catch (e) {
      if (e instanceof XmlError) return { missing: 'translate:xml-parse' };
      throw e;
    }
  }
  return parseHtmlDocument(source) ?? { missing: 'translate:no-html-element' };
}

export function translate(path: string, source: string, commit: string, readWpt: ReadWpt = () => null, options: TranslateOptions = {}): Translation {
  const doc = parseWptDocument(path, source);
  if ('missing' in doc) return refuse(doc.missing);
  return translateDocument(path, doc, commit, readWpt, options);
}

export function translateDocument(path: string, doc: DomDocument, commit: string, readWpt: ReadWpt = () => null, options: TranslateOptions = {}): Translation {
  const snapshot = options.calls !== undefined;
  const reftest = options.mode === 'reftest';
  const all: El[] = [];
  const build = (node: DomElement, parent: El | null): El => {
    const attrs = new Map<string, string>(node.attrs);
    const el: El = { ns: node.ns, tag: node.tag, attrs, parent, previous: null, children: [], index: all.length, id: '', removed: false };
    all.push(el);
    let prev: El | null = null;
    for (const c of node.children) {
      if (isElement(c)) {
        const child = build(c, el);
        child.previous = prev;
        prev = child;
        el.children.push(child);
      } else el.children.push({ text: c.text });
    }
    return el;
  };
  if (doc.root.tag !== 'html') return refuse(doc.root.ns === XHTML_NS ? 'translate:no-html-element' : 'translate:foreign-element');
  const root = build(doc.root, null);
  if (all.some((e) => e.ns !== XHTML_NS)) return refuse('translate:foreign-element');

  // Harness nodes.
  const selectorLists: string[] = [...(options.calls ?? [])];
  const styles: string[] = [];
  // <?xml-stylesheet?> sheets come first in the style order, as they precede the root element.
  for (const pi of doc.stylesheetPIs) {
    if (pi.alternate) continue;
    const media = pi.media.trim().toLowerCase();
    if (media !== 'all' && media !== 'screen' && media !== '') return refuse('translate:style-media');
    const target = resolveHref(path, pi.href);
    const text = target === null ? null : readWpt(target);
    if (text === null) return refuse('translate:external-stylesheet');
    if (/url\s*\(/i.test(text)) return refuse('translate:external-stylesheet-url');
    styles.push(`/* <?xml-stylesheet?> ${target as string} */\n${text}`);
  }
  for (const el of all) {
    if (el.tag === 'script') {
      el.removed = true;
      if (snapshot) continue;
      if (reftest) return refuse('translate:script');
      const src = el.attrs.get('src');
      if (src !== undefined) {
        if (!HARNESS_SCRIPT.test(src)) return refuse(`translate:script-src:${src.slice(src.lastIndexOf('/') + 1)}`);
        continue;
      }
      const code = el.children.map((c) => ('text' in c ? c.text : '')).join('');
      const calls = harnessCalls(code);
      if (calls === null) return refuse('translate:script');
      selectorLists.push(...calls);
    } else if (el.tag === 'link') {
      el.removed = true;
      const rel = (el.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const href = el.attrs.get('href') ?? '';
      if (!rel.includes('stylesheet') || AHEM_SHEET.test(href)) continue;
      // A linked WPT stylesheet is inlined at its place in the style order; url() would resolve against another base.
      const media = (el.attrs.get('media') ?? 'all').trim().toLowerCase();
      if (media !== 'all' && media !== 'screen' && media !== '') return refuse('translate:style-media');
      const target = rel.includes('alternate') ? null : resolveHref(path, href);
      const text = target === null ? null : readWpt(target);
      if (text === null) return refuse('translate:external-stylesheet');
      if (/url\s*\(/i.test(text)) return refuse('translate:external-stylesheet-url');
      styles.push(`/* <link rel=stylesheet> ${target as string} */\n${text}`);
    } else if (el.tag === 'meta' || el.tag === 'title') {
      el.removed = true;
    } else if (el.tag === 'style') {
      el.removed = true;
      const media = (el.attrs.get('media') ?? 'all').trim().toLowerCase();
      if (media !== 'all' && media !== 'screen' && media !== '') return refuse('translate:style-media');
      styles.push(el.children.map((c) => ('text' in c ? c.text : '')).join(''));
    } else if (el.parent !== null && el.parent.tag === 'head') {
      return refuse(`translate:head-element:${el.tag}`);
    }
    for (const name of el.attrs.keys()) {
      if (!name.startsWith('on') || snapshot) continue;
      if (reftest || name !== 'onload' || el.tag !== 'body') return refuse('translate:event-attribute');
      const calls = harnessCalls(el.attrs.get(name) as string);
      if (calls === null) return refuse('translate:event-attribute');
      selectorLists.push(...calls);
    }
  }
  if (selectorLists.length === 0 && !reftest) return refuse('translate:no-checklayout');
  const removedAncestor = (el: El): boolean => el.removed || (el.parent !== null && removedAncestor(el.parent));
  const kept = all.filter((e) => !removedAncestor(e));
  const fixtureElements = kept.filter((e) => e.tag !== 'head');

  // Fixture ids: the WPT id when it is a plain unique name, otherwise n<index>.
  const idCount = new Map<string, number>();
  for (const e of all) {
    const id = e.attrs.get('id');
    if (id !== undefined) idCount.set(id, (idCount.get(id) ?? 0) + 1);
  }
  const used = new Set<string>();
  for (const e of kept) {
    const id = e.attrs.get('id');
    const base = e.tag === 'html' || e.tag === 'head' || e.tag === 'body' ? e.tag : id !== undefined && idCount.get(id) === 1 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ? id : `n${e.index}`;
    e.id = used.has(base) ? `n${e.index}` : base;
    if (used.has(e.id)) return refuse('translate:duplicate-node-id');
    used.add(e.id);
  }

  // Checks (check-layout-th.js window.checkLayout): one subtest per matched node, over its parent's own values and its subtree.
  const matchOf = new Map<El, MatchElement>();
  const toMatch = (e: El): MatchElement => {
    const hit = matchOf.get(e);
    if (hit !== undefined) return hit;
    const m: MatchElement = { tag: e.tag, attrs: e.attrs, parent: e.parent === null ? null : toMatch(e.parent), previous: e.previous === null ? null : toMatch(e.previous) };
    matchOf.set(e, m);
    return m;
  };
  const checksOf = (e: El): Check[] | string => {
    const out: Check[] = [];
    for (const name of e.attrs.keys()) {
      if (name.startsWith('data-') && !name.startsWith('data-test') && !VALID_DATA.has(name)) out.push({ node: e.id, element: e.index, attribute: 'data-key', expected: name });
    }
    for (const a of CHECK_ATTRIBUTES) {
      const v = e.attrs.get(dataName(a));
      if (v !== undefined && v !== '') out.push({ node: e.id, element: e.index, attribute: a, expected: v });
    }
    return removedAncestor(e) && out.length > 0 ? 'translate:check-on-harness-node' : out;
  };
  const subtests: Subtest[] = [];
  let testNumber = options.firstTestNumber ?? 0;
  for (const list of selectorLists) {
    const selectors = parseSelectorList(list);
    if (selectors === null) return refuse('translate:checklayout-selector');
    for (const e of all) {
      let m: Match = false;
      for (const s of selectors) {
        const r = matches(toMatch(e), s);
        if (r === true) m = true;
        else if (r === 'unknown' && m === false) m = 'unknown';
      }
      if (m === 'unknown') return refuse('translate:checklayout-selector');
      if (m === false) continue;
      const checks: Check[] = [];
      if (e.parent !== null) {
        const own = checksOf(e.parent);
        if (typeof own === 'string') return refuse(own);
        checks.push(...own);
      }
      const walk = (x: El): string | null => {
        const own = checksOf(x);
        if (typeof own === 'string') return own;
        checks.push(...own);
        for (const c of x.children) {
          if ('text' in c) continue;
          const r = walk(c);
          if (r !== null) return r;
        }
        return null;
      };
      const r = walk(e);
      if (r !== null) return refuse(r);
      const title = e.attrs.get('title');
      subtests.push({ name: `${list} ${++testNumber}${title !== undefined && title !== '' ? `: ${title}` : ''}`, target: e.id, checks });
    }
  }

  // The sheet: provably dead style rules are dropped (check-layout mode only: Chrome confirms them there), #id selectors become
  // id classes, inline styles become class rules after every sheet rule.
  const css = styles.join('\n');
  const items = readSheet(css);
  const faults = options.deadRuleFaults ?? NO_DEAD_RULE_FAULTS;
  let judged: readonly MatchElement[] = all.map(toMatch);
  if (options.deadRuleDocument !== undefined) {
    judged = matchElementsOf(options.deadRuleDocument);
  }
  const dead = new Set<SheetItem>();
  const deadRules: string[] = [];
  for (const it of items) {
    if (it.kind !== 'rule' || reftest) continue;
    const text = stripComments(it.prelude).trim();
    if (deadRule(parseSelectorList(text), judged, faults)) {
      dead.add(it);
      deadRules.push(text);
    }
  }
  const referenced = new Set<string>();
  const guardRules: GuardRule[] = [];
  for (const it of items) {
    if (it.kind !== 'rule' || dead.has(it)) continue;
    const selectors = parseSelectorList(stripComments(it.prelude).trim());
    if (selectors !== null) for (const s of selectors) for (const k of s.compounds) for (const id of k.ids) referenced.add(id.value);
    guardRules.push({ selectors, declarations: readDeclarations(it.block) ?? [] });
  }
  const classes = new Set(kept.flatMap((e) => (e.attrs.get('class') ?? '').split(/\s+/)));
  if ([...classes].some((c) => c.startsWith('wpt-'))) return refuse('translate:generated-class-clash');
  const idClass = new Map<string, string>();
  for (const id of [...referenced].sort()) idClass.set(id, `wpt-id-${idClass.size}`);
  let rewritten = '';
  let at = 0;
  for (const it of items) {
    if (it.kind !== 'rule') continue;
    if (dead.has(it)) {
      // The whole rule goes: its prelude (with any comment before it) through its closing brace.
      rewritten += css.slice(at, it.preludeStart);
      at = Math.min(css.length, it.preludeStart + it.prelude.length + it.block.length + 2);
      continue;
    }
    const stripped = stripComments(it.prelude);
    if (!stripped.includes('#')) continue;
    rewritten += `${css.slice(at, it.preludeStart)}${rewriteIds(stripped, (id) => idClass.get(id) as string)}`;
    at = it.preludeStart + it.prelude.length;
  }
  rewritten += css.slice(at);
  const inline = new Map<MatchElement, readonly Declaration[]>();
  const lifted: string[] = [];
  const extraClass = new Map<El, string[]>();
  for (const e of fixtureElements) {
    const id = e.attrs.get('id');
    const cls: string[] = [];
    if (id !== undefined && idClass.has(id)) cls.push(idClass.get(id) as string);
    const style = e.attrs.get('style');
    if (style !== undefined && style.trim() !== '') {
      if (/[{}]/.test(style) || style.includes('</')) return refuse('translate:inline-style');
      const decls = readDeclarations(style);
      if (decls === null) return refuse('translate:inline-style');
      const name = `wpt-inline-${lifted.length}`;
      lifted.push(`.${name} { ${style.trim()} }`);
      inline.set(toMatch(e), decls);
      cls.push(name);
    }
    extraClass.set(e, cls);
  }
  const guard = (referenced.size > 0 || inline.size > 0) && cascadeChanges(fixtureElements.map(toMatch), guardRules, inline) ? 'translate:specificity-rewrite' : null;
  if (rewritten.includes('</style')) return refuse('translate:style-text');

  // The fixture HTML.
  const header = `/* Translated from web-platform-tests ${path} at commit ${commit}. WPT is 3-clause BSD: see vendor/wpt/LICENSE.md. */`;
  const sheet = `\n${header}\n${rewritten}${lifted.length === 0 ? '' : `\n${lifted.join('\n')}`}\n`;
  const elements = new Map<string, { tag: string; parent: string | null; index: number }>();
  const write = (e: El, parent: string | null): string | null => {
    elements.set(e.id, { tag: e.tag, parent, index: e.index });
    const attrs: string[] = [`data-dragon-id="${escapeAttr(e.id)}"`];
    const cls = [...(e.attrs.get('class') ?? '').split(/\s+/).filter((c) => c !== ''), ...(extraClass.get(e) ?? [])];
    if (cls.length > 0) attrs.push(`class="${escapeAttr(cls.join(' '))}"`);
    for (const [name, value] of e.attrs) {
      if (name === 'id' || name === 'class' || name === 'style' || name === 'title' || name === 'xmlns' || name.startsWith('xmlns:') || name.startsWith('data-') || (name === 'onload' && e.tag === 'body')) continue;
      if (snapshot && name.startsWith('on')) continue;
      // XHTML: xml:lang is the language attribute; lang wins when both are present, as in HTML.
      const out = name === 'xml:lang' ? 'lang' : name;
      if (name === 'xml:lang' && e.attrs.has('lang')) continue;
      if (!/^[a-z][a-z0-9-]*$/.test(out)) return null;
      attrs.push(`${out}="${escapeAttr(value)}"`);
    }
    let body = '';
    for (const c of e.children) {
      if ('text' in c) body += escapeText(c.text);
      else if (!removedAncestor(c)) {
        if (c.tag === 'head') continue;
        const s = write(c, e.id);
        if (s === null) return null;
        body += s;
      }
    }
    if (e.tag === 'html') body = `<head data-dragon-id="head"><style>${sheet}</style></head>${body}`;
    return `<${e.tag} ${attrs.join(' ')}>${body}</${e.tag}>`;
  };
  const html = write(root, null);
  if (html === null) return refuse('translate:attribute-name');
  return {
    kind: 'fixture',
    id: `${fixtureIdOf(path)}${options.idSuffix ?? ''}`,
    html: `<!DOCTYPE html>\n${html}\n`,
    sidecar: { source: path, wpt: commit, viewport: { ...WPT_VIEWPORT }, subtests, ...(deadRules.length === 0 ? {} : { deadRules }) },
    guard,
    elements,
  };
}
