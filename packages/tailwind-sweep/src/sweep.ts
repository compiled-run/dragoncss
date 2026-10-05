// The sweep: every utility of the pinned Tailwind through Dragon for web, ios and android, then Chrome, into one record each.
//   supported  the target compiles with no error, and Chrome agrees: the published sheet and Dragon's web output compute the
//              same boxes and standard properties on every element (web output and native outputs come from one resolved result)
//   refused    a named diagnostic code, what it names, and its fix
//   invalid    Dragon reports the value or selector invalid and Chrome drops it too: the utility does nothing in Chrome either
//   mismatch   the target compiles but Chrome disagrees: a wrong acceptance, listed so it is fixed, never counted as support
//   na-native  a native target compiles only because every declaration web refuses is not applicable on native (NA-NATIVE):
//              Dragon leaves it out there, so Chrome has nothing to check; counted on its own, never as support
// A utility whose rules set only custom properties (a modifier such as from-red-500 or ring-offset-2) does nothing alone; it is
// judged on one element with its companions: the first utility of the class list (names without a leading "-" first) whose
// standard declarations read one of the custom properties it sets; failing that, the first modifier whose custom declarations
// read one of them (from-0% feeds from-red-500's --tw-gradient-stops) together with that modifier's own reader.
import { categoryOf } from './categories.ts';
import type { Category } from './categories.ts';
import type { ChromeSession } from './chrome.ts';
import type { Blocker, Target } from './dragon.ts';
import { TARGETS } from './dragon.ts';
import type { DragonRow, Item } from './pool.ts';
import { compileAll } from './pool.ts';
import type { UtilityRules } from './rules.ts';
import { utilityRules } from './rules.ts';
import type { Utility } from './tailwind.ts';
import { utilities } from './tailwind.ts';

export type Outcome =
  | { readonly status: 'supported' }
  | { readonly status: 'refused'; readonly code: string; readonly group: string; readonly at: string; readonly fix: string; readonly chromeParses?: true }
  | { readonly status: 'invalid'; readonly why: string }
  | { readonly status: 'mismatch'; readonly problems: readonly string[] }
  /** NA-NATIVE: a native target compiles only because everything web refuses is not applicable on native; never counted as supported. */
  | { readonly status: 'na-native'; readonly at: string };

export type UtilityRecord = {
  readonly utility: string;
  /** Tailwind's utility root. */
  readonly root: string;
  readonly category: Category;
  /** The companions a custom-property-only utility is judged with. */
  readonly with: readonly string[] | null;
  readonly outcomes: { readonly [T in Target]: Outcome };
  /** The blocking codes of the published sheet, before the shell pre-pass (flatten.ts). */
  readonly published: { readonly [T in Target]: readonly string[] };
};

/** Codes that call CSS invalid, which the sweep checks against Chrome's own parse. */
const INVALID_CODES: ReadonlySet<string> = new Set(['DRAGON_CSS_INVALID_VALUE', 'DRAGON_CSS_PARSE', 'DRAGON_SELECTOR_DROPPED']);

/** The companions of each custom-property-only utility (reader first), or null when no utility reads what it sets. */
export function companions(list: readonly Utility[], rows: ReadonlyMap<string, DragonRow>): Map<string, string[] | null> {
  const rules = new Map(list.map((u) => [u.name, utilityRules((rows.get(u.name) as DragonRow).sweptCss)]));
  const rulesOf = (name: string): UtilityRules => rules.get(name) as UtilityRules;
  const ordered = [...list.filter((u) => !u.name.startsWith('-')), ...list.filter((u) => u.name.startsWith('-'))].map((u) => u.name);
  const readers = ordered.filter((n) => rulesOf(n).properties.length > 0);
  const modifiers = ordered.filter((n) => rulesOf(n).properties.length === 0);
  const readerOf = (sets: readonly string[]): string | undefined => readers.find((x) => rulesOf(x).reads.some((p) => sets.includes(p)));
  const out = new Map<string, string[] | null>();
  for (const u of list) {
    const r = rulesOf(u.name);
    if (r.properties.length > 0) continue;
    const direct = readerOf(r.sets);
    if (direct !== undefined) {
      out.set(u.name, [direct]);
      continue;
    }
    const feeder = modifiers.find((m) => m !== u.name && rulesOf(m).customReads.some((p) => r.sets.includes(p)) && readerOf(rulesOf(m).sets) !== undefined);
    out.set(u.name, feeder === undefined ? null : [readerOf(rulesOf(feeder).sets) as string, feeder]);
  }
  return out;
}

