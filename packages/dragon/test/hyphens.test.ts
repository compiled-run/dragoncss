// TXT2-i (notes/T149-txt2-spec.md R14): hyphens and its -webkit-hyphens alias. The engine breaks as manual; auto lowers as manual
// (Chrome hyphenates nothing without a content language), and none on text holding a soft hyphen is refused for every target. The
// Chrome cases are text-hyphens (packages/parity/fixtures); this file holds the parsing, the refusal and the noneSoftHyphenAccepted plant.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/hyphens.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostic code. */
function parsed(property: string, value: string): string[] {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text under the declaration. */
function errorsAt(decl: string, content: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .h { ${decl}; width: 50px; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['h'], [text(r, 't', content)])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];
const SHY = 'XXX­XXX­XXX';

describe('hyphens (css-text-3 §6.1)', () => {
  it('parses none, manual and auto, and -webkit-hyphens is the same declaration', () => {
    for (const v of ['none', 'manual', 'auto']) {
      expect(parsed('hyphens', v)).toEqual([`hyphens: ${v}`]);
      expect(parsed('-webkit-hyphens', v)).toEqual([`hyphens: ${v}`]);
    }
    expect(parsed('hyphens', 'always')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('accepts manual and auto with soft hyphens, and none without one', () => {
    expect(errorsAt('hyphens: manual', SHY)).toEqual([]);
    expect(errorsAt('hyphens: auto', SHY)).toEqual([]);
    expect(errorsAt('-webkit-hyphens: auto', SHY)).toEqual([]);
    expect(errorsAt('hyphens: none', 'XXX XXX XXX')).toEqual([]);
  });

  it('refuses none on text that holds a soft hyphen, on every target, also through the alias', () => {
    expect(errorsAt('hyphens: none', SHY)).toEqual(REFUSED);
    expect(errorsAt('-webkit-hyphens: none', SHY)).toEqual(REFUSED);
  });

  it('plant noneSoftHyphenAccepted: none with a soft hyphen compiles', () => {
    expect(errorsAt('hyphens: none', SHY, { ...NO_FAULTS, noneSoftHyphenAccepted: true })).toEqual([]);
  });
});
