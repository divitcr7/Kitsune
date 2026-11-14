// The page scripts are JavaScript generated inside TS template literals, so tsc can't see syntax
// errors in them (a single lost backslash in a regex breaks the whole script silently). Parse
// them the way react-native-webview will run them.
const { bridgeScript, apiCallScript } = await import('../src/lib/inject.ts');

for (const [name, source] of [
  ['bridgeScript', bridgeScript],
  ['bridgeScript (as wrapped by the WebView)', `(function() {\n${bridgeScript};\n})();`],
  ['apiCallScript', apiCallScript('r1', '/api/v1/anime/a"b/episodes?limit=10000')],
]) {
  try {
    new Function(source);
  } catch (e) {
    console.error(`${name} does not parse: ${e.message}`);
    process.exit(1);
  }
}
// The bridge goes through the gate, which keeps Kitsune off Cloudflare's check page.
if (!bridgeScript.includes("type: 'gate'") || !bridgeScript.includes('gate(function () {')) {
  console.error('bridgeScript does not go through the gate');
  process.exit(1);
}
// Function declarations hoist, so a second `function tick()` in the same script silently
// replaces the first. Keep every declared name unique.
const seen = new Set();
for (const [, fn] of bridgeScript.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
  if (seen.has(fn)) {
    console.error(`bridgeScript declares function ${fn}() twice`);
    process.exit(1);
  }
  seen.add(fn);
}
// The bridge script also runs on old TV-box WebViews: keep it to ES5 syntax.
if (/=>|\blet\s|\bconst\s|`/.test(bridgeScript)) {
  console.error('bridgeScript uses syntax newer than ES5');
  process.exit(1);
}
console.log('page scripts parse');
