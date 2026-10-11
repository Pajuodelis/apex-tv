(function(global) {
  "use strict";
  const SAFE = Number.MAX_SAFE_INTEGER;
  function bytes(x) {
    return x instanceof Uint8Array ? x : new Uint8Array(x);
  }
  function boxes(input, start, end) {
    const b = bytes(input), v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
    for (let at = start || 0, limit = end === void 0 ? b.length : end; at < limit; ) {
      if (at + 8 > limit) throw Error("MP4 header bounds");
      let n = v.getUint32(at), h = 8;
      if (n === 1) {
        if (at + 16 > limit) throw Error("MP4 size bounds");
        n = v.getUint32(at + 8) * 4294967296 + v.getUint32(at + 12);
        h = 16;
      }
      if (n === 0) n = limit - at;
      if (n < h || n > limit - at || n > SAFE) throw Error("MP4 box bounds");
      out.push({ at, p: at + h, end: at + n, type: String.fromCharCode(...b.subarray(at + 4, at + 8)) });
      at += n;
    }
    return out;
  }
  function initInfo(input) {
    const b = bytes(input), v = new DataView(b.buffer, b.byteOffset, b.byteLength), info = { pssh: [], scheme: "", pattern: 0, ivSize: 0, encrypted: false };
    function walk(start, end, depth) {
      if (depth > 12) throw Error("MP4 depth");
      for (const q of boxes(b, start, end)) {
        const p = q.p;
        if (q.type === "pssh") info.pssh.push(b.slice(q.at, q.end));
        if (q.type === "mdhd") info.timescale = v.getUint32(p + (b[p] === 1 ? 20 : 12));
        if (q.type === "trex") {
          info.defaultDuration = v.getUint32(p + 12);
          info.defaultSize = v.getUint32(p + 16);
          info.defaultFlags = v.getUint32(p + 20);
        }
        if (q.type === "avcC") {
          info.extra = b.slice(p, q.end);
          info.nalLength = (b[p + 4] & 3) + 1;
        }
        if (q.type === "esds") {
          for (let at = p + 4; at < q.end - 2; at++) {
            if (b[at] !== 5) continue;
            let x = at + 1, n = 0, count = 0;
            do {
              if (x >= q.end || ++count > 4) throw Error("AAC descriptor length");
              n = n << 7 | b[x] & 127;
            } while (b[x++] & 128);
            if (n >= 2 && n <= 64 && x + n <= q.end && b[x] >> 3 === 2) {
              info.extra = b.slice(x, x + n);
              break;
            }
          }
        }
        if (q.type === "schm") info.scheme = String.fromCharCode(...b.subarray(p + 4, p + 8));
        if (q.type === "tenc") {
          if (b[p] > 1 || p + 24 > q.end) throw Error("MP4 track encryption");
          info.pattern = b[p] === 1 ? b[p + 5] : 0;
          info.encrypted = Boolean(b[p + 6]);
          info.ivSize = b[p + 7];
          info.id = b.slice(p + 8, p + 24);
          if (info.encrypted && !info.ivSize) {
            const n = b[p + 24];
            if (n !== 16 || p + 25 + n > q.end) throw Error("MP4 constant IV");
            info.iv = b.slice(p + 25, p + 25 + n);
          }
        }
        const skip = /^(moov|trak|mdia|minf|stbl|sinf|schi|mvex)$/.test(q.type) ? 0 : q.type === "stsd" ? 8 : /^(encv|avc1|avc3)$/.test(q.type) ? 78 : /^(enca|mp4a)$/.test(q.type) ? 28 : -1;
        if (skip >= 0) walk(p + skip, q.end, depth + 1);
      }
    }
    walk(0, b.length, 0);
    if (!info.timescale || !info.extra) throw Error("MP4 decoder configuration missing");
    if (info.encrypted && (!/^cbcs$/.test(info.scheme) || !info.id || !info.iv || info.ivSize)) throw Error("Unsupported encrypted packet layout");
    return info;
  }
  function samples(input, init, anchor) {
    const b = bytes(input), v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
    for (const moof of boxes(b).filter((q) => q.type === "moof")) for (const traf of boxes(b, moof.p, moof.end).filter((q) => q.type === "traf")) {
      const list = boxes(b, traf.p, traf.end), tfhd = list.find((q) => q.type === "tfhd"), tfdt = list.find((q) => q.type === "tfdt"), run = list.find((q) => q.type === "trun");
      if (!tfhd || !tfdt || !run || list.filter((q) => q.type === "trun").length !== 1) throw Error("Unsupported MP4 run");
      let p = tfhd.p, flags = v.getUint32(p) & 16777215, x = p + 8, base = moof.at, dur = init.defaultDuration || 0, size = init.defaultSize || 0, sampleFlags = init.defaultFlags || 0;
      if (flags & 1) {
        base = v.getUint32(x) * 4294967296 + v.getUint32(x + 4);
        x += 8;
      }
      if (flags & 2) x += 4;
      if (flags & 8) {
        dur = v.getUint32(x);
        x += 4;
      }
      if (flags & 16) {
        size = v.getUint32(x);
        x += 4;
      }
      if (flags & 32) {
        sampleFlags = v.getUint32(x);
        x += 4;
      }
      p = tfdt.p;
      let time = b[p] === 1 ? v.getUint32(p + 4) * 4294967296 + v.getUint32(p + 8) : v.getUint32(p + 4);
      if (time > SAFE) throw Error("Unsafe MP4 timestamp");
      p = run.p;
      const version = b[p], rf = v.getUint32(p) & 16777215, count = v.getUint32(p + 4);
      x = p + 8;
      if (count > 1e4) throw Error("MP4 sample count");
      let dataAt;
      if (rf & 1) {
        dataAt = base + v.getInt32(x);
        x += 4;
      } else {
        const mdat = boxes(b).find((q) => q.type === "mdat");
        if (!mdat) throw Error("Missing MP4 samples");
        dataAt = mdat.p;
      }
      let firstFlags = sampleFlags;
      if (rf & 4) {
        firstFlags = v.getUint32(x);
        x += 4;
      }
      let enc = init;
      const group = list.find((q) => q.type === "sgpd" && String.fromCharCode(...b.subarray(q.p + 4, q.p + 8)) === "seig");
      if (group) {
        const g = group.p;
        if (b[g] !== 1 || v.getUint32(g + 8) !== 37 || v.getUint32(g + 12) !== 1 || group.end < g + 53) throw Error("MP4 encryption group");
        const e = g + 16;
        if (!b[e + 2] || b[e + 3] || b[e + 20] !== 16) throw Error("MP4 encryption group IV");
        enc = { encrypted: true, scheme: init.scheme, pattern: b[e + 1], id: b.slice(e + 4, e + 20), iv: b.slice(e + 21, e + 37), ivSize: 0 };
        const mapping = list.find((q) => q.type === "sbgp" && String.fromCharCode(...b.subarray(q.p + 4, q.p + 8)) === "seig");
        if (!mapping || b[mapping.p] !== 0 || v.getUint32(mapping.p + 8) !== 1 || v.getUint32(mapping.p + 12) !== count || v.getUint32(mapping.p + 16) !== 65537) throw Error("MP4 encryption group mapping");
      }
      const senc = list.find((q) => q.type === "senc");
      let encAt = senc ? senc.p + 8 : 0, encCount = senc ? v.getUint32(senc.p + 4) : 0, encFlags = senc ? v.getUint32(senc.p) & 16777215 : 0;
      if (enc.encrypted && (enc.pattern !== 0 && enc.pattern !== 25 || encFlags & 1 || encCount !== 0 && encCount !== count)) throw Error("Unsupported sample encryption");
      for (let i = 0; i < count; i++) {
        let d = dur, n = size, f = i === 0 ? firstFlags : sampleFlags, c = 0;
        if (rf & 256) {
          d = v.getUint32(x);
          x += 4;
        }
        if (rf & 512) {
          n = v.getUint32(x);
          x += 4;
        }
        if (rf & 1024) {
          f = v.getUint32(x);
          x += 4;
        }
        if (rf & 2048) {
          c = version === 1 ? v.getInt32(x) : v.getUint32(x);
          x += 4;
        }
        if (x > run.end || !d || !n || dataAt < 0 || dataAt + n > b.length) throw Error("MP4 sample bounds");
        const packet = { pts: (time - anchor + c) / init.timescale, dts: (time - anchor) / init.timescale, duration: d / init.timescale, isKeyFrame: !(f & 65536), isEncrypted: Boolean(enc.encrypted) };
        if (packet.isEncrypted) {
          packet.keyId = enc.id;
          packet.initializationVector = enc.iv;
          packet.encryptionMode = enc.scheme;
          const sub = [];
          if (encCount && encFlags & 2) {
            if (encAt + 2 > senc.end) throw Error("MP4 subsample bounds");
            const k = v.getUint16(encAt);
            encAt += 2;
            let total = 0;
            for (let j = 0; j < k; j++) {
              if (encAt + 6 > senc.end) throw Error("MP4 subsample bounds");
              const clearBytes = v.getUint16(encAt), encryptedBytes = v.getUint32(encAt + 2);
              encAt += 6;
              total += clearBytes + encryptedBytes;
              sub.push({ clearBytes, encryptedBytes });
            }
            if (total !== n) throw Error("MP4 subsample size");
          } else sub.push({ clearBytes: 0, encryptedBytes: n });
          packet.subsamples = sub;
        }
        out.push({ packet, data: b.slice(dataAt, dataAt + n) });
        dataAt += n;
        time += d;
      }
    }
    return out;
  }
  function duration(value) {
    const m = String(value).match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?([\d.]+)?S?$/);
    return m ? Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0) : 0;
  }
  function directChild(e, name) {
    return Array.from(e.children).find((q) => q.localName === name);
  }
  function manifest(xml, url) {
    if (xml.length > 2097152 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error("Unsafe MPD");
    const doc = new DOMParser().parseFromString(xml, "application/xml"), mpd = doc.documentElement, period = doc.getElementsByTagName("Period")[0];
    if (!period || doc.getElementsByTagName("Period").length !== 1 || mpd.localName !== "MPD") throw Error("Unsupported MPD periods");
    const live = mpd.getAttribute("type") === "dynamic", periodStart = duration(period.getAttribute("start")), sets = Array.from(period.children).filter((e) => e.localName === "AdaptationSet"), choices = [];
    for (const set of sets.filter((s) => !Array.from(s.children).some((p) => /Property$/.test(p.localName) && /trickmode/i.test(p.getAttribute("schemeIdUri") || "")))) for (const rep of Array.from(set.children).filter((e) => e.localName === "Representation")) {
      const codec = rep.getAttribute("codecs") || set.getAttribute("codecs") || "", height = Number(rep.getAttribute("height") || set.getAttribute("height"));
      const type = /^avc[13]\./.test(codec) && height <= 720 ? "video" : /^mp4a\.40\.2$/.test(codec) ? "audio" : "";
      if (!type) continue;
      const tpl = directChild(rep, "SegmentTemplate") || directChild(set, "SegmentTemplate");
      if (!tpl) continue;
      const timeline = directChild(tpl, "SegmentTimeline");
      if (!timeline) continue;
      let base = url;
      for (const element of [mpd, period, set, rep]) {
        const u = directChild(element, "BaseURL");
        if (u) base = new URL(u.textContent.trim(), base).href;
      }
      const scale = Number(tpl.getAttribute("timescale") || 1), pto = Number(tpl.getAttribute("presentationTimeOffset") || 0), segments = [];
      let t = 0, n = Number(tpl.getAttribute("startNumber") || 1);
      for (const s of Array.from(timeline.children).filter((e) => e.localName === "S")) {
        if (s.hasAttribute("t")) t = Number(s.getAttribute("t"));
        const d = Number(s.getAttribute("d")), r = Number(s.getAttribute("r") || 0);
        if (!Number.isSafeInteger(t) || !Number.isSafeInteger(d) || d <= 0 || r < 0 || r > 1e4 || segments.length + r > 2e4) throw Error("Unsupported MPD timeline");
        for (let j = 0; j <= r; j++) {
          segments.push({ t, n, d });
          t += d;
          n++;
        }
      }
      const id = rep.getAttribute("id"), bandwidth = rep.getAttribute("bandwidth"), lang = set.getAttribute("lang") || "", fps = (rep.getAttribute("frameRate") || set.getAttribute("frameRate") || "50").split("/");
      const expand = (value, segment) => value.replace(/\$(RepresentationID|Bandwidth|Time|Number)(?:%0(\d+)d)?\$/g, (_, key, pad) => {
        const vals = { RepresentationID: id, Bandwidth: bandwidth, Time: segment && segment.t, Number: segment && segment.n };
        const value2 = String(vals[key]);
        return pad ? value2.padStart(Number(pad), "0") : value2;
      });
      choices.push({ type, codec, lang, height, width: Number(rep.getAttribute("width") || set.getAttribute("width")), scale, pto, periodStart, segments, fps, bandwidth: Number(bandwidth), initUrl: new URL(expand(tpl.getAttribute("initialization")), base).href, url: (segment) => new URL(expand(tpl.getAttribute("media"), segment), base).href });
    }
    const video = choices.filter((q) => q.type === "video").sort((a, b) => b.height - a.height || a.bandwidth - b.bandwidth)[0], audios = choices.filter((q) => q.type === "audio"), audio = audios.find((q) => /^(eng|en)$/i.test(q.lang)) || audios[0];
    if (!video || !audio || !video.segments.length || !audio.segments.length) throw Error("No supported AVC/AAC tracks");
    return { live, duration: duration(mpd.getAttribute("mediaPresentationDuration")) || duration(period.getAttribute("duration")), tracks: [video, audio] };
  }
  function safeError(e) {
    return String(e && e.name || "Error") + ": " + String(e && e.message || "playback failure").replace(/https?:\/\/\S+/g, "[media]").slice(0, 150);
  }
  class Player {
    constructor(video, stream, report) {
      this.video = video;
      this.stream = stream;
      this.report = report;
      this.closed = false;
      this.sessions = [];
      this.tracks = [];
      this.timer = 0;
      this.pending = 0;
    }
    async fetch(url, text) {
      const r = await global.ApexStandalone.client.request(url, { headers: { Accept: text ? "application/dash+xml" : "*/*" } }, true);
      if (this.closed) throw Error("Player closed");
      const body = text ? await r.text() : await r.arrayBuffer();
      if ((text ? body.length : body.byteLength) > 33554432) throw Error("Media size");
      return body;
    }
    async license(init) {
      const session = this.keys.createSession();
      this.sessions.push(session);
      session.addEventListener("keystatuseschange", () => {
        const states = [];
        let match = false;
        session.keyStatuses.forEach((value, key) => {
          const id = bytes(key);
          if (id.length === init.id.length && id.every((n, i) => n === init.id[i]) && value === "usable") match = true;
          if (states.indexOf(value) < 0) states.push(value);
        });
        this.report("emss_key_status", { engine: "statuses=" + states.join(",") + "; sampleKeyUsable=" + match });
      });
      const installed = new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) reject(Error("Licence timeout"));
        }, 18e3);
        session.addEventListener("message", async (event) => {
          try {
            const r = await global.ApexStandalone.client.request(this.stream.licenseUrl, { method: "POST", headers: Object.assign({ "Content-Type": "application/octet-stream" }, this.stream.licenseHeaders), body: event.message });
            const response = await r.arrayBuffer();
            if (!response.byteLength || response.byteLength > 1048576) throw Error("Licence bounds");
            if (this.closed) return;
            await session.update(response);
            done = true;
            clearTimeout(timer);
            this.report("emss_license_ready", { engine: "Widevine CDM; original binary response" });
            resolve();
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        });
      });
      const pssh = init.pssh.find((q) => q.length >= 28 && q[12] === 237 && q[13] === 239 && q[14] === 139 && q[15] === 169);
      if (!pssh) throw Error("Widevine PSSH missing");
      await session.generateRequest("cenc", pssh);
      await installed;
      return session;
    }
    async start() {
      const api = global.tizentvwasm;
      if (!api || !api.ElementaryMediaStreamSource) throw Error("Samsung EMSS unavailable");
      this.report("emss_stage", { engine: "manifest; host=" + new URL(this.stream.manifestUrl).hostname });
      const mpd = manifest(this.stream.manifestXML || await this.fetch(this.stream.manifestUrl, true), this.stream.manifestUrl);
      this.report("emss_stage", { engine: "manifest parsed; " + (mpd.live ? "live" : "vod") });
      this.mpd = mpd;
      this.source = new api.ElementaryMediaStreamSource("latency-mode-normal", "rendering-mode-media-element");
      this.source.addEventListener("error", (e) => this.fail({ name: e.error || "EMSS", message: e.message || "media pipeline error" }));
      this.objectURL = URL.createObjectURL(this.source);
      this.video.src = this.objectURL;
      if (this.stream.drm === "widevine") {
        const access = await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{ initDataTypes: ["cenc"], sessionTypes: ["temporary"], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: "HW_SECURE_CRYPTO" }], videoCapabilities: [{ contentType: 'video/mp4; codecs="' + mpd.tracks[0].codec + '"', robustness: "HW_SECURE_DECODE", encryptionScheme: "cbcs" }] }]);
        this.report("emss_drm_configuration", { engine: "HW_SECURE_DECODE video; HW_SECURE_CRYPTO audio" });
        this.keys = await access.createMediaKeys();
      }
      const liveAnchor = mpd.live ? mpd.tracks[0].segments[Math.max(0, mpd.tracks[0].segments.length - 3)].t / mpd.tracks[0].scale : 0;
      for (const metadata of mpd.tracks) {
        this.report("emss_stage", { engine: "init " + metadata.type + "; host=" + new URL(metadata.initUrl).hostname });
        const init = initInfo(await this.fetch(metadata.initUrl));
        this.report("emss_stage", { engine: "license " + metadata.type });
        const session = init.encrypted ? await this.license(init) : null, config = { mimeType: metadata.type + '/mp4; codecs="' + metadata.codec + '"', extradata: init.extra, decodingMode: "hardware" };
        if (metadata.type === "video") Object.assign(config, { width: metadata.width, height: metadata.height, framerateNum: Number(metadata.fps[0]), framerateDen: Number(metadata.fps[1] || 1) });
        else Object.assign(config, { sampleFormat: "SampleFormatPlanarF32", channelLayout: "ChannelLayoutStereo", samplesPerSecond: init.timescale });
        const track = metadata.type === "video" ? this.source.addVideoTrack(config) : this.source.addAudioTrack(config);
        if (session) track.setMediaKeySession(session);
        track.addEventListener("appenderror", (e) => this.fail(e.error || { name: "AppendError", message: "Samsung rejected encrypted packet" }));
        let index = mpd.live ? Math.max(0, metadata.segments.findIndex((s) => s.t / metadata.scale >= liveAnchor)) : 0;
        this.tracks.push({ metadata, init, track, index, queue: [], anchor: mpd.live ? Math.round(liveAnchor * init.timescale) : metadata.pto, busy: false, lastEnd: 0 });
      }
      this.source.duration = mpd.live ? Infinity : mpd.duration;
      await this.source.open();
      this.report("emss_opened", { engine: "Samsung hardware; licensed AVC + AAC; TV direct" });
      this.timer = setInterval(() => this.pump(), 25);
      await this.fill();
      this.pump();
      await this.video.play();
    }
    async fill() {
      for (const state of this.tracks) {
        if (this.closed || state.busy || state.queue.length > 32) continue;
        if (state.index >= state.metadata.segments.length) {
          if (!this.mpd.live && !state.ended) {
            state.ended = true;
            global.tizentvwasm.SideThreadElementaryMediaTrack.appendEndOfTrackAsync(state.track.trackId, state.track.sessionId);
          }
          continue;
        }
        state.busy = true;
        try {
          const segment = state.metadata.segments[state.index++], part = await this.fetch(state.metadata.url(segment));
          const decoded = samples(part, state.init, state.anchor);
          state.queue.push(...decoded);
          if (!state.reported) {
            state.reported = true;
            this.report("emss_packets", { engine: state.metadata.type + "; samples=" + decoded.length + "; codec=" + state.metadata.codec + "; firstPTS=" + decoded[0].packet.pts.toFixed(3) + "; firstDTS=" + decoded[0].packet.dts.toFixed(3) + "; duration=" + decoded[0].packet.duration.toFixed(3) + "; size=" + decoded[0].data.length + "; trackOpen=" + state.track.isOpen + "; sessionType=" + typeof state.track.sessionId });
          }
        } finally {
          state.busy = false;
        }
      }
    }
    pump() {
      if (this.closed) return;
      try {
        const until = this.video.currentTime + 6;
        for (const state of this.tracks) {
          if (state.track.isOpen === false) continue;
          let count = 0;
          while (state.queue.length && state.queue[0].packet.dts < until && ++count <= 8) {
            const next = state.queue[0];
            if (typeof state.track.sessionId === "number") next.packet.sessionId = state.track.sessionId;
            let accepted;
            try {
              accepted = global.tizentvwasm.SideThreadElementaryMediaTrack.appendPacketAsync(state.track.trackId, next.packet, next.data);
            } catch (e) {
              if (e.name === "AppendBufferFullError") break;
              throw e;
            }
            state.queue.shift();
            if (accepted && typeof accepted.then === "function") accepted.catch((e) => this.fail(e));
            if (!state.appended) {
              state.appended = true;
              this.report("emss_append", { engine: state.metadata.type + "; async packet submitted; result=" + typeof accepted });
            }
            state.lastEnd = next.packet.pts + next.packet.duration;
          }
        }
        this.fill().catch((e) => this.fail(e));
      } catch (e) {
        this.fail(e);
      }
    }
    fail(e) {
      if (this.closed) return;
      this.report("emss_failure", { error: safeError(e), engine: "Samsung EMSS" });
      const callback = this.onerror;
      this.reset();
      if (callback) callback(safeError(e));
    }
    reset() {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.timer);
      this.sessions.forEach((s) => s.close().catch(() => {
      }));
      try {
        if (this.source) {
          this.source.close().catch(() => {
          });
          if (this.source.destroy) this.source.destroy();
        }
      } catch (_) {
      }
      if (this.objectURL) URL.revokeObjectURL(this.objectURL);
    }
  }
  global.ApexElementary = { Player, initInfo, samples, manifest };
})(window);
