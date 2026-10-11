# Apex TV

An independent, open-source **F1 TV client for Samsung Tizen televisions**.
Install once, sign in with your own F1 TV account on the TV, and watch with
**no computer running**. The interface supports **English and Lithuanian**.
The public package starts in English; change it in **Settings → App language**.
The choice is saved on the TV and does not change the commentary language.

[Download Apex TV](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV.wgt) ·
[Installation in Lithuanian](INSTALL-LT.md) ·
[Android / Windows / Mac / Linux installer](https://github.com/Apps2Samsung/Apps2Samsung/releases/latest)

## Screenshots

Screens captured from the English 0.5.5 interface preview using sample data.
They contain no account credentials or race footage. The player image shows
its controls and commentary choices; playback verification is described below.

| Home | Language / audio |
| --- | --- |
| ![Apex TV Home](docs/screenshots/home-en.jpg) | ![F1 Live and manual International commentary](docs/screenshots/audio-en.jpg) |
| Settings | English / Lithuanian |
| ![Apex TV Settings](docs/screenshots/settings-en.jpg) | ![Choose the app language](docs/screenshots/language-en.jpg) |

[Download the TV app and source](DOWNLOADS.md).

## Install — easiest available route

Use the separate open-source **Apps2Samsung** installer. It supports Android
phones as well as Windows, macOS, and Linux, detects the TV, and signs the
package for that TV. You do not need to install Tizen Studio for this route.

1. Download **Apps2Samsung** from its own releases and **Apex-TV.wgt** from the
   download link above. Use an Android phone or a computer on the TV's network.
2. In Apps2Samsung, find your TV and note the phone/computer's local IP.
3. On the TV: **Home → Apps → 12345 → Developer Mode ON**. Enter that local
   IP as the Host PC IP, then fully restart the TV. On a Smart Remote use its
   **123** key and the on-screen digits. This setup is needed once.
4. In Apps2Samsung, select your TV, choose **Custom WGT / TPK…** on Android
   (or the custom `.wgt` file option on desktop), and select **Apex-TV.wgt**.
   Press **Install**. Complete the Samsung account sign-in if it is requested.
5. Launch **Apex TV** and sign in with **your own F1 TV account on the TV**.
   In Samsung Apps settings, use **Add to Home** to pin its icon if available.

After installation the phone and computer can be switched off. A valid F1 TV
subscription with access to the selected content and an Internet connection
are still required. This does not unlock Premium features or bypass region,
account, concurrency, or DRM restrictions.

**Can I install it by USB?** Samsung's current developer documentation says
application/widget installation through USB is no longer supported. Copying
this `.wgt` to a USB stick will not install it on a consumer Tizen TV.
[Samsung's answer](https://developer.samsung.com/smarttv/develop/tools/additional-tools/vscode/connecting-to-tv-device.html)

The released `.wgt` is **unsigned installer input**, not a universally signed
Samsung application. Apps2Samsung applies your TV's certificate locally.
Publisher certificates, passwords, and a pre-authorized device list are not
shared. Back up the installer's own certificates/settings so future native
package updates can use the same author certificate.

## Features

- Standalone TV login, archive, weekend view, and official live catalogue.
- Native Samsung AVPlay with ordinary Widevine license requests.
- Driver POV, tracker and data views under Cameras; F1 Live / International and available languages under Audio.
- F1 Live commentary is selected by default when supplied for the session. Choose English / International manually under Audio.
- Highest compatible video quality and remote navigation. Back hides player controls first; another press returns to the menu.
- Resume, favorites, search, playback diagnostics, and signed menu updates.
- Apple TV-inspired layout, light focus animation, and TV performance tuning.
- English/Lithuanian menus, player controls, sign-in, and error messages.

## Compatibility and what has actually been tested

**Tested on Samsung UE55AU7092, Tizen 6.0 (2021)** with moving picture and
sound: main qualifying, main sprint, a genuine live pre-race studio feed, and the main 2026 Singapore Grand Prix live broadcast.
The TV fetched its own media and DRM licenses. Archive playback was also
confirmed after the companion server was stopped.

**Main-race moving picture and sound were confirmed on 11 October 2026.** Long-session stability and actual license/key rotation still require separate observation.
A successful broadcast on this TV does not establish support for every live race or Samsung model.
The repository is an initial community release, not a guarantee of support
for all Samsung models. Tizen 6.0 or later is required by the package; other
models, subscription tiers, and regions need their own tests.

The new Apps2Samsung installation route has been checked against its v2.8.2
source and the WGT package build, but has **not yet been tested end to end on a
second person's TV**. Samsung account/certificate steps can vary by model.

## Updates

Public menu/player updates are downloaded directly by the TV from
[this repository's public update feed](https://github.com/Pajuodelis/apex-tv/tree/main/updates).
They must pass the pinned RSA signature, SHA-256 file integrity, version,
and rollback checks. No computer, F1 account, or signing private key is
included in that feed. Updates are applied when playback is idle.

Changes to the native shell or its permissions still require reinstalling a
new `.wgt` with the **same installer author certificate**. Losing that
certificate can require removing and reinstalling the app, which may clear
local login and preferences. The installer itself is maintained separately.

## Build from source

Use Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm run check:public
npm test
npm run build:tv
```

The resulting **dist/Apex-TV.wgt** can be opened in Apps2Samsung.
`dist/SHA256SUMS` contains its checksum. No Samsung SDK is needed to build
this unsigned installer input. Package entries are explicitly allowlisted;
account sessions, LAN addresses, private keys, and device certificates are
excluded. A fresh build reconstructs the TV menu from the editable sources.

The distributed bootstrap trusts this project's public update key. For a
fork with its own updates, replace that public key in `tv/connection.js` and
the `SOURCE` URL in `web/online-updates.js`, use your own app/package ID, and
sign updates with your **own** private key outside Git. The publisher's
private signing key is never required to build or install Apex TV.

### Optional desktop companion

The `companion/` directory preserves the optional Electron login/diagnostic
and development tools. It is not needed for normal TV playback.
To use it, copy `companion/config.example.json` to `companion/config.json`,
set your computer and TV's private IPv4 addresses, run `npm ci` (without
`--ignore-scripts`, to download Electron), then `npm start`.

Keep that config, account state, certificates, and update signing keys local.
Do not run `tools/setup.mjs` over the public standalone bootstrap unless you
intend to build a separate, locally paired development shell.

## Contributing

Please run the tests and public-source check before sending a pull request.
For playback reports include the model, Tizen version, Apex TV version,
content type (replay/live), and the sanitized error. Never attach your F1
password, tokens, DRM challenges/licenses, TV identifiers, or certificates.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [privacy notes](PRIVACY.md).

Apex TV original code is **MIT licensed**. Dependencies retain their own
licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Apex TV is not affiliated with or endorsed by Formula 1 or Samsung.
