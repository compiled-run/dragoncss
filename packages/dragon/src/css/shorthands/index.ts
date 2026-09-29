// The shorthand registry: one handler per shorthand in properties.ts SHORTHANDS, gathered from one file per family. The mapped
// type makes a shorthand without a handler (or a handler without a shorthand) a type error.
import type { Shorthand } from '../properties.ts';
import { BACKGROUND_SHORTHANDS } from './background.ts';
import { BORDER_SHORTHANDS } from './border.ts';
import { BOX_SHORTHANDS } from './box.ts';
import { FLEX_SHORTHANDS } from './flex.ts';
import { GRID_SHORTHANDS } from './grid.ts';
import { LOGICAL_SHORTHANDS } from './logical.ts';
import { OVERFLOW_SHORTHANDS } from './overflow.ts';
import type { ShorthandHandler } from './shared.ts';
import { TEXT_SHORTHANDS } from './text.ts';

export type { ShorthandHandler } from './shared.ts';

export const SHORTHAND_HANDLERS: { readonly [S in Shorthand]: ShorthandHandler } = {
  ...BOX_SHORTHANDS,
  ...BORDER_SHORTHANDS,
  ...FLEX_SHORTHANDS,
  ...OVERFLOW_SHORTHANDS,
  ...TEXT_SHORTHANDS,
  ...LOGICAL_SHORTHANDS,
  ...BACKGROUND_SHORTHANDS,

  ...GRID_SHORTHANDS,
};

export function shorthandHandler(property: Shorthand): ShorthandHandler {
  const h = SHORTHAND_HANDLERS[property] as ShorthandHandler | undefined;
  if (h === undefined) throw new Error(`no expansion for shorthand ${property}`);
  return h;
}
