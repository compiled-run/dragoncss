// PORT-0 (T118): the checked registry of every Chrome source file Dragon cites (docs/ports.json, described in docs/ports.md).
// The decision "Porting Chrome's algorithms (owner, 2026-09-30)" in docs/decisions.md: port only BSD-style files at the pinned
// 145.0.7632.6 tag, never LGPL ones, and record the upstream file, tag and line range of each port. This test works offline from
// the recorded data. It fails when:
//   - a source file cites a .cc/.cpp/.h file (in a comment or a string) that no registry entry names for that file;
//   - an LGPL-headered entry has no ruling, or has a 'port' use without being on the named clean-room list below (T118J ruling);
//   - a ruling names a proof test file that does not exist;
//   - a registry entry points at a Dragon file or declaration that no longer exists, or that no longer cites it;
//   - THIRD_PARTY_NOTICES.md differs from what scripts/gen-third-party-notices.ts writes from the registry.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { currentNotices, NOTICES_PATH, thirdPartyNotices } from '../../../scripts/gen-third-party-notices.ts';
import { parseIgnoreFile } from '../../../scripts/macroscope-ignore.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(ROOT, 'docs', 'ports.json');

const TAG = '145.0.7632.6';
const SKIA_REVISION = '2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23'; // Chromium 145.0.7632.6 DEPS skia_revision
const V8_REVISION = '4e031e4b6bfa4ba1d203e9bcfe3dc26d47a06b2c'; // Chromium 145.0.7632.6 DEPS v8_revision

// The licence header kinds. `lgpl` is recorded so the registry documents it; it is never an allowed port source.
const PERMISSIVE = ['bsd-chromium', 'bsd-skia', 'bsd-google', 'bsd-apple', 'bsd-other', 'mit-harfbuzz', 'fdlibm-sun'] as const;
// Kinds whose notice must stay in each Dragon file that ports from the entry (not only in THIRD_PARTY_NOTICES.md).
const NOTICE_IN_FILE: readonly string[] = ['bsd-other', 'fdlibm-sun'];
const LICENCES: readonly string[] = [...PERMISSIVE, 'lgpl'];
const PHRASE: Record<string, RegExp> = {
  'bsd-chromium': /^(Use of this source code is governed by a BSD-style license|Redistributions of source code must retain the above copyright)$/,
  'bsd-skia': /^Use of this source code is governed by a BSD-style license$/,
  'bsd-google': /^Redistributions of source code must retain the above copyright$/,
  'bsd-apple': /^Redistributions of source code must retain the above copyright$/,
  'bsd-other': /^Redistributions of source code must retain the above copyright$/,
  'mit-harfbuzz': /^Permission is hereby granted/,
  'fdlibm-sun': /^Permission to use, copy, modify, and distribute this$/,
  lgpl: /^GNU (Library|Lesser) General Public License$/,
};

// The T118J ruling (docs/goals/milestone-2-proof/notes/T118J-lgpl-ruling.md, accepted by the PM on 2026-09-30) put every
// LGPL-headered entry in class A (Dragon follows the spec or a Chrome observation; its uses are references) or class B (Dragon's code
// follows the LGPL code closely). These are the class B files. Board task T123 rewrites their Dragon code clean-room; until then
// they are the only LGPL entries allowed a 'port' use.
const KNOWN_LGPL_CLEAN_ROOM: readonly string[] = [
  'third_party/blink/renderer/core/html/forms/step_range.cc',
  'third_party/blink/renderer/core/html/forms/step_range.h',
  'third_party/blink/renderer/platform/text/text_break_iterator.cc',
];
const CLEAN_ROOM_TASK = 'T123';

// Upstream roots inside the Chromium tree at the tag (third_party/skia and v8 are resolved at their DEPS-pinned revisions).
const UPSTREAM_ROOTS = ['third_party/blink/', 'third_party/skia/', 'v8/', 'ui/gfx/', 'cc/', 'third_party/rapidhash/', 'third_party/harfbuzz-ng/'];

