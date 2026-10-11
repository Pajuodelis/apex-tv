import Discovery from '../web/discovery.js';
import http from 'node:http';
import ViewOptions from '../web/view-options.js';
import VideoQuality from '../web/video-quality.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { publicDrmTest, publicDrmTestId, publicDrmLicense } from './drm-tests.mjs';
import { root as defaultRoot } from './paths.mjs';
import { F1Client, ServiceError } from './f1.mjs';
import { Releases } from './releases.mjs';
import { sealTVSession } from './tv-session.mjs';
import {readAudioDescriptor,repairAudioSampleCount} from './cbcs-audio.mjs';
import { buildRelayManifest, resolveRelayAsset, rebaseMedia, readMediaBody, mediaRange } from './media.mjs';
export function localAddress(raw) { return String(raw || '').replace(/^::ffff:/, ''); }
function sameSecret(got, wanted) {
  const a = Buffer.from(String(got || '')), b = Buffer.from(wanted);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function body(req, max = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new ServiceError('Užklausa per didelė.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function createApp({ setupData, client = new F1Client(), actions = {}, root = defaultRoot }) {
  const { config, pairingKey, privateKey, publicKey } = setupData;
  const releases = new Releases(root, privateKey), discovery = Discovery.create(client);
  await releases.publish();
  const streams = new Map(), diagnostics = [];
  let tvCommand = null, tvPlaybackPreference = null;
  const csrf = crypto.randomBytes(24).toString('hex');
  const hostnames = new Set(['127.0.0.1:' + config.port, 'localhost:' + config.port, config.pcAddress + ':' + config.port]);
  const adminOrigin = 'http://127.0.0.1:' + config.port;
  const server = http.createServer(async (req, res) => {
    const ip = localAddress(req.socket.remoteAddress);
    const local = ip === '127.0.0.1' || ip === '::1';
    // Record only the TV loader's public file requests; never log account or licence requests.
    if (ip === config.tvAddress) {
      const loaderPath = (req.url || '').split('?')[0];
      if (/^\/(update\/manifest\.json|release\/[a-f0-9]{24}\/(tv-app\.js|tv\.css))$/.test(loaderPath)) {
        res.once('finish', () => {
          diagnostics.push({ time: new Date().toISOString(), event: 'tv_update_request', engine: loaderPath,
            status: res.statusCode, origin: String(req.headers.origin || 'none').slice(0, 120) });
          if (diagnostics.length > 100) diagnostics.shift();
        });
      }
    }
    try {
      if (!local && ip !== config.tvAddress) throw new ServiceError('Šis įrenginys nesusietas.', 403);
      if (!hostnames.has(req.headers.host)) throw new ServiceError('Netinkamas serverio adresas.', 403);
      const origin = req.headers.origin;
      const allowedOrigin = ['null', adminOrigin, 'http://' + config.pcAddress + ':' + config.port].includes(origin) || (ip === config.tvAddress && origin === 'file://');
      if (origin && !allowedOrigin) throw new ServiceError('Netinkama užklausos kilmė.', 403);
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Apex-Key, X-Apex-CSRF');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url, adminOrigin);
      const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
      if (url.pathname === '/health' && req.method === 'GET') return send({ ok: true, version: '0.5.2', model: 'UE55AU7092UXXH', revision: releases.current.revision });
      if (url.pathname === '/update/manifest.json' && req.method === 'GET') return send((await releases.publish()).manifest);
      const asset = url.pathname.match(/^\/release\/([a-f0-9]{24})\/(tv-app\.js|tv\.css)$/);
      if (asset && req.method === 'GET') {
        const bytes = releases.get(asset[1], asset[2]);
        if (!bytes) throw new ServiceError('Atnaujinimo failas neberastas. Paleisk programėlę iš naujo.', 404);
        res.writeHead(200, { 'Content-Type': asset[2].endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(bytes); return;
      }
      if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/preview') || url.pathname === '/') {
        if (!local) throw new ServiceError('Valdymas pasiekiamas tik šiame kompiuteryje.', 403);
        if (req.method === 'POST' && (!sameSecret(req.headers['x-apex-csrf'], csrf) || origin !== adminOrigin)) throw new ServiceError('Netinkamas valdymo patvirtinimas.', 403);
        if (url.pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'" });
          res.end(await fs.readFile(path.join(root, 'web/admin.html'))); return;
        }
        if (url.pathname === '/admin.js' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(await fs.readFile(path.join(root, 'web/admin.js'))); return;
        }
        if (url.pathname === '/admin.css' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(await fs.readFile(path.join(root, 'web/admin.css'))); return;
        }
        if (url.pathname === '/admin/state' && req.method === 'GET') return send({ csrf, account: client.status(), config, revision: releases.current.revision, diagnostics: diagnostics.slice(-30), playback: client.playbackInfo, license: client.licenceInfo, transport: client.transportInfo });
        if (url.pathname === '/admin/login' && req.method === 'POST') { if (!actions.login) throw new ServiceError('Paleisk programėlę su npm start, kad atsidarytų F1 langas.', 503); await actions.login(); return send({ ok: true }); }
        if (url.pathname === '/admin/logout' && req.method === 'POST') { await client.signOut(); streams.clear(); tvCommand = null; tvPlaybackPreference = null; await actions.logout?.(); return send({ ok: true }); }
        if (url.pathname === '/admin/restart' && req.method === 'POST') {
          if (!actions.restart) throw new ServiceError('Perkrovimas pasiekiamas tik Apex TV programoje.', 503);
          send({ ok: true }); await actions.restart(); return;
        }
        if (url.pathname === '/admin/publish' && req.method === 'POST') return send({ ok: true, revision: (await releases.publish()).revision });
        if (url.pathname === '/admin/format-check' && req.method === 'POST') {
          let data; try { data = JSON.parse(await body(req, 4096)); } catch { throw new ServiceError('Netinkama užklausa.', 400); }
          return send(await client.inspectLegacyDash(data.id, data.platform, data.player, data.channelId));
        }
        if (url.pathname === '/admin/channels' && req.method === 'POST') {
          let data; try { data = JSON.parse(await body(req, 4096)); } catch { throw new ServiceError('Netinkama užklausa.', 400); }
          return send(await client.channels(data.id));
        }
        if (url.pathname === '/admin/drm-probe' && req.method === 'POST') {
          let data; try { data = JSON.parse(await body(req, 4096)); } catch { throw new ServiceError('Netinkama užklausa.', 400); }
          if (!data || Object.keys(data).some(key => key !== 'scheme') || !['cenc','cbcs'].includes(data.scheme)) throw new ServiceError('Pasirink viešą DRM patikrą.', 400);
          const test = publicDrmTest(publicDrmTestId(data.scheme));
          tvCommand = { commandId: crypto.randomBytes(12).toString('hex'), id: test.id, title: test.title, expires: Date.now() + 90000 };
          return send({ ok: true, title: test.title });
        }
        if (url.pathname === '/admin/play-on-tv' && req.method === 'POST') {
          let data; try { data = JSON.parse(await body(req, 4096)); } catch { throw new ServiceError('Netinkama užklausa.', 400); }
          if (!data || Object.keys(data).some(key => !['id','transport','player','live'].includes(key)) || (data.live !== undefined && typeof data.live !== 'boolean') || !/^\d{1,12}$/.test(String(data.id)) || (data.transport !== undefined && !['direct','relay','relay-hevc','relay-mse'].includes(data.transport)) || (data.player !== undefined && !['player_bm','player_tm','legacy-default'].includes(data.player))) throw new ServiceError('Pasirink F1 katalogo įrašą.', 400);
          if (!client.status().signedIn) throw new ServiceError('Prisijunk prie F1 TV kompiuteryje.', 401);
          const live = data.live === true;
          if (live && data.transport && data.transport !== 'direct') throw new ServiceError('Gyvą srautą televizorius turi gauti tiesiai iš F1.', 400);
          const recording = live ? (await client.live()).find(item => item.live === true && item.kind === 'video' && String(item.id) === String(data.id)) : await client.channels(data.id);
          if (!recording || !recording.title) throw new ServiceError(live ? 'F1 dar neįjungė šios gyvos transliacijos.' : 'F1 nepatvirtino pasirinkto įrašo.', 404);
          tvCommand = { commandId: crypto.randomBytes(12).toString('hex'), id: String(data.id), title: recording.title, live, transport: live ? 'direct' : data.transport || 'relay', player: live ? 'legacy-default' : data.player, expires: Date.now() + 90000 };
          diagnostics.push({ time: new Date().toISOString(), source: 'companion', event: 'tv_play_queued', engine: recording.title });
          if (diagnostics.length > 100) diagnostics.shift();
          return send({ ok: true, title: recording.title });
        }
        if (url.pathname === '/admin/tv' && req.method === 'GET') {
          try { const response = await fetch('http://' + config.tvAddress + ':8001/api/v2/', { signal: AbortSignal.timeout(5000) }); const data = await response.json();
            return send({ model: data.device?.modelName, developerMode: data.device?.developerMode, developerIP: data.device?.developerIP, ip: config.tvAddress }); }
          catch { throw new ServiceError('TV informacijos serveris neatsako. Patikrink, ar TV įjungtas.', 503); }
        }
        if (url.pathname === '/preview/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end((await fs.readFile(path.join(root, 'tv/index.html'),'utf8')).replace(/<script src="\$WEBAPIS\/webapis\/webapis\.js"><\/script>/,'').replace(/<script src="bundled-version\.js"><\/script>/,'')); return; }
        if (url.pathname === '/preview/connection.js' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end('window.APEX_CONFIG=' + JSON.stringify({ server: adminOrigin, pairingKey, publicKey, shell: 1, bundledVersion: JSON.parse(Buffer.from(releases.current.manifest.payload,'base64')).version, preview: true }) + ';'); return;
        }
        if (['/preview/boot.js', '/preview/boot.css','/preview/menu-cache.js'].includes(url.pathname) && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(await fs.readFile(url.pathname==='/preview/boot.js'?path.join(root,'web/preview-boot.js'):path.join(root, 'tv', path.basename(url.pathname)))); return;
        }
        throw new ServiceError('Puslapis nerastas.', 404);
      }
      const mediaRoute = url.pathname.match(/^\/api\/media\/([a-f0-9]{48})\/(manifest\.mpd|s(\d+)\/([A-Za-z0-9_.-]{1,128})\.mp4)$/);
      if (mediaRoute && (req.method === 'GET' || req.method === 'HEAD')) {
        // The existing socket-IP and Host gates still apply. Native AVPlay cannot add X-Apex-Key,
        // so this resource also requires its unguessable, expiring playback ticket.
        const stream = streams.get(mediaRoute[1]);
        if (!stream || stream.expires < Date.now() || !stream.relay) throw new ServiceError('Vaizdo sesija pasibaigė.', 410);
        if (mediaRoute[2] === 'manifest.mpd') {
          const bytes = Buffer.from(stream.relay.mpd);
          res.writeHead(200, { 'Content-Type': 'application/dash+xml', 'Content-Length': bytes.length });
          res.end(req.method === 'HEAD' ? undefined : bytes); return;
        }
        const asset = resolveRelayAsset(stream.relay, Number(mediaRoute[3]), mediaRoute[4], url.searchParams);
        let bytes = stream.cache.get(asset.key);
        if (!bytes) {
          const fetched = await client.mediaManifest(asset.url, '*/*');
          // Do not silently follow a fragment to a different CDN or retry an access denial.
          if (new URL(fetched.url).hostname !== asset.slot.host) throw new ServiceError('F1 segmentas pakeitė medijos serverį.', 403);
          bytes = rebaseMedia(await readMediaBody(fetched.response), asset.slot);
          if(asset.slot.type==='audio'){
            if(asset.slot.kind==='initialization')stream.audioDescriptor=readAudioDescriptor(bytes);
            else if(stream.audioDescriptor){const repaired=repairAudioSampleCount(bytes,stream.audioDescriptor);if(repaired.changed){bytes=Buffer.from(repaired.bytes);diagnostics.push({time:new Date().toISOString(),source:local?'pc-preview':'tv',event:'audio_container_compatibility',engine:'constant-IV CBCS; sample count corrected; encrypted samples unchanged'});}}
          }
          while (stream.cache.size >= 12 || (stream.cacheBytes + bytes.length > 64 * 1024 * 1024 && stream.cache.size)) {
            const oldest = stream.cache.keys().next().value;
            stream.cacheBytes -= stream.cache.get(oldest).length; stream.cache.delete(oldest);
          }
          stream.cache.set(asset.key, bytes); stream.cacheBytes += bytes.length;
          const event = { time: new Date().toISOString(), source: local ? 'pc-preview' : 'tv',
            event: 'encrypted_media_relay', engine: asset.slot.type + ' ' + asset.slot.kind,
            error: 'bytes=' + bytes.length + '; upstream=' + asset.slot.host + '; encrypted payload preserved' };
          diagnostics.push(event); if (diagnostics.length > 100) diagnostics.shift();
        }
        const range = mediaRange(req.headers.range, bytes.length);
        const headers = { 'Content-Type': asset.slot.type + '/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': range.end - range.start + 1 };
        if (range.status === 206) headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + bytes.length;
        res.writeHead(range.status, headers); res.end(req.method === 'HEAD' ? undefined : bytes.subarray(range.start, range.end + 1)); return;
      }
      if (!sameSecret(req.headers['x-apex-key'], pairingKey)) throw new ServiceError('TV ryšio raktas netinkamas.', 401);
      if (url.pathname === '/api/tv-command' && req.method === 'GET') {
        if (local || ip !== config.tvAddress) throw new ServiceError('Paleidimo komanda skirta tik susietam TV.', 403);
        const revision = url.searchParams.get('revision');
        if (revision && !/^[a-f0-9]{24}$/.test(revision)) throw new ServiceError('Netinkama meniu revizija.', 400);
        if (revision && revision !== releases.current.revision) return send({ command: null, revision: releases.current.revision });
        const command = tvCommand && tvCommand.expires >= Date.now() && client.status().signedIn ? tvCommand : null;
        tvCommand = null;
        if (command) {
          tvPlaybackPreference = { id: command.id, transport: command.transport, player: command.player, expires: Date.now() + 30000 };
          diagnostics.push({ time: new Date().toISOString(), source: 'tv', event: 'tv_play_delivered', engine: command.title });
          if (diagnostics.length > 100) diagnostics.shift();
        }
        return send({ revision: releases.current.revision, command: command && { commandId: command.commandId, id: command.id, title: command.title, live: command.live === true } });
      }
      if (url.pathname === '/api/tv-session' && req.method === 'POST') {
        // No admin/preview export: only the configured, authenticated TV receives it.
        if (local || ip !== config.tvAddress) throw new ServiceError('Sesija skirta tik susietam televizoriui.', 403);
        if (!client.status().signedIn) throw new ServiceError('Pirmą kartą prisijunk prie F1 TV.', 401);
        let data; try { data = JSON.parse(await body(req, 4096)); } catch { throw new ServiceError('Netinkama TV sesijos užklausa.', 400); }
        if (!data || Object.keys(data).some(key => key !== 'publicKey')) throw new ServiceError('Netinkama TV sesijos užklausa.', 400);
        return send(await sealTVSession(client.token, data.publicKey, privateKey));
      }
      if (url.pathname === '/api/status' && req.method === 'GET') return send({ account: client.status(), revision: releases.current.revision });
      if (url.pathname === '/api/catalog' && req.method === 'GET') return send({ items: await client.page(url.searchParams.get('page') || '493') });
      if (url.pathname === '/api/detail' && req.method === 'GET') return send({ items: await client.detail(url.searchParams.get('id')) });
      if (url.pathname === '/api/live' && req.method === 'GET') return send({ items: await client.live() });
      if (url.pathname === '/api/search' && req.method === 'GET') return send(await discovery.search(url.searchParams.get('q')));
      if (url.pathname === '/api/weekend' && req.method === 'GET') return send(await discovery.weekend());
      if (url.pathname === '/api/channels' && req.method === 'GET') return send(await client.channels(url.searchParams.get('id')));
      if (url.pathname === '/api/play' && req.method === 'POST') {
        let data; try { data = JSON.parse(await body(req, 4096)); } catch { throw new ServiceError('Netinkama užklausa.', 400); }
        const preference = !local && ip === config.tvAddress && tvPlaybackPreference && tvPlaybackPreference.id === String(data.id) && tvPlaybackPreference.expires >= Date.now() ? tvPlaybackPreference : null;
        if (preference || (tvPlaybackPreference && tvPlaybackPreference.expires < Date.now())) tvPlaybackPreference = null;
        const nativeDirect = preference && preference.transport === 'direct';
        if (nativeDirect) data.relay = false;
        const hevcRelay = preference && preference.transport === 'relay-hevc';
        const browserRelay = preference && preference.transport === 'relay-mse';
        if (hevcRelay || browserRelay) data.relay = true;
        if (preference && preference.player) data.player = preference.player;
        const test = publicDrmTest(data.id);
        const stream = test ? { manifestUrl: test.manifestUrl, drm: 'widevine', streamType: 'public-test', platform: 'public-test', protection: [test.scheme], publicTestId: test.id }
          : await client.playback(data.id, data.platform, data.player, data.channelId);
        const audioTracks=ViewOptions.audioTracks(stream.manifestXML), selectedAudio=ViewOptions.selectAudio(stream.manifestXML,data.audioTrackId,data.audioLanguage);
        stream.audioTrackId=selectedAudio?selectedAudio.id:'';
        stream.videoQuality=VideoQuality.mode(data.videoQuality);
        const ticket = crypto.randomBytes(24).toString('hex');
        if (test) data.relay = false;
        // A PC preview must not invalidate the licence ticket already used by the TV.
        for (const [key, value] of streams) if (value.expires < Date.now()) streams.delete(key);
        while (streams.size >= 8) streams.delete(streams.keys().next().value);
        const stored = { ...stream, expires: Date.now() + 4 * 60 * 60 * 1000 };
        let manifestUrl = stream.manifestUrl;
        if (data.relay === true) {
          stored.relay = buildRelayManifest(stream, ticket, local ? adminOrigin : 'http://' + config.pcAddress + ':' + config.port, hevcRelay ? 'hevc' : 'avc');
          stored.cache = new Map(); stored.cacheBytes = 0;
          manifestUrl = (local ? adminOrigin : 'http://' + config.pcAddress + ':' + config.port) + '/api/media/' + ticket + '/manifest.mpd';
          diagnostics.push({ time: new Date().toISOString(), source: local ? 'pc-preview' : 'tv', event: 'encrypted_relay_prepared',
            engine: new URL(stream.manifestUrl).hostname, error: (hevcRelay ? 'HEVC' : 'AVC') + ' + AAC; DRM retained; public timing rebased' });
          if (diagnostics.length > 100) diagnostics.shift();
        }
        streams.set(ticket, stored);
        return send({ manifestUrl, videoQuality:stream.videoQuality,selectedVideo:stored.relay?.video||null, audioTracks, audioTrackId:stream.audioTrackId, channelId:String(data.channelId||''), drm: stream.drm, ticket, streamType: stream.streamType, platform: stream.platform, protection: stream.protection, relayed: data.relay === true, nativeTest: Boolean(test || nativeDirect), browserTest: Boolean(browserRelay) });
      }
      const license = url.pathname.match(/^\/api\/license\/([a-f0-9]{48})$/);
      if (license && req.method === 'POST') {
        const stream = streams.get(license[1]);
        if (!stream || stream.expires < Date.now()) throw new ServiceError('Vaizdo sesija pasibaigė.', 410);
        const challenge = await body(req);
        if (!challenge.length) throw new ServiceError('Tuščia DRM užklausa.', 400);
        const bytes = stream.publicTestId ? await publicDrmLicense(stream.publicTestId, challenge) : await client.license(stream, challenge);
        if (stream.publicTestId) {
          diagnostics.push({ time: new Date().toISOString(), source: local ? 'pc-preview' : 'tv', event: 'public_drm_license', engine: publicDrmTest(stream.publicTestId).scheme, error: 'HTTP 200; bytes=' + bytes.length });
          if (diagnostics.length > 100) diagnostics.shift();
        }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(bytes); return;
      }
      if (url.pathname === '/api/diagnostics' && req.method === 'POST') {
        let data; try { data = JSON.parse(await body(req, 8192)); } catch { throw new ServiceError('Netinkama diagnostika.', 400); }
        const clean = {};
        for (const key of ['event', 'engine', 'model', 'firmware', 'tizen', 'shell', 'revision', 'error', 'playbackKind']) if (typeof data[key] === 'string' || typeof data[key] === 'number') clean[key] = String(data[key]).replace(/https?:\/\/\S+/g, '[adresai nerodomi]').slice(0, 400);
        diagnostics.push({ time: new Date().toISOString(), source: local ? 'pc-preview' : 'tv', ...clean });
        if (diagnostics.length > 100) diagnostics.shift();
        return send({ ok: true });
      }
      throw new ServiceError('Puslapis nerastas.', 404);
    } catch (error) {
      if (!res.headersSent) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: error instanceof ServiceError ? error.message : 'Programėlės užklausa nepavyko.' })); }
      else res.destroy();
    }
  });
  server.requestTimeout = 30000;
  return { server, client, releases, diagnostics };
}
