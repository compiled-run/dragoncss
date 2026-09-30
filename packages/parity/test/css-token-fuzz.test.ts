// The CSS tokenizer differential fuzzer (PR #28 round 2): seeded short value texts (css-token-fuzz/generate.ts, committed as
// css-token-fuzz/generated/corpus.json), each closed and cut at every code unit (an end of input at every position), read by Dragon
// and by the pinned Chrome 145 as a font-family value, a custom property value, a class selector and a display keyword. Chrome's
// computed value of the authored rule must equal its computed value of Dragon's reading, a value Dragon drops must be one Chrome drops,
// a class Dragon decodes must match in Chrome and serialize as CSS.escape does. Every disagreement must be a listed exception; plants
// must be caught.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { serializeIdentifier } from '../../dragon/src/css/escapes.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import type { CssValue } from '../../dragon/src/css/values.ts';
import type { Diagnostic } from '../../dragon/src/types.ts';
import type { FuzzMode, FuzzText } from './css-token-fuzz/generate.ts';
import { CORPUS_URL, CSS_TOKEN_FUZZ_COUNT, CSS_TOKEN_FUZZ_SEED, generateTexts } from './css-token-fuzz/generate.ts';

const SOURCE = { uri: 'dragon-source://test/token-fuzz.css', revision: 'r1', hash: 'sha256:0' };
const USE = { id: 's', owner: 'doc', scope: 'document' } as const;
type Page = { setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> };
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;

const PROPERTY: Record<Exclude<FuzzMode, 'class'>, string> = { family: 'font-family', custom: '--x', keyword: 'display' };

/** One case: the stylesheet (or, for a class cut at the end, the selector alone) and what Dragon read from it. */
type Case = {
  readonly mode: FuzzMode;
  readonly css: string;
  readonly eof: boolean;
  /** The value Dragon declares as CSS text Chrome can set, null when Dragon drops it, or 'refused:<codes>'. */
  readonly dragon: string | null;
};

/** CSSOM "serialize a string". */
const cssString = (s: string): string => `"${[...s].map((c) => {
  const cp = c.codePointAt(0) as number;
  if (cp === 0) return '�';
  if ((cp >= 1 && cp <= 0x1f) || cp === 0x7f) return `\\${cp.toString(16)} `;
  return c === '"' || c === '\\' ? `\\${c}` : c;
}).join('')}"`;
const IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
const cssText = (v: CssValue): string => (v.kind === 'family' && !IDENT.test(v.value) ? cssString(v.value) : valueToString(v));

function dragonSheet(css: string): { declared: string | null; property: string | null; codes: string[] } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, USE, 0, diagnostics);
  const d = rules[0]?.declarations[0];
  const codes = diagnostics.map((x) => x.code);
  if (d === undefined) return { declared: null, property: null, codes };
  if (d.custom !== undefined) return { declared: d.custom.wide ?? d.text, property: d.property, codes };
  const l = d.longhands[0];
  return { declared: l === undefined ? null : cssText(l.value), property: d.property, codes };
}

/** The class a selector names when Dragon reads it as one compound holding exactly one class ('class:<name>'), 'other', 'drop' or a refusal. */
function dragonClass(selector: string): string {
  const diagnostics: Diagnostic[] = [];
  const css = `${selector}{color:red}`;
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, USE, 0, diagnostics);
  const selectors = rules[0]?.selectors ?? null;
  if (diagnostics.some((d) => d.code === 'DRAGON_SELECTOR_DROPPED' || d.code === 'DRAGON_CSS_PARSE') || (selectors === null && diagnostics.length === 0)) return 'drop';
  if (selectors === null || diagnostics.length > 0) return `refused:${diagnostics.map((d) => d.code).join(',')}`;
  const only = selectors.length === 1 ? selectors[0] : undefined;
  const c = only?.parts.length === 1 ? only.parts[0]?.compound : undefined;
  if (c === undefined || c.classes.length !== 1 || c.tag !== null || c.ids.length > 0 || c.attributes.length > 0 || c.pseudos.length > 0) return 'other';
  return `class:${c.classes[0] as string}`;
}

