# Kitsune for Samsung TV

Kitsune on Samsung Smart TVs (Tizen): the same cinematic, ad-free anime.nexus experience as the Android app, built for a TV remote. It's a [TizenBrew](https://github.com/reisxd/TizenBrew) module.

> **Why TizenBrew?** Kitsune's whole trick is running a small guard script inside anime.nexus's own pages (so the site's player plays, minus the ads and popups). A regular Samsung TV app can't put a script into another site's page. TizenBrew can: it's an open-source TV app that opens a website and injects a module's script into it. Samsung's app store isn't an option for an unofficial client like this, so installing TizenBrew once (in Developer Mode) is the way in.

## Install

You need the TV and a computer (Windows, macOS or Linux) on the same network. One time only:

1. **Developer Mode on the TV.** Open **Apps**, then press **1 2 3 4 5** on the remote (on some remotes, the on-screen number pad). Switch **Developer mode** on, enter your computer's IP address as **Host PC IP**, and restart the TV (hold the power button until it turns off and on again).
2. **Install TizenBrew** with [TizenBrew Installer](https://github.com/reisxd/TizenBrewInstaller/releases/latest) on your computer (on macOS or Linux you may need to `chmod +x` the download and run it from a terminal). Press **Install TizenBrew**. On 2023 and newer TVs (Tizen 7+) it asks you to sign in with a Samsung account, which it uses to make a certificate for your TV. Full instructions: [TizenBrew's guide](https://github.com/reisxd/TizenBrew/blob/main/docs/README.md).
3. **Point Developer Mode at the TV itself.** TizenBrew injects modules through the TV's own debugger and only does so when **Host PC IP** is `127.0.0.1`. Go back to **Apps → 1 2 3 4 5**, set it to `127.0.0.1` if it isn't already, and restart the TV.
4. **Add Kitsune.** Open TizenBrew on the TV, go to **Module Manager → Add**, choose **NPM**, and enter `@divitcr7/kitsune-tizen`. Kitsune appears in TizenBrew's list; open it from there. (TizenBrew's settings can also launch it automatically.)

Updates arrive by themselves: TizenBrew loads the newest published version of the module each time it starts.

## Supported TVs

Samsung TVs from **2019 on** (Tizen 5.0+) are the target. **2017–2018** sets (Tizen 3 and 4) are best effort: the bundle is compiled down to ES5 for their older Chromium, but TizenBrew itself and the TV's speed decide how well it runs. Anything TizenBrew supports, Kitsune should load on.

## Using it

| Remote | On Kitsune's screens | While watching |
| --- | --- | --- |
| ◀ ▶ ▲ ▼ | Move around | ◀ ▶ seek 10 s (keep pressing: 30 s, then 60 s) · ▲ show the controls · ▼ more options |
| OK | Select | Play / pause |
| Back (↩) | Back a screen; on a tab, up to the menu bar; then asks before leaving | Close the options row, otherwise back to the show |
| ⏯ ▶ ⏸ | | Play / pause |
| ⏪ ⏩ | | Seek |
| ⏮ ⏭ | | Previous / next episode |
| ⏹ | | Back to the show |

▼ while watching opens a row with **Next episode**, **Audio** (when the episode has more than one language), **Subtitles** and **Fill / Fit**.

**Sign in** from the account button at the top right (or My Stuff → anime.nexus account). Kitsune shows its own email and password form: the TV's keyboard opens on OK, and Kitsune fills in and submits anime.nexus's real sign-in form. Your password goes only to anime.nexus and is never saved by Kitsune. If that ever doesn't work, **Use the site's form** lets you fill in anime.nexus's own page with the remote. Accounts made with Google need a password added on anime.nexus in a browser first (Google blocks its sign-in on TVs).

My List, history and progress are kept on the TV (in anime.nexus's storage in TizenBrew), separate from the phone app.

## Troubleshooting

- **TizenBrew says it can't launch in debug mode.** Developer Mode must be on with Host PC IP `127.0.0.1` (step 3). It switches off by itself on some TVs after a firmware update; turn it back on.
- **"Failed to load module".** The TV couldn't reach jsDelivr, which TizenBrew loads modules from. Check the connection and relaunch TizenBrew.
- **A "Verify you are human" box over the video.** That's Cloudflare, on anime.nexus's behalf. Focus is put on it: press OK to tick it. Back leaves the player.
- **"Sign in to keep watching" / "This episode won't start right now".** anime.nexus limits guest streams. Sign in (see above), or wait a minute and choose Try again.

## How it works

TizenBrew relaunches itself in debug mode through the TV's local `sdb` port, attaches to its own window with the Chrome DevTools Protocol, and, once you open a module, navigates the window to the module's `websiteURL` and evaluates the module's script in **every new JavaScript context** that appears (each page load, and each iframe). Sources: [`service/index.js`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/index.js) (debug relaunch over `127.0.0.1:26101`), [`utils/debugger.js`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/debugger.js) (`Runtime.evaluate` on `Runtime.executionContextCreated`), [`utils/moduleLoader.js`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/moduleLoader.js) (manifest from `https://cdn.jsdelivr.net/<module>/package.json`), [`WebSocketClient.js`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/tizenbrew-ui/src/components/WebSocketClient.js) (registers the manifest's `keys`, then `location.href = websiteURL`), and [`docs/MODULES.md`](https://github.com/reisxd/TizenBrew/blob/main/docs/MODULES.md). Kitsune uses the same evaluation path as [TizenTube](https://github.com/reisxd/TizenTube) (no `evaluateScriptOnDocumentStart`).

`dist/kitsune.js` starts once per anime.nexus top-level page (it ignores iframes and TizenBrew's own launcher page) and picks a mode from the address:

| Page | What Kitsune does |
| --- | --- |
| `https://anime.nexus/robots.txt` (the `websiteURL`) | Draws Kitsune's own 10-foot UI on this plain-text page. It's on anime.nexus's origin, so the catalog API and sign-in cookies work like they do for the site, but none of the site's scripts or ads ever load. |
| `/watch/…` | Runs the **same player script as the Android app** (`playerScript` from [`src/lib/inject.ts`](../../src/lib/inject.ts): script/iframe allowlist, no popups, player pinned full screen, resume, progress, Cloudflare check lifted, site errors reported) in TV mode, plus an on-screen display and remote control. |
| `/login`, `/register`, … | The site's sign-in page with Kitsune's form on top (the shared `accountScript` and `loginFillScript`). |
| `/user/…` | The site's account pages behind the same guard, driven with the remote. |
| anything else | Back to Kitsune's UI (a `/series/…` link opens that show). |

Moving between Kitsune's UI, the player and the sign-in page is a full page load, so Kitsune keeps its own back stack in `sessionStorage` and only ever replaces the address. The TV's history stays at TizenBrew → Kitsune, and Back on Home returns to TizenBrew.

Video is never downloaded, extracted or decrypted: it plays in anime.nexus's own player, as it would in a browser.

## Build and test

```sh
npm run build:tizen          # → tv/tizen/dist/kitsune.js
npx tsc -p tv/tizen --noEmit # typecheck (also part of npm run typecheck)
```

The build bundles with esbuild (Preact for the UI), lowers it to ES5 with TypeScript for 2017-era Chromium, and minifies with esbuild targeting ES5, which also fails the build if any newer syntax slips through. The CSS avoids features those browsers lack (flex `gap`, grid, custom properties, `inset`, `aspect-ratio`, `position: sticky`).

**Without a TV:** `dev/harness.html` runs the bundle in desktop Chrome against made-up shows (`dev/fixtures.js`); it stubs `fetch`, draws artwork locally and never touches anime.nexus. Open it at 1920×1080, or screenshot every screen headlessly:

```sh
npm run build:tizen && node tv/tizen/dev/shoot.mjs /tmp/kitsune-tv-shots
```

Query parameters: `mode=ui|player|login`, `seed=1` (fills Continue Watching, My List and history), `keys=down,right,ok:300` (remote presses to replay), `debug=1` (shows the focused element, scroll offsets and the last page messages), `still=1` (no transitions). The hash picks a screen, e.g. `harness.html?seed=1#/show/s3`.

**On a TV before publishing:** TizenBrew can load a module from GitHub through jsDelivr (`gh/<user>/<repo>`), so push a test repo whose root `package.json` is this folder's manifest with `dist/kitsune.js` committed, and add `gh/<user>/<repo>` in TizenBrew's Module Manager. jsDelivr caches branches for a while; tag a version (`gh/<user>/<repo>@v0.1.1`) to load a specific build.

## Publishing

The module is published to npm as `@divitcr7/kitsune-tizen` (`files` ships only `dist/kitsune.js` and this README):

```sh
npm run build:tizen && npm publish --access public ./tv/tizen
```

Bump `version` in `tv/tizen/package.json` for each release. TizenBrew reads the package through jsDelivr's npm mirror, which picks up a new version within minutes to hours.
