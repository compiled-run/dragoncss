// Proves the vertical-align, float and clear longhand migration of committed outputs is additive only (docs/decisions.md, "Adding
// engine fields and CSS longhands"): every file that existed at the base commit either is unchanged or differs only by the three
// longhands at their neutral values, and every file added since the base belongs to a fixture added since the base.
// - Chrome captures (packages/parity/expected*/**.json): every computed object gains "vertical-align": "baseline", "float": "none"
//   and "clear": "none", in that order right after visibility (the last longhand before them). With the keys removed the file
//   is byte-identical to the base.
// - Emitted CSS (packages/parity/emitted/**, expected-*/emitted/**): every rule outside @media (which writes only the longhands
//   that differ) ends with the three declarations. With them removed the file is byte-identical to the base, except the header's
//   compilation digest.
// - The UA datasets (packages/dragon/src/ua/*.generated.ts), compared as data: every computed row gains the three values (with
//   vertical-align sub and super on the sub and sup phrasing keys, whose UA rules set them); on those two keys vertical-align moves
//   from phrasingKeyUnmodelled to phrasingKeyDeclared and phrasingKeyLonghands; every other table and entry is unchanged.
// - Engine inputs (packages/layout/vectors/**, break-vectors/**) and Chrome's line breaks (expected-breaks/**): unchanged.
// - The Chrome pixel manifest (expected-pixels/**/manifest.json) and the glyph pins (expected-glyphs/**): every base entry
//   unchanged; only the new fixtures' cases added.
// - Media-sweep band summaries (expected-media/**): valuesCompared counts three more values per element node.
// `--plant <name>` alters one file in memory before the check, which must then fail (PLANTS below).
// Run with: node scripts/check-inert-layout-migration.ts <base-commit> [--plant <name>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const base = process.argv[2];
if (base === undefined || base.startsWith('--')) {
  console.error('usage: node scripts/check-inert-layout-migration.ts <base-commit> [--plant <name>]');
  process.exit(2);
}

type Stripped = { readonly text: string; readonly removed: number };

/** A migration: which committed files it covers, and how to take its additions out of one file's text. */
type Migration = {
  readonly name: string;
  readonly roots: readonly string[];
  readonly extension: string;
  /** Paths under the roots that belong to another migration. */
  readonly exclude?: (path: string) => boolean;
  /** The file text with the additions removed, formatted as the base file, and how many it removed; throws on a non-neutral addition. */
  readonly strip: (after: string, before: string, path: string) => Stripped | Promise<Stripped>;
};

