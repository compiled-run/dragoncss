// Captures Chrome's computed values for the supported tags and an element with no UA rules, for every milestone longhand,
// and which longhands a UA rule sets per tag: those whose value differs from the same element with "<longhand>: initial".
// It also derives each tag's UA declared values per direction (a length that scales with the font size is written in em), the
// ancestor tags under which Chrome's UA sheet gives a tag other values, and the UA font-weight and font-style no longhand models.
// Blink's html.css is LGPL, so Dragon stores these captured values as data instead of copying the sheet.
// The dataset is keyed by the capture platform (process.platform-process.arch): it writes only this platform's file,
// packages/dragon/src/ua/chrome-145.<platform>.generated.ts, and refuses a platform argument other than this one.
// Run with: pnpm run ua:capture [platform]
import { writeFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { hostPlatform } from '../packages/parity/src/platform.ts';
import { LONGHANDS } from '../packages/dragon/src/css/properties.ts';

const TAGS = [
  'html', 'body', 'div',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'address', 'hr', 'dl', 'dt', 'dd',
  'dragon-unstyled',
] as const;
/** The tags whose declared values and contexts are derived: every captured tag but the root and the unstyled element. */
const ELEMENT_TAGS = TAGS.filter((t) => t !== 'html' && t !== 'dragon-unstyled');
/** Inherited font properties no milestone longhand models; a UA value for them changes how text is drawn. */
const TEXT_FONT_PROPERTIES = ['font-weight', 'font-style'] as const;
const BORDER_KEYWORDS = ['thin', 'medium', 'thick'] as const;

// Width, height, margins and padding resolve to used values on rendered elements (CSSOM getComputedStyle),
// so every element except html's own display is read from a document whose root is display:none.
const hiddenDoc = `<!DOCTYPE html><html><head><style>html{display:none}</style></head><body>${TAGS.filter((t) => t !== 'html' && t !== 'body' && t !== 'dragon-unstyled').map((t) => `<${t}></${t}>`).join('')}<dragon-unstyled></dragon-unstyled>${BORDER_KEYWORDS.map((k) => `<dragon-unstyled data-border="${k}" style="border-style:solid;border-width:${k}"></dragon-unstyled>`).join('')}</body></html>`;
const renderedDoc = '<!DOCTYPE html><html><head></head><body></body></html>';
const hostDoc = '<!DOCTYPE html><html><head></head><body><div id="host" style="display:none"></div></body></html>';

const platform = hostPlatform();
const requested = process.argv[2];
if (requested !== undefined && requested !== platform) {
  console.error(`ua:capture refuses to write the ${requested} dataset on ${platform}: a dataset is captured only on its own platform`);
  process.exit(1);
}
// The UA capture reads Chrome's own root font, so the harness adds no environment font.
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const browser = await launchChrome();
try {
  const hidden = await openPage(browser, hiddenDoc, ENV);
  const { out: values, initial } = await hidden.evaluate(
    ({ tags, props }) => {
      const out: Record<string, Record<string, string>> = {};
      const initial: Record<string, Record<string, string>> = {};
      for (const tag of tags) {
        const el = document.querySelector(tag === 'dragon-unstyled' ? 'dragon-unstyled:not([data-border])' : tag) as HTMLElement;
        const cs = getComputedStyle(el);
        out[tag] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
        initial[tag] = Object.fromEntries(props.map((p) => {
          el.style.setProperty(p, 'initial');
          const v = getComputedStyle(el).getPropertyValue(p);
          el.style.removeProperty(p);
          return [p, v];
        }));
      }
      return { out, initial };
    },
    { tags: [...TAGS], props: [...LONGHANDS] },
  );
  const borderKeywords = await hidden.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('[data-border]')).map((e) => [e.getAttribute('data-border'), getComputedStyle(e).borderTopWidth]),
    ),
  );
  const rendered = await openPage(browser, renderedDoc, ENV);
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
  const host = await openPage(browser, hostDoc, ENV);
  const declared = await host.evaluate(
    ({ tags, props }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      const px = (v: string): number | null => (/^-?[0-9.]+(e-?[0-9]+)?px$/.test(v) ? Number.parseFloat(v) : null);
      const out: Record<string, Record<string, Record<string, string>>> = {};
      for (const tag of tags) {
        out[tag] = {};
        for (const dir of ['ltr', 'rtl']) {
          const read = (size: number): { el: HTMLElement; values: Record<string, string>; initial: Record<string, string> } => {
            hostEl.replaceChildren();
            const parent = document.createElement('div');
            parent.setAttribute('style', `font-size:${size}px;direction:${dir}`);
            const el = document.createElement(tag);
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
              if (Math.abs(nb / baseB - factor) > 1e-9) throw new Error(`${tag} ${p}: ${va} and ${vb} do not scale with the font size`);
              row[p] = `${factor}em`;
            } else throw new Error(`${tag} ${p}: ${va} at 100px and ${vb} at 200px is neither absolute nor em-relative`);
          }
          (out[tag] as Record<string, Record<string, string>>)[dir] = row;
        }
      }
      return out;
    },
    { tags: [...ELEMENT_TAGS], props: [...LONGHANDS] },
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
    ({ tags, props, minimum }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      const out: Record<string, string[]> = {};
      const standIn = (of: HTMLElement): string => {
        const cs = getComputedStyle(of);
        return Array.from(cs).map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
      };
      const differs = (chain: string[], tag: string): boolean => {
        hostEl.replaceChildren();
        let parent: HTMLElement = hostEl;
        for (const a of chain) {
          const next = document.createElement(a);
          parent.appendChild(next);
          parent = next;
        }
        const el = document.createElement(tag);
        parent.appendChild(el);
        const inContext = Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)]));
        const style = standIn(parent);
        const holder = document.createElement('div');
        holder.setAttribute('style', style);
        const bare = document.createElement(tag);
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
        return props.some((p) => !same(inContext[p] as string, outside[p] as string));
      };
      for (const tag of tags) {
        const found = new Set<string>();
        for (const a of tags) {
          if (a === 'body') continue;
          if (differs([a], tag)) found.add(a);
          for (const b of tags) {
            // a alone gives the model's values here, so the outer b (with a between) is the ancestor a UA rule keys on.
            if (b === 'body' || found.has(a) || found.has(b)) continue;
            if (differs([b, a], tag)) found.add(b);
          }
        }
        out[tag] = [...found].sort();
      }
      return out;
    },
    { tags: [...ELEMENT_TAGS], props: [...LONGHANDS], minimum: minimumLogicalFontSize },
  );
  const textFonts = await host.evaluate(
    ({ tags, props }) => {
      const hostEl = document.getElementById('host') as HTMLElement;
      return Object.fromEntries(tags.map((tag) => {
        hostEl.replaceChildren();
        const el = document.createElement(tag);
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
    { tags: [...ELEMENT_TAGS], props: [...TEXT_FONT_PROPERTIES] },
  );
  // The declared ltr values at the 16px root must reproduce the captured table exactly.
  for (const tag of ELEMENT_TAGS) {
    const ltr = (declared[tag] as Record<string, Record<string, string>>)['ltr'] as Record<string, string>;
    const own = values[tag] as Record<string, string>;
    const init = initial[tag] as Record<string, string>;
    const set = [...LONGHANDS].sort().filter((p) => own[p] !== init[p]);
    if (JSON.stringify(Object.keys(ltr).sort()) !== JSON.stringify(set)) throw new Error(`${tag}: declared longhands ${Object.keys(ltr).join(',')} differ from the captured ${set.join(',')}`);
  }

  const lines: string[] = [];
  lines.push(`// Generated by scripts/capture-ua-defaults.ts from Chrome ${CHROME_VERSION} computed values. Do not edit; run pnpm run ua:capture.`);
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
    for (const p of [...LONGHANDS].sort()) lines.push(`    ${JSON.stringify(p)}: ${JSON.stringify(row[p])},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Longhands a Chrome UA rule sets per tag: the captured value differs from the value under "<longhand>: initial". */');
  lines.push('export const userAgentLonghands: { readonly [T in CapturedTag]: readonly string[] } = {');
  for (const tag of TAGS) {
    const own = values[tag] as Record<string, string>;
    const init = initial[tag] as Record<string, string>;
    const set = [...LONGHANDS].sort().filter((p) => own[p] !== init[p]);
    lines.push(`  ${JSON.stringify(tag)}: ${JSON.stringify(set)},`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Declared UA values per tag and element direction: a captured value, or "<n>em" (font-size: of the parent font size; any other length: of the element\'s own). */');
  lines.push('export const userAgentDeclared: { readonly [T in CapturedTag]: { readonly ltr: { readonly [property: string]: string }; readonly rtl: { readonly [property: string]: string } } } = {');
  for (const tag of TAGS) {
    const d = declared[tag] as Record<string, Record<string, string>> | undefined;
    const side = (dir: string): string => {
      const row = d === undefined ? {} : (d[dir] as Record<string, string>);
      return `{ ${Object.keys(row).sort().map((p) => `${JSON.stringify(p)}: ${JSON.stringify(row[p])}`).join(', ')} }`;
    };
    lines.push(`  ${JSON.stringify(tag)}: { ltr: ${side('ltr')}, rtl: ${side('rtl')} },`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Ancestor tags under which a Chrome UA rule gives the tag other milestone longhand values than userAgentDeclared. */');
  lines.push('export const userAgentContexts: { readonly [T in CapturedTag]: readonly string[] } = {');
  for (const tag of TAGS) lines.push(`  ${JSON.stringify(tag)}: ${JSON.stringify(contexts[tag] ?? [])},`);
  lines.push('};');
  lines.push('');
  lines.push('/** Inherited font properties a Chrome UA rule sets per tag that no milestone longhand models, with their computed values. */');
  lines.push('export const userAgentTextFonts: { readonly [T in CapturedTag]: { readonly [property: string]: string } } = {');
  for (const tag of TAGS) {
    const row = (textFonts[tag] ?? {}) as Record<string, string>;
    lines.push(`  ${JSON.stringify(tag)}: { ${Object.keys(row).sort().map((p) => `${JSON.stringify(p)}: ${JSON.stringify(row[p])}`).join(', ')} },`);
  }
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
  const file = `packages/dragon/src/ua/chrome-145.${platform}.generated.ts`;
  writeFileSync(repoPath(file), lines.join('\n'));
  console.log(`wrote ${file}`);
} finally {
  await browser.close();
}
