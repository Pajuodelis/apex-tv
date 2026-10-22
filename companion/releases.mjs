import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { lowerJS, lowerCSS } from '../tools/legacy.mjs';
export class Releases {
  constructor(root, privateKey, { lower = true } = {}) { this.root = root; this.privateKey = privateKey; this.lower = lower; this.releases = new Map(); this.current = null; }
  async publish() {
    const names = ['tv-app.js', 'tv.css'];
    const content = await Promise.all(names.map(name => fs.readFile(path.join(this.root, 'web', name))));
    // The player is covered by the same pinned signature and SRI as the menu.
    const player = await fs.readFile(path.join(this.root, 'web/vendor/dash.all-4.7.4.min.js'));
    const tvClient = await fs.readFile(path.join(this.root, 'web/f1-browser.js'));
    const audioCompat = await fs.readFile(path.join(this.root, 'web/cbcs-audio.js'));
    const elementary = await fs.readFile(path.join(this.root, 'web/emss-player.js'));
    const nativeRelay = await fs.readFile(path.join(this.root, 'web/native-relay.js'));
    const dashManifest = await fs.readFile(path.join(this.root, 'web/dash-manifest.js'));
    const tvMedia = await fs.readFile(path.join(this.root, 'web/tv-media.js'));
    const experience = await fs.readFile(path.join(this.root, 'web/experience.js'));
    const viewOptions = await fs.readFile(path.join(this.root, 'web/view-options.js'));
    const qrCode=await fs.readFile(path.join(this.root,'web/vendor/qrcode.js'));
    const runtime=this.lower?await fs.readFile(path.join(this.root,'tv/legacy-polyfills.js')):Buffer.alloc(0);
    const setupChecks=await fs.readFile(path.join(this.root,'web/setup-checks.js'));
    const enhancements=await Promise.all(['i18n.js','timeline.js','ui-performance.js','discovery.js','editorial.js','playback-health.js','favorite-driver.js','online-updates.js'].map(name=>fs.readFile(path.join(this.root,'web',name))));
    const videoQuality = await fs.readFile(path.join(this.root, 'web/video-quality.js'));
    content[0] = Buffer.concat([...(this.lower?[runtime,Buffer.from('\n;\n')]:[]),qrCode,Buffer.from("\n;\n"),setupChecks,Buffer.from("\n;\n"),...enhancements.flatMap(bytes=>[bytes,Buffer.from('\n;\n')]),videoQuality, Buffer.from('\n;\n'), experience, Buffer.from('\n;\n'), viewOptions, Buffer.from('\n;\n'), player, Buffer.from('\n;\n'), tvClient, Buffer.from('\n;\n'), audioCompat, Buffer.from('\n;\n'), elementary, Buffer.from('\n;\n'), nativeRelay, Buffer.from('\n;\n'), dashManifest, Buffer.from('\n;\n'), tvMedia, Buffer.from('\n;\n'), content[0]]);
    // Tizen 5.5 / Chromium 63: lower the assembled menu and stylesheet to ES2017 before hashing and signing.
    if (this.lower) { content[0] = await lowerJS(content[0], 'tv-app.js'); content[1] = await lowerCSS(content[1], 'tv.css'); }
    const revision = crypto.createHash('sha256').update(Buffer.concat(content)).digest('hex').slice(0, 24);
    if (this.current?.revision === revision) return this.current;
    const files = names.map((name, i) => ({ name, path: '/release/' + revision + '/' + name,
      integrity: 'sha256-' + crypto.createHash('sha256').update(content[i]).digest('base64') }));
    const payload = Buffer.from(JSON.stringify({ revision, version: '0.5.11', shell: 1, builtAt: Date.now(), files }), 'utf8').toString('base64');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(payload, 'base64'), this.privateKey).toString('base64');
    const release = { revision, manifest: { payload, signature }, files: new Map(names.map((name, i) => [name, content[i]])) };
    this.releases.set(revision, release); this.current = release;
    while (this.releases.size > 8) this.releases.delete(this.releases.keys().next().value);
    return release;
  }
  get(revision, name) { return this.releases.get(revision)?.files.get(name); }
}
