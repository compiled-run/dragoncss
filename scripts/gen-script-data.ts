// Generates packages/layout/src/script-data.ts: the pinned Unicode data behind the engine's text itemisation
// (docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md §2 R4, and the ScriptRunIterator port in shaping.ts):
// - Script (UAX #24) and Script_Extensions, as ICU UScriptCode values, for the Latin scope and Blink's script runs;
// - the ISO 15924 tag of each UScriptCode, which HarfBuzz receives;
// - Bidi_Paired_Bracket and its type (ScriptRunIterator's bracket matching);
// - General_Category M (marks), Ps and Pe (HanKerning), and Extended_Pictographic (emoji runs, refused).
// Unicode 16.0.0 is the version of ICU 77, the ICU in Chrome 145 (scripts/gen-linebreak-data.ts has the evidence); the UScriptCode
// numbers come from ICU 77's uscript.h, whose order Blink compares.
//
// Run with: node scripts/gen-script-data.ts [--check]
//   Every input is vendored and must match its pinned SHA-256. --check requires the committed file to be byte-identical to a fresh
//   generation.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/layout/src/script-data.ts');
const UNICODE_VERSION = '16.0.0';
const UCD = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd`;
const SOURCES = {
  scripts: { path: `vendor/unicode/${UNICODE_VERSION}/Scripts.txt`, url: `${UCD}/Scripts.txt`, sha256: '9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039' },
  scriptExtensions: { path: `vendor/unicode/${UNICODE_VERSION}/ScriptExtensions.txt`, url: `${UCD}/ScriptExtensions.txt`, sha256: '049117ce26b9769fe2749b06eef51a50a89faef4a97764dd2d81daa715980700' },
  aliases: { path: `vendor/unicode/${UNICODE_VERSION}/PropertyValueAliases.txt`, url: `${UCD}/PropertyValueAliases.txt`, sha256: '440fd3e5460b9bfe31da67b6f923992e1989d31fe2ed91e091c4b8f8e2620bf9' },
  brackets: { path: `vendor/unicode/${UNICODE_VERSION}/BidiBrackets.txt`, url: `${UCD}/BidiBrackets.txt`, sha256: 'b8f32554c6f658821fb0ee742d21c5b1f2086b9bf13071fed04894b022f93d67' },
  generalCategory: { path: `vendor/unicode/${UNICODE_VERSION}/DerivedGeneralCategory.txt`, url: `${UCD}/extracted/DerivedGeneralCategory.txt`, sha256: '7676ab755a41ef82108460238569e60ad65c191ddafe61b36c6765ec1353f293' },
  emoji: { path: `vendor/unicode/${UNICODE_VERSION}/emoji-data.txt`, url: `${UCD}/emoji/emoji-data.txt`, sha256: 'f1365a5173eee18e1f98b240cdc492e84a25f1ce7e0c9d1094eb29c41a22696a' },
  uscript: { path: 'vendor/icu/77.1/uscript.h', url: 'https://raw.githubusercontent.com/unicode-org/icu/release-77-1/icu4c/source/common/unicode/uscript.h', sha256: '79b4287a8c28978b1a189079e69caa99ddddd8438601b65f0875367d77177865' },
} as const;
const MAX_CP = 0x10ffff;

function load(s: { readonly path: string; readonly sha256: string }): string {
  const bytes = readFileSync(join(ROOT, s.path));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== s.sha256) throw new Error(`${s.path}: sha256 ${sha}, pinned ${s.sha256}`);
  return bytes.toString('utf8');
}

/** The data lines of a UCD file: [code point range, fields after it]. */
function records(text: string): Array<{ from: number; to: number; fields: string[] }> {
  const out: Array<{ from: number; to: number; fields: string[] }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') continue;
    const [range, ...fields] = line.split(';').map((s) => s.trim()) as [string, ...string[]];
    const [a, b] = range.split('..').map((h) => parseInt(h, 16)) as [number, number | undefined];
    out.push({ from: a, to: b ?? a, fields });
  }
  return out;
}

/** ICU 77 UScriptCode by ISO 15924 tag, from the enum comments of uscript.h. */
function uscriptCodes(): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of load(SOURCES.uscript).matchAll(/USCRIPT_\w+\s*=\s*(\d+)\s*,\s*\/\*\s*([A-Z][a-z]{3})\s*\*\//g)) {
    const code = Number(m[1]);
    const tag = m[2] as string;
    if (!out.has(tag)) out.set(tag, code);
  }
  return out;
}

/** Scripts.txt long names to ISO 15924 tags (PropertyValueAliases.txt, property sc). */
function scriptTags(): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of load(SOURCES.aliases).split('\n')) {
    const f = raw.replace(/#.*/, '').split(';').map((s) => s.trim());
    if (f[0] === 'sc' && f.length >= 3) out.set(f[2] as string, f[1] as string);
  }
  return out;
}

function ranges(pred: (cp: number) => boolean): [number[], number[]] {
  const starts: number[] = [];
  const ends: number[] = [];
  for (let cp = 0; cp <= MAX_CP; cp++) {
    if (!pred(cp)) continue;
    if (ends.length > 0 && ends[ends.length - 1] === cp - 1) ends[ends.length - 1] = cp;
    else {
      starts.push(cp);
      ends.push(cp);
    }
  }
  return [starts, ends];
}

function generate(): string {
  const codes = uscriptCodes();
  const tags = scriptTags();
  const codeOfTag = (tag: string): number => {
    const c = codes.get(tag);
    if (c === undefined) throw new Error(`ICU 77 has no UScriptCode for ${tag}`);
    return c;
  };
  const UNKNOWN = codeOfTag('Zzzz');
  // Script, as UScriptCode.
  const sc = new Int32Array(MAX_CP + 1).fill(UNKNOWN);
  for (const r of records(load(SOURCES.scripts))) {
    const tag = tags.get(r.fields[0] as string);
    if (tag === undefined) throw new Error(`no ISO 15924 tag for ${r.fields[0]}`);
    for (let cp = r.from; cp <= r.to; cp++) sc[cp] = codeOfTag(tag);
  }
  const scStarts: number[] = [];
  const scValues: number[] = [];
  for (let cp = 0; cp <= MAX_CP; cp++) {
    if (scValues.length === 0 || scValues[scValues.length - 1] !== sc[cp]) {
      scStarts.push(cp);
      scValues.push(sc[cp] as number);
    }
  }
  // Script_Extensions: explicit sets only, each sorted by UScriptCode as ICU returns them.
  const setIndex = new Map<string, number>();
  const sets: number[][] = [];
  const scx = new Int32Array(MAX_CP + 1).fill(-1);
  for (const r of records(load(SOURCES.scriptExtensions))) {
    const set = (r.fields[0] as string).split(/\s+/).map(codeOfTag).sort((a, b) => a - b);
    const key = set.join(',');
    let i = setIndex.get(key);
    if (i === undefined) {
      i = sets.length;
      sets.push(set);
      setIndex.set(key, i);
    }
    for (let cp = r.from; cp <= r.to; cp++) scx[cp] = i;
  }
  const scxStarts: number[] = [];
  const scxEnds: number[] = [];
  const scxSets: number[] = [];
  for (let cp = 0; cp <= MAX_CP; cp++) {
    const v = scx[cp] as number;
    if (v < 0) continue;
    if (scxEnds.length > 0 && scxEnds[scxEnds.length - 1] === cp - 1 && scxSets[scxSets.length - 1] === v) scxEnds[scxEnds.length - 1] = cp;
    else {
      scxStarts.push(cp);
      scxEnds.push(cp);
      scxSets.push(v);
    }
  }
  const setOffsets: number[] = [];
  const setCodes: number[] = [];
  for (const s of sets) {
    setOffsets.push(setCodes.length);
    setCodes.push(...s);
  }
  setOffsets.push(setCodes.length);
  // Bidi brackets.
  const brackets = records(load(SOURCES.brackets)).map((r) => [r.from, parseInt(r.fields[0] as string, 16), r.fields[1] === 'o' ? 1 : 0] as const);
  // General_Category and Extended_Pictographic.
  const gc = new Map<number, string>();
  for (const r of records(load(SOURCES.generalCategory))) for (let cp = r.from; cp <= r.to; cp++) gc.set(cp, r.fields[0] as string);
  const extPict = new Uint8Array(MAX_CP + 1);
  for (const r of records(load(SOURCES.emoji))) if (r.fields[0] === 'Extended_Pictographic') for (let cp = r.from; cp <= r.to; cp++) extPict[cp] = 1;
  const [markStarts, markEnds] = ranges((cp) => /^M[nce]$/.test(gc.get(cp) ?? ''));
  const [psStarts, psEnds] = ranges((cp) => gc.get(cp) === 'Ps');
  const [peStarts, peEnds] = ranges((cp) => gc.get(cp) === 'Pe');
  const [epStarts, epEnds] = ranges((cp) => extPict[cp] === 1);

  const tagOf: string[] = [];
  for (const [tag, code] of codes) if (tagOf[code] === undefined) tagOf[code] = tag;
  const limit = Math.max(...codes.values()) + 1;
  const tagList = Array.from({ length: limit }, (_, i) => tagOf[i] ?? '');

  const list = (name: string, doc: string, xs: readonly (number | string)[]): string => {
    const lines: string[] = [];
    for (let i = 0; i < xs.length; i += 16) lines.push(`  ${xs.slice(i, i + 16).map((x) => (typeof x === 'string' ? `'${x}'` : String(x))).join(', ')},`);
    return [`/** ${doc} */`, `export const ${name}: readonly ${typeof xs[0] === 'string' ? 'string' : 'number'}[] = [`, ...lines, '];', ''].join('\n');
  };
  return [
    `// GENERATED by scripts/gen-script-data.ts from the Unicode ${UNICODE_VERSION} UCD and ICU 77 uscript.h. Do not edit; run node scripts/gen-script-data.ts.`,
    '// Unicode 16.0.0 is the version of ICU 77, the ICU in Chrome 145 (scripts/gen-linebreak-data.ts has the evidence).',
    ...Object.values(SOURCES).map((s) => `// ${s.url} sha256 ${s.sha256} (vendored at ${s.path})`),
    '// Sorted range tables, searched by a power-of-two search in the functions below (translator subset: numbers and arrays only).',
    '',
    `export const SCRIPT_UNICODE_VERSION = '${UNICODE_VERSION}';`,
    '',
    '// ICU UScriptCode values the Latin scope and the script-run segmenter name.',
    `export const USCRIPT_COMMON = ${codeOfTag('Zyyy')};`,
    `export const USCRIPT_INHERITED = ${codeOfTag('Zinh')};`,
    `export const USCRIPT_BOPOMOFO = ${codeOfTag('Bopo')};`,
    `export const USCRIPT_HAN = ${codeOfTag('Hani')};`,
    `export const USCRIPT_HIRAGANA = ${codeOfTag('Hira')};`,
    `export const USCRIPT_KATAKANA = ${codeOfTag('Kana')};`,
    `export const USCRIPT_LATIN = ${codeOfTag('Latn')};`,
    `export const USCRIPT_UNKNOWN = ${UNKNOWN};`,
    '',
    list('SCRIPT_TAGS', 'The ISO 15924 tag of each UScriptCode (index), as HarfBuzz takes it; empty for codes ICU 77 does not name.', tagList),
    list('SCRIPT_STARTS', 'The first code point of each run of one Script value.', scStarts),
    list('SCRIPT_VALUES', 'The UScriptCode of each run in SCRIPT_STARTS (USCRIPT_UNKNOWN where Scripts.txt lists nothing).', scValues),
    list('SCX_STARTS', 'Code points with an explicit Script_Extensions set: range starts.', scxStarts),
    list('SCX_ENDS', 'Range ends (inclusive) for SCX_STARTS.', scxEnds),
    list('SCX_SETS', 'The set index of each range, into SCX_SET_OFFSETS.', scxSets),
    list('SCX_SET_OFFSETS', 'Set k is SCX_SET_CODES[SCX_SET_OFFSETS[k]] up to SCX_SET_OFFSETS[k + 1], ascending UScriptCode.', setOffsets),
    list('SCX_SET_CODES', 'The UScriptCode members of every Script_Extensions set.', setCodes),
    list('BRACKET_CPS', 'Code points with a Bidi_Paired_Bracket, ascending.', brackets.map((b) => b[0])),
    list('BRACKET_PAIRS', 'The paired bracket of each BRACKET_CPS entry.', brackets.map((b) => b[1])),
    list('BRACKET_OPEN', '1 when Bidi_Paired_Bracket_Type is Open, 0 when Close.', brackets.map((b) => b[2])),
    list('MARK_STARTS', 'General_Category M (Mn, Mc, Me): range starts.', markStarts),
    list('MARK_ENDS', 'Range ends (inclusive) for MARK_STARTS.', markEnds),
    list('PS_STARTS', 'General_Category Ps: range starts.', psStarts),
    list('PS_ENDS', 'Range ends (inclusive) for PS_STARTS.', psEnds),
    list('PE_STARTS', 'General_Category Pe: range starts.', peStarts),
    list('PE_ENDS', 'Range ends (inclusive) for PE_STARTS.', peEnds),
    list('EXT_PICT_STARTS', 'Extended_Pictographic: range starts.', epStarts),
    list('EXT_PICT_ENDS', 'Range ends (inclusive) for EXT_PICT_STARTS.', epEnds),
    '/** The index of the last start at or before cp, or -1 when cp is before the first, by a power-of-two search, which needs no rounding. */',
    'function lastStartAtOrBefore(starts: readonly number[], cp: number): number {',
    '  if (starts.length === 0 || cp < (starts[0] as number)) return -1;',
    '  let step = 1;',
    '  while (step * 2 <= starts.length) step = step * 2;',
    '  let pos = 0;',
    '  while (step >= 1) {',
    '    if (pos + step < starts.length && (starts[pos + step] as number) <= cp) pos = pos + step;',
    '    step = step / 2;',
    '  }',
    '  return pos;',
    '}',
    '',
    'function inRanges(starts: readonly number[], ends: readonly number[], cp: number): boolean {',
    '  const i = lastStartAtOrBefore(starts, cp);',
    '  return i >= 0 && cp <= (ends[i] as number);',
    '}',
    '',
    '/** The Script property of a code point, as a UScriptCode. */',
    'export function scriptCode(cp: number): number {',
    '  return SCRIPT_VALUES[lastStartAtOrBefore(SCRIPT_STARTS, cp)] as number;',
    '}',
    '',
    '/** uscript_getScriptExtensions: the explicit set in ascending UScriptCode order, or the Script value alone. */',
    'export function scriptExtensions(cp: number): readonly number[] {',
    '  const i = lastStartAtOrBefore(SCX_STARTS, cp);',
    '  if (i < 0 || cp > (SCX_ENDS[i] as number)) return [scriptCode(cp)];',
    '  const set = SCX_SETS[i] as number;',
    '  const out: number[] = [];',
    '  for (let k = SCX_SET_OFFSETS[set] as number; k < (SCX_SET_OFFSETS[set + 1] as number); k++) out.push(SCX_SET_CODES[k] as number);',
    '  return out;',
    '}',
    '',
    '/** The index of cp in BRACKET_CPS, or -1 when it has no paired bracket. */',
    'export function bracketIndex(cp: number): number {',
    '  const i = lastStartAtOrBefore(BRACKET_CPS, cp);',
    '  return i >= 0 && (BRACKET_CPS[i] as number) === cp ? i : -1;',
    '}',
    '',
    'export function isMark(cp: number): boolean {',
    '  return inRanges(MARK_STARTS, MARK_ENDS, cp);',
    '}',
    '',
    'export function isOpenPunctuation(cp: number): boolean {',
    '  return inRanges(PS_STARTS, PS_ENDS, cp);',
    '}',
    '',
    'export function isClosePunctuation(cp: number): boolean {',
    '  return inRanges(PE_STARTS, PE_ENDS, cp);',
    '}',
    '',
    'export function isExtendedPictographic(cp: number): boolean {',
    '  return inRanges(EXT_PICT_STARTS, EXT_PICT_ENDS, cp);',
    '}',
    '',
    '/** R4 Latin scope: every code point of the text has Script Latin, Common or Inherited. */',
    'export function isLatinText(text: string): boolean {',
    '  for (const ch of text) {',
    '    const s = scriptCode(ch.codePointAt(0) as number);',
    '    if (s !== USCRIPT_LATIN && s !== USCRIPT_COMMON && s !== USCRIPT_INHERITED) return false;',
    '  }',
    '  return true;',
    '}',
    '',
  ].join('\n');
}

const fresh = generate();
if (process.argv.includes('--check')) {
  const committed = readFileSync(OUT, 'utf8');
  if (committed !== fresh) {
    console.error('packages/layout/src/script-data.ts differs from a fresh generation; run node scripts/gen-script-data.ts');
    process.exit(1);
  }
  console.log('script-data.ts is byte-identical to a fresh generation');
} else {
  writeFileSync(OUT, fresh);
  console.log(`wrote ${OUT}`);
}
