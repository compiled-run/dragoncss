// E2 compiler seams (docs/research/coverage-roadmap.md §3): the split of css/stylesheet.ts, css/properties.ts,
// analysis/resolve.ts and the parity FIXTURES list is behaviour-preserving. These pins were taken at 4c1331c, before the split.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beats, cascadeGroups, substituteVariables } from '../src/analysis/resolve.ts';
import type { Candidate } from '../src/analysis/resolve.ts';
import { acceptFontFace, AT_RULE_HANDLERS, atRuleHandler, mediaAtRule, refuseAtRule } from '../src/css/at-rules.ts';
import { keyframesAtRule } from '../src/css/at-rules/keyframes.ts';
import { propertyAtRule } from '../src/css/at-rules/property.ts';
import type { AtRuleContext } from '../src/css/at-rules.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS, PROPERTY_ROLE, SHORTHANDS, SHORTHANDS_MOVED } from '../src/css/properties.ts';
import type { Longhand } from '../src/css/properties.ts';
import { SHORTHAND_HANDLERS } from '../src/css/shorthands/index.ts';
import type { Declaration, EnclosedRules } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { lengthFeatureType, UNITS } from '../src/css/units.ts';
import { featureOf } from '../src/css/values.ts';
import type { Diagnostic } from '../src/types.ts';
import { floorProblems } from './floor.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const FLOOR = new URL('./seams-floor.json', import.meta.url);
const PROPERTIES_DIR = new URL('../src/css/properties/', import.meta.url);
const AGGREGATE = readFileSync(new URL('../src/css/properties.ts', import.meta.url), 'utf8');
/** Every export of every properties/<family>.ts module. */
const FAMILY_EXPORTS: Record<string, unknown> = Object.assign({}, ...(await Promise.all(readdirSync(PROPERTIES_DIR).filter((f) => f.endsWith('.ts')).map((f) => import(new URL(f, PROPERTIES_DIR).href)))) as Record<string, unknown>[]);
/** What an aggregate block may spread: the family modules' exports and the aggregate's own. */
const SPREADABLE: Record<string, unknown> = { ...FAMILY_EXPORTS, ...((await import('../src/css/properties.ts')) as Record<string, unknown>) };
const BLOCKS = ['LONGHANDS = [', 'SHORTHANDS = [', 'INHERITED: ReadonlySet<Longhand> = new Set<Longhand>([', 'PROPERTY_ASPECTS: { readonly [P in Longhand]: PropertyAspect } = {', 'CONTAINER_LONGHANDS: readonly Longhand[] = [', 'TEXT_ROLE_LONGHANDS: readonly Longhand[] = ['];
const SUFFIX: Record<string, string> = { [BLOCKS[0] as string]: 'LONGHANDS', [BLOCKS[1] as string]: 'SHORTHANDS', [BLOCKS[2] as string]: 'INHERITED', [BLOCKS[3] as string]: 'ASPECTS', [BLOCKS[4] as string]: 'CONTAINER', [BLOCKS[5] as string]: 'TEXT_ROLE' };
/** The lists properties.ts registers for an aggregate block, in table order: the block's column of each family(...) line of FAMILIES. */
function spreads(block: string): string[] {
  const column = BLOCKS.indexOf(block);
  const start = AGGREGATE.indexOf('const FAMILIES = [');
  if (column < 0 || start < 0) throw new Error(`no ${block} column or no FAMILIES block in properties.ts`);
  const body = AGGREGATE.slice(start, AGGREGATE.indexOf('\n]', start));
  const rows = [...body.matchAll(/^ {2}family\('([a-z-]+)', (.+)\),$/gm)].map((m) => ({ id: m[1] as string, args: (m[2] as string).split(', ') }));
  if (rows.some((r) => r.args.length !== BLOCKS.length)) throw new Error('a family(...) line of properties.ts does not name six lists');
  const moved = rows.filter((r) => r.id === SHORTHANDS_MOVED.family);
  const ordered = column === 1 ? rows.filter((r) => r.id !== SHORTHANDS_MOVED.family).flatMap((r) => (r.id === SHORTHANDS_MOVED.after ? [r, ...moved] : [r])) : rows;
  return ordered.map((r) => r.args[column] as string).filter((a) => a !== '[]');
}
/** The families an aggregate block spreads, in order. */
const spreadOrder = (block: string): string[] => spreads(block).map((id) => id.replace(/_(?:LONGHANDS|SHORTHANDS|INHERITED|ASPECTS|CONTAINER|TEXT_ROLE)$/, ''));
/** A registry list against its families: the concatenation of the lists it spreads, in order, every family module's list spread once. */
function registryProblems(block: string, name: string, actual: readonly string[]): string[] {
  const suffix = SUFFIX[block] as string;
  const ids = spreads(block);
  const lists = Object.entries(FAMILY_EXPORTS).filter(([k, v]) => k.endsWith(`_${suffix}`) && Array.isArray(v) && !/_RESET_/.test(k));
  const problems = lists.map(([k]) => k).filter((k) => ids.filter((i) => i === k).length !== 1).map((k) => `${name}: ${k} is spread ${ids.filter((i) => i === k).length} times`);
  const want = ids.flatMap((id) => (Array.isArray(SPREADABLE[id]) ? (SPREADABLE[id] as readonly string[]) : [`<${id} is not an exported list>`]));
  if (JSON.stringify([...actual]) !== JSON.stringify(want)) problems.push(`${name} is not its families in spread order: ${JSON.stringify(actual)} vs ${JSON.stringify(want)}`);
  return problems;
}

