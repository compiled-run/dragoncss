// css-position-4 §3: the boxes resolve.ts liftTopLayer moves into the top layer (a modal dialog and its ::backdrop), each with the
// DOM ancestors it still inherits from (zoom included) though its box is now the root's child.
const topLayer = new WeakMap<object, readonly object[]>();

/** Records a box liftTopLayer moved into the top layer and its DOM ancestors, root first (the dialog last for its ::backdrop). */
export const enterTopLayer = <T extends object>(el: T, ancestors: readonly T[]): void => void topLayer.set(el, ancestors);

/** Whether liftTopLayer moved the box into the top layer. */
export const isTopLayer = (el: object): boolean => topLayer.has(el);

/** The DOM ancestors, root first, of a box liftTopLayer moved, or undefined for a box still in its DOM parent. */
export const topLayerAncestorsOf = <T extends object>(el: T): readonly T[] | undefined => topLayer.get(el) as readonly T[] | undefined;
