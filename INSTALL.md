# Install Apex TV

[← Back to Apex TV](README.md) · [Diegimas lietuviškai](INSTALL-LT.md)

## Before you start

- Samsung television running **Tizen 6.0 or later**. Playback is currently
  verified on UE55AU7092; other models need testing.
- Your own F1 TV subscription with access to the content in your region.
- Internet access and an Android phone or Windows, macOS or Linux computer
  on the **same local network** as the television.

The phone or computer is needed for installation. It does not need to stay
running while you watch.

## 1. Download the app and installer

| Download | Purpose |
| --- | --- |
| [Apex-TV.wgt](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV.wgt) | The Samsung TV application |
| [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung/releases/latest) | Separate open-source installer for Android, Windows, macOS and Linux |

Choose the Apps2Samsung release for your installation device. The WGT is
unsigned installer input; Apps2Samsung signs it locally for your TV. Apex TV
does not distribute private Samsung certificates.

For download verification, see [Downloads](DOWNLOADS.md#verify-your-download).

## 2. Enable Developer Mode on the TV

1. Open Apps2Samsung, find your television and note the local IP address of
   the phone or computer used for installation.
2. On the TV, open **Home → Apps** and enter **12345** with the remote. On a
   Smart Remote, use the **123** button and the on-screen digits.
3. Set **Developer Mode** to **ON**.
4. Set **Host PC IP** to the phone or computer's local IP address.
5. Confirm and fully restart the television.

The Host PC IP is the installation device's address, not the TV's address.
Menu and certificate steps may vary by Samsung model.

## 3. Install the WGT

1. In Apps2Samsung, select your TV.
2. On Android, choose **Custom WGT / TPK…**. On desktop, use the custom
   `.wgt` file option.
3. Select **Apex-TV.wgt** and press **Install**.
4. Complete Samsung account sign-in if requested by the installer.

Back up the installer's certificates and settings. Native package updates
must use the same author certificate as the original installation.

## 4. Sign in and start watching

Open **Apex TV** and sign in with your own F1 TV account **on the television**.
Apps2Samsung does not need your F1 TV password.

The public package starts in English. To change the menu language, open
**Settings → App language → Lietuvių**. The TV saves the choice; commentary
language is selected separately under **Audio**.

You can now switch off the phone or computer. The television fetches its own
media and DRM licenses. Your subscription and region must permit the chosen
replay or live session.

To pin the app, use **Home → Apps → Settings → Apex TV → Add to Home**, if
available on your model. If the icon is missing, launch the app from the
installer, return to Apps and check the installed apps again.

## Updates

Menu and player updates are downloaded directly from GitHub and checked
against the pinned signing key. They apply while playback is idle and do
not need a computer.

Changes to the native shell or its permissions require installing a new WGT
with the original author certificate. Removing and reinstalling the app may
clear its saved login and preferences.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| TV not found | Same network, Developer Mode ON, correct Host PC IP and a full TV restart. Check Apps2Samsung's connection diagnostics. |
| `Author certificate not match` | Use the certificate from the original installation. Removing the existing app may clear login and settings. |
| F1 returns `403` | Check your sign-in, subscription, region and other active screens. Apex TV does not bypass these restrictions. |
| Picture or sound fails on another TV | Record the model, Tizen version, Apex TV version, content type and sanitized error in a bug report. |

**USB installation:** copying a WGT to a USB stick does not install it on a
consumer Tizen TV. See [Samsung's device connection documentation](https://developer.samsung.com/smarttv/develop/tools/additional-tools/vscode/connecting-to-tv-device.html).

[Report a bug](https://github.com/Pajuodelis/apex-tv/issues/new?template=bug-report.yml)
· [Share your TV test results](https://github.com/Pajuodelis/apex-tv/issues/new?template=compatibility.yml)

Do not attach passwords, account tokens, DRM challenges or licenses, TV
identifiers, private certificates or copyrighted video clips.
