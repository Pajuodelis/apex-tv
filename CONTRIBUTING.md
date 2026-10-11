# Contributing

1. Fork and clone the repository.
2. Use Node.js 22+ and run `npm ci --ignore-scripts`.
3. Make a focused change; preserve normal F1 subscription/DRM checks.
4. Run `npm run check:public`, `npm test`, and `npm run build:tv`.
5. Open a pull request describing the behavior and the checks performed.

Keep issue reports anonymous. Useful details: Samsung model, Tizen version,
Apex TV version, replay versus genuinely live content, and sanitized error.
Never include account credentials/tokens, private signing material, device
identifiers, or copyrighted video clips.

The canonical update feed uses a separately held private RSA key. Contributors
can build unsigned installer packages without access to that key. Native
installation is signed locally for each user's TV by their installer.
Keep the same author certificate for updates to an existing installation.

Tests cover protocol behavior and packaging, not visual proof on every TV.
A moving playback clock alone does not establish working picture and sound.
Do not label an archive item LIVE or claim support on an untested device.
