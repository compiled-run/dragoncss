// PORT-0 (T118): the checked registry of every Chrome source file Dragon cites (docs/ports.json, described in docs/ports.md).
// The decision "Porting Chrome's algorithms (owner, 2026-09-30)" in docs/decisions.md: port only BSD-style files at the pinned
// 145.0.7632.6 tag, never LGPL ones, and record the upstream file, tag and line range of each port. This test works offline from
// the recorded data. It fails when:
//   - a source file cites a .cc/.cpp/.h file (in a comment or a string) that no registry entry names for that file;
//   - a registry entry names an LGPL-headered upstream file that is not on the named pending-ruling list below;
//   - a registry entry points at a Dragon file or declaration that no longer exists, or that no longer cites it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(ROOT, 'docs', 'ports.json');

const TAG = '145.0.7632.6';
const SKIA_REVISION = '2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23'; // Chromium 145.0.7632.6 DEPS skia_revision

// The licence header kinds. `lgpl` is recorded so the registry documents it; it is never an allowed port source.
const PERMISSIVE = ['bsd-chromium', 'bsd-skia', 'bsd-google', 'bsd-apple', 'bsd-other', 'mit-harfbuzz'] as const;
const LICENCES: readonly string[] = [...PERMISSIVE, 'lgpl'];
const PHRASE: Record<string, RegExp> = {
  'bsd-chromium': /^(Use of this source code is governed by a BSD-style license|Redistributions of source code must retain the above copyright)$/,
  'bsd-skia': /^Use of this source code is governed by a BSD-style license$/,
  'bsd-google': /^Redistributions of source code must retain the above copyright$/,
  'bsd-apple': /^Redistributions of source code must retain the above copyright$/,
  'bsd-other': /^Redistributions of source code must retain the above copyright$/,
  'mit-harfbuzz': /^Permission is hereby granted/,
  lgpl: /^GNU (Library|Lesser) General Public License$/,
};

// Existing citations of LGPL-headered files found when PORT-0 seeded the registry (T118). The code was not changed; each waits on a
// PM ruling. A new LGPL entry fails until it is ruled on and named here.
const KNOWN_LGPL_PENDING_RULING: readonly string[] = [
  'third_party/blink/renderer/core/css/css_markup.cc',
  'third_party/blink/renderer/core/css/css_primitive_value.cc',
  'third_party/blink/renderer/core/css/css_primitive_value.h',
  'third_party/blink/renderer/core/css/selector_checker.cc',
  'third_party/blink/renderer/core/frame/local_frame_view.cc',
  'third_party/blink/renderer/core/html/forms/html_button_element.cc',
  'third_party/blink/renderer/core/html/forms/step_range.cc',
  'third_party/blink/renderer/core/html/forms/step_range.h',
  'third_party/blink/renderer/core/html/html_document.cc',
  'third_party/blink/renderer/core/layout/layout_text.cc',
  'third_party/blink/renderer/core/layout/layout_theme.cc',
  'third_party/blink/renderer/core/layout/layout_view.cc',
  'third_party/blink/renderer/core/style/computed_style.cc',
  'third_party/blink/renderer/core/style/computed_style.h',
  'third_party/blink/renderer/platform/geometry/length_functions.cc',
  'third_party/blink/renderer/platform/image-decoders/image_decoder.cc',
  'third_party/blink/renderer/platform/text/text_break_iterator.cc',
  'third_party/blink/renderer/platform/wtf/hash_table.h',
];

// Upstream roots inside the Chromium tree at the tag (third_party/skia is resolved at the DEPS-pinned Skia revision).
const UPSTREAM_ROOTS = ['third_party/blink/', 'third_party/skia/', 'ui/gfx/', 'cc/', 'third_party/rapidhash/', 'third_party/harfbuzz-ng/'];

interface Range { lines: string; symbol: string | null; source: 'cited' | 'located' | 'whole-file' }
interface DragonRef { file: string; symbol: string | null; use: 'port' | 'reference' }
interface Entry {
  upstream: string;
  citedAs?: string[];
  licence: string;
  ruling?: string;
  licencePhrase: string;
  copyright: string;
  fileSha256: string;
  headerSha256: string;
  ranges: Range[];
  dragon: DragonRef[];
}
interface NotChrome { cited: string; source: string; files: string[] }
export interface Registry { about: string; tag: string; skiaRevision: string; sources: Record<string, string>; entries: Entry[]; notChrome: NotChrome[] }

// Source files scanned for citations: every TypeScript, Swift, Kotlin or Java file under packages/, scripts/ and examples/ that git
// tracks or would track (.gitignore'd output is skipped). Generated native output is regenerated from the TypeScript, so it is covered
// by its sources.
const SCAN_TOPS = ['packages', 'scripts', 'examples'];
const SKIP_DIRS = ['node_modules', 'dist', 'dist-test', 'build', '.build', 'generated'];

