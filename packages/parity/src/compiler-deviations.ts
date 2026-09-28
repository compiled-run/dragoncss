// Chrome deviations in the compiler's selector matching: Chrome 145 differs from the spec text, Dragon follows Chrome, and a
// planted spec-reading fault (CompilerFaults) applies the spec text so the proving fixture's nodes fail. The engine registries
// (packages/layout/src/chrome-deviations*.ts) hold layout deviations; this one holds cascade and matching deviations.
import type { CompilerFaults } from 'dragon';

export type CompilerChromeDeviation = {
  readonly id: string;
  readonly specSection: string;
  readonly spec: string;
  /** The Blink behaviour, and the probe that measured it in 145.0.7632.6. */
  readonly blink: string;
  /** The planted compiler fault that applies the spec reading. */
  readonly fault: keyof { [K in keyof CompilerFaults as CompilerFaults[K] extends boolean ? K : never]: true };
  readonly model: string;
  readonly fixture: string;
  /** Nodes whose authored and compiled values differ under the fault, in every case of the fixture. */
  readonly nodes: readonly string[];
};

export const compilerChromeDeviations: readonly CompilerChromeDeviation[] = [
  {
    id: 'empty-counts-whitespace',
    specSection: 'selectors-4 §14.2 (:empty)',
    spec: 'The :empty pseudo-class represents an element that has no children except, optionally, document white space characters.',
    blink:
      'third_party/blink/renderer/core/css/selector_checker.cc, CSSSelector::kPseudoEmpty at 145.0.7632.6: a child element or a Text child with non-empty data makes the element non-empty; whitespace-only text is not skipped. Probed: <div> </div> does not match :empty, <div></div> does.',
    fault: 'emptyIgnoresWhitespace',
    model: 'analysis/match.ts isEmpty: an element is empty when every child is a text node with empty data.',
    fixture: 'tree-selectors-state',
    nodes: ['blank'],
  },
];
