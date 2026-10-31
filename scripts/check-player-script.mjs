// The player script is JavaScript generated inside a TS template literal, so tsc can't see
// syntax errors in it (a single lost backslash in a regex breaks the whole script silently).
// Parse it the way react-native-webview will run it.
const { playerScript, accountScript, flushScript, pauseScript, revealScript, tvCommandScript, loginFillScript } = await import('../src/lib/inject.ts');

const script = playerScript({ id: 'episode', t: 42, preload: true });
const tv = playerScript({ id: 'episode', t: 0, preload: false, tv: true });
// Credentials with quotes, backslashes and line separators must stay one string literal.
const login = loginFillScript('a"b\'c@d.e', 'p\\a"s\'s\u2028w\u2029o`r${d}</script>');
for (const [name, source] of [
  ['playerScript', script],
  ['playerScript (as wrapped by the WebView)', `(function() {\n${script};\n})();`],
  ['playerScript (tv)', tv],
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
// Function declarations hoist, so a second `function tick()` in the same script silently
// replaces the first. Keep every declared name unique.
for (const [name, source] of [['playerScript', tv], ['accountScript', accountScript], ['loginFillScript', login]]) {
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
