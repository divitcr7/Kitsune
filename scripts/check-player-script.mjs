// The player script is JavaScript generated inside a TS template literal, so tsc can't see
// syntax errors in it (a single lost backslash in a regex breaks the whole script silently).
// Parse it the way react-native-webview will run it.
const { playerScript, accountScript, flushScript, pauseScript, revealScript, tvCommandScript, loginFillScript } = await import('../src/lib/inject.ts');

const script = playerScript({ id: 'episode', t: 42, preload: true });
const tv = playerScript({ id: 'episode', t: 0, preload: false, tv: true });
// A test build's retry without the ad guard (GUARD_OFF in place of GUARD).
const bare = playerScript({ id: 'episode', t: 0, preload: false, bare: true });
// Credentials with quotes, backslashes and line separators must stay one string literal.
const login = loginFillScript('a"b\'c@d.e', 'p\\a"s\'s\u2028w\u2029o`r${d}</script>');
for (const [name, source] of [
  ['playerScript', script],
  ['playerScript (as wrapped by the WebView)', `(function() {\n${script};\n})();`],
  ['playerScript (tv)', tv],
  ['playerScript (bare)', bare],
  ['accountScript', accountScript],
  ['accountScript (as wrapped by the WebView)', `(function() {\n${accountScript};\n})();`],
  ['flushScript', flushScript],
  ['pauseScript', pauseScript],
  ['revealScript', revealScript(42)],
  ['tvCommandScript', tvCommandScript('seek', -10)],
  ['loginFillScript', login],
]) {
  try {
    new Function(source);
  } catch (e) {
    console.error(`${name} does not parse: ${e.message}`);
    process.exit(1);
  }
}
if (!login.includes(JSON.stringify('a"b\'c@d.e'))) {
  console.error('loginFillScript does not embed the email as a JSON string');
  process.exit(1);
}
// Node accepts raw U+2028/2029 in string literals; TV browsers before Chromium 66 don't.
if (/[\u2028\u2029]/.test(login)) {
  console.error('loginFillScript leaks a raw line separator into the script');
  process.exit(1);
}
// Every page script goes through the gate, which keeps Kitsune off Cloudflare's check page.
for (const [name, source] of [['playerScript', script], ['playerScript (tv)', tv], ['playerScript (bare)', bare], ['accountScript', accountScript]]) {
  if (!source.includes("type: 'gate'") || !source.includes('gate(function () {')) {
    console.error(`${name} does not go through the gate`);
    process.exit(1);
  }
}
// Bare means the site's page untouched: none of the guard's patches may be in it. (Its fetch and
// XHR wrappers are skipped at run time, by START.bare.)
if (/Object\.defineProperty|(Element|Node)\.prototype\.\w+\s*=|document\.write\s*=|window\.(alert|confirm|prompt)\s*=/.test(bare)) {
  console.error('playerScript (bare) patches the page');
  process.exit(1);
}
// Function declarations hoist, so a second `function tick()` in the same script silently
// replaces the first. Keep every declared name unique.
for (const [name, source] of [['playerScript', tv], ['playerScript (bare)', bare], ['accountScript', accountScript], ['loginFillScript', login]]) {
  const seen = new Set();
  for (const [, fn] of source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (seen.has(fn)) {
      console.error(`${name} declares function ${fn}() twice`);
      process.exit(1);
    }
    seen.add(fn);
  }
}
console.log('player scripts parse');
