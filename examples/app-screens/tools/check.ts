// Compiles each app screen for web, ios and android through the public createProject, and collects every diagnostic.
// A target-less error stops Dragon's per-case analysis, so one compile hides most refusals. The check repeats: it neutralises
// what each error names (blanks the declaration or the rule in the stylesheet, retags an unsupported element as a div, drops an
// unsupported attribute) and compiles again, until no target-less error is left (or none can be neutralised). Every diagnostic from every round is kept.
// Prints how many screens compile on iOS and Android and each screen's refusals; it reports and never fails.
// Usage: pnpm app-screens [--ahem] [screen ...] (--ahem also writes out/<screen>.ahem.json, every font set to Ahem)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Diagnostic, FontMap } from '../../../packages/dragon/src/index.ts';
import { createProject } from '../../../packages/dragon/src/index.ts';
import { fixtureToInput, parseFixtureHtml } from '../../../packages/parity/src/fixture-reader.ts';
import { declarations } from './inventory.ts';
import { blockersOf } from './blockers.ts';
import { readPage } from './page.ts';

const TARGETS = { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;
const TARGET_IDS = ['web', 'ios', 'android'] as const;
type T = (typeof TARGET_IDS)[number];
const V = 'vendor/fonts/';
/** The font map a framework would ship as its default: Dragon's recommended map (docs/api.md, Fonts). */
const FONTS: FontMap = {
  generics: {
    'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [
      { src: `${V}Inter/Inter-Light.ttf`, weight: '300' }, { src: `${V}Inter/Inter-Regular.ttf`, weight: '400' },
      { src: `${V}Inter/Inter-Italic.ttf`, weight: '400', style: 'italic' }, { src: `${V}Inter/Inter-Bold.ttf`, weight: '700' },
      { src: `${V}Inter/Inter-BoldItalic.ttf`, weight: '700', style: 'italic' },
    ] },
    monospace: { mode: 'pinned', family: 'Dragon Mono', faces: [{ src: `${V}NotoSansMono/NotoSansMono-Regular.ttf` }] },
    'system-ui': { mode: 'platform' },
  },
};
const PINNED = [...new Set(Object.values(FONTS.generics).flatMap((e) => (e?.mode === 'pinned' ? e.faces.map((f) => f.src) : [])))];
/** Page images: copies of the music player's 1280x720 cover stand-ins, served to Chrome from pages/img. */
const IMAGES = Object.fromEntries(['hero', 'avatar', 'diagram'].map((n) => [`img/${n}.png`, `examples/app-screens/pages/img/${n}.png`]));
const fileAsset = (id: string) => {
  const bytes = new Uint8Array(readFileSync(id));
  return { id, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes };
};
const EXTRA_ASSETS = [...PINNED, ...Object.values(IMAGES)].map(fileAsset);

export type Found = { code: string; severity: string; target: string | null; where: string; line: number | null; message: string; round: number };

function compile(id: string, html: string) {
  const read = fixtureToInput(id, html);
  const input = { ...read, snapshot: { ...read.snapshot, assets: [...read.snapshot.assets, ...EXTRA_ASSETS] } };
  return createProject({ projectId: 'dragon-parity', targets: TARGETS, fonts: FONTS, images: IMAGES }).compile(input);
}

const blank = (s: string, a: number, b: number): string => s.slice(0, a) + s.slice(a, b).replace(/[^\n]/g, ' ') + s.slice(b);

/**
 * The Ahem probe: native targets lay out only Ahem until real faces are device-proven, and that refusal lands on every text node,
 * which hides the rest. This mode drops @font-face, sets every font-family to Ahem, and leaves the rest of the page as written.
 */
export function ahemPage(html: string): string {
  return html.replace(/@font-face\s*\{[^}]*\}/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/font-family:\s*[^;}]+/g, (m) => `font-family: Ahem${' '.repeat(Math.max(0, m.length - 'font-family: Ahem'.length))}`);
}

