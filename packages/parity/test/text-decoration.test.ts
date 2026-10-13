// TDEC-a (notes/T148J-tdec.md) against the pinned Chrome. The grammar tables: every decoration longhand and the shorthand, set as
// written on one element and as Dragon's longhands on its sibling, compute alike; a value Dragon calls invalid is one CSS.supports
// rejects; every value Dragon accepts, CSS.supports accepts. a:any-link computes Chrome's link colour and underline.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { textDecoration } from '@dragon/layout';
import { NO_DECORATION_ANALYSIS_FAULTS } from '../../dragon/src/analysis/text-decoration.ts';
import { checkDecorations, committedDecorations, compileHtml, DECORATION_DPRS, decorationCases, decorationManifest, decorationPath, predictDecorations, sha256 } from '../src/decoration-capture.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { TEXT_DECORATION_LONGHANDS } from '../../dragon/src/css/properties/text-decoration.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { referenceDataset } from '../../dragon/src/ua/datasets.ts';

const SOURCE = { uri: 'dragon-source://test/decoration.css', revision: 'r1', hash: 'sha256:0' };
type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };
const chrome = async (): Promise<Browser> => ((await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> }).launchChrome();

const TABLE: readonly (readonly [string, readonly string[]])[] = [
  ['text-decoration-line', ['none', 'underline', 'overline', 'line-through', 'overline underline', 'line-through overline underline', 'underline underline', 'none underline', 'blink', 'underline blink', 'spelling-error', 'grammar-error', 'UNDERLINE', 'inherit', 'initial', 'unset']],
  ['text-decoration-style', ['solid', 'double', 'dotted', 'dashed', 'wavy', 'SOLID', 'inherit']],
  ['text-decoration-color', ['red', 'rgba(167, 175, 189, 0.45)', 'currentcolor', '#0000ee80', 'transparent', 'inherit', 'initial']],
  ['text-decoration-thickness', ['auto', 'from-font', '2px', '0.1em', '10%', 'thin', 'medium', 'thick', '-1px', '0', '1.4px', '0.2rem', 'calc(1px + 10%)', 'inherit']],
  ['text-underline-offset', ['auto', '3px', '-2px', '0.2rem', '10%', '0', '0.5em', 'from-font', 'inherit', 'initial']],
  ['text-underline-position', ['auto', 'under', 'from-font', 'left', 'right', 'under left', 'inherit']],
  ['text-decoration-skip-ink', ['auto', 'none', 'all', 'inherit']],
  ['text-decoration', ['underline', 'underline red', 'underline 2px solid red', 'red underline wavy', 'none', 'underline overline 3px', 'solid', '2px', 'underline auto', 'underline from-font', 'blink',
    'underline currentcolor', 'overline line-through rgba(1, 2, 3, 0.5) 10%', 'underline thin', 'underline underline', 'line-through 0.1em', 'inherit', 'initial', 'unset']],
];

function declare(property: string, value: string): { readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { code: diagnostics[0]?.code ?? null, longhands: (rules[0]?.declarations[0]?.longhands ?? []).map((l) => [l.property, valueToString(l.value)] as const) };
}

