// Blink's RunSegmenter for horizontal text (run_segmenter.cc, script_run_iterator.cc, Chrome 145), which
// splits a paragraph into the ranges HarfBuzz shapes separately. Unicode properties come from V8's
// ICU (RegExp Unicode property escapes) and the Unicode 16 BidiBrackets table below.

/** UScriptCode values (ICU uscript.h) for the scripts the gate can meet; order decides priority. */
const USCRIPT: Readonly<Record<string, number>> = {
  Zyyy: 0, Zinh: 1, Arab: 2, Armn: 3, Beng: 4, Bopo: 5, Cyrl: 8, Deva: 10, Grek: 14, Hani: 17, Hang: 18,
  Hebr: 19, Hira: 20, Kana: 22, Latn: 25, Thai: 38, Yiii: 41,
};
const COMMON = 0;
const INHERITED = 1;
const LATIN = 25;
const HIRAGANA = 20;
const KATAKANA = 22;
const HAN = 17;
const BOPOMOFO = 5;

const SCRIPT_NAMES = Object.keys(USCRIPT).sort((a, b) => (USCRIPT[a] as number) - (USCRIPT[b] as number));
const byCode = new Map(Object.entries(USCRIPT).map(([k, v]) => [v, k]));
const scRe = new Map(SCRIPT_NAMES.map((s) => [s, new RegExp(`^\\p{Script=${s}}$`, 'u')]));
const scxRe = new Map(SCRIPT_NAMES.map((s) => [s, new RegExp(`^\\p{Script_Extensions=${s}}$`, 'u')]));
const markRe = /^\p{M}$/u;

export function scriptName(code: number): string {
  const n = byCode.get(code);
  if (n === undefined) throw new Error(`unknown UScriptCode ${code}`);
  return n;
}

function scriptOf(ch: string): number {
  for (const s of SCRIPT_NAMES) if ((scRe.get(s) as RegExp).test(ch)) return USCRIPT[s] as number;
  throw new Error(`gate: character U+${(ch.codePointAt(0) as number).toString(16)} has a script outside the gate's table`);
}

function scriptExtensions(ch: string): number[] {
  const out: number[] = [];
  for (const s of SCRIPT_NAMES) if ((scxRe.get(s) as RegExp).test(ch)) out.push(USCRIPT[s] as number);
  if (out.length === 0) throw new Error(`gate: character U+${(ch.codePointAt(0) as number).toString(16)} has script extensions outside the gate's table`);
  return out;
}

/** ICUScriptData::GetScripts. */
export function getScripts(ch: string): number[] {
  const dst = scriptExtensions(ch);
  let primary = scriptOf(ch);
  if (primary === KATAKANA) primary = HIRAGANA; // GetScriptForOpenType
  if (primary === dst[0]) return dst;
  if (primary !== INHERITED && primary !== COMMON) {
    const i = dst.indexOf(primary, 1);
    if (i < 0) {
      dst.push(primary);
      [dst[0], dst[dst.length - 1]] = [dst[dst.length - 1] as number, dst[0] as number];
    } else {
      [dst[0], dst[i]] = [dst[i] as number, dst[0] as number];
    }
    return dst;
  }
  if (primary === COMMON) {
    if (dst.length === 1) {
      dst.unshift(primary);
      return dst;
    }
    for (let i = 1; i < dst.length; i++) {
      if (dst[0] === LATIN || (dst[i] as number) < (dst[0] as number)) [dst[0], dst[i]] = [dst[i] as number, dst[0] as number];
    }
    return dst;
  }
  dst.push(dst[0] as number);
  dst[0] = primary;
  for (let i = 2; i < dst.length; i++) {
    if (dst[1] === LATIN || (dst[i] as number) < (dst[1] as number)) [dst[1], dst[i]] = [dst[i] as number, dst[1] as number];
  }
  return dst;
}

