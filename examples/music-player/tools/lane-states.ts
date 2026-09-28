// Runtime state changes for the lane's frames: the DOM operations that turn one free state into another, derived by diffing the
// two state snapshots, so a transition is triggered by the same class and text changes the counted snapshot edits make.
export type DomOp = { readonly id: string; readonly className: string | null; readonly text: string | null };

type Tag = { readonly className: string | null; readonly text: string };

function tagsById(html: string): Map<string, Tag> {
  const out = new Map<string, Tag>();
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([^<]*)/gi)) {
    const attrs = m[2] as string;
    const id = /\bdata-dragon-id="([^"]*)"/.exec(attrs);
    if (id === null) continue;
    const cls = /\bclass="([^"]*)"/.exec(attrs);
    if (out.has(id[1] as string)) throw new Error(`duplicate data-dragon-id ${id[1]}`);
    out.set(id[1] as string, { className: cls === null ? null : (cls[1] as string), text: m[3] as string });
  }
  return out;
}

/** Per data-dragon-id element: the class attribute and the leading text child to set; the rest of the tree must be equal. */
export function stateDomOps(fromHtml: string, toHtml: string): readonly DomOp[] {
  const from = tagsById(fromHtml);
  const to = tagsById(toHtml);
  if ([...from.keys()].join() !== [...to.keys()].join()) throw new Error('states differ in their element ids');
  const ops: DomOp[] = [];
  for (const [id, a] of from) {
    const b = to.get(id) as Tag;
    const className = a.className === b.className ? null : b.className;
    const text = a.text === b.text ? null : b.text;
    if (className === null && text === null) continue;
    if (className === null && a.className !== b.className) throw new Error(`${id}: class removal is not a class change`);
    ops.push({ id, className, text });
  }
  return ops;
}
