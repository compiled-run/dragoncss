// FORM-a A3 (T052J): the button package leaves every case that predates it as A2 left it. No earlier fixture holds a form
// control; every earlier element computes appearance: none, so Chrome's appearance display adjustment (analysis/computed.ts)
// leaves its display as it was; every earlier case lowers to its committed vector input with no control box; and its web body is
// the committed emitted CSS. The web body writes every resolved longhand of every element (emit/web-css.ts), so an equal body
// is an equal resolution, and the committed vectors and emitted CSS are byte-identical to A2 (git diff form-a2 in the receipt).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ControlBox, LayoutBox } from '@dragon/layout';
import { compiledCases, iosLayoutProjection, WEB_CSS_PATH } from 'dragon';
import { internalRecord } from '../../dragon/src/project.ts';
import type { ResolvedElement, ResolvedValue } from '../../dragon/src/analysis/resolve.ts';
import { rangePartOf, valueToString } from '../../dragon/src/analysis/resolve.ts';
import { appearanceDisplay, parseValueText } from '../../dragon/src/analysis/computed.ts';
import { referenceDataset, uaRows } from '../../dragon/src/ua/datasets.ts';
import type { UaDataset } from '../../dragon/src/ua/datasets.ts';
import { buttonAppearance, isControlTag } from '../../dragon/src/analysis/elements/controls.ts';
import type { Longhand } from '../../dragon/src/css/properties.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { emittedPath } from '../src/committed.ts';
import { CONTROLS } from '../src/fixture-groups/controls.ts';
import { environmentsOf, FIXTURES } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import { compileFixture } from '../src/pipeline.ts';

const controlIds = new Set(CONTROLS.map((f) => f.id));
const earlier = FIXTURES.filter((f) => f.kind === 'layout' && !controlIds.has(f.id));

function elements(root: ResolvedElement): ResolvedElement[] {
  const out: ResolvedElement[] = [root];
  for (const c of root.children) if (c.kind === 'element') out.push(...elements(c));
  return out;
}

function holdsControl(b: LayoutBox | ControlBox): boolean {
  return b.children.some((c) => c.kind === 'control' || (c.kind === 'box' && holdsControl(c)));
}

/** The emitted CSS without its header line (the compilation digest moves with every compiler change). */
const body = (css: string): string => css.split('\n').slice(1).join('\n');