interface Ruling { class: 'A' | 'B' | 'C'; basis: string; proof: string[]; task?: string; note?: string }
interface Range { lines: string; symbol: string | null; source: 'cited' | 'located' | 'whole-file' }
interface DragonRef { file: string; symbol: string | null; use: 'port' | 'reference' }
interface Entry {
  upstream: string;
  citedAs?: string[];
  licence: string;
  ruling?: Ruling;
  note?: string;
  attribution?: string;
  noticeText?: string;
  licencePhrase: string;
  copyright: string;
  fileSha256: string;
  headerSha256: string;
  ranges: Range[];
  dragon: DragonRef[];
}
interface NotChrome { cited: string; source: string; files: string[] }
export interface Registry {
  about: string;
  tag: string;
  skiaRevision: string;
  v8Revision: string;
  sources: Record<string, string>;
  entries: Entry[];
  notChrome: NotChrome[];
  licenceTexts: Record<string, string>;
}

/** The licence text id prefix each permissive kind uses in licenceTexts (THIRD_PARTY_NOTICES.md). */
const NOTICE_PREFIX: Record<string, RegExp> = {
  'bsd-chromium': /^chromium-bsd$/,
  'bsd-skia': /^skia-bsd$/,
  'bsd-google': /^header-bsd-\d+$/,
  'bsd-apple': /^header-bsd-\d+$/,
  'bsd-other': /^(?!chromium-bsd$|skia-bsd$|header-bsd-)[a-z0-9-]+$/,
  'mit-harfbuzz': /^harfbuzz-mit$/,
  'fdlibm-sun': /^fdlibm-sun$/,
};

/** A repository file as text, or undefined when it does not exist. */
export type RepoReader = (path: string) => string | undefined;
const readRepo: RepoReader = (path) => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : undefined);

