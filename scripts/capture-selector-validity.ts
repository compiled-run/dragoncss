// Captures, in the pinned Chrome 145, which pseudo-element and pseudo-class names parse as selectors, and which attribute names
// compare their values ASCII case-insensitively in attribute selectors. The names are every non-functional pseudo the north-star
// stylesheet (examples/music-player/styles.css) uses plus a fixed corpus. Validity is read twice: CSS.supports('selector(...)')
// and whether a style rule with the selector survives insertRule; the capture refuses to write if the two ever disagree.
// SEL-dir: which :dir() arguments parse and which directionality each matches, the directionality each dir attribute value gives,
// and the unicode-bidi dir gives each supported tag, with a revert probe that shows which origin sets it.
// Output: packages/dragon/src/css/selector-validity.generated.ts. Run with:
//   node --conditions=dragon-internal scripts/capture-selector-validity.ts [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { SUPPORTED_TAGS } from '../packages/dragon/src/analysis/elements.ts';
import { SVG_SHAPE_TAGS } from '../packages/dragon/src/analysis/elements/replaced.ts';

type Node = { readonly type: string; readonly name?: string; readonly children?: unknown };
// css-tree is resolved from packages/dragon, which depends on it.
const { parse, walk } = createRequire(repoPath('packages/dragon/package.json'))('css-tree') as { parse(text: string): Node; walk(ast: Node, visit: (node: Node) => void): void };

const OUTPUT = 'packages/dragon/src/css/selector-validity.generated.ts';

const PSEUDO_ELEMENT_CORPUS = [
  'after', 'backdrop', 'before', 'cue', 'file-selector-button', 'first-letter', 'first-line', 'grammar-error', 'marker', 'placeholder',
  'selection', 'spelling-error', 'target-text',
  '-moz-focus-inner', '-moz-placeholder', '-moz-progress-bar', '-moz-range-progress', '-moz-range-thumb', '-moz-range-track', '-moz-selection',
  '-ms-fill-lower', '-ms-thumb', '-ms-track',
  '-webkit-inner-spin-button', '-webkit-input-placeholder', '-webkit-outer-spin-button', '-webkit-progress-bar', '-webkit-progress-value',
  '-webkit-scrollbar', '-webkit-scrollbar-button', '-webkit-scrollbar-corner', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track',
  '-webkit-scrollbar-track-piece', '-webkit-search-cancel-button', '-webkit-slider-runnable-track', '-webkit-slider-thumb',
];
const PSEUDO_CLASS_CORPUS = [
  'active', 'any-link', 'autofill', 'checked', 'default', 'defined', 'dir', 'disabled', 'empty', 'enabled', 'first-child', 'first-of-type',
  'focus', 'focus-visible', 'focus-within', 'fullscreen', 'hover', 'in-range', 'indeterminate', 'invalid', 'last-child', 'last-of-type',
  'link', 'only-child', 'only-of-type', 'optional', 'out-of-range', 'placeholder-shown', 'read-only', 'read-write', 'required', 'root',
  'scope', 'target', 'valid', 'visited',
  '-moz-focusring', '-moz-ui-invalid', '-ms-input-placeholder', '-webkit-any-link', '-webkit-autofill',
];
/** The text between the parentheses of :dir(), as authored. */
const DIR_ARGUMENT_CORPUS = ['', 'ltr', 'rtl', 'LTR', 'RTL', 'Rtl', ' rtl ', 'auto', 'foo', '"rtl"', 'ltr rtl', 'ltr, rtl'];
/** dir attribute values (HTML §3.2.6.4 is an enumerated attribute, so a value is not trimmed). */
const DIR_VALUE_CORPUS = ['ltr', 'rtl', 'LTR', 'RTL', 'Rtl', ' rtl', 'rtl ', '', 'foo'];
/** The SVG-namespace tags of SUPPORTED_TAGS. */
const SVG_TAGS = ['svg', ...SVG_SHAPE_TAGS];