export function checkPage(id: string, mode: 'authored' | 'ahem' = 'authored') {
  const original = mode === 'ahem' ? ahemPage(readPage(`examples/app-screens/pages/${id}.html`)) : readPage(`examples/app-screens/pages/${id}.html`);
  let html = original;
  const found = new Map<string, Found>();
  const firstOutputs: Record<string, string> = {};
  const firstTargets: Record<string, string> = {};
  let lastOutputs: Record<string, string> = {};
  let residual = 0;
  let round = 0;
  for (;;) {
    round++;
    const r = compile(id, html);
    if (round === 1) for (const t of TARGET_IDS) {
      firstOutputs[t] = r.outputs[t].kind;
      firstTargets[t] = r.targets[t];
    }
    lastOutputs = Object.fromEntries(TARGET_IDS.map((t) => [t, r.outputs[t].kind]));
    residual = r.diagnostics.filter((d) => d.severity === 'error' && d.target === null).length;
    const style = parseFixtureHtml(html).style;
    if (style === null) throw new Error(`${id}: a screen needs exactly one <style>`);
    const css = html.slice(style.start, style.end);
    const inv = { declarations: declarations(css) };
    const edits: { kind: 'css'; a: number; b: number }[] = [];
    const tagEdits: { kind: 'retag' | 'drop-attr' | 'remove'; at: number; name?: string }[] = [];
    const all: { d: Diagnostic | { code: string; target: string | null; severity: string; message: string; origin: Diagnostic['origin'] }; }[] = [];
    for (const d of r.diagnostics) {
      all.push({ d });
      if (d.code === 'DRAGON_UNSUPPORTED_AT_RULE') for (const rel of d.related) {
        const m = /^(DRAGON_[A-Z_]+)(?: \[([a-z]+)\])?: ([\s\S]*)$/.exec(rel.message);
        if (m !== null) all.push({ d: { code: m[1]!, target: m[2] ?? null, severity: d.severity, message: m[3]!, origin: rel.origin } });
      }
    }
    let added = 0;
    for (const { d } of all) {
      const o = d.origin;
      let where: string = o.kind;
      let line: number | null = null;
      if (o.kind === 'authored') {
        const { start, end } = o.span;
        where = html.slice(start, Math.min(end, start + 140)).replace(/\s+/g, ' ');
        if (start >= style.start && end <= style.end) line = original.slice(0, start).split('\n').length;
      }
      const key = `${d.code}|${d.target ?? '*'}|${where}|${d.message}`;
      if (!found.has(key)) found.set(key, { code: d.code, severity: d.severity, target: d.target, where, line, message: d.message, round });
      // Only target-less errors stop the per-case analysis; a target's own error is kept, never neutralised.
      if (d.severity !== 'error' || d.target !== null || o.kind !== 'authored') continue;
      const s = o.span.start - style.start;
      const e = o.span.end - style.start;
      if (s >= 0 && e <= css.length) {
        const sel = inv.declarations.find((x) => s >= x.selectorSpan.start && e <= x.selectorSpan.end);
        const decl = inv.declarations.find((x) => s >= x.span.start && e <= x.span.end);
        const at = inv.declarations.find((x) => x.atRuleSpan !== null && s === x.atRuleSpan.start);
        if (sel !== undefined) edits.push({ kind: 'css', ...{ a: sel.ruleSpan.start, b: sel.ruleSpan.end } });
        else if (decl !== undefined) edits.push({ kind: 'css', a: decl.span.start, b: decl.span.end });
        else if (at !== undefined) edits.push({ kind: 'css', a: at.atRuleSpan!.start, b: at.atRuleSpan!.end });
        else {
          // A span with no declaration, such as an @font-face or a whole rule: blank it.
          edits.push({ kind: 'css', a: s, b: e });
        }
      } else {
        const tag = /^<([a-z][a-z0-9-]*)/.exec(html.slice(o.span.start))?.[1];
        const attr = /^attribute (\S+) on /.exec(d.message)?.[1];
        if (d.code === 'DRAGON_UNSUPPORTED_ATTRIBUTE' && attr !== undefined) tagEdits.push({ kind: 'drop-attr', at: o.span.start, name: attr });
        else if (tag !== undefined && tag !== 'div' && tag !== 'html' && tag !== 'body') tagEdits.push({ kind: ['img', 'input', 'br', 'hr'].includes(tag) ? 'remove' : 'retag', at: o.span.start });
        else if (tag !== undefined) {
          // An error on a supported element (font, context): nothing to neutralise in the tree, so blank the whole rule set that matched? Leave it.
        }
      }
    }
    let next = html;
    // CSS edits keep offsets; apply them first.
    let cssNext = css;
    for (const x of edits) {
      const before = cssNext;
      cssNext = blank(cssNext, x.a, x.b);
      if (cssNext !== before) added++;
    }
    next = html.slice(0, style.start) + cssNext + html.slice(style.end);
    // Tree edits from the end backwards, so earlier offsets hold.
    const seen = new Set<string>();
    for (const x of [...tagEdits].sort((a, b) => b.at - a.at)) {
      const k = `${x.kind}@${x.at}@${x.name ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const open = /^<([a-z][a-z0-9-]*)([^>]*)>/.exec(next.slice(x.at))!;
      if (x.kind === 'drop-attr') {
        const attrs = open[2]!.replace(new RegExp(`\\s${x.name}="[^"]*"`), '');
        if (attrs !== open[2]) { next = `${next.slice(0, x.at)}<${open[1]}${attrs}>${next.slice(x.at + open[0].length)}`; added++; }
      } else if (x.kind === 'remove') {
        next = next.slice(0, x.at) + next.slice(x.at + open[0].length);
        added++;
      } else {
        const tag = open[1]!;
        // Retag the start tag and its matching end tag (depth counted over the same tag name).
        let depth = 0;
        const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
        re.lastIndex = x.at;
        let m: RegExpExecArray | null;
        let close = -1;
        while ((m = re.exec(next)) !== null) {
          depth += m[1] === '' ? 1 : -1;
          if (depth === 0) { close = m.index; break; }
        }
        if (close < 0) throw new Error(`no end tag for <${tag}> at ${x.at}`);
        next = `${next.slice(0, close)}</div>${next.slice(close + tag.length + 3)}`;
        next = `${next.slice(0, x.at)}<div${open[2]}>${next.slice(x.at + open[0].length)}`;
        added++;
      }
    }
    html = next;
    if (added === 0 || round >= 20) break;
  }
  // residualTargetless > 0: errors the check could not neutralise still hide per-case refusals, so the list is a lower bound.
  return { id, mode, rounds: round, residualTargetless: residual, firstTargets, firstOutputs, lastOutputs, found: [...found.values()] };
}

