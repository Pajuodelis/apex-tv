# Apex TV on Tizen 5.0 / 5.5 (Samsung TVs 2019–2020)

[Português](TIZEN-5-PT.md)

Samsung documents **Tizen 5.0 (2019)** as **Chromium 63** and **Tizen 5.5 (2020)** as
**Chromium 69**. The TV package targets `chrome63`, the lower of the two, so one `.wgt`
serves both.

Version **0.5.12** includes this support in the standard downloadable
[Apex-TV.wgt](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV.wgt).
A separate fork or custom build is no longer needed to install on Tizen 5.x.

## Contributor-reported device test

| Field | Value |
| --- | --- |
| Model | Samsung **UN43TU7000GXZD** (2020, Brazil) |
| Firmware | T-KTSU2UABC-2743.0 |
| Tizen | 5.5 |
| Apex TV | 0.5.11, menu revision `68dbb7b529dfd073f2c2f032` |
| Result | `f1-playback-confirmed`: basic and F1 picture and audio confirmed with the in-app setup check; Add to Home confirmed |
| Engine | Native **AVPlay + Widevine**, opening the F1 DASH URL directly (the compatibility player was not needed) |
| Unverified | Ordinary F1 licence observation, licence/key rotation during a long live session (e.g. a full Grand Prix) |

Tizen 5.0 (2019) has not been tested on a real TV yet.

This report describes the contributor’s build, not a fresh test of later integration changes.
Replay versus live content was not recorded. The integrated playback code was subsequently checked on Samsung UE55AU7092 /
Tizen 6: F1 Live and Portuguese International picture and sound were confirmed.
Restart persistence remains untested. Automated checks do not prove playback
on every model.

A [later contributor report](https://github.com/Pajuodelis/apex-tv/issues/4) records
about 70 minutes of genuinely live FP1 on 2026-10-23 without interruption,
with camera/commentary switching and no companion. It used an earlier modified
0.5.11 build, not the new public 0.5.12 WGT; DRM key rotation is still unverified.

## What changed

| Area | Change |
| --- | --- |
| Transpilation | `tools/legacy.mjs` runs the assembled `tv-app.js` and `tv.css` through **esbuild** with `target: chrome63` before hashing and signing, both for the bundled menu and for published online updates. It lowers `?.`, `??`, optional `catch {}` binding, class fields, `inset`, etc. |
| Source | `web/f1-browser.js`: `catch {` → `catch (_unused) {` (the syntax error behind the black screen). |
| Polyfills | `tv/legacy-polyfills.js`, loaded in `index.html` before `boot.js`: `globalThis`, `String.prototype.matchAll/replaceAll/trimStart/trimEnd/at`, `Array.prototype.flat/flatMap/at`, `Object.fromEntries/hasOwn`, `Promise.prototype.finally`, `Promise.allSettled`, `queueMicrotask`, `AbortController`/`AbortSignal` (+ caller-side fetch rejection on abort; the underlying request may continue) and `AbortSignal.timeout`. Each polyfill is installed only when the native API is missing. |
| CSS | Flexbox `gap` arrived in Chromium 84. The polyfill sets `<html class="no-flexgap">` and `tv.css` falls back to margins. The compatibility grid also declares `grid-gap`. |
| Player (AVPlay) | The TV-local relay (`tizentvwasm` sockets + `BigInt`) exists only on Tizen 6+. On Tizen 5.x the app opens the F1 DASH URL directly in `webapis.avplay` with Widevine. If playback fails, the error screen offers **Try compatibility player** (dash.js + MSE/EME with the CBCS audio fix). The choice is stored in `localStorage['apex-legacy-engine']`, and the same button switches back to AVPlay. Tizen 6+ behaviour is unchanged. |
| Checks | `setup-checks.js` accepts Tizen 5.x. The new `tools/check-legacy.mjs` (run by `npm run build:tv`) fails the build if any script in the `.wgt` does not parse as Chromium 63 JavaScript. |
| config.xml | `required_version="5.0"`. |
| Online updates | Still enabled by default. Because `Releases.publish()` lowers the menu before signing, updates stay compatible with Tizen 5.x. A fork can set `"onlineUpdates": false` in `tv/connection.js` to ship a frozen menu. |

## Build

```sh
npm ci --ignore-scripts
npm test
npm run build:tv
```

Expected output ends with
`Tizen 5.x compatibility check passed: 6 scripts parse as Chromium 63 JavaScript; required_version=5.0.`
The unsigned package is written to `dist/Apex-TV.wgt`; install it with Apps2Samsung as described in
[INSTALL.md](../INSTALL.md).

## If video does not start

- Open **Settings → Compatibility check** to see the model, Tizen version and player engine.
- On the error screen, press **Try compatibility player** to switch to dash.js + EME, or
  **Try Samsung AVPlay** to switch back.
- Alternatively, run the companion on a PC ([DEVELOPMENT.md](DEVELOPMENT.md)); it provides the
  encrypted relay that Tizen 6 runs inside the TV.

## Known limitations

- Chromium 63 has no `focus({preventScroll})`. Focus works, but scrolling may jump slightly while navigating.
- A long live session has not been confirmed yet; DRM licence renewal happens there. If video stops
  after 30–60 minutes with a DRM error, that is the likely cause.
- Direct AVPlay playback does not get the timestamp and CBCS audio corrections of the Tizen 6 relay.
  They were not needed on the UN43TU7000; on other models, use the compatibility player if picture or sound misbehave.
