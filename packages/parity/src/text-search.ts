// Whole-corpus absence checks over megabytes of generated source: one pass over the text instead of one scan per needle.

/** The needles that occur in text, the same set as needles.filter((n) => text.includes(n)), found in one pass (Aho-Corasick). */
export function containedNeedles(text: string, needles: Iterable<string>): Set<string> {
  const words = [...new Set(needles)];
  const found = new Set<string>();
  // Node 0 is the root; an edge is keyed node * 0x10000 + UTF-16 code unit.
  const next = new Map<number, number>();
  const ends: (number[] | null)[] = [null];
  for (let w = 0; w < words.length; w++) {
    const word = words[w] as string;
    if (word === '') {
      found.add(word);
      continue;
    }
    let node = 0;
    for (let i = 0; i < word.length; i++) {
      const key = node * 0x10000 + word.charCodeAt(i);
      let to = next.get(key);
      if (to === undefined) {
        to = ends.length;
        ends.push(null);
        next.set(key, to);
      }
      node = to;
    }
    (ends[node] ??= []).push(w);
  }
  const children: number[][] = ends.map(() => []);
  const codes: number[][] = ends.map(() => []);
  for (const [key, to] of next) {
    const from = Math.floor(key / 0x10000);
    children[from]?.push(to);
    codes[from]?.push(key % 0x10000);
  }
  const fail = new Int32Array(ends.length);
  // The nearest node on the fail chain (itself excluded) that ends a needle, or -1.
  const output = new Int32Array(ends.length).fill(-1);
  const queue: number[] = [];
  for (const c of children[0] ?? []) queue.push(c);
  for (let q = 0; q < queue.length; q++) {
    const node = queue[q] as number;
    const kids = children[node] ?? [];
    const kidCodes = codes[node] ?? [];
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k] as number;
      const code = kidCodes[k] as number;
      let f = fail[node] as number;
      let target = node === 0 ? 0 : (next.get(f * 0x10000 + code) ?? -1);
      while (node !== 0 && target === -1 && f !== 0) {
        f = fail[f] as number;
        target = next.get(f * 0x10000 + code) ?? -1;
      }
      if (target === -1) target = 0;
      fail[child] = target;
      output[child] = ends[target] !== null ? target : (output[target] as number);
      queue.push(child);
    }
  }
  const reported = new Uint8Array(ends.length);
  let node = 0;
  for (let i = 0; i < text.length && found.size < words.length; i++) {
    const code = text.charCodeAt(i);
    let to = next.get(node * 0x10000 + code);
    while (to === undefined && node !== 0) {
      node = fail[node] as number;
      to = next.get(node * 0x10000 + code);
    }
    node = to ?? 0;
    for (let n = ends[node] !== null ? node : (output[node] as number); n !== -1 && reported[n] === 0; n = output[n] as number) {
      reported[n] = 1;
      for (const w of ends[n] ?? []) found.add(words[w] as string);
    }
  }
  return found;
}

/**
 * Every maximal run of [\w-] that follows a '.' which is a selector token, not prose: one not after a word character or a '.' ("e.g."
 * in a text literal is not the class .g, TXT1a-2 text-latin-punct). So new RegExp(`(?<![\\w.])\\.${name}(?![\\w-])`).test(text) is
 * dotNames(text).has(name).
 */
export function dotNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/(?<![\w.])\.([\w-]*)/g)) names.add(m[1] as string);
  return names;
}