describe('E2 seams: the property registry', () => {
  // PIN-DERIVE: the orders are derived from properties/<family>.ts and the aggregate's spread order, and seams-floor.json keeps
  // every name these lists held (taken from the 4c1331c pins and every family since), in order: a family may add names anywhere,
  // but dropping or reordering one fails.
  it('LONGHANDS is its families spread in aggregate order, with every floor longhand kept in order', () => {
    expect(registryProblems('LONGHANDS = [', 'LONGHANDS', LONGHANDS)).toEqual([]);
    expect(floorProblems(FLOOR, 'longhands', LONGHANDS, true)).toEqual([]);
  });
  it('SHORTHANDS is its families spread in aggregate order, with every floor shorthand kept in order', () => {
    expect(registryProblems('SHORTHANDS = [', 'SHORTHANDS', SHORTHANDS)).toEqual([]);
    expect(floorProblems(FLOOR, 'shorthands', SHORTHANDS, true)).toEqual([]);
  });
  it('PROPERTY_ASPECTS keys follow LONGHANDS, and INHERITED and PROPERTY_ROLE keep every floor entry in order', () => {
    expect(Object.keys(PROPERTY_ASPECTS)).toEqual([...LONGHANDS]);
    expect(registryProblems('INHERITED: ReadonlySet<Longhand> = new Set<Longhand>([', 'INHERITED', [...INHERITED])).toEqual([]);
    expect(floorProblems(FLOOR, 'inherited', [...INHERITED], true)).toEqual([]);
    const byRole = (r: string): string[] => LONGHANDS.filter((p) => PROPERTY_ROLE[p] === r);
    for (const r of ['item', 'container', 'text', 'paint']) expect(floorProblems(FLOOR, `role:${r}`, byRole(r), true), r).toEqual([]);
    // Exact for every floor longhand: it keeps the one role whose floor holds it, and is inherited exactly when the inherited
    // floor holds it, so a longhand moving into a role or into INHERITED fails too; only a new longhand may take any.
    const floors = JSON.parse(readFileSync(FLOOR, 'utf8')) as Record<string, readonly string[]>;
    const moved = (floors['longhands'] ?? []).flatMap((p) => {
      const roles = ['item', 'container', 'text', 'paint'].filter((r) => floors[`role:${r}`]?.includes(p));
      const inherited = floors['inherited']?.includes(p) === true;
      return [
        ...(roles.length === 1 && roles[0] === PROPERTY_ROLE[p as Longhand] ? [] : [`${p}: role ${PROPERTY_ROLE[p as Longhand]}, the floor gives ${roles.join(', ') || 'none'}`]),
        ...(INHERITED.has(p as Longhand) === inherited ? [] : [`${p}: ${inherited ? 'no longer' : 'now'} inherited`]),
      ];
    });
    expect(moved).toEqual([]);
  });
  it('every shorthand has exactly one handler in shorthands/index.ts, and each sets only longhands', () => {
    expect(Object.keys(SHORTHAND_HANDLERS).sort()).toEqual([...SHORTHANDS].sort());
    for (const s of SHORTHANDS) for (const l of SHORTHAND_HANDLERS[s].longhands) expect((LONGHANDS as readonly string[]).includes(l), `${s} -> ${l}`).toBe(true);
    expect(SHORTHAND_HANDLERS.border.longhands).toEqual(LONGHANDS.filter((p) => p.startsWith('border-top-') || p.startsWith('border-right-') || p.startsWith('border-bottom-') || p.startsWith('border-left-')).sort((a, b) => ['top', 'right', 'bottom', 'left'].indexOf(a.split('-')[1] as string) - ['top', 'right', 'bottom', 'left'].indexOf(b.split('-')[1] as string)));
  });
  it('the unit registry order is pinned, and unregistered units keep their <length-unit> feature key', () => {
    expect(UNITS.map((u) => u.unit)).toEqual(['px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'em', 'rem', 'ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric', 'lh', 'rlh', 'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax', 'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax', 'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax']);
    expect(lengthFeatureType('xyz')).toBe('<length-xyz>');
    expect(lengthFeatureType('px')).toBe('<length-px>');
    expect(lengthFeatureType('em')).toBe('<length-em>');
    expect(featureOf('width', { kind: 'length', value: 2, unit: 'rem' })).toBe('width:<length-rem>');
  });
});

describe('E2 seams: FIXTURES', () => {
  const load = async (): Promise<readonly { readonly id: string }[]> => {
    // A computed specifier: the parity package is outside this test project's rootDir, so tsc must not follow it.
    const path = new URL('../../parity/src/fixtures.ts', import.meta.url).href;
    return ((await import(path)) as { FIXTURES: readonly { readonly id: string }[] }).FIXTURES;
  };
  it('FIXTURES keeps the milestone-1 order and case ids, first', async () => {
    const fixtures = await load();
    expect(fixtures.slice(0, MILESTONE_1_IDS.length).map((f) => f.id)).toEqual(MILESTONE_1_IDS);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
  });
  it('the milestone-1 specs are byte-identical to 4c1331c', async () => {
    expect(sha((await load()).slice(0, MILESTONE_1_IDS.length))).toBe('48d8a64b9fc390f1ebaed1047756416eba71054719f7bba3986a588986751b98');
  });
});

describe('E2 seams: every at-rule but @media, @keyframes and @property is still refused', () => {
  // MQ-a made @media conditional and ANIM-b1 accepted a top-level @keyframes (keyframes.test.ts); ANIM-b2 accepted @-webkit-keyframes
  // as @keyframes (aliases.test.ts); CASC 2 registers a top-level @property (casc-property.test.ts).
  const KEYFRAMES = ['keyframes', '-webkit-keyframes'];
  const NAMES = [...Object.keys(AT_RULE_HANDLERS).filter((n) => n !== 'media' && n !== 'property' && !KEYFRAMES.includes(n)), 'Font-Face', 'unknown-thing'];
  const sheets = (n: string): string[] => [`@${n} x { .a { width: 1px; } }`, `@${n};`, `.a { @${n} y { width: 2px; } }`, `@supports (display: flex) { @${n} z { .b { height: 3px; } } }`];
  const run = (text: string): { text: string; diagnostics: Diagnostic[]; enclosed: EnclosedRules[]; rules: number } => {
    const diagnostics: Diagnostic[] = [];
    const enclosed: EnclosedRules[] = [];
    const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics, enclosed);
    return { text, diagnostics, enclosed, rules: rules.length };
  };
  const atRules = (ds: readonly Diagnostic[]): [string, string][] => ds.filter((d) => d.code === 'DRAGON_UNSUPPORTED_AT_RULE').map((d) => [d.code, d.message]);
  it('every registered name but font-face, media, keyframes and property is refused today', () => {
    for (const [name, h] of Object.entries(AT_RULE_HANDLERS)) expect(h, name).toBe(name === 'font-face' ? acceptFontFace : name === 'media' ? mediaAtRule : KEYFRAMES.includes(name) ? keyframesAtRule : name === 'property' ? propertyAtRule : refuseAtRule);
    expect(atRuleHandler('MEDIA')).toBe(mediaAtRule);
    expect(atRuleHandler('no-such-rule')).toBe(refuseAtRule);
    expect(atRuleHandler('Font-Face')).toBe(acceptFontFace);
  });
  it('a top-level @font-face with no prelude is accepted: collected in order, with no diagnostic, rule or enclosed rules (TXT1-C)', () => {
    for (const name of ['font-face', 'Font-Face', 'FONT-FACE']) {
      const text = `@${name} { font-family: A; src: url(a.ttf) } .a { width: 1px; } @${name}{font-family:B;src:url(b.ttf)}`;
      const diagnostics: Diagnostic[] = [];
      const enclosed: EnclosedRules[] = [];
      const faces: AtRuleContext[] = [];
      const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics, enclosed, faces);
      expect(diagnostics, name).toEqual([]);
      expect(enclosed, name).toEqual([]);
      expect(rules.length, name).toBe(1);
      expect(faces.map((f) => [f.name, f.where, text.slice(f.span.start, f.span.end)]), name).toEqual([
        [name, 'the stylesheet', `@${name} { font-family: A; src: url(a.ttf) }`],
        [name, 'the stylesheet', `@${name}{font-family:B;src:url(b.ttf)}`],
      ]);
    }
  });
  it('@media is conditional only at the top level with a block: its rules carry the condition; blockless or in a rule block it is refused', () => {
    for (const n of ['media', 'MEDIA']) {
      const [top, statement, nested, inner] = sheets(n).map(run) as [ReturnType<typeof run>, ReturnType<typeof run>, ReturnType<typeof run>, ReturnType<typeof run>];
      expect([top.rules, top.diagnostics, top.enclosed], n).toEqual([1, [], []]);
      expect(atRules(statement.diagnostics), n).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', `@${n} in the stylesheet is not supported in milestone 1`]]);
      expect(atRules(nested.diagnostics), n).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', `@${n} in a rule block is not supported in milestone 1`]]);
      expect(atRules(inner.diagnostics), n).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', '@supports in the stylesheet is not supported in milestone 1']]);
      // The @media inside the refused @supports is parsed into the enclosed rules, with its condition, for analysis only.
      expect(inner.enclosed.length, n).toBe(1);
      expect(inner.enclosed[0]?.rules.map((r) => r.condition?.map((c) => c.text)), n).toEqual([['z']]);
    }
  });
  it('each at-rule, top level, nested in a rule and inside another at-rule, gets the milestone-1 refusal and produces no rule', () => {
    for (const n of NAMES) {
      const [top, statement, nested, inner] = sheets(n).map(run) as [ReturnType<typeof run>, ReturnType<typeof run>, ReturnType<typeof run>, ReturnType<typeof run>];
      expect(top.rules, n).toBe(0);
      expect(atRules(top.diagnostics), n).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', `@${n} in the stylesheet is not supported in milestone 1`]]);
      expect(atRules(statement.diagnostics), n).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', `@${n} in the stylesheet is not supported in milestone 1`]]);
      expect(atRules(nested.diagnostics), n).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', `@${n} in a rule block is not supported in milestone 1`]]);
      expect(atRules(inner.diagnostics), n).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', '@supports in the stylesheet is not supported in milestone 1']]);
      expect(inner.enclosed.length, n).toBe(2);
    }
  });
  it('the diagnostics and enclosed rules are byte-identical to 4c1331c', () => {
    // media and MEDIA left the list with MQ-a, and keyframes with ANIM-b1 (T065): with keyframes it gave 0a07dd1a…, and without
    // it the base before ANIM-b1 gives ba217ee5…, so every other at-rule is unchanged. At cb1a4b2d the full list gave 4cfb6ef0….
    // -webkit-keyframes left with ANIM-b2: without it the base before ANIM-b2 (a36ce22e09) gives a0302641… too. property left with
    // CASC 2: without it the base before CASC 2 (2c484098a7) gives 04178627… too.
    const pinned = ['charset', 'color-profile', 'container', 'counter-style', 'font-face', 'font-feature-values', 'font-palette-values', 'import', 'layer', 'namespace', 'page', 'position-try', 'scope', 'starting-style', 'supports', 'view-transition', 'Font-Face', 'unknown-thing'];
    const runs = pinned.flatMap((n) => sheets(n).map((text) => {
      const { diagnostics, enclosed } = run(text);
      return { text, diagnostics, enclosed };
    }));
    // The selectors package added Compound.pseudos and Selector.anchor, and TREE added Compound.ids and Selector.dropped: every
    // selector here must carry the defaults ([], null, [] and false), and without them the runs are byte-identical to the 4c1331c pin.
    const added: unknown[] = [];
    const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => {
      if (k === 'pseudos' || k === 'anchor' || k === 'ids' || k === 'dropped') {
        added.push(x);
        return undefined;
      }
      return x;
    }));
    expect(sha(strip(runs))).toBe('0417862776abb5b0f28ed459d1dc5aebbfd88e1123c12e75f14922d22868aa0c');
    expect(added.length).toBeGreaterThan(0);
    for (const x of added) expect([[], null, false]).toContainEqual(x);
  });
});

