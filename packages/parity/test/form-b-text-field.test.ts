// FORM-b: single-line text fields (text, email, url, tel and an unknown type) compile as Chrome 145's UA shadow tree, an inner
// editor holding the value and a placeholder while the value is empty, laid out by the engine (controls.ts) and written for the
// web with ::placeholder. Refused: a themed field, a password field, an inline-level one, and on iOS and Android an editable one.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic } from 'dragon';
import * as dragon from 'dragon';
import { ahemMeasurer, layout as engineLayout, NO_ENGINE_FAULTS } from '@dragon/layout';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { captureFixture } from '../src/capture.ts';
import { atDpr, DPRS, layoutCases, runDprCase, zoomGuard } from '../src/dpr.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { compileFixture, liveAuthored, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';

const page = (css: string, body: string, base: string): string => `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; font-family: Ahem; font-size: 10px; }
${base}
${css}
</style>
</head>
<body data-dragon-id="body">
${body}
</body>
</html>
`;

/** Every field here devolves to CSS by its author border, except where a test passes its own base rule. */
const BASE = 'input { display: block; font: inherit; appearance: none; margin: 0; border: 2px solid #036; padding: 1px 2px; }';

function compile(id: string, css: string, body: string, base = BASE, fonts = false): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, ...(fonts ? { fonts: FONT_REFERENCE_MAP } : {}) }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem' });
  const input = fixtureToInput(id, page(css, body, base));
  return project.compile(fonts ? withFontMapAssets(input, FONT_REFERENCE_MAP) : input);
}

const errors = (c: Compiled<string>): string[] => c.diagnostics.filter((d: Diagnostic) => d.severity === 'error').map((d) => `${d.target ?? 'all'} ${d.code} ${d.message}`);

