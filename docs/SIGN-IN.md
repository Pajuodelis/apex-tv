# Sign-in troubleshooting and official browser fallback

## Phone sign-in (local 0.5.9 candidate)

Choose **Sign in with your phone** on the TV, scan the QR and finish sign-in
on the official `https://f1.com/pair` page. If F1 asks for a **TV code**, enter
the code shown by Apex TV on your phone. No computer or Apex relay is needed.
The QR does not contain your password or account token.

The app uses F1's public OAuth device flow and follows the server's polling
interval. Codes expire, cancellation stops polling, and HTTP 403 is terminal.
The returned nested F1 subscription token must pass the existing signature,
subscription and region checks before storage in the TV's encrypted vault.
OAuth access/refresh tokens and the private device code are not persisted.

Diagnostics distinguish **phone code request**, **phone approval**, **session
signature**, **subscription**, **region**, and **storage**. They omit credentials
and codes. F1's own account, region and subscription restrictions still apply.

Phone approval plus F1 signature, entitlement and LT region were verified
against the real service on 2026-10-14. Physical-TV QR, sign-in, persistence
and playback validation remain pending while the TV is off. This is not yet
a published release or a confirmation of all Tizen models.

The TV's direct sign-in uses F1's password API. F1 can reject that request,
including with HTTP 403. This does not by itself indicate a leaked password.
Do not repeatedly retry a rejected request.

The login screen now reports the failed step: account authentication, F1
session signature, subscription access, region check, or local session storage.
**Show sign-in diagnostics** provides only stage names, status codes and
response types. It excludes email, password, tokens, request headers and
response bodies. HTML indicates an HTML response, not a proven reason for rejection.

## Official F1 browser alternative

This fallback requires a computer for sign-in and local pairing. Playback then
runs on the TV; the computer can be switched off. A future expired/rejected
session may require pairing again. It is not a permanent sign-in guarantee.

1. Follow the repository's optional desktop companion setup. Set the actual
   computer and TV private IPv4 addresses in companion/config.json.
2. Run npm start. Choose **Prisijungti per oficialų F1 langą**. Complete
   sign-in yourself on F1's HTTPS website. The app does not enter credentials,
   solve challenges, change your region, or override an F1 rejection.
3. Choose **Sukurti TV susiejimo kodą**. Keep this private code out of issue
   reports, chat and screenshots. It expires after five minutes and can be
   redeemed once by the configured TV.
4. On the TV choose **Settings → Official F1 sign-in**, paste that code
   (a phone remote keyboard can help), and choose **Link official sign-in**.
5. The session is signed and encrypted for the TV's ephemeral public key.
   The TV independently verifies F1's signature, subscription and region
   before saving it in its encrypted local vault. The public update key is
   unchanged. The private pairing code is not saved by the TV.

Opening F1 in the TV's separate Internet browser alone does not link Apex TV:
the app has no supported access to that browser's login cookies.

## Validation limits

Automated tests cover distinct 403 stages, sanitized diagnostics, ciphertext
pairing, tampered signatures and rejection of invalid/expired configuration.
They do not establish successful sign-in on every TV. Samsung GU55U8079FUXZG
with Tizen 9 still needs physical confirmation of sign-in and playback.