const KEYS = ['vertical-align', 'float', 'clear'] as const;
const NEUTRAL: { readonly [k: string]: string } = { 'vertical-align': 'baseline', float: 'none', clear: 'none' };
/** How many longhands LONGHANDS held at the base, so how many computed values each element node compared. */
const BASE_LONGHANDS = 101;
/** The longhand the three new ones follow in LONGHANDS order. */
const BEFORE = 'visibility';
/** The phrasing keys whose Chrome UA rule sets vertical-align (html.css: sub and sup), with the value it sets. */
const UA_VERTICAL_ALIGN: { readonly [key: string]: string } = { sub: 'sub', sup: 'super' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The indent of a JSON file written by JSON.stringify(v, null, indent), from its second line. */
function indentOf(text: string): number {
  const second = text.split('\n')[1] ?? '';
  return second.length - second.trimStart().length;
}

/** The computed values of a captured element node: every longhand, so padding-left and box-sizing among them. */
const isComputed = (v: Record<string, unknown>): boolean => typeof v['padding-left'] === 'string' && typeof v['box-sizing'] === 'string';

/** Captures: each computed object holds the three keys right after visibility at their neutral values; they are removed. */
function stripCapture(after: string, before: string, path: string): Stripped {
  const json = JSON.parse(after) as unknown;
  let removed = 0;
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
      return;
    }
    if (!isRecord(v)) return;
    // A media-sweep band summary counts the compared computed values: BASE_LONGHANDS per element node at the base, one more now.
    if (typeof v['valuesCompared'] === 'number' && typeof v['boxesCompared'] === 'number') {
      const now = v['valuesCompared'];
      const was = (now * BASE_LONGHANDS) / (BASE_LONGHANDS + KEYS.length);
      if (!Number.isInteger(was) || was % BASE_LONGHANDS !== 0) throw new Error(`${path} ${at}: valuesCompared ${now} is not ${BASE_LONGHANDS + KEYS.length} per element`);
      v['valuesCompared'] = was;
      removed++;
    }
    if (isComputed(v)) {
      const keys = Object.keys(v);
      const i = keys.indexOf(BEFORE);
      if (i < 0 || KEYS.some((k, j) => keys[i + 1 + j] !== k)) throw new Error(`${path} ${at}: ${KEYS.join(', ')} do not follow ${BEFORE} in order`);
      for (const k of KEYS) {
        if (v[k] !== NEUTRAL[k]) throw new Error(`${path} ${at}: ${k} is ${JSON.stringify(v[k])}, not ${NEUTRAL[k] as string}`);
        delete v[k];
        removed++;
      }
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(json, '$');
  return { text: `${JSON.stringify(json, null, indentOf(before))}\n`, removed };
}

const HEADER = /^\/\* Generated by Dragon from compilation [0-9a-f]{64}\. Do not edit\. \*\/$/;
const RULE = /^\.dg\d+ \{$/;
const declaration = (k: string, v: string): string => `  ${k}: ${v};`;

/**
 * Emitted CSS: every rule outside @media ends with exactly the three declarations; a rule inside @media writes only the longhands that
 * differ (MQ-a), so it gains none. The header keeps its form with any digest.
 */
function stripEmitted(after: string, before: string, path: string): Stripped {
  const lines = after.split('\n');
  const was = before.split('\n');
  if (!HEADER.test(lines[0] ?? '') || !HEADER.test(was[0] ?? '')) throw new Error(`${path}: the header is not the generated-file header`);
  const kept: string[] = [was[0] as string];
  let removed = 0;
  let inMedia = false;
  let ruleStart = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith('@media ')) inMedia = true;
    else if (RULE.test(line)) ruleStart = kept.length;
    else if (line === '}') {
      if (ruleStart >= 0) {
        if (!inMedia) {
          const tail = kept.splice(kept.length - KEYS.length, KEYS.length);
          KEYS.forEach((k, j) => {
            const got = tail[j] ?? '';
            if (got !== declaration(k, NEUTRAL[k] as string)) throw new Error(`${path}:${i + 1}: the rule does not end with ${declaration(k, NEUTRAL[k] as string).trim()} in place (found "${got.trim()}")`);
          });
          removed += KEYS.length;
          if (kept.length <= ruleStart) throw new Error(`${path}:${i + 1}: a rule holds only the new declarations`);
        }
        ruleStart = -1;
      } else inMedia = false;
    }
    if (inMedia && KEYS.some((k) => line.startsWith(`  ${k}: `))) throw new Error(`${path}:${i + 1}: "${line.trim()}" inside @media`);
    kept.push(line);
  }
  return { text: kept.join('\n'), removed };
}

/** One UA dataset module as data: every exported table. */
type UaModule = { readonly [table: string]: unknown };

async function importText(text: string, dir: string, name: string): Promise<UaModule> {
  const file = join(dir, name);
  writeFileSync(file, text);
  return (await import(pathToFileURL(file).href)) as UaModule;
}

