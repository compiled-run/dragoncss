// P4 (notes/T013-p3-review-p4-plan.md section 2 items 1 and 2): one lowered program per backend from the one native layout tree,
// the emitted Swift and Kotlin (typed engine constructors, no CSS, selector, class name or JSON decoding), and the checked int
// conversion, which traps on 1.5 and on 2^31 in both languages on the host.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkedConversionSource, inputFunctions, STYLE_FIELDS } from '../src/emit/native-support.ts';
import type { EmitCase, NativeProgram } from '../src/internal.ts';
import { createProjectWith, emitAndroidViewsCases, emitNativeSupport, emitUikitCases, nativeLayoutProjection, nativePrograms, NO_FAULTS, VOCABULARY, WRITE_CSS } from '../src/internal.ts';
import { div, inputFor, text } from './helpers.ts';
import { movingTransforms } from '../src/lower/native-program.ts';
import { internalRecord } from '../src/project.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CSS = 'body { margin: 0; font-family: Ahem; font-size: 10px; color: navy; } .a { width: 50%; padding: 3px; border: 1px dashed red; background-color: #3366ff; } .b { display: flex; gap: 2px; overflow: hidden; border-style: dotted solid double none; } .c { border-top: 2px solid; }';
const input = inputFor(CSS, (r) => [div(r, 'a', ['a'], [text(r, 't', 'AB CD')]), div(r, 'b', ['b'], [div(r, 'c', ['c']), text(r, 'u', 'X')])]);
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const both = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);