describe('FORM-a A3 identity: every case that predates the button package is unchanged', () => {
  it('covers every earlier layout fixture, and the controls group adds only its own', () => {
    expect(earlier.length).toBeGreaterThan(200);
    expect(FIXTURES.filter((f) => f.kind === 'layout' && controlIds.has(f.id)).length).toBe(7);
  });

  it('no earlier element is a control, and every one computes appearance: none, so the display adjustment leaves it alone', () => {
    const off: string[] = [];
    let checked = 0;
    for (const spec of earlier) {
      for (const env of environmentsOf(spec)) {
        const { compiled } = compileFixture(spec, undefined, 'enforce', env.direction);
        const record = internalRecord(compiled);
        if (record === undefined) throw new Error(`${spec.id}: no internal record`);
        for (const c of record.cases) {
          if (c.resolved === null) continue;
          for (const el of elements(c.resolved)) {
            checked++;
            const appearance = el.props.get('appearance') as ResolvedValue;
            const display = el.props.get('display') as ResolvedValue;
            if (isControlTag(el.element.tag)) off.push(`${spec.id} ${env.direction} ${el.element.address}: a <${el.element.tag}>`);
            if (valueToString(appearance.value) !== 'none') off.push(`${spec.id} ${env.direction} ${el.element.address}: appearance ${valueToString(appearance.value)}`);
            if (appearanceDisplay(display, appearance) !== display) off.push(`${spec.id} ${env.direction} ${el.element.address}: display adjusted`);
          }
        }
      }
    }
    expect(off).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it('lowers every earlier case to its committed vector input, with no control box, and emits its committed web body', () => {
    const off: string[] = [];
    let vectors = 0;
    let bodies = 0;
    for (const spec of earlier) {
      const input = fixtureInput(spec);
      for (const env of environmentsOf(spec)) {
        const { compiled } = compileFixture(spec, undefined, 'enforce', env.direction);
        const web = compiled.outputs.web;
        const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH) : undefined;
        if (css !== undefined && existsSync(emittedPath(spec.id, env.direction))) {
          bodies++;
          if (body(css.text) !== body(readFileSync(emittedPath(spec.id, env.direction), 'utf8'))) off.push(`${spec.id} ${env.direction}: web body differs from the committed emitted CSS`);
        }
        const cases = casesOf(spec, input).filter((c) => c.environment.direction === env.direction);
        expect(cases.length, spec.id).toBe(compiledCases(compiled).length);
        for (const c of cases) {
          const path = repoPath(`packages/layout/vectors/${c.id}.json`);
          if (!existsSync(path)) continue;
          const p = iosLayoutProjection(compiled, c.environment, c.assignment);
          if (p.kind !== 'ready') {
            off.push(`${c.id}: no layout projection (${p.reason})`);
            continue;
          }
          vectors++;
          const committed = (JSON.parse(readFileSync(path, 'utf8')) as { input: unknown }).input;
          if (JSON.stringify(p.input) !== JSON.stringify(committed)) off.push(`${c.id}: layout input differs from the committed vector`);
          if (holdsControl(p.input.root)) off.push(`${c.id}: holds a control box`);
        }
      }
    }
    expect(off).toEqual([]);
    // Every committed vector and emitted file of an earlier fixture was compared: none is left out.
    const own = (name: string): boolean => !CONTROLS.some((f) => name.startsWith(`${f.id}.`) || name.startsWith(`${f.id}-rtl.`));
    expect(vectors).toBe(readdirSync(repoPath('packages/layout/vectors')).filter((f) => f.endsWith('.json') && own(f)).length);
    expect(bodies).toBe(readdirSync(repoPath('packages/parity/emitted')).filter((f) => f.endsWith('.css') && own(f)).length);
  });
});

// FORM-a A4: the range package leaves every case that predates it as A3 left it, the A3 button cases included: none holds a range
// input or part, each lowers to its committed vector input with no range or thumb control box, and emits its committed web body
// (the committed vectors and emitted CSS of these cases are byte-identical to A3, git diff form-a3 in the receipt).
describe('FORM-a A4 identity: every case that predates the range package is unchanged', () => {
  const beforeA4 = FIXTURES.filter((f) => f.kind === 'layout' && !f.id.startsWith('controls-range-'));
  const rangeBoxes = (b: LayoutBox | ControlBox): number => b.children.reduce((n, c) => n + (c.kind === 'control' && c.control.kind !== 'button-block' ? 1 : 0) + (c.kind === 'box' || c.kind === 'control' ? rangeBoxes(c) : 0), 0);
  it('covers every earlier layout fixture, the A3 controls cases included', () => {
    expect(beforeA4.filter((f) => controlIds.has(f.id)).length).toBe(5);
    expect(FIXTURES.filter((f) => f.id.startsWith('controls-range-')).length).toBe(2);
  });
  it('no earlier case resolves a range, lowers a range or thumb box, or changes its vector input or web body', () => {
    const off: string[] = [];
    let vectors = 0;
    for (const spec of beforeA4) {
      const input = fixtureInput(spec);
      for (const env of environmentsOf(spec)) {
        const { compiled } = compileFixture(spec, undefined, 'enforce', env.direction);
        const record = internalRecord(compiled);
        if (record === undefined) throw new Error(`${spec.id}: no internal record`);
        for (const c of record.cases) if (c.resolved !== null) for (const el of elements(c.resolved)) if (rangePartOf(el) !== undefined) off.push(`${spec.id} ${el.element.address}: a range or range part`);
        const web = compiled.outputs.web;
        const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH) : undefined;
        if (css !== undefined && existsSync(emittedPath(spec.id, env.direction)) && body(css.text) !== body(readFileSync(emittedPath(spec.id, env.direction), 'utf8'))) off.push(`${spec.id} ${env.direction}: web body differs`);
        for (const c of casesOf(spec, input).filter((k) => k.environment.direction === env.direction)) {
          const path = repoPath(`packages/layout/vectors/${c.id}.json`);
          if (!existsSync(path)) continue;
          const p = iosLayoutProjection(compiled, c.environment, c.assignment);
          if (p.kind !== 'ready') {
            off.push(`${c.id}: no layout projection`);
            continue;
          }
          vectors++;
          if (JSON.stringify(p.input) !== JSON.stringify((JSON.parse(readFileSync(path, 'utf8')) as { input: unknown }).input)) off.push(`${c.id}: layout input differs`);
          if (rangeBoxes(p.input.root) > 0) off.push(`${c.id}: holds a range or thumb box`);
        }
      }
    }
    expect(off).toEqual([]);
    expect(vectors).toBeGreaterThan(400);
  });
});

