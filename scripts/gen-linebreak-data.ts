// Generates packages/layout/src/linebreak-data.ts, the pinned Unicode line-break data behind packages/layout/src/linebreak.ts.
//
// Pinned version: Unicode 16.0.0, the version of the ICU inside Chrome 145. Evidence:
// - Chrome for Testing 145.0.7632.6 (the parity reference) ships icudtl.dat with data package name icudt77l (ICU 77).
// - Chromium 145.0.7632.6 DEPS pins src/third_party/icu at a86a32e67b8d1384b33f8fa48c83a6079b86f8cd, whose
//   source/common/unicode/uchar.h defines U_UNICODE_VERSION "16.0". ICU 77 implements UAX #14 revision 53 (Unicode 16.0.0).
//
// Run with: pnpm run linebreak:gen [-- --ucd <dir>]
//   Reads the UCD files from <dir> when given, otherwise downloads them from unicode.org into node_modules/.cache/ucd-16.0.0.
//   Every file must match its pinned SHA-256; the checksums are written into the generated header.
// Conformance: pnpm run linebreak:conformance [-- --ucd <dir>]
//   Runs the UAX #14 core (uax14BreakAllowed) over the pinned LineBreakTest.txt and prints the pass count; fails on any miss.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/layout/src/linebreak-data.ts');
const UNICODE_VERSION = '16.0.0';
const BASE = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd`;

/** The UCD files the data is built from, each with its pinned SHA-256. */
const FILES = {
  lineBreak: { path: 'LineBreak.txt', sha256: 'e97e4259d0d20fab150b9c7b4b28abfae5cd78ca97e7f4ac6ed20d685d5f4a7c' },
  eastAsianWidth: { path: 'EastAsianWidth.txt', sha256: '43adc76c0686a42cb370764eb8cfe2b2a45b10b855e5572a2db4a0eecce15d5b' },
  generalCategory: { path: 'extracted/DerivedGeneralCategory.txt', sha256: '7676ab755a41ef82108460238569e60ad65c191ddafe61b36c6765ec1353f293' },
  emoji: { path: 'emoji/emoji-data.txt', sha256: 'f1365a5173eee18e1f98b240cdc492e84a25f1ce7e0c9d1094eb29c41a22696a' },
} as const;
const TEST_FILE = { path: 'auxiliary/LineBreakTest.txt', sha256: '910759a611a479f37df4f535d2e64d7589be3c5ac5f7491cf1fb4fa4cdb211e9' };

/**
 * The class codes of the generated table. The UAX #14 classes in alphabetical order, then three pseudo-classes that split a
 * class by General_Category, because the rules need it: QU_PI and QU_PF (LB15a, LB15b, LB19) and SA_M, the SA code points
 * with gc Mn or Mc, which LB1 resolves to CM.
 */
const CLASSES = [
  'XX', 'AI', 'AK', 'AL', 'AP', 'AS', 'B2', 'BA', 'BB', 'BK', 'CB', 'CJ', 'CL', 'CM', 'CP', 'CR', 'EB', 'EM', 'EX', 'GL', 'H2', 'H3',
  'HL', 'HY', 'ID', 'IN', 'IS', 'JL', 'JT', 'JV', 'LF', 'NL', 'NS', 'NU', 'OP', 'PO', 'PR', 'QU', 'RI', 'SA', 'SG', 'SP', 'SY', 'VF',
  'VI', 'WJ', 'ZW', 'ZWJ', 'QU_PI', 'QU_PF', 'SA_M',
] as const;
const MAX_CP = 0x10ffff;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function load(file: { path: string; sha256: string }): Promise<{ text: string; sha256: string }> {
  const local = arg('--ucd');
  const cacheDir = join(ROOT, 'node_modules/.cache', `ucd-${UNICODE_VERSION}`);
  const name = file.path.split('/').pop() as string;
  let bytes: Buffer;
  if (local !== undefined) {
    const direct = join(local, file.path);
    bytes = readFileSync(existsSync(direct) ? direct : join(local, name));
  } else if (existsSync(join(cacheDir, name))) {
    bytes = readFileSync(join(cacheDir, name));
  } else {
    const res = await fetch(`${BASE}/${file.path}`);
    if (!res.ok) throw new Error(`${BASE}/${file.path}: HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, name), bytes);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== file.sha256) throw new Error(`${file.path}: sha256 ${sha256}, pinned ${file.sha256}`);
  return { text: bytes.toString('utf8'), sha256 };
}

