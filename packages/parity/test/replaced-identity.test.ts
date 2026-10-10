// REPL-a (T051J): the replaced-element package leaves every case that predates it as it was. Every pre-existing fixture case
// resolves the two new longhands to their initial values, its native layout input is the committed vector's input (the vectors
// are unchanged since the base, scripts/check-object-fit-migration.ts) with no replaced leaf in it, and its web body is the
// committed emitted CSS, which differs from the base only by the two initial declarations per rule (the same checker).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { compiledCases, iosLayoutProjection, WEB_CSS_PATH } from 'dragon';
import { internalRecord } from '../../dragon/src/project.ts';
import type { ResolvedElement } from '../../dragon/src/analysis/resolve.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { emittedPath } from '../src/committed.ts';
import { REPLACED } from '../src/fixture-groups/replaced.ts';
import { environmentsOf, FIXTURES } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import { compileFixture } from '../src/pipeline.ts';

// Later fixtures that hold replaced leaves by design are not earlier cases: OVFL's overflow-replaced (images in scroll containers).
const LATER_WITH_REPLACED: readonly string[] = ['overflow-replaced'];
const replacedIds = new Set([...REPLACED.map((f) => f.id), ...LATER_WITH_REPLACED]);
const earlier = FIXTURES.filter((f) => f.kind === 'layout' && !replacedIds.has(f.id));

/**
 * Earlier fixtures that gained a replaced leaf on purpose: hit-order's row m (SELD-R1b x REPL-a) proves a positioned img flex item
 * stacks by its order in Chrome's hit test. Every other check still applies to them, and each must hold a replaced leaf.
 */
const HOLDS_REPLACED = new Set(['hit-order']);

const NEUTRAL = new Map([['object-fit', 'fill'], ['object-position', '50% 50%']]);

/** Every element of a resolved tree. */
function elements(root: ResolvedElement): ResolvedElement[] {
  const out: ResolvedElement[] = [root];
  for (const c of root.children) if (c.kind === 'element') out.push(...elements(c));
  return out;
}

/** Whether a layout tree holds a replaced leaf. */
function holdsReplaced(b: LayoutBox): boolean {
  return b.children.some((c) => c.kind === 'replaced' || (c.kind === 'box' && holdsReplaced(c)));
}

/** The emitted CSS without its header line (the compilation digest moves with every compiler change). */
const body = (css: string): string => css.split('\n').slice(1).join('\n');

describe('REPL-a identity: every case that predates the replaced package is unchanged', () => {
  it('covers every earlier layout fixture in each of its environments', () => {
    expect(earlier.length).toBeGreaterThan(200);
    expect(FIXTURES.filter((f) => f.kind === 'layout' && replacedIds.has(f.id)).length).toBe(6 + LATER_WITH_REPLACED.length);
  });

  it('resolves object-fit and object-position to their initial values, from no declaration, on every element', () => {
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
            for (const [p, initial] of NEUTRAL) {
              const v = el.props.get(p as 'object-fit');
              checked++;
              if (v === undefined || valueToString(v.value) !== initial || v.origin !== 'initial') off.push(`${spec.id} ${env.direction} ${el.element.address} ${p}: ${v === undefined ? 'missing' : `${valueToString(v.value)} (${v.origin})`}`);
            }
          }
        }
      }
    }
    expect(off).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it('lowers every earlier case to its committed vector input, with no replaced leaf, and emits its committed web body', () => {
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
          if (holdsReplaced(p.input.root) !== HOLDS_REPLACED.has(spec.id)) off.push(`${c.id}: ${HOLDS_REPLACED.has(spec.id) ? 'holds no replaced leaf' : 'holds a replaced leaf'}`);
        }
      }
    }
    expect(off).toEqual([]);
    // Every committed vector and emitted file of an earlier fixture was compared: none is left out.
    const own = (name: string): boolean => ![...replacedIds].some((id) => name.startsWith(`${id}.`) || name.startsWith(`${id}-rtl.`));
    expect(vectors).toBe(readdirSync(repoPath('packages/layout/vectors')).filter((f) => f.endsWith('.json') && own(f)).length);
    expect(bodies).toBe(readdirSync(repoPath('packages/parity/emitted')).filter((f) => f.endsWith('.css') && own(f)).length);
  });
});
