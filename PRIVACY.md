# Privacy

The public standalone package contains no person's F1 account, LAN address,
TV identifier, pairing secret, Samsung certificate, or signing private key.
The RSA public key in `tv/connection.js` is intentionally public: it verifies
menu updates and cannot sign them.

F1 login is performed by the installed application on the user's TV. Its
local session vault uses the platform's Web Crypto storage mechanisms.
This is not a claim of tamper resistance against someone with physical or
developer access to the television. Sign out before selling or sharing it.
Normal account, catalogue, media, and license requests go to F1's services.
Signed menu files are fetched from GitHub. The software contains public
client configuration used for those service calls, plus two publicly published DRM demo test-vector tokens in the optional companion (see THIRD_PARTY_NOTICES.md), not a shared subscriber
account or a way to unlock content.

The generic package has no configured PC monitoring endpoint. Connecting
an optional private companion can send sanitized diagnostic events to that
companion on the local network; this is disabled in the public bootstrap.
Do not publish local app-state directories, exported sessions, complete DRM
responses, private certificates, or personal diagnostic bundles.

## Local compatibility reports

The first-run guide stores its phase and human picture/sound confirmations on
the TV. Confirmation is tied to the app revision, model and firmware; a new
revision requires fresh verification. Compatibility sharing builds a QR code
locally from a strict field allowlist. It does not export raw logs or account
storage, and makes no upload. The report excludes account identifiers, LAN
addresses, serial/DUID/MAC values, passwords, tokens, certificates, and DRM
challenges/licenses. License/key rotation remains explicitly unverified.