export const SCREENS = ['onboarding', 'settings', 'signup', 'article', 'feed'] as const;

/** A screen compiles on a target when its authored input has no error for that target (Dragon checks it, not blocks it). */
const compiles = (res: ReturnType<typeof checkPage>, t: T): boolean => res.firstTargets[t] === 'checked';

function main(): void {
  const args = process.argv.slice(2);
  const ahem = args.includes('--ahem');
  const pages = args.filter((a) => a !== '--ahem');
  const screens = pages.length > 0 ? pages : [...SCREENS];
  const unknown = screens.filter((p) => !(SCREENS as readonly string[]).includes(p));
  if (unknown.length > 0) throw new Error(`unknown screen ${unknown.join(', ')}; screens: ${SCREENS.join(', ')}`);
  mkdirSync('examples/app-screens/out', { recursive: true });
  const results = screens.map((p) => {
    const res = checkPage(p, 'authored');
    writeFileSync(`examples/app-screens/out/${p}.json`, `${JSON.stringify(res, null, 1)}\n`);
    if (ahem) writeFileSync(`examples/app-screens/out/${p}.ahem.json`, `${JSON.stringify(checkPage(p, 'ahem'), null, 1)}\n`);
    return res;
  });
  const n = (t: T): number => results.filter((r) => compiles(r, t)).length;
  console.log(`${n('ios')} of ${results.length} screens compile on iOS / ${n('android')} of ${results.length} on Android`);
  for (const res of results) {
    const ios = blockersOf(res.found, 'ios');
    const android = blockersOf(res.found, 'android');
    const status = (t: T): string => (compiles(res, t) ? 'compiles' : 'blocked');
    const errors = (b: Map<string, { count: number }>): number => [...b.values()].reduce((a, v) => a + v.count, 0);
    console.log(`\n${res.id}: iOS ${status('ios')} (${errors(ios)} errors), Android ${status('android')} (${errors(android)} errors)`);
    if (res.residualTargetless > 0) console.log(`  (lower bound: ${res.residualTargetless} target-less errors could not be neutralised and hide later checks)`);
    for (const [k, v] of [...ios].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))) console.log(`  ${String(v.count).padStart(3)}  ${k}${android.has(k) ? '' : ' (iOS only)'}`);
    for (const k of [...android.keys()].filter((k) => !ios.has(k)).sort()) console.log(`  ${String(android.get(k)?.count).padStart(3)}  ${k} (Android only)`);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
