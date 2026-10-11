import Discovery from '../web/discovery.js';
import crypto from 'node:crypto';
const ORIGIN = 'https://f1tv.formula1.com';
const AGENT = 'ApexTV-PersonalPrototype/0.1';
export class ServiceError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function approvedUrl(raw, license = false) {
  let url;
  try { url = new URL(raw); } catch { throw new ServiceError('F1 grąžino netinkamą vaizdo adresą.'); }
  const host = url.hostname.toLowerCase();
  const own = host === 'formula1.com' || host.endsWith('.formula1.com');
  // Exact service-supplied media CDN authorised by this TV's owner.
  // Account and licence endpoints retain their Formula 1 origin restriction.
  const mediaCdn = !license && host === 'f1prodlive.akamaized.net';
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !(own || mediaCdn)) {
    throw new ServiceError('F1 grąžino neatpažintą srauto arba licencijos serverį.');
  }
  return url.href;
}
export function playbackCookie(headers, manifestUrl, licenseUrl) {
  const source = new URL(approvedUrl(manifestUrl)), target = new URL(approvedUrl(licenseUrl, true));
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  for (const cookie of cookies) {
    const parts = String(cookie).split(';'), pair = parts.shift().trim();
    const match = pair.match(/^playToken=([\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,4096})$/);
    if (!match) continue;
    const attributes = new Map(parts.map(part => {
      const index = part.indexOf('=');
      return [part.slice(0, index < 0 ? part.length : index).trim().toLowerCase(), index < 0 ? '' : part.slice(index + 1).trim()];
    }));
    const domain = (attributes.get('domain') || source.hostname).replace(/^\./, '').toLowerCase();
    const belongs = host => host === domain || (attributes.has('domain') && host.endsWith('.' + domain));
    if (!(domain === 'formula1.com' || domain.endsWith('.formula1.com')) || !belongs(source.hostname) || !belongs(target.hostname)) continue;
    const cookiePath = attributes.get('path') || source.pathname.slice(0, source.pathname.lastIndexOf('/') + 1);
    if (!target.pathname.startsWith(cookiePath) || (cookiePath !== '/' && !cookiePath.endsWith('/') && target.pathname[cookiePath.length] && target.pathname[cookiePath.length] !== '/')) continue;
    if (attributes.has('max-age') && Number(attributes.get('max-age')) <= 0) continue;
    if (attributes.has('expires') && Date.parse(attributes.get('expires')) <= Date.now()) continue;
    return 'playToken=' + match[1];
  }
  return '';
}
export function normalizeItems(data) { return Discovery.normalize(data); }
export function parsePlayback(data) {
  const result = data.resultObj;
  if (data.resultCode !== 'OK' || !result) throw new ServiceError('F1 neleidžia atkurti šio turinio. Patikrink prenumeratą ir regioną.', 403);
  const candidates = Array.isArray(result) ? result : [result, ...(result.streams || [])];
  const stream = candidates.find(s => /DASH/i.test(s.streamType || '') && /widevine|WV/i.test(s.drmType || s.streamType || '')) || candidates.find(s => s.url || s.manifestUrl);
  if (!stream) throw new ServiceError('F1 nepateikė vaizdo srauto.');
  const drm = String(stream.drmType || (/WV/i.test(stream.streamType || '') ? 'widevine' : '')).toLowerCase();
  if (drm && drm !== 'widevine') throw new ServiceError('Šiam turiniui F1 pateikė kitą DRM formatą. Šis prototipas jo dar nepalaiko.', 422);
  const manifestUrl = approvedUrl(stream.url || stream.manifestUrl);
  const rawLicense = stream.laURL || stream.laUrl || stream.licenseUrl;
  // Never invent a license URL or silently remove DRM when the service omits it.
  if (drm && !rawLicense) throw new ServiceError('F1 nepateikė licencijos adreso. Reikia patikrinti šio srauto API atsakymą.', 422);
  return { manifestUrl, licenseUrl: rawLicense ? approvedUrl(rawLicense, true) : '',
    drm, drmToken: stream.drmToken || '', entitlementToken: stream.entitlementToken || '', streamType: stream.streamType || '' };
}
export class F1Client {
  constructor({ fetcher = fetch, mediaFetcher, vault } = {}) {
    this.fetcher = fetcher; this.mediaFetcher = mediaFetcher; this.vault = vault; this.token = ''; this.entitlement = '';
    this.location = null; this.config = null; this.expires = 0; this.error = '';
  }
  async request(url, options = {}, media = false) {
    let response;
    try {
      response = await (media && this.mediaFetcher ? this.mediaFetcher : this.fetcher)(url, { ...options, redirect: media ? 'manual' : 'error',
        headers: { 'User-Agent': AGENT, ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      const networkCode = String(error?.message || '').match(/\b(ERR_[A-Z_]+)\b/)?.[1];
      const code = String(networkCode || error?.cause?.code || error?.code || error?.name || 'request_failed').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      this.transportInfo = { host: new URL(url).hostname, code };
      throw new ServiceError('Nepavyko pasiekti F1 serverio.' + (/^ERR_[A-Z_]+$/.test(code) ? ' ' + code : ''));
    }
    if (media && response.status >= 300 && response.status < 400) return response;
    if (!response.ok) {
      const error = new ServiceError('F1 užklausa atmesta (HTTP ' + response.status + ').', response.status === 401 || response.status === 403 ? 403 : 502);
      error.upstreamStatus = response.status; error.upstreamType = (response.headers.get('content-type') || '').split(';')[0];
      throw error;
    }
    return response;
  }
  async mediaManifest(raw, accept = 'application/dash+xml, application/xml') {
    let url = approvedUrl(raw);
    const permittedRedirectHosts = new Set([new URL(url).hostname, 'ott-video-cf.formula1.com', 'ott-video-fer-cf.formula1.com', 'f1prodlive.akamaized.net']);
    for (let hop = 0; hop <= 2; hop++) {
      // Media-only redirects: no account headers, no licence POST redirects.
      const response = await this.request(url, { headers: {
        Origin: ORIGIN, Referer: ORIGIN + '/', Accept: accept
      } }, true);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop === 2) throw new ServiceError('F1 srauto nukreipimas netinkamas.');
        const next = approvedUrl(new URL(location, url).href);
        if (!permittedRedirectHosts.has(new URL(next).hostname)) throw new ServiceError('F1 srautas nukreipė į neleistą serverį.');
        url = next; continue;
      }
      return { response, url };
    }
    throw new ServiceError('F1 srauto nukreipimas netinkamas.');
  }
  async resolvePlayerManifest(stream, contentId, channelId = '') {
    const source = new URL(stream.manifestUrl);
    if (!/\/TMEMANIFEST\//.test(source.pathname)) return;
    // The official F1 Tiledmedia integration supplies entitlementToken with its
    // initial configuration request. Media URLs remain credential-free.
    if (source.hostname !== 'f1tv.formula1.com') throw new ServiceError('F1 grotuvo aprašo serveris netinkamas.', 422);
    const response = await this.request(source.href, { headers: {
      ...this.headers(), entitlementtoken: stream.entitlementToken || this.entitlement,
      Accept: 'application/json', Origin: ORIGIN, Referer: ORIGIN + '/'
    } });
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new ServiceError('F1 grotuvo aprašas per didelis.', 422);
    let config; try { config = JSON.parse(text); } catch { throw new ServiceError('F1 grotuvo aprašas neatpažintas.', 422); }
    if (String(config.metadata?.content_id) !== String(contentId) || !Array.isArray(config.feeds) || config.feeds.length > 64) throw new ServiceError('F1 grotuvo turinys nesutampa.', 422);
    const selected = channelId ? config.feeds.find(feed => String(feed.metadata?.channel_id) === channelId) : config.feeds[0];
    if (!selected || typeof selected.url !== 'string') throw new ServiceError('F1 nepateikė pasirinkto kanalo srauto.', 422);
    const mediaUrl = approvedUrl(selected.url);
    if (/\/TMEMANIFEST\//.test(new URL(mediaUrl).pathname)) throw new ServiceError('F1 grotuvo aprašas nukreipė į kitą konfigūraciją.', 422);
    stream.playCookie = stream.drm ? playbackCookie(response.headers, source.href, stream.licenseUrl) : '';
    stream.manifestUrl = mediaUrl;
    this.tiledManifestInfo = { contentId: String(contentId), channelId: String(selected.metadata?.channel_id || ''), feeds: config.feeds.length, host: new URL(mediaUrl).hostname, status: response.status };
  }
  async json(url, headers = {}) {
    const response = await this.request(url, { headers });
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw new ServiceError('F1 atsakymas per didelis.');
    let data;
    try { data = JSON.parse(text); } catch { throw new ServiceError('F1 pateikė neatpažintą atsakymą.'); }
    if (data.resultCode && data.resultCode !== 'OK') throw new ServiceError('F1 atmetė užklausą. Patikrink paskyros prieigą.', 403);
    return data;
  }
  async verifyToken(token) {
    if (typeof token !== 'string' || token.length > 32000) throw new ServiceError('Netinkama prisijungimo sesija.', 400);
    const parts = token.split('.');
    if (parts.length !== 3) throw new ServiceError('Netinkama prisijungimo sesija.', 400);
    let header, payload;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); payload = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { throw new ServiceError('Netinkama prisijungimo sesija.', 400); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000 || (payload.nbf && payload.nbf > Date.now() / 1000)) throw new ServiceError('Prisijungimo sesija negalioja arba pasibaigė.', 401);
    const jwks = await this.json('https://api.formula1.com/static/jwks.json');
    const jwk = (jwks.keys || []).find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk || !crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new ServiceError('F1 prisijungimo parašas netinkamas.', 401);
    return payload;
  }
  async signIn(token, persist = true) {
    const payload = await this.verifyToken(token);
    const entitlement = await this.json(ORIGIN + '/2.0/R/ENG/WEB_DASH/ALL/USER/ENTITLEMENT', { ascendontoken: token });
    const ent = entitlement.resultObj?.entitlementToken;
    if (!ent) throw new ServiceError('F1 nepateikė paskyros prieigos.', 403);
    const location = await this.json(ORIGIN + '/1.0/R/ENG/WEB_DASH/ALL/USER/LOCATION', { entitlementtoken: ent, ascendontoken: token });
    if (!location.resultObj?.userLocation?.[0]) throw new ServiceError('F1 nepateikė paskyros regiono.');
    if (persist && this.vault) await this.vault.save(token);
    this.token = token; this.entitlement = ent; this.location = location.resultObj.userLocation[0];
    this.expires = payload.exp; this.error = '';
  }
  status() { return { signedIn: Boolean(this.token) && this.expires > Date.now() / 1000,
    expires: this.expires, country: this.location?.detectedCountryIsoCode || '', error: this.error }; }
  async signOut() { this.token = ''; this.entitlement = ''; this.location = null; this.expires = 0; if (this.vault) await this.vault.clear(); }
  async initialize() {
    this.config = await this.json(ORIGIN + '/config');
    if (this.vault) {
      try { const saved = await this.vault.load(); if (saved) await this.signIn(saved, false); }
      catch { this.error = 'Išsaugota F1 sesija nebegalioja. Prisijunk iš naujo.'; }
    }
  }
  async context(required = false) {
    if (required && !this.status().signedIn) throw new ServiceError('Prisijunk prie F1 TV kompiuteryje.', 401);
    if (!this.location) {
      const data = await this.json(ORIGIN + '/1.0/A/ENG/WEB_DASH/ALL/USER/LOCATION');
      this.location = data.resultObj?.userLocation?.[0];
    }
    if (!this.location) throw new ServiceError('F1 nepateikė regiono.');
    return { login: this.status().signedIn ? 'R' : 'A',
      tail: encodeURIComponent(this.location.entitlement) + '/' + Number(this.location.groupId) };
  }
  headers() { return this.status().signedIn ? { ascendontoken: this.token, entitlementtoken: this.entitlement } : {}; }
  async page(pageId) {
    if (!/^\d{1,12}$/.test(String(pageId))) throw new ServiceError('Netinkamas katalogo numeris.', 400);
    const ctx = await this.context();
    const items = normalizeItems(await this.json(ORIGIN + '/2.0/' + ctx.login + '/ENG/WEB_DASH/ALL/PAGE/' + pageId + '/' + ctx.tail, this.headers())).filter(item => item.kind !== 'page' || item.id !== String(pageId));
    // F1's archive root currently omits 2026. Verify the service's season page before adding it.
    if (String(pageId) === '493' && !items.some(item => /2026/.test(item.title))) {
      try {
        const latest = normalizeItems(await this.json(ORIGIN + '/2.0/' + ctx.login + '/ENG/WEB_DASH/ALL/PAGE/12343/' + ctx.tail, this.headers()));
        if (latest.some(item => /2026/.test(item.title))) items.unshift({ id: '12343', title: '2026 Season', kind: 'page', subtitle: '', duration: 0, live: false });
      } catch {}
    }
    return items;
  }
  async detail(contentId) {
    if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError('Netinkamas turinio numeris.', 400);
    const ctx = await this.context();
    return normalizeItems(await this.json(ORIGIN + '/4.0/' + ctx.login + '/ENG/WEB_DASH/ALL/CONTENT/VIDEO/' + contentId + '/' + ctx.tail, this.headers())).filter(item => item.id !== String(contentId));
  }
  async channels(contentId) {
    if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError('Netinkamas turinio numeris.', 400);
    const ctx = await this.context(true);
    const data = await this.json(ORIGIN + '/4.0/' + ctx.login + '/ENG/WEB_DASH/ALL/CONTENT/VIDEO/' + contentId + '/' + ctx.tail, this.headers());
    const channels = [], seen = new Set(); let title = '', duration = 0;
    function walk(node, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) { for (const child of node.slice(0, 100)) walk(child, depth + 1); return; }
      const meta = node.metadata;
      if (meta && (!meta.contentId || String(meta.contentId) === String(contentId))) {
        if (!title) { title = String(meta.title || '').slice(0, 160); duration = Number(meta.duration || 0); }
        for (const stream of (Array.isArray(meta.additionalStreams) ? meta.additionalStreams : []).slice(0, 64)) {
          const id = String(stream.channelId || '');
          if (!/^\d{1,12}$/.test(id) || seen.has(id)) continue;
          seen.add(id); channels.push({ id, title: String(stream.title || stream.reportingName || '').slice(0, 120), type: String(stream.type || '').slice(0, 60), default: stream.default === true });
        }
      }
      for (const key of ['resultObj', 'containers', 'items']) walk(node[key], depth + 1);
    }
    walk(data);
    return { contentId: String(contentId), title, duration, channels };
  }
  async validateChannel(contentId, channelId) {
    if (channelId === undefined || channelId === '') return '';
    const id = String(channelId);
    if (!/^\d{1,12}$/.test(id)) throw new ServiceError('Netinkamas F1 kanalo numeris.', 400);
    const available = await this.channels(contentId);
    if (!available.channels.some(channel => channel.id === id)) throw new ServiceError('F1 nepateikė šio kanalo pasirinktam įrašui.', 403);
    return id;
  }
  async live() {
    const ctx = await this.context();
    return normalizeItems(await this.json(ORIGIN + '/1.0/' + ctx.login + '/ENG/WEB_DASH/ALL/EVENTS/LIVENOW/' + ctx.tail, this.headers())).map(item => ({ ...item, live: true }));
  }
  async playback(contentId, platform = 'WEB_HLS', player = 'player_bm', channelId = '') {
    if (!['player_bm', 'player_tm', 'legacy-default'].includes(player)) throw new ServiceError('Netinkamas F1 grotuvo variantas.', 400);
    if (!['WEB_HLS', 'WEB_DASH', 'BIG_SCREEN_DASH'].includes(platform)) throw new ServiceError('Netinkamas F1 atkūrimo profilis.', 400);
    if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError('Netinkamas turinio numeris.', 400);
    await this.context(true);
    const selectedChannel = await this.validateChannel(contentId, channelId);
    const version = platform === 'WEB_HLS' ? this.config?.apiConfig?.playAPIVersion || '3.0' : '2.0';
    if (!/^\d+\.0$/.test(version)) throw new ServiceError('F1 pakeitė vaizdo API versiją.');
    // F1's current official web bundle apiPathPolicy uses WEB_HLS for CONTENT/PLAY,
    // while catalogue requests still use WEB_DASH. Consume only the supplied Widevine stream.
    const resolve = apiVersion => this.json(ORIGIN + '/' + apiVersion + '/R/ENG/' + platform + '/ALL/CONTENT/PLAY?contentId=' + contentId + (player !== 'legacy-default' ? '&player=' + player : '') + (selectedChannel ? '&channelId=' + selectedChannel : ''), this.headers());
    let data;
    try { data = await resolve(version); }
    catch (error) {
      // The service's existing 2.0 endpoint still validates the same subscription and DRM.
      // Do not retry an access denial or change the requested content/platform.
      if (version !== '3.0' || !(error.upstreamStatus >= 500)) throw error;
      data = await resolve('2.0');
    }
    const result=data.resultObj;
    const candidates=Array.isArray(result)?result:result?[result,...(result.streams||[])]:[];
    const host=url=>{try{return new URL(url).hostname;}catch{return '';}};
    this.playbackInfo={contentId:String(contentId),platform,player,channelId:selectedChannel,candidates:candidates.map(stream=>({
      keys:Object.keys(stream),manifestHost:host(stream.url||stream.manifestUrl),
      manifestRoute: (()=>{try{return new URL(stream.url||stream.manifestUrl).pathname.split('/').slice(0,12).map(part=>/^(?:\d+\.0|[A-Z_]+|)$/.test(part)?part:'[value]').join('/');}catch{return '';}})(),
      manifestQueryKeys: (()=>{try{return [...new URL(stream.url||stream.manifestUrl).searchParams.keys()];}catch{return [];}})(),
      licenceHost:host(stream.laURL||stream.laUrl||stream.licenseUrl),drmType:stream.drmType||'',
      streamType:stream.streamType||'',pipelineVersion:stream.pipelineVersion||'',playApiVersion:stream.playApiVersion||'',hasLicence:Boolean(stream.laURL||stream.laUrl||stream.licenseUrl)
    }))};
    const stream = parsePlayback(data);
    this.playbackInfo.hasDrmToken = Boolean(stream.drmToken);
    this.playbackInfo.streamEntitlementMatchesAccount = stream.entitlementToken === this.entitlement;
    this.playbackInfo.licenceQueryKeys = stream.licenseUrl ? [...new URL(stream.licenseUrl).searchParams.keys()] : [];
    if (stream.licenseUrl) {
      const route = new URL(stream.licenseUrl).pathname;
      this.playbackInfo.licenceRoute = /^(\/AGL)?\/\d+\.\d+\/[RA]\/[A-Z]{3}\/[A-Z_]+\/[A-Z]+\/CONTENT\/LA(?:\/(?:widevine|fairplay|playready))?$/i.test(route) ? route : 'unrecognised path';
    }
    {
      // Read the service-supplied MPD for both protected and ordinary catalogue recordings.
      // A different recording never changes or removes the original recording's DRM.
      // Account tokens are never sent to the media CDN and this cookie stays on the PC.
      await this.resolvePlayerManifest(stream, contentId, selectedChannel);
      const fetched = await this.mediaManifest(stream.manifestUrl);
      const response = fetched.response; stream.manifestUrl = fetched.url;
      stream.playCookie = stream.drm ? playbackCookie(response.headers, stream.manifestUrl, stream.licenseUrl) || stream.playCookie || '' : '';
      const mpd = await response.text();
      if (mpd.length > 2 * 1024 * 1024 || !/<MPD[\s\/>]/i.test(mpd)) throw new ServiceError('F1 nepateikė tinkamo vaizdo aprašo.');
      stream.manifestXML = mpd;
      const codecs = [...mpd.matchAll(/\bcodecs=["']([^"']+)["']/gi)].map(match => match[1]);
      const protection = [...mpd.matchAll(/<ContentProtection[^>]*\bvalue=["']([^"']+)["']/gi)].map(match => match[1]);
      const baseUrls = [...mpd.matchAll(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/gi)].slice(0, 12).map(match => {
        try { const url = new URL(match[1].trim().replace(/&amp;/g,'&'),stream.manifestUrl);return {host:url.hostname,queryKeys:[...url.searchParams.keys()],relative:!/^https:\/\//i.test(match[1])}; } catch { return {invalid:true}; }
      });
      if (!stream.drm && /<ContentProtection\b/i.test(mpd)) throw new ServiceError('F1 nepateikė apsaugoto srauto licencijos duomenų.', 422);
      stream.protection = [...new Set(protection)]; stream.platform = platform;
      this.playbackInfo.manifest = { host: new URL(stream.manifestUrl).hostname, status: response.status, type: response.headers.get('content-type') || '', hasPlaybackCookie: Boolean(stream.playCookie), codecs:[...new Set(codecs)], protection:[...new Set(protection)],baseUrls };
    }
    return stream;
  }
  async inspectLegacyDash(contentId, platform = 'WEB_DASH', player = 'player_bm', channelId = '') {
    if (!['player_bm', 'player_tm', 'legacy-default'].includes(player)) throw new ServiceError('Netinkamas F1 grotuvo variantas.', 400);
    if (!['WEB_DASH', 'BIG_SCREEN_DASH', 'WEB_HLS'].includes(platform)) throw new ServiceError('Netinkamas F1 atkūrimo profilis.', 400);
    if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError('Netinkamas turinio numeris.', 400);
    await this.context(true);
    const selectedChannel = await this.validateChannel(contentId, channelId);
    // A normal authenticated service route; never alter DRM, content or entitlement.
    const data = await this.json(ORIGIN + '/2.0/R/ENG/' + platform + '/ALL/CONTENT/PLAY?contentId=' + contentId + (player !== 'legacy-default' ? '&player=' + player : '') + (selectedChannel ? '&channelId=' + selectedChannel : ''), this.headers());
    const stream = parsePlayback(data);
    await this.resolvePlayerManifest(stream, contentId, selectedChannel);
    const fetched = await this.mediaManifest(stream.manifestUrl);
    const response = fetched.response; stream.manifestUrl = fetched.url;
    const mpd = await response.text();
    if (mpd.length > 2 * 1024 * 1024 || !/<MPD[\s\/>]/i.test(mpd)) throw new ServiceError('F1 nepateikė tinkamo vaizdo aprašo.');
    // Only public format metadata leaves this diagnostic; no signed URLs or tokens.
    return { platform, player, contentId: String(contentId), channelId: selectedChannel, drm: stream.drm,
      streamType: stream.streamType, manifestHost: new URL(stream.manifestUrl).hostname,
      protection: [...new Set([...mpd.matchAll(/<ContentProtection[^>]*\bvalue=["']([^"']+)["']/gi)].map(match => match[1]))],
      codecs: [...new Set([...mpd.matchAll(/\bcodecs=["']([^"']+)["']/gi)].map(match => match[1]))] };
  }
  async license(stream, challenge) {
    if (!this.status().signedIn) throw new ServiceError('F1 prisijungimo sesija pasibaigė.', 401);
    // Ordinary service-supplied endpoint and headers; unchanged device challenge and license.
    const headers = { ...this.headers(), 'Content-Type': 'application/octet-stream', Origin: ORIGIN, Referer: ORIGIN + '/' };
    if (stream.entitlementToken) headers.entitlementtoken = stream.entitlementToken;
    if (stream.drmToken) headers.customdata = stream.drmToken;
    if (stream.playCookie) headers.Cookie = stream.playCookie;
    this.licenceInfo = { host: new URL(stream.licenseUrl).hostname, hasPlaybackCookie: Boolean(stream.playCookie), hasDrmToken: Boolean(stream.drmToken), status: 'pending' };
    let response;
    try {
      response = await this.request(approvedUrl(stream.licenseUrl, true), { method: 'POST', headers, body: challenge });
      this.licenceInfo.status = response.status;
      this.licenceInfo.type = response.headers.get('content-type') || '';
    } catch (error) {
      this.licenceInfo.status = error.upstreamStatus || error.status;
      this.licenceInfo.type = error.upstreamType || '';
      throw error;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    // Some F1 gateways label a binary CDM response as text/html. Judge an error
    // page by its actual body; keep a binary licence opaque for the TV CDM.
    const prefix = bytes.subarray(0, 512).toString('utf8').trimStart();
    const errorDocument = /^(?:<!doctype|<html|<head|<body|<\?xml|<Error|\{\s*")/i.test(prefix);
    this.licenceInfo.byteLength = bytes.length;
    this.licenceInfo.transportFormat = bytes[0] === 8 && bytes[1] === 2 ? 'Widevine signed message' : /^[A-Za-z0-9+\/=\s]+$/.test(bytes.toString('utf8')) ? 'base64 text' : 'other binary';
    this.licenceInfo.responseKind = errorDocument ? 'error document' : 'opaque binary';
    if (bytes.length < 16 || bytes.length > 1024 * 1024 || errorDocument) throw new ServiceError('F1 vietoje DRM licencijos pateikė netinkamą atsakymą.', 502);
    return bytes;
  }
}
