# Changelog

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