function programs() {
  const p = nativePrograms(both(), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('the lowered programs', () => {
  it('both backends come from the one native layout tree: same root object, same node ids, kinds, parents and write kinds', () => {
    const c = both();
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const proj = nativeLayoutProjection(c, ENV, []);
    if (proj.kind !== 'ready') throw new Error(proj.reason);
    expect(p.programs.uikit.root).toBe(proj.input.root);
    expect(p.programs['android-views'].root).toBe(proj.input.root);
    const shape = (x: NativeProgram) => x.nodes.map((n) => [n.id, n.kind, n.parent, n.clips, n.text, n.writes.map((w) => [w.kind, w.css, w.technique])]);
    expect(shape(p.programs.uikit)).toEqual(shape(p.programs['android-views']));
    expect(p.programs.uikit.version).toBe('dragon.uikit-program/1');
    expect(p.programs['android-views'].version).toBe('dragon.android-views-program/1');
  });
  it('every write has a backend key, a technique and CSS longhands; borders are Dragon-owned paint on both, the clip is on the padding box', () => {
    const p = programs();
    for (const prog of [p.uikit, p['android-views']]) {
      for (const n of prog.nodes) {
        for (const w of n.writes) {
          expect(w.key).toBe(VOCABULARY[prog.backend][w.kind].key);
          expect(w.css).toEqual(WRITE_CSS[w.kind]);
          if (w.kind.startsWith('border-')) expect(w.technique).toBe('dragon-owned-paint');
        }
      }
      const b = prog.nodes.find((n) => n.id === 'b');
      expect(b?.clips).toBe(true);
      expect(b?.writes.map((w) => w.kind)).toContain('padding-box-clip');
      expect(b?.writes.find((w) => w.kind === 'border-styles')).toMatchObject({ styles: ['dotted', 'solid', 'double', 'none'] });
      expect(prog.nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'border-styles')).toMatchObject({ styles: ['dashed', 'dashed', 'dashed', 'dashed'] });
      expect(prog.nodes.find((n) => n.id === 'a:text0')?.writes).toMatchObject([{ kind: 'font', font: { family: 'Ahem', size: 10 } }, { kind: 'text-color', color: { r: 0, g: 0, b: 128, alpha: 255 } }]);
    }
  });
  it('programs need both native targets checked; a web-only or ios-only result has none', () => {
    const iosOnly = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    expect(nativePrograms(iosOnly, [])).toMatchObject({ kind: 'blocked', reason: 'the android target is not configured' });
    expect(nativePrograms({}, []).kind).toBe('blocked');
  });
});

function emitCase(p: NativeProgram): EmitCase {
  return { id: 'case-1', fixture: 'fixture-1', direction: 'ltr', compilerDigest: 'digest', viewport: { width: 400, height: 300 }, program: p, expectedDigests: [{ dpr: 2, sha256: 'x'.repeat(64) }, { dpr: 3, sha256: 'y'.repeat(64) }] };
}

describe('the emitted Swift and Kotlin', () => {
  it('build the engine input with typed constructors and the native tree with property writes; no stylesheet, selector or JSON decoding', () => {
    const p = programs();
    const swift = emitUikitCases([emitCase(p.uikit)]).map((f) => f.text).join('\n');
    const kotlin = emitAndroidViewsCases([emitCase(p['android-views'])]).map((f) => f.text).join('\n');
    expect(swift).toContain('LayoutStyle(JsString("block")');
    // The background writer is the module's runtime writer on both backends (PNT1: a rounded box paints its colour itself).
    expect(swift).toMatch(/dragonBackground\(v\d+, DragonRGBA8\(51, 102, 255, 255\)\)/);
    expect(swift).toContain('.dragonEnableClip()');
    expect(kotlin).toContain('LayoutStyle("block"');
    expect(kotlin).toContain('dragonBackground(v');
    expect(kotlin).toContain('.dragonBorderStyles = arrayOf("dotted", "solid", "double", "none")');
    const support = [...emitNativeSupport('uikit'), ...emitNativeSupport('android-views')].map((f) => f.text).join('\n');
    for (const src of [swift, kotlin, support]) {
      expect(src).not.toMatch(/JSONDecoder|JSONSerialization|JSONObject|org\.json|kotlinx\.serialization|Codable|Decodable/);
      for (const rule of CSS.split('}').map((r) => r.trim()).filter((r) => r.length > 0)) expect(src).not.toContain(rule);
    }
    for (const src of [swift, kotlin]) for (const cls of ['a', 'b', 'c']) expect(src).not.toMatch(new RegExp(`\\.${cls}(?![\\w-])`));
  });
});

describe('the LayoutStyle constructor arguments', () => {
  it('STYLE_FIELDS names every LayoutStyle field of input.ts, in declaration order (the translated constructor order)', () => {
    const src = readFileSync(join(root, 'packages/layout/src/input.ts'), 'utf8');
    const body = /export type LayoutStyle = \{\n([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
    const fields = [...body.matchAll(/^ {2}readonly (\w+):/gm)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(40);
    expect([...STYLE_FIELDS]).toEqual(fields);
  });
  it('an aspect ratio is its typed constructor on both backends: ratio, auto-ratio, and auto for a box without one, before the null grid fields', () => {
    const css = 'body { margin: 0; } .a { width: 64px; aspect-ratio: 16 / 9; } .b { width: 64px; aspect-ratio: auto 2 / 1; }';
    const ratioInput = inputFor(css, (r) => [div(r, 'a', ['a']), div(r, 'b', ['b'])]);
    const p = nativePrograms(createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(ratioInput), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const swift = emitUikitCases([emitCase(p.programs.uikit)]).map((f) => f.text).join('\n');
    const kotlin = emitAndroidViewsCases([emitCase(p.programs['android-views'])]).map((f) => f.text).join('\n');
    expect(swift).toContain('AspectRatioValue_ratio(JsString("ratio"), 1024.0, 576.0), nil, nil)');
    expect(swift).toContain('AspectRatioValue_autoRatio(JsString("auto-ratio"), 128.0, 64.0), nil, nil)');
    expect(swift).toContain('JsString("start"), Auto(JsString("auto")), nil, nil)');
    expect(kotlin).toContain('AspectRatioValue_ratio("ratio", 1024.0, 576.0), null, null)');
    expect(kotlin).toContain('AspectRatioValue_autoRatio("auto-ratio", 128.0, 64.0), null, null)');
  });
});

type Tool = { readonly ok: boolean; readonly why: string };

// Linux Swift's runtime backtracer symbolicates every trap before exiting, which ate the CI time budget.
const NO_BACKTRACE = { ...process.env, SWIFT_BACKTRACE: 'enable=no' };

function trapRun(lang: 'swift' | 'kotlin', dir: string): { tool: Tool; outcomes: { arg: string; status: number; out: string }[] } {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const args = ['7', '1.5', '2147483648', '-2147483649', '-2147483648'];
  if (lang === 'swift') {
    writeFileSync(join(dir, 'Checked.swift'), checkedConversionSource('uikit'));
    writeFileSync(join(dir, 'main.swift'), 'import Foundation\nlet v = Double(CommandLine.arguments[1])!\nprint(dragonCheckedInt(v, "test"))\n');
    const c = spawnSync('swiftc', ['-O', '-o', join(dir, 'checked'), join(dir, 'Checked.swift'), join(dir, 'main.swift')], { encoding: 'utf8' });
    if (c.status !== 0) return { tool: { ok: false, why: `swiftc: ${c.stderr ?? c.error}` }, outcomes: [] };
    return { tool: { ok: true, why: '' }, outcomes: args.map((arg) => { const r = spawnSync(join(dir, 'checked'), [arg], { encoding: 'utf8', env: NO_BACKTRACE }); return { arg, status: r.status ?? -1, out: `${r.stdout}${r.stderr}` }; }) };
  }
  const javaHome = process.env['JAVA_HOME'];
  const which = spawnSync('which', ['kotlinc'], { encoding: 'utf8' });
  if (javaHome === undefined || which.status !== 0) return { tool: { ok: false, why: 'no JAVA_HOME or kotlinc' }, outcomes: [] };
  writeFileSync(join(dir, 'Checked.kt'), checkedConversionSource('android-views'));
  writeFileSync(join(dir, 'Main.kt'), 'package dev.dragon.views\n\nfun main(args: Array<String>) {\n  println(dragonCheckedInt(args[0].toDouble(), "test"))\n}\n');
  const jar = join(dir, 'checked.jar');
  const env = { ...process.env, JAVA_HOME: javaHome };
  const c = spawnSync(which.stdout.trim(), ['-include-runtime', '-d', jar, join(dir, 'Checked.kt'), join(dir, 'Main.kt')], { encoding: 'utf8', env });
  if (c.status !== 0) return { tool: { ok: false, why: `kotlinc: ${c.stderr}` }, outcomes: [] };
  return { tool: { ok: true, why: '' }, outcomes: args.map((arg) => { const r = spawnSync(join(javaHome, 'bin', 'java'), ['-cp', jar, 'dev.dragon.views.MainKt', arg], { encoding: 'utf8', env }); return { arg, status: r.status ?? -1, out: `${r.stdout}${r.stderr}` }; }) };
}

describe('the checked int conversion (View.layout ints)', () => {
  for (const lang of ['swift', 'kotlin'] as const) {
    it(`${lang}: traps on 1.5, 2^31 and -2^31 - 1, and passes 7 and -2^31`, async () => {
      const dir = join(tmpdir(), `dragon-t014-checked-${lang}-${process.pid}`);
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
      const { tool, outcomes } = trapRun(lang, dir);
      if (!tool.ok) {
        // Reported as blocked (owner tooling), never as a pass: the lane records it the same way (lanes.ts).
        const native = (await import(pathToFileURL(join(root, 'packages/translate/src/native.ts')).href)) as { swiftTool: () => unknown; kotlinTool: () => unknown };
        expect(lang === 'swift' ? native.swiftTool() : native.kotlinTool()).toBeNull();
        console.log(`checked int ${lang}: blocked (owner tooling): ${tool.why}`);
        return;
      }
      const by = new Map(outcomes.map((o) => [o.arg, o]));
      expect(by.get('7')).toMatchObject({ status: 0 });
      expect(by.get('7')?.out.trim()).toBe('7');
      expect(by.get('-2147483648')?.out.trim()).toBe('-2147483648');
      for (const bad of ['1.5', '2147483648', '-2147483649']) {
        expect(by.get(bad)?.status, `${lang} ${bad}`).not.toBe(0);
        expect(by.get(bad)?.out).toMatch(/dragonCheckedInt: test = .* is not an Int32 integer/);
      }
    }, 120_000);
  }
});

describe('a calculated line height is built as the engine\'s LineHeightCalc (non-negative range), never LengthCalc', () => {
  const px = (value: number) => ({ kind: 'px', value }) as const;
  const font = { family: 'Ahem', size: 10, specifiedSize: px(10), absoluteSize: true } as const;
  const lhCalc = { kind: 'calc', expr: px(12), range: 'non-negative' } as const;
  const style = (width: unknown) => ({ ...(nativeRoot().style as object), width }) as never;
  function nativeRoot() {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor('body { margin: 0; font-family: Ahem; font-size: 10px; }', (r) => [div(r, 'a', [], [text(r, 't', 'XX')])]));
    const p = nativeLayoutProjection(c, { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, rootFont: 'ua-default', direction: 'ltr' }, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.input.root;
  }
  it('on a text leaf and inside an lh leaf, in Swift and Kotlin', () => {
    const leaf = { kind: 'text', id: 'p:t', text: 'XX', font, lineHeight: lhCalc, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' } as const;
    const width = { kind: 'calc', range: 'non-negative', expr: { kind: 'lh', value: 2, font, lineHeight: lhCalc } } as const;
    const root = { kind: 'box', id: 'p', boxType: 'element', style: style(width), children: [leaf] } as const;
    for (const lang of ['swift', 'kotlin'] as const) {
      const src = inputFunctions(lang, root as never, 't').decls.join('\n');
      const q = lang === 'swift' ? (s: string) => `JsString("${s}")` : (s: string) => `"${s}"`;
      expect(src.split(`LineHeightCalc(${q('calc')}, Px(${q('px')}, 12.0), ${q('non-negative')})`).length - 1, lang).toBe(2);
      expect(src, lang).not.toContain(`LengthCalc(${q('calc')}, Px(${q('px')}, 12.0)`);
    }
  });
  it('refuses a style without its grid fields instead of building it (they are null where unused)', () => {
    const { grid: _grid, ...rest } = nativeRoot().style;
    const root = { kind: 'box', id: 'p', boxType: 'element', style: rest, children: [] } as const;
    for (const lang of ['swift', 'kotlin'] as const) expect(() => inputFunctions(lang, root as never, 't'), lang).toThrow('LayoutStyle.grid is missing');
  });
});

// Review of #72 at 42fd630b81: an element whose computed transform differs between two reachable cases (a state change) moves
// its transform at run time, as does one with a listed transform transition; an unchanged transform does not.
describe('movingTransforms', () => {
  const resolvedOf = (css: string) => {
    const c = both2(css);
    const r = internalRecord(c)?.cases[0]?.resolved;
    if (r === undefined || r === null) throw new Error('no resolved case');
    return r;
  };
  const both2 = (css: string) => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'p', ['p'], [div(r, 'q', ['q'])])]));
  it('a transform that differs between cases moves; an equal one, and none, do not', () => {
    const a = resolvedOf('.p { transform: scale(2); } .q { transform: translate(1px, 0); }');
    const b = resolvedOf('.p { transform: scale(3); } .q { transform: translate(1px, 0); }');
    const moved = [...movingTransforms([a, b], null)];
    expect(moved.length).toBe(1);
    expect(moved[0]).toMatch(/p/);
    expect([...movingTransforms([a, a, null], null)]).toEqual([]);
  });
});