function caseOf(t: FuzzText, cut: number | null): Case {
  const text = cut === null ? t.text : t.text.slice(0, cut);
  const eof = cut !== null;
  // A selector needs its block, so a cut class is closed right after the cut: the cut still lands inside escapes, strings and comments.
  if (t.mode === 'class') return { mode: t.mode, css: `.${text}`, eof, dragon: dragonClass(`.${text}`) };
  const css = `.a{${PROPERTY[t.mode]}:${text}${eof ? '' : '}'}`;
  const r = dragonSheet(css);
  const refused = r.codes.filter((c) => c !== 'DRAGON_CSS_INVALID_VALUE' && c !== 'DRAGON_CSS_PARSE' && c !== 'DRAGON_UNSUPPORTED_PROPERTY');
  if (refused.length > 0 && r.declared === null) return { mode: t.mode, css, eof, dragon: `refused:${refused.join(',')}` };
  return { mode: t.mode, css, eof, dragon: r.codes.length === 0 && r.property === PROPERTY[t.mode] ? r.declared : null };
}

/** Every text closed, and cut at every code unit. */
const casesOf = (texts: readonly FuzzText[]): Case[] => texts.flatMap((t) => [caseOf(t, null), ...Array.from({ length: t.text.length }, (_, k) => caseOf(t, k))]);

type Seen = { readonly declared: boolean; readonly authored: string; readonly dragon: string; readonly dragonSet: boolean; readonly escape?: string };

const chromeExpression = (cases: readonly Case[]): string => `(${JSON.stringify(cases)}).map((c) => {
  const a = document.getElementById('a'), d = document.getElementById('d');
  if (c.mode === 'class') {
    let valid = true, matched = false;
    const name = c.dragon !== null && c.dragon.startsWith('class:') ? c.dragon.slice(6) : null;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(c.css + '{color:red}');
    const rule = sheet.cssRules[0];
    valid = rule !== undefined && rule.selectorText !== undefined;
    if (valid) { try { d.className = name ?? 'zzz-none'; matched = d.matches(rule.selectorText); } catch { valid = false; } }
    return { declared: valid, authored: String(matched), dragon: '', dragonSet: true, escape: name === null ? undefined : CSS.escape(name) };
  }
  const p = ${JSON.stringify(PROPERTY)}[c.mode];
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(c.css);
  const rule = sheet.cssRules[0];
  // An empty custom property value is declared though it reads as '', so the declared names are listed.
  const declared = rule !== undefined && rule.style !== undefined && Array.from(rule.style).includes(p);
  document.adoptedStyleSheets = [sheet];
  d.removeAttribute('style');
  let dragonSet = true;
  // cssText, since setProperty with an empty value removes the property, and an empty custom property value is a value.
  if (c.dragon !== null && !c.dragon.startsWith('refused:')) { d.style.cssText = p + ':' + c.dragon; dragonSet = Array.from(d.style).includes(p); }
  const out = { declared, authored: getComputedStyle(a).getPropertyValue(p), dragon: getComputedStyle(d).getPropertyValue(p), dragonSet };
  document.adoptedStyleSheets = [];
  return out;
})`;

/**
 * Disagreements that are listed exceptions, each an error the author sees and never a wrong value: a literal U+0000 is reported
 * (Chrome 145 reads it differently by position), and css-tree reports a comment between "." and a class name, which Chrome allows.
 */
function listed(c: Case): string | null {
  if (c.css.includes('\u0000') && (c.dragon === null || c.dragon === 'drop')) return 'a literal U+0000 is reported';
  if (c.mode === 'class' && c.dragon === 'drop' && c.css.startsWith('./*')) return 'css-tree rejects a comment between "." and the class name';
  return null;
}

type Problem = { readonly kind: string; readonly c: Case; readonly seen: Seen };
function judge(cases: readonly Case[], seen: readonly Seen[]): Problem[] {
  const out: Problem[] = [];
  cases.forEach((c, i) => {
    const s = seen[i] as Seen;
    const bad = (kind: string): void => {
      if (listed(c) === null) out.push({ kind, c, seen: s });
    };
    if (c.dragon !== null && c.dragon.startsWith('refused:')) return;
    if (c.mode === 'class') {
      if (c.dragon === 'drop') {
        if (s.declared) bad('class: Dragon drops, Chrome parses');
      } else if (!s.declared) bad('class: Dragon parses, Chrome drops');
      else if (c.dragon !== null && c.dragon.startsWith('class:')) {
        const name = c.dragon.slice(6);
        // A class attribute splits at ASCII white space, so a class holding one matches no element, in Chrome and in Dragon.
        if (s.authored !== 'true' && !/[ \t\n\r\f]/.test(name)) bad('class: Chrome does not match the class Dragon decoded');
        if (s.escape !== serializeIdentifier(name)) bad('class: serializeIdentifier differs from CSS.escape');
      }
      return;
    }
    if (c.dragon === null) {
      if (s.declared) bad(`${c.mode}: Dragon drops, Chrome parses`);
      return;
    }
    if (!s.declared) bad(`${c.mode}: Dragon accepts, Chrome drops`);
    else if (!s.dragonSet) bad(`${c.mode}: Chrome drops Dragon's value`);
    else if (s.authored !== s.dragon) bad(`${c.mode}: computed values differ`);
  });
  return out;
}

