import { refuse } from './reader.ts';
import type { Reader } from './reader.ts';

/** A CFF INDEX as OTS keeps it: its entry count and the count + 1 offsets, measured from the start of the CFF table. */
export type CffIndex = { readonly count: number; readonly offsets: readonly number[] };

export const EMPTY_INDEX: CffIndex = { count: 0, offsets: [] };

/** OTS bounds a charstring's run by its nesting limit but not its time; past this many tokens Dragon refuses rather than hang. */
export const WORK_LIMIT = 1 << 27;

export type Budget = { spent: number };

export const spend = (budget: Budget, n: number): void => {
  budget.spent += n;
  if (budget.spent > WORK_LIMIT) refuse('CFF takes too long to check');
};

const MAX_STACK = 48;
const MAX_STEMS = 96;
const MAX_NESTING = 10;
const MAX_LENGTH = 65535;
// OTS stands this in for every computed value and the 16.16 numbers it does not read, so a subroutine call on one refuses.
const DUMMY = 0x7fffffff;

const ESC = 12 << 8;
const CALLSUBR = 10;
const RETURN = 11;
const ENDCHAR = 14;
const CALLGSUBR = 29;

type Context = { width: boolean; stems: number; endchar: boolean };

type Run = { readonly table: Reader; readonly global: CffIndex; readonly local: CffIndex; readonly budget: Budget };

/** OTS's ValidateCFFCharStrings for one glyph: run its charstring and require an endchar. */
export function checkCharString(run: Run, at: number, length: number): void {
  if (length > MAX_LENGTH) refuse('a CFF charstring is longer than 65535 bytes');
  const c: Context = { width: false, stems: 0, endchar: false };
  execute(run, run.table.sub(at, length), 0, [], c);
  if (!c.endchar) refuse('a CFF charstring ends without endchar');
}

function execute(run: Run, cs: Reader, depth: number, stack: number[], c: Context): void {
  if (depth > MAX_NESTING) refuse('CFF subroutines nest more than 10 deep');
  c.endchar = false;
  while (cs.offset < cs.length) {
    spend(run.budget, 1);
    const v = cs.u8();
    let op: number;
    if (v === 12) op = ESC + cs.u8();
    else if (v <= 27 || (v >= 29 && v <= 31)) op = v;
    else {
      if (v === 28) stack.push(cs.u16());
      else if (v <= 246) stack.push(v - 139);
      else if (v <= 250) stack.push((v - 247) * 256 + cs.u8() + 108);
      else if (v <= 254) stack.push(-(v - 251) * 256 - cs.u8() - 108);
      else {
        cs.skip(4);
        stack.push(DUMMY);
      }
      if (stack.length > MAX_STACK) refuse('a CFF charstring stacks more than 48 arguments');
      continue;
    }
    operator(run, op, cs, depth, stack, c);
    if (c.endchar || op === RETURN) return;
  }
  refuse('a CFF charstring or subroutine ends without endchar or return');
}

function stems(c: Context, n: number): void {
  c.stems += n;
  if (c.stems > MAX_STEMS) refuse('a CFF glyph declares more than 96 stem hints');
}

function operator(run: Run, op: number, cs: Reader, depth: number, stack: number[], c: Context): void {
  const size = stack.length;
  const path = (ok: boolean): void => {
    if (!c.width) refuse('a CFF glyph draws before its first stack-clearing operator');
    if (!ok) refuse(`CFF operator ${op} has the wrong number of arguments`);
    stack.length = 0;
  };
  const clearing = (ok: boolean): void => {
    stack.length = 0;
    c.width = true;
    if (!ok) refuse(`CFF operator ${op} has the wrong number of arguments`);
  };
  const need = (n: number, push: number): void => {
    if (size < n) refuse(`CFF operator ${op} has too few arguments`);
    stack.length -= n;
    for (let i = 0; i < push; i++) stack.push(DUMMY);
  };
  switch (op) {
    case CALLSUBR:
    case CALLGSUBR: {
      const subrs = op === CALLSUBR ? run.local : run.global;
      if (size < 1) refuse('a CFF subroutine call has no subroutine number');
      let n = stack.pop() as number;
      if (n === DUMMY) refuse('a CFF subroutine call uses a computed number');
      n += subrs.count < 1240 ? 107 : subrs.count < 33900 ? 1131 : 32768;
      if (n < 0 || n >= 65536 || subrs.offsets.length <= n + 1) refuse('a CFF subroutine call names no subroutine');
      const at = subrs.offsets[n] as number;
      const length = (subrs.offsets[n + 1] as number) - at;
      if (length > MAX_LENGTH) refuse('a CFF subroutine is longer than 65535 bytes');
      return execute(run, run.table.sub(at, length), depth + 1, stack, c);
    }
    case RETURN:
      return;
    case ENDCHAR:
      c.endchar = true;
      c.width = true;
      return;
    case 1:
    case 3:
    case 18:
    case 23: {
      if (size < 2) refuse('a CFF stem hint has too few arguments');
      const ok = size % 2 === 0 || !c.width;
      stems(c, Math.floor(size / 2));
      return clearing(ok);
    }
    case 21:
      return clearing(size === 2 || (!c.width && size === 3));
    case 4:
    case 22:
      return clearing(size === 1 || (!c.width && size === 2));
    case 19:
    case 20: {
      const ok = size === 0 || (!c.width && size === 1) || !c.width || size % 2 === 0;
      if (!ok) refuse('a CFF hintmask has an odd number of arguments');
      if (size !== 0 && !(!c.width && size === 1)) stems(c, Math.floor(size / 2));
      if (c.stems === 0) refuse('a CFF hintmask comes before any stem hint');
      cs.skip((c.stems + 7) >> 3);
      stack.length = 0;
      c.width = true;
      return;
    }
    case 5:
      return path(size >= 2 && size % 2 === 0);
    case 6:
    case 7:
      return path(size >= 1);
    case 8:
      return path(size >= 6 && size % 6 === 0);
    case 24:
      return path(size >= 8 && (size - 2) % 6 === 0);
    case 25:
      return path(size >= 8 && size % 2 === 0);
    case 26:
    case 27:
      return path(size >= 4 && (size % 4 === 0 || size % 4 === 1));
    case 30:
    case 31:
      return path(size >= 4 && [0, 1, 4, 5].includes(size % 8));
    case ESC + 34:
      return path(size === 7);
    case ESC + 35:
      return path(size === 13);
    case ESC + 36:
      return path(size === 9);
    case ESC + 37:
      return path(size === 11);
    case ESC + 0:
      if (size !== 0) refuse('a CFF dotsection has arguments');
      return;
    case ESC + 3:
    case ESC + 4:
    case ESC + 15:
    case ESC + 10:
    case ESC + 11:
    case ESC + 12:
    case ESC + 24:
      return need(2, 1);
    case ESC + 5:
    case ESC + 9:
    case ESC + 14:
    case ESC + 26:
      return need(1, 1);
    case ESC + 18:
      return need(1, 0);
    case ESC + 22:
      return need(4, 1);
    case ESC + 27:
      need(1, 2);
      if (stack.length > MAX_STACK) refuse('a CFF charstring stacks more than 48 arguments');
      return;
    case ESC + 28:
      return need(2, 2);
  }
  refuse(`a CFF charstring uses operator ${op >= ESC ? `12 ${op - ESC}` : op}, which OTS does not allow`);
}