/** The engine's border boxes of a compile's first case, in CSS px relative to the parent box, by id. */
function boxes(c: Compiled<string>): Map<string, { x: number; y: number; width: number; height: number }> {
  const p = dragon.engineLayoutProjection(c, ENVIRONMENT, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const r = engineLayout(p.input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return new Map(r.boxes.map((b) => [b.id, { x: b.x / 64, y: b.y / 64, width: b.width / 64, height: b.height / 64 }]));
}

describe('FORM-b text fields', () => {
  it('lays out a readonly field on every target: size x the advance of 0 wide, as tall as its editor', () => {
    const c = compile('tf-basic', '', '<input data-dragon-id="t" readonly="" size="3" value="XX">');
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('t')).toMatchObject({ width: 38, height: 16 });
    expect(b.get('t::editor')).toMatchObject({ width: 30, height: 10 });
    expect([...b.keys()].filter((k) => k.startsWith('t::'))).toEqual(['t::editor', 't::editor:text0', 't::editor:text0:line0'].filter((k) => b.has(k)));
  });

  it('sizes a field by its average character width, which Chrome rounds up from a half (max(avg, roundf(avg)))', () => {
    // Ahem's average character width is 1em; at 10.5px Chrome takes 11px a character, so size 20 is 220px, not 210px.
    const c = compile('tf-avg-width', '.h { font-size: 10.5px; } .l { font-size: 10.25px; }', '<input data-dragon-id="h" readonly="" class="h" value="XX">\n<input data-dragon-id="l" readonly="" class="l" size="4" value="XX">');
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('h::editor')?.width).toBe(220);
    expect(b.get('h')?.width).toBe(228);
    expect(b.get('l::editor')?.width).toBe(41);
  });

  it('refuses a float before a block field, which Chrome moves beside the float as a new formatting context', () => {
    // The engine moves no in-flow box around a float, so the compiler refuses what follows one on every target (FLT).
    const c = compile('tf-float-beside', '.fl { float: left; width: 100px; height: 40px; }', '<div data-dragon-id="w"><div data-dragon-id="fl" class="fl"></div><input data-dragon-id="t" readonly="" value="XX"></div>');
    expect(errors(c)).toEqual(['android', 'ios', 'web'].map((t) => expect.stringMatching(new RegExp(`^${t} DRAGON_UNSUPPORTED_VALUE float: left on fl is followed in its formatting context by t, which is in flow`))));
  });

  it('centres the editor unsafely in a fixed height and gives it line-height normal when the height exceeds the line height', () => {
    const b = boxes(compile('tf-centre', '.a { height: 41px; line-height: 30px; } .b { height: 4px; } .c { line-height: 30px; } .d { line-height: 4px; }', ['a', 'b', 'c', 'd'].map((k) => `<input data-dragon-id="${k}" readonly="" class="${k}" value="XX">`).join('\n')));
    expect(['a', 'b', 'c', 'd'].map((k) => b.get(`${k}::editor`)?.y)).toEqual([18.5, 0, 3, 3]);
    expect(['a', 'b', 'c', 'd'].map((k) => b.get(`${k}::editor`)?.height)).toEqual([10, 10, 30, 10]);
  });

  it('shows the placeholder only while the value is empty, its baseline on the editor', () => {
    const c = compile('tf-placeholder', '.p::placeholder { color: #c00; font-size: 4px; } .q { line-height: 30px; }', '<input data-dragon-id="p" readonly="" class="p" placeholder="PP">\n<input data-dragon-id="q" readonly="" class="q" placeholder="PP">\n<input data-dragon-id="v" readonly="" placeholder="PP" value="X">');
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('p::placeholder')?.y).toBe(8);
    expect(b.get('q::placeholder')?.y).toBe(13);
    expect(b.has('v::placeholder')).toBe(false);
    // A value hides the placeholder, but the web output still styles it for when the user clears the field.
    const valued = compile('tf-placeholder-valued', '.p::placeholder { color: #c00; }', '<input data-dragon-id="p" class="p" value="QQ" placeholder="ZZ">');
    const css = valued.outputs.web.kind === 'ready' ? valued.outputs.web.files.map((f) => f.text).join('\n') : '';
    expect(css).toMatch(/::placeholder \{[^}]*color: rgb\(204, 0, 0\)/);
    const web = c.outputs.web.kind === 'ready' ? c.outputs.web.files.map((f) => f.text).join('\n') : '';
    expect(web).toMatch(/::placeholder \{[^}]*color: rgb\(204, 0, 0\)/);
  });

  it('refuses an editable field on iOS and Android only, and a themed, password or inline-level field everywhere', () => {
    expect(errors(compile('tf-edit', '', '<input data-dragon-id="t" value="XX">'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE <input> t is an editable text field: Dragon draws its value but has no caret/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t is an editable text field/),
    ]);
    expect(errors(compile('tf-theme', '', '<input data-dragon-id="t" readonly="">', 'input { display: block; font: inherit; margin: 0; }'))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t with appearance: auto and no author background or border/));
    expect(errors(compile('tf-password', '', '<input data-dragon-id="t" readonly="" type="password" value="XX">'))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <input type=password> t is not supported/)]);
    expect(errors(compile('tf-inline', 'input { display: inline-block; }', '<div data-dragon-id="d"><input data-dragon-id="t" readonly=""></div>'))).toContainEqual(expect.stringMatching(/display: inline-block on <input> t makes it an inline-level control/));
    expect(errors(compile('tf-float', 'input { float: left; }', '<input data-dragon-id="t" readonly="">'))).toContainEqual(expect.stringMatching(/float: left on <input> t is not supported on a text field/));
  });
});

