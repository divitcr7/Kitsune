// Checks the pure parts of Kitsune's miruro.cx playback (lib/miruro, lib/subtitles) in Node:
// decoding a real API response, the stream proxy's URL scheme, show matching, stream ordering and
// subtitle parsing. Fixtures were captured from www.miruro.cx in a browser.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'kitsune-check-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  ['codec', 'score', 'streams'].map((m) => `export * from ${JSON.stringify(join(root, 'src/lib/miruro', m))};`).join('\n') +
    `\nexport * from ${JSON.stringify(join(root, 'src/lib/subtitles'))};\n`,
);
const out = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', nodePaths: [join(root, 'node_modules')] });
const m = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
function check(name, fn) {
  try {
    fn();
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`);
  }
}

check('decodes a real catalog response (XOR "miruro/catalog", then gzip)', () => {
  const b64 = readFileSync(join(root, 'scripts/fixtures/miruro-anilist-lookup.b64'), 'utf8');
  const body = m.decodeBody(m.fromBase64(b64), 'application/octet-stream');
  assert.equal(body.data[0].id, '60_lpgB8jXsPJPLmO-P-0gZF1-Wtpv-z');
  assert.deepEqual(body.data[0].external_ids.anilist, ['178025']);
});

check('decodes plain JSON and text', () => {
  const enc = new TextEncoder();
  assert.deepEqual(m.decodeBody(enc.encode('{"a":1}'), 'application/problem+json; charset=utf-8'), { a: 1 });
  assert.equal(m.decodeBody(enc.encode('window.env={}'), 'application/javascript'), 'window.env={}');
});

check('base64 round trip, standard and URL-safe', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const url = m.toBase64Url(bytes);
  assert.ok(!/[+/=]/.test(url));
  assert.deepEqual([...m.fromBase64(url)], [...bytes]);
  assert.deepEqual([...m.fromBase64(Buffer.from(bytes).toString('base64'))], [...bytes]);
});

check('builds the stream proxy URL exactly as miruro.cx does', () => {
  const got = m.proxyUrl(
    'https://s1.keeply.top/',
    'a54d389c18527d9fd3e7f0643e27edbe',
    'https://hls.krussdomi.com/manifest/686c510d169c31976b6e47c6/master.m3u8',
    { Referer: 'https://krussdomi.com/' },
    '/pl.m3u8',
  );
  assert.equal(
    got,
    'https://s1.keeply.top/zTlM7GtoUrC7i4NKVVWYzdYpV_FxfB7wvsidBVBOi9vWOReqIGQequLXlFUIHo6NlHQPqnpkGKvkhMZLU0aeysA_FvErJ0U~3m9q-X43D_qhxcpGVlOZztZ3F7NzIAjsoIOfCVcJjtHIYhrh/pl.m3u8',
  );
});

const gachiakuta = { id: 178025, title: { romaji: 'Gachiakuta', english: 'Gachiakuta', native: 'ガチアクタ' }, synonyms: [], format: 'TV', startDate: { year: 2025 }, episodes: 24 };
const sequel = { id: 999, title: { romaji: 'Gachiakuta Season 2', english: null, native: null }, synonyms: [], format: 'TV', startDate: { year: 2026 }, episodes: null };

check('matches a show to the right AniList entry', () => {
  const show = { name: 'Gachiakuta', type: 'TV', release_date: '2025-07-06', episode_count: 24 };
  assert.equal(m.pick(show, [sequel, gachiakuta], 'Gachiakuta')?.id, 178025);
});

check('keeps seasons apart', () => {
  const show = { name: 'Gachiakuta Season 2', type: 'TV', release_date: '2026-01-10' };
  assert.equal(m.pick(show, [gachiakuta, sequel], 'Gachiakuta Season 2')?.id, 999);
});

check('refuses a weak match', () => {
  const show = { name: 'Something Else Entirely', type: 'TV', release_date: '2019-01-01' };
  assert.equal(m.pick(show, [gachiakuta, sequel], show.name), undefined);
});

const play = {
  episode_number: 1,
  tracks: [
    {
      track: 'ssub',
      providers: [
        { provider: 'kickassanime', subtitles: [{ language: 'en', label: 'English', file: 'https://x/en.vtt', format: 'vtt', default: true }], servers: [{ server: 'Vid', headers: { Referer: 'https://k/' }, streams: [{ url: 'https://k/master.m3u8', format: 'hls' }] }] },
        { provider: 'icarus', subtitles: [], servers: [{ server: 'icarus-3-1', headers: { Origin: 'https://u', Referer: 'https://u/' }, streams: [{ url: 'https://i/m/abc', format: 'hls' }] }] },
      ],
    },
    { track: 'dub', providers: [{ provider: 'icarus', servers: [{ server: 'icarus-1-1', headers: {}, streams: [{ url: 'https://i/m/dub', format: 'hls' }] }] }] },
  ],
};
const config = {
  providerOrder: ['icarus', 'anikoto', 'kickassanime'],
  streaming: { icarus: { visible: true, variantOrder: ['ssub', 'sub', 'dub'], proxy: false }, kickassanime: { visible: true, variantOrder: [], proxy: { rotate: false, segments: true } } },
};
const env = { a: 'https://s1.keeply.top/', b: 'https://s2.keeply.top/', key: 'a54d389c18527d9fd3e7f0643e27edbe' };

check('orders streams the way miruro.cx does, proxy first where the site proxies', () => {
  const list = m.candidates(play, config, env, 'sub');
  assert.deepEqual(
    list.map((c) => `${c.provider}:${c.via}`),
    ['icarus:direct', 'kickassanime:proxy', 'kickassanime:direct'],
  );
  assert.deepEqual(list[0].headers, { Origin: 'https://u', Referer: 'https://u/' });
  assert.equal(list[1].headers, undefined);
  assert.ok(list[1].uri.startsWith('https://s1.keeply.top/') && list[1].uri.endsWith('/pl.m3u8'));
  assert.equal(list[1].subtitles.length, 1);
});

check('dub, and the last good server first', () => {
  assert.deepEqual(m.candidates(play, config, env, 'dub').map((c) => c.server), ['icarus-1-1']);
  const pref = m.candidates(play, config, env, 'sub', { provider: 'kickassanime', server: 'Vid' });
  assert.equal(pref[0].provider, 'kickassanime');
  assert.equal(m.hasAudio(play, 'dub'), true);
});

check('parses WebVTT', () => {
  const cues = m.parseCues('WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000 line:90%\n<i>Hello</i> &amp; welcome\n\n00:01:02.000 --> 00:01:04.250\nSecond\nline\n');
  assert.deepEqual(cues, [
    { start: 1.5, end: 3, text: 'Hello & welcome' },
    { start: 62, end: 64.25, text: 'Second\nline' },
  ]);
  assert.equal(m.cueAt(cues, 2), 'Hello & welcome');
  assert.equal(m.cueAt(cues, 10), '');
  assert.equal(m.cueAt(cues, 63), 'Second\nline');
});

check('parses SRT', () => {
  const cues = m.parseCues('﻿1\r\n00:00:05,000 --> 00:00:07,100\r\n{\\an8}Top text\r\n\r\n2\r\n01:00:00,000 --> 01:00:01,000\r\nLate\r\n');
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [
    [5, 7.1, 'Top text'],
    [3600, 3601, 'Late'],
  ]);
});

if (failed) {
  console.error(`${failed} miruro check${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('miruro playback checks pass');
