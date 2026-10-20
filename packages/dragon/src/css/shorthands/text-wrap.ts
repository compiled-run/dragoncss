// text-wrap (css-text-4 §5.1): <'text-wrap-mode'> || <'text-wrap-style'>, as Chrome 145 parses and expands it; an omitted longhand
// takes its initial value (wrap, auto). balance and pretty are refused (properties/text-wrap.ts).
import type { CssValue } from '../values.ts';
import { kw } from '../values.ts';
import { wrapStyleRefusal } from '../properties/text-wrap.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit } from './shared.ts';

const MODES: ReadonlySet<string> = new Set(['wrap', 'nowrap']);

export const TEXT_WRAP_SHORTHANDS = {
  'text-wrap': {
    longhands: ['text-wrap-mode', 'text-wrap-style'],
    refuse: (tokens, base) => wrapStyleRefusal(tokens, base, 'text-wrap'),
    expand: (values) => {
      const keyword = (v: CssValue): string | null => (v.kind === 'keyword' ? v.value : null);
      const mode = values.find((v) => MODES.has(keyword(v) ?? ''));
      const style = values.find((v) => v !== mode);
      return [
        mode === undefined ? implicit('text-wrap-mode', kw('wrap')) : explicit('text-wrap-mode', mode),
        style === undefined ? implicit('text-wrap-style', kw('auto')) : explicit('text-wrap-style', style),
      ];
    },
  },
} as const satisfies { readonly [s: string]: ShorthandHandler };