describe('FIELD-font-width FW1: a field outside Ahem is accepted natively only where its width never reads its intrinsic width', () => {
  const avg = (c: Compiled<string>): string[] => errors(c).filter((e) => e.includes('average character width'));
  const lato = (id: string, css: string, body: string, faults = dragon.NO_FAULTS, direction: 'ltr' | 'rtl' = 'ltr'): Compiled<'ios' | 'android' | 'web'> => {
    const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, fonts: FONT_REFERENCE_MAP }, { faults, profiles: 'derive', direction, rootFont: 'ahem' });
    return project.compile(withFontMapAssets(fixtureToInput(id, page(`input { font-family: Lato; } ${css}`, body, BASE)), FONT_REFERENCE_MAP));
  };
  const field = '<input data-dragon-id="t" readonly="" value="Hello">';
  const inRow = (css: string): readonly [string, string] => [`.r { display: flex; width: 200px; } ${css}`, `<div data-dragon-id="r" class="r">${field}</div>`];
  const inBox = (box: string, css: string): readonly [string, string] => [`.wrap { ${box.startsWith('position') ? 'position: relative; height: 60px; ' : ''}width: 300px; } .w { ${box} } ${css}`, `<div data-dragon-id="wrap" class="wrap"><div data-dragon-id="w" class="w">${field}</div></div>`];

  const ACCEPTED: readonly (readonly [string, string, string])[] = [
    ['fw-px', 'input { width: 40px; }', field],
    ['fw-pct', 'input { width: 100%; max-width: 50px; min-width: 10%; }', field],
    ['fw-calc', 'input { width: calc(50% + 10px); }', field],
    ['fw-float-cap', ...inBox('float: left;', 'input { width: 120px; max-width: 100%; }')],
    ['fw-ib-cap', ...inBox('display: inline-block;', 'input { width: 120px; max-width: 100%; }')],
    ['fw-float-least', ...inBox('float: left;', 'input { width: 120px; min-width: 50%; }')],
    ['fw-row-basis', ...inRow('input { flex: 1 1 0; min-width: 0; }')],
    ['fw-row-basis-px', ...inRow('input { flex: 0 0 80px; min-width: 10px; max-width: 50%; }')],
    ['fw-row-fill', ...inRow('input { width: 100%; min-width: 0; }')],
    ['fw-col', '.c { display: flex; flex-direction: column; } input { width: 100%; min-width: 0; }', `<div data-dragon-id="c" class="c">${field}</div>`],
  ];
  for (const [id, css, body] of ACCEPTED) {
    it(`accepts ${id} on every target, and the engine lays out its iOS projection`, () => {
      const c = lato(id, css, body);
      expect(errors(c)).toEqual([]);
      const p = dragon.iosLayoutProjection(c, ENVIRONMENT, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      expect(engineLayout(p.input, referenceShapedMeasurer()).kind).toBe('ok');
    });
  }

  // Each refused shape, refused by name on iOS and Android only, would read the intrinsic width: with fieldWidthAnyContext the engine throws.
  const REFUSED: readonly (readonly [string, string, string, string, string?])[] = [
    ['fw-auto', '', field, 'width: auto on <input> t is not supported here'],
    ['fw-margin-auto', 'input { margin: 0 auto; }', field, 'width: auto on <input> t is not supported here'],
    ['fw-fit', 'input { width: fit-content; }', field, 'width: fit-content on <input> t is not supported here'],
    ['fw-max-content', 'input { width: max-content; }', field, 'width: max-content on <input> t is not supported here'],
    ['fw-min-intrinsic', 'input { width: 40px; min-width: min-content; }', field, 'min-width: min-content on <input> t is not supported here'],
    ['fw-max-intrinsic', 'input { width: 40px; max-width: max-content; }', field, 'max-width: max-content on <input> t is not supported here'],
    ['fw-flex-min', ...inRow('.r { width: 100px; } input { flex: 1; width: 100%; }'), '<input> t is a flex item with min-width: auto'],
    ['fw-row-auto', ...inRow('input { min-width: 0; }'), 'width: auto on <input> t is not supported here'],
    // The engine refuses flex-basis: content itself, before it reads the field.
    ['fw-basis-content', ...inRow('input { flex-basis: content; width: 10px; min-width: 0; }'), 'flex-basis: content on <input> t is not supported', 'flex-basis-content'],
    ['fw-col-auto', '.c { display: flex; flex-direction: column; align-items: start; } input { min-width: 0; }', `<div data-dragon-id="c" class="c">${field}</div>`, 'width: auto on <input> t is not supported here'],
    ['fw-ib-pct', ...inBox('display: inline-block;', 'input { width: 100%; }'), 'width: 100% on <input> t is not supported here: <div> w takes its width from its content (display: inline-block with an auto width)'],
    ['fw-float-pct', ...inBox('float: left;', 'input { width: 100%; }'), 'width: 100% on <input> t is not supported here: <div> w takes its width from its content (float: left with an auto width)'],
    ['fw-abspos-pct', ...inBox('position: absolute; top: 0; left: 0;', 'input { width: 100%; }'), 'width: 100% on <input> t is not supported here: <div> w takes its width from its content (position: absolute with an auto width)'],
  ];
  for (const [id, css, body, prefix, thrown = 'text-field-avg-char'] of REFUSED) {
    it(`refuses ${id} on iOS and Android only, and with fieldWidthAnyContext the engine throws ${thrown}`, () => {
      const c = lato(id, css, body);
      expect(avg(c).map((e) => e.slice(0, e.indexOf(' ', e.indexOf(' ') + 1)))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
      expect(c.diagnostics.find((d) => d.message.includes('average character width'))?.message.startsWith(prefix)).toBe(true);
      expect(errors(c).filter((e) => e.startsWith('web ') || e.startsWith('all '))).toEqual([]);
      const faulted = lato(id, css, body, { ...dragon.NO_FAULTS, fieldWidthAnyContext: true });
      expect(errors(faulted)).toEqual([]);
      const p = dragon.iosLayoutProjection(faulted, ENVIRONMENT, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      const r = engineLayout(p.input, referenceShapedMeasurer());
      expect(r.kind === 'unsupported' ? `${r.unsupported.code} at ${r.unsupported.nodeId}` : r.kind).toBe(`${thrown} at t`);
    });
  }

  // Refused by ruling, not because the engine reads the intrinsic width there, so no fault can make them throw.
  const RULED: readonly (readonly [string, string, string, string])[] = [
    ['fw-stretch', 'input { width: stretch; }', field, 'width: stretch on <input> t'],
    ['fw-row-pct-basis', ...inRow('input { flex: 1 1 50%; min-width: 0; }'), 'width: auto on <input> t'],
    ['fw-basis-pct-shrink', ...inBox('display: inline-flex;', 'input { flex: 0 0 50%; width: 10px; min-width: 0; }'), 'flex-basis: 50% on <input> t is not supported here: <div> w takes its width from its content (display: inline-flex with an auto width)'],
  ];
  for (const [id, css, body, prefix] of RULED) {
    it(`refuses ${id} on iOS and Android only (out of FW1's scope by ruling)`, () => {
      const c = lato(id, css, body);
      expect(avg(c).map((e) => e.slice(0, e.indexOf(' ', e.indexOf(' ') + 1)))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
      expect(c.diagnostics.find((d) => d.message.includes('average character width'))?.message.startsWith(prefix)).toBe(true);
      expect(errors(c).filter((e) => e.startsWith('web ') || e.startsWith('all '))).toEqual([]);
    });
  }

  it('reads the first listed family with its case: only Ahem first is measured', () => {
    const auto = (id: string, family: string): number => avg(compile(id, `input { font-family: ${family}; }`, field, BASE, true)).length;
    expect([auto('fw-ahem', 'Ahem'), auto('fw-ahem-list', 'Ahem, Lato'), auto('fw-ahem-quoted', '"Ahem", sans-serif')]).toEqual([0, 0, 0]);
    expect([auto('fw-ahem-lower', 'ahem'), auto('fw-lato-ahem', 'Lato, Ahem'), auto('fw-generic', 'sans-serif')]).toEqual([2, 2, 2]);
  });

  it('an rtl field in Lato is refused by its editor white space (DRAGON_UNSUPPORTED_BIDI), so the fixture is ltr only', () => {
    expect(errors(lato('fw-rtl', 'input { width: 100%; }', field, dragon.NO_FAULTS, 'rtl'))).toContainEqual(expect.stringMatching(/^all DRAGON_UNSUPPORTED_BIDI t::editor:text0 keeps its white space/));
  });
});

const ACCEPT = 'controls-text-field-font-definite';
const specOf = (id: string) => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};

describe('the FW1 fixtures against live Chrome', () => {
  let browser: Browser;
  beforeAll(async () => {
    requireReferencePlatform(hostPlatform());
    browser = await launchChrome();
    expect(browser.version()).toBe(CHROME_VERSION);
  });
  afterAll(async () => {
    await browser.close();
  });
  const live = () => ({ authored: liveAuthored(browser), faults: dragon.NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' as const });

  it(`${ACCEPT} passes chrome-dual and linux-dragon-layout`, async () => {
    const out = await runFixture(specOf(ACCEPT), browser, live());
    expect(out.reason).toBeNull();
    expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass']]);
  }, 300_000);
});

describe(`${ACCEPT} equals live Chrome at every DPR`, () => {
  const cases = layoutCases().filter((f) => f.spec.id === ACCEPT).flatMap((f) => f.cases);
  const compiled = { ltr: compileFixture(specOf(ACCEPT), dragon.NO_FAULTS, 'derive', 'ltr').compiled };
  for (const dpr of DPRS) {
    it(`at DPR ${dpr}`, async () => {
      expect(cases.length).toBe(1);
      const b = await launchChrome(dpr);
      try {
        await zoomGuard(b, dpr);
        const failed: string[] = [];
        for (const c of cases) {
          const capture = await captureFixture(b, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], c.authoredPrepare ?? undefined);
          expect(capture.devicePixelRatio).toBe(dpr);
          const o = runDprCase(c, compiled.ltr, dpr, capture, NO_ENGINE_FAULTS);
          if (o.status === 'fail') failed.push(`${o.id}@${o.dpr}: ${o.reason}`);
        }
        expect(failed).toEqual([]);
      } finally {
        await b.close();
      }
    }, 300_000);
  }
});