describe('E2 seams: the empty extension hooks', () => {
  const decl = (order: number): Declaration => ({ property: 'width', text: '1px', span: { source: SRC, start: 0, end: 0 }, valueSpan: { source: SRC, start: 0, end: 0 }, longhands: [], order });
  it('the cascade-group hook returns the winners it is given', () => {
    const a: Candidate = { declaration: decl(1), value: { kind: 'keyword', value: 'auto' }, specificity: [0, 1, 0] };
    const b: Candidate = { declaration: decl(2), value: { kind: 'keyword', value: 'auto' }, specificity: [0, 1, 0] };
    expect(beats(b, a)).toBe(true);
    const winners = new Map([['width', b]] as const);
    expect(cascadeGroups(winners, [['width', a], ['width', b]], {} as never)).toBe(winners);
  });
  it('the var() substitution hook returns a winner whose declaration holds no var() itself', () => {
    const w: Candidate = { declaration: decl(1), value: { kind: 'length', value: 3, unit: 'px' }, specificity: [0, 1, 0] };
    expect(substituteVariables(w, 'width', {} as never, { customs: new Map(), memo: new Map() })).toBe(w);
  });
});

const MILESTONE_1_IDS: readonly string[] = [
  'block-ua-divs', 'block-content-box-padding-border', 'block-border-box', 'block-percent-width-padding',
  'block-min-max', 'block-auto-margin-center', 'flex-row-grow-shrink-basis', 'flex-min-max-freeze',
  'flex-column', 'flex-wrap-gap-align-content', 'flex-justify-content', 'flex-align-items-stretch-center',
  'text-ahem-single-line', 'color-syntax', 'color-border-sides', 'cascade-compound-variants',
  'block-fractional-values', 'percent-height-chain', 'margin-collapse-siblings', 'margin-collapse-parent-child',
  'margin-collapse-through', 'margin-collapse-min-height', 'margin-collapse-body', 'flex-auto-margins-main',
  'flex-auto-margins-cross', 'flex-auto-margins-negative', 'flex-align-content-remaining',
  'flex-align-content-odd', 'flex-wrap-line-grow', 'flex-intrinsic-wrap-column', 'intrinsic-percent',
  'flex-nested', 'flex-percent-definite', 'flex-stretch-percent-minmax', 'flex-distribution-grid',
  'text-wrap-spaces', 'text-wrap-zwsp', 'text-align-multi-line', 'text-line-height-multi-line',
  'text-unbreakable-overflow', 'text-whitespace-collapse', 'text-anonymous-block-mixed',
  'flex-text-anonymous-item', 'flex-text-min-content-shrink', 'flex-column-text-wrap',
  'text-fractional-font-size', 'rtl-block-auto-margins', 'rtl-text-align-multi-line', 'rtl-flex-row-justify',
  'rtl-flex-wrap', 'rtl-text-anonymous', 'rtl-flex-column-align', 'direction-mixed-subtree', 'flex-order',
  'flex-row-reverse', 'flex-column-reverse', 'flex-reverse-start-end', 'flex-wrap-reverse', 'flex-baseline-text',
  'flex-baseline-synthesized', 'flex-baseline-nested', 'flex-align-self-baseline-wrap',
  'flex-baseline-column-fallback', 'overflow-hidden-bfc', 'overflow-hidden-flex-min-size',
  'position-relative-block', 'position-relative-percent', 'position-relative-flow', 'position-relative-flex',
  'position-relative-flex-baseline', 'position-absolute-containing-block', 'position-absolute-static-block',
  'position-absolute-static-direction', 'position-absolute-initial-containing-block',
  'position-absolute-shrink-to-fit', 'position-absolute-auto-margins', 'position-absolute-over-constrained',
  'position-absolute-min-max', 'position-absolute-height', 'position-absolute-percent',
  'position-absolute-out-of-flow', 'position-absolute-scroll-container', 'position-absolute-flex-container',
  'position-absolute-nested', 'flex-abspos-justify', 'flex-abspos-align', 'flex-abspos-column',
  'flex-abspos-reverse', 'flex-abspos-wrap-reverse', 'flex-abspos-center-shrink', 'flex-abspos-insets',
  'flex-abspos-excluded', 'flex-baseline-nested-reverse', 'flex-auto-margins-reverse-overflow',
  'flex-order-baseline-wrap-reverse', 'flex-baseline-column-wrap-reverse', 'profile-initial-values-box',
  'profile-initial-values-text', 'gap-contexts', 'color-syntax-matrix', 'baseline-source-matrix',
  'tree-switch-two-instances', 'tree-correlated-state', 'tree-controlled-aliases', 'tree-branch-arms',
  'tree-slot-projection', 'tree-shared-class-one-module', 'tree-colliding-modules', 'tree-ordered-sheets',
  'tree-ordered-sheets-reversed', 'tree-param-args', 'tree-nested-instances', 'tree-attribute-equality',
  'tree-projected-text', 'tree-whitespace-leaves', 'tree-position-toggle', 'line-height-rounding',
  'text-min-content-word-positions', 'border-initial-width', 'reject-display-grid', 'reject-color-lab',
  'reject-shorthand-filled', 'reject-unproven-context', 'reject-tree-alias-cycle', 'reject-tree-choice-overlap',
  'reject-tree-unknown-state', 'reject-tree-initial-domain', 'reject-tree-producer-error',
  'reject-tree-raw-html', 'reject-white-space-pre', 'reject-nesting-ampersand', 'reject-nested-media',
  'reject-overflow-single-axis', 'reject-overflow-body', 'reject-overflow-scroll', 'reject-last-baseline',
  'reject-bidi-neutral', 'reject-position-fixed', 'reject-position-sticky', 'reject-abspos-in-inline',
];

describe('EMS seams: the paint families (notes/T046-paint-spec.md §3 item 4)', () => {
  it('are spread into every aggregate after the grid family, in their registered order', () => {
    // PIN-DERIVE: in every block the EMS paint families follow GRID in their registered order; a family added later may follow.
    const ems = ['GRID', 'RADIUS', 'SHADOW', 'EFFECTS', 'OUTLINE', 'TRANSFORM', 'BACKGROUND_LAYERS', 'SCROLLBAR'];
    for (const block of BLOCKS) {
      const fams = spreadOrder(block);
      const at = ems.map((f) => fams.indexOf(f));
      expect(at.every((i, k) => i >= 0 && (k === 0 || i > (at[k - 1] as number))), `${block}: ${JSON.stringify(fams)}`).toBe(true);
    }
    expect(Object.keys(SHORTHAND_HANDLERS).sort()).toEqual([...SHORTHANDS].sort());
  });
});
