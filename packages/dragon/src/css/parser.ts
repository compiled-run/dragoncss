// css-tree 3.2.1's stylesheet parser with one change: an @layer block nested in a style rule parses as a nested declaration list
// (css-nesting-1 §3.2), as css-tree already parses @media, @supports and @container there. css-tree parses it as a rule list, so its
// declarations became parse errors that stopped the whole analysis, enclosed rules of other at-rules included.
import { fork } from 'css-tree';
import type { CssNode, ParseOptions } from 'css-tree';

const syntax = fork({
  atrule: {
    // fork replaces an at-rule's parse functions as a whole, so the prelude is css-tree's own (lib/syntax/atrule/layer.js).
    layer: {
      parse: {
        prelude() {
          return this.createSingleNodeList(this.LayerList());
        },
        block(nested = false) {
          return this.Block(nested);
        },
      },
    },
  },
});

export const parseCss = (text: string, options: ParseOptions): CssNode => syntax.parse(text, options);
