// Apart from native-dump.ts, so the Chrome-side break checks (line-breaks.ts) never load the dump schema.
import type { DumpLine } from './native-dump.ts';

/**
 * A text node's dump lines grouped by break line, as index lists. A line joins the group before it when it has the same top and
 * either the same offsets (TXT2-f: a truncated piece's whole run, then its painted part) or starts where it ends (TXT2-c: preserved
 * text's pieces on one line, its text, hanging spaces and line feed); engineTextLines and Chrome's breaks count the group once.
 */
export function breakLineGroups(lines: readonly DumpLine[]): number[][] {
  const groups: number[][] = [];
  lines.forEach((l, j) => {
    const prev = lines[j - 1];
    const group = groups[groups.length - 1];
    const joins = prev !== undefined && group !== undefined && prev.deviceEdges.top === l.deviceEdges.top && prev.start !== null && prev.end !== null && l.start !== null && l.end !== null && ((l.start === prev.start && l.end === prev.end) || l.start === prev.end);
    if (joins) group.push(j);
    else groups.push([j]);
  });
  return groups;
}
