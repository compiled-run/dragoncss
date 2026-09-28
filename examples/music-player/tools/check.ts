// pnpm run north-star:check: the north-star screen through Dragon's public compiler, every diagnostic collected.
//
// Input: snapshot.html + styles.css (verbatim), converted to the parity fixture HTML subset and read into a FrontEndResult by the
// parity fixture reader (packages/parity/src/fixture-reader.ts), exactly as the HTML parity fixtures are. Compiled with the public
// createProject, targets web and ios (minimum 15.0); android is not public before P4.
//
// Dragon treats every target-less error (unsupported element, attribute, selector, property, invalid value) as fatal to the
// per-case analysis, and does not check the declarations inside an unsupported at-rule on a fatal input. One pass over the authored
// input therefore hides whole classes of diagnostics. The check runs three passes, each offset-preserving so every CSS
// diagnostic maps back to a styles.css line:
//   A authored:    the snapshot as written, every screen state.
//   B unwrapped:   @media preludes and braces blanked (both media queries match the 390 and 412 px target viewports, so this
//                  is the cascade those devices see); @keyframes blanked and from/to renamed to unmatched classes, so every
//                  declaration inside an at-rule gets the context-free value check.
//   C context:     B, with every rule and declaration a target-less error names blanked out (repeated to a fixed point), and
//                  the tree projected to supported tags (html, body, div) with non-ui attributes dropped. This is the only way
//                  Dragon reaches its per-case checks (computed values, fonts, contextual proof) on this screen. It is a probe:
//                  rules keyed on the projected tags (nav, h1..h4, button, p, a, img, input, span) no longer match.
// Output (deterministic, no timestamps): examples/music-player/dragon/north-star-check.json. Prints the diagnostic count and
// the support percentage.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Diagnostic, FrontEndResult, Origin } from '../../../packages/dragon/src/index.ts';
import { createProject } from '../../../packages/dragon/src/index.ts';
import { fixtureToInput } from '../../../packages/parity/src/fixture-reader.ts';
import type { CssDeclaration, Span } from './css-inventory.ts';
import { inventory } from './css-inventory.ts';
import type { StateId } from './snapshot.ts';
import { examplePath, readSnapshot, STATES, stateHtml, toFixtureHtml } from './snapshot.ts';

export const OUTPUT = 'dragon/north-star-check.json';
const PROJECT_ID = 'dragon-parity';
const SUPPORTED_TAGS = new Set(['html', 'body', 'div']);

type Pass = 'A-authored' | 'B-unwrapped' | 'C-context';

type Location =
  | { readonly kind: 'css'; readonly start: number; readonly end: number; readonly line: number; readonly column: number; readonly text: string }
  | { readonly kind: 'element'; readonly id: string; readonly tag: string }
  | { readonly kind: 'unlocated'; readonly what: string };

export type CollectedDiagnostic = {
  readonly key: string;
  readonly code: string;
  readonly severity: string;
  readonly target: string | null;
  readonly location: Location;
  readonly message: string;
  /** The first pass that reported it, every pass and state that did, and whether it came as an at-rule's related entry. */
  readonly passes: readonly Pass[];
  readonly states: readonly StateId[];
  readonly viaRelated: boolean;
};

