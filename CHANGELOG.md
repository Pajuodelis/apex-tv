# Changelog

## 0.5.11 — local candidate, not published

- Avoid repainting identical cached home highlights on menu entry and periodic refresh; prune detached artwork when that shelf actually changes. Stress tests cover 100 rapid catalogue replacements and late image callbacks.
- Reuse unchanged home schedule DOM and a bounded cache of repeated English translations. Purge detached thumbnail work when replacing catalogue/search results, index visibility callbacks by image, and release stalled image loads after 15 seconds while retaining the concurrency limit of two.
- Refine the four player actions into rounded capsules with monochrome vector icons and a single clear white focus state. Pause/play artwork follows playback state, using static layers without blur, scaling or emoji.
- Organize Settings into Account, Playback, Display & language, Privacy and Help & updates. Render one short pane at a time, preserve category focus, and return from a pane to its category with Back. Existing sign-in, confirmation, preferences and diagnostic actions are retained.
- Remote category navigation separates focus from selection; Down opens the focused category and enters its controls. Restore textarea focus as well as buttons and inputs.
- Replace fixed fallback image IDs with a bounded TV-local cache of public artwork URLs from current weekend and recent highlights metadata. Refresh recent highlights on the idle home screen every ten minutes; preserve valid cached choices on empty/error responses and across restarts. No account data is stored in the artwork cache.
- Use official F1 photography in the home background and discovery cards, replacing it with current catalogue, favorites and history artwork when available. Existing bounded lazy loading remains in use.
- Add a compact upcoming-session schedule to the right of the home feature, with local times, keyboard navigation and only F1-confirmed LIVE status. Past replays are excluded; smaller layouts stack the schedule under the feature.
- Refine the cinema home with a quiet sidebar, spacious feature panel, consistent rounded cards and a five-column discovery row at TV resolutions. Static gradients preserve a lightweight rendering path; smaller screens retain a three-column layout.
- Coalesce dense remote arrow repeats into one focus action per animation frame, reuse menu geometry during shell scrolling, and follow the actual grid or horizontal shelf layout.
- OK reveals player controls without pausing. Dedicated Play/Pause remains immediate. Left/right opens a timeline preview; OK confirms one seek, while Back cancels and hides controls.
- Emphasize Pause, enlarge the timeline target and show concise English/Lithuanian remote hints. Controls hide after inactivity while playing, preserving paused and unconfirmed timeline selections.
- Local validation covers remote events in Chromium 76 and Chrome 120 with mock playback. Physical TV picture, sound and remote responsiveness must still be checked before publication.

## 0.5.10 — 2026-10-14

- Fix highlights playback when a static DASH manifest splits inherited timing and media paths between parent and representation SegmentTemplate elements. The existing XML adapter now merges these scopes before local routing.
- Regression tests cover inherited timescales, representation overrides, padded segment numbers, preserved protection metadata, missing assets and rejected media hosts.
- Physical Samsung UE55AU7092 / Tizen 6 validation: official phone QR sign-in, F1 subscription and region checks, saved session after app restart, and Qualifying Highlights – Singapore with picture and sound confirmed.
- Newer Chromium 120 engine checks passed for QR UI, encrypted storage and real F1 device-code/pending requests. A physical Tizen 9 confirmation is still needed.

## 0.5.9 — 2026-10-14

- Sign in with your phone: scan the TV's QR, sign in on the official F1 page and approve the displayed code. No computer or Apex account relay is required for this flow.
- Clear waiting, expiration and denial states; Back, screen changes and cancellation stop polling. Requests respect F1's polling interval and slow-down responses; HTTP 403 is terminal.
- Verify the nested F1 session's signature, subscription and region before saving it in the TV's existing encrypted vault. OAuth access/refresh tokens and the private device code are not persisted.
- Diagnostics distinguish phone code creation and approval from session signature, subscription, region and storage. Credentials, tokens and codes are excluded.
- English and Lithuanian UI, manual code entry fallback, and existing email/desktop sign-in alternatives retained. Existing account sessions, player behavior, app ID and pinned update key are unchanged.
- Validation: 230 automated tests passed; real official phone approval, F1 signature, subscription and LT region verified. These checks do not establish compatibility with every physical Tizen model.

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
