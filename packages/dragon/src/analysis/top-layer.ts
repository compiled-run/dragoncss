// css-position-4 §3: the boxes resolve.ts liftTopLayer moves into the top layer (a modal dialog and its ::backdrop).
const topLayer = new WeakSet<object>();

/** Records a box liftTopLayer moved into the top layer. */
export const enterTopLayer = (el: object): void => void topLayer.add(el);

/** Whether liftTopLayer moved the box into the top layer. */
export const isTopLayer = (el: object): boolean => topLayer.has(el);
