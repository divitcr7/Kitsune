/*
 * Only what Chromium 47 (2017 Samsung TVs) lacks and this bundle actually uses. Syntax is lowered at
 * build time; these are the runtime APIs.
 */
type Loose = Record<string, unknown>;

if (!String.prototype.padStart) {
  // eslint-disable-next-line no-extend-native -- polyfill for Chromium 47
  String.prototype.padStart = function (this: string, length: number, fill = ' ') {
    let s = String(this);
    while (s.length < length) s = fill + s;
    return s.slice(s.length - Math.max(length, String(this).length));
  };
}

const O = Object as unknown as Loose;
if (!O.entries) O.entries = (o: Loose) => Object.keys(o).map((k) => [k, o[k]]);
if (!O.values) O.values = (o: Loose) => Object.keys(o).map((k) => o[k]);

const NL = NodeList.prototype as unknown as Loose;
if (!NL.forEach) NL.forEach = Array.prototype.forEach;

const P = Promise.prototype as unknown as Loose;
if (!P.finally) {
  P.finally = function (this: Promise<unknown>, fn: () => void) {
    return this.then(
      (v) => {
        fn();
        return v;
      },
      (e) => {
        fn();
        throw e;
      },
    );
  };
}

export {};
