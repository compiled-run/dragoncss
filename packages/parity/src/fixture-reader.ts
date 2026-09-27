// Reads a fixture file (a strict HTML subset) into the FrontEndResult a framework producer would supply.
// <head> is not part of the element tree: it generates no boxes. Text node ids are "<parent id>:text<k>".
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ElementNode, FrontEndResult, SourceRef, Span, TreeNode } from 'dragon';
import { TREE_SCHEMA_REVISION } from 'dragon';
import { repoPath } from './paths.ts';

export const PROJECT_ID = 'dragon-parity';

type RawElement = { tag: string; attrs: Map<string, string>; children: (RawElement | RawText)[]; start: number; openEnd: number; end: number };
type RawText = { text: string; start: number; end: number };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    const v = ENTITIES[e.toLowerCase()];
    if (v === undefined) throw new Error(`unknown entity ${m}`);
    return v;
  });
}

/** Parses the fixture HTML subset: a doctype, double-quoted attributes, raw <style> text, no comments or void elements. */
export function parseFixtureHtml(html: string): { root: RawElement; style: { start: number; end: number } } {
  const doctype = /^<!DOCTYPE html>\s*/i.exec(html);
  if (doctype === null) throw new Error('fixture must start with <!DOCTYPE html>');
  let i = doctype[0].length;
  const stack: RawElement[] = [];
  let root: RawElement | null = null;
  let style: { start: number; end: number } | null = null;
  while (i < html.length) {
    if (html.startsWith('</', i)) {
      const close = /^<\/([a-z][a-z0-9-]*)\s*>/.exec(html.slice(i));
      if (close === null) throw new Error(`bad end tag at ${i}`);
      const top = stack.pop();
      if (top === undefined || top.tag !== close[1]) throw new Error(`mismatched </${close[1]}> at ${i}`);
      top.end = i + close[0].length;
      i += close[0].length;
      continue;
    }
    if (html[i] === '<') {
      const open = /^<([a-z][a-z0-9-]*)((?:\s+[a-z][a-z0-9-]*="[^"]*")*)\s*>/.exec(html.slice(i));
      if (open === null) throw new Error(`unsupported markup at ${i}: ${html.slice(i, i + 20)}`);
      const attrs = new Map<string, string>();
      for (const m of (open[2] as string).matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/g)) {
        if (attrs.has(m[1] as string)) throw new Error(`duplicate attribute ${m[1]}`);
        attrs.set(m[1] as string, decode(m[2] as string));
      }
      const el: RawElement = { tag: open[1] as string, attrs, children: [], start: i, openEnd: i + open[0].length, end: -1 };
      i += open[0].length;
      const parent = stack[stack.length - 1];
      if (parent === undefined) {
        if (root !== null) throw new Error('more than one root element');
        root = el;
      } else parent.children.push(el);
      if (el.tag === 'style') {
        const endAt = html.indexOf('</style>', i);
        if (endAt < 0 || style !== null) throw new Error('fixtures need exactly one closed <style>');
        style = { start: i, end: endAt };
        el.end = endAt + '</style>'.length;
        i = el.end;
        continue;
      }
      stack.push(el);
      continue;
    }
    const next = html.indexOf('<', i);
    const endText = next < 0 ? html.length : next;
    const parent = stack[stack.length - 1];
    const text = html.slice(i, endText);
    if (parent === undefined) {
      if (text.trim() !== '') throw new Error('text outside <html>');
    } else parent.children.push({ text: decode(text), start: i, end: endText });
    i = endText;
  }
  if (stack.length > 0 || root === null || style === null) throw new Error('unclosed elements, no root, or no <style>');
  return { root, style };
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * The compiled rendering of a fixture for the chrome-dual lane: the same markup and text, with each element's class
 * attribute replaced by its generated class and the stylesheet text replaced by Dragon's web output.
 */
export function compiledFixtureHtml(html: string, css: string, classOf: ReadonlyMap<string, string>): string {
  const { root, style } = parseFixtureHtml(html);
  const edits: { start: number; end: number; text: string }[] = [{ start: style.start, end: style.end, text: `\n${css}` }];
  const visit = (el: RawElement): void => {
    const id = el.attrs.get('data-dragon-id');
    if (id !== undefined) {
      const cls = classOf.get(id);
      if (cls === undefined) throw new Error(`no generated class for ${id}`);
      const attrs = [...el.attrs.entries()].filter(([k]) => k !== 'class').map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
      edits.push({ start: el.start, end: el.openEnd, text: `<${el.tag}${attrs} class="${cls}">` });
    }
    for (const c of el.children) if ('tag' in c) visit(c);
  };
  visit(root);
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += html.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + html.slice(at);
}

const isBlankText = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';

export function readFixture(id: string): { html: string; input: FrontEndResult } {
  const html = readFileSync(repoPath(`packages/parity/fixtures/${id}.html`), 'utf8');
  return { html, input: fixtureToInput(id, html) };
}

export function fixtureToInput(id: string, html: string): FrontEndResult {
  const { root, style } = parseFixtureHtml(html);
  const ref: SourceRef = {
    uri: `dragon-source://${PROJECT_ID}/fixtures/${id}.html`,
    revision: 'fixture',
    hash: `sha256:${createHash('sha256').update(html, 'utf8').digest('hex')}`,
  };
  const span = (start: number, end: number): Span => ({ source: ref, start, end });
  if (root.tag !== 'html') throw new Error('root must be <html>');
  const convert = (el: RawElement): ElementNode => {
    const id = el.attrs.get('data-dragon-id');
    if (id === undefined) throw new Error(`<${el.tag}> at ${el.start} needs data-dragon-id`);
    const classAttr = el.attrs.get('class');
    const attributes = [...el.attrs.entries()]
      .filter(([k]) => k !== 'data-dragon-id' && k !== 'class')
      .map(([name, value]) => ({ name, value }));
    const children: TreeNode[] = [];
    let k = 0;
    for (const c of el.children) {
      if ('tag' in c) {
        if (c.tag === 'head') continue;
        children.push(convert(c));
      } else if (!isBlankText(c.text)) {
        children.push({ kind: 'text', id: `${id}:text${k++}`, text: c.text, origin: span(c.start, c.end) });
      }
    }
    return {
      kind: 'element',
      id,
      tag: el.tag,
      classes: classAttr === undefined ? [] : classAttr.split(/\s+/).filter((c) => c !== ''),
      attributes,
      children,
      origin: span(el.start, el.end),
    };
  };
  const tree = convert(root);
  return {
    producer: { name: 'dragon-parity-fixture-reader', version: '0.0.0', schemaRevision: TREE_SCHEMA_REVISION },
    snapshot: {
      projectId: PROJECT_ID,
      revision: 'fixture',
      sources: [{ ref, text: html, displayPath: `packages/parity/fixtures/${id}.html` }],
      assets: [],
      resolutions: [],
    },
    diagnostics: [],
    tree: {
      schema: 'dragon/tree@0',
      schemaRevision: TREE_SCHEMA_REVISION,
      modules: [{ id: 'fixture', source: ref.uri }],
      components: [{ id: 'Fixture', module: 'fixture', root: [tree] }],
      documents: [{ id: 'doc', rootInstance: 'Fixture', documentElement: tree.id, styles: ['sheet'], initial: [] }],
      styles: [{ id: 'sheet', css: span(style.start, style.end), scope: { kind: 'document' } }],
    },
    completeness: 'closed-application',
  };
}
