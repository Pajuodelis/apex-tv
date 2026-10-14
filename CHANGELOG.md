# Changelog

## 0.5.8 — 2026-10-14

- Sign-in diagnostics identify authentication, signature, subscription, region and storage failures instead of showing the same generic HTTP 403 at every step. Reports contain no account credentials, tokens or response bodies.
- Official F1 browser fallback: sign in in the desktop companion and link its signed, encrypted session to the configured TV using a five-minute, single-use pairing code. The TV independently verifies F1's session, subscription and region.
- Recognize F1 login-session cookies without a Secure attribute when obtained from the isolated HTTPS F1 window; F1 signature validation remains required. Existing session cookies are checked after navigation, including cookies with API/path-specific scope.
- The fallback requires a computer for pairing or signing in again, but not for subsequent TV playback. The TV's public update key and app ID are unchanged.
- Validation: 220 tests passed; official desktop sign-in completed, region LT was verified and the F1 window closed automatically. Samsung GU55U8079FUXZG / Tizen 9 pairing and playback still need physical confirmation.

## 0.5.7 — 2026-10-13

- New Highlights & shows section: highlights, Race in 30, official F1 shows and documentaries, including recent GP selections.
- Category navigation, search, pagination and Back restore the previous selection; cached requests limit work on the TV.
- Cleaner sign-in screen with a single card, clear field labels, a full-width button and readable inline errors. English and Lithuanian are supported.
- Failed sign-in clears the password and returns focus to the password field. Authentication and encrypted session storage are unchanged.
- Validated with automated tests, official catalogue metadata and browser previews. Physical TV testing of this release is pending; earlier live/replay playback evidence is not a new test of 0.5.7.

## 0.5.6 — 2026-10-12

- First-run guide: TV sign-in, human-confirmed picture/sound tests, Samsung Home instructions and saved progress.
- Readable compatibility checks and a local QR report with allowlisted fields. Clear demo and actual F1 playback results remain separate.
- Four primary player buttons: pause/resume, cameras/POV, audio and More.
- Focusable remote timeline: Up selects it, arrows preview a time, held arrows accelerate, OK performs one seek and Back cancels/hides. Draft movement is painted once per frame without seeking for every key.
- English and Lithuanian UI preserved. F1 Live remains the default commentary.
- Fixed weekend time formatting in browser/Tizen runtimes without a Node `global` alias.
- Local UE55AU7092 test: the user confirmed smooth timeline movement and moving F1 picture/sound after a seek. This is replay evidence, not a new live-broadcast or license-rotation test.

## 0.5.5 — default F1 Live, audio choices and fullscreen controls

- Selects service-provided F1 Live by default for a new main session, even if the
  provider marks International as its default. English / International remains
  a manual Audio choice. Explicit driver POV and other manual views are kept.
- Moved service-provided F1 Live and International feeds into Language / audio.
  Camera choices contain driver POV, tracker and data views. Audio languages
  remain tied to the currently selected authorized F1 stream.
- Back closes a selection dialog, then hides player controls without stopping
  playback; a further press returns to the menu. Hidden paused controls stay
  hidden until explicitly reopened. Updated English and Lithuanian help text.
- Added Home, audio, settings and language screenshots to the README, with
  direct links to the TV package, source archive and installation instructions.
- Preserved native AVPlay preparation, encrypted media handling, normal DRM,
  update signing identity and the installed Samsung Home icon.
- The main Singapore Grand Prix LIVE picture and sound were confirmed on the
  physical UE55AU7092 using the previous 0.5.2 player; endurance/key rotation
  remain separate observations. 182 public-source tests pass.

## 0.5.3 — first open-source package, English and Lithuanian

- Published the editable TV UI/player and optional companion source under MIT.
- Added English menus, sign-in, player controls, settings and error messages.
  Switch English / Lithuanian in Settings; the TV saves your preference.
- Kept unchanged player labels free of repeated DOM writes. Language switching
  preserves existing elements and never reads or rewrites entered passwords.
- Added a standalone unsigned WGT build for local signing with Apps2Samsung;
  removed personal pairing, LAN configuration, account state and certificates.
- Published a separate signed update feed in this repository, with the pinned
  public key preserved. Existing private installations are unaffected.
- Included third-party license notices, package/privacy checks, and Windows/Linux CI.

Playback retains the 0.5.2 dynamic live DASH refresh, ordinary license/session
renewal, TV-local AVPlay media delivery, and previous performance fixes.
VOD and genuine pre-race live studio playback are confirmed on UE55AU7092.
Full race endurance verification remains separate; see the README.