/** The Chrome condition for a blocker that calls CSS invalid: its declaration or its selector. Null when Chrome cannot judge it statically. */
export function parseCondition(b: Blocker): string | null {
  if (b.context === null) return null;
  if (b.code === 'DRAGON_SELECTOR_DROPPED') return `selector(${b.context})`;
  const decl = b.context.replace(/\s*!important\s*$/i, '');
  // A value with var() is valid at parse time (css-variables-1 §3.1), so Chrome's parse says nothing about it.
  if (/var\(/i.test(decl) || !/^[-a-zA-Z]+\s*:/.test(decl)) return null;
  return decl;
}

/**
 * What a refusal is about, for ranking the roadmap: the unsupported property, at-rule or selector; for an unsupported value, the
 * value kind the message names (a math or colour function, viewport units) or the support-profile feature; for an unproven
 * context, the feature.
 */
export function refusalGroup(b: Pick<Blocker, 'code' | 'at' | 'message'>): string {
  const m = b.message;
  switch (b.code) {
    case 'DRAGON_UNSUPPORTED_PROPERTY':
      return `property ${m.split(' ')[0] as string}`;
    case 'DRAGON_UNSUPPORTED_AT_RULE':
      return `at-rule ${/^@[\w-]+/.exec(m)?.[0] ?? m}`;
    case 'DRAGON_UNSUPPORTED_SELECTOR':
      return `selector ${m.replace(/ is not supported[\s\S]*$/, '')}`;
    case 'DRAGON_UNPROVEN_CONTEXT':
      return `unproven context ${b.at}`;
    case 'DRAGON_UNSUPPORTED_VALUE': {
      const fn = /is unsupported: ([a-z-]+\(\))/.exec(m);
      if (fn !== null) return `value ${fn[1] as string}`;
      const reasons: readonly (readonly [RegExp, string])[] = [
        [/is unsupported: viewport units/, 'value viewport units'],
        [/is unsupported: it is the used line height/, 'value used line height'],
        [/is unsupported: it is measured from the primary font/, 'value font-relative units'],
        [/is unsupported: subgrid/, 'value subgrid'],
      ];
      for (const [re, group] of reasons) if (re.test(m)) return group;
      const setBy = /^([a-z-]+): ([^()]+?) \(set by [^)]*\) is unsupported \(support profile/.exec(m);
      if (setBy !== null) return `profile ${setBy[1] as string}:${setBy[2] as string}`;
      const feature = /([a-z-]+:(?:<[^>]+>|[^\s;:]+)) is unsupported \(support profile/.exec(m) ?? /^([a-z-]+: [^\s;]+) is unsupported \(support profile/.exec(m);
      if (feature !== null) return `profile ${(feature[1] as string).replace(': ', ':')}`;
      const multi = /^multi-token value "[^"]*" for ([a-z-]+)/.exec(m);
      if (multi !== null) return `value multi-token ${multi[1] as string}`;
      const computes = /^([a-z-]+) computes to auto on /.exec(m);
      if (computes !== null) return `value ${computes[1] as string} computes to auto`;
      return `value ${m.slice(0, 80)}`;
    }
    default:
      return `${b.code} ${b.at}`;
  }
}

export type Judged = { readonly dual: ReadonlyMap<string, readonly string[]>; readonly parses: ReadonlyMap<string, boolean> };

export function outcomeOf(t: Target, row: DragonRow, judged: Judged): Outcome {
  const r = row.result as NonNullable<DragonRow['result']>;
  const b = r.blockers[t];
  if (b === null) {
    const na = r.notApplicable[t];
    if (r.blockers.web !== null && t !== 'web' && na !== null) return { status: 'na-native', at: na };
    if (r.blockers.web !== null) throw new Error(`${row.key}: ${t} compiles but web does not, so Chrome cannot check it`);
    const problems = judged.dual.get(row.key);
    if (problems === undefined) throw new Error(`${row.key}: no Chrome verdict`);
    return problems.length === 0 ? { status: 'supported' } : { status: 'mismatch', problems };
  }
  if (INVALID_CODES.has(b.code)) {
    const cond = parseCondition(b);
    if (cond === null) throw new Error(`${row.key}: ${b.code} on "${b.context ?? b.at}" cannot be checked against Chrome's parse; extend parseCondition`);
    const parses = judged.parses.get(cond);
    if (parses === undefined) throw new Error(`${row.key}: no Chrome parse for ${cond}`);
    if (!parses) return { status: 'invalid', why: `${b.message}; Chrome 145 drops "${cond}" too` };
    return { status: 'refused', code: b.code, group: refusalGroup(b), at: b.at, fix: b.fix, chromeParses: true };
  }
  return { status: 'refused', code: b.code, group: refusalGroup(b), at: b.at, fix: b.fix };
}

export type SweepResult = { readonly records: readonly UtilityRecord[]; readonly crashes: readonly string[] };

/** Runs the whole sweep. Chrome is opened through openChrome after the Dragon phase, and closed before this returns or throws. */
export async function sweep(openChrome: () => Promise<ChromeSession>, log: (line: string) => void = () => {}): Promise<SweepResult> {
  const list = await utilities();
  log(`${list.length} utilities`);
  const singles = await compileAll(list.map((u) => ({ key: u.name, classes: [u.name] })));
  const byName = new Map(singles.map((r) => [r.key, r]));
  const partners = companions(list, byName);
  const alone = [...partners].filter(([, c]) => c === null).map(([m]) => m);
  if (alone.length > 0) throw new Error(`${alone.join(', ')} set only custom properties that no utility reads`);
  const pairItems: Item[] = [...partners].filter((e): e is [string, string[]] => e[1] !== null).map(([m, c]) => ({ key: m, classes: [...c, m] }));
  log(`${pairItems.length} custom-property-only utilities judged with a companion`);
  const pairs = new Map((await compileAll(pairItems)).map((r) => [r.key, r]));
  const rowOf = (name: string): DragonRow => pairs.get(name) ?? (byName.get(name) as DragonRow);
  const crashes = [...singles, ...pairs.values()].flatMap((r) => r.crashes);

  const dual = new Map<string, readonly string[]>();
  const parses = new Map<string, boolean>();
  const chrome = await openChrome();
  try {
    // One check per utility at a time on each of the session's pages; the verdicts are keyed, so their order changes nothing.
    const parseOf = new Map<string, Promise<boolean>>();
    const check = async (u: (typeof list)[number]): Promise<void> => {
      const row = rowOf(u.name);
      if (row.result === null) return;
      if (row.result.compiledHtml !== null) dual.set(u.name, await chrome.dual({ key: u.name, authoredHtml: row.result.authoredHtml, compiledHtml: row.result.compiledHtml }));
      for (const t of TARGETS) {
        const b = row.result.blockers[t];
        const cond = b !== null && INVALID_CODES.has(b.code) ? parseCondition(b) : null;
        if (cond === null) continue;
        let p = parseOf.get(cond);
        if (p === undefined) {
          p = chrome.supports(cond);
          parseOf.set(cond, p);
        }
        parses.set(cond, await p);
      }
    };
    let next = 0;
    let failed = false;
    const lane = async (): Promise<void> => {
      try {
        while (next < list.length && !failed) await check(list[next++] as (typeof list)[number]);
      } catch (e) {
        // The other lanes stop at their next utility instead of running on against a browser about to close.
        failed = true;
        throw e;
      }
    };
    // Every lane has stopped before the browser closes; the first failure is the one reported.
    const failure = (await Promise.allSettled(Array.from({ length: chrome.pages }, lane))).find((r) => r.status === 'rejected');
    if (failure !== undefined) throw failure.reason;
  } finally {
    await chrome.close();
  }
  log(`${dual.size} Chrome dual checks, ${parses.size} Chrome parse checks`);

  const records: UtilityRecord[] = [];
  for (const u of list) {
    const row = rowOf(u.name);
    if (row.result === null || row.published === null) continue;
    const partner = partners.get(u.name) ?? null;
    const base = partner === null ? u.name : (partner[0] as string);
    const category = categoryOf(base, u.colour, utilityRules(rowOf(base).sweptCss).properties);
    const outcomes = Object.fromEntries(TARGETS.map((t) => [t, outcomeOf(t, row, { dual, parses })])) as { [T in Target]: Outcome };
    records.push({ utility: u.name, root: u.root, category, with: partner, outcomes, published: row.published });
  }
  return { records, crashes };
}

const brief = (o: Outcome): string => {
  switch (o.status) {
    case 'supported':
      return 'supported';
    case 'refused':
      return `refused ${o.code} ${o.at}`;
    case 'invalid':
      return `invalid: ${o.why}`;
    case 'mismatch':
      return `mismatch: ${o.problems[0] ?? ''}`;
    case 'na-native':
      return `not applicable on native: ${o.at}`;
  }
};

/** Every difference between the committed records and a fresh sweep: outcomes per target, companions, categories and published codes. */
export function outcomeDiffs(snapshot: readonly UtilityRecord[], now: readonly UtilityRecord[]): string[] {
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const nowBy = new Map(now.map((r) => [r.utility, r]));
  const snapBy = new Set(snapshot.map((r) => r.utility));
  const out: string[] = [];
  for (const s of snapshot) {
    const n = nowBy.get(s.utility);
    if (n === undefined) {
      out.push(`${s.utility}: in the snapshot, not in the sweep`);
      continue;
    }
    if (s.root !== n.root) out.push(`${s.utility}: root ${s.root}, now ${n.root}`);
    if (s.category !== n.category) out.push(`${s.utility}: category ${s.category}, now ${n.category}`);
    if (!same(s.with, n.with)) out.push(`${s.utility}: judged with ${JSON.stringify(s.with)}, now ${JSON.stringify(n.with)}`);
    for (const t of TARGETS) if (!same(s.outcomes[t], n.outcomes[t])) out.push(`${s.utility} ${t}: snapshot ${brief(s.outcomes[t])}, now ${brief(n.outcomes[t])}`);
    if (!same(s.published, n.published)) out.push(`${s.utility}: published codes ${JSON.stringify(s.published)}, now ${JSON.stringify(n.published)}`);
  }
  for (const n of now) if (!snapBy.has(n.utility)) out.push(`${n.utility}: in the sweep, not in the snapshot`);
  return out;
}