/** HTML §4.16.2's list (Blink HTMLDocument::IsCaseSensitiveAttribute's case-insensitive set) plus case-sensitive controls. */
const ATTRIBUTE_CORPUS = [
  'accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color', 'compact',
  'declare', 'defer', 'dir', 'direction', 'disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang', 'language', 'link',
  'media', 'method', 'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev', 'rules', 'scope', 'scrolling',
  'selected', 'shape', 'target', 'text', 'type', 'valign', 'valuetype', 'vlink',
  'alt', 'aria-label', 'class', 'data-x', 'href', 'id', 'max', 'min', 'name', 'role', 'src', 'style', 'title', 'ui-x', 'value',
];

/** Every non-functional pseudo-element and pseudo-class name the north-star stylesheet uses. */
function inventory(): { elements: string[]; classes: string[] } {
  const css = readFileSync(repoPath('examples/music-player/styles.css'), 'utf8');
  const elements = new Set<string>();
  const classes = new Set<string>();
  walk(parse(css), (node) => {
    if (node.type === 'PseudoElementSelector' && node.children === null) elements.add(String(node.name).toLowerCase());
    if (node.type === 'PseudoClassSelector' && node.children === null) classes.add(String(node.name).toLowerCase());
  });
  return { elements: [...elements], classes: [...classes] };
}

const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

