# Changelog

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
