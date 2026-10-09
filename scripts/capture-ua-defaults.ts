// Captures Chrome's computed values for the supported tags and an element with no UA rules, for every milestone longhand,
// and which longhands a UA rule sets per tag: those whose value differs from the same element with "<longhand>: initial".
// It also derives each tag's UA declared values per direction (a length that scales with the font size is written in em), the
// ancestor tags under which Chrome's UA sheet gives a tag other values, and the UA font-weight and font-style no longhand models.
// The element keys (button, input, a, img, span, ...), the replaced keys (iframe, img with a data: src) and the phrasing keys
// (br, strong, b, em, i, code, small, sub, sup, label; INL-U) are captured the same way into tables of their own, and the phrasing
// keys' computed font-size under Ahem and monospace parents goes into elementKeyFontSizes; every element gets
// its UA-set properties no longhand models (userAgentUnmodelled) and the system colors, and all of it is captured again under
// html{color-scheme:dark} into the dark dataset. Each key must be reproduced by an unstyled element given its captured values.
// Blink's html.css is LGPL, so Dragon stores these captured values as data instead of copying the sheet.
// The dataset is keyed by the capture platform (process.platform-process.arch): it writes only this platform's files,
// packages/dragon/src/ua/chrome-145.<platform>[.dark].generated.ts, and refuses a platform argument other than this one.
// Run with: pnpm run ua:capture [platform] [--check [--plant drop-declared|drop-unmodelled|dark-as-light|drop-font-size-small]] [--compare <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { hostPlatform } from '../packages/parity/src/platform.ts';
import { LONGHANDS } from '../packages/dragon/src/css/properties.ts';
import { UNCAPTURED_LONGHANDS } from '../packages/dragon/src/ua/uncaptured.ts';

const TAGS = [
  'html', 'body', 'div',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'address', 'hr', 'dl', 'dt', 'dd',
  'dragon-unstyled',
] as const;
/** The tags whose declared values and contexts are derived: every captured tag but the root and the unstyled element. */
const ELEMENT_TAGS = TAGS.filter((t) => t !== 'html' && t !== 'dragon-unstyled');
/** Element keys outside the element table, each an element with the attributes its UA rules key on. */
const KEY_SPECS = {
  button: { tag: 'button', attrs: { type: 'button' } },
  input: { tag: 'input', attrs: {} },
  'input[type=range]': { tag: 'input', attrs: { type: 'range' } },
  a: { tag: 'a', attrs: {} },
  // A fresh profile has no history, so the link is unvisited (:link).
  'a[href]': { tag: 'a', attrs: { href: 'https://dragon.invalid/unvisited' } },
  img: { tag: 'img', attrs: {} },
  span: { tag: 'span', attrs: {} },
} as const satisfies Record<string, { tag: string; attrs: Record<string, string> }>;
type ElementKey = keyof typeof KEY_SPECS;
const ELEMENT_KEYS = Object.keys(KEY_SPECS) as ElementKey[];
/** A 1x1 opaque PNG, so the img key is a loaded image with a data: src (REPL-0). */
const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/** Replaced-element keys (REPL-0), captured like the element keys into tables of their own so the existing tables stay byte-identical. */
const REPLACED_KEY_SPECS = {
  iframe: { tag: 'iframe', attrs: {} },
  'img[src]': { tag: 'img', attrs: { src: PIXEL_PNG } },
} as const satisfies Record<string, { tag: string; attrs: Record<string, string> }>;
type ReplacedKey = keyof typeof REPLACED_KEY_SPECS;
const REPLACED_KEYS = Object.keys(REPLACED_KEY_SPECS) as ReplacedKey[];
/** Phrasing-element keys (INL-U), captured like the element keys into tables of their own so the existing tables stay byte-identical. */
const PHRASING_KEY_SPECS = {
  br: { tag: 'br', attrs: {} },
  strong: { tag: 'strong', attrs: {} },
  b: { tag: 'b', attrs: {} },
  em: { tag: 'em', attrs: {} },
  i: { tag: 'i', attrs: {} },
  code: { tag: 'code', attrs: {} },
  small: { tag: 'small', attrs: {} },
  sub: { tag: 'sub', attrs: {} },
  sup: { tag: 'sup', attrs: {} },
  label: { tag: 'label', attrs: {} },
} as const satisfies Record<string, { tag: string; attrs: Record<string, string> }>;
type PhrasingKey = keyof typeof PHRASING_KEY_SPECS;
const PHRASING_KEYS = Object.keys(PHRASING_KEY_SPECS) as PhrasingKey[];
/** Parents of elementKeyFontSizes: each family at each size; "medium" is the keyword, under which code's monospace size differs. */
const FONT_SIZE_FAMILIES = ['Ahem', 'monospace'] as const;
// 2em and larger are relative to the medium root, so Chrome keeps them keyword-relative (code under them scales with the monospace medium size).
const FONT_SIZE_PARENTS = ['10px', '16px', '17.5px', '23.3px', 'medium', '2em', 'larger'] as const;
/** Every key captured outside the element table; replaced elements are never an ancestor context. */
const ALL_KEYS: readonly string[] = [...ELEMENT_KEYS, ...REPLACED_KEYS, ...PHRASING_KEYS];
/** Void elements have no children, so they are never an ancestor context. */
const ANCESTOR_KEYS = [...ELEMENT_KEYS.filter((k) => !['input', 'img'].includes(KEY_SPECS[k].tag)), ...PHRASING_KEYS.filter((k) => k !== 'br')];
type Spec = { readonly tag: string; readonly attrs: Readonly<Record<string, string>> };
const SPECS: Record<string, Spec> = { ...Object.fromEntries(TAGS.map((t) => [t, { tag: t, attrs: {} }])), ...KEY_SPECS, ...REPLACED_KEY_SPECS, ...PHRASING_KEY_SPECS };
/** Inherited font properties no milestone longhand models; a UA value for them changes how text is drawn. */
const TEXT_FONT_PROPERTIES = ['font-weight', 'font-style'] as const;
/** Every longhand but those only the dataset holds (uncaptured.ts: the text-font rows' and font-synthesis's). */
const CAPTURED_LONGHANDS = LONGHANDS.filter((p) => !(UNCAPTURED_LONGHANDS as readonly string[]).includes(p));
const BORDER_KEYWORDS = ['thin', 'medium', 'thick'] as const;
const SYSTEM_COLORS = [
  'Canvas', 'CanvasText', 'LinkText', 'VisitedText', 'ActiveText', 'ButtonFace', 'ButtonText', 'ButtonBorder', 'Field', 'FieldText',
  'Highlight', 'HighlightText', 'SelectedItem', 'SelectedItemText', 'Mark', 'MarkText', 'GrayText', 'AccentColor', 'AccentColorText',
] as const;
type Browser = Awaited<ReturnType<typeof launchChrome>>;
const PLANTS = ['drop-declared', 'drop-unmodelled', 'dark-as-light', 'drop-font-size-small'] as const;
type Plant = (typeof PLANTS)[number];
type Scheme = 'light' | 'dark';
type Dirs = Record<string, Record<string, string>>;

