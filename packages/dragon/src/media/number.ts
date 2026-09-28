// Number text in media query serialisation. The default is exact (the shortest decimal that round-trips) so a band condition
// keeps the authored threshold; Chrome's mediaText uses six significant digits, which a caller passes as the format.

export type NumberFormat = (x: number) => string;

export const exactNumber: NumberFormat = (x) => (x === 0 ? '0' : String(x));
