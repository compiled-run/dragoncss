// pnpm run north-star:check: the north-star screen through Dragon's public compiler, every diagnostic collected.
//
// Input: the north star as a tree fixture (examples/music-player/tree: the Markless demo's components with libraryStatus and
// isPlaying as free states, and styles.css verbatim), read into one FrontEndResult by the parity tree reader
// (packages/parity/src/tree-fixture.ts). One compile covers all 4 cases. Compiled with the public createProject, targets web,
// ios (minimum 15.0) and android (minSdk 31).
//
// Dragon treats every target-less error (unsupported element, attribute, selector, property, invalid value) as fatal to the
// per-case analysis, and does not check the declarations inside an unsupported at-rule on a fatal input. One pass over the authored
// input therefore hides whole classes of diagnostics. The check runs three passes, each offset-preserving so every CSS
// diagnostic maps back to a styles.css line:
//   A authored:    the tree and stylesheet as written.
//   B unwrapped:   @media preludes and braces blanked (both media queries match the 390 and 412 px target viewports, so this
//                  is the cascade those devices see); @keyframes blanked and from/to renamed to unmatched classes, so every
//                  declaration inside an at-rule gets the context-free value check.
//   C context:     B, with every rule and declaration a target-less error names blanked out (repeated to a fixed point), and
//                  the tree projected to supported tags (the compiler's element table), keeping only the attributes Dragon accepts.
//                  This is the only way Dragon reaches its per-case checks (computed values, fonts, contextual proof) on this
//                  screen. It is a probe: rules keyed on the projected tags (button, a, img, input, span) no longer match.
// Output (deterministic, no timestamps): examples/music-player/dragon/north-star-check.json, with per-target counts. Prints the
// diagnostic count and the support percentage, which leaves out the declarations not applicable on native (NA-NATIVE).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Diagnostic, FrontEndResult, Origin, TreeNode } from '../../../packages/dragon/src/index.ts';
import { createProject } from '../../../packages/dragon/src/index.ts';
import { SUPPORTED_TAGS } from '../../../packages/dragon/src/analysis/elements.ts';
import { attributeRefusal } from '../../../packages/dragon/src/attributes.ts';
import { authoredModel } from '../../../packages/parity/src/render.ts';
import type { TreeFixtureFile } from '../../../packages/parity/src/tree-fixture.ts';
import { readTreeFixtureDir } from '../../../packages/parity/src/tree-fixture.ts';
import { hitsOf, statusOn, supportNumbers } from '../../../packages/parity/src/north-star-accounting.ts';
import type { CssDeclaration, Span } from './css-inventory.ts';
import { inventory } from './css-inventory.ts';
import { FONTS, pinnedFaceSrcs } from './font-map.ts';
import { examplePath, readSnapshot } from './snapshot.ts';