function sourceFiles(): string[] {
  const git = (args: string[]) => execFileSync('git', ['-C', ROOT, 'ls-files', '-z', ...args, '--', ...SCAN_TOPS], { encoding: 'utf8' }).split('\0');
  const files = new Set([...git(['--cached']), ...git(['--others', '--exclude-standard'])]);
  return [...files]
    .filter((f) => f !== '' && f !== SELF && /\.(ts|mts|swift|kt|java)$/.test(f) && !f.endsWith('.d.ts'))
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
  if (!/\.m?ts$/.test(file)) return nativeCitationsIn(file, text);
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
  if (!/\.m?ts$/.test(file)) {
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
export function audit(registry: Registry, sources: ReadonlyMap<string, string>, knownLgpl: readonly string[]): string[] {
  const problems: string[] = [];
  if (registry.tag !== TAG) problems.push(`registry tag ${registry.tag} is not the pinned ${TAG}`);
  if (registry.skiaRevision !== SKIA_REVISION) problems.push(`registry skiaRevision ${registry.skiaRevision} is not ${SKIA_REVISION}`);

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
    if (e.licence === 'lgpl') {
      if (!knownLgpl.includes(e.upstream)) problems.push(`${at}: LGPL-headered upstream file; the 2026-09-30 decision does not allow porting it`);
      if (!e.ruling) problems.push(`${at}: LGPL entry without a ruling note`);
    } else if (e.ruling) problems.push(`${at}: ruling note on a non-LGPL entry`);
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
  for (const p of knownLgpl) {
    const e = registry.entries.find((x) => x.upstream === p);
    if (!e || e.licence !== 'lgpl') problems.push(`known LGPL exception ${p} is not an LGPL registry entry (drop it from KNOWN_LGPL_PENDING_RULING)`);
  }

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
    expect(audit(registry, sources, KNOWN_LGPL_PENDING_RULING)).toEqual([]);
  });

  it('records the header kinds found at the tag, the LGPL ones only as named pending findings', () => {
    const counts: Record<string, number> = {};
    for (const e of registry.entries) counts[e.licence] = (counts[e.licence] ?? 0) + 1;
    expect(registry.entries.length).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    expect(registry.entries.filter((e) => e.licence === 'lgpl').map((e) => e.upstream).sort()).toEqual([...KNOWN_LGPL_PENDING_RULING].sort());
  });

  it('fails on a citation the registry does not list', () => {
    const planted = new Map(sources);
    planted.set('packages/layout/src/planted.ts', '// Blink third_party/blink/renderer/core/layout/planted_algorithm.cc Planted()\nexport const planted = 1;\n');
    expect(audit(registry, planted, KNOWN_LGPL_PENDING_RULING)).toEqual([
      'packages/layout/src/planted.ts:1 cites third_party/blink/renderer/core/layout/planted_algorithm.cc: no registry entry (add it to docs/ports.json with its tag 145.0.7632.6 file, licence, sha256 and line range)',
    ]);
    // A known entry cited from a file the entry does not list fails too.
    planted.set('packages/layout/src/planted.ts', '// SkBlurMask.cpp\nexport const planted = 1;\n');
    expect(audit(registry, planted, KNOWN_LGPL_PENDING_RULING)).toEqual([
      'packages/layout/src/planted.ts:1 cites SkBlurMask.cpp: entry third_party/skia/src/core/SkBlurMask.cpp does not list packages/layout/src/planted.ts',
    ]);
  });

  it('fails on an LGPL entry that is not a named pending finding', () => {
    const entry = registry.entries.find((e) => e.licence === 'lgpl')!;
    const without = KNOWN_LGPL_PENDING_RULING.filter((p) => p !== entry.upstream);
    expect(audit(registry, sources, without)).toEqual([`entry ${entry.upstream}: LGPL-headered upstream file; the 2026-09-30 decision does not allow porting it`]);
    // Recording an LGPL header as BSD is caught by the phrase.
    const relabelled: Registry = { ...registry, entries: registry.entries.map((e) => (e === entry ? (({ ruling: _ruling, ...rest }) => ({ ...rest, licence: 'bsd-chromium' }))(e) : e)) };
    expect(audit(relabelled, sources, without)).toContain(`entry ${entry.upstream}: GPL-family phrase recorded as bsd-chromium`);
  });

  it('fails when a Dragon file or declaration is gone', () => {
    const e = registry.entries.find((x) => x.dragon.some((d) => d.symbol !== null))!;
    const ref = e.dragon.find((d) => d.symbol !== null)!;
    const renamed: Registry = { ...registry, entries: registry.entries.map((x) => (x === e ? { ...x, dragon: x.dragon.map((d) => (d === ref ? { ...d, symbol: 'noSuchDeclaration' } : d)) } : x)) };
    expect(audit(renamed, sources, KNOWN_LGPL_PENDING_RULING)).toEqual([`entry ${e.upstream} -> ${ref.file} noSuchDeclaration: noSuchDeclaration is no longer declared in ${ref.file}`]);
    const moved: Registry = { ...registry, entries: registry.entries.map((x) => (x === e ? { ...x, dragon: [...x.dragon, { file: 'packages/layout/src/gone.ts', symbol: null, use: 'port' as const }] } : x)) };
    expect(audit(moved, sources, KNOWN_LGPL_PENDING_RULING)).toEqual([`entry ${e.upstream} -> packages/layout/src/gone.ts: the Dragon file no longer exists`]);
  });

  it('reads citations from comments and strings, never from code', () => {
    const text = "// see shape_result.cc:10-20\nconst h = box.h + 'SkDraw.cpp';\nconst w = i.h;\n";
    expect(citationsIn('x.ts', text).map((c) => c.token)).toEqual(['shape_result.cc:10-20', 'SkDraw.cpp']);
    const swift = 'let h = box.h // Blink line_breaker.cc\n/* SkBlurMask.cpp:1-2 */ let s = "ui/gfx/geometry/cubic_bezier.cc"\n';
    expect(citationsIn('x.swift', swift).map((c) => `${c.line} ${c.token}`)).toEqual(['1 line_breaker.cc', '2 SkBlurMask.cpp:1-2', '2 ui/gfx/geometry/cubic_bezier.cc']);
    expect(existsSync(REGISTRY_PATH)).toBe(true);
  });
});