describe('the text-decoration grammar tables against Chrome 145', () => {
  it('every longhand and the shorthand compute like Chrome; invalid values are ones Chrome rejects, accepted ones it supports', async () => {
    const items = TABLE.flatMap(([p, vs]) => vs.map((v) => ({ property: p, value: v, ...declare(p, v) })));
    const browser = await chrome();
    let seen: { supported: boolean; diff: string[] }[];
    try {
      const page = await browser.newPage();
      // The parent decorates, so an inherit or a currentcolor that Dragon mishandles shows in the comparison.
      await page.setContent('<!DOCTYPE html><div style="color:rgb(10,20,30);font-size:20px;text-decoration:overline 3px rgb(1,2,3);text-underline-offset:4px;text-decoration-skip-ink:none"><div id="a"></div><div id="c"></div></div>');
      seen = (await page.evaluate(`(${JSON.stringify(items)}).map((it) => {
        const L = ${JSON.stringify(TEXT_DECORATION_LONGHANDS)};
        const a = document.getElementById('a'), c = document.getElementById('c');
        a.removeAttribute('style'); c.removeAttribute('style');
        a.style.setProperty(it.property, it.value);
        for (const [l, v] of it.longhands) c.style.setProperty(l, v);
        const ca = getComputedStyle(a), cc = getComputedStyle(c);
        const diff = it.code !== null ? [] : L.filter((l) => ca.getPropertyValue(l) !== cc.getPropertyValue(l)).map((l) => l + ' Chrome "' + ca.getPropertyValue(l) + '" Dragon "' + cc.getPropertyValue(l) + '"');
        return { supported: CSS.supports(it.property, it.value), diff };
      })`)) as { supported: boolean; diff: string[] }[];
    } finally {
      await browser.close();
    }
    const problems = items.flatMap((it, i) => {
      const s = seen[i] as { supported: boolean; diff: string[] };
      const at = `${it.property}: ${it.value}`;
      const out = s.diff.map((d) => `${at}: ${d}`);
      if (it.code === 'DRAGON_CSS_INVALID_VALUE' && s.supported) out.push(`${at}: invalid, Chrome supports it`);
      if (it.code !== 'DRAGON_CSS_INVALID_VALUE' && !s.supported) out.push(`${at}: Dragon reads it, Chrome rejects it`);
      return out;
    });
    expect(problems).toEqual([]);
    expect(items.filter((it) => it.code === 'DRAGON_UNSUPPORTED_VALUE').map((it) => `${it.property}: ${it.value}`)).toEqual([
      'text-decoration-line: blink', 'text-decoration-line: underline blink', 'text-decoration-line: spelling-error', 'text-decoration-line: grammar-error',
      'text-decoration-style: double', 'text-decoration-style: dotted', 'text-decoration-style: dashed', 'text-decoration-style: wavy',
      'text-decoration-thickness: from-font', 'text-underline-position: under', 'text-underline-position: from-font', 'text-underline-position: left',
      'text-underline-position: right', 'text-underline-position: under left', 'text-decoration: red underline wavy', 'text-decoration: underline from-font', 'text-decoration: blink',
    ]);
  }, 300_000);

  it('a:any-link computes Chrome\'s link colour and underline (the captured light a[href] rows)', async () => {
    const browser = await chrome();
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><a id="l" href="https://dragon.invalid/unvisited">x</a>');
      const got = (await page.evaluate("['l'].map((id) => { const cs = getComputedStyle(document.getElementById(id)); return [cs.color, cs.textDecorationLine]; })")) as string[][];
      expect(got).toEqual([[referenceDataset().anyLink.color.ltr, referenceDataset().anyLink.line]]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});

// TDEC-a2: the decoration capture. Chrome's renderings are committed (pnpm run parity:decoration-capture); the engine's rects over
// the stripped copy's layout must paint exactly the decoration pixels at DPR 1, 2, 3 and 2.625, and each plant must break a case.
describe('the decoration capture against the engine (TDEC-a2)', () => {
  const WHITE = { r: 255, g: 255, b: 255, a: 255 };
  const PROBE = 'text-decoration-ahem-auto';
  const runAll = (faults: textDecoration.DecorationFaults, compilerFaults = NO_DECORATION_ANALYSIS_FAULTS): { checked: number; failed: string[]; refused: string[]; pixels: number } => {
    const failed: string[] = [];
    const refused: string[] = [];
    let checked = 0;
    let pixels = 0;
    for (const { fixture, case: c } of decorationCases()) {
      for (const dpr of DECORATION_DPRS) {
        const p = predictDecorations(fixture, c, dpr, faults, compilerFaults);
        if (p.kind === 'refused') {
          refused.push(`${c.id}@${dpr}`);
          continue;
        }
        const cap = committedDecorations(c.id, dpr);
        if (cap === null) throw new Error(`${c.id}@${dpr} is not captured`);
        const r = checkDecorations(cap.decorated, cap.stripped, p.rects, WHITE);
        checked++;
        pixels += r.matched;
        if (r.problems.length > 0 || r.matched !== r.decorationPixels) failed.push(`${c.id}@${dpr}: ${r.matched}/${r.decorationPixels}; ${r.problems.slice(0, 3).join('; ')}`);
      }
    }
    return { checked, failed, refused, pixels };
  };

  it('every capture is committed with its sha256, and Chrome lays out each stripped copy as its decorated case', () => {
    const m = decorationManifest();
    const cases = decorationCases();
    expect(m.cases.length).toBe(cases.length * DECORATION_DPRS.length);
    for (const e of m.cases) {
      expect(e.sameLayout, `${e.case}@${e.dpr}`).toBe(true);
      expect(sha256(readFileSync(decorationPath(e.case, e.dpr, false))), e.case).toBe(e.decorated);
      expect(sha256(readFileSync(decorationPath(e.case, e.dpr, true))), e.case).toBe(e.stripped);
    }
  });

  it('the engine paints every decoration pixel exactly, colour included, at every DPR; only the skip-ink probe is refused', () => {
    const r = runAll(textDecoration.NO_DECORATION_FAULTS);
    expect(r.failed).toEqual([]);
    expect([...r.refused].sort()).toEqual([...DECORATION_DPRS.map((d) => `${PROBE}@${d}`), ...DECORATION_DPRS.map((d) => `${PROBE}-rtl@${d}`)].sort());
    expect(r.checked).toBe((decorationCases().length - 2) * DECORATION_DPRS.length);
    expect(r.pixels).toBeGreaterThan(100_000);
  }, 600_000);

  it('the north-star links pass the skip-ink bounds proof at every DPR (TDEC-d is not on the checkpoint-3 path)', () => {
    for (const { fixture, case: c } of decorationCases().filter((x) => x.case.fixture === 'text-decoration-north-star')) {
      for (const dpr of DECORATION_DPRS) expect(predictDecorations(fixture, c, dpr).kind, `${c.id}@${dpr}`).toBe('rects');
    }
  }, 300_000);

  it('each plant breaks at least one case', () => {
    for (const k of Object.keys(textDecoration.NO_DECORATION_FAULTS)) {
      expect(runAll({ ...textDecoration.NO_DECORATION_FAULTS, [k]: true }).failed.length, k).toBeGreaterThan(0);
    }
    expect(runAll(textDecoration.NO_DECORATION_FAULTS, { propagatedIntoOutOfFlow: true }).failed.length).toBeGreaterThan(0);
  }, 600_000);

  it('probes (T148J-1 ruling 3): every decorated case is ready on web and refused on ios naming TDEC-b; the Ahem auto underline is skip-ink-intercepts', () => {
    for (const { fixture, case: c } of decorationCases()) {
      const compiled = compileHtml(fixture, c.authoredHtml, c.environment.direction);
      expect(compiled.outputs.web.kind, c.id).toBe('ready');
      expect(compiled.diagnostics.some((d) => d.target === 'ios' && d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('draws decorations from TDEC-b')), c.id).toBe(true);
    }
    const probe = decorationCases().find((x) => x.case.id === PROBE);
    if (probe === undefined) throw new Error(PROBE);
    const p = predictDecorations(probe.fixture, probe.case, 1);
    expect(p).toMatchObject({ kind: 'refused', code: 'skip-ink-intercepts' });
  }, 300_000);
});
