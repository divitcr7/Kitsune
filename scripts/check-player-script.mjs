// The player script is JavaScript generated inside a TS template literal, so tsc can't see
// syntax errors in it (a single lost backslash in a regex breaks the whole script silently).
// Parse it the way react-native-webview will run it.
const { playerScript, flushScript } = await import('../src/lib/inject.ts');

const script = playerScript({ id: 'episode', t: 42, preload: true });
for (const [name, source] of [
  ['playerScript', script],
  ['playerScript (as wrapped by the WebView)', `(function() {\n${script};\n})();`],
  ['flushScript', flushScript],
]) {
  try {
    new Function(source);
  } catch (e) {
    console.error(`${name} does not parse: ${e.message}`);
    process.exit(1);
  }
}
console.log('player scripts parse');