export const OUTPUT = 'dragon/north-star-check.json';
const PROJECT_ID = 'dragon-parity';
const TREE_DIR = 'examples/music-player/tree';
/** The stylesheet's path in the tree fixture's source list. */
const STYLES_SOURCE = '../styles.css';
const TARGETS = { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;
const TARGET_IDS = ['web', 'ios', 'android'] as const;
/**
 * The files of the north star's font map (tools/font-map.ts, T033, T036): Lato 2.015 Regular and Bold, and the five static
 * Inter 4.1 faces of "Dragon Sans". The files enter the snapshot as assets named by their repository path.
 */
const FONT_FILES = ['Lato/Lato-Regular.ttf', 'Lato/Lato-Bold.ttf', 'Inter/Inter-Light.ttf', 'Inter/Inter-Regular.ttf', 'Inter/Inter-Italic.ttf', 'Inter/Inter-Bold.ttf', 'Inter/Inter-BoldItalic.ttf'] as const;
const asset = (file: string): string => `vendor/fonts/${file}`;
export { FONTS };
if ([...FONT_FILES].map(asset).sort().join() !== [...pinnedFaceSrcs(FONTS)].sort().join()) throw new Error('FONT_FILES must list exactly the pinned faces of FONTS');
const FONT_ASSETS = FONT_FILES.map((file) => {
  const bytes = new Uint8Array(readFileSync(new URL(`../../../${asset(file)}`, import.meta.url)));
  return { id: asset(file), hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes };
});
type TargetId = (typeof TARGET_IDS)[number];

type Pass = 'A-authored' | 'B-unwrapped' | 'C-context';

type Location =
  | { readonly kind: 'css'; readonly start: number; readonly end: number; readonly line: number; readonly column: number; readonly text: string }
  | { readonly kind: 'element'; readonly id: string; readonly tag: string }
  | { readonly kind: 'source'; readonly file: string; readonly text: string }
  | { readonly kind: 'unlocated'; readonly what: string };

export type CollectedDiagnostic = {
  readonly key: string;
  readonly code: string;
  readonly severity: string;
  readonly target: string | null;
  readonly location: Location;
  readonly message: string;
  /** The first pass that reported it, every pass that did, and whether it came as an at-rule's related entry. */
  readonly passes: readonly Pass[];
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
  const seen = new Set<number>();
  for (const d of decls) {
    // ANIM-b1 accepts @keyframes at the top level, so only conditional wrappers are blanked.
    if (d.atRuleSpan === null || (d.atRule !== null && d.atRule.startsWith('@keyframes'))) continue;
    if (seen.has(d.atRuleSpan.start)) continue;
    seen.add(d.atRuleSpan.start);
    const open = css.indexOf('{', d.atRuleSpan.start);
    spans.push({ start: d.atRuleSpan.start, end: open + 1 }, { start: d.atRuleSpan.end - 1, end: d.atRuleSpan.end });
  }
  const out = blank(css, spans);
  if (out.length !== css.length) throw new Error('unwrapping changed the stylesheet length');
  return out;
}

/** Pass C's tree: unsupported tags become div; only the attributes Dragon accepts on the projected tag are kept. */
export function projectTree(spec: TreeFixtureFile): TreeFixtureFile {
  type Spec = { el?: string; attr?: readonly { name: string }[]; children?: readonly Spec[]; then?: readonly Spec[]; else?: readonly Spec[]; slots?: Record<string, readonly Spec[]> };
  const node = (n: Spec): Spec => {
    const out: Spec = { ...n };
    if (n.el !== undefined) {
      const tag = SUPPORTED_TAGS.has(n.el) ? n.el : 'div';
      out.el = tag;
      if (n.attr !== undefined) out.attr = n.attr.filter((a) => attributeRefusal(tag, a.name) === null);
    }
    if (n.children !== undefined) out.children = n.children.map(node);
    if (n.then !== undefined) out.then = n.then.map(node);
    if (n.else !== undefined) out.else = n.else.map(node);
    if (n.slots !== undefined) out.slots = Object.fromEntries(Object.entries(n.slots).map(([k, v]) => [k, v.map(node)]));
    return out;
  };
  return { ...spec, components: spec.components.map((c) => ({ ...c, root: (c.root as readonly Spec[]).map(node) as unknown as typeof c.root })) };
}

function compile(id: string, css: string, projected: boolean): { input: FrontEndResult; diagnostics: readonly Diagnostic[]; targets: Record<string, string> } {
  const read = readTreeFixtureDir(TREE_DIR, id, { text: (file, text) => (file === STYLES_SOURCE ? css : text), ...(projected ? { spec: projectTree } : {}) });
  const input: FrontEndResult = { ...read, snapshot: { ...read.snapshot, assets: [...read.snapshot.assets, ...FONT_ASSETS] } };
  const compiled = createProject({ projectId: PROJECT_ID, targets: TARGETS, fonts: FONTS }).compile(input);
  return { input, diagnostics: compiled.diagnostics, targets: { ...compiled.targets } };
}

const isStyles = (uri: string): boolean => uri.endsWith('/examples/music-player/styles.css');

/** Every element template node of the tree, keyed by the spans that point at it (its own and its attributes'). */
function elementSpans(input: FrontEndResult): Map<string, { id: string; tag: string }> {
  const out = new Map<string, { id: string; tag: string }>();
  const key = (o: Origin): string | null => (o.kind === 'authored' ? `${o.span.source.uri}@${o.span.start}-${o.span.end}` : null);
  const visit = (component: string, nodes: readonly TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'element') {
        const at = { id: `${component}/${n.id}`, tag: n.tag };
        for (const o of [n.origin, ...n.attributes.map((a) => a.origin)]) {
          const k = key(o);
          if (k !== null && !out.has(k)) out.set(k, at);
        }
        visit(component, n.children);
      } else if (n.kind === 'branch') {
        visit(component, n.then);
        visit(component, n.else);
      } else if (n.kind === 'call') for (const s of n.slots) visit(component, s.children);
    }
  };
  for (const c of input.tree?.components ?? []) visit(c.id, c.root);
  return out;
}

