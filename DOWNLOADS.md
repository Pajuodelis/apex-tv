# Downloads

- **[Apex-TV.wgt — Samsung TV app](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV.wgt)**
- [Latest release and checksums](https://github.com/Pajuodelis/apex-tv/releases/latest)
- [Apex-TV-source.zip — open-source package](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV-source.zip)
- [English installation instructions](README.md#install--easiest-available-route)
- [Diegimas lietuviškai](INSTALL-LT.md)
- [Screenshots](README.md#screenshots)

Use the separate **[Apps2Samsung installer](https://github.com/Apps2Samsung/Apps2Samsung/releases/latest)**
from its official project for Android, Windows, macOS or Linux. Select the
custom WGT option and open **Apex-TV.wgt**. It signs the package locally for
your TV; Apex TV does not distribute private Samsung certificates.

The WGT is unsigned installer input. A USB copy alone cannot install it on a
consumer Tizen TV. After the first network installation, Apex TV runs on the
TV without a phone or computer. Sign in with your own eligible F1 TV account.

**Verify a download:** compare its SHA-256 with `SHA256SUMS` from the same
release. On Windows: `Get-FileHash .\Apex-TV.wgt -Algorithm SHA256`.
On Linux/macOS: `shasum -a 256 Apex-TV.wgt`.
