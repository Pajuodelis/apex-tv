# Kaip įsirašyti Apex TV

Reikia Samsung televizoriaus su Tizen 6.0 arba naujesne versija, interneto,
savo F1 TV prenumeratos ir vienam įrašymui Android telefono arba kompiuterio.
Telefonas / kompiuteris turi būti tame pačiame tinkle kaip televizorius.

## 1. Atsisiųsk du failus

- [Apex-TV.wgt](https://github.com/Pajuodelis/apex-tv/releases/latest/download/Apex-TV.wgt)
- [Apps2Samsung diegimo programa](https://github.com/Apps2Samsung/Apps2Samsung/releases/latest)

Android telefonui rinkis `-android.apk`. Windows kompiuteriui – `win-x64.msi`
arba nešiojamą `win-x64.zip`. Mac ir Linux versijos yra tame pačiame puslapyje.
Apps2Samsung yra atskiras bendruomenės projektas, diegiantis Tizen programėles.

## 2. Vieną kartą įjunk TV kūrėjo režimą

Atverk Apps2Samsung, surask televizorių ir pasižymėk rodomą vietinį telefono
arba kompiuterio IP adresą.

TV pulteliu: **Home → Apps → 12345**. Jei pultelyje nėra skaitmenų,
spausk **123** ir surink juos ekrane. Atsidariusiame lange:

- **Developer Mode: ON**;
- **Host PC IP**: įrašyk diegimui naudojamo telefono / kompiuterio IP;
- patvirtink ir pilnai perkrauk televizorių.

## 3. Įrašyk

Apps2Samsung pasirink savo TV. Android versijoje programėlių pasirinkime
rinkis **Custom WGT / TPK…**, tada parsisiųstą **Apex-TV.wgt** ir **Install**.
Kompiuterio versijoje naudok pasirinktinio `.wgt` failo įrašymą.

Jei diegimo programa paprašys, prisijunk savo Samsung paskyra. Ji pasirūpins
TV sertifikatu. Sertifikato ir paskyrų slaptažodžių niekam siųsti nereikia.

## 4. Prisijunk televizoriuje

Paleisk **Apex TV**, pasirink prisijungimą ir televizoriuje įvesk savo F1 TV
paskyros duomenis. Apps2Samsung nereikia duoti F1 slaptažodžio.
Viešas paketas pradeda anglų kalba. Lietuvių kalbą pasirink programėlėje:
**Settings → App language → Lietuvių**. Pasirinkimas išsaugomas televizoriuje.
Meniu kalba ir lenktynių komentavimo kalba pasirenkamos atskirai.

Kai programėlė įrašyta, telefoną ir kompiuterį galima išjungti. Vaizdą ir
licenciją gauna pats TV. Tavo prenumerata turi suteikti teisę pasirinktam
įrašui ar tiesioginei transliacijai tavo regione.

## 5. Pridėk prie Home

TV: **Home → Apps → nustatymai → Apex TV → Add to Home / Pridėti prie pradžios
ekrano**. Jei ikonos iškart nėra, paleisk programėlę iš diegimo programos,
grįžk į Apps ir dar kartą patikrink įdiegtų programėlių juostą.

## Atnaujinimai

Meniu ir grotuvo pataisymai ateina tiesiai iš GitHub ir tikrinami skaitmeniniu
parašu. Kompiuterio jiems nereikia. Jei keičiasi įdiegtas TV apvalkalas ar jo
leidimai, naują `.wgt` reikės įrašyti tuo pačiu diegimo įrankiu / sertifikatu.
Išsaugok Apps2Samsung sertifikatų kopiją savo įrenginyje.

## USB ir dažnos klaidos

USB įrašymas paprastame Samsung Tizen TV nebepalaikomas. Vien nukopijuoti
`.wgt` į atmintinę neužtenka.
[Samsung dokumentacija](https://developer.samsung.com/smarttv/develop/tools/additional-tools/vscode/connecting-to-tv-device.html)

- **TV nerastas:** tas pats tinklas, teisingas Host PC IP, Developer Mode ON
  ir pilnas TV perkrovimas. Patikrink Apps2Samsung rodomą ryšio diagnozę.
- **Author certificate not match:** TV jau įrašyta programėlė kitu autoriaus
  sertifikatu. Naudok pirminį sertifikatą; šalinimas ir naujas įrašymas gali
  ištrinti programėlės prisijungimą ir nustatymus.
- **F1 403:** patikrink savo prisijungimą, prenumeratą, regioną ir kitus
  naudojamus ekranus. Programėlė šių F1 ribojimų neapeina.

Šis bendruomenės leidimas patikrintas Samsung UE55AU7092 / Tizen 6.0.
Kiti TV ir naujasis diegimas per Apps2Samsung dar laukia vartotojų bandymų.