function locate(origin: Origin, input: FrontEndResult, css: string, elements: Map<string, { id: string; tag: string }>): Location {
  if (origin.kind !== 'authored') return { kind: 'unlocated', what: origin.kind === 'unlocated' ? String((origin as { reason?: unknown }).reason ?? 'unlocated') : origin.kind };
  const { start, end, source } = origin.span;
  if (isStyles(source.uri)) return { kind: 'css', start, end, ...lineCol(css, start), text: css.slice(start, end) };
  const el = elements.get(`${source.uri}@${start}-${end}`);
  if (el !== undefined) return { kind: 'element', ...el };
  const file = input.snapshot.sources.find((s) => s.ref.uri === source.uri);
  return { kind: 'source', file: file?.displayPath ?? source.uri, text: file === undefined ? '' : file.text.slice(start, end) };
}

const locKey = (l: Location): string => (l.kind === 'css' ? `css@${l.start}-${l.end}` : l.kind === 'element' ? `el@${l.id}` : l.kind === 'source' ? `src@${l.file}:${l.text}` : `un@${l.what}`);
const applies = (target: string | null, t: TargetId): boolean => target === null || target === t;

function main(): void {
  const { css } = readSnapshot();
  if ([...css].length !== css.length) throw new Error('styles.css is not BMP-only; offsets would drift');
  const inv = inventory(css);
  const collected = new Map<string, { d: Omit<CollectedDiagnostic, 'passes'>; passes: Set<Pass> }>();
  const passTargets: Record<string, Record<string, string>> = {};
  const passCounts: Record<string, number> = {};

  const record = (pass: Pass, location: Location, severity: string, viaRelated: boolean, message: string, code: string, target: string | null): void => {
    const key = `${code}|${target ?? '*'}|${locKey(location)}|${message}`;
    const hit = collected.get(key);
    if (hit !== undefined) {
      hit.passes.add(pass);
      return;
    }
    collected.set(key, { d: { key, code, severity, target, location, message, viaRelated }, passes: new Set([pass]) });
  };

  const run = (pass: Pass, sheet: string, projected: boolean): { diagnostics: readonly Diagnostic[] } => {
    const { input, diagnostics, targets } = compile(`north-star-${pass}`, sheet, projected);
    const elements = elementSpans(input);
    passTargets[pass] = targets;
    passCounts[pass] = diagnostics.length;
    for (const d of diagnostics) {
      if (d.code === 'DRAGON_UNSUPPORTED_AT_RULE' && pass === 'C-context') continue;
      record(pass, locate(d.origin, input, css, elements), d.severity, false, d.message, d.code, d.target);
      // An unsupported at-rule's related entries are the diagnostics of the rules inside it ("CODE [target]: message").
      if (d.code === 'DRAGON_UNSUPPORTED_AT_RULE') {
        for (const r of d.related) {
          const m = /^(DRAGON_[A-Z_]+)(?: \[([a-z]+)\])?: ([\s\S]*)$/.exec(r.message);
          if (m === null) throw new Error(`unreadable related entry of ${d.message}: ${r.message}`);
          record(pass, locate(r.origin, input, css, elements), d.severity, true, m[3] as string, m[1] as string, m[2] ?? null);
        }
      }
    }
    return { diagnostics };
  };

  run('A-authored', css, false);
  const unwrapped = unwrapAtRules(css, inv.declarations);
  const b = run('B-unwrapped', unwrapped, false);

  // Pass C: blank what the target-less errors of B name, to a fixed point.
  const ruleBlanks = new Map<number, Span>();
  const declBlanks = new Map<number, Span>();
  let diags = b.diagnostics;
  let probeCss = unwrapped;
  let rounds = 0;
  let residual = 0;
  for (;;) {
    let added = 0;
    for (const d of diags) {
      if (d.severity !== 'error' || d.target !== null || d.origin.kind !== 'authored' || !isStyles(d.origin.span.source.uri)) continue;
      const s = d.origin.span.start;
      const e = d.origin.span.end;
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
    probeCss = blank(unwrapped, [...ruleBlanks.values(), ...declBlanks.values()]);
    rounds++;
    if (added === 0 && rounds > 1) break;
    const r = compile('north-star-probe', probeCss, true);
    diags = r.diagnostics;
    residual = diags.filter((d) => d.severity === 'error' && d.target === null).length;
    if (residual === 0 || rounds >= 8) break;
  }
  run('C-context', probeCss, true);
  const contextProbe = { rounds, blankedRules: ruleBlanks.size, blankedDeclarations: declBlanks.size, residualTargetless: residual };

  const PASS_ORDER: readonly Pass[] = ['A-authored', 'B-unwrapped', 'C-context'];
  const diagnostics: CollectedDiagnostic[] = [...collected.values()].map(({ d, passes }) => ({ ...d, passes: PASS_ORDER.filter((p) => passes.has(p)) }));
  const pos = (l: Location): number => (l.kind === 'css' ? l.start : 1e9);
  diagnostics.sort((a, b) => PASS_ORDER.indexOf(a.passes[0] as Pass) - PASS_ORDER.indexOf(b.passes[0] as Pass) || pos(a.location) - pos(b.location) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Per declaration: blocked, not-applicable (NA-NATIVE) or supported on each target (parity/src/north-star-accounting.ts).
  const accounted = diagnostics.map((d) => ({ code: d.code, severity: d.severity, target: d.target, css: d.location.kind === 'css' ? d.location : null }));
  const perDeclaration = inv.declarations.map((decl: CssDeclaration) => {
    const hits = hitsOf(decl, accounted);
    const errors = hits.filter((d) => d.severity === 'error');
    return {
      index: decl.index, line: decl.line, selector: decl.selector.trim(), atRule: decl.atRule, property: decl.property, value: decl.value,
      web: statusOn(hits, 'web'), ios: statusOn(hits, 'ios'), android: statusOn(hits, 'android'),
      codes: [...new Set(errors.map((d) => d.code))].sort(),
    };
  });
  const numbers = supportNumbers(perDeclaration);

  // Elements of the initial case, rendered from the tree.
  const input = readTreeFixtureDir(TREE_DIR, 'north-star');
  const model = authoredModel(input);
  const initial = model.render(model.assignments[model.initialIndex] ?? [], { kind: 'authored' });
  const elementTags = [...initial.matchAll(/<([a-z][a-z0-9-]*) data-dragon-id="([^"]+)"/g)].map((m) => ({ tag: m[1] as string, id: m[2] as string }));
  const tags: Record<string, { count: number; supported: boolean }> = {};
  for (const e of elementTags) {
    const t = tags[e.tag] ?? { count: 0, supported: SUPPORTED_TAGS.has(e.tag) };
    t.count++;
    tags[e.tag] = t;
  }

  const sortKeys = (r: Record<string, number>): Record<string, number> => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k] as number]));
  const byCode: Record<string, number> = {};
  for (const d of diagnostics) byCode[`${d.code}${d.target === null ? '' : ` [${d.target}]`}`] = (byCode[`${d.code}${d.target === null ? '' : ` [${d.target}]`}`] ?? 0) + 1;
  // Per target: every diagnostic that applies to it (its own and the target-less ones), by severity and code.
  const perTarget = Object.fromEntries(TARGET_IDS.map((t) => {
    const count = (severity: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const d of diagnostics) if (d.severity === severity && applies(d.target, t)) out[d.code] = (out[d.code] ?? 0) + 1;
      return sortKeys(out);
    };
    return [t, { errors: count('error'), warnings: count('warning'), infos: count('info') }];
  }));

  const report = {
    schema: 'dragon-north-star-check/3',
    source: 'examples/music-player/tree (the Markless demos/music-player-ssr components as a dragon/tree@0 fixture) + styles.css',
    compiler: { entry: 'createProject (public)', targets: TARGETS, fonts: { map: FONTS, assets: FONT_ASSETS.map((a) => ({ id: a.id, hash: a.hash })) } },
    method: {
      passes: {
        'A-authored': 'the tree and stylesheet as written, all cases in one compile',
        'B-unwrapped': '@media wrappers blanked (offsets kept), so declarations inside them get the context-free check',
        'C-context': 'B with target-less errors blanked to a fixed point and the tree projected to supported tags and accepted attributes; reaches the per-case checks',
      },
      cases: model.assignments.length,
      freeStates: model.free.map((f) => `${f.instance}.${f.state}`),
      contextProbe,
    },
    summary: {
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((d) => d.severity === 'error').length,
      byCode: sortKeys(byCode),
      perTarget,
      ...numbers,
      elements: elementTags.length,
      supportedElements: elementTags.filter((e) => SUPPORTED_TAGS.has(e.tag)).length,
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
  console.log(`north-star: ${s.diagnostics} diagnostics (${s.errors} errors) over ${report.method.cases} cases and 3 passes`);
  console.log(`north-star: ${s.supportedBothTargets}/${s.applicableDeclarations} applicable declarations supported on web and ios = ${s.supportPercent}% (web ${s.supportedWeb}, ios ${s.supportedIos}, android ${s.supportedAndroid}; ${s.notApplicableNative} of ${s.declarations} not applicable on native)`);
  console.log(`north-star: ${s.supportedElements}/${s.elements} elements supported`);
  for (const t of TARGET_IDS) console.log(`north-star: ${t} errors ${JSON.stringify(perTarget[t]?.errors)}`);
  console.log(`north-star: wrote examples/music-player/${OUTPUT}`);
}

main();