/** A proof reference: a repository path, optionally with :n or :a-b (lines that must exist) or #text (text the file must contain). */
function proofProblem(proof: string, read: RepoReader): string | null {
  const m = /^([^:#]+)(?::(?:\d+-)?(\d+)|#(.+))?$/.exec(proof);
  if (!m) return `proof ${proof} is not path, path:n, path:a-b or path#text`;
  const text = read(m[1]!);
  if (text === undefined) return `proof file ${m[1]} does not exist`;
  if (m[2] !== undefined && text.split('\n').length < Number(m[2])) return `proof ${proof}: ${m[1]} has fewer than ${m[2]} lines`;
  if (m[3] !== undefined && !text.includes(m[3])) return `proof ${proof}: ${m[1]} does not contain "${m[3]}"`;
  return null;
}

// Source files scanned for citations: every TypeScript, JavaScript, Swift, Kotlin or Java file under packages/, scripts/ and examples/ that git
// tracks or would track (.gitignore'd output is skipped). Generated native output is regenerated from the TypeScript, so it is covered
// by its sources.
const SCAN_TOPS = ['packages', 'scripts', 'examples'];
const SKIP_DIRS = ['node_modules', 'dist', 'dist-test', 'build', '.build', 'generated'];

function sourceFiles(): string[] {
  const git = (args: string[]) => execFileSync('git', ['-C', ROOT, 'ls-files', '-z', ...args, '--', ...SCAN_TOPS], { encoding: 'utf8' }).split('\0');
  const files = new Set([...git(['--cached']), ...git(['--others', '--exclude-standard'])]);
  return [...files]
    .filter((f) => f !== '' && f !== SELF && /\.(ts|mts|js|mjs|cjs|swift|kt|java)$/.test(f) && !f.endsWith('.d.ts'))
    .filter((f) => !f.split('/').some((part) => SKIP_DIRS.includes(part)))
    .filter((f) => existsSync(join(ROOT, f))) // a tracked file deleted in the working tree
    .sort();
}

/** A cited C/C++ file: optional directories, a file name ending .cc, .cpp or .h, an optional :a-b line range. */
const CITATION = /(?:[A-Za-z0-9_.\-]+\/)*[A-Za-z0-9_\-]+\.(?:cc|cpp|h)(?![A-Za-z0-9_])(?::\d+(?:-\d+)?)?/g;

export interface Citation { file: string; line: number; token: string; path: string }

/** Every citation in a file's comments and string literals (never code: `i.h` is a property access, not a file). */
export function citationsIn(file: string, text: string): Citation[] {
  if (!/\.(cc|cpp|h)\b/.test(text)) return [];
  if (!/\.(m?ts|[mc]?js)$/.test(file)) return nativeCitationsIn(file, text);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const spans = new Map<number, number>();
  const visit = (n: ts.Node) => {
    for (const r of ts.getLeadingCommentRanges(text, n.pos) ?? []) spans.set(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(text, n.end) ?? []) spans.set(r.pos, r.end);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) spans.set(n.getStart(sf), n.end);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const out: Citation[] = [];
  for (const [pos, end] of spans) {
    for (const m of text.slice(pos, end).matchAll(CITATION)) {
      const at = pos + m.index;
      out.push({ file, line: sf.getLineAndCharacterOfPosition(at).line + 1, token: m[0], path: m[0].replace(/:\d+(?:-\d+)?$/, '') });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Swift, Kotlin and Java: citations in line comments, block comments and double-quoted strings. */
function nativeCitationsIn(file: string, text: string): Citation[] {
  const out: Citation[] = [];
  const spans = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"/g;
  for (const span of text.matchAll(spans)) {
    for (const m of span[0].matchAll(CITATION)) {
      const at = span.index + m.index;
      out.push({ file, line: text.slice(0, at).split('\n').length, token: m[0], path: m[0].replace(/:\d+(?:-\d+)?$/, '') });
    }
  }
  return out;
}

/** Every declared name in a file (functions, classes, interfaces, types, enums, variables, methods, properties). */
export function declaredNames(file: string, text: string): Set<string> {
  if (!/\.(m?ts|[mc]?js)$/.test(file)) {
    const native = /\b(?:func|fun|class|struct|enum|protocol|interface|object|let|var|val|typealias)\s+([A-Za-z_]\w*)/g;
    return new Set([...text.matchAll(native)].map((m) => m[1]!));
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) ||
        ts.isMethodDeclaration(n) || ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isPropertyAssignment(n) || ts.isPropertySignature(n)) &&
      n.name && ts.isIdentifier(n.name)
    )
      names.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** The registry entries a cited path names: the full upstream path, a trailing part of it on a '/' boundary, or a recorded old name. */
export function resolve(registry: Registry, path: string): Entry[] {
  return registry.entries.filter(
    (e) => e.upstream === path || e.upstream.endsWith('/' + path) || (!path.includes('/') && (e.citedAs ?? []).includes(path)),
  );
}

/** Every problem with a registry against the given sources: an empty list means the registry is complete and consistent. */
export function audit(registry: Registry, sources: ReadonlyMap<string, string>, cleanRoom: readonly string[], read: RepoReader = readRepo): string[] {
  const problems: string[] = [];
  if (registry.tag !== TAG) problems.push(`registry tag ${registry.tag} is not the pinned ${TAG}`);
  if (registry.skiaRevision !== SKIA_REVISION) problems.push(`registry skiaRevision ${registry.skiaRevision} is not ${SKIA_REVISION}`);
  if (registry.v8Revision !== V8_REVISION) problems.push(`registry v8Revision ${registry.v8Revision} is not ${V8_REVISION}`);

  // Entry shape and licence.
  const seen = new Set<string>();
  for (const e of registry.entries) {
    const at = `entry ${e.upstream}`;
    if (seen.has(e.upstream)) problems.push(`${at}: listed twice`);
    seen.add(e.upstream);
    if (!UPSTREAM_ROOTS.some((r) => e.upstream.startsWith(r))) problems.push(`${at}: not under ${UPSTREAM_ROOTS.join(', ')}`);
    if (!/\.(cc|cpp|h)$/.test(e.upstream)) problems.push(`${at}: not a .cc/.cpp/.h file`);
    if (!LICENCES.includes(e.licence)) problems.push(`${at}: licence ${e.licence} is not one of ${LICENCES.join(', ')}`);
    else if (!PHRASE[e.licence]!.test(e.licencePhrase)) problems.push(`${at}: licence phrase "${e.licencePhrase}" does not match licence ${e.licence}`);
    if (/General Public License/.test(e.licencePhrase) && e.licence !== 'lgpl') problems.push(`${at}: GPL-family phrase recorded as ${e.licence}`);
    if (e.licence === 'bsd-skia' !== e.upstream.startsWith('third_party/skia/')) problems.push(`${at}: bsd-skia is for third_party/skia files only`);
    const ported = e.dragon.some((d) => d.use === 'port');
    if (e.licence === 'lgpl') {
      if (!e.ruling) problems.push(`${at}: LGPL-headered upstream file without a ruling; the 2026-09-30 decision does not allow porting it`);
      else if (e.ruling.class === 'A' && ported) problems.push(`${at}: class A LGPL entry with a port use; Dragon may only reference it`);
      else if (e.ruling.class === 'B' && !cleanRoom.includes(e.upstream)) problems.push(`${at}: class B LGPL entry not on KNOWN_LGPL_CLEAN_ROOM`);
      else if (e.ruling.class === 'C') problems.push(`${at}: class C is for BSD files, not LGPL ones`);
      if (ported && !cleanRoom.includes(e.upstream)) problems.push(`${at}: LGPL-headered upstream file with a port use; the 2026-09-30 decision does not allow porting it`);
      if (e.noticeText !== undefined) problems.push(`${at}: an LGPL entry has no notice text (nothing is ported from it)`);
    } else {
      if (e.ruling && e.ruling.class !== 'C') problems.push(`${at}: a ruling on a permissive entry is class C, not ${e.ruling.class}`);
      if (e.noticeText === undefined || !(e.noticeText in registry.licenceTexts)) problems.push(`${at}: noticeText ${e.noticeText} is not in licenceTexts`);
      else if (!NOTICE_PREFIX[e.licence]?.test(e.noticeText)) problems.push(`${at}: noticeText ${e.noticeText} does not fit licence ${e.licence}`);
    }
    if (e.ruling) {
      if (!['A', 'B', 'C'].includes(e.ruling.class)) problems.push(`${at}: ruling class ${e.ruling.class}`);
      if (!e.ruling.basis) problems.push(`${at}: ruling without a basis`);
      if (e.ruling.proof.length === 0 && !e.ruling.note) problems.push(`${at}: a ruling with no proof test says why in a note`);
      for (const p of e.ruling.proof) {
        const bad = proofProblem(p, read);
        if (bad) problems.push(`${at}: ${bad}`);
      }
      if (e.ruling.class === 'B' && e.ruling.task !== CLEAN_ROOM_TASK) problems.push(`${at}: class B ruling not tied to ${CLEAN_ROOM_TASK}`);
    }
    // A permissive notice other than Chromium's or Skia's LICENSE file stays in each Dragon file that ports from the entry.
    if (NOTICE_IN_FILE.includes(e.licence)) {
      for (const f of new Set(e.dragon.filter((d) => d.use === 'port').map((d) => d.file))) {
        if (!(sources.get(f) ?? '').includes(e.copyright)) problems.push(`${at}: ${f} ports it without its notice (${e.copyright})`);
      }
    }
    if (!/^Copyright/.test(e.copyright)) problems.push(`${at}: no copyright line recorded`);
    for (const k of ['fileSha256', 'headerSha256'] as const) if (!/^[0-9a-f]{64}$/.test(e[k])) problems.push(`${at}: ${k} is not a sha256`);
    if (e.ranges.length === 0) problems.push(`${at}: no line range`);
    for (const r of e.ranges) {
      const m = /^(\d+)-(\d+)$/.exec(r.lines);
      if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) problems.push(`${at}: bad line range ${r.lines}`);
      if (!['cited', 'located', 'whole-file'].includes(r.source)) problems.push(`${at}: range source ${r.source}`);
      if (r.source === 'located' && !r.symbol) problems.push(`${at}: a located range names its upstream symbol`);
      if (r.source === 'whole-file' && (e.ranges.length !== 1 || !r.lines.startsWith('1-'))) problems.push(`${at}: a whole-file range stands alone and starts at 1`);
    }
    if (e.dragon.length === 0) problems.push(`${at}: no Dragon file`);
    for (const alias of e.citedAs ?? []) {
      if (alias.includes('/') || alias === baseName(e.upstream)) problems.push(`${at}: citedAs ${alias} is not an old file name`);
    }
  }
  for (const p of cleanRoom) {
    const e = registry.entries.find((x) => x.upstream === p);
    if (!e || e.licence !== 'lgpl' || e.ruling?.class !== 'B') problems.push(`clean-room file ${p} is not a class B LGPL registry entry (drop it from KNOWN_LGPL_CLEAN_ROOM)`);
  }
  const usedTexts = new Set(registry.entries.map((e) => e.noticeText));
  for (const id of Object.keys(registry.licenceTexts)) if (!usedTexts.has(id)) problems.push(`licence text ${id} is used by no entry`);

  // Every citation resolves to exactly one entry that lists the citing file.
  const citedPairs = new Set<string>(); // `${file}\0${upstream}`
  const notChromeUsed = new Set<string>();
  for (const [file, text] of sources) {
    for (const c of citationsIn(file, text)) {
      const where = `${c.file}:${c.line} cites ${c.token}`;
      const nc = registry.notChrome.find((n) => n.cited === baseName(c.path));
      if (nc) {
        if (!nc.files.includes(c.file)) problems.push(`${where}: listed under notChrome, but ${c.file} is not among its files`);
        notChromeUsed.add(`${c.file}\0${nc.cited}`);
        continue;
      }
      const hits = resolve(registry, c.path);
      if (hits.length === 0) {
        problems.push(`${where}: no registry entry (add it to docs/ports.json with its tag ${TAG} file, licence, sha256 and line range)`);
        continue;
      }
      if (hits.length > 1) {
        problems.push(`${where}: ambiguous (${hits.map((h) => h.upstream).join(', ')}); cite the full upstream path`);
        continue;
      }
      const e = hits[0]!;
      citedPairs.add(`${c.file}\0${e.upstream}`);
      if (!e.dragon.some((d) => d.file === c.file)) problems.push(`${where}: entry ${e.upstream} does not list ${c.file}`);
    }
  }

  // Every Dragon reference exists and still cites its upstream file.
  const names = new Map<string, Set<string>>();
  for (const e of registry.entries) {
    for (const d of e.dragon) {
      const at = `entry ${e.upstream} -> ${d.file}${d.symbol ? ` ${d.symbol}` : ''}`;
      if (!['port', 'reference'].includes(d.use)) problems.push(`${at}: use ${d.use}`);
      const text = sources.get(d.file);
      if (text === undefined) {
        problems.push(`${at}: the Dragon file no longer exists`);
        continue;
      }
      if (d.symbol !== null) {
        if (!names.has(d.file)) names.set(d.file, declaredNames(d.file, text));
        if (!names.get(d.file)!.has(d.symbol)) problems.push(`${at}: ${d.symbol} is no longer declared in ${d.file}`);
      }
      if (!citedPairs.has(`${d.file}\0${e.upstream}`)) problems.push(`${at}: ${d.file} no longer cites this file`);
    }
  }
  for (const n of registry.notChrome) {
    for (const f of n.files) if (!notChromeUsed.has(`${f}\0${n.cited}`)) problems.push(`notChrome ${n.cited} -> ${f}: no longer cited there`);
  }
  return problems;
}

function loadRegistry(): Registry {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry;
}

function loadSources(): Map<string, string> {
  return new Map(sourceFiles().map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
}

describe('PORT-0: the Chrome ports registry (docs/ports.json)', () => {
  const registry = loadRegistry();
  const sources = loadSources();

  it('lists every cited Chrome file with a permissive licence, and every Dragon reference exists', () => {
    expect(audit(registry, sources, KNOWN_LGPL_CLEAN_ROOM)).toEqual([]);
  });

  it('records a ruling for every LGPL entry: class A ones only referenced, class B ones on the clean-room list for T123', () => {
    const lgpl = registry.entries.filter((e) => e.licence === 'lgpl');
    expect(lgpl.length).toBe(19); // the 18 T118J rulings and computed_style_constants.h (cited by V2a after them)
    expect(lgpl.filter((e) => e.ruling?.class === 'B').map((e) => e.upstream).sort()).toEqual([...KNOWN_LGPL_CLEAN_ROOM].sort());
    for (const e of lgpl.filter((x) => x.ruling?.class === 'A')) expect(e.dragon.map((d) => d.use), e.upstream).not.toContain('port');
  });

  it('fails on a citation the registry does not list', () => {
    const planted = new Map(sources);
    planted.set('packages/layout/src/planted.ts', '// Blink third_party/blink/renderer/core/layout/planted_algorithm.cc Planted()\nexport const planted = 1;\n');
    expect(audit(registry, planted, KNOWN_LGPL_CLEAN_ROOM)).toEqual([
      'packages/layout/src/planted.ts:1 cites third_party/blink/renderer/core/layout/planted_algorithm.cc: no registry entry (add it to docs/ports.json with its tag 145.0.7632.6 file, licence, sha256 and line range)',
    ]);
    // A known entry cited from a file the entry does not list fails too.
    planted.set('packages/layout/src/planted.ts', '// SkBlurMask.cpp\nexport const planted = 1;\n');
    expect(audit(registry, planted, KNOWN_LGPL_CLEAN_ROOM)).toEqual([
      'packages/layout/src/planted.ts:1 cites SkBlurMask.cpp: entry third_party/skia/src/core/SkBlurMask.cpp does not list packages/layout/src/planted.ts',
    ]);
  });

  it('fails on an LGPL entry used as a port, off the clean-room list or without a ruling', () => {
    const withEntry = (e: Entry): Registry => ({ ...registry, entries: [...registry.entries, e] });
    const lgpl = registry.entries.find((e) => e.licence === 'lgpl' && e.ruling?.class === 'A')!;
    const cited = { ...lgpl, upstream: 'third_party/blink/renderer/core/layout/layout_block.cc', dragon: [] as DragonRef[] };
    const { ruling: _ruling, ...unruled } = cited;
    expect(audit(withEntry(unruled), sources, KNOWN_LGPL_CLEAN_ROOM)).toContain(
      'entry third_party/blink/renderer/core/layout/layout_block.cc: LGPL-headered upstream file without a ruling; the 2026-09-30 decision does not allow porting it',
    );
    // A class A entry that Dragon ports from.
    const portedA: Registry = { ...registry, entries: registry.entries.map((e) => (e === lgpl ? { ...e, dragon: e.dragon.map((d) => ({ ...d, use: 'port' as const })) } : e)) };
    expect(audit(portedA, sources, KNOWN_LGPL_CLEAN_ROOM)).toEqual([
      `entry ${lgpl.upstream}: class A LGPL entry with a port use; Dragon may only reference it`,
      `entry ${lgpl.upstream}: LGPL-headered upstream file with a port use; the 2026-09-30 decision does not allow porting it`,
    ]);
    // A class B entry dropped from the clean-room list.
    const b = KNOWN_LGPL_CLEAN_ROOM[0]!;
    expect(audit(registry, sources, KNOWN_LGPL_CLEAN_ROOM.slice(1))).toEqual([
      `entry ${b}: class B LGPL entry not on KNOWN_LGPL_CLEAN_ROOM`,
      `entry ${b}: LGPL-headered upstream file with a port use; the 2026-09-30 decision does not allow porting it`,
    ]);
    // Recording an LGPL header as BSD is caught by the phrase.
    const relabelled: Registry = { ...registry, entries: registry.entries.map((e) => (e === lgpl ? (({ ruling: _r, ...rest }) => ({ ...rest, licence: 'bsd-chromium', noticeText: 'chromium-bsd' }))(e) : e)) };
    expect(audit(relabelled, sources, KNOWN_LGPL_CLEAN_ROOM)).toContain(`entry ${lgpl.upstream}: GPL-family phrase recorded as bsd-chromium`);
  });

  it('fails when a ruling names a proof test that does not exist', () => {
    const e = registry.entries.find((x) => x.ruling && x.ruling.proof.length > 0)!;
    const missing: Registry = { ...registry, entries: registry.entries.map((x) => (x === e ? { ...x, ruling: { ...x.ruling!, proof: [...x.ruling!.proof, 'packages/layout/test/no-such.test.ts'] } } : x)) };
    expect(audit(missing, sources, KNOWN_LGPL_CLEAN_ROOM)).toEqual([`entry ${e.upstream}: proof file packages/layout/test/no-such.test.ts does not exist`]);
    expect(proofProblem('packages/dragon/test/units.test.ts:1-999999', readRepo)).toBe('proof packages/dragon/test/units.test.ts:1-999999: packages/dragon/test/units.test.ts has fewer than 999999 lines');
    expect(proofProblem('packages/dragon/test/fonts/units.test.ts#no such describe', readRepo)).toBe('proof packages/dragon/test/fonts/units.test.ts#no such describe: packages/dragon/test/fonts/units.test.ts does not contain "no such describe"');
  });

  it('keeps the rapidhash and fdlibm notices in the files that port them', () => {
    for (const kind of NOTICE_IN_FILE) {
      const e = registry.entries.find((x) => x.licence === kind)!;
      expect(e, kind).toBeDefined();
      const stripped = new Map(sources);
      const port = e.dragon.find((d) => d.use === 'port')!;
      stripped.set(port.file, sources.get(port.file)!.replace(e.copyright, 'Copyright (C) someone else'));
      expect(audit(registry, stripped, KNOWN_LGPL_CLEAN_ROOM)).toEqual([`entry ${e.upstream}: ${port.file} ports it without its notice (${e.copyright})`]);
    }
    expect(audit({ ...registry, v8Revision: 'main' }, sources, KNOWN_LGPL_CLEAN_ROOM)).toEqual([`registry v8Revision main is not ${V8_REVISION}`]);
  });

  it('review skips the generated THIRD_PARTY_NOTICES.md but reads the registry, its generator and this test', () => {
    const ignore = parseIgnoreFile(readFileSync(join(ROOT, '.macroscope', 'ignore.md'), 'utf8'));
    expect(ignore.matches(NOTICES_PATH)).toBe(true);
    for (const f of ['docs/ports.json', 'scripts/gen-third-party-notices.ts', SELF]) expect(ignore.matches(f), f).toBe(false);
  });

  it('THIRD_PARTY_NOTICES.md is what scripts/gen-third-party-notices.ts writes from docs/ports.json (pnpm notices:gen)', () => {
    expect(readFileSync(join(ROOT, NOTICES_PATH), 'utf8')).toBe(currentNotices(ROOT));
    // Every permissive entry's copyright line is in it, and no LGPL entry is.
    const notices = currentNotices(ROOT);
    for (const e of registry.entries) {
      if (e.licence === 'lgpl') expect(notices, e.upstream).not.toContain(`\`${e.upstream}\``);
      else expect(notices, e.upstream).toContain(`- \`${e.upstream}\`: ${e.copyright}`);
    }
    const changed = thirdPartyNotices({ ...registry, entries: registry.entries.map((e, i) => (i === 0 ? { ...e, copyright: 'Copyright 1999 Planted' } : e)) }, readFileSync(join(ROOT, 'vendor', 'harfbuzz', 'COPYING'), 'utf8'));
    expect(changed).not.toBe(notices);
    // Bad input is refused, never written out.
    const harfbuzz = readFileSync(join(ROOT, 'vendor', 'harfbuzz', 'COPYING'), 'utf8');
    expect(() => thirdPartyNotices({ ...registry, entries: [{ ...registry.entries[0]!, copyright: '' }] }, harfbuzz)).toThrow('no copyright line');
    expect(() => thirdPartyNotices({ ...registry, entries: [{ ...registry.entries[0]!, noticeText: 'no-such-text' }] }, harfbuzz)).toThrow('is not in licenceTexts');
    const { noticeText: _n, ...noText } = registry.entries[0]!;
    expect(() => thirdPartyNotices({ ...registry, entries: [noText] }, harfbuzz)).toThrow('no noticeText');
    expect(() => thirdPartyNotices(registry, 'not a licence')).toThrow('not the HarfBuzz MIT licence');
    const { v8Revision: _v, ...noV8 } = registry;
    expect(() => thirdPartyNotices(noV8 as unknown as Registry, harfbuzz)).toThrow('docs/ports.json: no v8Revision');
  });

  it('fails when a Dragon file or declaration is gone', () => {
    const e = registry.entries.find((x) => x.dragon.some((d) => d.symbol !== null))!;
    const ref = e.dragon.find((d) => d.symbol !== null)!;
    const renamed: Registry = { ...registry, entries: registry.entries.map((x) => (x === e ? { ...x, dragon: x.dragon.map((d) => (d === ref ? { ...d, symbol: 'noSuchDeclaration' } : d)) } : x)) };
    expect(audit(renamed, sources, KNOWN_LGPL_CLEAN_ROOM)).toEqual([`entry ${e.upstream} -> ${ref.file} noSuchDeclaration: noSuchDeclaration is no longer declared in ${ref.file}`]);
    const moved: Registry = { ...registry, entries: registry.entries.map((x) => (x === e ? { ...x, dragon: [...x.dragon, { file: 'packages/layout/src/gone.ts', symbol: null, use: 'port' as const }] } : x)) };
    expect(audit(moved, sources, KNOWN_LGPL_CLEAN_ROOM)).toEqual([`entry ${e.upstream} -> packages/layout/src/gone.ts: the Dragon file no longer exists`]);
  });

  it('reads citations from comments and strings, never from code', () => {
    const text = "// see shape_result.cc:10-20\nconst h = box.h + 'SkDraw.cpp';\nconst w = i.h;\n";
    expect(citationsIn('x.ts', text).map((c) => c.token)).toEqual(['shape_result.cc:10-20', 'SkDraw.cpp']);
    const swift = 'let h = box.h // Blink line_breaker.cc\n/* SkBlurMask.cpp:1-2 */ let s = "ui/gfx/geometry/cubic_bezier.cc"\n';
    expect(citationsIn('x.swift', swift).map((c) => `${c.line} ${c.token}`)).toEqual(['1 line_breaker.cc', '2 SkBlurMask.cpp:1-2', '2 ui/gfx/geometry/cubic_bezier.cc']);
    expect(existsSync(REGISTRY_PATH)).toBe(true);
  });
});