const schemeStyle = (scheme: Scheme): string => (scheme === 'dark' ? 'html{color-scheme:dark}' : '');
// Width, height, margins and padding resolve to used values on rendered elements (CSSOM getComputedStyle),
// so every element except html's own display is read from a document whose root is display:none.
const hiddenDoc = (scheme: Scheme): string => `<!DOCTYPE html><html><head><style>html{display:none}${schemeStyle(scheme)}</style></head><body>${TAGS.filter((t) => t !== 'html' && t !== 'body' && t !== 'dragon-unstyled').map((t) => `<${t}></${t}>`).join('')}<dragon-unstyled></dragon-unstyled>${BORDER_KEYWORDS.map((k) => `<dragon-unstyled data-border="${k}" style="border-style:solid;border-width:${k}"></dragon-unstyled>`).join('')}</body></html>`;
const renderedDoc = (scheme: Scheme): string => `<!DOCTYPE html><html><head>${scheme === 'dark' ? `<style>${schemeStyle(scheme)}</style>` : ''}</head><body></body></html>`;
const hostDoc = (scheme: Scheme): string => `<!DOCTYPE html><html><head>${scheme === 'dark' ? `<style>${schemeStyle(scheme)}</style>` : ''}</head><body><div id="host" style="display:none"></div></body></html>`;

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`);
  return v;
};
const optionValues = new Set(['--plant', '--compare'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const positional = args.filter((a, i) => !a.startsWith('--') && !optionValues.has(i));
const platform = hostPlatform();
const requested = positional[0];
if (requested !== undefined && requested !== platform) {
  console.error(`ua:capture refuses to write the ${requested} dataset on ${platform}: a dataset is captured only on its own platform`);
  process.exit(1);
}
const check = flag('--check');
const compareFile = option('--compare');
const plantArg = option('--plant');
if (plantArg !== undefined && !(PLANTS as readonly string[]).includes(plantArg)) throw new Error(`--plant ${plantArg}: expected one of ${PLANTS.join(', ')}`);
const plant = plantArg as Plant | undefined;
if (plant !== undefined && !check) throw new Error('--plant runs only with --check; a planted capture is never written');

const lightFile = `packages/dragon/src/ua/chrome-145.${platform}.generated.ts`;
const darkFile = `packages/dragon/src/ua/chrome-145.${platform}.dark.generated.ts`;

if (compareFile !== undefined) {
  process.exit(await compare(resolve(compareFile), repoPath(lightFile)));
}

// The UA capture reads Chrome's own root font, so the harness adds no environment font.
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;

type Capture = {
  values: Record<string, Record<string, string>>;
  initial: Record<string, Record<string, string>>;
  borderKeywords: Record<string, string>;
  declared: Record<string, Dirs>;
  minimumLogicalFontSize: number;
  contexts: Record<string, string[]>;
  textFonts: Record<string, Record<string, string>>;
  unmodelled: Record<string, Dirs>;
  forced: Record<string, Dirs>;
  systemColors: Record<string, string | null>;
  /** Phrasing key -> family -> parent font-size -> the key's computed font-size. */
  fontSizes: Record<string, Record<string, Record<string, string>>>;
};

async function capture(browser: Browser, scheme: Scheme): Promise<Capture> {
  const hidden = await openPage(browser, hiddenDoc(scheme), ENV);
  const { out: values, initial } = await hidden.evaluate(
    ({ tags, keys, specs, props }) => {
      const out: Record<string, Record<string, string>> = {};
      const initial: Record<string, Record<string, string>> = {};
      for (const key of keys) {
        const s = specs[key] as { tag: string; attrs: Record<string, string> };
        const e = document.createElement(s.tag);
        e.setAttribute('data-key', key);
        for (const [k, v] of Object.entries(s.attrs)) e.setAttribute(k, v);
        document.body.appendChild(e);
      }
      const read = (el: HTMLElement, name: string): void => {
        const cs = getComputedStyle(el);
        out[name] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
        initial[name] = Object.fromEntries(props.map((p) => {
          el.style.setProperty(p, 'initial');
          const v = getComputedStyle(el).getPropertyValue(p);
          el.style.removeProperty(p);
          return [p, v];
        }));
      };
      for (const tag of tags) read(document.querySelector(tag === 'dragon-unstyled' ? 'dragon-unstyled:not([data-border])' : tag) as HTMLElement, tag);
      for (const key of keys) read(document.querySelector(`[data-key="${key}"]`) as HTMLElement, key);
      return { out, initial };
    },
    { tags: [...TAGS], keys: ALL_KEYS, specs: SPECS, props: [...CAPTURED_LONGHANDS] },
  );
  const borderKeywords = await hidden.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('[data-border]')).map((e) => [e.getAttribute('data-border') as string, getComputedStyle(e).borderTopWidth]),
    ),
  );
  const rendered = await openPage(browser, renderedDoc(scheme), ENV);
  const htmlDisplay = await rendered.evaluate(() => {
    const el = document.documentElement;
    const own = getComputedStyle(el).display;
    el.style.setProperty('display', 'initial');
    const init = getComputedStyle(el).display;
    el.style.removeProperty('display');
    return { own, init };
  });
  (values['html'] as Record<string, string>)['display'] = htmlDisplay.own;
  (initial['html'] as Record<string, string>)['display'] = htmlDisplay.init;

  // Declared values: each tag under a parent of font-size 100px and 200px, in each direction; a UA rule sets a longhand whose value
  // differs from the same element under "<longhand>: unset" (the parent is not the root). A px value that doubles with the
  // font size is em-relative (font-size to the parent's, every other length to the element's own); an unchanged one is absolute.
  const host = await openPage(browser, hostDoc(scheme), ENV);
  const declared = await host.evaluate(
    ({ tags, specs, props }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      const make = (key: string): HTMLElement => {
        const s = specs[key] as { tag: string; attrs: Record<string, string> };
        const e = document.createElement(s.tag);
        for (const [k, v] of Object.entries(s.attrs)) e.setAttribute(k, v);
        return e;
      };
      const px = (v: string): number | null => (/^-?[0-9.]+(e-?[0-9]+)?px$/.test(v) ? Number.parseFloat(v) : null);
      const out: Record<string, Record<string, Record<string, string>>> = {};
      for (const tag of tags) {
        out[tag] = {};
        for (const dir of ['ltr', 'rtl']) {
          const read = (size: number): { el: HTMLElement; values: Record<string, string>; initial: Record<string, string> } => {
            hostEl.replaceChildren();
            const parent = document.createElement('div');
            parent.setAttribute('style', `font-size:${size}px;direction:${dir}`);
            const el = make(tag);
            parent.appendChild(el);
            hostEl.appendChild(parent);
            const values = Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)]));
            const initial = Object.fromEntries(props.map((p) => {
              el.style.setProperty(p, 'unset');
              const v = getComputedStyle(el).getPropertyValue(p);
              el.style.removeProperty(p);
              return [p, v];
            }));
            return { el, values, initial };
          };
          // The font-size an unstyled element computes to under the same parent with an authored font-size value.
          const sized = (size: number, value: string): string => {
            hostEl.replaceChildren();
            const parent = document.createElement('div');
            parent.setAttribute('style', `font-size:${size}px;direction:${dir}`);
            const probe = document.createElement('dragon-unstyled');
            probe.style.setProperty('font-size', value);
            parent.appendChild(probe);
            hostEl.appendChild(parent);
            return getComputedStyle(probe).fontSize;
          };
          const a = read(100);
          const b = read(200);
          const row: Record<string, string> = {};
          for (const p of props) {
            if (a.values[p] === a.initial[p]) continue;
            const va = a.values[p] as string;
            const vb = b.values[p] as string;
            const na = px(va);
            const nb = px(vb);
            if (va === vb) row[p] = va;
            else if (na !== null && nb !== null && na !== 0) {
              const base = p === 'font-size' ? 100 : (px(a.values['font-size'] as string) as number);
              const baseB = p === 'font-size' ? 200 : (px(b.values['font-size'] as string) as number);
              const factor = Number((na / base).toPrecision(10));
              if (Math.abs(nb / baseB - factor) <= 1e-9) row[p] = `${factor}em`;
              else {
                // A relative font-size keyword (smaller, larger: INL-U's small, sub and sup) is not an exact em factor once
                // serialized; it is recorded as the keyword when the keyword alone gives Chrome's value at both parent sizes.
                const keyword = p === 'font-size' ? ['smaller', 'larger'].find((kw) => sized(100, kw) === va && sized(200, kw) === vb) : undefined;
                if (keyword === undefined) throw new Error(`${tag} ${p}: ${va} and ${vb} do not scale with the font size`);
                row[p] = keyword;
              }
            } else throw new Error(`${tag} ${p}: ${va} at 100px and ${vb} at 200px is neither absolute nor em-relative`);
          }
          (out[tag] as Record<string, Record<string, string>>)[dir] = row;
        }
      }
      return out;
    },
    { tags: [...ELEMENT_TAGS, ...ALL_KEYS], specs: SPECS, props: [...CAPTURED_LONGHANDS] },
  );
  // Chrome's minimum logical font size: an em font size under the keyword-sized root is clamped up to it; an authored px size is not.
  const { minimumLogicalFontSize, authoredPx } = await host.evaluate(() => {
    const hostEl = document.getElementById('host') as HTMLElement;
    hostEl.replaceChildren();
    const relative = document.createElement('div');
    relative.style.setProperty('font-size', '0.01em');
    const absolute = document.createElement('div');
    absolute.style.setProperty('font-size', '1px');
    hostEl.append(relative, absolute);
    return { minimumLogicalFontSize: Number.parseFloat(getComputedStyle(relative).fontSize), authoredPx: getComputedStyle(absolute).fontSize };
  });
  if (authoredPx !== '1px') throw new Error(`an authored font-size: 1px computed to ${authoredPx}`);

  // Contexts: a tag inside ancestor tags (one and two levels) versus inside a div carrying the parent's computed style. Any
  // milestone longhand that differs comes from a UA rule keyed on an ancestor, which the declared values above do not model.
  const contexts = await host.evaluate(
    ({ tags, ancestors, specs, props, minimum, declared }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      const make = (key: string): HTMLElement => {
        const s = specs[key] as { tag: string; attrs: Record<string, string> };
        const e = document.createElement(s.tag);
        for (const [k, v] of Object.entries(s.attrs)) e.setAttribute(k, v);
        return e;
      };
      const out: Record<string, string[]> = {};
      const standIn = (of: HTMLElement): string => {
        const cs = getComputedStyle(of);
        return Array.from(cs).map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
      };
      const differs = (chain: string[], tag: string): boolean => {
        hostEl.replaceChildren();
        let parent: HTMLElement = hostEl;
        for (const a of chain) {
          const next = make(a);
          parent.appendChild(next);
          parent = next;
        }
        const el = make(tag);
        parent.appendChild(el);
        const inContext = Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)]));
        const style = standIn(parent);
        const holder = document.createElement('div');
        holder.setAttribute('style', style);
        const bare = make(tag);
        holder.appendChild(bare);
        hostEl.appendChild(holder);
        const outside = Object.fromEntries(props.map((p) => [p, getComputedStyle(bare).getPropertyValue(p)]));
        // The stand-in reads the parent's serialized values, so a px value may differ in its last serialized digit.
        const same = (x: string, y: string): boolean => {
          if (x === y) return true;
          const m = /^(-?[0-9.]+)px$/.exec(x);
          const n = /^(-?[0-9.]+)px$/.exec(y);
          return m !== null && n !== null && Math.abs(Number(m[1]) - Number(n[1])) <= 1e-4 * Math.max(1, Math.abs(Number(m[1])));
        };
        // Chrome's minimum logical font size clamps an em size under a keyword-sized root; the stand-in's px size is not clamped.
        // Dragon refuses a clamped UA size (minimumLogicalFontSize), so a clamp is not a context.
        const px = (v: string): number => Number.parseFloat(v);
        if (inContext['font-size'] === `${minimum}px` && px(outside['font-size'] as string) < minimum) return false;
        const differing = props.filter((p) => !same(inContext[p] as string, outside[p] as string));
        if (differing.length === 0) return false;
        if (differing.some((p) => p !== 'font-size')) return true;
        // Only font-size differs: the stand-in's px size is not keyword-relative, while Chrome keeps a size relative to the medium
        // keyword (em, %, smaller, larger) keyword-relative, so a generic family change (code's monospace) rescales it. A chain
        // of unstyled elements given each ancestor's declared values keeps that; if it reproduces the value, no UA rule keys on
        // the ancestor and it is not a context (elementKeyFontSizes records the keyword-relative sizes).
        hostEl.replaceChildren();
        let replicaParent: HTMLElement = hostEl;
        for (const a of chain) {
          const next = document.createElement('dragon-unstyled');
          for (const [p, v] of Object.entries(((declared[a] as Record<string, Record<string, string>>)['ltr']) as Record<string, string>)) next.style.setProperty(p, v);
          replicaParent.appendChild(next);
          replicaParent = next;
        }
        const replicated = make(tag);
        replicaParent.appendChild(replicated);
        return getComputedStyle(replicated).fontSize !== inContext['font-size'];
      };
      for (const tag of tags) {
        const found = new Set<string>();
        for (const a of ancestors) {
          if (a === 'body') continue;
          if (differs([a], tag)) found.add(a);
          for (const b of ancestors) {
            // a alone gives the model's values here, so the outer b (with a between) is the ancestor a UA rule keys on.
            if (b === 'body' || found.has(a) || found.has(b)) continue;
            if (differs([b, a], tag)) found.add(b);
          }
        }
        out[tag] = [...found].sort();
      }
      return out;
    },
    { tags: [...ELEMENT_TAGS, ...ALL_KEYS], ancestors: [...ELEMENT_TAGS, ...ANCESTOR_KEYS], specs: SPECS, props: [...CAPTURED_LONGHANDS], minimum: minimumLogicalFontSize, declared },
  );
  const textFonts = await host.evaluate(
    ({ tags, specs, props }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      return Object.fromEntries(tags.map((tag) => {
        hostEl.replaceChildren();
        const s = specs[tag] as { tag: string; attrs: Record<string, string> };
        const el = document.createElement(s.tag);
        for (const [k, v] of Object.entries(s.attrs)) el.setAttribute(k, v);
        hostEl.appendChild(el);
        const row: Record<string, string> = {};
        for (const p of props) {
          const own = getComputedStyle(el).getPropertyValue(p);
          el.style.setProperty(p, 'initial');
          const init = getComputedStyle(el).getPropertyValue(p);
          el.style.removeProperty(p);
          if (own !== init) row[p] = own;
        }
        return [tag, row];
      }));
    },
    { tags: [...ELEMENT_TAGS, ...ALL_KEYS], specs: SPECS, props: [...TEXT_FONT_PROPERTIES] },
  );
  // Unmodelled: every property of Chrome's full computed list whose value differs from dragon-unstyled under the same parent
  // given the element's declared and text-font values, other than the milestone longhands and their logical aliases. A milestone
  // longhand that still differs is forced: "unset" and "initial" do not change it (a UA !important rule, or Chrome's adjustment of a form control).
  const { unmodelled, forced } = await host.evaluate(
    ({ tags, specs, longhands, declared, textFonts }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      const known = new Set<string>(longhands);
      const physical = (p: string): string =>
        p.replace(/^inset-(block|inline)-(start|end)$/, '$1-$2').replace(/-?block-start/, '-top').replace(/-?block-end/, '-bottom')
          .replace(/-?inline-start/, '-left').replace(/-?inline-end/, '-right').replace(/block-size/, 'height').replace(/inline-size/, 'width')
          .replace(/^overflow-block$/, 'overflow-y').replace(/^overflow-inline$/, 'overflow-x').replace(/^-/, '');
      const unmodelled: Record<string, Record<string, Record<string, string>>> = {};
      const forced: Record<string, Record<string, Record<string, string>>> = {};
      for (const tag of tags) {
        unmodelled[tag] = {};
        forced[tag] = {};
        for (const dir of ['ltr', 'rtl']) {
          hostEl.replaceChildren();
          const parent = document.createElement('div');
          parent.setAttribute('style', `direction:${dir}`);
          const s = specs[tag] as { tag: string; attrs: Record<string, string> };
          const el = document.createElement(s.tag);
          for (const [k, v] of Object.entries(s.attrs)) el.setAttribute(k, v);
          const bare = document.createElement('dragon-unstyled');
          const given = { ...(declared[tag] as Record<string, Record<string, string>>)[dir], ...textFonts[tag] };
          for (const [p, v] of Object.entries(given)) bare.style.setProperty(p, v as string);
          parent.append(el, bare);
          hostEl.appendChild(parent);
          const cs = getComputedStyle(el);
          const ref = getComputedStyle(bare);
          const row: Record<string, string> = {};
          const force: Record<string, string> = {};
          for (const p of [...new Set([...Array.from(cs), ...Array.from(ref)])].sort()) {
            if (p.startsWith('--')) continue;
            const v = cs.getPropertyValue(p);
            if (v === ref.getPropertyValue(p)) continue;
            if (known.has(p)) force[p] = v;
            else if (!known.has(physical(p))) row[p] = v;
          }
          (unmodelled[tag] as Record<string, Record<string, string>>)[dir] = row;
          (forced[tag] as Record<string, Record<string, string>>)[dir] = force;
        }
      }
      return { unmodelled, forced };
    },
    { tags: [...ELEMENT_TAGS, ...ALL_KEYS], specs: SPECS, longhands: [...CAPTURED_LONGHANDS], declared, textFonts },
  );
  const systemColors = await host.evaluate((names) => {
    const hostEl = document.getElementById('host') as HTMLElement;
    return Object.fromEntries(names.map((n) => {
      if (!CSS.supports('color', n)) return [n, null];
      hostEl.replaceChildren();
      const el = document.createElement('div');
      el.style.setProperty('color', n);
      hostEl.appendChild(el);
      return [n, getComputedStyle(el).color];
    }));
  }, [...SYSTEM_COLORS]);
  // Font sizes (INL-U): each phrasing key's computed font-size under a parent of each family and size; smaller, larger and
  // code's monospace size depend on the parent's family and on whether its size is the medium keyword.
  const fontSizes = await host.evaluate(
    ({ keys, specs, families, sizes }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      return Object.fromEntries(keys.map((key) => {
        const s = specs[key] as { tag: string; attrs: Record<string, string> };
        return [key, Object.fromEntries(families.map((family) => [family, Object.fromEntries(sizes.map((size) => {
          hostEl.replaceChildren();
          const parent = document.createElement('div');
          parent.setAttribute('style', `font-family:${family};font-size:${size}`);
          const el = document.createElement(s.tag);
          for (const [k, v] of Object.entries(s.attrs)) el.setAttribute(k, v);
          parent.appendChild(el);
          hostEl.appendChild(parent);
          return [size, getComputedStyle(el).fontSize];
        }))]))];
      }));
    },
    { keys: [...PHRASING_KEYS], specs: SPECS, families: [...FONT_SIZE_FAMILIES], sizes: [...FONT_SIZE_PARENTS] },
  );
  // The declared ltr values at the 16px root must reproduce the captured table exactly.
  for (const tag of [...ELEMENT_TAGS, ...ALL_KEYS]) {
    const ltr = (declared[tag] as Dirs)['ltr'] as Record<string, string>;
    const own = values[tag] as Record<string, string>;
    const init = initial[tag] as Record<string, string>;
    const set = [...CAPTURED_LONGHANDS].sort().filter((p) => own[p] !== init[p]);
    if (JSON.stringify(Object.keys(ltr).sort()) !== JSON.stringify(set)) throw new Error(`${scheme} ${tag}: declared longhands ${Object.keys(ltr).join(',')} differ from the captured ${set.join(',')}`);
  }
  await hidden.context().close();
  await rendered.context().close();
  await host.context().close();
  return { values, initial, borderKeywords, declared, minimumLogicalFontSize, contexts, textFonts, unmodelled, forced, systemColors, fontSizes };
}

/** Each key, in each direction, reproduced by dragon-unstyled given its declared, text-font, unmodelled and forced values; returns the faults. */
async function selfConsistency(browser: Browser, scheme: Scheme, c: Capture): Promise<string[]> {
  const page = await openPage(browser, hostDoc(scheme), ENV);
  const faults = await page.evaluate(
    ({ tags, specs, declared, textFonts, unmodelled, forced, scheme }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      const out: string[] = [];
      for (const tag of tags) {
        for (const dir of ['ltr', 'rtl']) {
          hostEl.replaceChildren();
          const under = (child: HTMLElement): HTMLElement => {
            const parent = document.createElement('div');
            parent.setAttribute('style', `direction:${dir}`);
            parent.appendChild(child);
            hostEl.appendChild(parent);
            return child;
          };
          const s = specs[tag] as { tag: string; attrs: Record<string, string> };
          const el = document.createElement(s.tag);
          for (const [k, v] of Object.entries(s.attrs)) el.setAttribute(k, v);
          under(el);
          const replica = under(document.createElement('dragon-unstyled'));
          const given = { ...(declared[tag] as Record<string, Record<string, string>>)[dir], ...textFonts[tag], ...(unmodelled[tag] as Record<string, Record<string, string>>)[dir], ...(forced[tag] as Record<string, Record<string, string>>)[dir] };
          for (const [p, v] of Object.entries(given)) replica.style.setProperty(p, v as string);
          const cs = getComputedStyle(el);
          const rs = getComputedStyle(replica);
          for (const p of [...new Set([...Array.from(cs), ...Array.from(rs)])].sort()) {
            const want = cs.getPropertyValue(p);
            const got = rs.getPropertyValue(p);
            if (want !== got) out.push(`${scheme} ${tag} ${dir}: ${p} is ${JSON.stringify(want)} in Chrome but ${JSON.stringify(got)} on dragon-unstyled given the captured values`);
          }
        }
      }
      return out;
    },
    { tags: [...ELEMENT_TAGS, ...ALL_KEYS], specs: SPECS, declared: c.declared, textFonts: c.textFonts, unmodelled: c.unmodelled, forced: c.forced, scheme },
  );
  // Each phrasing key's font size under every elementKeyFontSizes parent, reproduced by dragon-unstyled given its declared and text-font values.
  const sizeFaults = await page.evaluate(
    ({ keys, declared, textFonts, fontSizes, scheme }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      const out: string[] = [];
      for (const key of keys) {
        for (const [family, bySize] of Object.entries(fontSizes[key] as Record<string, Record<string, string>>)) {
          for (const [size, want] of Object.entries(bySize)) {
            hostEl.replaceChildren();
            const parent = document.createElement('div');
            parent.setAttribute('style', `font-family:${family};font-size:${size}`);
            const replica = document.createElement('dragon-unstyled');
            const given = { ...(declared[key] as Record<string, Record<string, string>>)['ltr'], ...textFonts[key] };
            for (const [p, v] of Object.entries(given)) replica.style.setProperty(p, v as string);
            parent.appendChild(replica);
            hostEl.appendChild(parent);
            const got = getComputedStyle(replica).fontSize;
            if (got !== want) out.push(`${scheme} ${key} under ${family} ${size}: font-size is ${JSON.stringify(want)} in Chrome but ${JSON.stringify(got)} on dragon-unstyled given the captured values`);
          }
        }
      }
      return out;
    },
    { keys: [...PHRASING_KEYS], declared: c.declared, textFonts: c.textFonts, fontSizes: c.fontSizes, scheme },
  );
  await page.context().close();
  return [...faults, ...sizeFaults];
}

const field = (row: Record<string, string>): string => `{ ${Object.keys(row).sort().map((p) => `${JSON.stringify(p)}: ${JSON.stringify(row[p])}`).join(', ')} }`;

function render(c: Capture, scheme: Scheme): string {
  const { values, initial, declared, contexts, textFonts, unmodelled, forced, borderKeywords, minimumLogicalFontSize, systemColors, fontSizes } = c;
  const lines: string[] = [];
  lines.push(`// Generated by scripts/capture-ua-defaults.ts from Chrome ${CHROME_VERSION} computed values${scheme === 'dark' ? ' under html{color-scheme:dark}' : ''}. Do not edit; run pnpm run ua:capture.`);
  lines.push('');
  lines.push(`export const chromeVersion = ${JSON.stringify(CHROME_VERSION)};`);
  lines.push('');
  lines.push('/** The capture platform (process.platform-process.arch) this dataset was read on. */');
  lines.push(`export const platform = ${JSON.stringify(platform)};`);
  lines.push('');
  lines.push('export type CapturedTag = ' + TAGS.map((t) => JSON.stringify(t)).join(' | ') + ';');
  lines.push('');
  lines.push('export const computed: { readonly [T in CapturedTag]: { readonly [property: string]: string } } = {');
  for (const tag of TAGS) {
    lines.push(`  ${JSON.stringify(tag)}: {`);
    const row = values[tag] as Record<string, string>;
    for (const p of [...CAPTURED_LONGHANDS].sort()) lines.push(`    ${JSON.stringify(p)}: ${JSON.stringify(row[p])},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  const longhandsOf = (tag: string): string[] => {
    const own = values[tag] as Record<string, string>;
    const init = initial[tag] as Record<string, string>;
    return [...CAPTURED_LONGHANDS].sort().filter((p) => own[p] !== init[p]);
  };
  const declaredOf = (tag: string): string => {
    const d = declared[tag];
    const side = (dir: string): string => field(d === undefined ? {} : (d[dir] as Record<string, string>));
    return `{ ltr: ${side('ltr')}, rtl: ${side('rtl')} }`;
  };
  lines.push('/** Longhands a Chrome UA rule sets per tag: the captured value differs from the value under "<longhand>: initial". */');
  lines.push('export const userAgentLonghands: { readonly [T in CapturedTag]: readonly string[] } = {');
  for (const tag of TAGS) lines.push(`  ${JSON.stringify(tag)}: ${JSON.stringify(longhandsOf(tag))},`);
  lines.push('};');
  lines.push('');
  lines.push('/** Declared UA values per tag and element direction: a captured value, or "<n>em" (font-size: of the parent font size; any other length: of the element\'s own). */');
  lines.push('export const userAgentDeclared: { readonly [T in CapturedTag]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const tag of TAGS) lines.push(`  ${JSON.stringify(tag)}: ${declaredOf(tag)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** Ancestor tags under which a Chrome UA rule gives the tag other milestone longhand values than userAgentDeclared. */');
  lines.push('export const userAgentContexts: { readonly [T in CapturedTag]: readonly string[] } = {');
  for (const tag of TAGS) lines.push(`  ${JSON.stringify(tag)}: ${JSON.stringify(contexts[tag] ?? [])},`);
  lines.push('};');
  lines.push('');
  lines.push('/** Inherited font properties a Chrome UA rule sets per tag that no milestone longhand models, with their computed values. */');
  lines.push('export const userAgentTextFonts: { readonly [T in CapturedTag]: { readonly [property: string]: string } } = {');
  for (const tag of TAGS) lines.push(`  ${JSON.stringify(tag)}: ${field((textFonts[tag] ?? {}) as Record<string, string>)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** Chrome\'s minimum logical font size in px: an em font size under the keyword-sized root is clamped up to it. */');
  lines.push(`export const minimumLogicalFontSize = ${JSON.stringify(minimumLogicalFontSize)};`);
  lines.push('');
  lines.push('/** Computed border widths for the line-width keywords, read with border-style: solid. */');
  lines.push('export const borderWidthKeywords: { readonly [keyword: string]: string } = {');
  for (const k of BORDER_KEYWORDS) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(borderKeywords[k])},`);
  lines.push('};');
  lines.push('');
  lines.push('/** The color scheme of the root this dataset was captured under. */');
  lines.push(`export const colorScheme = ${JSON.stringify(scheme)};`);
  lines.push('');
  lines.push('/** Element keys outside the element table: a tag with the attributes its UA rules key on. */');
  lines.push('export type ElementKey = ' + ELEMENT_KEYS.map((t) => JSON.stringify(t)).join(' | ') + ';');
  lines.push('');
  lines.push('/** The element and attributes each key was captured on. */');
  lines.push('export const elementKeySpecs: { readonly [K in ElementKey]: { readonly tag: string; readonly attributes: { readonly [name: string]: string } } } = {');
  for (const k of ELEMENT_KEYS) lines.push(`  ${JSON.stringify(k)}: { tag: ${JSON.stringify(KEY_SPECS[k].tag)}, attributes: ${field(KEY_SPECS[k].attrs)} },`);
  lines.push('};');
  lines.push('');
  lines.push('/** computed, for the element keys. */');
  lines.push('export const elementKeyComputed: { readonly [K in ElementKey]: { readonly [property: string]: string } } = {');
  for (const k of ELEMENT_KEYS) {
    lines.push(`  ${JSON.stringify(k)}: {`);
    const row = values[k] as Record<string, string>;
    for (const p of [...CAPTURED_LONGHANDS].sort()) lines.push(`    ${JSON.stringify(p)}: ${JSON.stringify(row[p])},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentLonghands, for the element keys. */');
  lines.push('export const elementKeyLonghands: { readonly [K in ElementKey]: readonly string[] } = {');
  for (const k of ELEMENT_KEYS) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(longhandsOf(k))},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentDeclared, for the element keys. */');
  lines.push('export const elementKeyDeclared: { readonly [K in ElementKey]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of ELEMENT_KEYS) lines.push(`  ${JSON.stringify(k)}: ${declaredOf(k)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentContexts, for the element keys. */');
  lines.push('export const elementKeyContexts: { readonly [K in ElementKey]: readonly string[] } = {');
  for (const k of ELEMENT_KEYS) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(contexts[k] ?? [])},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentTextFonts, for the element keys. */');
  lines.push('export const elementKeyTextFonts: { readonly [K in ElementKey]: { readonly [property: string]: string } } = {');
  for (const k of ELEMENT_KEYS) lines.push(`  ${JSON.stringify(k)}: ${field((textFonts[k] ?? {}) as Record<string, string>)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** Properties outside the milestone longhands, their logical aliases and the text fonts whose Chrome value differs from dragon-unstyled given the element\'s declared and text-font values under the same parent, per element and direction. */');
  lines.push('export const userAgentUnmodelled: { readonly [key: string]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of [...ELEMENT_TAGS, ...ELEMENT_KEYS]) {
    const d = unmodelled[k] as Dirs;
    lines.push(`  ${JSON.stringify(k)}: { ltr: ${field(d['ltr'] as Record<string, string>)}, rtl: ${field(d['rtl'] as Record<string, string>)} },`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Milestone longhands Chrome forces per element and direction, which "unset" and "initial" do not change (a UA !important rule, or a form control\'s display: inline adjusted to inline-block), so userAgentDeclared omits them. */');
  lines.push('export const userAgentForced: { readonly [key: string]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of [...ELEMENT_TAGS, ...ELEMENT_KEYS]) {
    const d = forced[k] as Dirs;
    lines.push(`  ${JSON.stringify(k)}: { ltr: ${field(d['ltr'] as Record<string, string>)}, rtl: ${field(d['rtl'] as Record<string, string>)} },`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Computed values of the CSS system colors under this color scheme; null where Chrome does not parse the name. */');
  lines.push('export const systemColors: { readonly [name: string]: string | null } = {');
  for (const n of SYSTEM_COLORS) lines.push(`  ${JSON.stringify(n)}: ${JSON.stringify(systemColors[n])},`);
  lines.push('};');
  lines.push('');
  const dirsOf = (table: Record<string, Dirs>, k: string): string => {
    const d = table[k] as Dirs;
    return `{ ltr: ${field(d['ltr'] as Record<string, string>)}, rtl: ${field(d['rtl'] as Record<string, string>)} }`;
  };
  lines.push('/** Replaced-element keys (REPL-0): iframe, and img with a loaded data: src. Their tables follow the element-key tables. */');
  lines.push('export type ReplacedKey = ' + REPLACED_KEYS.map((t) => JSON.stringify(t)).join(' | ') + ';');
  lines.push('');
  lines.push('/** The element and attributes each replaced key was captured on. */');
  lines.push('export const replacedKeySpecs: { readonly [K in ReplacedKey]: { readonly tag: string; readonly attributes: { readonly [name: string]: string } } } = {');
  for (const k of REPLACED_KEYS) lines.push(`  ${JSON.stringify(k)}: { tag: ${JSON.stringify(REPLACED_KEY_SPECS[k].tag)}, attributes: ${field(REPLACED_KEY_SPECS[k].attrs)} },`);
  lines.push('};');
  lines.push('');
  lines.push('/** computed, for the replaced keys. */');
  lines.push('export const replacedKeyComputed: { readonly [K in ReplacedKey]: { readonly [property: string]: string } } = {');
  for (const k of REPLACED_KEYS) {
    lines.push(`  ${JSON.stringify(k)}: {`);
    const row = values[k] as Record<string, string>;
    for (const p of [...CAPTURED_LONGHANDS].sort()) lines.push(`    ${JSON.stringify(p)}: ${JSON.stringify(row[p])},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentLonghands, for the replaced keys. */');
  lines.push('export const replacedKeyLonghands: { readonly [K in ReplacedKey]: readonly string[] } = {');
  for (const k of REPLACED_KEYS) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(longhandsOf(k))},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentDeclared, for the replaced keys. */');
  lines.push('export const replacedKeyDeclared: { readonly [K in ReplacedKey]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of REPLACED_KEYS) lines.push(`  ${JSON.stringify(k)}: ${declaredOf(k)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentContexts, for the replaced keys. */');
  lines.push('export const replacedKeyContexts: { readonly [K in ReplacedKey]: readonly string[] } = {');
  for (const k of REPLACED_KEYS) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(contexts[k] ?? [])},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentTextFonts, for the replaced keys. */');
  lines.push('export const replacedKeyTextFonts: { readonly [K in ReplacedKey]: { readonly [property: string]: string } } = {');
  for (const k of REPLACED_KEYS) lines.push(`  ${JSON.stringify(k)}: ${field((textFonts[k] ?? {}) as Record<string, string>)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentUnmodelled, for the replaced keys. */');
  lines.push('export const replacedKeyUnmodelled: { readonly [K in ReplacedKey]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of REPLACED_KEYS) lines.push(`  ${JSON.stringify(k)}: ${dirsOf(unmodelled, k)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentForced, for the replaced keys. */');
  lines.push('export const replacedKeyForced: { readonly [K in ReplacedKey]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of REPLACED_KEYS) lines.push(`  ${JSON.stringify(k)}: ${dirsOf(forced, k)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** Phrasing-element keys (INL-U): br, strong, b, em, i, code, small, sub, sup and label. Their tables follow the replaced-key tables. */');
  lines.push('export type PhrasingKey = ' + PHRASING_KEYS.map((t) => JSON.stringify(t)).join(' | ') + ';');
  lines.push('');
  lines.push('/** The element and attributes each phrasing key was captured on. */');
  lines.push('export const phrasingKeySpecs: { readonly [K in PhrasingKey]: { readonly tag: string; readonly attributes: { readonly [name: string]: string } } } = {');
  for (const k of PHRASING_KEYS) lines.push(`  ${JSON.stringify(k)}: { tag: ${JSON.stringify(PHRASING_KEY_SPECS[k].tag)}, attributes: ${field(PHRASING_KEY_SPECS[k].attrs)} },`);
  lines.push('};');
  lines.push('');
  lines.push('/** computed, for the phrasing keys. */');
  lines.push('export const phrasingKeyComputed: { readonly [K in PhrasingKey]: { readonly [property: string]: string } } = {');
  for (const k of PHRASING_KEYS) {
    lines.push(`  ${JSON.stringify(k)}: {`);
    const row = values[k] as Record<string, string>;
    for (const p of [...CAPTURED_LONGHANDS].sort()) lines.push(`    ${JSON.stringify(p)}: ${JSON.stringify(row[p])},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentLonghands, for the phrasing keys. */');
  lines.push('export const phrasingKeyLonghands: { readonly [K in PhrasingKey]: readonly string[] } = {');
  for (const k of PHRASING_KEYS) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(longhandsOf(k))},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentDeclared, for the phrasing keys. A relative font-size keyword (smaller, larger) is kept as the keyword; elementKeyFontSizes has its computed values. */');
  lines.push('export const phrasingKeyDeclared: { readonly [K in PhrasingKey]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of PHRASING_KEYS) lines.push(`  ${JSON.stringify(k)}: ${declaredOf(k)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentContexts, for the phrasing keys. */');
  lines.push('export const phrasingKeyContexts: { readonly [K in PhrasingKey]: readonly string[] } = {');
  for (const k of PHRASING_KEYS) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(contexts[k] ?? [])},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentTextFonts, for the phrasing keys. */');
  lines.push('export const phrasingKeyTextFonts: { readonly [K in PhrasingKey]: { readonly [property: string]: string } } = {');
  for (const k of PHRASING_KEYS) lines.push(`  ${JSON.stringify(k)}: ${field((textFonts[k] ?? {}) as Record<string, string>)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentUnmodelled, for the phrasing keys. */');
  lines.push('export const phrasingKeyUnmodelled: { readonly [K in PhrasingKey]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of PHRASING_KEYS) lines.push(`  ${JSON.stringify(k)}: ${dirsOf(unmodelled, k)},`);
  lines.push('};');
  lines.push('');
  lines.push('/** userAgentForced, for the phrasing keys. */');
  lines.push('export const phrasingKeyForced: { readonly [K in PhrasingKey]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const k of PHRASING_KEYS) lines.push(`  ${JSON.stringify(k)}: ${dirsOf(forced, k)},`);
  lines.push('};');
  lines.push('');
  lines.push(`/** Computed font-size of each phrasing key under a parent of each family (${FONT_SIZE_FAMILIES.join(', ')}) and font-size (${FONT_SIZE_PARENTS.join(', ')}; medium is the keyword). */`);
  lines.push('export const elementKeyFontSizes: { readonly [K in PhrasingKey]: { readonly [family: string]: { readonly [parentFontSize: string]: string } } } = {');
  for (const k of PHRASING_KEYS) {
    const byFamily = fontSizes[k] as Record<string, Record<string, string>>;
    const fam = FONT_SIZE_FAMILIES.map((f) => `${JSON.stringify(f)}: { ${FONT_SIZE_PARENTS.map((s) => `${JSON.stringify(s)}: ${JSON.stringify((byFamily[f] as Record<string, string>)[s])}`).join(', ')} }`);
    lines.push(`  ${JSON.stringify(k)}: { ${fam.join(', ')} },`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function applyPlant(p: Plant, light: Capture): void {
  if (p === 'drop-declared') {
    for (const dir of ['ltr', 'rtl']) delete ((light.declared['button'] as Dirs)[dir] as Record<string, string>)['padding-left'];
  } else if (p === 'drop-unmodelled') {
    for (const dir of ['ltr', 'rtl']) delete ((light.unmodelled['button'] as Dirs)[dir] as Record<string, string>)['appearance'];
  } else if (p === 'drop-font-size-small') {
    for (const dir of ['ltr', 'rtl']) delete ((light.declared['small'] as Dirs)[dir] as Record<string, string>)['font-size'];
  }
}

/** Compares the committed light dataset with another dataset file: entries of keys present in both. Returns the exit code. */
async function compare(otherPath: string, currentPath: string): Promise<number> {
  const other = (await import(pathToFileURL(otherPath).href)) as Record<string, unknown>;
  const current = (await import(pathToFileURL(currentPath).href)) as Record<string, unknown>;
  const baseKeys = new Set(Object.keys((other['computed'] ?? {}) as object));
  const differing: string[] = [];
  const ancestors: string[] = [];
  let compared = 0;
  for (const name of Object.keys(other).sort()) {
    if (!(name in current)) continue;
    const a = other[name];
    const b = current[name];
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
      compared += 1;
      if (JSON.stringify(a) !== JSON.stringify(b)) differing.push(`${name}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      continue;
    }
    for (const key of Object.keys(a).sort()) {
      if (!(key in b)) continue;
      compared += 1;
      const va = (a as Record<string, unknown>)[key];
      const vb = (b as Record<string, unknown>)[key];
      if (JSON.stringify(va) === JSON.stringify(vb)) continue;
      if (name === 'userAgentContexts' && Array.isArray(va) && Array.isArray(vb)) {
        const added = vb.filter((x) => !va.includes(x));
        if (va.every((x) => vb.includes(x)) && added.every((x) => !baseKeys.has(x))) {
          ancestors.push(`${name}.${key}: gains new-key ancestors ${added.join(', ')}`);
          continue;
        }
      }
      differing.push(`${name}.${key}: ${JSON.stringify(va)} -> ${JSON.stringify(vb)}`);
    }
  }
  console.log(`compared ${compared} entries present in both; ${differing.length} differ; ${ancestors.length} gain new-key ancestor contexts`);
  for (const l of ancestors) console.log(`  ancestor: ${l}`);
  for (const l of differing) console.log(`  differs: ${l}`);
  return differing.length === 0 ? 0 : 1;
}

const browser = await launchChrome();
try {
  const light = await capture(browser, 'light');
  const dark = await capture(browser, plant === 'dark-as-light' ? 'light' : 'dark');
  if (plant !== undefined) applyPlant(plant, light);
  const faults = [...(await selfConsistency(browser, 'light', light)), ...(await selfConsistency(browser, 'dark', dark))];
  if (dark.systemColors['Canvas'] === light.systemColors['Canvas']) faults.push(`dark capture is not dark: Canvas is ${light.systemColors['Canvas']} in both the light and the dark capture`);
  if (dark.values['html']?.['color'] !== dark.systemColors['CanvasText']) faults.push(`dark capture is not dark: the root color ${dark.values['html']?.['color']} is not the dark CanvasText ${dark.systemColors['CanvasText']}`);
  const outputs: [string, string][] = [[lightFile, render(light, 'light')], [darkFile, render(dark, 'dark')]];
  if (check) {
    for (const [file, text] of outputs) {
      let committed = '';
      try {
        committed = readFileSync(repoPath(file), 'utf8');
      } catch {
        faults.push(`${file} is missing`);
        continue;
      }
      if (committed !== text) {
        const a = committed.split('\n');
        const b = text.split('\n');
        const at = b.findIndex((l, i) => l !== a[i]);
        faults.push(`${file} is not byte-identical to the recapture; first difference at line ${at + 1}: ${JSON.stringify(a[at])} -> ${JSON.stringify(b[at])}`);
      }
    }
    if (plant !== undefined) console.log(`plant ${plant} applied`);
    for (const f of faults) console.error(`FAULT ${f}`);
    if (faults.length > 0) process.exitCode = 1;
    else console.log(`check: ${lightFile} and ${darkFile} recapture byte-identically; self-consistency holds for ${ELEMENT_TAGS.length + ALL_KEYS.length} elements in ltr and rtl, light and dark`);
  } else {
    if (faults.length > 0) throw new Error(`ua:capture refuses to write:\n${faults.join('\n')}`);
    for (const [file, text] of outputs) {
      writeFileSync(repoPath(file), text);
      console.log(`wrote ${file}`);
    }
  }
} finally {
  await browser.close();
}
