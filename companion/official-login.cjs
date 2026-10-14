'use strict';
function formulaHost(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password &&
    (!u.port || u.port === '443') && (u.hostname === 'formula1.com' || u.hostname.endsWith('.formula1.com')); }
  catch { return false; }
}
function officialLoginUrl(config) {
  const source = config?.authLinks?.login || 'https://account.formula1.com/#/{lang}/login?redirect=';
  const url = source.replace('{lang}', 'en') + encodeURIComponent('https://f1tv.formula1.com');
  if (!formulaHost(url)) throw new Error('F1 prisijungimo adresas nepatvirtintas.');
  return url;
}
function sessionFromCookie(cookie) {
  if (!cookie || cookie.name !== 'login-session' ||
      !/^\.?([a-z0-9-]+\.)*formula1\.com$/i.test(cookie.domain || '') ||
      typeof cookie.value !== 'string' || cookie.value.length > 64000) return '';
  try {
    // F1 can set this cookie without a Secure attribute on its HTTPS page.
    // The caller enforces HTTPS provenance and F1Client verifies the JWT.
    const value = JSON.parse(decodeURIComponent(cookie.value));
    const token = value.data?.subscriptionToken || value.subscriptionToken;
    return typeof token === 'string' && token.length <= 32000 && token.split('.').length === 3 ? token : '';
  } catch { return ''; }
}
function cookieObservation(cookie) {
  if (!cookie || cookie.name !== 'login-session' ||
      !/^\.?([a-z0-9-]+\.)*formula1\.com$/i.test(cookie.domain || '')) return { found: false };
  let value;
  try { value = JSON.parse(decodeURIComponent(cookie.value)); } catch { return { found: true, secure: !!cookie.secure, format: 'other', tokenPresent: false }; }
  const candidate = value.data?.subscriptionToken || value.subscriptionToken;
  return { found: true, secure: !!cookie.secure, format: 'json',
    tokenPresent: typeof candidate === 'string' && candidate.length > 0,
    acceptedShape: !!sessionFromCookie(cookie) };
}
module.exports = { formulaHost, officialLoginUrl, sessionFromCookie, cookieObservation };