/** Calls fn(first, last, value) for each data line `XXXX[..YYYY] ; value`, including `# @missing:` lines when missing is set. */
function eachRange(text: string, fn: (first: number, last: number, value: string) => void, missing: boolean): void {
  for (const raw of text.split('\n')) {
    let line = raw;
    if (missing && line.startsWith('# @missing:')) line = line.slice('# @missing:'.length);
    else if (line.startsWith('#')) continue;
    const hash = line.indexOf('#');
    const body = (hash >= 0 ? line.slice(0, hash) : line).trim();
    if (body === '') continue;
    const [range, value] = body.split(';').map((s) => s.trim()) as [string, string];
    const [a, b] = range.split('..');
    fn(parseInt(a as string, 16), parseInt((b ?? a) as string, 16), value);
  }
}

/** Collapses a per-code-point array into [start, value] runs. */
function runs(values: Uint8Array): { starts: number[]; values: number[] } {
  const starts: number[] = [];
  const vals: number[] = [];
  for (let cp = 0; cp <= MAX_CP; cp++) {
    if (cp === 0 || values[cp] !== values[cp - 1]) {
      starts.push(cp);
      vals.push(values[cp] as number);
    }
  }
  return { starts, values: vals };
}

/** Collapses a per-code-point membership array into inclusive [start, end] ranges. */
function ranges(member: Uint8Array): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  for (let cp = 0; cp <= MAX_CP; cp++) {
    if (member[cp] === 1 && (cp === 0 || member[cp - 1] !== 1)) starts.push(cp);
    if (member[cp] === 1 && (cp === MAX_CP || member[cp + 1] !== 1)) ends.push(cp);
  }
  return { starts, ends };
}

function numbers(name: string, doc: string, values: readonly number[]): string {
  const lines: string[] = [];
  let cur = '';
  for (const v of values) {
    const s = `0x${v.toString(16)},`;
    if (cur.length + s.length + 1 > 118) {
      lines.push(cur);
      cur = '';
    }
    cur += (cur === '' ? '' : ' ') + s;
  }
  if (cur !== '') lines.push(cur);
  return `/** ${doc} */\nexport const ${name}: readonly number[] = [\n${lines.map((l) => `  ${l}`).join('\n')}\n];\n`;
}

function smallNumbers(name: string, doc: string, values: readonly number[]): string {
  const lines: string[] = [];
  let cur = '';
  for (const v of values) {
    const s = `${v},`;
    if (cur.length + s.length + 1 > 118) {
      lines.push(cur);
      cur = '';
    }
    cur += (cur === '' ? '' : ' ') + s;
  }
  if (cur !== '') lines.push(cur);
  return `/** ${doc} */\nexport const ${name}: readonly number[] = [\n${lines.map((l) => `  ${l}`).join('\n')}\n];\n`;
}