/** Removes the additions from the current dataset in place and returns how many entries it removed; throws on any other change. */
function stripUaData(now: Record<string, unknown>, was: UaModule, path: string): number {
  let removed = 0;
  const table = (name: string): Record<string, unknown> => {
    const t = now[name];
    if (!isRecord(t)) throw new Error(`${path}: no table ${name}`);
    return t;
  };
  // The UA value of a key on a row of a table family: vertical-align sub and super on the phrasing keys sub and sup, nothing else.
  const uaValue = (family: string, key: string, k: string): string | undefined => (family === 'phrasingKey' && k === 'vertical-align' ? UA_VERTICAL_ALIGN[key] : undefined);
  // Every computed table (computed, and the element, replaced and phrasing keys' tables): every row gains the values.
  const computedTables = Object.keys(now).filter((n) => /^(computed|[a-z]+KeyComputed)$/.test(n));
  if (!computedTables.includes('computed') || !computedTables.includes('phrasingKeyComputed')) throw new Error(`${path}: no computed or phrasingKeyComputed table`);
  for (const name of computedTables) {
    const family = name === 'computed' ? 'userAgent' : name.slice(0, -'Computed'.length);
    for (const [key, row] of Object.entries(table(name))) {
      if (!isRecord(row)) throw new Error(`${path}: ${name}.${key} is not a row`);
      for (const k of KEYS) {
        const want = uaValue(family, key, k) ?? NEUTRAL[k];
        if (row[k] !== want) throw new Error(`${path}: ${name}.${key} ${k} is ${JSON.stringify(row[k])}, not ${String(want)}`);
        delete row[k];
        removed++;
      }
    }
  }
  // Each family's Declared and Longhands tables gain a key, and its Unmodelled table loses it, on exactly the rows whose UA rule
  // sets it. The userAgent family's unmodelled table is userAgentUnmodelled; the element keys have none.
  for (const family of ['userAgent', 'elementKey', 'replacedKey', 'phrasingKey']) {
    const declared = table(`${family}Declared`);
    const longhands = table(`${family}Longhands`);
    const unmodelledName = family === 'elementKey' ? null : `${family}Unmodelled`;
    const unmodelled = unmodelledName === null ? null : table(unmodelledName);
    const wasUnmodelled = unmodelledName === null ? null : was[unmodelledName];
    for (const k of KEYS) {
      for (const [key, dirs] of Object.entries(declared)) {
        if (!isRecord(dirs)) throw new Error(`${path}: ${family}Declared.${key} is not a row`);
        const want = uaValue(family, key, k);
        for (const dir of ['ltr', 'rtl']) {
          const d = dirs[dir];
          if (!isRecord(d)) throw new Error(`${path}: ${family}Declared.${key}.${dir} is not a row`);
          if (d[k] !== want) throw new Error(`${path}: ${family}Declared.${key}.${dir} ${k} is ${JSON.stringify(d[k])}, expected ${JSON.stringify(want)}`);
          if (want === undefined) continue;
          delete d[k];
          removed++;
          // The base listed it as unmodelled; put it back so the table compares to the base.
          const u = unmodelled === null ? undefined : unmodelled[key];
          const wu = isRecord(wasUnmodelled) && isRecord(wasUnmodelled[key]) ? (wasUnmodelled[key] as Record<string, unknown>)[dir] : undefined;
          if (!isRecord(u) || !isRecord(u[dir]) || !isRecord(wu) || wu[k] !== want) throw new Error(`${path}: ${unmodelledName ?? family}.${key}.${dir} did not list ${k}: ${want} at the base`);
          (u[dir] as Record<string, unknown>)[k] = want;
        }
      }
      for (const [key, list] of Object.entries(longhands)) {
        if (!Array.isArray(list)) throw new Error(`${path}: ${family}Longhands.${key} is not a list`);
        const has = list.includes(k);
        if (has !== (uaValue(family, key, k) !== undefined)) throw new Error(`${path}: ${family}Longhands.${key} ${has ? 'lists' : 'lacks'} ${k}`);
        if (has) {
          list.splice(list.indexOf(k), 1);
          removed++;
        }
      }
    }
  }
  return removed;
}

/** Sorts the keys of an unmodelled row as the base generator wrote them, so a moved-back entry compares by value, not order. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (!isRecord(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
}

async function stripUa(after: string, before: string, path: string): Promise<Stripped> {
  const dir = mkdtempSync(join(tmpdir(), 'va-migration-'));
  try {
    const now = structuredClone({ ...(await importText(after, dir, 'after.ts')) }) as Record<string, unknown>;
    const was = await importText(before, dir, 'before.ts');
    const removed = stripUaData(now, was, path);
    for (const name of new Set([...Object.keys(now), ...Object.keys(was)])) {
      if (JSON.stringify(canonical(now[name])) !== JSON.stringify(canonical(was[name]))) throw new Error(`${path}: ${name} differs from the base beyond the vertical-align, float and clear additions`);
    }
    return { text: before, removed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The glyph bottom-scanline pins: each set only gains entries keyed by the new fixtures' cases. */
function stripGlyphPins(after: string, before: string, path: string): Stripped {
  let removed = 0;
  const walk = (v: unknown): void => {
    if (!isRecord(v)) return;
    for (const k of Object.keys(v)) {
      if (ofNewFixture(`${k}.`)) {
        delete v[k];
        removed++;
      } else walk(v[k]);
    }
  };
  const json = JSON.parse(after) as unknown;
  walk(json);
  if (JSON.stringify(json) !== JSON.stringify(JSON.parse(before))) throw new Error(`${path}: differs from the base beyond the new fixtures' entries`);
  return { text: before, removed };
}

/** Engine inputs and break captures: no addition at all. */
const unchanged = (after: string): Stripped => ({ text: after, removed: 0 });

