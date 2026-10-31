// Builds the TizenBrew module into tv/tizen/dist/kitsune.js.
//
// Samsung TVs run anything from Chromium 47 (2017) to 130 (2026). esbuild bundles and lowers the
// modern bits it can (target chrome56), TypeScript takes the result down to ES5 for the 2017 sets,
// and a final esbuild pass minifies with target es5, which also fails the build if any syntax newer
// than ES5 slipped through.
import { build, transform } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(here, 'dist/kitsune.js');
const { version, kitsuneNotes = '' } = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'));

const bundled = await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['chrome56'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  alias: { '@': resolve(root, 'src') },
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"', KITSUNE_VERSION: JSON.stringify(version), KITSUNE_NOTES: JSON.stringify(kitsuneNotes) },
  legalComments: 'none',
  logLevel: 'warning',
});

const es5 = ts.transpileModule(bundled.outputFiles[0].text, {
  compilerOptions: {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
    downlevelIteration: true,
    removeComments: true,
    ignoreDeprecations: '6.0',
  },
  reportDiagnostics: true,
});
const problems = (es5.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
if (problems.length) {
  for (const d of problems) console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  process.exit(1);
}

const { code } = await transform(es5.outputText, { minify: true, target: 'es5', legalComments: 'none' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `/* Kitsune for Samsung TV (TizenBrew module). MIT. https://github.com/divitcr7/Kitsune */\n${code}`);
console.log(`Built ${out.replace(root + '/', '')} (${(code.length / 1024).toFixed(1)} KB)`);
