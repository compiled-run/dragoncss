// The one naming rule for nodes that Dragon's layout, Chrome's capture and the Markless export pair on: Dragon's own addresses.
// An address is a tree node id (which has no ":", isTreeNodeId) followed by a suffix naming a node inside or beside it.
import { markerTextId } from '@dragon/layout';

export { isWhitespaceText, textAddresser } from 'dragon';

/** A ::before, ::after or ::marker box, or a form control's user-agent part: "<host>::<type>". */
export const pseudoId = (host: string, type: string): string => `${host}::${type}`;

/** The one text of a generated box: "<box>:text0". */
export const generatedTextId = (box: string): string => markerTextId(box);

/** One line fragment of an inline box or a text: "<node>:line<j>". */
export const lineId = (node: string, j: number): string => `${node}:line${j}`;

/** The address with its tree node id swapped for element(id), or unchanged where element gives none. */
export function rehostAddress(address: string, element: (treeId: string) => string | undefined): string {
  const end = address.indexOf(':');
  const tree = end < 0 ? address : address.slice(0, end);
  const host = element(tree);
  return host === undefined ? address : `${host}${end < 0 ? '' : address.slice(end)}`;
}