// Unicode 16 BidiBrackets.txt: [code point, paired bracket, open?].
const BRACKETS: ReadonlyArray<readonly [number, number, boolean]> = (
  '0028 0029 o,0029 0028 c,005B 005D o,005D 005B c,007B 007D o,007D 007B c,0F3A 0F3B o,0F3B 0F3A c,0F3C 0F3D o,0F3D 0F3C c,' +
  '169B 169C o,169C 169B c,2045 2046 o,2046 2045 c,207D 207E o,207E 207D c,208D 208E o,208E 208D c,2308 2309 o,2309 2308 c,' +
  '230A 230B o,230B 230A c,2329 232A o,232A 2329 c,2768 2769 o,2769 2768 c,276A 276B o,276B 276A c,276C 276D o,276D 276C c,' +
  '276E 276F o,276F 276E c,2770 2771 o,2771 2770 c,2772 2773 o,2773 2772 c,2774 2775 o,2775 2774 c,27C5 27C6 o,27C6 27C5 c,' +
  '27E6 27E7 o,27E7 27E6 c,27E8 27E9 o,27E9 27E8 c,27EA 27EB o,27EB 27EA c,27EC 27ED o,27ED 27EC c,27EE 27EF o,27EF 27EE c,' +
  '2983 2984 o,2984 2983 c,2985 2986 o,2986 2985 c,2987 2988 o,2988 2987 c,2989 298A o,298A 2989 c,298B 298C o,298C 298B c,' +
  '298D 2990 o,298E 298F c,298F 298E o,2990 298D c,2991 2992 o,2992 2991 c,2993 2994 o,2994 2993 c,2995 2996 o,2996 2995 c,' +
  '2997 2998 o,2998 2997 c,29D8 29D9 o,29D9 29D8 c,29DA 29DB o,29DB 29DA c,29FC 29FD o,29FD 29FC c,2E22 2E23 o,2E23 2E22 c,' +
  '2E24 2E25 o,2E25 2E24 c,2E26 2E27 o,2E27 2E26 c,2E28 2E29 o,2E29 2E28 c,2E55 2E56 o,2E56 2E55 c,2E57 2E58 o,2E58 2E57 c,' +
  '2E59 2E5A o,2E5A 2E59 c,2E5B 2E5C o,2E5C 2E5B c,3008 3009 o,3009 3008 c,300A 300B o,300B 300A c,300C 300D o,300D 300C c,' +
  '300E 300F o,300F 300E c,3010 3011 o,3011 3010 c,3014 3015 o,3015 3014 c,3016 3017 o,3017 3016 c,3018 3019 o,3019 3018 c,' +
  '301A 301B o,301B 301A c,FE59 FE5A o,FE5A FE59 c,FE5B FE5C o,FE5C FE5B c,FE5D FE5E o,FE5E FE5D c,FF08 FF09 o,FF09 FF08 c,' +
  'FF3B FF3D o,FF3D FF3B c,FF5B FF5D o,FF5D FF5B c,FF5F FF60 o,FF60 FF5F c,FF62 FF63 o,FF63 FF62 c'
)
  .split(',')
  .map((e) => {
    const [a, b, t] = e.split(' ');
    return [parseInt(a as string, 16), parseInt(b as string, 16), t === 'o'] as const;
  });
const bracketOf = new Map(BRACKETS.map(([c, p, open]) => [c, { pair: p, open }]));

/** East_Asian_Width W, F or H (only needed for Common-script brackets). */
function isEastAsianWideFullHalf(cp: number): boolean {
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
    [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xffdc], [0xffe0, 0xffee],
  ];
  return ranges.some(([a, b]) => cp >= a && cp <= b);
}

const HAN_SCRIPT_EXTENSIONS = (): number[] => scriptExtensions('「');

interface BracketRec { ch: number; script: number }

