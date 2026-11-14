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
    `\nexport * from ${JSON.stringify(join(root, 'src/lib/subtitles'))};\nexport * from ${JSON.stringify(join(root, 'src/lib/hls'))};\n`,
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

check('builds the stream proxy URL exactly as miruro.cx does (Referer value only)', () => {
  const got = m.proxyUrl(
    'https://s1.keeply.top/',
    'a54d389c18527d9fd3e7f0643e27edbe',
    'https://hls.krussdomi.com/manifest/686c510d169c31976b6e47c6/master.m3u8',
    'https://krussdomi.com/',
    '/pl.m3u8',
  );
  assert.equal(
    got,
    'https://s1.keeply.top/zTlM7GtoUrC7i4NKVVWYzdYpV_FxfB7wvsidBVBOi9vWOReqIGQequLXlFUIHo6NlHQPqnpkGKvkhMZLU0aeysA_FvErJ0U~zTlM7GtoUrC4lYUXTUOC08xjW_N1fQ/pl.m3u8',
  );
  assert.ok(!m.proxyUrl('https://s1.keeply.top', 'a54d389c18527d9fd3e7f0643e27edbe', 'https://x/y.vtt', null, '/sub.vtt').includes('~'));
  assert.equal(m.refererOf({ referer: 'https://a/' }), 'https://a/');
  assert.equal(m.refererOf({ Origin: 'https://u', Referer: 'https://u/' }), 'https://u/');
  assert.equal(m.refererOf(undefined), null);
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
    ['icarus:direct', 'icarus:proxy', 'kickassanime:proxy', 'kickassanime:direct'],
  );
  assert.deepEqual(list[0].headers, { Origin: 'https://u', Referer: 'https://u/' });
  assert.equal(list[1].headers, undefined);
  assert.equal(list[2].uri, m.proxyUrl(env.a, env.key, 'https://k/master.m3u8', 'https://k/', '/pl.m3u8'));
  assert.equal(list[2].subtitles.length, 1);
  assert.equal(list[0].proxied, false);
  assert.equal(list[2].proxied, true);
});

check('fetches subtitles the way the site does', () => {
  const sub = { language: 'en', label: 'English', file: 'https://x/en.vtt', format: 'vtt' };
  const [k] = m.candidates(play, config, env, 'sub').filter((c) => c.provider === 'kickassanime');
  const [i] = m.candidates(play, config, env, 'sub').filter((c) => c.provider === 'icarus');
  const viaK = m.subtitleSources(sub, k, env);
  assert.ok(viaK[0].uri.endsWith('/sub.vtt') && !viaK[0].headers);
  assert.equal(viaK[1].uri, 'https://x/en.vtt');
  const viaI = m.subtitleSources(sub, i, env);
  assert.equal(viaI[0].uri, 'https://x/en.vtt');
  assert.deepEqual(viaI[0].headers, { Origin: 'https://u', Referer: 'https://u/' });
  assert.ok(viaI[1].uri.endsWith('/sub.vtt'));
  const subs = [
    { language: 'en', label: 'English (Forced)', file: 'https://x/f', format: 'vtt' },
    { language: 'de', label: 'Deutsch', file: 'https://x/de', format: 'vtt', default: true },
    { language: 'en', label: 'English', file: 'https://x/en', format: 'vtt' },
  ];
  assert.equal(m.defaultSubtitle(subs).label, 'Deutsch');
  assert.equal(m.defaultSubtitle(subs, 'en').label, 'English');
  assert.equal(m.usableSubtitles(subs).length, 2);
});