function blank(text: string, spans: readonly Span[]): string {
  const chars = [...text];
  // Spans are UTF-16 offsets; the stylesheet is ASCII, so code points and code units agree (checked below).
  for (const s of spans) for (let i = s.start; i < s.end; i++) if (chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}

function lineCol(css: string, offset: number): { line: number; column: number } {
  const before = css.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

/** Pass B's stylesheet: at-rule wrappers blanked, keyframe selectors renamed to unmatched classes, all offsets kept. */
export function unwrapAtRules(css: string, decls: readonly CssDeclaration[]): string {
  const spans: Span[] = [];
  const renames: { span: Span; text: string }[] = [];
  const seen = new Set<number>();
  for (const d of decls) {
    if (d.atRuleSpan === null) continue;
    if (d.atRule !== null && d.atRule.startsWith('@keyframes') && !renames.some((r) => r.span.start === d.selectorSpan.start)) {
      const len = d.selectorSpan.end - d.selectorSpan.start;
      renames.push({ span: d.selectorSpan, text: `.${'k'.repeat(len - 1)}` });
    }
    if (seen.has(d.atRuleSpan.start)) continue;
    seen.add(d.atRuleSpan.start);
    const open = css.indexOf('{', d.atRuleSpan.start);
    spans.push({ start: d.atRuleSpan.start, end: open + 1 }, { start: d.atRuleSpan.end - 1, end: d.atRuleSpan.end });
  }
  let out = blank(css, spans);
  for (const r of renames) out = out.slice(0, r.span.start) + r.text + out.slice(r.span.end);
  if (out.length !== css.length) throw new Error('unwrapping changed the stylesheet length');
  return out;
}

/** Pass C's tree: unsupported tags become div, non-ui attributes (except the fixture id and class) are dropped. */
export function projectTree(fixtureHtml: string): string {
  const bodyAt = fixtureHtml.indexOf('<body');
  const head = fixtureHtml.slice(0, bodyAt).replace(/<html\b[^>]*>/, (m) => `<html data-dragon-id="${(/data-dragon-id="([^"]+)"/.exec(m) as RegExpExecArray)[1] as string}">`);
  const body = fixtureHtml.slice(bodyAt).replace(/<(\/?)([a-z][a-z0-9-]*)((?:\s+[a-z][a-z0-9-]*="[^"]*")*)(\s*)>/g, (_m, close: string, tag: string, attrs: string, ws: string) => {
    const t = SUPPORTED_TAGS.has(tag) ? tag : 'div';
    const kept = [...attrs.matchAll(/\s+([a-z][a-z0-9-]*)="([^"]*)"/g)].filter((a) => a[1] === 'data-dragon-id' || a[1] === 'class' || (a[1] as string).startsWith('ui-')).map((a) => ` ${a[1]}="${a[2]}"`).join('');
    return `<${close}${t}${close === '' ? kept : ''}${ws}>`;
  });
  return head + body;
}

function withCss(fixtureHtml: string, originalCss: string, css: string): string {
  const at = fixtureHtml.indexOf(originalCss);
  if (at < 0 || css.length !== originalCss.length) throw new Error('stylesheet not found in the fixture HTML, or its length changed');
  return fixtureHtml.slice(0, at) + css + fixtureHtml.slice(at + originalCss.length);
}

function compile(html: string, id: string): { input: FrontEndResult; diagnostics: readonly Diagnostic[]; targets: Record<string, string> } {
  const input = fixtureToInput(id, html);
  const project = createProject({ projectId: PROJECT_ID, targets: { web: {}, ios: { minimum: '15.0' } } });
  const compiled = project.compile(input);
  return { input, diagnostics: compiled.diagnostics, targets: { ...compiled.targets } };
}

function locate(origin: Origin, html: string, styleStart: number, css: string): Location {
  if (origin.kind !== 'authored') return { kind: 'unlocated', what: origin.kind === 'unlocated' ? String((origin as { what?: unknown }).what ?? 'unlocated') : origin.kind };
  const { start, end } = origin.span;
  if (start >= styleStart && end <= styleStart + css.length) {
    const s = start - styleStart;
    return { kind: 'css', start: s, end: end - styleStart, ...lineCol(css, s), text: css.slice(s, end - styleStart) };
  }
  // A tree origin: an element (its own id is the first data-dragon-id in the span) or a text node (its parent's, the nearest before).
  const inside = /data-dragon-id="([^"]+)"/.exec(html.slice(start, end));
  const text = html.slice(start, end);
  if (inside !== null && text.startsWith('<')) return { kind: 'element', id: inside[1] as string, tag: (/^<([a-z0-9-]+)/.exec(text) as RegExpExecArray)[1] as string };
  const before = html.slice(0, start);
  const idAt = before.lastIndexOf('data-dragon-id="');
  const id = before.slice(idAt + 16, before.indexOf('"', idAt + 16));
  const tag = (/<([a-z0-9-]+)[^<]*$/.exec(before) as RegExpExecArray)[1] as string;
  return { kind: 'element', id: `${id} (text)`, tag };
}

const locKey = (l: Location): string => (l.kind === 'css' ? `css@${l.start}-${l.end}` : l.kind === 'element' ? `el@${l.id}` : `un@${l.what}`);

