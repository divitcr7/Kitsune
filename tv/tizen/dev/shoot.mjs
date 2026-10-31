// Screenshots the offline harness at 1920x1080 with headless Chrome:
//   node tv/tizen/dev/shoot.mjs <out-dir> [chrome-path]
// Build first (npm run build:tizen). Nothing here touches the network.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || 'tizen-shots');
const chrome = process.argv[3] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = pathToFileURL(resolve(here, 'harness.html')).href;

const shots = [
  ['home', '?seed=1'],
  ['home-rails', '?seed=1&keys=down,down,right,right'],
  ['show', '?seed=1#/show/s3'],
  ['show-episodes', '?seed=1&keys=down:500,down,down#/show/s3'],
  ['search', '?seed=1#/search'],
  ['schedule', '?seed=1&keys=down,down#/schedule'],
  ['library', '?seed=1#/library'],
  ['exit', '?seed=1&keys=back,back'],
  ['restore', '?seed=1&keys=right,right,ok:300,back:900'],
  ['player-osd', '?mode=player&keys=right,right,right:200'],
  ['player-controls', '?mode=player&keys=down'],
  ['login', '?mode=login'],
];

mkdirSync(out, { recursive: true });
for (const [name, query] of shots) {
  const file = resolve(out, `${name}.png`);
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    '--window-size=1920,1080',
    '--virtual-time-budget=5000',
    `--screenshot=${file}`,
    page + query.replace(/^\?/, '?still=1&'),
  ], { stdio: 'ignore' });
  console.log(file);
}