/** ScriptRunIterator: returns [end, script] pairs covering the text. */
export function scriptRuns(text: string): Array<{ start: number; end: number; script: number }> {
  const chars: Array<{ pos: number; cp: number; ch: string }> = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    chars.push({ pos: i, cp, ch });
    i += ch.length;
  }
  if (chars.length === 0) return [];
  for (const c of chars) if (markRe.test(c.ch)) throw new Error('gate: combining marks are outside the gate (ScriptRunIteratorCombiningMarks flags unknown)');

  const out: Array<{ start: number; end: number; script: number }> = [];
  let currentSet: number[] = [COMMON];
  let commonPreferred = COMMON;
  const brackets: BracketRec[] = [];
  let fixupDepth = 0;
  const MAX_BRACKETS = 32;
  let runStart = 0;

  const resolve = (): number => (currentSet[0] === COMMON ? commonPreferred : (currentSet[0] as number));
  const fixupStack = (resolved: number, excludeLast: boolean): void => {
    let count = Math.min(fixupDepth, brackets.length);
    if (count <= 0) return;
    let idx = brackets.length - 1;
    if (excludeLast) {
      idx--;
      count--;
      fixupDepth = 1;
    } else {
      fixupDepth = 0;
    }
    for (; count > 0; idx--, count--) (brackets[idx] as BracketRec).script = resolved;
  };

  const mergeSets = (next: number[]): boolean => {
    if (next.length === 0 || currentSet.length === 0) return false;
    let priority = currentSet[0] as number;
    if ((next[0] as number) <= INHERITED) {
      if (next.length === 2 && priority <= INHERITED && commonPreferred === COMMON) commonPreferred = next[1] as number;
      return true;
    }
    if (priority <= INHERITED) {
      currentSet = [...next];
      return true;
    }
    let havePriority = next.includes(priority);
    if (currentSet.length === 1) return havePriority;
    let nextFrom = 0;
    if (!havePriority) {
      priority = next[0] as number;
      nextFrom = 1;
      havePriority = currentSet.slice(1).includes(priority);
    }
    const written: number[] = [];
    if (havePriority) written.push(priority);
    const restNext = next.slice(nextFrom);
    if (restNext.length > 0) for (const sc of currentSet.slice(1)) if (restNext.includes(sc)) written.push(sc);
    if (written.length > 0) {
      currentSet = written;
      return true;
    }
    return false;
  };

  for (const c of chars) {
    let next = getScripts(c.ch);
    const b = bracketOf.get(c.cp);
    if (b?.open === true) {
      if (brackets.length === MAX_BRACKETS) {
        brackets.shift();
        if (fixupDepth === MAX_BRACKETS) fixupDepth--;
      }
      if (next.length === 1 && next[0] === COMMON && isEastAsianWideFullHalf(c.cp)) next = HAN_SCRIPT_EXTENSIONS();
      brackets.push({ ch: c.cp, script: COMMON });
      fixupDepth++;
    } else if (b?.open === false && brackets.length > 0) {
      for (let k = brackets.length - 1; k >= 0; k--) {
        const rec = brackets[k] as BracketRec;
        if (rec.ch !== b.pair) continue;
        let script = rec.script;
        if (script === HAN || script === HIRAGANA || script === BOPOMOFO) {
          const han = currentSet.find((s) => s === HAN || s === HIRAGANA || s === BOPOMOFO);
          if (han !== undefined) script = han;
        }
        if (script !== COMMON) next = [script];
        // Blink pops the entries above the match and keeps the match itself.
        const popped = brackets.length - 1 - k;
        brackets.splice(k + 1);
        fixupDepth = Math.max(0, fixupDepth - popped);
        break;
      }
    }
    if ((next[0] as number) === INHERITED && next.length > 1) throw new Error('gate: inherited-with-extensions characters are outside the gate');
    if (!mergeSets(next)) {
      const script = resolve();
      out.push({ start: runStart, end: c.pos, script });
      fixupStack(script, b?.open === true);
      currentSet = [...next];
      runStart = c.pos;
    }
  }
  out.push({ start: runStart, end: text.length, script: resolve() });
  return out;
}

/** RunSegmenter ranges for horizontal text (orientation keep, text fallback priority only). */
export function segmentText(text: string): Array<{ start: number; end: number; script: string }> {
  if (/\p{Extended_Pictographic}/u.test(text.replace(/[#*0-9©®‼⁉™ℹ↔-↙]/g, ''))) {
    throw new Error('gate: emoji segmentation is outside the gate');
  }
  // InlineNode::SegmentScriptRuns: 8-bit text is one Latin segment without running the segmenter.
  if (!/[^\u0000-ÿ]/.test(text)) return [{ start: 0, end: text.length, script: 'Latn' }];
  return scriptRuns(text).map((r) => ({ start: r.start, end: r.end, script: scriptName(r.script) }));
}
