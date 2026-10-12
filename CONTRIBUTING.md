# Contributing to Apex TV

Bug reports, TV compatibility results, documentation fixes and focused pull
requests are welcome.

## Report a bug or test your TV

- [Bug report](https://github.com/Pajuodelis/apex-tv/issues/new?template=bug-report.yml)
  — unexpected behavior, installation errors or playback failures.
- [Compatibility report](https://github.com/Pajuodelis/apex-tv/issues/new?template=compatibility.yml)
  — results from a specific Samsung model, including unsuccessful tests.

Search [existing issues](https://github.com/Pajuodelis/apex-tv/issues) first.
Include the Samsung model, Tizen version, Apex TV version, replay or genuinely
live content, and a sanitized error or clear description.

Do not include passwords, account tokens, DRM challenges or licenses, device
identifiers, private signing material or copyrighted video clips. Crop or
redact screenshots before sharing. See [Privacy](PRIVACY.md).

## Submit a pull request

1. Fork and clone the repository; use **Node.js 22 or newer**.
2. Run `npm ci --ignore-scripts`.
3. Make a focused change and preserve normal F1 subscription and DRM checks.
4. Run the checks below.
5. Open a pull request describing the problem, resulting behavior and validation.

```sh
npm run check:public
npm test
npm run build:tv
```

For setup, architecture and fork configuration, see the
[development guide](docs/DEVELOPMENT.md).

## Playback and update expectations

Tests cover protocol behavior and packaging, not visual proof on every TV.
A moving playback clock alone does not establish working picture and sound.
Identify replay and live tests accurately, and do not claim support on an
untested device.

The canonical update feed uses a separately held private RSA key. Contributors
can build unsigned installer packages without that key. Installation is
signed locally for each user's TV; keep the same author certificate for
native updates to an existing installation.

Preserve signature, integrity, version and rollback checks. Documentation-only
changes do not require a new TV package or a signed menu update.
