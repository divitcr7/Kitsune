import { gunzipSync, strFromU8, strToU8 } from 'fflate';

/**
 * miruro.cx's wire formats, kept free of React Native so `scripts/check-miruro.mjs` can test them
 * in Node. Nothing here talks to the network.
 */

// The catalog API answers with `application/octet-stream`: the gzipped JSON, XORed with this key.
const CATALOG_KEY = strToU8('miruro/catalog');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i;
B64_INDEX['-'] = 62;
B64_INDEX._ = 63;

/** Standard or URL-safe base64, padded or not. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_INDEX[clean[i]];
    if (v === undefined) throw new Error('Not base64');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** URL-safe base64 without padding (what miruro's stream proxy expects). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

export function xor(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
  return out;
}

export function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** An API response body: encoded catalog data, plain JSON, or text. */
export function decodeBody(bytes: Uint8Array, contentType: string): unknown {
  const type = contentType.split(';', 1)[0].trim().toLowerCase();
  if (type === 'application/octet-stream') return JSON.parse(strFromU8(gunzipSync(xor(bytes, CATALOG_KEY))));
  const text = strFromU8(bytes);
  if (type.includes('json')) return text ? JSON.parse(text) : null;
  return text;
}

/** Used by the Node check to build test fixtures the way the server does. */
export function encodeCatalog(gzipped: Uint8Array): Uint8Array {
  return xor(gzipped, CATALOG_KEY);
}

export type ProxyEnv = { a: string; b: string; key: string };

/**
 * A URL on miruro's own stream proxy, which fetches `url` with `headers` and rewrites the playlist
 * so every line points back at the proxy. The player then needs no headers of its own.
 */
export function proxyUrl(base: string, keyHex: string, url: string, headers: Record<string, string> | null, tail: '/pl.m3u8' | '/sub.vtt') {
  const key = hexBytes(keyHex);
  const enc = (s: string) => toBase64Url(xor(strToU8(s), key));
  const root = base.endsWith('/') ? base : `${base}/`;
  const h = headers && Object.keys(headers).length ? `~${enc(JSON.stringify(headers))}` : '';
  return `${root}${enc(url)}${h}${tail}`;
}