check('dub, and the last good server first', () => {
  assert.deepEqual(m.candidates(play, config, env, 'dub').map((c) => `${c.server}:${c.via}`), ['icarus-1-1:direct', 'icarus-1-1:proxy']);
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

check('detects subtitle formats by content', () => {
  assert.equal(m.sniffFormat('\uFEFFWEBVTT\n\n'), 'vtt');
  assert.equal(m.sniffFormat('[Script Info]\nTitle: x'), 'ass');
  assert.equal(m.sniffFormat('1\n00:00:01,000 --> 00:00:02,000\nHi'), 'srt');
});

check('parses a real icarus ASS file', () => {
  const cues = m.parseCues(readFileSync(join(root, 'scripts/fixtures/icarus-sample.ass'), 'utf8'));
  assert.equal(cues.length, 25);
  assert.deepEqual(cues[0], { start: 13.98, end: 17.93, text: 'Rare for you to contact me, Enjin.' });
  assert.equal(m.cueAt(cues, 15), 'Rare for you to contact me, Enjin.');
});

check('parses ASS details', () => {
  const src = [
    '[Script Info]',
    'Title: test',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, Alignment',
    'Style: Default,Arial,20,2',
    'Style: Top,Arial,20,8',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Comment: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,not shown',
    'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Well, {\\i1}hello{\\i0}\\Nthere\\hfriend',
    'Dialogue: 1,0:00:01.00,0:00:03.50,Default,,0,0,0,,Well, {\\i1}hello{\\i0}\\Nthere\\hfriend',
    'Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100',
    'Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,{\\pos(320,40)}A sign',
    'Dialogue: 0,0:00:02.00,0:00:04.00,Top,,0,0,0,,Up here',
    'Dialogue: 0,1:02:03.4,1:02:05.00,Default,,0,0,0,,{\\an8}Moved up',
  ].join('\r\n');
  const cues = m.parseCues(src);
  assert.deepEqual(cues, [
    { start: 1, end: 3.5, text: 'Well, hello\nthere friend' },
    { start: 2, end: 4, text: 'Up here', top: true },
    { start: 3723.4, end: 3725, text: 'Moved up', top: true },
  ]);
  assert.deepEqual(m.cuesAt(cues, 2.5), { bottom: 'Well, hello\nthere friend', top: 'Up here' });
  // A reordered Format line still works.
  const re = m.parseCues('[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.00,a, b');
  assert.deepEqual(re, [{ start: 1, end: 2, text: 'a, b' }]);
});

const master = [
  '#EXTM3U',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,AUTOSELECT=YES,URI="audio/ja.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English, US",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="/abs/en.m3u8?t=1"',
  '#EXT-X-STREAM-INF:BANDWIDTH=13866486,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"',
  'v/1080.m3u8?token=a',
  '#EXT-X-STREAM-INF:BANDWIDTH=3897415,RESOLUTION=854x480,AUDIO="audio"',
  'https://cdn.example/v/480.m3u8',
].join('\n');
const masterBase = 'https://host.example/path/to/master.m3u8?token=z';

check('resolves playlist links like a browser', () => {
  assert.equal(m.resolveUri(masterBase, 'a.ts'), 'https://host.example/path/to/a.ts');
  assert.equal(m.resolveUri(masterBase, '../b.ts?x=1'), 'https://host.example/path/b.ts?x=1');
  assert.equal(m.resolveUri(masterBase, '/c.ts'), 'https://host.example/c.ts');
  assert.equal(m.resolveUri(masterBase, '//other.example/d.ts'), 'https://other.example/d.ts');
  assert.equal(m.resolveUri(masterBase, 'https://x.example/e.ts'), 'https://x.example/e.ts');
});

check('reads a master playlist and picks qualities', () => {
  const p = m.parseMaster(master, masterBase);
  assert.equal(p.variants.length, 2);
  assert.equal(p.media.length, 2);
  assert.equal(p.media[1].name, 'English, US');
  assert.equal(p.media[0].uri, 'https://host.example/path/to/audio/ja.m3u8');
  assert.equal(p.variants[0].uri, 'https://host.example/path/to/v/1080.m3u8?token=a');
  assert.equal(p.variants[0].height, 1080);
  assert.equal(p.variants[0].codecs, 'avc1.640028,mp4a.40.2');
  assert.deepEqual(m.heights(p.variants), [1080, 480]);
  assert.equal(m.pickVariant(p.variants, 'best').height, 1080);
  assert.equal(m.pickVariant(p.variants, 720).height, 480);
  assert.equal(m.pickVariant(p.variants, 360).height, 480);
  assert.equal(m.parseMaster('#EXTM3U\n#EXTINF:4,\na.ts', masterBase), null);
  const pinned = m.pinnedMaster(master, masterBase, p.variants[1]);
  assert.equal((pinned.match(/#EXT-X-STREAM-INF/g) || []).length, 1);
  assert.equal((pinned.match(/#EXT-X-MEDIA/g) || []).length, 2);
  assert.ok(pinned.includes('URI="https://host.example/abs/en.m3u8?t=1"'));
  assert.ok(pinned.trimEnd().endsWith('https://cdn.example/v/480.m3u8'));
  assert.equal(m.parseMaster(pinned, 'file:///x/m.m3u8').variants[0].uri, 'https://cdn.example/v/480.m3u8');
});

check('reads and rewrites media playlists for downloads', () => {
  const media = m.parseMedia('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:5.005,\nseg0.jpg\n#EXTINF:4.2,\nhttps://s/seg1\n#EXT-X-ENDLIST', 'https://h/p/index.m3u8');
  assert.deepEqual(media.segments, [
    { uri: 'https://h/p/seg0.jpg', duration: 5.005 },
    { uri: 'https://s/seg1', duration: 4.2 },
  ]);
  assert.equal(media.ended, true);
  assert.equal(media.encrypted, false);
  assert.equal(m.parseMedia('#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:1,\na', 'https://h/').encrypted, true);
  assert.equal(m.parseMedia('#EXT-X-KEY:METHOD=NONE\n#EXTINF:1,\na', 'https://h/').encrypted, false);
  const local = m.localMedia(media, (i) => `v/${String(i).padStart(5, '0')}.ts`);
  assert.ok(local.includes('#EXT-X-TARGETDURATION:6') && local.includes('v/00001.ts') && local.trimEnd().endsWith('#EXT-X-ENDLIST'));
  const back = m.parseMedia(local, 'file:///d/video.m3u8');
  assert.equal(back.segments[1].uri, 'file:///d/v/00001.ts');
  const p = m.parseMaster(master, masterBase);
  const lm = m.localMaster(p.variants[0], [{ media: p.media[1], file: 'a0.m3u8' }], 'video.m3u8');
  assert.ok(lm.includes('URI="a0.m3u8"') && lm.includes('DEFAULT=YES') && lm.trimEnd().endsWith('video.m3u8'));
  const noAudio = m.localMaster(p.variants[0], [], 'video.m3u8');
  assert.ok(!noAudio.includes('AUDIO=') && noAudio.includes('RESOLUTION=1920x1080'));
  assert.equal(m.parseMaster(lm, 'file:///d/master.m3u8').variants[0].uri, 'file:///d/video.m3u8');
});

if (failed) {
  console.error(`${failed} miruro check${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('miruro playback checks pass');
