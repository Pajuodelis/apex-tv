'use strict';
let csrf = '';
const el = id => document.getElementById(id);
async function api(url, method = 'GET', payload) {
  const response = await fetch(url, { method, headers: method === 'POST' ? { 'X-Apex-CSRF': csrf, 'Content-Type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Užklausa nepavyko.'); return data;
}
async function refresh() {
  try {
    const data = await api('/admin/state'); csrf = data.csrf;
    el('account').textContent = data.account.signedIn ? 'Prisijungta prie F1 TV · regionas ' + data.account.country : data.account.error || 'Dar neprisijungta prie F1 TV.';
    el('connection').textContent = 'TV: ' + data.config.tvAddress + ' · Kompiuteris: ' + data.config.pcAddress;
    el('version').textContent = 'Versija 0.1.2 · ' + data.revision.slice(0, 12);
    el('diagnostics').textContent = data.diagnostics.length ? data.diagnostics.map(e => e.time.slice(11, 19) + ' ' + e.event + ' ' + (e.error || e.engine || e.model || '')).join('\n') : 'Dar nėra TV patikros.';
  } catch (error) { el('message').textContent = error.message; }
}
function action(id, fn) {
  el(id).addEventListener('click', async () => { el(id).disabled = true; el('message').textContent = '';
    try { await fn(); await refresh(); } catch (error) { el('message').textContent = error.message; } finally { el(id).disabled = false; }
  });
}
action('login', () => api('/admin/login', 'POST'));
action('logout', () => api('/admin/logout', 'POST'));
action('restart', async () => { await api('/admin/restart', 'POST'); el('message').textContent = 'Apex TV perkraunama. Išsaugotas F1 prisijungimas bus atkurtas.'; });
action('publish', async () => { await api('/admin/publish', 'POST'); el('message').textContent = 'Nauja meniu versija paruošta. Televizoriuje ji bus įkelta kitą kartą paleidžiant programėlę.'; });
action('tv-check', async () => { const data = await api('/admin/tv'); el('tv-state').textContent = data.model + ' · Developer Mode: ' + (data.developerMode === '1' ? 'įjungtas' : 'išjungtas') + ' · Kompiuterio IP televizoriuje: ' + data.developerIP; });
action('preview', async () => { el('tv-preview').hidden = false; el('tv-preview').src = '/preview/'; });
action('qualifying', async () => { const data = await api('/admin/play-on-tv', 'POST', { id: '1000010395' }); el('message').textContent = 'TV perduotas įrašas: ' + data.title + '. Televizoriuje turi būti atidaryta Apex TV.'; });
refresh(); setInterval(refresh, 3000);
