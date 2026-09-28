// The one document tree the translator reads, whatever it came from: an HTML page (parse5), an XHTML or XML page (src/xml.ts), or
// a DOM snapshot taken in Chrome after the test's scripts ran (src/snapshot.ts). Comments and processing instructions are not in
// it; text is kept as it is in the DOM (entities decoded).
import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export type DomText = { readonly text: string };
export type DomElement = {
  /** The local name as the DOM reports it (lower case for HTML elements). */
  readonly tag: string;
  /** The namespace URI; '' for none. */
  readonly ns: string;
  /** Attributes by qualified name ("xml:lang", "xmlns"), in document order, first occurrence only. */
  readonly attrs: readonly (readonly [string, string])[];
  readonly children: readonly DomNode[];
};
export type DomNode = DomElement | DomText;

export type DomDocument = {
  readonly root: DomElement;
  /** Stylesheets linked by <?xml-stylesheet?> processing instructions before the root, in order (XML documents only). */
  readonly stylesheetPIs: readonly { readonly href: string; readonly media: string; readonly alternate: boolean }[];
  /** How the document was produced: 'html' (parse5), 'xml' (src/xml.ts), or 'snapshot' (Chrome's DOM after scripts). */
  readonly origin: 'html' | 'xml' | 'snapshot';
};

export const isElement = (n: DomNode): n is DomElement => 'tag' in n;

type P5Node = DefaultTreeAdapterTypes.Node;
type P5Element = DefaultTreeAdapterTypes.Element;

function fromParse5(node: P5Element): DomElement {
  const attrs: [string, string][] = [];
  const seen = new Set<string>();
  for (const a of node.attrs) {
    const name = a.prefix === undefined || a.prefix === '' ? a.name : `${a.prefix}:${a.name}`;
    if (seen.has(name)) continue;
    seen.add(name);
    attrs.push([name, a.value]);
  }
  const children: DomNode[] = [];
  for (const c of node.childNodes as P5Node[]) {
    if ('tagName' in c) children.push(fromParse5(c as P5Element));
    else if (c.nodeName === '#text') children.push({ text: (c as DefaultTreeAdapterTypes.TextNode).value });
  }
  return { tag: node.tagName, ns: node.namespaceURI, attrs, children };
}

/** An HTML page through parse5; null when it has no <html> element. */
export function parseHtmlDocument(source: string): DomDocument | null {
  const doc = parse(source);
  const html = doc.childNodes.find((c) => 'tagName' in c && (c as P5Element).tagName === 'html') as P5Element | undefined;
  return html === undefined ? null : { root: fromParse5(html), stylesheetPIs: [], origin: 'html' };
}