/** The pixel manifest: each set keeps every base case entry as it was and only gains the new fixtures' cases. */
function stripPixelManifest(after: string, before: string, path: string): Stripped {
  type Manifest = { sets: { dpr: number; cases: { case: string }[] }[] };
  const a = JSON.parse(after) as Manifest;
  const b = JSON.parse(before) as Manifest;
  let removed = 0;
  for (const set of a.sets) {
    const kept = set.cases.filter((c) => !ofNewFixture(`${c.case}.png`));
    removed += set.cases.length - kept.length;
    set.cases = kept;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${path}: differs from the base beyond the new fixtures' cases`);
  return { text: before, removed };
}

const PARITY = 'packages/parity';
/** Every capture directory (expected, expected-dpr, expected-fonts, ...) except those another migration covers. */
const CAPTURE_ROOTS = readdirSync(join(ROOT, PARITY)).filter((d) => d.startsWith('expected') && !['expected-breaks', 'expected-pixels', 'expected-glyphs'].includes(d)).map((d) => `${PARITY}/${d}`);
const EMITTED_ROOTS = [`${PARITY}/emitted`, ...CAPTURE_ROOTS.filter((r) => existsSync(join(ROOT, r, 'emitted'))).map((r) => `${r}/emitted`)];

const MIGRATIONS: readonly Migration[] = [
  { name: 'vertical-align, float and clear computed values', roots: CAPTURE_ROOTS, extension: '.json', strip: stripCapture },
  { name: 'vertical-align, float and clear emitted declarations', roots: EMITTED_ROOTS, extension: '.css', strip: stripEmitted },
  { name: 'vertical-align, float and clear UA values', roots: ['packages/dragon/src/ua'], extension: '.generated.ts', strip: stripUa },
  { name: 'engine inputs, unchanged', roots: ['packages/layout/vectors', 'packages/layout/break-vectors'], extension: '.json', strip: unchanged },
  { name: 'Chrome line breaks, unchanged', roots: [`${PARITY}/expected-breaks`], extension: '.json', strip: unchanged },
  { name: 'Chrome pixel manifest, base cases unchanged', roots: [`${PARITY}/expected-pixels`], extension: 'manifest.json', strip: stripPixelManifest },
  { name: 'glyph bottom-scanline pins, base entries unchanged', roots: [`${PARITY}/expected-glyphs`], extension: '.json', strip: stripGlyphPins },
];

const C = 'darwin-arm64/margin-collapse-body.web.json';
/** Planted faults, each of which the check must catch: [migration index, file suffix, how the text changes]. */
const PLANTS: { readonly [name: string]: readonly [number, string, (t: string) => string] } = {
  'drop-key': [0, C, (t) => t.replace(/\n *"vertical-align": "baseline",/, '')],
  'wrong-float': [0, C, (t) => t.replace('"float": "none"', '"float": "left"')],
  'wrong-initial': [0, C, (t) => t.replace('"vertical-align": "baseline"', '"vertical-align": "middle"')],
  'extra-key': [0, C, (t) => t.replace('"vertical-align": "baseline"', '"vertical-align": "baseline",\n        "position-anchor": "auto"')],
  'capture-box': [0, C, (t) => t.replace(/"height": (\d+)/, (_m, n: string) => `"height": ${Number(n) + 1}`)],
  'emitted-value': [1, 'emitted/margin-collapse-body.css', (t) => t.replace('  width: auto;', '  width: 10px;')],
  'emitted-key': [1, 'emitted/margin-collapse-body.css', (t) => t.replace(declaration('vertical-align', 'baseline'), declaration('vertical-align', 'top'))],
  'emitted-extra': [1, 'emitted/margin-collapse-body.css', (t) => t.replace(declaration('vertical-align', 'baseline'), `${declaration('vertical-align', 'baseline')}\n${declaration('vertical-align', 'baseline')}`)],
  'emitted-media': [1, 'emitted/media-max-width.css', (t) => t.replace(/(@media [^\n]*\n\.dg\d+ \{\n)/, `$1${declaration('vertical-align', 'baseline')}\n`)],
  'ua-value': [2, 'chrome-145.darwin-arm64.generated.ts', (t) => t.replace('"vertical-align": "baseline"', '"vertical-align": "middle"')],
  'ua-declared-elsewhere': [2, 'chrome-145.darwin-arm64.generated.ts', (t) => t.replace('  "p": { ltr: { "display": "block",', '  "p": { ltr: { "display": "block", "clear": "none",')],
  'ua-phrasing-value': [2, 'chrome-145.darwin-arm64.generated.ts', (t) => t.replace(/(export const phrasingKeyComputed[\s\S]*?)"vertical-align": "super"/, '$1"vertical-align": "sub"')],
  'vector-output': [3, 'layout/vectors/dpr-2/margin-collapse-body.json', (t) => t.replace(/"height": (\d+)/, (_m, n: string) => `"height": ${Number(n) + 1}`)],
  'stray-file': [0, '', (t) => t],
  'media-count': [0, 'expected-media/media-logic.json', (t) => t.replace(/"valuesCompared": (\d+)/, (_m, n: string) => `"valuesCompared": ${Number(n) + 104}`)],
  'glyph-pin': [6, 'bottom-scanlines.json', (t) => t.replace('"interaction-combo": [1,1]', '"interaction-combo": [1,2]')],
  'pixel-manifest': [5, 'darwin-arm64/manifest.json', (t) => t.replace(/"sha256":"[0-9a-f]/, (m) => `${m.slice(0, -1)}${m.endsWith('0') ? '1' : '0'}`)],
};

const plantAt = process.argv.indexOf('--plant');
const plantName = plantAt < 0 ? null : process.argv[plantAt + 1];
if (plantName !== null && (plantName === undefined || PLANTS[plantName] === undefined)) {
  console.error(`--plant takes one of: ${Object.keys(PLANTS).join(', ')}`);
  process.exit(2);
}
const plant = plantName === null ? null : (PLANTS[plantName] as (typeof PLANTS)[string]);
let planted = false;

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
}

/** Every file under a root in the working tree, repository-relative. */
function filesNow(root: string, extension: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(extension)) out.push(relative(ROOT, path));
    }
  };
  if (existsSync(join(ROOT, root))) walk(join(ROOT, root));
  return out;
}

