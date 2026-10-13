(function() {
  "use strict";
  function decode64(raw) {
    var value = String(raw).replace(/-/g, "+").replace(/_/g, "/");
    while (value.length % 4) value += "=";
    var text = atob(value), out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }
  function encode64(value) {
    var bytes = new Uint8Array(value), text = "";
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return btoa(text);
  }
  async function verifySignature(jwk, data, signature) {
    var key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, data);
  }
  const ORIGIN = "https://f1tv.formula1.com";
  const AGENT = "ApexTV-PersonalPrototype/0.1";
  class ServiceError extends Error {
    constructor(message, status = 502) {
      super(message);
      this.status = status;
    }
  }
  function approvedUrl(raw, license = false) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new ServiceError("F1 gr\u0105\u017Eino netinkam\u0105 vaizdo adres\u0105.");
    }
    const host = url.hostname.toLowerCase();
    const own = host === "formula1.com" || host.endsWith(".formula1.com");
    const mediaCdn = !license && host === "f1prodlive.akamaized.net";
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !(own || mediaCdn)) {
      throw new ServiceError("F1 gr\u0105\u017Eino neatpa\u017Eint\u0105 srauto arba licencijos server\u012F.");
    }
    return url.href;
  }
  function playbackCookie(headers, manifestUrl, licenseUrl) {
    const source = new URL(approvedUrl(manifestUrl)), target = new URL(approvedUrl(licenseUrl, true));
    const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
    for (const cookie of cookies) {
      const parts = String(cookie).split(";"), pair = parts.shift().trim();
      const match = pair.match(/^playToken=([\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,4096})$/);
      if (!match) continue;
      const attributes = new Map(parts.map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index < 0 ? part.length : index).trim().toLowerCase(), index < 0 ? "" : part.slice(index + 1).trim()];
      }));
      const domain = (attributes.get("domain") || source.hostname).replace(/^\./, "").toLowerCase();
      const belongs = (host) => host === domain || attributes.has("domain") && host.endsWith("." + domain);
      if (!(domain === "formula1.com" || domain.endsWith(".formula1.com")) || !belongs(source.hostname) || !belongs(target.hostname)) continue;
      const cookiePath = attributes.get("path") || source.pathname.slice(0, source.pathname.lastIndexOf("/") + 1);
      if (!target.pathname.startsWith(cookiePath) || cookiePath !== "/" && !cookiePath.endsWith("/") && target.pathname[cookiePath.length] && target.pathname[cookiePath.length] !== "/") continue;
      if (attributes.has("max-age") && Number(attributes.get("max-age")) <= 0) continue;
      if (attributes.has("expires") && Date.parse(attributes.get("expires")) <= Date.now()) continue;
      return "playToken=" + match[1];
    }
    return "";
  }
  function normalizeItems(data) {
    return window.ApexDiscovery.normalize(data);
  }
  function parsePlayback(data) {
    const result = data.resultObj;
    if (data.resultCode !== "OK" || !result) throw new ServiceError("F1 neleid\u017Eia atkurti \u0161io turinio. Patikrink prenumerat\u0105 ir region\u0105.", 403);
    const candidates = Array.isArray(result) ? result : [result, ...result.streams || []];
    const stream = candidates.find((s) => /DASH/i.test(s.streamType || "") && /widevine|WV/i.test(s.drmType || s.streamType || "")) || candidates.find((s) => s.url || s.manifestUrl);
    if (!stream) throw new ServiceError("F1 nepateik\u0117 vaizdo srauto.");
    const drm = String(stream.drmType || (/WV/i.test(stream.streamType || "") ? "widevine" : "")).toLowerCase();
    if (drm && drm !== "widevine") throw new ServiceError("\u0160iam turiniui F1 pateik\u0117 kit\u0105 DRM format\u0105. \u0160is prototipas jo dar nepalaiko.", 422);
    const manifestUrl = approvedUrl(stream.url || stream.manifestUrl);
    const rawLicense = stream.laURL || stream.laUrl || stream.licenseUrl;
    if (drm && !rawLicense) throw new ServiceError("F1 nepateik\u0117 licencijos adreso. Reikia patikrinti \u0161io srauto API atsakym\u0105.", 422);
    return {
      manifestUrl,
      licenseUrl: rawLicense ? approvedUrl(rawLicense, true) : "",
      drm,
      drmToken: stream.drmToken || "",
      entitlementToken: stream.entitlementToken || "",
      streamType: stream.streamType || ""
    };
  }
  class F1Client {
    constructor({ fetcher = fetch, mediaFetcher, vault: vault2 } = {}) {
      this.fetcher = fetcher;
      this.mediaFetcher = mediaFetcher;
      this.vault = vault2;
      this.token = "";
      this.entitlement = "";
      this.location = null;
      this.config = null;
      this.expires = 0;
      this.error = "";
    }
    async request(url, options = {}, media = false) {
      var _a, _b;
      let response;
      try {
        response = await (media && this.mediaFetcher ? this.mediaFetcher : this.fetcher)(url, {
          ...options,
          redirect: media ? "manual" : "error",
          headers: { "User-Agent": AGENT, ...options.headers || {} },
          signal: AbortSignal.timeout(2e4)
        });
      } catch (error) {
        const networkCode = (_a = String((error == null ? void 0 : error.message) || "").match(/\b(ERR_[A-Z_]+)\b/)) == null ? void 0 : _a[1];
        const code = String(networkCode || ((_b = error == null ? void 0 : error.cause) == null ? void 0 : _b.code) || (error == null ? void 0 : error.code) || (error == null ? void 0 : error.name) || "request_failed").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
        this.transportInfo = { host: new URL(url).hostname, code };
        throw new ServiceError("Nepavyko pasiekti F1 serverio." + (/^ERR_[A-Z_]+$/.test(code) ? " " + code : ""));
      }
      if (media && response.status >= 300 && response.status < 400) return response;
      if (!response.ok) {
        const error = new ServiceError("F1 u\u017Eklausa atmesta (HTTP " + response.status + ").", response.status === 401 || response.status === 403 ? 403 : 502);
        error.upstreamStatus = response.status;
        error.upstreamType = (response.headers.get("content-type") || "").split(";")[0];
        throw error;
      }
      return response;
    }
    async mediaManifest(raw, accept = "application/dash+xml, application/xml") {
      let url = approvedUrl(raw);
      const permittedRedirectHosts = /* @__PURE__ */ new Set([new URL(url).hostname, "ott-video-cf.formula1.com", "ott-video-fer-cf.formula1.com", "f1prodlive.akamaized.net"]);
      for (let hop = 0; hop <= 2; hop++) {
        const response = await this.request(url, { headers: {
          Origin: ORIGIN,
          Referer: ORIGIN + "/",
          Accept: accept
        } }, true);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || hop === 2) throw new ServiceError("F1 srauto nukreipimas netinkamas.");
          const next = approvedUrl(new URL(location, url).href);
          if (!permittedRedirectHosts.has(new URL(next).hostname)) throw new ServiceError("F1 srautas nukreip\u0117 \u012F neleist\u0105 server\u012F.");
          url = next;
          continue;
        }
        if (response.url) {
          const resolved = approvedUrl(response.url);
          if (!permittedRedirectHosts.has(new URL(resolved).hostname)) throw new ServiceError("F1 srautas nukreip\u0117 \u012F neleist\u0105 server\u012F.");
          url = resolved;
        }
        return { response, url };
      }
      throw new ServiceError("F1 srauto nukreipimas netinkamas.");
    }
    async resolvePlayerManifest(stream, contentId, channelId = "") {
      var _a, _b;
      const source = new URL(stream.manifestUrl);
      if (!/\/TMEMANIFEST\//.test(source.pathname)) return;
      if (source.hostname !== "f1tv.formula1.com") throw new ServiceError("F1 grotuvo apra\u0161o serveris netinkamas.", 422);
      const response = await this.request(source.href, { headers: {
        ...this.headers(),
        entitlementtoken: stream.entitlementToken || this.entitlement,
        Accept: "application/json",
        Origin: ORIGIN,
        Referer: ORIGIN + "/"
      } });
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new ServiceError("F1 grotuvo apra\u0161as per didelis.", 422);
      let config;
      try {
        config = JSON.parse(text);
      } catch {
        throw new ServiceError("F1 grotuvo apra\u0161as neatpa\u017Eintas.", 422);
      }
      if (String((_a = config.metadata) == null ? void 0 : _a.content_id) !== String(contentId) || !Array.isArray(config.feeds) || config.feeds.length > 64) throw new ServiceError("F1 grotuvo turinys nesutampa.", 422);
      const selected = channelId ? config.feeds.find((feed) => {
        var _a2;
        return String((_a2 = feed.metadata) == null ? void 0 : _a2.channel_id) === channelId;
      }) : config.feeds[0];
      if (!selected || typeof selected.url !== "string") throw new ServiceError("F1 nepateik\u0117 pasirinkto kanalo srauto.", 422);
      const mediaUrl = approvedUrl(selected.url);
      if (/\/TMEMANIFEST\//.test(new URL(mediaUrl).pathname)) throw new ServiceError("F1 grotuvo apra\u0161as nukreip\u0117 \u012F kit\u0105 konfig\u016Bracij\u0105.", 422);
      stream.playCookie = stream.drm ? playbackCookie(response.headers, source.href, stream.licenseUrl) : "";
      stream.manifestUrl = mediaUrl;
      this.tiledManifestInfo = { contentId: String(contentId), channelId: String(((_b = selected.metadata) == null ? void 0 : _b.channel_id) || ""), feeds: config.feeds.length, host: new URL(mediaUrl).hostname, status: response.status };
    }
    async json(url, headers = {}) {
      const response = await this.request(url, { headers });
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw new ServiceError("F1 atsakymas per didelis.");
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ServiceError("F1 pateik\u0117 neatpa\u017Eint\u0105 atsakym\u0105.");
      }
      if (data.resultCode && data.resultCode !== "OK") throw new ServiceError("F1 atmet\u0117 u\u017Eklaus\u0105. Patikrink paskyros prieig\u0105.", 403);
      return data;
    }
    async verifyToken(token) {
      if (typeof token !== "string" || token.length > 32e3) throw new ServiceError("Netinkama prisijungimo sesija.", 400);
      const parts = token.split(".");
      if (parts.length !== 3) throw new ServiceError("Netinkama prisijungimo sesija.", 400);
      let header, payload;
      try {
        header = JSON.parse(new TextDecoder().decode(decode64(parts[0])));
        payload = JSON.parse(new TextDecoder().decode(decode64(parts[1])));
      } catch {
        throw new ServiceError("Netinkama prisijungimo sesija.", 400);
      }
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1e3 || payload.nbf && payload.nbf > Date.now() / 1e3) throw new ServiceError("Prisijungimo sesija negalioja arba pasibaig\u0117.", 401);
      const jwks = await this.json("https://api.formula1.com/static/jwks.json");
      const jwk = (jwks.keys || []).find((k) => k.kid === header.kid && k.kty === "RSA");
      if (!jwk || !await verifySignature(jwk, new TextEncoder().encode(parts[0] + "." + parts[1]), decode64(parts[2]))) throw new ServiceError("F1 prisijungimo para\u0161as netinkamas.", 401);
      return payload;
    }
    async signIn(token, persist = true) {
      var _a, _b, _c;
      const payload = await this.verifyToken(token);
      const entitlement = await this.json(ORIGIN + "/2.0/R/ENG/WEB_DASH/ALL/USER/ENTITLEMENT", { ascendontoken: token });
      const ent = (_a = entitlement.resultObj) == null ? void 0 : _a.entitlementToken;
      if (!ent) throw new ServiceError("F1 nepateik\u0117 paskyros prieigos.", 403);
      const location = await this.json(ORIGIN + "/1.0/R/ENG/WEB_DASH/ALL/USER/LOCATION", { entitlementtoken: ent, ascendontoken: token });
      if (!((_c = (_b = location.resultObj) == null ? void 0 : _b.userLocation) == null ? void 0 : _c[0])) throw new ServiceError("F1 nepateik\u0117 paskyros regiono.");
      if (persist && this.vault) await this.vault.save(token);
      this.token = token;
      this.entitlement = ent;
      this.location = location.resultObj.userLocation[0];
      this.expires = payload.exp;
      this.error = "";
    }
    status() {
      var _a;
      return {
        signedIn: Boolean(this.token) && this.expires > Date.now() / 1e3,
        expires: this.expires,
        country: ((_a = this.location) == null ? void 0 : _a.detectedCountryIsoCode) || "",
        error: this.error
      };
    }
    async signOut() {
      this.token = "";
      this.entitlement = "";
      this.location = null;
      this.expires = 0;
      if (this.vault) await this.vault.clear();
    }
    async initialize() {
      this.config = await this.json(ORIGIN + "/config");
      if (this.vault) {
        try {
          const saved = await this.vault.load();
          if (saved) await this.signIn(saved, false);
        } catch {
          this.error = "I\u0161saugota F1 sesija nebegalioja. Prisijunk i\u0161 naujo.";
        }
      }
    }
    async context(required = false) {
      var _a, _b;
      if (required && !this.status().signedIn) throw new ServiceError("Prisijunk prie F1 TV televizoriuje.", 401);
      if (!this.location) {
        const data = await this.json(ORIGIN + "/1.0/A/ENG/WEB_DASH/ALL/USER/LOCATION");
        this.location = (_b = (_a = data.resultObj) == null ? void 0 : _a.userLocation) == null ? void 0 : _b[0];
      }
      if (!this.location) throw new ServiceError("F1 nepateik\u0117 regiono.");
      return {
        login: this.status().signedIn ? "R" : "A",
        tail: encodeURIComponent(this.location.entitlement) + "/" + Number(this.location.groupId)
      };
    }
    headers() {
      return this.status().signedIn ? { ascendontoken: this.token, entitlementtoken: this.entitlement } : {};
    }
    async page(pageId) {
      if (!/^\d{1,12}$/.test(String(pageId))) throw new ServiceError("Netinkamas katalogo numeris.", 400);
      const ctx = await this.context();
      const items = normalizeItems(await this.json(ORIGIN + "/2.0/" + ctx.login + "/ENG/WEB_DASH/ALL/PAGE/" + pageId + "/" + ctx.tail, this.headers())).filter((item) => item.kind !== "page" || item.id !== String(pageId));
      if (String(pageId) === "493" && !items.some((item) => /2026/.test(item.title))) {
        try {
          const latest = normalizeItems(await this.json(ORIGIN + "/2.0/" + ctx.login + "/ENG/WEB_DASH/ALL/PAGE/12343/" + ctx.tail, this.headers()));
          if (latest.some((item) => /2026/.test(item.title))) items.unshift({ id: "12343", title: "2026 Season", kind: "page", subtitle: "", duration: 0, live: false });
        } catch {
        }
      }
      return items;
    }
    async detail(contentId) {
      if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError("Netinkamas turinio numeris.", 400);
      const ctx = await this.context();
      return normalizeItems(await this.json(ORIGIN + "/4.0/" + ctx.login + "/ENG/WEB_DASH/ALL/CONTENT/VIDEO/" + contentId + "/" + ctx.tail, this.headers())).filter((item) => item.id !== String(contentId));
    }
    async channels(contentId) {
      if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError("Netinkamas turinio numeris.", 400);
      const ctx = await this.context(true);
      const data = await this.json(ORIGIN + "/4.0/" + ctx.login + "/ENG/WEB_DASH/ALL/CONTENT/VIDEO/" + contentId + "/" + ctx.tail, this.headers());
      const channels = [], seen = /* @__PURE__ */ new Set();
      let title = "", duration = 0;
      function walk(node, depth = 0) {
        if (!node || typeof node !== "object" || depth > 6) return;
        if (Array.isArray(node)) {
          for (const child of node.slice(0, 100)) walk(child, depth + 1);
          return;
        }
        const meta = node.metadata;
        if (meta && (!meta.contentId || String(meta.contentId) === String(contentId))) {
          if (!title) {
            title = String(meta.title || "").slice(0, 160);
            duration = Number(meta.duration || 0);
          }
          for (const stream of (Array.isArray(meta.additionalStreams) ? meta.additionalStreams : []).slice(0, 64)) {
            const id = String(stream.channelId || "");
            if (!/^\d{1,12}$/.test(id) || seen.has(id)) continue;
            seen.add(id);
            channels.push({ id, title: String(stream.title || stream.reportingName || "").slice(0, 120), type: String(stream.type || "").slice(0, 60), default: stream.default === true });
          }
        }
        for (const key of ["resultObj", "containers", "items"]) walk(node[key], depth + 1);
      }
      walk(data);
      return { contentId: String(contentId), title, duration, channels };
    }
    async validateChannel(contentId, channelId) {
      if (channelId === void 0 || channelId === "") return "";
      const id = String(channelId);
      if (!/^\d{1,12}$/.test(id)) throw new ServiceError("Netinkamas F1 kanalo numeris.", 400);
      const available = await this.channels(contentId);
      if (!available.channels.some((channel) => channel.id === id)) throw new ServiceError("F1 nepateik\u0117 \u0161io kanalo pasirinktam \u012Fra\u0161ui.", 403);
      return id;
    }
    async live() {
      const ctx = await this.context();
      return normalizeItems(await this.json(ORIGIN + "/1.0/" + ctx.login + "/ENG/WEB_DASH/ALL/EVENTS/LIVENOW/" + ctx.tail, this.headers())).map((item) => ({ ...item, live: true }));
    }
    async playback(contentId, platform = "WEB_HLS", player = "player_bm", channelId = "") {
      var _a, _b;
      if (!["player_bm", "player_tm", "legacy-default"].includes(player)) throw new ServiceError("Netinkamas F1 grotuvo variantas.", 400);
      if (!["WEB_HLS", "WEB_DASH", "BIG_SCREEN_DASH"].includes(platform)) throw new ServiceError("Netinkamas F1 atk\u016Brimo profilis.", 400);
      if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError("Netinkamas turinio numeris.", 400);
      await this.context(true);
      const selectedChannel = await this.validateChannel(contentId, channelId);
      const version = platform === "WEB_HLS" ? ((_b = (_a = this.config) == null ? void 0 : _a.apiConfig) == null ? void 0 : _b.playAPIVersion) || "3.0" : "2.0";
      if (!/^\d+\.0$/.test(version)) throw new ServiceError("F1 pakeit\u0117 vaizdo API versij\u0105.");
      const resolve = (apiVersion) => this.json(ORIGIN + "/" + apiVersion + "/R/ENG/" + platform + "/ALL/CONTENT/PLAY?contentId=" + contentId + (player !== "legacy-default" ? "&player=" + player : "") + (selectedChannel ? "&channelId=" + selectedChannel : ""), this.headers());
      let data;
      try {
        data = await resolve(version);
      } catch (error) {
        if (version !== "3.0" || !(error.upstreamStatus >= 500)) throw error;
        data = await resolve("2.0");
      }
      const result = data.resultObj;
      const candidates = Array.isArray(result) ? result : result ? [result, ...result.streams || []] : [];
      const host = (url) => {
        try {
          return new URL(url).hostname;
        } catch {
          return "";
        }
      };
      this.playbackInfo = { contentId: String(contentId), platform, player, channelId: selectedChannel, candidates: candidates.map((stream2) => ({
        keys: Object.keys(stream2),
        manifestHost: host(stream2.url || stream2.manifestUrl),
        manifestRoute: (() => {
          try {
            return new URL(stream2.url || stream2.manifestUrl).pathname.split("/").slice(0, 12).map((part) => /^(?:\d+\.0|[A-Z_]+|)$/.test(part) ? part : "[value]").join("/");
          } catch {
            return "";
          }
        })(),
        manifestQueryKeys: (() => {
          try {
            return [...new URL(stream2.url || stream2.manifestUrl).searchParams.keys()];
          } catch {
            return [];
          }
        })(),
        licenceHost: host(stream2.laURL || stream2.laUrl || stream2.licenseUrl),
        drmType: stream2.drmType || "",
        streamType: stream2.streamType || "",
        pipelineVersion: stream2.pipelineVersion || "",
        playApiVersion: stream2.playApiVersion || "",
        hasLicence: Boolean(stream2.laURL || stream2.laUrl || stream2.licenseUrl)
      })) };
      const stream = parsePlayback(data);
      this.playbackInfo.hasDrmToken = Boolean(stream.drmToken);
      this.playbackInfo.streamEntitlementMatchesAccount = stream.entitlementToken === this.entitlement;
      this.playbackInfo.licenceQueryKeys = stream.licenseUrl ? [...new URL(stream.licenseUrl).searchParams.keys()] : [];
      if (stream.licenseUrl) {
        const route = new URL(stream.licenseUrl).pathname;
        this.playbackInfo.licenceRoute = /^(\/AGL)?\/\d+\.\d+\/[RA]\/[A-Z]{3}\/[A-Z_]+\/[A-Z]+\/CONTENT\/LA(?:\/(?:widevine|fairplay|playready))?$/i.test(route) ? route : "unrecognised path";
      }
      {
        await this.resolvePlayerManifest(stream, contentId, selectedChannel);
        const fetched = await this.mediaManifest(stream.manifestUrl);
        const response = fetched.response;
        stream.manifestUrl = fetched.url;
        stream.playCookie = stream.drm ? playbackCookie(response.headers, stream.manifestUrl, stream.licenseUrl) || stream.playCookie || "" : "";
        const mpd = await response.text();
        if (mpd.length > 2 * 1024 * 1024 || !/<MPD[\s\/>]/i.test(mpd)) throw new ServiceError("F1 nepateik\u0117 tinkamo vaizdo apra\u0161o.");
        stream.manifestXML = mpd;
        const codecs = [...mpd.matchAll(/\bcodecs=["']([^"']+)["']/gi)].map((match) => match[1]);
        const protection = [...mpd.matchAll(/<ContentProtection[^>]*\bvalue=["']([^"']+)["']/gi)].map((match) => match[1]);
        const baseUrls = [...mpd.matchAll(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/gi)].slice(0, 12).map((match) => {
          try {
            const url = new URL(match[1].trim().replace(/&amp;/g, "&"), stream.manifestUrl);
            return { host: url.hostname, queryKeys: [...url.searchParams.keys()], relative: !/^https:\/\//i.test(match[1]) };
          } catch {
            return { invalid: true };
          }
        });
        if (!stream.drm && /<ContentProtection\b/i.test(mpd)) throw new ServiceError("F1 nepateik\u0117 apsaugoto srauto licencijos duomen\u0173.", 422);
        stream.protection = [...new Set(protection)];
        stream.platform = platform;
        this.playbackInfo.manifest = { host: new URL(stream.manifestUrl).hostname, status: response.status, type: response.headers.get("content-type") || "", hasPlaybackCookie: Boolean(stream.playCookie), codecs: [...new Set(codecs)], protection: [...new Set(protection)], baseUrls };
      }
      return stream;
    }
    async inspectLegacyDash(contentId, platform = "WEB_DASH", player = "player_bm", channelId = "") {
      if (!["player_bm", "player_tm", "legacy-default"].includes(player)) throw new ServiceError("Netinkamas F1 grotuvo variantas.", 400);
      if (!["WEB_DASH", "BIG_SCREEN_DASH", "WEB_HLS"].includes(platform)) throw new ServiceError("Netinkamas F1 atk\u016Brimo profilis.", 400);
      if (!/^\d{1,12}$/.test(String(contentId))) throw new ServiceError("Netinkamas turinio numeris.", 400);
      await this.context(true);
      const selectedChannel = await this.validateChannel(contentId, channelId);
      const data = await this.json(ORIGIN + "/2.0/R/ENG/" + platform + "/ALL/CONTENT/PLAY?contentId=" + contentId + (player !== "legacy-default" ? "&player=" + player : "") + (selectedChannel ? "&channelId=" + selectedChannel : ""), this.headers());
      const stream = parsePlayback(data);
      await this.resolvePlayerManifest(stream, contentId, selectedChannel);
      const fetched = await this.mediaManifest(stream.manifestUrl);
      const response = fetched.response;
      stream.manifestUrl = fetched.url;
      const mpd = await response.text();
      if (mpd.length > 2 * 1024 * 1024 || !/<MPD[\s\/>]/i.test(mpd)) throw new ServiceError("F1 nepateik\u0117 tinkamo vaizdo apra\u0161o.");
      return {
        platform,
        player,
        contentId: String(contentId),
        channelId: selectedChannel,
        drm: stream.drm,
        streamType: stream.streamType,
        manifestHost: new URL(stream.manifestUrl).hostname,
        protection: [...new Set([...mpd.matchAll(/<ContentProtection[^>]*\bvalue=["']([^"']+)["']/gi)].map((match) => match[1]))],
        codecs: [...new Set([...mpd.matchAll(/\bcodecs=["']([^"']+)["']/gi)].map((match) => match[1]))]
      };
    }
    async license(stream, challenge) {
      if (!this.status().signedIn) throw new ServiceError("F1 prisijungimo sesija pasibaig\u0117.", 401);
      const headers = { ...this.headers(), "Content-Type": "application/octet-stream", Origin: ORIGIN, Referer: ORIGIN + "/" };
      if (stream.entitlementToken) headers.entitlementtoken = stream.entitlementToken;
      if (stream.drmToken) headers.customdata = stream.drmToken;
      if (stream.playCookie) headers.Cookie = stream.playCookie;
      this.licenceInfo = { host: new URL(stream.licenseUrl).hostname, hasPlaybackCookie: Boolean(stream.playCookie), hasDrmToken: Boolean(stream.drmToken), status: "pending" };
      let response;
      try {
        response = await this.request(approvedUrl(stream.licenseUrl, true), { method: "POST", headers, body: challenge });
        this.licenceInfo.status = response.status;
        this.licenceInfo.type = response.headers.get("content-type") || "";
      } catch (error) {
        this.licenceInfo.status = error.upstreamStatus || error.status;
        this.licenceInfo.type = error.upstreamType || "";
        throw error;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
      const errorDocument = /^(?:<!doctype|<html|<head|<body|<\?xml|<Error|\{\s*")/i.test(prefix);
      this.licenceInfo.byteLength = bytes.length;
      this.licenceInfo.transportFormat = bytes[0] === 8 && bytes[1] === 2 ? "Widevine signed message" : /^[A-Za-z0-9+\/=\s]+$/.test(new TextDecoder().decode(bytes)) ? "base64 text" : "other binary";
      this.licenceInfo.responseKind = errorDocument ? "error document" : "opaque binary";
      if (bytes.length < 16 || bytes.length > 1024 * 1024 || errorDocument) throw new ServiceError("F1 vietoje DRM licencijos pateik\u0117 netinkam\u0105 atsakym\u0105.", 502);
      return bytes;
    }
  }
  F1Client.prototype.request = async function(url, options, media) {
    options = options || {};
    approvedUrl(url, !media && options.method === "POST");
    var headers = {};
    Object.keys(options.headers || {}).forEach(function(name) {
      if (!/^(origin|referer|cookie|user-agent)$/i.test(name)) headers[name] = options.headers[name];
    });
    var controller = new AbortController(), timer = setTimeout(function() {
      controller.abort();
    }, 2e4), response;
    try {
      response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        signal: controller.signal,
        credentials: media ? "omit" : "include",
        redirect: media ? "follow" : "error"
      });
      if (response.url) approvedUrl(response.url, !media && options.method === "POST");
    } catch (error2) {
      throw new ServiceError("Televizorius nepasiek\u0117 F1 serverio. " + String(error2.name || "NetworkError"));
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      var error = new ServiceError("F1 u\u017Eklausa atmesta (HTTP " + response.status + ").", response.status === 401 || response.status === 403 ? 403 : 502);
      error.upstreamStatus = response.status;
      throw error;
    }
    return response;
  };
  var database = null;
  function db() {
    if (!database) database = new Promise(function(resolve, reject) {
      var open = indexedDB.open("apex-tv-private-session-v1", 1);
      open.onupgradeneeded = function() {
        open.result.createObjectStore("vault");
      };
      open.onsuccess = function() {
        resolve(open.result);
      };
      open.onerror = function() {
        reject(new Error("TV sesijos saugykla nepasiekiama."));
      };
    });
    return database;
  }
  async function vaultGet(name) {
    var store = await db();
    return new Promise(function(resolve, reject) {
      var tx = store.transaction("vault", "readonly"), q = tx.objectStore("vault").get(name);
      q.onsuccess = function() {
        resolve(q.result);
      };
      q.onerror = function() {
        reject(new Error("TV sesijos skaitymas nepavyko."));
      };
    });
  }
  async function vaultPut(name, value) {
    var store = await db();
    return new Promise(function(resolve, reject) {
      var tx = store.transaction("vault", "readwrite");
      tx.objectStore("vault").put(value, name);
      tx.oncomplete = resolve;
      tx.onerror = function() {
        reject(new Error("TV sesijos i\u0161saugojimas nepavyko."));
      };
    });
  }
  var vault = {
    save: async function(token) {
      var key = await vaultGet("key");
      if (!key) {
        key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await vaultPut("key", key);
      }
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
      await vaultPut("session", { iv, ciphertext: encrypted });
      await vaultPut("linked", true);
    },
    load: async function() {
      var session = await vaultGet("session"), key = await vaultGet("key");
      if (!session || !key) return "";
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: session.iv }, key, session.ciphertext));
    },
    clear: async function() {
      await vaultPut("session", null);
    }
  };
  var client = new F1Client({ vault }), discovery = window.ApexDiscovery.create(client), editorial = window.ApexEditorial.create(client), tickets = {}, ready = null;
  function companion(ctx, path, body) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", ctx.server + path);
      xhr.timeout = 2e4;
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("X-Apex-Key", ctx.key);
      xhr.onload = function() {
        if (xhr.status !== 200) {
          reject(new Error("TV sesijos susiejimas nepavyko (HTTP " + xhr.status + ")."));
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error("TV sesijos atsakymas netinkamas."));
        }
      };
      xhr.onerror = xhr.ontimeout = function() {
        reject(new Error("Pirmam susiejimui nepasiekiamas kompiuteris."));
      };
      xhr.send(JSON.stringify(body));
    });
  }
  async function provision(ctx) {
    var own = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    var envelope = await companion(ctx, "/api/tv-session", { publicKey: await crypto.subtle.exportKey("jwk", own.publicKey) });
    var raw = decode64(envelope.payload);
    if (!await verifySignature(window.APEX_CONFIG.publicKey, raw, decode64(envelope.signature))) throw new Error("TV sesijos para\u0161as netinkamas.");
    var data = JSON.parse(new TextDecoder().decode(raw));
    if (data.version !== 1) throw new Error("TV sesijos versija netinkama.");
    var sender = await crypto.subtle.importKey("jwk", data.publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
    var secret = await crypto.subtle.deriveBits({ name: "ECDH", public: sender }, own.privateKey, 256);
    var aes = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, ["decrypt"]);
    var token = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode64(data.iv) }, aes, decode64(data.ciphertext)))).token;
    await client.signIn(token);
    return client.status();
  }
  async function retrieveSession(savedToken) {
    var accountToken = savedToken || client.token;
    if (!accountToken) return;
    var payload = JSON.parse(new TextDecoder().decode(decode64(accountToken.split(".")[1])));
    if (!payload.SessionId) throw new Error("F1 sesijai reikia naujo prisijungimo televizoriuje.");
    var data = await client.request("https://api.formula1.com/v1/account/Subscriber/RetrieveSubscriber", { method: "POST", headers: {
      apiKey: "fCUCjWrKPu9ylJwRAv8BpGLEgiAuThx7",
      "CD-Language": "en-US",
      "CD-SystemId": "60a9ad84-e93d-480f-80d6-af37494f2e22",
      "cd-sessionid": payload.SessionId,
      "Content-Type": "application/json",
      orderSubmitted: "true"
    }, body: "{}" });
    var account = await data.json(), token = account.data && account.data.subscriptionToken;
    client.refreshInfo = { keys: Object.keys(account).slice(0, 15), dataKeys: Object.keys(account.data || {}).slice(0, 15), responseCode: account.ResponseCode || account.ErrorCode || "", hasSessionId: Boolean(payload.SessionId), faultKeys: Object.keys(account.Fault || {}), faultCode: account.Fault && (account.Fault.Code || account.Fault.ErrorCode) || "", faultMessage: account.Fault && String(account.Fault.Message || "").slice(0, 100) };
    if (!token) throw new Error("F1 sesija neatnaujinta. Prisijunk televizoriuje.");
    await client.signIn(token);
    return client.status();
  }
  var accountRenewal = null;
  function refreshSession(savedToken) {
    var token = savedToken || client.token;
    if (!token) return Promise.resolve();
    if (accountRenewal && accountRenewal.token === token) return accountRenewal.promise;
    var pending = { token: token, promise: null };
    pending.promise = retrieveSession(token).finally(function () { if (accountRenewal === pending) accountRenewal = null; });
    accountRenewal = pending;
    return pending.promise;
  }
  async function renewAccount(force) {
    if (!client.token) return false;
    if (!force && client.expires > Date.now()/1000 + 300) return false;
    await refreshSession();
    return true;
  }
  async function renewPlaybackSession(session, force) {
    if (!force && session.accountToken === client.token) return;
    if (!session.renewing) session.renewing = (async function () {
      var next = await client.playback(session.id, 'WEB_DASH', 'legacy-default', session.channelId);
      if (next.drm !== session.stream.drm) throw new Error('F1 pakeitė šios transliacijos apsaugos profilį.');
      next.audioTrackId = session.stream.audioTrackId;
      session.stream = next; session.accountToken = client.token;
    })().finally(function () { session.renewing = null; });
    await session.renewing;
  }
  async function login(email, password) {
    if (typeof email !== "string" || email.length > 254 || typeof password !== "string" || password.length > 512) throw new Error("Patikrink prisijungimo duomenis.");
    var response = await client.request("https://api.formula1.com/v2/account/subscriber/authenticate/by-password", { method: "POST", headers: { apiKey: "fCUCjWrKPu9ylJwRAv8BpGLEgiAuThx7", "Content-Type": "application/json" }, body: JSON.stringify({ Login: email, Password: password, DistributionChannel: "d861e38f-05ea-4063-8776-a7e2b6d885a4" }) });
    var data = await response.json(), token = data.data && data.data.subscriptionToken;
    if (!token) throw new Error("F1 nepatvirtino prisijungimo.");
    await client.signIn(token);
    return client.status();
  }
  function initialize() {
    if (!ready) ready = (async function() {
      client.config = await client.json("https://f1tv.formula1.com/config");
      var saved = await vault.load();
      if (saved) await vaultPut("linked", true);
      if (saved) try {
        await client.signIn(saved, false);
        if (client.expires < Date.now() / 1e3 + 1800) await refreshSession(saved);
      } catch (error) {
        if (!client.status().signedIn) try {
          await refreshSession(saved);
        } catch (renewal) {
          client.token = "";
          client.entitlement = "";
          client.location = null;
          client.error = "F1 sesija pasibaig\u0117. Prisijunk televizoriuje.";
        }
      }
    })();
    return ready;
  }
  async function request(route, method, data, binary) {
    await initialize();
    var url = new URL(route, "https://apex-tv.local");
    if (url.pathname === "/api/status") return { account: client.status(), revision: window.APEX_CONTEXT.revision };
    if (url.pathname === "/api/catalog") return { items: await client.page(url.searchParams.get("page") || "493") };
    if (url.pathname === "/api/detail") return { items: await client.detail(url.searchParams.get("id")) };
    if (url.pathname === "/api/live") return { items: await client.live() };
    if (url.pathname === "/api/search") return discovery.search(url.searchParams.get("q"));
    if (url.pathname === "/api/weekend") return discovery.weekend();
    if (url.pathname === "/api/editorial") return editorial.load(url.searchParams.get("group"), {force:url.searchParams.get("refresh")==="1"});
    if (url.pathname === "/api/channels") return await client.channels(url.searchParams.get("id"));
    if (url.pathname === "/api/diagnostics") {
      var events = await vaultGet("events") || [];
      events.push(Object.assign({ time: (/* @__PURE__ */ new Date()).toISOString() }, data));
      await vaultPut("events", events.slice(-60));
      return { ok: true };
    }
    if (url.pathname === "/api/play") {
      await renewAccount(false);
      var stream = await client.playback(data.id, "WEB_DASH", "legacy-default", data.channelId || "");
      var selectedAudio = window.ApexViewOptions.selectAudio(stream.manifestXML, data.audioTrackId, data.audioLanguage);
      stream.audioTrackId = selectedAudio ? selectedAudio.id : "";
      var ticket = encode64(crypto.getRandomValues(new Uint8Array(24))).replace(/[^A-Za-z0-9]/g, "");
      Object.keys(tickets).forEach(function(key) {
        if (tickets[key].expires < Date.now()) delete tickets[key];
      });
      tickets[ticket] = { stream, id: String(data.id), channelId: String(data.channelId || ""), accountToken: client.token, expires: Date.now() + 4 * 60 * 60 * 1e3 };
      return { manifestXML: stream.manifestXML, audioTracks: window.ApexViewOptions.audioTracks(stream.manifestXML), audioTrackId: stream.audioTrackId, channelId: String(data.channelId || ""), manifestUrl: stream.manifestUrl, licenseUrl: stream.licenseUrl, licenseHeaders: Object.assign({}, client.headers(), stream.entitlementToken ? { entitlementtoken: stream.entitlementToken } : {}, stream.drmToken ? { customdata: stream.drmToken } : {}), drm: stream.drm, ticket, streamType: stream.streamType, platform: "WEB_DASH", protection: stream.protection, browserTest: true, compatibilityStart: true };
    }
    var license = url.pathname.match(/^\/api\/license\/([A-Za-z0-9]+)$/);
    if (license && method === "POST") {
      var session = tickets[license[1]];
      if (!session || session.expires < Date.now()) throw new Error("Vaizdo sesija pasibaig\u0117.");
      await renewAccount(false);
      await renewPlaybackSession(session, false);
      var challenge = new Uint8Array(data), licensed;
      try { licensed = await client.license(session.stream, challenge); }
      catch (error) {
        if (Number(error.upstreamStatus || error.status) !== 401) throw error;
        await renewAccount(true);
        await renewPlaybackSession(session, true);
        licensed = await client.license(session.stream, challenge);
      }
      return licensed.buffer.slice(licensed.byteOffset, licensed.byteOffset + licensed.byteLength);
    }
    throw new Error("TV u\u017Eklausa nepalaikoma.");
  }
  window.ApexStandalone = { canProvision: function() {
    return vaultGet("linked").then(function(linked) {
      return !linked;
    });
  }, events: function() {
    return vaultGet("events").then(function(events) {
      return events || [];
    });
  }, client, initialize, request, provision, refresh: refreshSession, login, signOut: function() {
    editorial.clear(); discovery.clear();
    return client.signOut();
  } };
})();