async function generate(): Promise<void> {
  const lb = await load(FILES.lineBreak);
  const ea = await load(FILES.eastAsianWidth);
  const gc = await load(FILES.generalCategory);
  const em = await load(FILES.emoji);

  const code = (name: string): number => {
    const i = (CLASSES as readonly string[]).indexOf(name);
    if (i < 0) throw new Error(`unknown line break class ${name}`);
    return i;
  };
  // General_Category, only the values the rules read.
  const GC_PI = 1;
  const GC_PF = 2;
  const GC_MARK = 3; // Mn or Mc
  const GC_CN = 4;
  const gcOf = new Uint8Array(MAX_CP + 1);
  eachRange(gc.text, (a, b, v) => {
    const g = v === 'Pi' ? GC_PI : v === 'Pf' ? GC_PF : v === 'Mn' || v === 'Mc' ? GC_MARK : v === 'Cn' ? GC_CN : 0;
    for (let cp = a; cp <= b; cp++) gcOf[cp] = g;
  }, true);

  // Line_Break: @missing defaults first, then the explicit entries (LineBreak.txt 16.0.0 lists its default ranges explicitly).
  const lbOf = new Uint8Array(MAX_CP + 1);
  eachRange(lb.text, (a, b, v) => {
    const c = code(v);
    for (let cp = a; cp <= b; cp++) lbOf[cp] = c;
  }, true);
  for (let cp = 0; cp <= MAX_CP; cp++) {
    if (lbOf[cp] === code('QU') && gcOf[cp] === GC_PI) lbOf[cp] = code('QU_PI');
    else if (lbOf[cp] === code('QU') && gcOf[cp] === GC_PF) lbOf[cp] = code('QU_PF');
    else if (lbOf[cp] === code('SA') && gcOf[cp] === GC_MARK) lbOf[cp] = code('SA_M');
  }

  // $EastAsian = [\p{ea=F}\p{ea=W}\p{ea=H}] (UAX #14 LB19a, LB30).
  const wide = new Uint8Array(MAX_CP + 1);
  eachRange(ea.text, (a, b, v) => {
    const w = v === 'F' || v === 'W' || v === 'H' ? 1 : 0;
    for (let cp = a; cp <= b; cp++) wide[cp] = w;
  }, true);

  // [\p{Extended_Pictographic}&\p{Cn}] (UAX #14 LB30b).
  const epcn = new Uint8Array(MAX_CP + 1);
  eachRange(em.text, (a, b, v) => {
    if (v !== 'Extended_Pictographic') return;
    for (let cp = a; cp <= b; cp++) if (gcOf[cp] === GC_CN) epcn[cp] = 1;
  }, false);

  const lbRuns = runs(lbOf);
  const wideRanges = ranges(wide);
  const epcnRanges = ranges(epcn);

  let out = '';
  out += `// GENERATED by scripts/gen-linebreak-data.ts from the Unicode ${UNICODE_VERSION} UCD. Do not edit; run pnpm run linebreak:gen.\n`;
  out += `// Unicode ${UNICODE_VERSION} is the version of ICU 77, the ICU in Chrome 145 (see the generator for the evidence).\n`;
  for (const [k, f] of Object.entries(FILES)) {
    const sha = k === 'lineBreak' ? lb.sha256 : k === 'eastAsianWidth' ? ea.sha256 : k === 'generalCategory' ? gc.sha256 : em.sha256;
    out += `// ${BASE}/${f.path} sha256 ${sha}\n`;
  }
  out += '// Sorted range tables, searched by binary search in linebreak.ts (translator subset: numbers and arrays only).\n\n';
  out += `export const UNICODE_VERSION = '${UNICODE_VERSION}';\n\n`;
  out += '// Line_Break class codes. QU_PI, QU_PF and SA_M split QU and SA by General_Category (Pi, Pf, and Mn or Mc).\n';
  CLASSES.forEach((c, i) => {
    out += `export const LB_${c} = ${i};\n`;
  });
  out += `\n/** The class names by code. */\nexport const LB_CLASS_NAMES: readonly string[] = [${CLASSES.map((c) => `'${c}'`).join(', ')}];\n\n`;
  out += numbers('LB_STARTS', `The first code point of each run of equal Line_Break class (${lbRuns.starts.length} runs covering U+0000..U+10FFFF).`, lbRuns.starts);
  out += '\n';
  out += smallNumbers('LB_VALUES', 'The class code of each run in LB_STARTS.', lbRuns.values);
  out += '\n';
  out += numbers('EAST_ASIAN_STARTS', `The first code point of each range with East_Asian_Width F, W or H (${wideRanges.starts.length} ranges).`, wideRanges.starts);
  out += '\n';
  out += numbers('EAST_ASIAN_ENDS', 'The last code point (inclusive) of each range in EAST_ASIAN_STARTS.', wideRanges.ends);
  out += '\n';
  out += numbers('EXT_PICT_UNASSIGNED_STARTS', `The first code point of each range that is Extended_Pictographic and gc=Cn (${epcnRanges.starts.length} ranges).`, epcnRanges.starts);
  out += '\n';
  out += numbers('EXT_PICT_UNASSIGNED_ENDS', 'The last code point (inclusive) of each range in EXT_PICT_UNASSIGNED_STARTS.', epcnRanges.ends);
  writeFileSync(OUT, out);
  console.log(`linebreak:gen: wrote ${OUT} (${lbRuns.starts.length} class runs, ${wideRanges.starts.length} East Asian ranges, ${epcnRanges.starts.length} ExtPict&Cn ranges)`);
}

async function conformance(): Promise<void> {
  const test = await load(TEST_FILE);
  const { uax14BreakAllowed } = await import('../packages/layout/src/linebreak.ts');
  let pass = 0;
  let total = 0;
  const misses: string[] = [];
  for (const raw of test.text.split('\n')) {
    const hash = raw.indexOf('#');
    const body = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (body === '') continue;
    const tokens = body.split(/\s+/);
    const cps: number[] = [];
    const expected: boolean[] = [];
    for (const t of tokens) {
      if (t === '÷') expected.push(true);
      else if (t === '×') expected.push(false);
      else cps.push(parseInt(t, 16));
    }
    // expected[i] is the boundary before cps[i]; expected[0] is sot and expected[n] is eot.
    const got = uax14BreakAllowed(cps, false);
    total++;
    let same = got.length === expected.length;
    for (let i = 1; same && i < expected.length; i++) if (got[i] !== expected[i]) same = false;
    if (same) pass++;
    else if (misses.length < 20) misses.push(`${body}   got ${got.map((b) => (b ? '÷' : '×')).join('')}`);
  }
  for (const m of misses) console.log('MISS', m);
  console.log(`linebreak:conformance: LineBreakTest-${UNICODE_VERSION} ${pass}/${total} (sha256 ${test.sha256})`);
  if (pass !== total) process.exitCode = 1;
}

if (process.argv.includes('--conformance')) await conformance();
else await generate();
