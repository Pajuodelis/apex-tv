# Third-party software

The MIT license at the repository root applies to Apex TV's original code.
Bundled and installed dependencies retain their own licenses.

- **dash.js 4.7.4**, Dash Industry Forum: BSD 3-Clause. The original bundle is
  `web/vendor/dash.all-4.7.4.min.js`. Its full license and contributor notices
  are preserved in `web/vendor/dash-LICENSE.md` and
  `web/vendor/dash.all.min.js.LICENSE.txt`, and included in the TV package.
  Source: https://github.com/Dash-Industry-Forum/dash.js/tree/v4.7.4
- **Electron**, optional companion runtime: MIT, with Chromium and other
  dependency notices distributed by Electron. Installed through npm; runtime
  binaries are not included in this repository or the TV package.
  Source: https://github.com/electron/electron
- **@xmldom/xmldom**, development/test dependency: MIT; its license is included
  in the npm package. Source: https://github.com/xmldom/xmldom

Samsung AVPlay, Widevine CDM, and `tizentvwasm` are platform APIs supplied by
Samsung. No Samsung SDK, CDM binary, content decryption key, certificate, or
proprietary F1 video is bundled in this repository.

Apps2Samsung is a separate open-source installer. Download it from its own
maintainers: https://github.com/Apps2Samsung/Apps2Samsung . It is not bundled
or maintained by Apex TV.

F1, Formula 1, Samsung, and other referenced names belong to their respective
owners. Apex TV is an independent community project and is not an official
F1 or Samsung application. The code license does not grant rights to F1 video,
artwork, subscriptions, or trademarks.

The optional companion's two public Axinom DRM test-vector tokens are copied
from Shaka Player's maintained demo catalogue (Apache License 2.0), not from
an F1 account. Their exact SHA-256 values are allowlisted by the public-source
check after matching the upstream public file. Shaka's license is preserved
in `web/vendor/shaka-demo-LICENSE`.
Source: https://github.com/shaka-project/shaka-player/blob/main/demo/common/assets.js
