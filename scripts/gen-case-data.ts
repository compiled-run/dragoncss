// Generates packages/dragon/src/analysis/case-data.generated.ts, the pinned Unicode case and word data behind text-transform
// (analysis/text-transform.ts) and its word boundaries (analysis/word-break.ts).
//
// Pinned version: Unicode 16.0.0, the version of ICU 77 inside Chrome 145 (evidence in scripts/gen-linebreak-data.ts).
//
// Run with: pnpm run case:gen [-- --ucd <dir>]
//   Reads the UCD files from <dir>, from vendor/unicode/16.0.0, or downloads them from unicode.org into
//   node_modules/.cache/ucd-16.0.0. Every file must match its pinned SHA-256; the checksums are written into the generated header.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/dragon/src/analysis/case-data.generated.ts');
const UNICODE_VERSION = '16.0.0';
const BASE = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd`;
const VENDOR = join(ROOT, 'vendor/unicode', UNICODE_VERSION);

/** The UCD files the data is built from, each with its pinned SHA-256. */
const FILES = {
  unicodeData: { path: 'UnicodeData.txt', sha256: 'ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f' },
  specialCasing: { path: 'SpecialCasing.txt', sha256: '8d5de354eef79f2395a54c9c7dcebbaf3d30fc962d0f85611ea97aa973a0c451' },
  derivedCore: { path: 'DerivedCoreProperties.txt', sha256: '39d35161f2954497f69e08bdb9e701493f476a3d30222de20028feda36c1dabd' },
  wordBreak: { path: 'auxiliary/WordBreakProperty.txt', sha256: '476464e71a4b7b779b8ba7c5671f4338fea77da8e6b6b05fb82b3fdd14603779' },
  emoji: { path: 'emoji/emoji-data.txt', sha256: 'f1365a5173eee18e1f98b240cdc492e84a25f1ce7e0c9d1094eb29c41a22696a' },
  scripts: { path: 'Scripts.txt', sha256: '9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039' },
  lineBreak: { path: 'LineBreak.txt', sha256: 'e97e4259d0d20fab150b9c7b4b28abfae5cd78ca97e7f4ac6ed20d685d5f4a7c' },
} as const;

/** The Word_Break values in code order; Other is 0, the value of every code point WordBreakProperty.txt does not list. */
const WORD_BREAK = ['Other', 'CR', 'LF', 'Newline', 'Extend', 'ZWJ', 'Regional_Indicator', 'Format', 'Katakana', 'Hebrew_Letter', 'ALetter', 'Single_Quote', 'Double_Quote', 'MidNumLet', 'MidLetter', 'MidNum', 'Numeric', 'ExtendNumLet', 'WSegSpace'] as const;
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
  } else if (existsSync(join(VENDOR, name))) {
    bytes = readFileSync(join(VENDOR, name));
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

/** Calls fn(first, last, value) for each data line `XXXX[..YYYY] ; value [; ...]`. */
function eachRange(text: string, fn: (first: number, last: number, value: string) => void): void {
  for (const raw of text.split('\n')) {
    const hash = raw.indexOf('#');
    const body = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (body === '') continue;
    const [range, value] = body.split(';').map((s) => s.trim()) as [string, string];
    const [a, b] = range.split('..');
    fn(parseInt(a as string, 16), parseInt((b ?? a) as string, 16), value);
  }
}

/** Inclusive [start, end] ranges of a membership array, flattened as start, end, start, end... */
function ranges(member: Uint8Array): number[] {
  const out: number[] = [];
  for (let cp = 0; cp <= MAX_CP; cp++) {
    if (member[cp] === 1 && (cp === 0 || member[cp - 1] !== 1)) out.push(cp);
    if (member[cp] === 1 && (cp === MAX_CP || member[cp + 1] !== 1)) out.push(cp);
  }
  return out;
}

function numbers(name: string, doc: string, values: readonly number[], hex: boolean): string {
  const lines: string[] = [];
  let cur = '';
  for (const v of values) {
    const s = `${hex ? `0x${v.toString(16)}` : String(v)},`;
    if (cur.length + s.length + 1 > 118) {
      lines.push(cur);
      cur = '';
    }
    cur += (cur === '' ? '' : ' ') + s;
  }
  if (cur !== '') lines.push(cur);
  return `/** ${doc} */\nexport const ${name}: readonly number[] = [\n${lines.map((l) => `  ${l}`).join('\n')}\n];\n`;
}

function strings(name: string, doc: string, values: readonly string[]): string {
  return `/** ${doc} */\nexport const ${name}: readonly string[] = [\n${values.map((v) => `  ${JSON.stringify(v)},`).join('\n')}\n];\n`;
}

const units = (cps: readonly number[]): string => String.fromCodePoint(...cps);

async function generate(): Promise<void> {
  const ud = await load(FILES.unicodeData);
  const sc = await load(FILES.specialCasing);
  const dc = await load(FILES.derivedCore);
  const wb = await load(FILES.wordBreak);
  const em = await load(FILES.emoji);
  const sx = await load(FILES.scripts);
  const lb = await load(FILES.lineBreak);

  // UnicodeData.txt fields 12, 13 and 14: simple uppercase, lowercase and titlecase. An empty titlecase field is the uppercase one.
  const upper: number[] = [];
  const lower: number[] = [];
  const title: number[] = [];
  for (const line of ud.text.split('\n')) {
    if (line.trim() === '') continue;
    const f = line.split(';');
    const cp = parseInt(f[0] as string, 16);
    const u = f[12] as string;
    const l = f[13] as string;
    const t = (f[14] as string).trim() === '' ? u : (f[14] as string);
    if (u !== '') upper.push(cp, parseInt(u, 16));
    if (l !== '') lower.push(cp, parseInt(l, 16));
    if (t !== '' && parseInt(t, 16) !== cp) title.push(cp, parseInt(t, 16));
  }

  // SpecialCasing.txt: the unconditional full mappings, and Final_Sigma (the one condition with no language).
  const full: { cp: number; lower: string; upper: string }[] = [];
  let finalSigma: { cp: number; lower: string } | null = null;
  for (const raw of sc.text.split('\n')) {
    const hash = raw.indexOf('#');
    const body = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (body === '') continue;
    const f = body.split(';').map((s) => s.trim());
    const cp = parseInt(f[0] as string, 16);
    const cps = (s: string): number[] => (s === '' ? [] : s.split(/\s+/).map((h) => parseInt(h, 16)));
    const condition = f[4] ?? '';
    if (condition === '') full.push({ cp, lower: units(cps(f[1] as string)), upper: units(cps(f[3] as string)) });
    else if (condition === 'Final_Sigma') finalSigma = { cp, lower: units(cps(f[1] as string)) };
  }
  if (finalSigma === null || finalSigma.cp !== 0x3a3) throw new Error('SpecialCasing.txt has no Final_Sigma entry for U+03A3');
  full.sort((a, b) => a.cp - b.cp);

  const cased = new Uint8Array(MAX_CP + 1);
  const ignorable = new Uint8Array(MAX_CP + 1);
  eachRange(dc.text, (a, b, v) => {
    const into = v === 'Cased' ? cased : v === 'Case_Ignorable' ? ignorable : null;
    if (into !== null) for (let cp = a; cp <= b; cp++) into[cp] = 1;
  });

  const wbOf = new Uint8Array(MAX_CP + 1);
  eachRange(wb.text, (a, b, v) => {
    const c = (WORD_BREAK as readonly string[]).indexOf(v);
    if (c < 0) throw new Error(`unknown Word_Break value ${v}`);
    for (let cp = a; cp <= b; cp++) wbOf[cp] = c;
  });
  const wbStarts: number[] = [];
  const wbValues: number[] = [];
  for (let cp = 0; cp <= MAX_CP; cp++) {
    if (cp === 0 || wbOf[cp] !== wbOf[cp - 1]) {
      wbStarts.push(cp);
      wbValues.push(wbOf[cp] as number);
    }
  }

  const pict = new Uint8Array(MAX_CP + 1);
  eachRange(em.text, (a, b, v) => {
    if (v === 'Extended_Pictographic') for (let cp = a; cp <= b; cp++) pict[cp] = 1;
  });
  // Chrome's ICU word rules (word.txt, below): $Han and $dictionaryCJK = Han, Hiragana and Katakana by Script, and Hangul syllables.
  const han = new Uint8Array(MAX_CP + 1);
  const cjk = new Uint8Array(MAX_CP + 1);
  eachRange(sx.text, (a, b, v) => {
    if (v !== 'Han' && v !== 'Hiragana' && v !== 'Katakana') return;
    for (let cp = a; cp <= b; cp++) {
      cjk[cp] = 1;
      if (v === 'Han') han[cp] = 1;
    }
  });
  for (let cp = 0xac00; cp <= 0xd7a3; cp++) cjk[cp] = 1;
  const complex = new Uint8Array(MAX_CP + 1);
  eachRange(lb.text, (a, b, v) => {
    if (v === 'SA') for (let cp = a; cp <= b; cp++) complex[cp] = 1;
  });

  let out = '';
  out += `// GENERATED by scripts/gen-case-data.ts from the Unicode ${UNICODE_VERSION} UCD. Do not edit; run pnpm run case:gen.\n`;
  out += `// Unicode ${UNICODE_VERSION} is the version of ICU 77, the ICU in Chrome 145 (evidence in scripts/gen-linebreak-data.ts).\n`;
  const shas = { unicodeData: ud, specialCasing: sc, derivedCore: dc, wordBreak: wb, emoji: em, scripts: sx, lineBreak: lb };
  for (const [k, f] of Object.entries(FILES)) out += `// ${BASE}/${f.path} sha256 ${shas[k as keyof typeof shas].sha256}\n`;
  out += '// Mappings are flat [from, to, from, to...] lists sorted by code point; sets are flat inclusive [start, end, ...] ranges.\n\n';
  out += `export const CASE_UNICODE_VERSION = '${UNICODE_VERSION}';\n\n`;
  out += numbers('SIMPLE_UPPER', 'UnicodeData.txt Simple_Uppercase_Mapping.', upper, true) + '\n';
  out += numbers('SIMPLE_LOWER', 'UnicodeData.txt Simple_Lowercase_Mapping.', lower, true) + '\n';
  out += numbers('SIMPLE_TITLE', 'UnicodeData.txt Simple_Titlecase_Mapping (the uppercase one where the field is empty), where it differs from the code point.', title, true) + '\n';
  out += numbers('FULL_CODE_POINTS', 'SpecialCasing.txt: the code points with an unconditional full mapping.', full.map((e) => e.cp), true) + '\n';
  out += strings('FULL_LOWER', 'The full lowercase mapping of each FULL_CODE_POINTS entry.', full.map((e) => e.lower)) + '\n';
  out += strings('FULL_UPPER', 'The full uppercase mapping of each FULL_CODE_POINTS entry.', full.map((e) => e.upper)) + '\n';
  out += `/** SpecialCasing.txt Final_Sigma: U+03A3 lowercases to this at the end of a word. */\nexport const FINAL_SIGMA_LOWER = ${JSON.stringify(finalSigma.lower)};\n\n`;
  out += numbers('CASED', 'DerivedCoreProperties.txt Cased.', ranges(cased), true) + '\n';
  out += numbers('CASE_IGNORABLE', 'DerivedCoreProperties.txt Case_Ignorable.', ranges(ignorable), true) + '\n';
  out += `/** The Word_Break value names by code. */\nexport const WORD_BREAK_NAMES: readonly string[] = [${WORD_BREAK.map((c) => `'${c}'`).join(', ')}];\n\n`;
  out += numbers('WORD_BREAK_STARTS', `The first code point of each run of equal Word_Break value (${wbStarts.length} runs).`, wbStarts, true) + '\n';
  out += numbers('WORD_BREAK_VALUES', 'The Word_Break code of each run in WORD_BREAK_STARTS.', wbValues, false) + '\n';
  out += numbers('EXTENDED_PICTOGRAPHIC', 'emoji-data.txt Extended_Pictographic.', ranges(pict), true) + '\n';
  out += numbers('HAN', 'Scripts.txt Han.', ranges(han), true) + '\n';
  out += numbers('DICTIONARY_CJK', 'Scripts.txt Han, Hiragana and Katakana, and the Hangul syllables U+AC00..U+D7A3.', ranges(cjk), true) + '\n';
  out += numbers('COMPLEX_CONTEXT', 'LineBreak.txt SA (Complex_Context).', ranges(complex), true);
  writeFileSync(OUT, out);
  console.log(`case:gen: wrote ${OUT} (${upper.length / 2} upper, ${lower.length / 2} lower, ${title.length / 2} title, ${full.length} full, ${wbStarts.length} word-break runs)`);
}

await generate();