const summary = (ps: readonly Problem[]): Record<string, number> => ps.reduce<Record<string, number>>((m, p) => ({ ...m, [p.kind]: (m[p.kind] ?? 0) + 1 }), {});

describe('CSS tokenizer differential fuzzer against Chrome 145', () => {
  it('the committed corpus is the generator output for its seed', () => {
    const corpus = JSON.parse(readFileSync(CORPUS_URL, 'utf8')) as { seed: number; count: number; texts: FuzzText[] };
    expect({ seed: corpus.seed, count: corpus.count }).toEqual({ seed: CSS_TOKEN_FUZZ_SEED, count: CSS_TOKEN_FUZZ_COUNT });
    expect(corpus.texts).toEqual(generateTexts());
  });

  it('every closed and cut case reads as Chrome reads it, and the plants are caught', async () => {
    const corpus = JSON.parse(readFileSync(CORPUS_URL, 'utf8')) as { texts: FuzzText[] };
    const cases = casesOf(corpus.texts);
    const { launchChrome } = await load<{ launchChrome: () => Promise<Browser> }>('chrome.ts');
    const browser = await launchChrome();
    let seen: Seen[] = [];
    let plantSeen: Seen[][] = [];
    // Plants: Dragon reading a value without decoding, keeping the end-of-input backslash, folding Unicode case, and decoding a class wrongly.
    const plants: { name: string; cases: Case[] }[] = [
      { name: 'familyUndecoded', cases: cases.filter((c) => c.mode === 'family' && c.dragon !== null && !c.dragon.startsWith('refused:') && c.css.includes('\\')).slice(0, 50).map((c) => ({ ...c, dragon: cssString(c.css.slice(15).replace(/}$/, '')) })) },
      { name: 'keywordUnicodeFold', cases: [{ mode: 'keyword', css: '.a{display:blocK}', eof: false, dragon: 'block' }, { mode: 'keyword', css: '.a{display:İnline}', eof: false, dragon: 'inline' }] },
      { name: 'classMisdecoded', cases: cases.filter((c) => c.mode === 'class' && c.dragon !== null && c.dragon.startsWith('class:')).slice(0, 50).map((c) => ({ ...c, dragon: `class:${(c.dragon as string).slice(6)}x` })) },
      { name: 'customEofKept', cases: [{ mode: 'custom', css: '.a{--x:a\\', eof: true, dragon: 'a\\\\' }] },
    ];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="p"><div id="a" class="a"></div><div id="d"></div></div>');
      const run = async (cs: readonly Case[]): Promise<Seen[]> => {
        const out: Seen[] = [];
        for (let i = 0; i < cs.length; i += 2000) out.push(...((await page.evaluate(chromeExpression(cs.slice(i, i + 2000)))) as Seen[]));
        return out;
      };
      seen = await run(cases);
      plantSeen = await Promise.all(plants.map((p) => run(p.cases)));
    } finally {
      await browser.close();
    }
    const problems = judge(cases, seen);
    if (process.env['TOKEN_FUZZ_DUMP'] !== undefined) writeFileSync(process.env['TOKEN_FUZZ_DUMP'], JSON.stringify(problems.map((p) => ({ kind: p.kind, css: p.c.css, dragon: p.c.dragon, chrome: p.seen })), null, 1));
    expect(summary(problems), JSON.stringify(problems.slice(0, 20).map((p) => ({ kind: p.kind, css: p.c.css, dragon: p.c.dragon, chrome: p.seen })), null, 1)).toEqual({});
    plants.forEach((p, i) => {
      expect(p.cases.length, p.name).toBeGreaterThan(0);
      expect(judge(p.cases, plantSeen[i] as Seen[]).length, p.name).toBeGreaterThan(0);
    });
    const count = (m: FuzzMode): number => cases.filter((c) => c.mode === m).length;
    expect({ cases: cases.length, family: count('family'), custom: count('custom'), class: count('class'), keyword: count('keyword') }).toEqual({ cases: 6164, family: 1555, custom: 1450, class: 1721, keyword: 1438 });
  }, 600_000);
});
