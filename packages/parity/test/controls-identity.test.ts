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
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { appearanceDisplay } from '../../dragon/src/analysis/computed.ts';
import { isControlTag } from '../../dragon/src/analysis/elements/controls.ts';
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
    expect(FIXTURES.filter((f) => f.kind === 'layout' && controlIds.has(f.id)).length).toBe(5);
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