// The A3 helpers the fixtures exercise end to end, checked on their edges.
describe('FORM-a A3 helpers', () => {
  const v = (property: 'display' | 'appearance', text: string): ResolvedValue => ({ value: parseValueText(property, text), origin: 'author', span: null, declaration: null, declared: null, losing: [] });
  it('the appearance display adjustment follows the Chrome 145 probe, and appearance: none leaves every display alone', () => {
    const probe: readonly (readonly [string, string])[] = [
      ['inline', 'inline-block'], ['inline-block', 'inline-block'], ['block', 'block'], ['flex', 'flex'], ['inline-flex', 'inline-flex'],
      ['inline-table', 'inline-block'], ['table', 'block'], ['table-row', 'inline-block'], ['table-cell', 'inline-block'],
      ['list-item', 'block'], ['flow-root', 'flow-root'], ['contents', 'contents'], ['none', 'none'], ['inline list-item', 'inline list-item'],
    ];
    for (const [from, to] of probe) {
      expect(valueToString(appearanceDisplay(v('display', from), v('appearance', 'auto')).value), from).toBe(to);
      expect(valueToString(appearanceDisplay(v('display', from), v('appearance', 'button')).value), from).toBe(to);
      expect(appearanceDisplay(v('display', from), v('appearance', 'none')).value, from).toEqual(v('display', from).value);
    }
  });

  it("the control keys read html.css's display: inline-block as a declared UA value, keep their other forced rows, and refuse a key without it", () => {
    const ua = referenceDataset();
    const rows = uaRows(ua, 'button');
    expect(rows.forced).toEqual({ ltr: {}, rtl: {} });
    expect(rows.declared.ltr['display']).toBe('inline-block');
    expect(rows.longhands).toContain('display');
    // A4: the plain input key keeps Chrome's forced overflow: clip; input[type=range] has only the display row.
    expect(uaRows(ua, 'input').forced).toEqual({ ltr: { 'overflow-x': 'clip', 'overflow-y': 'clip' }, rtl: { 'overflow-x': 'clip', 'overflow-y': 'clip' } });
    expect(uaRows(ua, 'input[type=range]').forced).toEqual({ ltr: {}, rtl: {} });
    expect(uaRows(ua, 'input[type=range]').declared.rtl['display']).toBe('inline-block');
    const extra: UaDataset = { ...ua, userAgentForced: { ...ua.userAgentForced, button: { ltr: { 'overflow-x': 'clip' }, rtl: { display: 'inline-block' } } } };
    expect(() => uaRows(extra, 'button')).toThrow("the button key's forced rows");
    const missing: UaDataset = { ...ua, userAgentForced: {} };
    expect(() => uaRows(missing, 'button')).toThrow('no forced rows for the button key');
  });

  it('a button paints as CSS only under appearance: none, or auto with an author background or border (R11)', () => {
    const props = (appearance: string, extra: readonly (readonly [Longhand, ResolvedValue])[] = []): Map<Longhand, ResolvedValue> => new Map<Longhand, ResolvedValue>([['appearance', v('appearance', appearance)], ...extra]);
    const authored = (p: Longhand, text: string): readonly [Longhand, ResolvedValue] => [p, { value: parseValueText(p, text), origin: 'author', span: null, declaration: null, declared: null, losing: [] }];
    const inherited = (p: Longhand, text: string): readonly [Longhand, ResolvedValue] => [p, { value: parseValueText(p, text), origin: 'inherited', span: null, declaration: null, declared: null, losing: [] }];
    expect(buttonAppearance(props('none'))).toBe('css');
    expect(buttonAppearance(props('auto'))).toBe('theme');
    expect(buttonAppearance(props('auto', [authored('background-color', 'transparent')]))).toBe('css');
    expect(buttonAppearance(props('auto', [authored('border-top-width', '0px')]))).toBe('css');
    expect(buttonAppearance(props('auto', [inherited('background-color', 'red')]))).toBe('theme');
    expect(buttonAppearance(props('button', [authored('background-color', 'red')]))).toBe('theme');
  });
});
