// The stated reference of a pinned generic family (notes/T033-txt1c-wiring-spec.md §1.3), shared by scripts/capture-font-reference.ts
// and the fonts fixtures: Chrome renders the authored document with the pinned faces injected as @font-face rules and every
// unquoted pinned generic replaced by its pinned family in Chrome's own CSSOM (Chrome's parse and serialization, rewritten in the
// page; Dragon's family-list.ts and font-map.ts are not used). Also the CDP read of the face Chrome renders each node with.
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import type { FontMap } from 'dragon';
import { repoPath } from './paths.ts';

/** A planted break of the in-page rewrite, which the reference captures must catch. */
export const REFERENCE_PLANTS = ['quoted-generic-rewritten', 'generic-not-rewritten'] as const;
export type ReferencePlant = (typeof REFERENCE_PLANTS)[number];

/** What the in-page rewrite did to one font-family declaration: Chrome's serialization before and after. */
export type Visit = { readonly where: string; readonly before: string; readonly after: string };

export type PlatformFont = { readonly familyName: string; readonly postScriptName: string; readonly isCustomFont: boolean; readonly glyphCount: number };

/** The prefix of a snapshot asset id that names a vendored font file (vendor/fonts/<dir>/<file>). */
export const VENDOR_FONTS = 'vendor/fonts/';

/** The fonts fixtures' map (T033 §1.1, the north star's Lato from T036): Dragon Sans, Dragon Mono, Lato, and system-ui to the platform. */
export const FONT_REFERENCE_MAP: FontMap = {
  generics: {
    'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [
      { src: `${VENDOR_FONTS}Inter/Inter-Light.ttf`, weight: '300' }, { src: `${VENDOR_FONTS}Inter/Inter-Regular.ttf`, weight: '400' },
      { src: `${VENDOR_FONTS}Inter/Inter-Italic.ttf`, weight: '400', style: 'italic' }, { src: `${VENDOR_FONTS}Inter/Inter-Bold.ttf`, weight: '700' },
      { src: `${VENDOR_FONTS}Inter/Inter-BoldItalic.ttf`, weight: '700', style: 'italic' },
    ] },
    monospace: { mode: 'pinned', family: 'Dragon Mono', faces: [{ src: `${VENDOR_FONTS}NotoSansMono/NotoSansMono-Regular.ttf` }] },
    'system-ui': { mode: 'platform' },
  },
  families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: `${VENDOR_FONTS}Lato/Lato-Regular.ttf`, weight: '400' }, { src: `${VENDOR_FONTS}Lato/Lato-Bold.ttf`, weight: '700' }] } },
};

/** The bytes of a vendored font by its path under vendor/fonts; a path that leaves vendor/fonts is refused. */
export function vendorFontBytes(file: string): Buffer {
  if (file.split('/').some((p) => p === '..' || p === '') || file.startsWith('/')) throw new Error(`not a vendored font path: ${file}`);
  return readFileSync(repoPath(`${VENDOR_FONTS}${file}`));
}

export const fontDataUrl = (bytes: Uint8Array): string => `data:font/ttf;base64,${Buffer.from(bytes).toString('base64')}`;

const quoteCss = (s: string): string => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;

/**
 * The unquoted generic keyword to pinned family pairs the in-page rewrite replaces. A named family entry must pin under its own
 * name: the CSSOM rewrite replaces only generics, so the reference could not express a renamed family.
 */
export function pinnedGenerics(map: FontMap): Record<string, string> {
  for (const [name, e] of Object.entries(map.families ?? {})) {
    if (e.mode === 'pinned' && e.family !== name) throw new Error(`the stated reference cannot rename the family ${name} to ${e.family}`);
  }
  return Object.fromEntries(Object.entries(map.generics).flatMap(([k, e]) => (e !== undefined && e.mode === 'pinned' ? [[k, e.family]] : [])));
}

