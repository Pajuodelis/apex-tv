# Apex TV em Tizen 5.0 / 5.5 (TVs Samsung 2019–2020)

Esta versão adapta o Apex TV para televisores sem Tizen 6. Segundo a Samsung,
o **Tizen 5.0 (2019)** usa **Chromium 63** e o **Tizen 5.5 (2020)** usa **Chromium 69**.
O build mira em `chrome63`, o menor dos dois, e por isso o mesmo `.wgt` serve para ambos.

[English](TIZEN-5.md)

## Dispositivo verificado

| Campo | Valor |
| --- | --- |
| Modelo | Samsung **UN43TU7000GXZD** (2020, Brasil) |
| Firmware | T-KTSU2UABC-2743.0 |
| Tizen | 5.5 |
| Apex TV | 0.5.11, revisão do menu `68dbb7b529dfd073f2c2f032` |
| Resultado | `f1-playback-confirmed`: imagem e som confirmados no teste básico e no teste com conteúdo F1; atalho na Home confirmado |
| Player | **AVPlay nativo + Widevine**, abrindo o DASH da F1 direto (o player de compatibilidade não foi necessário) |
| Não verificado | Registro da licença F1 comum e renovação da licença DRM numa transmissão ao vivo longa (por exemplo, um GP inteiro) |

O Tizen 5.0 (2019) ainda não foi testado em uma TV real.

## O que foi alterado

| Área | Alteração |
| --- | --- |
| Transpilação | `tools/legacy.mjs` passa o `tv-app.js` montado e o `tv.css` pelo **esbuild** com `target: chrome63` antes da assinatura. Remove `?.`, `??`, `catch {}` sem parâmetro, campos de classe, `inset` etc. |
| Código-fonte | `web/f1-browser.js`: `catch {` → `catch (_unused) {` (era o erro de sintaxe que causava a tela preta). |
| Polyfills | `tv/legacy-polyfills.js`, carregado no `index.html` antes do `boot.js`: `globalThis`, `String.prototype.matchAll/replaceAll/trimStart/trimEnd/at`, `Array.prototype.flat/flatMap/at`, `Object.fromEntries/hasOwn`, `Promise.prototype.finally`, `Promise.allSettled`, `queueMicrotask`, `AbortController`/`AbortSignal` (+ `fetch` que respeita `signal`) e `AbortSignal.timeout`. Cada polyfill só entra quando a API nativa não existe. `fetch` e `Promise` já são nativos no Chromium 63. |
| CSS | `gap` em flexbox só existe a partir do Chromium 84. O polyfill marca `<html class="no-flexgap">` e o `tv.css` usa margens nesse caso. A grade de compatibilidade ganhou `grid-gap`. |
| Player (AVPlay) | O relay local (`tizentvwasm` Sockets + `BigInt`) só existe no Tizen 6+. No Tizen 5.x o app abre o DASH da F1 direto no `webapis.avplay`, com Widevine via `setDrm('WIDEVINE_CDM', 'SetProperties', …)` e licença em `ondrmevent → Challenge → setDrm(…, 'widevine_license_data', …)`. Se a reprodução falhar, a tela de erro mostra **Try compatibility player** (dash.js + MSE/EME, com a correção de áudio CBCS). A escolha fica salva em `localStorage['apex-legacy-engine']`, e o mesmo botão permite voltar ao AVPlay. |
| Verificações | `setup-checks.js` aceita Tizen 5.x. Novo `tools/check-legacy.mjs` reprova o `.wgt` se algum script não for compatível com Chromium 63. |
| config.xml | `required_version="5.0"` (instala em 5.0 e 5.5). Privilégios: `internet`, `tv.inputdevice`, `drmplay`, `productinfo`. O AVPlay não exige privilégio próprio. |
| Atualizações | Continuam ativadas por padrão. Como o `Releases.publish()` transpila o menu antes de assinar, as atualizações online também chegam compatíveis com o Tizen 5.x. Um fork pode usar `"onlineUpdates": false` em `tv/connection.js` para distribuir um menu congelado. |

## Empacotar o `.wgt` (Windows)

1. Instale o **Node.js 22 LTS** (https://nodejs.org).
2. Abra o PowerShell na pasta do projeto:
   ```powershell
   npm ci --ignore-scripts
   ```
   `--ignore-scripts` evita baixar o Electron, que só serve para o companion opcional.
3. (Opcional) Rode os testes:
   ```powershell
   npm test
   ```
4. Gere e valide o pacote:
   ```powershell
   npm run build:tv
   ```
   Saída esperada:
   `Tizen 5.x compatibility check passed: 6 scripts parse as Chromium 63 JavaScript; required_version=5.0.`
   O arquivo fica em `dist\Apex-TV.wgt`, com o hash em `dist\SHA256SUMS`.

O `.wgt` sai **sem assinatura**, de propósito. O Apps2Samsung assina o pacote
localmente com o seu certificado Samsung no momento da instalação.

## Instalar via Apps2Samsung

1. Baixe o Apps2Samsung para Windows: https://github.com/Apps2Samsung/Apps2Samsung/releases/latest
2. Descubra o IP local do PC (`ipconfig` → "Endereço IPv4").
3. Na TV: **Home → Apps**, digite **12345** no controle → **Developer Mode: ON** →
   **Host PC IP** = IP do PC → confirme e **reinicie totalmente a TV** (tire da tomada por 30 s).
4. No Apps2Samsung, selecione a TV na mesma rede e escolha a opção de **WGT personalizado**.
   Aponte para `dist\Apex-TV.wgt` e clique em **Install**.
5. Se o instalador pedir, entre na conta Samsung para gerar o certificado.
   **Guarde o certificado gerado**: atualizações futuras precisam ser assinadas com o mesmo autor.
6. Abra o Apex TV na TV e entre com a sua conta F1 TV.

## Se o vídeo não abrir

- Abra **Settings → Compatibility check**. Ele mostra modelo, versão do Tizen e o motor do player.
- Com o AVPlay direto, falhas típicas aparecem como `TV DRM licencijos klaida` ou como `player_error_detail`.
  Na tela de erro, pressione **Try compatibility player** para tentar o dash.js + EME. Para voltar, use **Try Samsung AVPlay**.
- Como alternativa, rode o companion no PC (`docs/DEVELOPMENT.md`). Ele faz o relay criptografado pelo PC,
  o mesmo caminho que o Tizen 6 faz dentro da TV.

## Limites conhecidos

- Falta confirmar uma transmissão ao vivo longa, porque é nela que acontece a renovação da licença DRM.
  Se o vídeo cair depois de 30 a 60 minutos com erro de DRM, a causa provável é essa.
- O AVPlay direto não recebe as correções de horário e de áudio CBCS que o relay faz no Tizen 6.
  No UN43TU7000 elas não foram necessárias; em outros modelos, use o player de compatibilidade se a imagem ou o som falharem.
- O Chromium 63 não tem `focus({preventScroll})`. O foco funciona, mas a rolagem pode "pular" um pouco ao navegar.
