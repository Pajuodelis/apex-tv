# Development

[← Back to Apex TV](../README.md) · [Contributing](../CONTRIBUTING.md)

## Build the TV package

Use **Node.js 22 or newer**:

```sh
git clone https://github.com/Pajuodelis/apex-tv.git
cd apex-tv
npm ci --ignore-scripts
npm run check:public
npm test
npm run build:tv
```

The build writes `dist/Apex-TV.wgt` and `dist/SHA256SUMS`. Open the WGT in
Apps2Samsung for local signing and installation. No Samsung SDK or publisher
private key is needed to build it.

Package entries are explicitly allowlisted. Account sessions, private
network addresses, private keys and device certificates are excluded.
A fresh build reconstructs the TV menu from the editable sources.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `tv/` | Installed Tizen shell, bootstrap configuration and bundled menu |
| `web/` | Editable interface, player and menu update client |
| `updates/` | Public signed menu/player update feed |
| `companion/` | Optional Electron companion and development tools |
| `tools/` | Build, packaging and public-source checks |
| `tests/` | Automated behavior and packaging checks |
| `docs/` | Development documentation and interface screenshots |

## Signed updates and forks

The distributed bootstrap trusts this project's public update key. The
canonical private RSA signing key is held separately and is never required
to build or install Apex TV.

For a fork that publishes its own updates:

1. Replace the public key in `tv/connection.js` with your own public key.
2. Change `SOURCE` in `web/online-updates.js` to your update feed.
3. Use your own app and package IDs.
4. Sign updates with your own private key, stored outside Git.

Preserve signature, integrity, version and rollback checks. Native package
updates need the same installer author certificate as the original installation.
A changed native shell or permissions cannot be delivered as a menu-only update.

## Optional desktop companion

Normal TV playback does not need the companion. The `companion/` directory
preserves optional Electron login, diagnostics and development tools.

1. Copy `companion/config.example.json` to `companion/config.json`.
2. Set your computer and television's private IPv4 addresses.
3. Run `npm ci` without `--ignore-scripts` to download Electron.
4. Run `npm start`.

Keep configuration, account state, certificates and signing keys local.
Do not run `tools/setup.mjs` over the public standalone bootstrap unless
you intend to build a separate, locally paired development shell.

## Validation limits

Automated tests cover protocol behavior and packaging. They do not prove
picture and sound on every television, live-session endurance or DRM key
rotation. Report physical playback results separately from automated checks.
See [compatibility](../README.md#compatibility) for verified device coverage.