// Fixtures added since the base: only their outputs may be new files.
const fixtureIds = (names: readonly string[]): Set<string> => new Set(names.filter((n) => n.endsWith('.html')).map((n) => basename(n, '.html')));
const fixturesAtBase = fixtureIds(git(['ls-tree', '--name-only', `${base}:${PARITY}/fixtures`]).split('\n'));
const newFixtures = [...fixtureIds(readdirSync(join(ROOT, PARITY, 'fixtures')))].filter((id) => !fixturesAtBase.has(id));
const ofNewFixture = (path: string): boolean => {
  const name = basename(path);
  return newFixtures.some((id) => name.startsWith(`${id}.`) || name.startsWith(`${id}-rtl.`));
};

let failures = 0;
for (const [index, m] of MIGRATIONS.entries()) {
  const own = (f: string): boolean => f.endsWith(m.extension) && (m.exclude === undefined || !m.exclude(f));
  const atBase = git(['ls-tree', '-r', '--name-only', base, '--', ...m.roots]).split('\n').filter(own);
  const known = new Set(atBase);
  const added = m.roots.flatMap((r) => filesNow(r, m.extension)).filter((f) => own(f) && !known.has(f));
  if (plant !== null && plant[0] === index && plant[1] === '') {
    added.push(`${m.roots[0] as string}/darwin-arm64/not-a-new-fixture.web.json`);
    planted = true;
  }
  const stray = added.filter((f) => !ofNewFixture(f));
  for (const f of stray) console.error(`${f}: added since ${base}, but no fixture added since then owns it`);
  failures += stray.length;
  let changed = 0;
  let removed = 0;
  for (const f of atBase) {
    const before = git(['show', `${base}:${f}`]);
    let after: string;
    try {
      after = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      console.error(`${f}: deleted since ${base}`);
      failures++;
      continue;
    }
    if (plant !== null && plant[0] === index && plant[1] !== '' && f.endsWith(plant[1]) && !planted) {
      const altered = plant[2](after);
      if (altered === after) throw new Error(`plant ${plantName as string} did not change ${f}`);
      after = altered;
      planted = true;
    }
    if (after === before) continue;
    changed++;
    try {
      const stripped = await m.strip(after, before, f);
      removed += stripped.removed;
      if (stripped.text !== before) {
        console.error(`${f}: differs from ${base} beyond the ${m.name} additions`);
        failures++;
      }
    } catch (e) {
      console.error((e as Error).message);
      failures++;
    }
  }
  console.log(`${m.name}: ${atBase.length} files at ${base}, ${changed} changed, ${removed} neutral additions, every other byte identical; ${added.length} files added, all from the ${newFixtures.length} new fixtures`);
}
if (plant !== null && !planted) throw new Error(`plant ${plantName as string} found no file to alter`);
if (failures > 0) {
  console.error(`check-inert-layout-migration: ${failures} failures`);
  process.exit(1);
}
