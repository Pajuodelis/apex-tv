# Downloads

[← Back to Apex TV](README.md)

## Choose your download

| File | Use |
| --- | --- |
| [Apex-TV.wgt](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV.wgt) | Install the app on a Samsung Tizen television |
| [Apex-TV-source.zip](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV-source.zip) | Source packaged for the latest release |
| [Latest release](https://github.com/Pajuodelis/apex-tv/releases/latest) | Release notes, assets and SHA-256 checksums |

Use the separate [Apps2Samsung installer](https://github.com/Apps2Samsung/Apps2Samsung/releases/latest)
for Android, Windows, macOS or Linux. Select its custom WGT option and open
`Apex-TV.wgt`; it signs the package locally for your TV.

**Installation guides:** [English](INSTALL.md) · [Lietuviškai](INSTALL-LT.md).

The WGT is unsigned installer input. Copying it to USB does not install it
on a consumer Tizen TV. After installation, the app runs directly on the TV
with your own eligible F1 TV account.

## Verify your download

Download `SHA256SUMS` from the **same release** as the file you downloaded.
Compare its expected hash with the value returned by one of these commands.

**Windows PowerShell**

```powershell
Get-FileHash ./Apex-TV.wgt -Algorithm SHA256
```

**macOS**

```sh
shasum -a 256 Apex-TV.wgt
```

**Linux**

```sh
sha256sum Apex-TV.wgt
```

For the source archive, replace the filename with `Apex-TV-source.zip`.

## Developers

To work with the latest repository source, clone
[Pajuodelis/apex-tv](https://github.com/Pajuodelis/apex-tv) and follow the
[development guide](docs/DEVELOPMENT.md). Repository HEAD may include changes
that are not part of the latest packaged release.