async function capture(): Promise<string> {
  const inv = inventory();
  const elements = sorted([...PSEUDO_ELEMENT_CORPUS, ...inv.elements]);
  const classes = sorted([...PSEUDO_CLASS_CORPUS, ...inv.classes]);
  const attributes = sorted(ATTRIBUTE_CORPUS);
  const tags = sorted(SUPPORTED_TAGS);
  const browser = await launchChrome();
  try {
    if (browser.version() !== CHROME_VERSION) throw new Error(`Chrome ${browser.version()}`);
    const page = await openPage(browser, '<!DOCTYPE html><html><head><style id="probe"></style></head><body></body></html>', { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' });
    const result = await page.evaluate(({ elements, classes, attributes, tags, svgTags, dirArgs, dirValueCorpus }) => {
      const sheetOf = (): CSSStyleSheet => (document.getElementById('probe') as HTMLStyleElement).sheet as CSSStyleSheet;
      const target = document.createElement('div');
      target.className = 'probe';
      document.body.appendChild(target);
      const probe = (simple: string): { supports: boolean; kept: boolean; listKept: boolean } => {
        const selector = `.a${simple}`;
        const supports = CSS.supports(`selector(${selector})`);
        while (sheetOf().cssRules.length > 0) sheetOf().deleteRule(0);
        let kept = true;
        try {
          sheetOf().insertRule(`${selector} { color: red }`, 0);
        } catch {
          kept = false;
        }
        kept = kept && sheetOf().cssRules.length === 1;
        while (sheetOf().cssRules.length > 0) sheetOf().deleteRule(0);
        // The rule as authored text: a list whose other selector matches the probe element applies only if Chrome keeps the list.
        (document.getElementById('probe') as HTMLStyleElement).textContent = `.probe, .probe${simple} { color: rgb(1, 2, 3) }`;
        const listKept = getComputedStyle(target).color === 'rgb(1, 2, 3)';
        (document.getElementById('probe') as HTMLStyleElement).textContent = '';
        return { supports, kept, listKept };
      };
      const valid = (names: readonly string[], prefix: string): Record<string, { supports: boolean; kept: boolean; listKept: boolean }> =>
        Object.fromEntries(names.map((n) => [n, probe(`${prefix}${n}`)]));
      const insensitive: Record<string, boolean> = {};
      for (const name of attributes) {
        const el = document.createElement('div');
        el.setAttribute(name, 'foo');
        document.body.appendChild(el);
        insensitive[name] = el.matches(`[${name}="FOO"]`);
        if (!el.matches(`[${name}="foo"]`)) throw new Error(`[${name}="foo"] does not match its own value`);
        el.remove();
      }
      const box = (tag: string, dir: string | null, parent: Element): Element => {
        const el = svgTags.includes(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
        if (dir !== null) el.setAttribute('dir', dir);
        parent.appendChild(el);
        return el;
      };
      const directionality = (el: Element): 'ltr' | 'rtl' => {
        const rtl = el.matches(':dir(rtl)');
        if (rtl === el.matches(':dir(ltr)')) throw new Error(`an element with dir=${JSON.stringify(el.getAttribute('dir'))} matches both or neither of :dir(ltr) and :dir(rtl)`);
        return rtl ? 'rtl' : 'ltr';
      };
      const ltrParent = box('div', 'ltr', document.body);
      const rtlParent = box('div', 'rtl', document.body);
      const dirArguments: Record<string, { supports: boolean; kept: boolean; listKept: boolean; matches: 'ltr' | 'rtl' | null }> = {};
      for (const arg of dirArgs) {
        const r = probe(`:dir(${arg})`);
        const ltr = box('div', null, ltrParent);
        const rtl = box('div', null, rtlParent);
        const hits = (el: Element): boolean => (r.kept ? el.matches(`:dir(${arg})`) : false);
        if (hits(ltr) && hits(rtl)) throw new Error(`:dir(${arg}) matches both an ltr and an rtl element`);
        dirArguments[arg] = { ...r, matches: hits(rtl) ? 'rtl' : hits(ltr) ? 'ltr' : null };
        ltr.remove();
        rtl.remove();
      }
      const dirValues: Record<string, { underLtr: 'ltr' | 'rtl'; underRtl: 'ltr' | 'rtl' }> = {};
      for (const value of dirValueCorpus) {
        const a = box('div', value, ltrParent);
        const b = box('div', value, rtlParent);
        dirValues[value] = { underLtr: directionality(a), underRtl: directionality(b) };
        a.remove();
        b.remove();
      }
      const bidi: Record<string, { none: string; ltr: string; rtl: string }> = {};
      const host = box('div', null, document.body);
      for (const tag of tags) {
        const read = (dir: string | null): string => {
          const el = box(tag, dir, host);
          const v = getComputedStyle(el).unicodeBidi;
          el.remove();
          return v;
        };
        bidi[tag] = { none: read(null), ltr: read('ltr'), rtl: read('rtl') };
      }
      const reverted = box('span', 'rtl', host) as HTMLElement;
      reverted.style.setProperty('unicode-bidi', 'revert');
      const revert = getComputedStyle(reverted).unicodeBidi;
      return { elements: valid(elements, '::'), classes: valid(classes, ':'), insensitive, dirArguments, dirValues, bidi, revert };
    }, { elements, classes, attributes, tags, svgTags: SVG_TAGS, dirArgs: DIR_ARGUMENT_CORPUS, dirValueCorpus: DIR_VALUE_CORPUS });
    // insertRule and the authored list agree on whether Chrome keeps the rule; CSS.supports is recorded beside them because Blink's
    // selector() support test also refuses some UA-internal pseudo-elements that a style rule still keeps.
    for (const [kind, table] of [['::', result.elements], [':', result.classes], [':dir', result.dirArguments]] as const) {
      for (const [name, r] of Object.entries(table)) {
        if (r.kept !== r.listKept) throw new Error(`Chrome's selector validity for ${kind}${name} is not observable exactly: insertRule kept ${r.kept}, authored list kept ${r.listKept}`);
      }
    }
    const rows = (t: Record<string, { supports: boolean; kept: boolean }>): string => Object.keys(t).sort().map((k) => { const r = t[k] as { supports: boolean; kept: boolean }; return `  '${k}': { valid: ${String(r.kept)}, supports: ${String(r.supports)} },`; }).join('\n');
    const attrRows = Object.keys(result.insensitive).sort().map((k) => `  '${k}': ${String(result.insensitive[k])},`).join('\n');
    const key = (k: string): string => JSON.stringify(k);
    const dirArgRows = Object.keys(result.dirArguments).sort().map((k) => { const r = result.dirArguments[k] as { kept: boolean; supports: boolean; matches: string | null }; return `  ${key(k)}: { valid: ${String(r.kept)}, supports: ${String(r.supports)}, matches: ${r.matches === null ? 'null' : `'${r.matches}'`} },`; }).join('\n');
    const dirValueRows = Object.keys(result.dirValues).sort().map((k) => { const r = result.dirValues[k] as { underLtr: string; underRtl: string }; return `  ${key(k)}: { underLtr: '${r.underLtr}', underRtl: '${r.underRtl}' },`; }).join('\n');
    const bidiRows = Object.keys(result.bidi).sort().map((k) => { const r = result.bidi[k] as { none: string; ltr: string; rtl: string }; return `  '${k}': { none: '${r.none}', ltr: '${r.ltr}', rtl: '${r.rtl}' },`; }).join('\n');
    return `// Generated by scripts/capture-selector-validity.ts in Chrome ${CHROME_VERSION}; do not edit. valid: Chrome keeps a style rule with the selector
// (insertRule, and an authored list whose other selector then applies); supports: CSS.supports('selector(...)'). The names are the north-star stylesheet's non-functional pseudos plus a fixed corpus; the dir tables cover the supported tags and a fixed corpus.

export const SELECTOR_VALIDITY_CHROME = '${CHROME_VERSION}';

export type SelectorValidity = { readonly valid: boolean; readonly supports: boolean };

/** \`.a::<name>\`: valid false makes Chrome drop the whole rule. */
export const PSEUDO_ELEMENT_VALID: Readonly<Record<string, SelectorValidity>> = {
${rows(result.elements)}
};

/** \`.a:<name>\` (non-functional pseudo-classes). */
export const PSEUDO_CLASS_VALID: Readonly<Record<string, SelectorValidity>> = {
${rows(result.classes)}
};

/** Whether \`[<name>="FOO"]\` matches a div whose attribute is "foo" (no i flag): the value compares ASCII case-insensitively. */
export const OBSERVED_ATTRIBUTE_CASE_INSENSITIVE: Readonly<Record<string, boolean>> = {
${attrRows}
};

export type Directionality = 'ltr' | 'rtl';

/** \`.a:dir(<argument>)\`, keyed by the argument as written; matches: the directionality an element needs to match, or null for none. */
export const DIR_ARGUMENT_VALID: Readonly<Record<string, SelectorValidity & { readonly matches: Directionality | null }>> = {
${dirArgRows}
};

/** \`dir="<value>"\` on a div under a dir=ltr and under a dir=rtl parent: the directionality :dir() then sees. */
export const DIR_ATTRIBUTE_DIRECTIONALITY: Readonly<Record<string, { readonly underLtr: Directionality; readonly underRtl: Directionality }>> = {
${dirValueRows}
};

/** Each supported tag's computed unicode-bidi without dir, with dir=ltr and with dir=rtl. */
export const DIR_ATTRIBUTE_UNICODE_BIDI: Readonly<Record<string, { readonly none: string; readonly ltr: string; readonly rtl: string }>> = {
${bidiRows}
};

/** \`<span dir=rtl style="unicode-bidi: revert">\`: revert rolls back the author origin, presentational hints included, so the span keeps only a UA rule's value. */
export const DIR_UNICODE_BIDI_REVERTED = '${result.revert}';
`;
  } finally {
    await browser.close();
  }
}

const text = await capture();
if (process.argv.includes('--check')) {
  const committed = readFileSync(repoPath(OUTPUT), 'utf8');
  if (committed !== text) {
    console.error(`${OUTPUT} differs from a fresh capture`);
    process.exit(1);
  }
  console.log(`${OUTPUT} matches a fresh capture`);
} else {
  writeFileSync(repoPath(OUTPUT), text);
  console.log(`wrote ${OUTPUT}`);
}
