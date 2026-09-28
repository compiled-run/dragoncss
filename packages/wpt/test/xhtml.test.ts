import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DomElement } from '../src/dom.ts';
import { isElement, XHTML_NS } from '../src/dom.ts';
import { runTranslation } from '../src/dragon.ts';
import { buildManifest } from '../src/manifest.ts';
import { lockedCommit, pinnedWptDir } from '../src/paths.ts';
import { parseWptDocument, translate } from '../src/translate.ts';
import { parseXmlDocument, XmlError } from '../src/xml.ts';

const XHTML_DOCTYPE = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
const HARNESS = '<script src="/resources/testharness.js"></script><script src="/resources/testharnessreport.js"></script><script src="/resources/check-layout-th.js"></script>';
const text = (e: DomElement): string => e.children.map((c) => (isElement(c) ? text(c) : c.text)).join('');
const find = (e: DomElement, tag: string): DomElement | undefined => {
  if (e.tag === tag) return e;
  for (const c of e.children) if (isElement(c)) {
    const hit = find(c, tag);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

describe('the XML parser', () => {
  it('resolves namespaces, keeps qualified attribute names and decodes references', () => {
    const doc = parseXmlDocument(`<?xml version="1.0"?>${XHTML_DOCTYPE}<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><body><p a="x&#9;y&amp;z">1&nbsp;2&#x41;&lt;</p><svg:svg xmlns:svg="http://www.w3.org/2000/svg"/></body></html>`);
    expect(doc.origin).toBe('xml');
    expect(doc.root).toMatchObject({ tag: 'html', ns: XHTML_NS, attrs: [['xmlns', XHTML_NS], ['xml:lang', 'en']] });
    const p = find(doc.root, 'p') as DomElement;
    expect(p.attrs).toEqual([['a', 'x y&z']]);
    expect(text(p)).toBe('1\u00a02A<');
    expect(find(doc.root, 'svg')?.ns).toBe('http://www.w3.org/2000/svg');
  });

  it('keeps CDATA as text, drops comments, and reads <?xml-stylesheet?> before the root', () => {
    const doc = parseXmlDocument(`<?xml-stylesheet href="support/a.css" type="text/css"?><?xml-stylesheet href="b.css" alternate="yes"?><html xmlns="http://www.w3.org/1999/xhtml"><head><style><![CDATA[ .a > .b { } ]]><!-- c --></style></head></html>`);
    expect(doc.stylesheetPIs).toEqual([{ href: 'support/a.css', media: 'all', alternate: false }, { href: 'b.css', media: 'all', alternate: true }]);
    expect(text(find(doc.root, 'style') as DomElement)).toBe(' .a > .b { } ');
  });

  it('expands internal-subset entities; refuses what is not well-formed', () => {
    expect(text(parseXmlDocument('<!DOCTYPE r [<!ENTITY e "v&#65;">]><r>&e;</r>').root)).toBe('vA');
    expect(() => parseXmlDocument('<r><a></r>')).toThrow(XmlError);
    expect(() => parseXmlDocument('<r>&nbsp;</r>')).toThrow(XmlError);
    expect(() => parseXmlDocument('<r a="1" a="2"/>')).toThrow(XmlError);
    expect(() => parseXmlDocument('<r/><s/>')).toThrow(XmlError);
    expect(() => parseXmlDocument('<p:r/>')).toThrow(XmlError);
  });

  it('parses every .xht, .xhtml and .xml test file at the pinned commit', () => {
    const wpt = pinnedWptDir();
    const failures: string[] = [];
    let n = 0;
    for (const e of buildManifest(wpt)) {
      if (!/\.(xht|xhtml|xml)$/.test(e.path)) continue;
      n++;
      try {
        parseXmlDocument(readFileSync(join(wpt, e.path), 'utf8'));
      } catch (x) {
        failures.push(`${e.path}: ${(x as Error).message}`);
      }
    }
    expect(n).toBeGreaterThan(10_000);
    expect(failures).toEqual([]);
  });
});

describe('XHTML through the translator', () => {
  const commit = 'c0ffee';
  const page = (css: string, body: string, pis = ''): string =>
    `<?xml version="1.0" encoding="UTF-8"?>\n${pis}${XHTML_DOCTYPE}\n<html xmlns="http://www.w3.org/1999/xhtml"><head>${HARNESS}<style type="text/css"><![CDATA[${css}]]></style></head><body onload="checkLayout('.t')">${body}</body></html>`;

  it('an .xht check-layout page translates like HTML and runs', () => {
    const t = translate('css/x/case.xht', page('.t { width: 40px; } .t > div { height: 5px; }', '<div class="t" data-expected-width="40"><div data-expected-height="5"/></div>'), commit);
    if (t.kind !== 'fixture') throw new Error(t.missing);
    expect(t.html).not.toMatch(/xmlns|CDATA|<script/);
    expect(t.sidecar.subtests.map((s) => s.checks.length)).toEqual([2]);
    expect(runTranslation(t, 'web').outcome.status).toBe('pass');
  });

  it('<?xml-stylesheet?> helper sheets are inlined first, resolved against the test; missing ones are refused', () => {
    const html = page('.t { height: 5px; }', '<div class="t" data-expected-width="30"/>', '<?xml-stylesheet href="support/w.css" type="text/css"?>\n');
    expect(translate('css/x/case.xht', html, commit)).toEqual({ kind: 'refused', missing: 'translate:external-stylesheet' });
    const read = (p: string): string | null => (p === 'css/x/support/w.css' ? '.t { width: 30px; }' : null);
    const t = translate('css/x/case.xht', html, commit, read);
    if (t.kind !== 'fixture') throw new Error(t.missing);
    expect(t.html.indexOf('/* <?xml-stylesheet?> css/x/support/w.css */')).toBeLessThan(t.html.indexOf('.t { height: 5px; }'));
    expect(runTranslation(t, 'web').outcome.status).toBe('pass');
  });

  it('xml:lang becomes lang; malformed XML and SVG documents are refused with their own reasons', () => {
    const t = translate('css/x/case.xht', page('.t { width: 1px; }', '<div class="t" xml:lang="fr" data-expected-width="1"/>'), commit);
    if (t.kind !== 'fixture') throw new Error(t.missing);
    expect(t.html).toContain('lang="fr"');
    expect(translate('css/x/case.xht', '<html xmlns="http://www.w3.org/1999/xhtml"><body></html>', commit)).toEqual({ kind: 'refused', missing: 'translate:xml-parse' });
    expect(translate('css/x/case.svg', '<svg/>', commit)).toEqual({ kind: 'refused', missing: 'translate:svg-document' });
    expect(translate('css/x/case.xml', '<root/>', commit)).toEqual({ kind: 'refused', missing: 'translate:foreign-element' });
  });

  it('a real CSS2 .xht reftest parses into the same element order as the HTML path would give', () => {
    const wpt = pinnedWptDir();
    const path = 'css/CSS2/abspos/abspos-containing-block-initial-009e.xht';
    const doc = parseWptDocument(path, readFileSync(join(wpt, path), 'utf8'));
    if ('missing' in doc) throw new Error(doc.missing);
    const tags: string[] = [];
    const walk = (e: DomElement): void => {
      tags.push(e.tag);
      for (const c of e.children) if (isElement(c)) walk(c);
    };
    walk(doc.root);
    expect(tags).toEqual(['html', 'head', 'title', 'link', 'link', 'link', 'link', 'meta', 'body']);
    expect(translate(path, readFileSync(join(wpt, path), 'utf8'), lockedCommit(), () => null, { mode: 'reftest' }).kind).toBe('fixture');
  });
});
