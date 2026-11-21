// Captures Chrome's computed values for the two top-layer keys Dragon lays out when the host presents the top layer itself
// (docs/markless-native-styles.md "Modal dialogs"): a <dialog> opened with showModal() (:modal, [open]) and that dialog's ::backdrop.
// Per key: every captured longhand's computed value under the medium root, the longhands a UA rule sets (those that differ from
// "unset"), their declared values per direction (a length that scales with the parent font size is written in em, a calculation of
// percentages and lengths as calc() with its em part), the ancestor tags under which a UA rule gives other values, and the values
// Chrome gives outside the milestone longhands (unmodelled). Each key must be reproduced by dragon-unstyled given its declared
// values, in both directions and both colour schemes, or the capture fails. Values are read through the CSSOM (getComputedStyle,
// and the Typed OM for a calculation's terms); Blink's html.css is LGPL, so Dragon stores these captured values, never the sheet.
// The file is keyed by the capture platform and kept apart from the main dataset, whose tables stay byte-identical.
// Run with: pnpm run ua:capture-top-layer [-- --check]
import { readFileSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { hostPlatform } from '../packages/parity/src/platform.ts';
import { LONGHANDS } from '../packages/dragon/src/css/properties.ts';
import { UNCAPTURED_LONGHANDS } from '../packages/dragon/src/ua/uncaptured.ts';
import { computed as capturedTags } from '../packages/dragon/src/ua/chrome-145.darwin-arm64.generated.ts';

const KEYS = ['dialog', 'backdrop'] as const;
type Key = (typeof KEYS)[number];
type Scheme = 'light' | 'dark';
type Dirs = { ltr: Record<string, string>; rtl: Record<string, string> };
type KeyCapture = {
  computed: Record<string, string>;
  longhands: string[];
  declared: Dirs;
  contexts: string[];
  unmodelled: Dirs;
  forced: Dirs;
};

const CAPTURED_LONGHANDS = LONGHANDS.filter((p) => !(UNCAPTURED_LONGHANDS as readonly string[]).includes(p));
/** The ancestor tags of the main capture (every captured tag but the root and the unstyled element). */
const ANCESTORS = Object.keys(capturedTags).filter((t) => t !== 'html' && t !== 'body' && t !== 'dragon-unstyled');
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const hostDoc = (scheme: Scheme): string =>
  `<!DOCTYPE html><html><head><style>${scheme === 'dark' ? 'html{color-scheme:dark}' : ''}</style><style id="probe"></style></head><body><div id="host" style="display:none"></div></body></html>`;

const platform = hostPlatform();
const file = `packages/dragon/src/ua/chrome-145.${platform}.top-layer.generated.ts`;
const check = process.argv.includes('--check');

/** The page half of the capture: one scheme's two keys. Throws on a value it cannot express as a declared value. */
const capturePage = ({ props, ancestors }: { props: string[]; ancestors: string[] }): { keys: Record<string, KeyCapture>; faults: string[] } => {
  const host = document.getElementById('host') as HTMLElement;
  const sheet = (document.getElementById('probe') as HTMLStyleElement).sheet as CSSStyleSheet;
  const clearSheet = (): void => {
    while (sheet.cssRules.length > 0) sheet.deleteRule(0);
  };
  /** A modal dialog inside `chain` (outermost first) under host; returns the dialog. */
  const open = (chain: HTMLElement[]): HTMLDialogElement => {
    host.replaceChildren();
    clearSheet();
    let parent: HTMLElement = host;
    for (const c of chain) {
      parent.appendChild(c);
      parent = c;
    }
    const d = document.createElement('dialog');
    d.setAttribute('data-k', '');
    parent.appendChild(d);
    d.showModal();
    if (!d.matches(':modal')) throw new Error('showModal() did not make the dialog :modal');
    return d;
  };
  const styleOf = (key: string, d: HTMLDialogElement): CSSStyleDeclaration => (key === 'dialog' ? getComputedStyle(d) : getComputedStyle(d, '::backdrop'));
  /** The value of p for the key with p set to `value` by an author rule (inline on the dialog, a sheet rule on the backdrop). */
  const withValue = (key: string, d: HTMLDialogElement, p: string, value: string): string => {
    if (key === 'dialog') {
      d.style.setProperty(p, value);
      const v = getComputedStyle(d).getPropertyValue(p);
      d.style.removeProperty(p);
      return v;
    }
    sheet.insertRule(`dialog[data-k]::backdrop { ${p}: ${value} }`);
    const v = getComputedStyle(d, '::backdrop').getPropertyValue(p);
    sheet.deleteRule(0);
    return v;
  };
  const parentOf = (size: number, dir: string): HTMLElement => {
    const div = document.createElement('div');
    // A parent colour no UA rule gives, so an inherited longhand a UA rule sets to its usual value (color: CanvasText) shows.
    div.setAttribute('style', `font-size:${size}px;direction:${dir};color:rgb(1, 2, 3)`);
    return div;
  };
  /** A calculation's terms from the Typed OM: percent and px parts (null when it is something else). */
  const terms = (d: HTMLDialogElement, p: string): { percent: number; px: number } | null => {
    const v = d.computedStyleMap().get(p);
    const parts = v instanceof CSSMathSum ? Array.from(v.values) : v instanceof CSSUnitValue ? [v] : null;
    if (parts === null) return null;
    let percent = 0;
    let px = 0;
    for (const part of parts) {
      // A subtraction is a sum with a negated term.
      const negated = part instanceof CSSMathNegate;
      const t = negated ? part.value : part;
      if (!(t instanceof CSSUnitValue)) return null;
      const value = negated ? -t.value : t.value;
      if (t.unit === 'percent') percent += value;
      else if (t.unit === 'px') px += value;
      else return null;
    }
    return { percent, px };
  };
  const num = (n: number): string => String(Number(n.toPrecision(10)));
  const keys: Record<string, KeyCapture> = {};
  const faults: string[] = [];
  for (const key of ['dialog', 'backdrop']) {
    const d0 = open([]);
    const cs0 = styleOf(key, d0);
    const computed = Object.fromEntries(props.map((p) => [p, cs0.getPropertyValue(p)]));
    const declared: Dirs = { ltr: {}, rtl: {} };
    for (const dir of ['ltr', 'rtl'] as const) {
      const at = (size: number): { d: HTMLDialogElement; values: Record<string, string>; unset: Record<string, string>; fontSize: number } => {
        const d = open([parentOf(size, dir)]);
        const cs = styleOf(key, d);
        const values = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
        const unset = Object.fromEntries(props.map((p) => [p, withValue(key, d, p, 'unset')]));
        return { d, values, unset, fontSize: Number.parseFloat(cs.getPropertyValue('font-size')) };
      };
      const a = at(100);
      const aTerms = Object.fromEntries(props.map((p) => [p, key === 'dialog' ? terms(a.d, p) : null]));
      const b = at(200);
      for (const p of props) {
        if (a.values[p] === a.unset[p]) continue;
        const va = a.values[p] as string;
        const vb = b.values[p] as string;
        if (va === vb) {
          declared[dir][p] = va;
          continue;
        }
        const ta = aTerms[p];
        const tb = key === 'dialog' ? terms(b.d, p) : null;
        if (ta === null || ta === undefined || tb === null || ta.percent !== tb.percent) throw new Error(`${key} ${p}: ${va} under a 100px parent and ${vb} under 200px is neither absolute nor em-relative`);
        // px = constant + factor * font size (the element's own, which follows the parent's here).
        const factor = (tb.px - ta.px) / (b.fontSize - a.fontSize);
        const constant = ta.px - factor * a.fontSize;
        const sum = [[ta.percent, '%'], [constant, 'px'], [factor, 'em']].filter(([v]) => v !== 0) as [number, string][];
        if (sum.length === 1 && factor !== 0) declared[dir][p] = `${num(factor)}em`;
        else {
          // calc() with each term after the first joined by its sign: calc(100% - 6px - 2em).
          const [first, ...rest] = sum as [[number, string], ...[number, string][]];
          declared[dir][p] = `calc(${num(first[0])}${first[1]}${rest.map(([v, u]) => ` ${v < 0 ? '-' : '+'} ${num(Math.abs(v))}${u}`).join('')})`;
        }
      }
    }
    const longhands = Object.keys(declared.ltr).sort();
    // Contexts: the key under each ancestor tag versus under a div carrying that ancestor's computed values.
    const contexts: string[] = [];
    for (const tag of ancestors) {
      const inTag = open([document.createElement(tag)]);
      const own = Object.fromEntries(props.map((p) => [p, styleOf(key, inTag).getPropertyValue(p)]));
      const ancestor = inTag.parentElement as HTMLElement;
      const ancestorStyle = getComputedStyle(ancestor);
      const standIn = Array.from(ancestorStyle).map((p) => `${p}:${ancestorStyle.getPropertyValue(p)}`).join(';');
      const div = document.createElement('div');
      div.setAttribute('style', standIn);
      const inDiv = open([div]);
      const there = Object.fromEntries(props.map((p) => [p, styleOf(key, inDiv).getPropertyValue(p)]));
      if (props.some((p) => own[p] !== there[p])) contexts.push(tag);
    }
    // Unmodelled: every property of Chrome's full list, outside the captured longhands, whose value differs from dragon-unstyled
    // given the declared values; a captured longhand that still differs is a fault (the declared values do not reproduce Chrome).
    const known = new Set(props);
    const unmodelled: Dirs = { ltr: {}, rtl: {} };
    // Forced: a captured longhand whose value neither "unset" nor "initial" changes (a UA !important rule: :modal's overflow).
    const forced: Dirs = { ltr: {}, rtl: {} };
    for (const dir of ['ltr', 'rtl'] as const) {
      const d = open([parentOf(16, dir)]);
      const bare = document.createElement('dragon-unstyled');
      for (const [p, v] of Object.entries(declared[dir])) bare.style.setProperty(p, v);
      (d.parentElement as HTMLElement).appendChild(bare);
      const cs = styleOf(key, d);
      const ref = getComputedStyle(bare);
      for (const p of [...new Set([...Array.from(cs), ...Array.from(ref)])].sort()) {
        if (p.startsWith('--')) continue;
        const v = cs.getPropertyValue(p);
        if (v === ref.getPropertyValue(p)) continue;
        if (known.has(p)) {
          // A backdrop inherits from its dialog, the reference from the parent: an inherited longhand the backdrop does not set is the dialog's.
          if (key === 'backdrop' && withValue(key, d, p, 'unset') === v && !(p in declared[dir])) continue;
          if (withValue(key, d, p, 'unset') === v && withValue(key, d, p, 'initial') === v) {
            forced[dir][p] = v;
            continue;
          }
          faults.push(`${key} ${dir} ${p}: Chrome ${v}, dragon-unstyled given the declared values ${ref.getPropertyValue(p)}`);
        } else unmodelled[dir][p] = v;
      }
    }
    keys[key] = { computed, longhands, declared, contexts, unmodelled, forced };
  }
  return { keys, faults };
};

const field = (row: Record<string, string>): string => `{ ${Object.keys(row).sort().map((p) => `${JSON.stringify(p)}: ${JSON.stringify(row[p])}`).join(', ')} }`;

function render(captures: Record<Scheme, Record<Key, KeyCapture>>): string {
  const lines: string[] = [];
  lines.push(`// Generated by scripts/capture-top-layer-ua.ts from Chrome ${CHROME_VERSION} computed values. Do not edit; run pnpm run ua:capture-top-layer.`);
  lines.push('');
  lines.push(`export const platform = ${JSON.stringify(platform)};`);
  lines.push('');
  lines.push('/** The top-layer keys: a <dialog> shown with showModal() and its ::backdrop. */');
  lines.push(`export type TopLayerKey = ${KEYS.map((k) => JSON.stringify(k)).join(' | ')};`);
  lines.push('');
  lines.push('type Dirs = { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } };');
  lines.push('export type TopLayerRows = { readonly computed: { readonly [property: string]: string }; readonly longhands: readonly string[]; readonly declared: Dirs; readonly contexts: readonly string[]; readonly unmodelled: Dirs; readonly forced: Dirs };');
  lines.push('');
  for (const scheme of ['light', 'dark'] as const) {
    lines.push(`/** Under ${scheme === 'dark' ? 'html{color-scheme:dark}' : 'the light colour scheme'}. */`);
    lines.push(`export const ${scheme}: { readonly [K in TopLayerKey]: TopLayerRows } = {`);
    for (const k of KEYS) {
      const c = captures[scheme][k];
      lines.push(`  ${JSON.stringify(k)}: {`);
      lines.push('    computed: {');
      for (const p of Object.keys(c.computed).sort()) lines.push(`      ${JSON.stringify(p)}: ${JSON.stringify(c.computed[p])},`);
      lines.push('    },');
      lines.push(`    longhands: ${JSON.stringify(c.longhands)},`);
      lines.push(`    declared: { ltr: ${field(c.declared.ltr)}, rtl: ${field(c.declared.rtl)} },`);
      lines.push(`    contexts: ${JSON.stringify(c.contexts)},`);
      lines.push(`    unmodelled: { ltr: ${field(c.unmodelled.ltr)}, rtl: ${field(c.unmodelled.rtl)} },`);
      lines.push(`    forced: { ltr: ${field(c.forced.ltr)}, rtl: ${field(c.forced.rtl)} },`);
      lines.push('  },');
    }
    lines.push('};');
    lines.push('');
  }
  return lines.join('\n');
}

const browser = await launchChrome(1);
try {
  const captures = {} as Record<Scheme, Record<Key, KeyCapture>>;
  const faults: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    const page = await openPage(browser, hostDoc(scheme), ENV);
    const r = await page.evaluate(capturePage, { props: [...CAPTURED_LONGHANDS], ancestors: ANCESTORS });
    await page.context().close();
    captures[scheme] = r.keys as Record<Key, KeyCapture>;
    faults.push(...r.faults.map((f) => `${scheme}: ${f}`));
  }
  if (faults.length > 0) {
    console.error(`the declared values do not reproduce Chrome:\n${faults.join('\n')}`);
    process.exit(1);
  }
  const text = render(captures);
  if (check) {
    const committed = readFileSync(repoPath(file), 'utf8');
    if (committed !== text) {
      console.error(`${file} differs from a fresh capture`);
      process.exit(1);
    }
    console.log(`${file} matches a fresh capture`);
  } else {
    writeFileSync(repoPath(file), text);
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
}
