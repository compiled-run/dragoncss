// node scripts/capture-interpolable.ts: writes packages/dragon/test/data/chrome-145-interpolable.json, the `interpolable` and
// `valid_for_keyframe` flags of every property in Chrome 145's css_properties.json5 (T065 R13), fetched at the tag and checked
// against its pinned sha256. `-- --check` compares the snapshot with a fresh fetch and exits 1 on any difference.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { repoPath } from '../packages/parity/src/paths.ts';

const URL_AT_TAG = 'https://chromium.googlesource.com/chromium/src/+/refs/tags/145.0.7632.6/third_party/blink/renderer/core/css/css_properties.json5?format=TEXT';
const SHA256 = 'abdc48ff9bf1815acd8f01907eecb26cc788f44ecd6163dd9821521d815f71e3';
const OUT = repoPath('packages/dragon/test/data/chrome-145-interpolable.json');

/** Every property name, and the names whose interpolable flag is true or whose valid_for_keyframe flag is false; all sorted. */
export type InterpolableSnapshot = {
  readonly source: string;
  readonly sha256: string;
  readonly properties: readonly string[];
  readonly interpolable: readonly string[];
  readonly notValidForKeyframe: readonly string[];
};

/** JSON5 as css_properties.json5 writes it: comments, unquoted keys, single-quoted strings and trailing commas, made JSON. */
export function json5ToJson(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"' || c === "'") {
      let j = i + 1;
      let body = '';
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\') {
          body += text.slice(j, j + 2);
          j += 2;
          continue;
        }
        body += text[j] === '"' ? '\\"' : text[j];
        j++;
      }
      if (j >= text.length) throw new Error(`unterminated string at offset ${i}`);
      out += `"${body}"`;
      i = j + 1;
    } else if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`unterminated comment at offset ${i}`);
      i = end + 2;
    } else if (/[A-Za-z_$]/.test(c) && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? ' ')) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i)) as RegExpExecArray;
      const word = m[0];
      const after = text.slice(i + word.length).trimStart();
      out += after.startsWith(':') ? `"${word}"` : word;
      i += word.length;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function snapshotOf(text: string): InterpolableSnapshot {
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (sha256 !== SHA256) throw new Error(`css_properties.json5 at the tag has sha256 ${sha256}, expected ${SHA256}`);
  const data = JSON.parse(json5ToJson(text)) as { readonly data: readonly { readonly name: unknown; readonly interpolable?: unknown; readonly valid_for_keyframe?: unknown }[] };
  const properties: string[] = [];
  const interpolable: string[] = [];
  const notValidForKeyframe: string[] = [];
  for (const p of data.data) {
    if (typeof p.name !== 'string') throw new Error(`a property entry has no name: ${JSON.stringify(p).slice(0, 80)}`);
    for (const [k, v] of [['interpolable', p.interpolable], ['valid_for_keyframe', p.valid_for_keyframe]] as const) {
      if (v !== undefined && typeof v !== 'boolean') throw new Error(`${p.name}: ${k} is ${JSON.stringify(v)}, not a boolean`);
    }
    if (properties.includes(p.name)) throw new Error(`${p.name} is listed twice`);
    properties.push(p.name);
    if (p.interpolable === true) interpolable.push(p.name);
    if (p.valid_for_keyframe === false) notValidForKeyframe.push(p.name);
  }
  const sorted = (a: string[]): string[] => [...a].sort();
  return { source: 'third_party/blink/renderer/core/css/css_properties.json5 at 145.0.7632.6', sha256, properties: sorted(properties), interpolable: sorted(interpolable), notValidForKeyframe: sorted(notValidForKeyframe) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await fetch(URL_AT_TAG);
  if (!res.ok) throw new Error(`fetching css_properties.json5 failed: HTTP ${res.status}`);
  const text = Buffer.from(await res.text(), 'base64').toString('utf8');
  const snap = snapshotOf(text);
  const list = (k: string, v: readonly string[]): string => `${JSON.stringify(k)}: [\n${v.map((n) => JSON.stringify(n)).join(',\n')}\n]`;
  const out = `{\n"source": ${JSON.stringify(snap.source)},\n"sha256": ${JSON.stringify(snap.sha256)},\n${list('properties', snap.properties)},\n${list('interpolable', snap.interpolable)},\n${list('notValidForKeyframe', snap.notValidForKeyframe)}\n}\n`;
  if (process.argv.includes('--check')) {
    const stored = readFileSync(OUT, 'utf8');
    console.log(stored === out ? 'capture-interpolable --check: the snapshot is current' : 'capture-interpolable --check: the snapshot differs from the tag');
    if (stored !== out) process.exitCode = 1;
  } else {
    writeFileSync(OUT, out);
    console.log(`capture-interpolable: wrote ${snap.properties.length} properties, ${snap.interpolable.length} interpolable`);
  }
}