/** Every pinned face of the map as an @font-face rule; srcOf gives each face's URL (a data: URL for Chrome, or the src as written). */
export function pinnedFaceCss(map: FontMap, srcOf: (src: string) => string): string {
  const entries = [...Object.values(map.generics), ...Object.values(map.families ?? {})];
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const e of entries) {
    if (e === undefined || e.mode !== 'pinned' || seen.has(e.family)) continue;
    seen.add(e.family);
    for (const f of e.faces) {
      const d = [`font-family:${quoteCss(e.family)}`, `src:url("${srcOf(f.src)}") format("truetype")`];
      if (f.weight !== undefined) d.push(`font-weight:${f.weight}`);
      if (f.style !== undefined) d.push(`font-style:${f.style}`);
      if (f.stretch !== undefined) d.push(`font-stretch:${f.stretch}`);
      if (f.unicodeRange !== undefined) d.push(`unicode-range:${f.unicodeRange}`);
      rules.push(`@font-face{${d.join(';')}}`);
    }
  }
  return rules.join('\n');
}

/** Waits for every font load and two frames. */
export async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

/**
 * The stated-reference transform, run in the page: inject faceCss, then for every font-family longhand in every style rule
 * (grouping rules included) and every style attribute, split Chrome's serialization into entries and replace each unquoted entry
 * that is a pinned generic keyword. Chrome serializes a generic keyword unquoted and lowercase, and quotes a family name that
 * spells an inferred generic ("sans-serif"), so the quoted name is not replaced.
 */
export async function applyFontReference(page: Page, faceCss: string, pinned: Record<string, string>, plant: ReferencePlant | null = null): Promise<Visit[]> {
  const visits = await page.evaluate(({ faceCss: css, pinned: map, plant: p }) => {
    const style = document.createElement('style');
    style.setAttribute('data-dragon-reference', '');
    style.textContent = css;
    document.head.append(style);
    const quote = (s: string): string => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;
    const unquote = (s: string): string => s.slice(1, -1).replace(/\\(.)/g, '$1');
    const split = (text: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inString = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i] as string;
        if (inString && c === '\\') {
          cur += c + (text[i + 1] ?? '');
          i++;
        } else if (c === '"') {
          inString = !inString;
          cur += c;
        } else if (c === ',' && !inString) {
          out.push(cur.trim());
          cur = '';
        } else cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    const rewrite = (text: string): string => split(text).map((e) => {
      if (!e.startsWith('"') && Object.hasOwn(map, e) && p !== 'generic-not-rewritten') return quote(map[e] as string);
      if (e.startsWith('"') && p === 'quoted-generic-rewritten' && Object.hasOwn(map, unquote(e))) return quote(map[unquote(e)] as string);
      return e;
    }).join(', ');
    const out: { where: string; before: string; after: string }[] = [];
    const visit = (decls: CSSStyleDeclaration, where: string): void => {
      const before = decls.getPropertyValue('font-family');
      if (before === '') return;
      const after = rewrite(before);
      if (after !== before) decls.setProperty('font-family', after, decls.getPropertyPriority('font-family'));
      out.push({ where, before, after: decls.getPropertyValue('font-family') });
    };
    const walk = (rules: CSSRuleList): void => {
      for (const rule of [...rules]) {
        if (rule instanceof CSSStyleRule) visit(rule.style, rule.selectorText);
        if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of [...document.styleSheets]) walk(sheet.cssRules);
    for (const el of [...document.querySelectorAll('[style]')]) visit((el as HTMLElement).style, `#${el.id}[style]`);
    return out;
  }, { faceCss, pinned, plant });
  await settleFonts(page);
  return visits;
}

/** The faces Chrome renders each selected node's text with (CSS.getPlatformFontsForNode), sorted by postScriptName. */
export async function platformFonts(page: Page, selectors: readonly string[]): Promise<PlatformFont[][]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const out: PlatformFont[][] = [];
    for (const sel of selectors) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (nodeId === 0) throw new Error(`no node for ${sel}`);
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      out.push(fonts.map((f) => ({ familyName: f.familyName, postScriptName: f.postScriptName, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount }))
        .sort((a, b) => (a.postScriptName < b.postScriptName ? -1 : a.postScriptName > b.postScriptName ? 1 : 0)));
    }
    return out;
  } finally {
    await cdp.detach();
  }
}