function main(): void {
  const { html, css } = readSnapshot();
  if ([...css].length !== css.length) throw new Error('styles.css is not BMP-only; offsets would drift');
  const inv = inventory(css);
  const collected = new Map<string, { d: Omit<CollectedDiagnostic, 'passes' | 'states'>; passes: Set<Pass>; states: Set<StateId> }>();
  const tagOf = new Map<string, string>();
  for (const state of STATES) for (const m of stateHtml(html, state.id).matchAll(/<([a-z][a-z0-9-]*)\b[^>]*data-dragon-id="([^"]+)"/g)) tagOf.set(m[2] as string, m[1] as string);
  const passTargets: Record<string, Record<string, string>> = {};
  const passCounts: Record<string, number> = {};
  const producerEdits = new Set<string>();

  const record = (pass: Pass, state: StateId, html: string, input: FrontEndResult, d: Diagnostic, viaRelated: boolean, message: string, code: string, target: string | null, origin: Origin): void => {
    const styleStart = html.indexOf('<style>') + '<style>'.length;
    void input;
    const found = locate(origin, html, styleStart, css);
    // Report the authored tag, not pass C's projected div.
    const location: Location = found.kind === 'element' ? { ...found, tag: tagOf.get(found.id.replace(/ \(text\)$/, '')) ?? found.tag } : found;
    const key = `${code}|${target ?? '*'}|${locKey(location)}|${message}`;
    const hit = collected.get(key);
    if (hit !== undefined) {
      hit.passes.add(pass);
      hit.states.add(state);
      return;
    }
    collected.set(key, { d: { key, code, severity: d.severity, target, location, message, viaRelated }, passes: new Set([pass]), states: new Set([state]) });
  };

  const run = (pass: Pass, state: StateId, fixture: string): { diagnostics: readonly Diagnostic[] } => {
    const { input, diagnostics, targets } = compile(fixture, `north-star-${state}-${pass}`);
    passTargets[`${pass}/${state}`] = targets;
    passCounts[`${pass}/${state}`] = diagnostics.length;
    for (const d of diagnostics) {
      if (d.code === 'DRAGON_UNSUPPORTED_AT_RULE' && pass === 'C-context') continue;
      record(pass, state, fixture, input, d, false, d.message, d.code, d.target, d.origin);
      // An unsupported at-rule's related entries are the diagnostics of the rules inside it ("CODE [target]: message").
      if (d.code === 'DRAGON_UNSUPPORTED_AT_RULE') {
        for (const r of d.related) {
          const m = /^(DRAGON_[A-Z_]+)(?: \[([a-z]+)\])?: ([\s\S]*)$/.exec(r.message);
          if (m !== null) record(pass, state, fixture, input, d, true, m[3] as string, m[1] as string, m[2] ?? null, r.origin);
        }
      }
    }
    return { diagnostics };
  };

  const unwrapped = unwrapAtRules(css, inv.declarations);
  const contextProbe: Record<string, { rounds: number; blankedRules: number; blankedDeclarations: number; residualTargetless: number }> = {};
  for (const state of STATES) {
    const fx = toFixtureHtml(stateHtml(html, state.id), css);
    for (const e of fx.edits) producerEdits.add(e);
    run('A-authored', state.id, fx.html);
    const b = run('B-unwrapped', state.id, withCss(fx.html, css, unwrapped));

    // Pass C: blank what the target-less errors of B name, to a fixed point.
    const projected = projectTree(fx.html);
    const ruleBlanks = new Map<number, Span>();
    const declBlanks = new Map<number, Span>();
    let diags = b.diagnostics;
    let fixture = '';
    let rounds = 0;
    let residual = 0;
    for (;;) {
      const styleStart = fx.html.indexOf('<style>') + '<style>'.length;
      let added = 0;
      for (const d of diags) {
        if (d.severity !== 'error' || d.target !== null || d.origin.kind !== 'authored') continue;
        const s = d.origin.span.start - styleStart;
        const e = d.origin.span.end - styleStart;
        if (s < 0 || e > css.length) continue;
        const owner = inv.declarations.find((x) => s >= x.selectorSpan.start && e <= x.selectorSpan.end);
        if (owner !== undefined) {
          if (!ruleBlanks.has(owner.ruleSpan.start)) added++;
          ruleBlanks.set(owner.ruleSpan.start, owner.ruleSpan);
          continue;
        }
        const decl = inv.declarations.find((x) => s >= x.span.start && e <= x.span.end);
        if (decl !== undefined) {
          if (!declBlanks.has(decl.span.start)) added++;
          declBlanks.set(decl.span.start, decl.span);
        }
      }
      const probeCss = blank(unwrapped, [...ruleBlanks.values(), ...declBlanks.values()]);
      fixture = withCss(projected, css, probeCss);
      rounds++;
      if (added === 0 && rounds > 1) break;
      const r = compile(fixture, `north-star-${state.id}-probe`);
      diags = r.diagnostics;
      residual = diags.filter((d) => d.severity === 'error' && d.target === null).length;
      if (residual === 0 || rounds >= 8) break;
    }
    run('C-context', state.id, fixture);
    contextProbe[state.id] = { rounds, blankedRules: ruleBlanks.size, blankedDeclarations: declBlanks.size, residualTargetless: residual };
  }

  const PASS_ORDER: readonly Pass[] = ['A-authored', 'B-unwrapped', 'C-context'];
  const STATE_ORDER = STATES.map((s) => s.id);
  const diagnostics: CollectedDiagnostic[] = [...collected.values()].map(({ d, passes, states }) => ({
    ...d,
    passes: PASS_ORDER.filter((p) => passes.has(p)),
    states: STATE_ORDER.filter((s) => states.has(s)),
  }));
  const pos = (l: Location): number => (l.kind === 'css' ? l.start : 1e9);
  diagnostics.sort((a, b) => PASS_ORDER.indexOf(a.passes[0] as Pass) - PASS_ORDER.indexOf(b.passes[0] as Pass) || pos(a.location) - pos(b.location) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Per declaration: blocked on a target when a diagnostic for it (or for every target) lands on the declaration, on its
  // rule's selector, or is an unsupported-at-rule diagnostic on its enclosing at-rule.
  const overlaps = (a: Span, l: Location): boolean => l.kind === 'css' && l.start < a.end && l.end > a.start;
  const perDeclaration = inv.declarations.map((decl) => {
    const hits = diagnostics.filter((d) => d.severity === 'error' && d.location.kind === 'css' && (
      overlaps(decl.span, d.location) || overlaps(decl.selectorSpan, d.location)
      || (d.code === 'DRAGON_UNSUPPORTED_AT_RULE' && decl.atRuleSpan !== null && d.location.start === decl.atRuleSpan.start)));
    const blocked = (t: string): boolean => hits.some((d) => d.target === null || d.target === t);
    return {
      index: decl.index, line: decl.line, selector: decl.selector.trim(), atRule: decl.atRule, property: decl.property, value: decl.value,
      web: blocked('web') ? 'blocked' : 'supported', ios: blocked('ios') ? 'blocked' : 'supported',
      codes: [...new Set(hits.map((d) => d.code))].sort(),
    };
  });
  const total = perDeclaration.length;
  const supportedBoth = perDeclaration.filter((d) => d.web === 'supported' && d.ios === 'supported').length;
  const pct = (n: number): number => Math.round((n / total) * 1000) / 10;

  // Elements of the main state.
  const elementTags = [...stateHtml(html, 'main').matchAll(/<([a-z][a-z0-9-]*)\b[^>]*data-dragon-id="([^"]+)"/g)].map((m) => ({ tag: m[1] as string, id: m[2] as string }));
  const unsupportedElementIds = new Set(diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_ELEMENT' && d.location.kind === 'element').map((d) => (d.location as { id: string }).id));
  const tags: Record<string, { count: number; supported: boolean }> = {};
  for (const e of elementTags) {
    const t = tags[e.tag] ?? { count: 0, supported: !unsupportedElementIds.has(e.id) };
    t.count++;
    tags[e.tag] = t;
  }

  const byCode: Record<string, number> = {};
  for (const d of diagnostics) byCode[`${d.code}${d.target === null ? '' : ` [${d.target}]`}`] = (byCode[`${d.code}${d.target === null ? '' : ` [${d.target}]`}`] ?? 0) + 1;
  const sortedByCode: Record<string, number> = {};
  for (const k of Object.keys(byCode).sort()) sortedByCode[k] = byCode[k] as number;

  const report = {
    schema: 'dragon-north-star-check/1',
    source: 'examples/music-player/snapshot.html + styles.css (Markless demos/music-player-ssr)',
    compiler: { entry: 'createProject (public)', targets: { web: {}, ios: { minimum: '15.0' } }, android: 'not public until P4' },
    method: {
      passes: {
        'A-authored': 'the snapshot as written, every screen state',
        'B-unwrapped': '@media and @keyframes wrappers blanked (offsets kept), so declarations inside at-rules get the context-free check',
        'C-context': 'B with target-less errors blanked to a fixed point and the tree projected to html/body/div; reaches the per-case checks',
      },
      states: STATES.map((s) => ({ id: s.id, description: s.description })),
      producerEdits: [...producerEdits].sort(),
      contextProbe,
    },
    summary: {
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((d) => d.severity === 'error').length,
      byCode: sortedByCode,
      declarations: total,
      supportedBothTargets: supportedBoth,
      supportedWeb: perDeclaration.filter((d) => d.web === 'supported').length,
      supportedIos: perDeclaration.filter((d) => d.ios === 'supported').length,
      supportPercent: pct(supportedBoth),
      elements: elementTags.length,
      supportedElements: elementTags.filter((e) => !unsupportedElementIds.has(e.id)).length,
      tags,
      targetsPerPass: passTargets,
      rawDiagnosticsPerPass: passCounts,
    },
    features: inv.features,
    declarations: perDeclaration,
    diagnostics,
  };
  mkdirSync(examplePath('dragon'), { recursive: true });
  writeFileSync(examplePath(OUTPUT), `${JSON.stringify(report, null, 1)}\n`);
  const s = report.summary;
  console.log(`north-star: ${s.diagnostics} diagnostics (${s.errors} errors) over ${STATES.length} states and 3 passes`);
  console.log(`north-star: ${s.supportedBothTargets}/${s.declarations} declarations supported on web and ios = ${s.supportPercent}% (web ${s.supportedWeb}, ios ${s.supportedIos})`);
  console.log(`north-star: ${s.supportedElements}/${s.elements} elements supported`);
  console.log(`north-star: wrote examples/music-player/${OUTPUT}`);
}

main();
