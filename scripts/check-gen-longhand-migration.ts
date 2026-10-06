// Proves the GEN-b (T151 R13) content and list-style longhand migration of committed outputs is additive only (docs/decisions.md,
// "Adding engine fields and CSS longhands"): every file that existed at the base commit either is unchanged or differs only by the
// four new longhands at their neutral values, and every file added since the base belongs to a fixture added since the base.
// - Chrome captures (packages/parity/expected*/**.json): every computed object gains "content": "normal", "list-style-type",
//   "list-style-position": "outside" and "list-style-image": "none", in that order right after will-change (the last longhand
//   before them). list-style-type is "disc", except on the nodes inside an ol (DECIMAL_NODES), where Chrome computes "decimal";
//   that set is checked exactly, in both directions. With the keys removed the file is byte-identical to the base.
// - Emitted CSS (packages/parity/emitted/**, expected-*/emitted/**): every rule outside @media (which writes only the longhands
//   that differ) ends with the four declarations, and list-style-type is decimal in exactly DECIMAL_RULES rules of the file. With
//   them removed the file is byte-identical to the base, except the header's compilation digest.
// - The UA datasets (packages/dragon/src/ua/*.generated.ts), compared as data: every computed row gains the four values (decimal on
//   ol), list-style-type moves from userAgentUnmodelled to userAgentDeclared and userAgentLonghands on exactly the tags whose UA rule
//   sets a non-initial value (ol), and every other table and entry is unchanged.
// - Engine inputs (packages/layout/vectors/**, break-vectors/**) and Chrome's line breaks (expected-breaks/**): unchanged.
// - The Chrome pixel manifest (expected-pixels/**/manifest.json): every base case entry unchanged; only new fixtures' cases added.
// `--plant <name>` alters one file in memory before the check, which must then fail (PLANTS below).
// Run with: node scripts/check-gen-longhand-migration.ts <base-commit> [--plant <name>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const base = process.argv[2];
if (base === undefined || base.startsWith('--')) {
  console.error('usage: node scripts/check-gen-longhand-migration.ts <base-commit> [--plant <name>]');
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

const KEYS = ['content', 'list-style-type', 'list-style-position', 'list-style-image'] as const;
const NEUTRAL: { readonly [k: string]: string } = { content: 'normal', 'list-style-type': 'disc', 'list-style-position': 'outside', 'list-style-image': 'none' };
/** The longhand the four new ones follow in LONGHANDS order. */
const BEFORE = 'will-change';

/** The base fixtures' nodes inside an ol, whose list-style-type Chrome computes (and Dragon resolves) as decimal. */
const DECIMAL_NODES: { readonly [fixture: string]: readonly string[] } = { 'block-elements-defaults': ['ol', 'ol-li1'] };
/** The emitted rules of those fixtures that resolve list-style-type: decimal: one per node, since the ol and its li differ in display. */
const DECIMAL_RULES: { readonly [fixture: string]: number } = { 'block-elements-defaults': 2 };

/** The fixture a capture or emitted file belongs to: its base name up to the first dot, without the direction suffix. */
function fixtureOf(path: string): string {
  const name = basename(path).split('.')[0] as string;
  return name.endsWith('-rtl') ? name.slice(0, -4) : name;
}

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

/** Captures: each computed object holds the four keys right after will-change at their neutral values; they are removed. */
function stripCapture(after: string, before: string, path: string): Stripped {
  const json = JSON.parse(after) as unknown;
  const fixture = fixtureOf(path);
  const decimal = new Set<string>();
  let removed = 0;
  const walk = (v: unknown, at: string, id: string | null): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`, id));
      return;
    }
    if (!isRecord(v)) return;
    const own = typeof v['id'] === 'string' ? v['id'] : id;
    if (isComputed(v)) {
      const keys = Object.keys(v);
      const i = keys.indexOf(BEFORE);
      if (i < 0 || KEYS.some((k, j) => keys[i + 1 + j] !== k)) throw new Error(`${path} ${at}: ${KEYS.join(', ')} do not follow ${BEFORE} in order`);
      for (const k of KEYS) {
        const value = v[k];
        if (k === 'list-style-type' && value === 'decimal') decimal.add(own ?? at);
        else if (value !== NEUTRAL[k]) throw new Error(`${path} ${at}: ${k} is ${JSON.stringify(value)}, not ${NEUTRAL[k] as string}`);
        delete v[k];
        removed++;
      }
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`, own);
  };
  walk(json, '$', null);
  const want = [...(DECIMAL_NODES[fixture] ?? [])].sort();
  const got = [...decimal].sort();
  // A file that captures no computed values (removed 0) has no decimal nodes to show.
  if (removed > 0 && JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${path}: list-style-type is decimal on [${got.join(', ')}], expected [${want.join(', ')}]`);
  return { text: `${JSON.stringify(json, null, indentOf(before))}\n`, removed };
}

const HEADER = /^\/\* Generated by Dragon from compilation [0-9a-f]{64}\. Do not edit\. \*\/$/;
const RULE = /^\.dg\d+ \{$/;
const declaration = (k: string, v: string): string => `  ${k}: ${v};`;

/**
 * Emitted CSS: every rule outside @media ends with exactly the four declarations; a rule inside @media writes only the longhands that
 * differ (MQ-a), so it gains none. The header keeps its form with any digest.
 */
function stripEmitted(after: string, before: string, path: string): Stripped {
  const lines = after.split('\n');
  const was = before.split('\n');
  if (!HEADER.test(lines[0] ?? '') || !HEADER.test(was[0] ?? '')) throw new Error(`${path}: the header is not the generated-file header`);
  const kept: string[] = [was[0] as string];
  let removed = 0;
  let rules = 0;
  let decimal = 0;
  let inMedia = false;
  let ruleStart = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith('@media ')) inMedia = true;
    else if (RULE.test(line)) ruleStart = kept.length;
    else if (line === '}') {
      if (ruleStart >= 0) {
        if (!inMedia) {
          rules++;
          const tail = kept.splice(kept.length - KEYS.length, KEYS.length);
          KEYS.forEach((k, j) => {
            const got = tail[j] ?? '';
            if (k === 'list-style-type' && got === declaration(k, 'decimal')) decimal++;
            else if (got !== declaration(k, NEUTRAL[k] as string)) throw new Error(`${path}:${i + 1}: the rule does not end with ${declaration(k, NEUTRAL[k] as string).trim()} in place (found "${got.trim()}")`);
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
  const want = DECIMAL_RULES[fixtureOf(path)] ?? 0;
  if (decimal !== want) throw new Error(`${path}: list-style-type: decimal in ${decimal} of ${rules} rules, expected ${want}`);
  return { text: kept.join('\n'), removed };
}

/**
 * The tags whose captured UA rows record list-style-type: ol's decimal. html.css also sets disc on ul, but that equals the initial
 * value, so the capture (which records what differs from an unstyled element) has no entry for it.
 */
const LIST_STYLE_UA: { readonly [tag: string]: string } = { ol: 'decimal' };

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
  // computed: every row gains the four values.
  for (const [tag, row] of Object.entries(table('computed'))) {
    if (!isRecord(row)) throw new Error(`${path}: computed.${tag} is not a row`);
    for (const k of KEYS) {
      const want = k === 'list-style-type' && tag === 'ol' ? 'decimal' : NEUTRAL[k];
      if (row[k] !== want) throw new Error(`${path}: computed.${tag} ${k} is ${JSON.stringify(row[k])}, not ${String(want)}`);
      delete row[k];
      removed++;
    }
  }
  // userAgentDeclared and userAgentLonghands gain list-style-type, and userAgentUnmodelled loses it, on exactly the list tags.
  const declared = table('userAgentDeclared');
  const longhands = table('userAgentLonghands');
  const unmodelled = table('userAgentUnmodelled');
  const wasUnmodelled = was['userAgentUnmodelled'];
  if (!isRecord(wasUnmodelled)) throw new Error(`${path}: the base has no userAgentUnmodelled`);
  for (const [tag, dirs] of Object.entries(declared)) {
    if (!isRecord(dirs)) throw new Error(`${path}: userAgentDeclared.${tag} is not a row`);
    const want = LIST_STYLE_UA[tag];
    for (const dir of ['ltr', 'rtl']) {
      const d = dirs[dir];
      if (!isRecord(d)) throw new Error(`${path}: userAgentDeclared.${tag}.${dir} is not a row`);
      if (d['list-style-type'] !== want) throw new Error(`${path}: userAgentDeclared.${tag}.${dir} list-style-type is ${JSON.stringify(d['list-style-type'])}, expected ${JSON.stringify(want)}`);
      if (want === undefined) continue;
      delete d['list-style-type'];
      removed++;
      // The base listed it as unmodelled; put it back so the table compares to the base.
      const u = unmodelled[tag];
      const wu = isRecord(wasUnmodelled[tag]) ? (wasUnmodelled[tag] as Record<string, unknown>)[dir] : undefined;
      if (!isRecord(u) || !isRecord(u[dir]) || !isRecord(wu) || wu['list-style-type'] !== want) throw new Error(`${path}: userAgentUnmodelled.${tag}.${dir} did not list list-style-type: ${want} at the base`);
      (u[dir] as Record<string, unknown>)['list-style-type'] = want;
    }
  }
  for (const [tag, list] of Object.entries(longhands)) {
    if (!Array.isArray(list)) throw new Error(`${path}: userAgentLonghands.${tag} is not a list`);
    const has = list.includes('list-style-type');
    if (has !== (LIST_STYLE_UA[tag] !== undefined)) throw new Error(`${path}: userAgentLonghands.${tag} ${has ? 'lists' : 'lacks'} list-style-type`);
    if (has) {
      list.splice(list.indexOf('list-style-type'), 1);
      removed++;
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
  const dir = mkdtempSync(join(tmpdir(), 'gen-migration-'));
  try {
    const now = structuredClone({ ...(await importText(after, dir, 'after.ts')) }) as Record<string, unknown>;
    const was = await importText(before, dir, 'before.ts');
    const removed = stripUaData(now, was, path);
    for (const name of new Set([...Object.keys(now), ...Object.keys(was)])) {
      if (JSON.stringify(canonical(now[name])) !== JSON.stringify(canonical(was[name]))) throw new Error(`${path}: ${name} differs from the base beyond the list-style additions`);
    }
    return { text: before, removed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
const CAPTURE_ROOTS = readdirSync(join(ROOT, PARITY)).filter((d) => d.startsWith('expected') && !['expected-breaks', 'expected-pixels'].includes(d)).map((d) => `${PARITY}/${d}`);
const EMITTED_ROOTS = [`${PARITY}/emitted`, ...CAPTURE_ROOTS.filter((r) => existsSync(join(ROOT, r, 'emitted'))).map((r) => `${r}/emitted`)];

const MIGRATIONS: readonly Migration[] = [
  { name: 'content and list-style computed values (GEN-b)', roots: CAPTURE_ROOTS, extension: '.json', strip: stripCapture },
  { name: 'content and list-style emitted declarations (GEN-b)', roots: EMITTED_ROOTS, extension: '.css', strip: stripEmitted },
  { name: 'content and list-style UA values (GEN-b)', roots: ['packages/dragon/src/ua'], extension: '.generated.ts', strip: stripUa },
  { name: 'engine inputs, unchanged', roots: ['packages/layout/vectors', 'packages/layout/break-vectors'], extension: '.json', strip: unchanged },
  { name: 'Chrome line breaks, unchanged', roots: [`${PARITY}/expected-breaks`], extension: '.json', strip: unchanged },
  { name: 'Chrome pixel manifest, base cases unchanged', roots: [`${PARITY}/expected-pixels`], extension: 'manifest.json', strip: stripPixelManifest },
];

const C = 'darwin-arm64/margin-collapse-body.web.json';
/** Planted faults, each of which the check must catch: [migration index, file suffix, how the text changes]. */
const PLANTS: { readonly [name: string]: readonly [number, string, (t: string) => string] } = {
  'drop-content': [0, C, (t) => t.replace(/\n *"content": "normal",/, '')],
  'wrong-list-style-initial': [0, C, (t) => t.replace('"list-style-type": "disc"', '"list-style-type": "circle"')],
  'extra-key': [0, C, (t) => t.replace('"list-style-image": "none"', '"list-style-image": "none",\n        "counter-reset": "none"')],
  'capture-box': [0, C, (t) => t.replace(/"height": (\d+)/, (_m, n: string) => `"height": ${Number(n) + 1}`)],
  'capture-decimal-elsewhere': [0, C, (t) => t.replace('"list-style-type": "disc"', '"list-style-type": "decimal"')],
  'capture-decimal-dropped': [0, 'darwin-arm64/block-elements-defaults.web.json', (t) => t.replace('"list-style-type": "decimal"', '"list-style-type": "disc"')],
  'emitted-value': [1, 'emitted/margin-collapse-body.css', (t) => t.replace('  width: auto;', '  width: 10px;')],
  'emitted-content': [1, 'emitted/margin-collapse-body.css', (t) => t.replace(declaration('content', 'normal'), declaration('content', 'none'))],
  'emitted-extra': [1, 'emitted/margin-collapse-body.css', (t) => t.replace(declaration('content', 'normal'), `${declaration('content', 'normal')}\n${declaration('content', 'normal')}`)],
  'emitted-media': [1, 'emitted/media-max-width.css', (t) => t.replace(/(@media [^\n]*\n\.dg\d+ \{\n)/, `$1${declaration('content', 'normal')}\n`)],
  'ua-value': [2, 'chrome-145.darwin-arm64.generated.ts', (t) => t.replace('"list-style-position": "outside"', '"list-style-position": "inside"')],
  'ua-declared-elsewhere': [2, 'chrome-145.darwin-arm64.generated.ts', (t) => t.replace(/("p": \{\n\s*"ltr": \{\n)/, '$1      "list-style-type": "disc",\n')],
  'vector-output': [3, 'layout/vectors/dpr-2/margin-collapse-body.json', (t) => t.replace(/"height": (\d+)/, (_m, n: string) => `"height": ${Number(n) + 1}`)],
  'stray-file': [0, '', (t) => t],
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
  console.error(`check-gen-longhand-migration: ${failures} failures`);
  process.exit(1);
}
