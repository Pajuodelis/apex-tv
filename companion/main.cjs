const { app, BrowserWindow, Menu, session, safeStorage, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const projectRoot = path.resolve(__dirname, '..');
const stateDir = process.env.APEX_STATE_DIR || path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Apex-TV-personal');
app.setPath('userData', path.join(stateDir, 'electron-profile'));
app.setPath('sessionData', path.join(stateDir, 'electron-profile'));
let loginWindow, dashboard, instance, busy = false;
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  if (!dashboard || dashboard.isDestroyed()) return;
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show(); dashboard.focus();
});
function formulaHost(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'formula1.com' || u.hostname.endsWith('.formula1.com')); } catch { return false; }
}
async function openLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return; }
  const loginSession = session.fromPartition('persist:apex-official-login');
  loginWindow = new BrowserWindow({ width: 1000, height: 780, title: 'Prisijunk prie oficialaus F1 TV',
    webPreferences: { session: loginSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  loginWindow.setMenuBarVisibility(false);
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (formulaHost(url)) { loginWindow.loadURL(url); }
    return { action: 'deny' };
  });
  loginWindow.webContents.on('will-navigate', (event, url) => { if (!formulaHost(url)) event.preventDefault(); });
  loginWindow.webContents.on('will-redirect', (event, url) => { if (!formulaHost(url)) event.preventDefault(); });
  const cookieChanged = async (_event, cookie, _cause, removed) => {
    if (removed || busy || cookie.name !== 'login-session' || !/^\.?([a-z0-9-]+\.)*formula1\.com$/i.test(cookie.domain)) return;
    let value, token;
    try { value = JSON.parse(decodeURIComponent(cookie.value)); token = value.data?.subscriptionToken || value.subscriptionToken; } catch { return; }
    if (!token) return;
    busy = true;
    try {
      await instance.client.signIn(token);
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      dashboard?.focus();
    } catch (error) {
      await dialog.showMessageBox(loginWindow || dashboard, { type: 'error', title: 'F1 prisijungimas', message: error.message || 'F1 prisijungimas nepavyko.' });
    } finally { busy = false; }
  };
  loginSession.cookies.on('changed', cookieChanged);
  loginWindow.on('closed', () => { loginSession.cookies.removeListener('changed', cookieChanged); loginWindow = null; });
  const cfg = instance.client.config;
  const url = (cfg?.authLinks?.login || 'https://account.formula1.com/#/{lang}/login?redirect=').replace('{lang}', 'en') + encodeURIComponent('https://f1tv.formula1.com');
  await loginWindow.loadURL(url); loginWindow.show(); loginWindow.focus();
}
if (primaryInstance) app.whenReady().then(async () => {
  const { setup } = await import(pathToFileURL(path.join(projectRoot, 'tools/setup.mjs')).href);
  const { F1Client } = await import(pathToFileURL(path.join(projectRoot, 'companion/f1.mjs')).href);
  const { createApp } = await import(pathToFileURL(path.join(projectRoot, 'companion/server.mjs')).href);
  const { recoverInstalledIdentity } = await import(pathToFileURL(path.join(projectRoot, 'companion/identity.mjs')).href);
  await recoverInstalledIdentity({ root: projectRoot, stateDirectory: stateDir,
    legacyDirectory: path.resolve(projectRoot, '../../work/apex-tv-runtime') });
  const setupData = await setup({ writeConnection: false, stateDirectory: stateDir });
  const sessionFile = path.join(stateDir, 'f1-session.encrypted');
  const vault = {
    async save(token) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows sesijos šifravimas nepasiekiamas.');
      const bytes = safeStorage.encryptString(token);
      const tmp = sessionFile + '.tmp'; await fs.writeFile(tmp, bytes, { mode: 0o600 }); await fs.rename(tmp, sessionFile);
    },
    async load() {
      try { return safeStorage.decryptString(await fs.readFile(sessionFile)); }
      catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    },
    async clear() { await fs.rm(sessionFile, { force: true }); }
  };
  const officialSession = session.fromPartition('persist:apex-official-login');
  const client = new F1Client({ vault, mediaFetcher: (url, options) => fetch(url, {
    ...options, credentials: 'omit',
    headers: { ...options.headers, 'User-Agent': officialSession.getUserAgent() }
  }), fetcher: (url, options) => officialSession.fetch(url, {
    ...options, credentials: ['f1tv.formula1.com','api.formula1.com','account.formula1.com'].includes(new URL(url).hostname) ? 'include' : 'omit',
    headers: { ...options.headers, 'User-Agent': officialSession.getUserAgent() }
  }) });
  instance = await createApp({ setupData, client, actions: { login: openLogin, logout: () => session.fromPartition('persist:apex-official-login').clearStorageData(),
    restart: () => { app.relaunch(); setTimeout(() => app.quit(), 400); } } });
  await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(setupData.config.port, '0.0.0.0', resolve); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Apex TV', submenu: [
    { label: 'Prisijungti prie F1 TV', click: () => openLogin().catch(() => {}) },
    { role: 'quit', label: 'Uždaryti programėlę' }
  ] }]));
  dashboard = new BrowserWindow({ width: 1080, height: 820, title: 'Apex TV — valdymas kompiuteryje',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const adminOrigin = 'http://127.0.0.1:' + setupData.config.port;
  dashboard.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dashboard.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(adminOrigin + '/')) event.preventDefault(); });
  await dashboard.loadURL(adminOrigin + '/'); dashboard.show(); dashboard.focus();
  client.initialize().catch(() => { client.error = 'F1 serveris neatsakė. Bandyk prisijungti dar kartą.'; });
}).catch(async (error) => {
  console.error('Apex TV startup:', String(error.stack || error.message || error));
  await dialog.showMessageBox({ type: 'error', title: 'Apex TV', message: error.code === 'EADDRINUSE' ? 'Apex TV jau paleista arba 8317 prievadas užimtas.' : error.message });
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { instance?.server.close(); });
