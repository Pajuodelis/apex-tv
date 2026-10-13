/* Device-local viewing preferences. No account secrets, URLs or DRM material. */
(function (global) {
  'use strict';
  var KEY = 'apex-experience-v1', PAGE_SIZE = 24;
  function text(value, max) { return String(value || '').replace(/[\x00-\x1f]/g, '').slice(0, max || 240); }
  function item(raw) {
    if (!raw || !/^\d{1,12}$/.test(String(raw.id)) || !text(raw.title)) return null;
    var result = { id: String(raw.id), title: text(raw.title), kind: ['page','detail','video'].indexOf(raw.kind) >= 0 ? raw.kind : 'video', duration: Math.max(0, Math.min(604800, Number(raw.duration) || 0)), live: raw.live === true };if(global.ApexDiscovery){result.image=global.ApexDiscovery.picture(raw.image);result.subtitle=text(raw.subtitle,180);result.location=text(raw.location,100);['start','end','meetingStart','meetingEnd'].forEach(function(k){result[k]=global.ApexDiscovery.date(raw[k]);});}return result;
  }
  function blank() { return { version: 1, favorites: [], progress: [], recent: [], preferences: { largeText: false, highContrast: false, autoQuality: true, reduceMotion: false } }; }
  function cleanList(list, limit, convert) {
    var out = [], seen = {};
    if (Array.isArray(list)) list.slice(0, 200).forEach(function (raw) { var value = convert(raw); if (value && !seen[value.id] && out.length < limit) { seen[value.id] = true; out.push(value); } });
    return out;
  }
  function sanitize(raw) {
    var state = blank(); if (!raw || raw.version !== 1) return state;
    state.favorites = cleanList(raw.favorites, 60, function (v) { var i = item(v); return i && !i.live && i.kind === 'video' ? i : null; });
    state.progress = cleanList(raw.progress, 50, function (v) {
      var i = item(v); if (!i || i.live || i.kind !== 'video') return null;
      i.position = Math.max(0, Math.min(i.duration || 604800, Number(v.position) || 0));
      i.updated = Math.max(0, Math.min(Date.now() + 60000, Number(v.updated) || 0));
      i.completed = v.completed === true || completed(i.position, i.duration); return i;
    });
    state.recent = cleanList(raw.recent, 12, function (v) { var i = item(v); return i && i.kind !== 'video' ? i : null; });
    state.preferences.reduceMotion = Boolean(raw.preferences && raw.preferences.reduceMotion);
    state.preferences.largeText = Boolean(raw.preferences && raw.preferences.largeText);
    state.preferences.highContrast = Boolean(raw.preferences && raw.preferences.highContrast);
    state.preferences.autoQuality = !raw.preferences || raw.preferences.autoQuality !== false;
    return state;
  }
  function completed(position, duration) { return duration > 120 && position >= 60 && (position / duration >= 0.95 || duration - position <= 60); }
  function resume(entry) { return entry && !entry.completed && entry.position >= 20 && (!entry.duration || entry.position < entry.duration - 20) ? Math.floor(entry.position) : 0; }
  function store(storage, now) {
    now = now || Date.now; var state = blank(), writable = Boolean(storage);
    try { var raw = storage && storage.getItem(KEY); if (raw && raw.length < 350000) state = sanitize(JSON.parse(raw)); } catch (_) { writable = false; }
    function save() { try { if (storage) { storage.setItem(KEY, JSON.stringify(state)); writable = true; } } catch (_) { writable = false; } }
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    return {
      getPreference: function (name) { return Object.prototype.hasOwnProperty.call(state.preferences,name) ? state.preferences[name] : undefined; },
      state: function () { return copy(state); }, writable: function () { return writable; },
      get: function (id) { return copy(state.progress.filter(function (v) { return v.id === String(id); })[0] || null); },
      isFavorite: function (id) { return state.favorites.some(function (v) { return v.id === String(id); }); },
      favorite: function (raw) {
        var i = item(raw); if (!i || i.live || i.kind !== 'video') return false;
        var found = state.favorites.some(function (v) { return v.id === i.id; });
        state.favorites = state.favorites.filter(function (v) { return v.id !== i.id; });
        if (!found) state.favorites.unshift(i); state.favorites = state.favorites.slice(0,60); save(); return !found;
      },
      record: function (raw, position, duration, ended) {
        var i = item(raw); if (!i || i.live || i.kind !== 'video' || !Number.isFinite(position) || position < 0) return;
        i.duration = Math.max(0, Math.min(604800, Number(duration) || i.duration)); i.position = Math.min(i.duration || 604800, position);
        i.updated = now(); i.completed = Boolean(ended) || completed(i.position, i.duration);
        state.progress = state.progress.filter(function (v) { return v.id !== i.id; }); state.progress.unshift(i); state.progress = state.progress.slice(0,50); save();
      },
      recent: function (raw) { var i = item(raw); if (!i || i.kind === 'video') return; state.recent = state.recent.filter(function (v) { return v.id !== i.id; }); state.recent.unshift(i); state.recent = state.recent.slice(0,12); save(); },
      preference: function (name, value) { if (name === 'largeText' || name === 'highContrast' || name === 'autoQuality' || name === 'reduceMotion') { state.preferences[name] = Boolean(value); save(); } },
      clearHistory: function () { state.progress = []; state.recent = []; save(); },
      clearAccount: function () { state.progress = []; state.recent = []; state.favorites = []; save(); }
    };
  }
  function fold(s) { s = text(s).toLowerCase(); return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s; }
  function category(raw) {
    var name = fold(raw.title);
    if (/\bkids\b/.test(name)) return 'kids';
    if (/\brace\s+in\s+30\b/.test(name)) return 'race30';
    if (/highlights|svarbiausi|momentai/.test(name)) return 'highlights';
    if (/practice|treniruot/.test(name)) return 'practice';
    if (/sprint/.test(name)) return 'sprint';
    if (/qualifying|qualification|kvalifik/.test(name)) return 'qualifying';
    if (/race|lenktyn/.test(name)) return 'race'; return 'other';
  }
  function select(items, query, filter, sort) {
    var tokens = fold(query).trim().split(/\s+/).filter(Boolean);
    var result = items.map(function (v, i) { return { value: v, index: i }; }).filter(function (entry) {
      return (!filter || filter === 'all' || category(entry.value) === filter) && tokens.every(function (t) { return fold(entry.value.title).indexOf(t) >= 0; });
    });
    if (sort && sort !== 'default') result.sort(function (a,b) {
      var order = 0;
      if (sort === 'duration') order = (Number(b.value.duration)||0) - (Number(a.value.duration)||0);
      else if (sort === 'year') order = Number((b.value.title.match(/(?:19|20)\d{2}/)||[])[0]||0)-Number((a.value.title.match(/(?:19|20)\d{2}/)||[])[0]||0);
      else order = fold(a.value.title).localeCompare(fold(b.value.title));
      return order || a.index-b.index;
    });
    return result.map(function (entry) { return entry.value; });
  }
  function page(items, index) { var count = Math.max(1,Math.ceil(items.length/PAGE_SIZE)); index = Math.min(count-1,Math.max(0,Math.floor(Number(index)||0))); return { items: items.slice(index*PAGE_SIZE,(index+1)*PAGE_SIZE), index: index, count: count, total: items.length }; }
  function cache(now) {
    var entries = {}, order = []; now = now || Date.now;
    return {
      put: function (key, value) { entries[key] = { items: value.slice(0,100), at: now() }; order = order.filter(function (v) { return v !== key; }); order.push(key); while (order.length>30) delete entries[order.shift()]; },
      get: function (key, ttl) { var v = entries[key]; return v && (ttl === undefined || now()-v.at <= ttl) ? { items: v.items.slice(), at: v.at } : null; },
      clear: function () { entries = {}; order = []; }
    };
  }
  function time(seconds) { seconds = Math.max(0, Math.floor(Number(seconds)||0)); var h = Math.floor(seconds/3600), m = Math.floor(seconds/60)%60, s=seconds%60; return (h ? h+':'+('0'+m).slice(-2) : String(m))+':'+('0'+s).slice(-2); }
  function seekTarget(position, seconds, duration) { return Math.max(0, Math.min(Math.max(0, duration-1), position+seconds)); }
  function explain(raw) {
    var value = text(raw, 300).replace(/https?:\/\/\S+/g, '[adresas]');
    if (/401|prisijung|session|sesij|token.*expired/i.test(value)) return 'F1 sesija baigėsi. Prisijunk dar kartą skiltyje „Nustatymai“.';
    if (/403|prenumerat|region|licenc/i.test(value)) return 'F1 nepriėmė atkūrimo užklausos. Patikrink paskyrą, prenumeratą ir regioną; tada bandyk dar kartą.';
    if (/network|connection|tink|nepasieki|timeout|laikas|502|503/i.test(value)) return 'Nepavyko pasiekti F1 arba vaizdo serverio. Patikrink internetą ir bandyk dar kartą.';
    return value || 'Vaizdo paleisti nepavyko. Bandyk dar kartą arba pasirink kitą įrašą.';
  }
  var api = { store: store, cache: cache, item: item, select: select, page: page, category: category, resume: resume, completed: completed, time: time, seekTarget: seekTarget, explain: explain, PAGE_SIZE: PAGE_SIZE };
  global.ApexExperience = api; if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
