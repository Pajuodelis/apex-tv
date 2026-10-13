import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import vm from 'node:vm';
import { buildRelayManifest, resolveRelayAsset, rebaseMedia, mediaRange } from '../companion/media.mjs';
import { F1Client, normalizeItems, parsePlayback, playbackCookie, approvedUrl } from '../companion/f1.mjs';
import { Releases } from '../companion/releases.mjs';
import { recoverInstalledIdentity } from '../companion/identity.mjs';
import { createApp } from '../companion/server.mjs';
import { root } from '../companion/paths.mjs';
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({format:'jwk'}), kid:'test-key' };
function jwt(payload, signingKey=keys.privateKey) {
  const parts=[Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url')];
  return parts.join('.')+'.'+crypto.sign('RSA-SHA256',Buffer.from(parts.join('.')),signingKey).toString('base64url');
}
test('nested catalogue retains folders and playable sessions without duplicates',()=>{
  const session={metadata:{contentId:42,title:'Race',objectType:'VIDEO'}};
  const data={resultObj:{containers:[{items:[{metadata:{contentId:10,title:'2026'},actions:[{key:'onClick',uri:'/2.0/A/ENG/WEB_DASH/ALL/PAGE/999/ANONYMOUS/2'}]},session,session]}]}};
  assert.deepEqual(normalizeItems(data).map(x=>[x.id,x.kind]),[['999','page'],['42','video']]);
});
test('protected playback requires a supplied Widevine licence endpoint',()=>{
  const wrap=x=>({resultCode:'OK',resultObj:x});
  assert.throws(()=>parsePlayback(wrap({url:'https://vod.formula1.com/test.mpd',drmType:'widevine'})),/licencijos adreso/);
  assert.throws(()=>parsePlayback(wrap({url:'https://vod.formula1.com/test.mpd',drmType:'fairplay'})),/DRM/);
  assert.throws(()=>parsePlayback(wrap({url:'https://formula1.com.attacker.example/test.mpd'})),/neatpažintą/);
  assert.equal(parsePlayback(wrap({url:'https://vod.formula1.com/test.mpd',drmType:'widevine',laURL:'https://drm.formula1.com/license'})).drm,'widevine');
});
test('sign-in rejects expired and forged sessions before exposing authenticated state',async()=>{
  const client=new F1Client({fetcher:async()=>new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}})});
  const payload={exp:Math.floor(Date.now()/1000)+600};
  assert.equal((await client.verifyToken(jwt(payload))).exp,payload.exp);
  await assert.rejects(client.verifyToken(jwt({exp:1})),/pasibaigė/);
  const wrong=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  await assert.rejects(client.verifyToken(jwt(payload,wrong.privateKey)),/parašas/);
  assert.equal(client.status().signedIn,false);
});
test('licence relay preserves the device challenge and the returned licence bytes',async()=>{
  const challenge=Buffer.from([0,2,255,12,43]); const licence=crypto.randomBytes(128); let captured;
  const client=new F1Client({fetcher:async(url,opts)=>{captured={url,opts};return new Response(licence,{headers:{'Content-Type':'application/octet-stream'}});}});
  client.token='test-account-session';client.entitlement='test-entitlement';client.expires=Date.now()/1000+600;
  const result=await client.license({licenseUrl:'https://drm.formula1.com/license',drmToken:'test-playback-entitlement'},challenge);
  assert.deepEqual(Buffer.from(captured.opts.body),challenge);
  assert.deepEqual(result,licence);
  assert.equal(captured.opts.headers.customdata,'test-playback-entitlement');
  assert.equal(captured.opts.redirect,'error');
});
test('updates are signed and published assets remain immutable',async(t)=>{
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'apex-release-test-'));
  t.after(()=>fs.rm(scratch,{recursive:true,force:true}));
  await fs.mkdir(path.join(scratch,'web/vendor'),{recursive:true});
  await fs.writeFile(path.join(scratch,'web/vendor/dash.all-4.7.4.min.js'),'/* player fixture */');
  await fs.writeFile(path.join(scratch,'web/f1-browser.js'),'/* TV client fixture */');
  await fs.writeFile(path.join(scratch,'web/cbcs-audio.js'),'/* CBCS fixture */');
  await fs.writeFile(path.join(scratch,'web/emss-player.js'),'/* EMSS fixture */');
  await fs.writeFile(path.join(scratch,'web/native-relay.js'),'/* Socket fixture */');
  await fs.writeFile(path.join(scratch,'web/dash-manifest.js'),'/* DASH XML fixture */');await fs.writeFile(path.join(scratch,'web/tv-media.js'),'/* TV media fixture */');
  await fs.writeFile(path.join(scratch,'web/experience.js'),'/* experience fixture */');
  await fs.writeFile(path.join(scratch,'web/view-options.js'),'/* viewing choices fixture */');
  await fs.writeFile(path.join(scratch,'web/video-quality.js'),'/* video quality fixture */');
  await fs.writeFile(path.join(scratch,'web/tv-app.js'),'version one');
  await fs.writeFile(path.join(scratch,'web/tv.css'),'body{}');
  await fs.writeFile(path.join(scratch,'web/vendor/qrcode.js'),'/* QR fixture */');await fs.writeFile(path.join(scratch,'web/setup-checks.js'),'/* setup fixture */');
  const added=['i18n.js','timeline.js','ui-performance.js','discovery.js','editorial.js','playback-health.js','favorite-driver.js','online-updates.js'];for(const name of added)await fs.writeFile(path.join(scratch,'web',name),'/* '+name+' fixture */');const prefix='/* QR fixture */\n;\n/* setup fixture */\n;\n'+added.map(name=>'/* '+name+' fixture */\n;\n').join('');
  const releases=new Releases(scratch,keys.privateKey);
  const first=await releases.publish();
  assert.equal(crypto.verify('RSA-SHA256',Buffer.from(first.manifest.payload,'base64'),keys.publicKey,Buffer.from(first.manifest.signature,'base64')),true);
  assert.equal(crypto.verify('RSA-SHA256',Buffer.from('tampered'),keys.publicKey,Buffer.from(first.manifest.signature,'base64')),false);
  await fs.writeFile(path.join(scratch,'web/tv-app.js'),'version two');
  const second=await releases.publish();
  assert.notEqual(first.revision,second.revision);
  assert.equal(releases.get(first.revision,'tv-app.js').toString(),prefix+'/* video quality fixture */\n;\n/* experience fixture */\n;\n/* viewing choices fixture */\n;\n/* player fixture */\n;\n/* TV client fixture */\n;\n/* CBCS fixture */\n;\n/* EMSS fixture */\n;\n/* Socket fixture */\n;\n/* DASH XML fixture */\n;\n/* TV media fixture */\n;\nversion one');
  assert.equal(releases.get(second.revision,'tv-app.js').toString(),prefix+'/* video quality fixture */\n;\n/* experience fixture */\n;\n/* viewing choices fixture */\n;\n/* player fixture */\n;\n/* TV client fixture */\n;\n/* CBCS fixture */\n;\n/* EMSS fixture */\n;\n/* Socket fixture */\n;\n/* DASH XML fixture */\n;\n/* TV media fixture */\n;\nversion two');
});
test('HTTP service protects account actions and never exports account tokens to the TV',async(t)=>{
  const config={pcAddress:'192.168.50.10',tvAddress:'192.168.50.20',port:8317};
  const client={
    status:()=>({signedIn:true,country:'LT'}),
    playback:async()=>({manifestUrl:'https://vod.formula1.com/test.mpd',drm:'widevine',licenseUrl:'https://drm.formula1.com/license',drmToken:'private-play-token',entitlementToken:'private-account-token'}),
    license:async()=>Buffer.from('opaque-test-licence'),
    inspectLegacyDash:async()=>({platform:'WEB_DASH',drm:'widevine',protection:['cbcs']}),
    signOut:async()=>{}
  };
  const app=await createApp({root,client,setupData:{config,pairingKey:'test-pairing',privateKey:keys.privateKey,publicKey:jwk}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.server.address().port;
  const request=(endpoint,options={})=>new Promise((resolve,reject)=>{const req=http.request(url+endpoint,{method:options.method||'GET',headers:{Host:'127.0.0.1:8317',...options.headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,text:async()=>text,json:async()=>JSON.parse(text)});});});req.on('error',reject);if(options.body)req.write(options.body);req.end();});
  assert.equal((await request('/health',{headers:{Origin:'https://attacker.example'}})).status,403);
  assert.equal((await request('/api/status')).status,401);
  const preview=await request('/preview/');assert.equal(preview.status,200);const previewHTML=await preview.text();assert.match(previewHTML,/src="menu-cache.js"/);assert.doesNotMatch(previewHTML,/\$WEBAPIS|src="bundled-version.js"/);
  assert.equal((await request('/preview/menu-cache.js')).status,200);const previewBoot=await request('/preview/boot.js');assert.equal(previewBoot.status,200);assert.match(await previewBoot.text(),/ApexMenuCache\.download/);assert.equal((await request('/preview/',{headers:{Origin:'https://attacker.example'}})).status,403);
  assert.equal((await request('/api/tv-session',{method:'POST',headers:{'X-Apex-Key':'test-pairing'},body:'{}'})).status,403);
  assert.equal((await request('/admin/logout',{method:'POST',headers:{Origin:'http://127.0.0.1:8317'}})).status,403);
  assert.equal((await request('/api/token',{headers:{'X-Apex-Key':'test-pairing'}})).status,404);
  assert.equal((await request('/admin/format-check',{method:'POST',body:'{"id":42}'})).status,403);
  const adminState=await (await request('/admin/state')).json();
  const format=await request('/admin/format-check',{method:'POST',headers:{Origin:'http://127.0.0.1:8317','X-Apex-CSRF':adminState.csrf},body:'{"id":42}'});
  assert.equal(format.status,200);
  assert.deepEqual(await format.json(),{platform:'WEB_DASH',drm:'widevine',protection:['cbcs']});
  const playback=await request('/api/play',{method:'POST',headers:{'X-Apex-Key':'test-pairing','Content-Type':'application/json'},body:JSON.stringify({id:42})});
  assert.equal(playback.status,200);
  const payload=await playback.text();
  const firstTicket=JSON.parse(payload).ticket;
  const secondPlayback=await request('/api/play',{method:'POST',headers:{'X-Apex-Key':'test-pairing','Content-Type':'application/json'},body:JSON.stringify({id:43})});
  assert.equal(secondPlayback.status,200);
  assert.notEqual((await secondPlayback.json()).ticket,firstTicket);
  const firstLicence=await request('/api/license/'+firstTicket,{method:'POST',headers:{'X-Apex-Key':'test-pairing'},body:'unchanged-device-challenge'});
  assert.equal(firstLicence.status,200);
  assert.equal(await firstLicence.text(),'opaque-test-licence');
  assert.ok(!payload.includes('private-play-token')&&!payload.includes('private-account-token')&&!payload.includes('licenseUrl'));
  const manifest=await (await request('/update/manifest.json')).json();
  const decoded=JSON.parse(Buffer.from(manifest.payload,'base64'));
  const anonymousAsset=await request(decoded.files[0].path);
  assert.equal(anonymousAsset.status,200);
  assert.equal(anonymousAsset.headers['access-control-allow-origin'],'*');
  assert.equal('sha256-'+crypto.createHash('sha256').update(await anonymousAsset.text()).digest('base64'),decoded.files[0].integrity);
  assert.equal((await request(decoded.files[0].path,{headers:{Origin:'null'}})).headers['access-control-allow-origin'],'*');
});

test('Samsung file origin is accepted only from the paired TV and cannot reach account controls',async(t)=>{
  const config={pcAddress:'192.168.50.10',tvAddress:'127.0.0.2',port:8317};
  const client={status:()=>({signedIn:true,country:'LT'})};
  const app=await createApp({root,client,setupData:{config,pairingKey:'paired-tv-test',privateKey:keys.privateKey,publicKey:jwk}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const port=app.server.address().port;
  const request=(endpoint,localAddress='127.0.0.2',extraHeaders={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:endpoint,localAddress,headers:{Host:'127.0.0.1:8317',Origin:'file://',...extraHeaders}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end();
  });
  const manifest=await request('/update/manifest.json');
  assert.equal(manifest.status,200);
  const decoded=JSON.parse(Buffer.from(JSON.parse(manifest.text).payload,'base64'));
  const asset=await request(decoded.files.find(x=>x.name==='tv.css').path);
  assert.equal(asset.status,200);
  assert.equal(asset.headers['access-control-allow-origin'],'*');
  assert.equal((await request('/health','127.0.0.1')).status,403);
  assert.equal((await request('/admin/state')).status,403);
  assert.equal((await request('/api/status')).status,401);
  assert.equal((await request('/api/status','127.0.0.2',{'X-Apex-Key':'paired-tv-test'})).status,200);
});
test('playback can recover a service error through the same authorised legacy endpoint but never an access denial',async()=>{
  const calls=[];
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,headers:options.headers});
    if(url.endsWith('.mpd'))return new Response('<MPD/>',{headers:{'Content-Type':'application/dash+xml','Set-Cookie':'playToken=provided-cookie; Domain=.formula1.com; Path=/; Secure; HttpOnly'}});
    if(url.includes('/3.0/'))return new Response('{}',{status:500});
    return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://vod.formula1.com/record.mpd',drmType:'widevine',laURL:'https://drm.formula1.com/license'}}));
  }});
  client.config={apiConfig:{playAPIVersion:'3.0'}};client.token='own-session';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  assert.equal((await client.playback('42')).drm,'widevine');
  assert.equal(calls.length,3);assert.ok(calls[0].url.includes('/3.0/'));assert.ok(calls[1].url.includes('/2.0/'));
  assert.equal(calls[2].headers.ascendontoken,undefined);assert.equal(calls[2].headers.entitlementtoken,undefined);
  assert.ok(calls[0].url.includes('/WEB_HLS/ALL/CONTENT/PLAY?contentId=42&player=player_bm'));
  assert.equal(calls[1].headers.ascendontoken,'own-session');assert.equal(calls[1].headers.entitlementtoken,'own-entitlement');
  calls.length=0;client.fetcher=async(url)=>{calls.push(url);return new Response('{}',{status:403});};
  await assert.rejects(client.playback('42'),error=>error.status===403);assert.equal(calls.length,1);
});
test('playback cookie respects the service domain and path and remains in the licence relay',async()=>{
  const source='https://ott-video-cf.formula1.com/video/record.mpd', target='https://f1tv.formula1.com/2.0/CONTENT/LA/widevine';
  const scoped=value=>new Headers({'Set-Cookie':value});
  assert.equal(playbackCookie(scoped('playToken=one; Domain=.formula1.com; Path=/; Secure; HttpOnly'),source,target),'playToken=one');
  assert.equal(playbackCookie(scoped('playToken=host-only; Path=/'),source,target),'');
  assert.equal(playbackCookie(scoped('playToken=wrong; Domain=unrelated.example; Path=/'),source,target),'');
  assert.equal(playbackCookie(scoped('playToken=wrong-path; Domain=.formula1.com; Path=/video/'),source,target),'');
  assert.equal(playbackCookie(scoped('playToken=expired; Domain=.formula1.com; Path=/; Max-Age=0'),source,target),'');
  const calls=[], challenge=crypto.randomBytes(36), bytes=crypto.randomBytes(128);
  const client=new F1Client({fetcher:async(url,options)=>{calls.push(options);return new Response(bytes);}});
  client.token='own-session';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;
  const stream={licenseUrl:target,entitlementToken:'own-play-entitlement',playCookie:'playToken=one'};
  assert.deepEqual(await client.license(stream,challenge),bytes);
  assert.equal(calls[0].headers.Cookie,'playToken=one');assert.deepEqual(calls[0].body,challenge);
  assert.equal(calls[0].headers.entitlementtoken,'own-play-entitlement');
  await client.license({...stream,playCookie:'playToken=two'},challenge);
  assert.equal(calls[1].headers.Cookie,'playToken=two');assert.equal(calls[0].headers.Cookie,'playToken=one');
});

test('licence relay preserves binary responses even with a wrong MIME label and rejects actual error documents',async()=>{
  const licence=Buffer.from([8,2,...crypto.randomBytes(100)]);
  const client=new F1Client({fetcher:async()=>new Response(licence,{headers:{'Content-Type':'text/html'}})});
  client.token='own-session';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;
  const stream={licenseUrl:'https://f1tv.formula1.com/2.0/R/ENG/WEB_HLS/ALL/CONTENT/LA/widevine?contentId=42'};
  assert.deepEqual(await client.license(stream,Buffer.from([8,1,2,3])),licence);
  assert.equal(client.licenceInfo.responseKind,'opaque binary');
  for(const body of ['<!DOCTYPE html><html><body>Error</body></html>','{"error":"no valid licence issued"}','<?xml version="1.0"?><Error>Denied</Error>']){
    client.fetcher=async()=>new Response(body,{headers:{'Content-Type':'application/octet-stream'}});
    await assert.rejects(client.license(stream,Buffer.from([8,1,2,3])),error=>error.status===502);
  }
});

test('format inspection retains subscription and DRM while returning only public metadata',async()=>{
  const calls=[];
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,headers:options.headers});
    if(url.includes('.mpd')) return new Response('<MPD><AdaptationSet codecs="avc1.4D401F"><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cbcs"/></AdaptationSet></MPD>');
    return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://vod.formula1.com/record.mpd?signed=private-media-token',drmType:'widevine',streamType:'SDR_HD_DASHWV',laURL:'https://drm.formula1.com/license?secret=private-licence-token',entitlementToken:'private-entitlement'}}));
  }});
  client.token='own-session';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  const result=await client.inspectLegacyDash('42');
  assert.equal(calls.length,2);
  assert.ok(calls[0].url.includes('/2.0/R/ENG/WEB_DASH/ALL/CONTENT/PLAY?contentId=42&player=player_bm'));
  assert.equal(calls[0].headers.ascendontoken,'own-session');
  assert.equal(calls[0].headers.entitlementtoken,'own-entitlement');
  assert.equal(calls[1].headers.ascendontoken,undefined);
  assert.equal(result.drm,'widevine');
  assert.equal(result.player,'player_bm');
  assert.deepEqual(result.protection,['cbcs']);
  assert.deepEqual(result.codecs,['avc1.4D401F']);
  assert.ok(!JSON.stringify(result).includes('private-'));
  calls.length=0;client.fetcher=async(url)=>{calls.push({url});return new Response('',{status:403});};
  await assert.rejects(client.inspectLegacyDash('42'),/403/);
  assert.equal(calls.length,1);
});
test('installed TV identity is recovered only from a backup matching both pins, preserving other state',async(t)=>{
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'apex-identity-test-'));
  t.after(()=>fs.rm(scratch,{recursive:true,force:true}));
  const appRoot=path.join(scratch,'app'),state=path.join(scratch,'state'),legacy=path.join(scratch,'legacy');
  for(const dir of [path.join(appRoot,'tv'),state,legacy]) await fs.mkdir(dir,{recursive:true});
  const original=keys.privateKey.export({format:'pem',type:'pkcs8'}),pair='a'.repeat(64);
  const replacement=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'});
  await fs.writeFile(path.join(appRoot,'tv/connection.js'),'window.APEX_CONFIG='+JSON.stringify({publicKey:jwk,pairingKey:pair})+';');
  await fs.writeFile(path.join(state,'update-private.pem'),replacement);
  await fs.writeFile(path.join(state,'tv-key.txt'),'b'.repeat(64));
  await fs.writeFile(path.join(state,'f1-session.encrypted'),'untouched encrypted session');
  await fs.writeFile(path.join(legacy,'update-private.pem'),replacement);
  await fs.writeFile(path.join(legacy,'tv-key.txt'),pair);
  const options={root:appRoot,stateDirectory:state,legacyDirectory:legacy};
  await assert.rejects(recoverInstalledIdentity(options),/raktai nesutampa/);
  assert.equal(await fs.readFile(path.join(state,'update-private.pem'),'utf8'),replacement);
  await fs.writeFile(path.join(legacy,'update-private.pem'),original);
  await fs.writeFile(path.join(legacy,'tv-key.txt'),'c'.repeat(64));
  await assert.rejects(recoverInstalledIdentity(options),/raktai nesutampa/);
  await fs.writeFile(path.join(legacy,'tv-key.txt'),pair);
  assert.equal(await recoverInstalledIdentity(options),true);
  assert.equal(await fs.readFile(path.join(state,'update-private.pem'),'utf8'),original);
  assert.equal(await fs.readFile(path.join(state,'tv-key.txt'),'utf8'),pair);
  assert.equal(await fs.readFile(path.join(state,'f1-session.encrypted'),'utf8'),'untouched encrypted session');
  assert.equal((await fs.readdir(state)).filter(name=>name.endsWith('.bak')).length,2);
  assert.equal(await recoverInstalledIdentity(options),false);
});

test('authorised Akamai media CDN is exact and never accepted as an account or licence origin',()=>{
  const manifest='https://f1prodlive.akamaized.net/owned-sprint/manifest.mpd?playback=test';
  assert.equal(approvedUrl(manifest),manifest);
  const stream=parsePlayback({resultCode:'OK',resultObj:{url:manifest,drmType:'widevine',laURL:'https://f1tv.formula1.com/2.0/R/ENG/WEB_DASH/ALL/CONTENT/LA/widevine?contentId=42'}});
  assert.equal(stream.drm,'widevine'); assert.equal(stream.manifestUrl,manifest);
  assert.throws(()=>approvedUrl(manifest,true),/neatpažintą/);
  for(const url of ['http://f1prodlive.akamaized.net/test.mpd','https://f1prodlive.akamaized.net:8443/test.mpd','https://user:pass@f1prodlive.akamaized.net/test.mpd','https://f1prodlive.akamaized.net.attacker.example/test.mpd','https://other.akamaized.net/test.mpd']) assert.throws(()=>approvedUrl(url),/neatpažintą/);
  assert.equal(playbackCookie(new Headers({'Set-Cookie':'playToken=bad; Domain=.formula1.com; Path=/'}),manifest,stream.licenseUrl),'');
});
test('media redirects are bounded, approved and credential-free while licence POSTs cannot redirect',async()=>{
  const calls=[];
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1)return new Response(null,{status:302,headers:{Location:'https://ott-video-cf.formula1.com/sprint/manifest.mpd?provided=opaque'}});
    return new Response('<MPD/>',{headers:{'Content-Type':'application/dash+xml'}});
  }});
  client.token='private-account';client.entitlement='private-entitlement';client.expires=Date.now()/1000+600;
  const fetched=await client.mediaManifest('https://f1prodlive.akamaized.net/sprint/manifest.mpd');
  assert.equal(new URL(fetched.url).hostname,'ott-video-cf.formula1.com');
  assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.options.redirect,'manual');assert.equal(call.options.headers.ascendontoken,undefined);assert.equal(call.options.headers.entitlementtoken,undefined);}
  calls.length=0;
  client.fetcher=async(url,options)=>{calls.push({url,options});return new Response(null,{status:302,headers:{Location:'https://account.formula1.com/redirect'}});};
  await assert.rejects(client.mediaManifest('https://f1prodlive.akamaized.net/sprint/manifest.mpd'),/neleistą/);
  assert.equal(calls.length,1);
  calls.length=0;
  client.fetcher=async(url,options)=>{calls.push({url,options});return new Response(null,{status:302,headers:{Location:url}});};
  await assert.rejects(client.mediaManifest('https://f1prodlive.akamaized.net/sprint/manifest.mpd'),/nukreipimas/);
  assert.equal(calls.length,3);
  calls.length=0;
  await assert.rejects(client.license({licenseUrl:'https://drm.formula1.com/license'},Buffer.from('unchanged challenge')),/302/);
  assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'error');
});

test('TV format selection uses the ordinary supplied profile and does not retry an entitlement denial',async()=>{
  const calls=[];
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('.mpd'))return new Response('<MPD><ContentProtection value="cbcs"/></MPD>');
    return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://vod.formula1.com/sprint.mpd',drmType:'widevine',laURL:'https://drm.formula1.com/license'}}));
  }});
  client.token='own-account';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  const stream=await client.playback('42','BIG_SCREEN_DASH');
  assert.ok(calls[0].url.includes('/2.0/R/ENG/BIG_SCREEN_DASH/ALL/CONTENT/PLAY?contentId=42'));
  assert.equal(calls[0].options.headers.ascendontoken,'own-account');
  assert.equal(stream.platform,'BIG_SCREEN_DASH');assert.deepEqual(stream.protection,['cbcs']);
  calls.length=0;
  await assert.rejects(client.playback('42','ANDROID_SPOOF'),error=>error.status===400);
  assert.equal(calls.length,0);
  client.fetcher=async(url)=>{calls.push(url);return new Response('',{status:403});};
  await assert.rejects(client.playback('42','BIG_SCREEN_DASH'),error=>error.status===403);
  assert.equal(calls.length,1);
});

test('old-TV timing compatibility changes only tfdt timestamps and preserves opaque encrypted payload and DRM boxes',async()=>{
  const source=await fs.readFile(path.join(root,'web/tv-app.js'),'utf8');
  const sandbox={window:{}};vm.runInNewContext(source.split('// TV_MENU_START')[0],sandbox);
  const rebase=sandbox.window.ApexTiming.rebaseFragment;
  const box=(name,body)=>{const result=Buffer.alloc(8+body.length);result.writeUInt32BE(result.length);result.write(name,4,4,'ascii');body.copy(result,8);return result;};
  const shift=89581127904000n, decode=shift+576000n, timing=Buffer.alloc(12);timing[0]=1;timing.writeBigUInt64BE(decode,4);
  const encryption=crypto.randomBytes(112),payload=Buffer.concat([crypto.randomBytes(320),Buffer.from('tfdt'),crypto.randomBytes(60)]);
  const fragment=Buffer.concat([box('moof',box('traf',Buffer.concat([box('tfdt',timing),box('senc',encryption)]))),box('pssh',crypto.randomBytes(44)),box('mdat',payload)]);
  const input=Uint8Array.from(fragment).buffer,result=rebase(input,Number(shift)),output=Buffer.from(result.bytes);
  assert.equal(result.changed,1);assert.equal(output.length,fragment.length);assert.equal(output.readBigUInt64BE(28),576000n);
  for(let i=0;i<fragment.length;i++)if(i<28||i>=36)assert.equal(output[i],fragment[i],'Opaque byte changed at '+i);
  assert.deepEqual(Buffer.from(input),fragment,'Input must remain immutable');
  assert.equal(rebase(input,0).bytes,input);
  const invalid=Buffer.from(fragment);invalid.writeUInt32BE(invalid.length+100,0);
  assert.throws(()=>rebase(Uint8Array.from(invalid).buffer,Number(shift)),/dydis/);
  const beforeOrigin=Buffer.from(fragment);beforeOrigin.writeBigUInt64BE(shift-1n,28);
  assert.throws(()=>rebase(Uint8Array.from(beforeOrigin).buffer,Number(shift)),/nesutampa/);
});

test('the normal legacy F1 route can omit the optional player hint without changing account, content or DRM',async()=>{
  const calls=[];
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('.mpd'))return new Response('<MPD><ContentProtection value="cenc"/></MPD>');
    return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://vod.formula1.com/sprint.mpd',drmType:'widevine',laURL:'https://drm.formula1.com/supplied-licence'}}));
  }});
  client.token='own-account';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  const format=await client.inspectLegacyDash('42','WEB_DASH','legacy-default');
  assert.ok(calls[0].url.endsWith('/2.0/R/ENG/WEB_DASH/ALL/CONTENT/PLAY?contentId=42'));
  assert.equal(calls[0].options.headers.ascendontoken,'own-account');assert.equal(calls[0].options.headers.entitlementtoken,'own-entitlement');
  assert.equal(format.drm,'widevine');assert.deepEqual(format.protection,['cenc']);
  calls.length=0;await assert.rejects(client.playback('42','WEB_DASH','made-up-player'),error=>error.status===400);assert.equal(calls.length,0);
});

test('media transport is isolated from the authenticated account and DRM transport',async()=>{
  const accountCalls=[],mediaCalls=[];
  const client=new F1Client({
    fetcher:async(url,options)=>{accountCalls.push({url,options});return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://f1prodlive.akamaized.net/sprint.mpd',drmType:'widevine',laURL:'https://drm.formula1.com/license'}}));},
    mediaFetcher:async(url,options)=>{mediaCalls.push({url,options});return new Response('<MPD><ContentProtection value="cbcs"/></MPD>');}
  });
  client.token='own-account';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  await client.playback('42','WEB_DASH','legacy-default');
  assert.equal(accountCalls.length,1);assert.equal(mediaCalls.length,1);
  assert.equal(new URL(accountCalls[0].url).hostname,'f1tv.formula1.com');
  assert.equal(new URL(mediaCalls[0].url).hostname,'f1prodlive.akamaized.net');
  assert.equal(mediaCalls[0].options.headers.ascendontoken,undefined);assert.equal(mediaCalls[0].options.headers.entitlementtoken,undefined);assert.equal(mediaCalls[0].options.headers.Cookie,undefined);
});

const relayFixture = '<MPD type="static"><Period start="PT0S">' +
  '<AdaptationSet contentType="video"><ContentProtection value="cbcs"/><cenc:pssh>opaque-pssh-must-stay</cenc:pssh><SegmentTemplate timescale="50000" presentationTimeOffset="89581127904000" initialization="init-$RepresentationID$.mp4?provided=opaque" media="media-$RepresentationID$-$Time$.mp4"><SegmentTimeline><S t="89581127904000" d="288000" r="4"/></SegmentTimeline></SegmentTemplate><Representation id="avc" codecs="avc1.4D401F" width="1280" height="720" bandwidth="2500000"/><Representation id="hevc" codecs="hev1.1.6.L93.B0" width="1280" height="720" bandwidth="2000000"/><Representation id="4k" codecs="avc1.4D402A" width="3840" height="2160" bandwidth="12000000"/></AdaptationSet>' +
  '<AdaptationSet contentType="audio" lang="eng"><ContentProtection value="cbcs"/><SegmentTemplate timescale="48000" presentationTimeOffset="85997882787840" initialization="audio-$RepresentationID$.mp4" media="audio-$RepresentationID$-$Time$.mp4"><SegmentTimeline><S t="85997882787840" d="276480" r="4"/></SegmentTimeline></SegmentTemplate><Representation id="aac" codecs="mp4a.40.2" bandwidth="128000"/></AdaptationSet>' +
  '<AdaptationSet contentType="text"><Representation id="subtitle" codecs="stpp" bandwidth="500"/></AdaptationSet></Period></MPD>';
test('native relay selects AVC and English AAC, preserves DRM metadata, and maps normalized time to the exact supplied CDN file',()=>{
  const ticket='e'.repeat(48), stream={manifestUrl:'https://f1prodlive.akamaized.net/owned/manifest.mpd?signed=private',manifestXML:relayFixture};
  const relay=buildRelayManifest(stream,ticket,'http://127.0.0.1:8317');
  assert.ok(relay.mpd.includes('<ContentProtection value="cbcs"/>'));assert.ok(relay.mpd.includes('<cenc:pssh>opaque-pssh-must-stay</cenc:pssh>'));
  assert.ok(!relay.mpd.includes('hev1'));assert.ok(!relay.mpd.includes('stpp'));assert.ok(!relay.mpd.includes('3840'));
  assert.ok(!relay.mpd.includes('signed=private'));assert.ok(!relay.mpd.includes('provided=opaque'));
  assert.ok(relay.mpd.includes('presentationTimeOffset="0"'));assert.ok(relay.mpd.includes('<S t="0"'));
  assert.equal(relay.slots.length,4);
  const asset=resolveRelayAsset(relay,1,'avc',new URLSearchParams('t=288000'));
  assert.equal(asset.url,'https://f1prodlive.akamaized.net/owned/media-avc-89581128192000.mp4');
  assert.throws(()=>resolveRelayAsset(relay,1,'../secret',new URLSearchParams('t=0')),/nerastas/);
  assert.throws(()=>resolveRelayAsset(relay,1,'avc',new URLSearchParams('t=0&target=https://attacker.example')),/užklausa/);
  assert.throws(()=>resolveRelayAsset(relay,1,'avc',new URLSearchParams('t=0&t=1')),/užklausa/);
  assert.throws(()=>resolveRelayAsset(relay,1,'avc',new URLSearchParams('t=-1')),/žyma/);
  assert.throws(()=>buildRelayManifest({...stream,manifestXML:relayFixture.replace('type="static"','type="dynamic"')},ticket,'http://127.0.0.1:8317'),/įrašui/);
  assert.throws(()=>buildRelayManifest({...stream,manifestXML:'<!DOCTYPE MPD><MPD/>'},ticket,'http://127.0.0.1:8317'),/nepalaikomas/);
  const escaped=buildRelayManifest({...stream,manifestXML:relayFixture.replace('media-$RepresentationID$-$Time$.mp4','https://account.formula1.com/media-$RepresentationID$-$Time$.mp4')},ticket,'http://127.0.0.1:8317');
  assert.throws(()=>resolveRelayAsset(escaped,1,'avc',new URLSearchParams('t=0')),/serverį/);
});
test('encrypted relay changes only public decode and index timing while keeping encryption metadata and sample bytes intact',()=>{
  const box=(name,body)=>{const result=Buffer.alloc(body.length+8);result.writeUInt32BE(result.length);result.write(name,4,4,'ascii');body.copy(result,8);return result;};
  const shift=89581127904000n, timing=Buffer.alloc(12);timing[0]=1;timing.writeBigUInt64BE(shift+288000n,4);
  const index=Buffer.alloc(32);index[0]=1;index.writeUInt32BE(50000,8);index.writeBigUInt64BE(shift+288000n,12);
  const encryption=crypto.randomBytes(92), encryptedSamples=crypto.randomBytes(700);
  const input=Buffer.concat([box('sidx',index),box('moof',box('traf',Buffer.concat([box('tfdt',timing),box('senc',encryption)]))),box('mdat',encryptedSamples)]);
  const slot={kind:'media',offset:shift,timescale:50000n},output=rebaseMedia(input,slot);
  assert.equal(output.readBigUInt64BE(20),288000n);assert.equal(output.readBigUInt64BE(68),288000n);
  for(let i=0;i<input.length;i++)if(!(i>=20&&i<28)&&!(i>=68&&i<76))assert.equal(output[i],input[i],'Encrypted/DRM byte changed '+i);
  assert.deepEqual(output.subarray(output.length-700),encryptedSamples);
  assert.equal(rebaseMedia(input,{...slot,kind:'initialization'}),input);
  assert.deepEqual(mediaRange('bytes=0-15',output.length),{start:0,end:15,status:206});
  assert.deepEqual(mediaRange('bytes=-16',output.length),{start:output.length-16,end:output.length-1,status:206});
  assert.throws(()=>mediaRange('bytes=0-1,3-4',output.length),error=>error.status===416);
  assert.throws(()=>mediaRange('bytes=999999-',output.length),error=>error.status===416);
});
test('native media relay stays ticket-bound, paired-IP-only and keeps account data on the companion',async(t)=>{
  const bytes=Buffer.from('opaque encrypted init fixture'),calls=[];
  const config={pcAddress:'192.168.50.10',tvAddress:'127.0.0.2',port:8317};
  const client={status:()=>({signedIn:true,country:'LT'}),playback:async()=>({manifestUrl:'https://f1prodlive.akamaized.net/owned/manifest.mpd?signed=private',manifestXML:relayFixture,drm:'widevine',licenseUrl:'https://drm.formula1.com/license',entitlementToken:'private-entitlement'}),
    mediaManifest:async(url)=>{calls.push(url);return {url,response:new Response(bytes)};}};
  const app=await createApp({root,client,setupData:{config,pairingKey:'paired-fixture',privateKey:keys.privateKey,publicKey:jwk}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const request=(endpoint,ip='127.0.0.2',headers={},method='GET',payload)=>new Promise((resolve,reject)=>{
    const req=http.request(base+endpoint,{localAddress:ip,method,headers:{Host:'192.168.50.10:8317',...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));});req.on('error',reject);if(payload)req.write(payload);req.end();
  });
  const played=await request('/api/play','127.0.0.2',{'X-Apex-Key':'paired-fixture','Content-Type':'application/json'},'POST','{"id":"42","relay":true}');
  assert.equal(played.status,200);assert.ok(!played.bytes.toString().includes('private'));
  const play=JSON.parse(played.bytes),manifestPath=new URL(play.manifestUrl).pathname;
  assert.equal(play.relayed,true);
  assert.equal((await request(manifestPath,'127.0.0.3')).status,403);
  assert.equal((await request(manifestPath)).status,200);
  assert.equal((await request('/api/media/'+'0'.repeat(48)+'/manifest.mpd')).status,410);
  const asset='/api/media/'+play.ticket+'/s0/avc.mp4';
  const partial=await request(asset,'127.0.0.2',{Range:'bytes=0-7'});
  assert.equal(partial.status,206);assert.equal(partial.headers['content-type'],'video/mp4');assert.deepEqual(partial.bytes,bytes.subarray(0,8));assert.equal(calls.length,1);
  assert.equal((await request(asset)).status,200);assert.equal(calls.length,1,'Repeat ranges must use encrypted cache');
  assert.equal((await request('/api/media/'+play.ticket+'/s0/unknown.mp4')).status,404);
  assert.equal((await request('/admin/state')).status,403);
});

test('graceful companion restart requires localhost, the current CSRF token and its own origin',async(t)=>{
  let restarts=0;
  const config={pcAddress:'192.168.50.10',tvAddress:'127.0.0.2',port:8317};
  const app=await createApp({root,client:{status:()=>({signedIn:true,country:'LT'})},setupData:{config,pairingKey:'paired-fixture',privateKey:keys.privateKey,publicKey:jwk},actions:{restart:async()=>{restarts++;}}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const request=(endpoint,ip='127.0.0.1',method='GET',headers={})=>new Promise((resolve,reject)=>{
    const req=http.request(base+endpoint,{localAddress:ip,method,headers:{Host:'127.0.0.1:8317',...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,json:()=>JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.end();
  });
  const state=(await request('/admin/state')).json();
  assert.equal((await request('/admin/restart','127.0.0.1','POST')).status,403);
  assert.equal((await request('/admin/restart','127.0.0.2','POST',{Origin:'http://127.0.0.1:8317','X-Apex-CSRF':state.csrf})).status,403);
  assert.equal(restarts,0);
  assert.equal((await request('/admin/restart','127.0.0.1','POST',{Origin:'http://127.0.0.1:8317','X-Apex-CSRF':state.csrf})).status,200);
  assert.equal(restarts,1);
});

test('a separately supplied ordinary F1 recording keeps its own content identity and never treats a protected MPD as unprotected',async()=>{
  const calls=[];let mpd='<MPD type="static"><Period><AdaptationSet contentType="video"><Representation codecs="avc1.4D401F"/></AdaptationSet></Period></MPD>';
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('.mpd'))return new Response(mpd, {headers:{'content-type':'application/dash+xml'}});
    return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://ott-video-fer-cf.formula1.com/kids-sprint.mpd',streamType:'SDR_HD_DASH',drmType:''}}));
  }});
  client.token='own-account';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  const recording=await client.playback('1000011236');
  assert.ok(calls[0].url.includes('contentId=1000011236'));
  assert.equal(calls[0].options.headers.ascendontoken,'own-account');
  assert.equal(recording.drm,'');assert.equal(recording.manifestXML,mpd);assert.deepEqual(recording.protection,[]);
  assert.equal(calls[1].options.headers.ascendontoken,undefined);
  mpd='<MPD><ContentProtection value="cbcs"/></MPD>';
  await assert.rejects(client.playback('1000011236'),error=>error.status===422);
});

test('an official split-bitrate recording selects its 720p AVC adaptation rather than the first low-resolution set',()=>{
  const low='<AdaptationSet contentType="video"><SegmentTemplate timescale="50000" presentationTimeOffset="0" initialization="low-init-$RepresentationID$.mp4" media="low-$RepresentationID$-$Time$.mp4"><SegmentTimeline><S t="0" d="288000" r="4"/></SegmentTimeline></SegmentTemplate><Representation id="low" codecs="avc1.4D401E" width="320" height="180" bandwidth="120000"/></AdaptationSet>';
  const manifest=relayFixture.replace('<Period start="PT0S">','<Period start="PT0S">'+low);
  const relay=buildRelayManifest({manifestUrl:'https://ott-video-fer-cf.formula1.com/kids-sprint.mpd',manifestXML:manifest},'b'.repeat(48),'http://127.0.0.1:8317');
  assert.ok(!relay.mpd.includes('id="low"'));
  assert.ok(relay.mpd.includes('id="avc"'));
  assert.equal(relay.summaries[0].representations,1);
});

test('channel selection is limited to the service-supplied channels of that same authenticated recording',async()=>{
  const calls=[];
  const details={resultCode:'OK',resultObj:{metadata:{contentId:42,title:'Sprint',duration:5690,additionalStreams:[
    {channelId:7,title:'International',type:'additional',default:true,playbackUrl:'https://vod.formula1.com/private?token=private'},
    {channelId:7,title:'duplicate'},{channelId:'bad-id',title:'invalid'}
  ]},containers:[{metadata:{contentId:43,additionalStreams:[{channelId:9,title:'Other recording'}]}}]}};
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/CONTENT/VIDEO/'))return new Response(JSON.stringify(details));
    if(url.includes('.mpd'))return new Response('<MPD><ContentProtection value="cbcs"/></MPD>');
    return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://vod.formula1.com/sprint.mpd',drmType:'widevine',laURL:'https://drm.formula1.com/service-supplied-licence'}}));
  }});
  client.token='own-account';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  const channels=await client.channels('42');
  assert.deepEqual(channels.channels,[{id:'7',title:'International',type:'additional',default:true}]);
  assert.ok(!JSON.stringify(channels).includes('private'));
  calls.length=0;
  const stream=await client.playback('42','WEB_HLS','player_bm','7');
  const played=calls.find(call=>call.url.includes('/CONTENT/PLAY'));
  assert.ok(played.url.includes('contentId=42'));assert.ok(played.url.endsWith('&channelId=7'));
  assert.equal(played.options.headers.ascendontoken,'own-account');assert.equal(played.options.headers.entitlementtoken,'own-entitlement');
  assert.equal(stream.drm,'widevine');assert.equal(stream.licenseUrl,'https://drm.formula1.com/service-supplied-licence');assert.deepEqual(stream.protection,['cbcs']);
  calls.length=0;await assert.rejects(client.playback('42','WEB_HLS','player_bm','9'),error=>error.status===403);
  assert.equal(calls.filter(call=>call.url.includes('/CONTENT/PLAY')).length,0);
  calls.length=0;await assert.rejects(client.playback('42','WEB_HLS','player_bm','not-a-channel'),error=>error.status===400);assert.equal(calls.length,0);
});

test('TV launch accepts an authenticated catalogue ID only and delivers once to the paired TV, excluding previews',async(t)=>{
  let signedIn=true, now=Date.now();
  t.mock.method(Date,'now',()=>now);
  const config={pcAddress:'192.168.50.10',tvAddress:'127.0.0.2',port:8317};
  let liveItems=[];const client={status:()=>({signedIn}),live:async()=>liveItems,channels:async(id)=>({contentId:String(id),title:id==='42'?'Singapore - Qualifying':'',privateToken:'must-not-export'}),playback:async()=>({manifestUrl:'https://vod.formula1.com/owned.mpd',manifestXML:relayFixture,drm:'widevine'})};
  const app=await createApp({root,client,setupData:{config,pairingKey:'paired-fixture',privateKey:keys.privateKey,publicKey:jwk}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const request=(endpoint,ip='127.0.0.1',method='GET',headers={},payload)=>new Promise((resolve,reject)=>{
    const req=http.request(base+endpoint,{localAddress:ip,method,headers:{Host:'127.0.0.1:8317',...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,json:JSON.parse(bytes),text:bytes.toString()});});});req.on('error',reject);if(payload)req.write(JSON.stringify(payload));req.end();
  });
  const state=(await request('/admin/state')).json;
  const admin={Origin:'http://127.0.0.1:8317','X-Apex-CSRF':state.csrf,'Content-Type':'application/json'},paired={'X-Apex-Key':'paired-fixture'};
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',{}, {id:'42'})).status,403);
  assert.equal((await request('/admin/play-on-tv','127.0.0.2','POST',admin,{id:'42'})).status,403);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'https://attacker.example/video'})).status,400);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',url:'https://attacker.example/video'})).status,400);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'99'})).status,404);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',player:'invented-profile'})).status,400);
  const queued=await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42'});
  assert.equal(queued.status,200);assert.ok(!queued.text.includes('must-not-export'));
  assert.equal((await request('/api/tv-command','127.0.0.1','GET',paired)).status,403);
  assert.equal((await request('/api/tv-command','127.0.0.3','GET',paired)).status,403);
  assert.equal((await request('/api/tv-command','127.0.0.2')).status,401);
  assert.equal((await request('/api/tv-command?revision=invalid','127.0.0.2','GET',paired)).status,400);
  const update=await request('/api/tv-command?revision='+'0'.repeat(24),'127.0.0.2','GET',paired);assert.equal(update.json.command,null);assert.match(update.json.revision,/^[a-f0-9]{24}$/);
  const delivered=await request('/api/tv-command','127.0.0.2','GET',paired);
  assert.equal(delivered.status,200);assert.equal(delivered.json.command.id,'42');assert.match(delivered.json.command.commandId,/^[a-f0-9]{24}$/);
  assert.ok(!delivered.text.includes('must-not-export'));assert.equal(delivered.json.command.expires,undefined);
  assert.equal((await request('/api/tv-command','127.0.0.2','GET',paired)).json.command,null);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',transport:'arbitrary-url'})).status,400);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',live:'true'})).status,400);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',live:true})).status,404);
  liveItems=[{id:'42',title:'Singapore - LIVE',kind:'video',live:true}];
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',live:true,transport:'relay'})).status,400);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',live:true})).status,200);
  const liveCommand=(await request('/api/tv-command','127.0.0.2','GET',paired)).json.command;
  assert.equal(liveCommand.live,true);assert.equal(liveCommand.title,'Singapore - LIVE');assert.equal(liveCommand.transport,undefined);
  await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',transport:'direct'});
  await request('/api/tv-command','127.0.0.2','GET',paired);
  const preview=await request('/api/play','127.0.0.1','POST',paired,{id:'42'});assert.equal(preview.json.nativeTest,false);
  const direct=await request('/api/play','127.0.0.2','POST',paired,{id:'42',relay:true});assert.equal(direct.json.relayed,false);assert.equal(direct.json.nativeTest,true);
  const again=await request('/api/play','127.0.0.2','POST',paired,{id:'42'});assert.equal(again.json.nativeTest,false);
  await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',transport:'relay-mse'});
  await request('/api/tv-command','127.0.0.2','GET',paired);
  const browserPreview=await request('/api/play','127.0.0.1','POST',paired,{id:'42'});
  assert.equal(browserPreview.json.browserTest,false);
  const browserRelay=await request('/api/play','127.0.0.2','POST',paired,{id:'42',relay:false});
  assert.equal(browserRelay.status,200);assert.equal(browserRelay.json.relayed,true);assert.equal(browserRelay.json.browserTest,true);
  assert.equal(browserRelay.json.drm,'widevine');
  const browserAgain=await request('/api/play','127.0.0.2','POST',paired,{id:'42'});
  assert.equal(browserAgain.json.browserTest,false);
  await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42',transport:'direct'});await request('/api/tv-command','127.0.0.2','GET',paired);now+=30001;
  const expired=await request('/api/play','127.0.0.2','POST',paired,{id:'42'});assert.equal(expired.json.nativeTest,false);
  await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42'});now+=90001;
  assert.equal((await request('/api/tv-command','127.0.0.2','GET',paired)).json.command,null);
  await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42'});signedIn=false;
  assert.equal((await request('/api/tv-command','127.0.0.2','GET',paired)).json.command,null);
  assert.equal((await request('/admin/play-on-tv','127.0.0.1','POST',admin,{id:'42'})).status,401);
});
test('the official Tiledmedia player hint keeps the same authenticated content and service-supplied DRM',async()=>{
  const calls=[];
  const client=new F1Client({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('.mpd'))return new Response('<MPD><ContentProtection value="cbcs"/></MPD>');
    return new Response(JSON.stringify({resultCode:'OK',resultObj:{url:'https://vod.formula1.com/qualifying.mpd',drmType:'widevine',laURL:'https://drm.formula1.com/provided-licence'}}));
  }});
  client.token='own-account';client.entitlement='own-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  const stream=await client.playback('1000010395','WEB_HLS','player_tm');
  assert.ok(calls[0].url.endsWith('contentId=1000010395&player=player_tm'));
  assert.equal(calls[0].options.headers.ascendontoken,'own-account');
  assert.equal(calls[0].options.headers.entitlementtoken,'own-entitlement');
  assert.equal(stream.drm,'widevine');assert.equal(stream.licenseUrl,'https://drm.formula1.com/provided-licence');assert.deepEqual(stream.protection,['cbcs']);
  calls.length=0;await assert.rejects(client.playback('1000010395','WEB_HLS','invented-player'),error=>error.status===400);assert.equal(calls.length,0);
  await client.inspectLegacyDash('1000010395','WEB_HLS','player_tm');
  assert.ok(calls[0].url.endsWith('contentId=1000010395&player=player_tm'));
});
test('public DRM control vectors use their fixed public licence only, preserving CDM bytes and excluding F1 credentials',async()=>{
  const {publicDrmTest,publicDrmTestId,publicDrmLicense}=await import('../companion/drm-tests.mjs');
  assert.equal(publicDrmTest('toString'),undefined);assert.equal(publicDrmTest('__proto__'),undefined);assert.equal(publicDrmTestId('invented'),'');
  const challenge=crypto.randomBytes(64),licence=crypto.randomBytes(512),calls=[];
  for(const scheme of ['cenc','cbcs']){
    const id=publicDrmTestId(scheme),definition=publicDrmTest(id);
    assert.equal(definition.scheme,scheme);assert.equal(new URL(definition.manifestUrl).hostname,'media.axprod.net');
    const result=await publicDrmLicense(id,challenge,async(url,options)=>{calls.push({url,options});return new Response(licence);});
    assert.deepEqual(result,licence);assert.equal(calls.at(-1).url,definition.licenseUrl);assert.equal(calls.at(-1).options.body,challenge);
    assert.equal(calls.at(-1).options.redirect,'error');assert.deepEqual(Object.keys(calls.at(-1).options.headers).sort(),['Content-Type','X-AxDRM-Message']);
    await assert.rejects(publicDrmLicense(id,challenge,async()=>new Response('<html>denied</html>')),error=>error.status===502);
  }
  await assert.rejects(publicDrmLicense('42',challenge),error=>error.status===400);
});

test('fixed public DRM probes cannot select arbitrary media or mix a test licence into an F1 ticket',async(t)=>{
  let f1Calls=0;
  const config={pcAddress:'192.168.50.10',tvAddress:'127.0.0.2',port:8317};
  const client={status:()=>({signedIn:true}),playback:async()=>{f1Calls++;return {manifestUrl:'https://vod.formula1.com/owned.mpd',drm:'widevine'};}};
  const app=await createApp({root,client,setupData:{config,pairingKey:'paired-fixture',privateKey:keys.privateKey,publicKey:jwk}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const request=(endpoint,ip='127.0.0.1',method='GET',headers={},payload)=>new Promise((resolve,reject)=>{
    const req=http.request(base+endpoint,{localAddress:ip,method,headers:{Host:'127.0.0.1:8317',...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);if(payload)req.write(JSON.stringify(payload));req.end();
  });
  const state=(await request('/admin/state')).json,admin={Origin:'http://127.0.0.1:8317','X-Apex-CSRF':state.csrf};
  assert.equal((await request('/admin/drm-probe','127.0.0.1','POST',{}, {scheme:'cenc'})).status,403);
  assert.equal((await request('/admin/drm-probe','127.0.0.2','POST',admin,{scheme:'cenc'})).status,403);
  assert.equal((await request('/admin/drm-probe','127.0.0.1','POST',admin,{scheme:'cenc',url:'https://attacker.example'})).status,400);
  assert.equal((await request('/admin/drm-probe','127.0.0.1','POST',admin,{scheme:'cenc'})).status,200);
  const paired={'X-Apex-Key':'paired-fixture'},command=(await request('/api/tv-command','127.0.0.2','GET',paired)).json.command;
  const stream=await request('/api/play','127.0.0.2','POST',paired,{id:command.id,relay:true});
  assert.equal(stream.status,200);assert.equal(stream.json.relayed,false);assert.equal(stream.json.nativeTest,true);assert.equal(stream.json.platform,'public-test');assert.equal(stream.json.drm,'widevine');
  assert.equal(new URL(stream.json.manifestUrl).hostname,'media.axprod.net');assert.equal(stream.json.licenseUrl,undefined);assert.equal(stream.json.headers,undefined);assert.equal(f1Calls,0);
  const f1Stream=await request('/api/play','127.0.0.2','POST',paired,{id:'42',publicTestId:command.id,nativeTest:true});assert.equal(f1Calls,1);assert.equal(f1Stream.json.nativeTest,false);
});
test('AVPlay preparation waits for a pending CDM licence, retries once in a valid state, and cancels stale sessions',async()=>{
  const sandbox={window:{}};vm.runInNewContext((await fs.readFile(path.join(root,'web/tv-app.js'),'utf8')).split('// TV_MENU_START')[0],sandbox);
  const create=sandbox.window.ApexNativePreparation;
  function setup(state='IDLE') { let active=true,ready=0;const errors=[],callbacks=[],events=[];const player={getState:()=>state,prepareAsync:(success,failure)=>callbacks.push({success,failure})};const prep=create(player,()=>active,()=>ready++,error=>errors.push(error),event=>events.push(event));return {prep,errors,callbacks,events,ready:()=>ready,cancel:()=>{active=false;}}; }
  const error={name:'InvalidAccessError',message:'PLAYER_ERROR_CONNECTION_FAILED'};
  let resolve;const pending=new Promise(done=>resolve=done),a=setup();a.prep.licence(pending);a.prep.prepare();a.callbacks[0].failure(error);
  a.prep.failed(error);assert.equal(a.errors.length,0);assert.equal(a.callbacks.length,1);resolve();await Promise.resolve();assert.equal(a.callbacks.length,2);a.callbacks[1].success();assert.equal(a.ready(),1);
  const b=setup();b.prep.licence(Promise.resolve());b.prep.prepare();b.callbacks[0].failure(error);await Promise.resolve();b.callbacks[1].failure(error);assert.equal(b.callbacks.length,2);assert.equal(b.errors.length,1);
  let late;const c=setup();c.prep.licence(new Promise(done=>late=done));c.prep.prepare();c.callbacks[0].failure(error);c.cancel();late();await Promise.resolve();assert.equal(c.callbacks.length,1);assert.equal(c.errors.length,0);
  let reject;const d=setup();d.prep.licence(new Promise((_,bad)=>reject=bad));d.prep.prepare();d.callbacks[0].failure(error);reject(error);await Promise.resolve();assert.equal(d.callbacks.length,1);assert.equal(d.errors.length,1);
  const e=setup('NONE');e.prep.licence(Promise.resolve());e.prep.prepare();e.callbacks[0].failure(error);await Promise.resolve();assert.equal(e.callbacks.length,1);assert.equal(e.errors.length,1);
});
test('Tiledmedia configuration is authenticated at F1 only, validates recording and channel, and preserves supplied DRM', async () => {
  const calls = [], id = '1000010395', source = 'https://f1tv.formula1.com/1.0/R/ENG/WEB_HLS/ALL/TMEMANIFEST/provided';
  let configuration = { metadata: { content_id: Number(id) }, feeds: [
    { metadata: { channel_id: 1033 }, url: 'https://f1prodlive.akamaized.net/provided-main.mpd' },
    { metadata: { channel_id: 1025 }, url: 'https://f1prodlive.akamaized.net/provided-international.mpd' }
  ] };
  const client = new F1Client({ fetcher: async (url, options) => {
    calls.push({ url, options, account: true });
    if (url === source) return new Response(JSON.stringify(configuration));
    return new Response(JSON.stringify({ resultCode: 'OK', resultObj: { url: source, drmType: 'widevine', laURL: 'https://f1tv.formula1.com/service-provided-la', entitlementToken: 'actual-play-entitlement' } }));
  }, mediaFetcher: async (url, options) => { calls.push({ url, options, account: false }); return new Response('<MPD><ContentProtection value="cbcs"/></MPD>'); } });
  client.token='actual-account';client.entitlement='actual-entitlement';client.expires=Date.now()/1000+600;client.location={entitlement:'PRO',groupId:1};
  const stream = await client.playback(id, 'WEB_HLS', 'player_tm');
  assert.equal(stream.manifestUrl, configuration.feeds[0].url);assert.equal(stream.drm, 'widevine');assert.equal(stream.licenseUrl, 'https://f1tv.formula1.com/service-provided-la');
  assert.equal(calls.find(call=>call.url===source).options.headers.entitlementtoken, 'actual-play-entitlement');
  assert.equal(calls.at(-1).account, false);assert.equal(calls.at(-1).options.headers.ascendontoken, undefined);assert.equal(calls.at(-1).options.headers.entitlementtoken, undefined);
  const selected = {manifestUrl:source,drm:'widevine',licenseUrl:stream.licenseUrl};await client.resolvePlayerManifest(selected,id,'1025');assert.equal(selected.manifestUrl,configuration.feeds[1].url);
  await assert.rejects(client.resolvePlayerManifest({manifestUrl:source,drm:'widevine',licenseUrl:stream.licenseUrl},id,'9999'),error=>error.status===422);
  configuration.metadata.content_id=42;
  await assert.rejects(client.resolvePlayerManifest({manifestUrl:source,drm:'widevine',licenseUrl:stream.licenseUrl},id),error=>error.status===422);
  const before=calls.length;
  await assert.rejects(client.resolvePlayerManifest({manifestUrl:source.replace('f1tv.formula1.com','f1prodlive.akamaized.net')},id),error=>error.status===422);assert.equal(calls.length,before);
});

test('Samsung detailed player errors expose public failure metadata only',async()=>{
  const sandbox={window:{}};vm.runInNewContext((await fs.readFile(path.join(root,'web/tv-app.js'),'utf8')).split('// TV_MENU_START')[0],sandbox);
  const summarize=sandbox.window.ApexNativeErrorSummary;
  const text=summarize(JSON.stringify({error_code:'PLAYER_ERROR_CONNECTION_FAILED',connect_error:{curl:-23},http_response_header:'HTTP/1.1 206 Partial Content\r\nSet-Cookie: private-secret',http_request_header:'secret-token',url:'http://192.168.50.10/private-ticket',detail_info:'https://private.example/token',codec:'h264',demux:'mp4demux'}));
  assert.match(text,/curl=-23/);assert.match(text,/HTTP=206/);assert.match(text,/codec=h264/);assert.ok(!/private|token|secret|http:/i.test(text));
  assert.equal(summarize('undefined'),'No structured native error');assert.equal(summarize('{}'),'No public native error fields');
});
test('a native HEVC trial selects only the service-provided codec and keeps encryption metadata',()=>{
  const stream={manifestUrl:'https://f1prodlive.akamaized.net/owned/manifest.mpd',manifestXML:relayFixture};
  const relay=buildRelayManifest(stream,'e'.repeat(48),'http://127.0.0.1:8317','hevc');
  assert.ok(relay.mpd.includes('hev1.1.6.L93.B0'));assert.ok(!relay.mpd.includes('avc1.'));assert.ok(relay.mpd.includes('mp4a.40.2'));
  assert.ok(relay.mpd.includes('<cenc:pssh>opaque-pssh-must-stay</cenc:pssh>'));assert.ok(relay.mpd.includes('<ContentProtection value="cbcs"/>'));
  const asset=resolveRelayAsset(relay,1,'hevc',new URLSearchParams('t=0'));assert.equal(asset.url,'https://f1prodlive.akamaized.net/owned/media-hevc-89581127904000.mp4');
  assert.throws(()=>resolveRelayAsset(relay,1,'avc',new URLSearchParams('t=0')),/nerastas/);
  assert.throws(()=>buildRelayManifest(stream,'e'.repeat(48),'http://127.0.0.1:8317','invented-codec'),error=>error.status===400);
});
test('native preparation tolerates a challenge arriving after its first failure and bounds missing challenges',async()=>{
  const sandbox={window:{}};vm.runInNewContext((await fs.readFile(path.join(root,'web/tv-app.js'),'utf8')).split('// TV_MENU_START')[0],sandbox);
  const error={name:'InvalidAccessError',message:'PLAYER_ERROR_CONNECTION_FAILED'};
  function setup(){const callbacks=[],timers=[],errors=[];let current=true,ready=0;const player={getState:()=> 'IDLE',prepareAsync:(success,failure)=>callbacks.push({success,failure})};const prep=sandbox.window.ApexNativePreparation(player,()=>current,()=>ready++,reason=>errors.push(reason),()=>{},(callback,delay)=>timers.push({callback,delay}));return {prep,callbacks,timers,errors,cancel:()=>{current=false;},ready:()=>ready};}
  const a=setup();a.prep.prepare();a.callbacks[0].failure(error);assert.equal(a.errors.length,0);assert.equal(a.timers[0].delay,3000);
  a.prep.failed(error);assert.equal(a.timers.length,1);
  a.prep.licence(Promise.resolve());await Promise.resolve();assert.equal(a.callbacks.length,2);a.timers[0].callback();assert.equal(a.errors.length,0);a.callbacks[1].success();assert.equal(a.ready(),1);
  const b=setup();b.prep.prepare();b.callbacks[0].failure(error);b.timers[0].callback();assert.equal(b.errors.length,1);assert.equal(b.callbacks.length,1);
  const c=setup();c.prep.prepare();c.callbacks[0].failure(error);c.cancel();c.timers[0].callback();assert.equal(c.errors.length,0);assert.equal(c.callbacks.length,1);
});
test('native encrypted replay fixes the best supplied 1080p rendition during DRM preparation',()=>{
  const ladder=relayFixture.replace('<Representation id="avc"','<Representation id="low" codecs="avc1.4D401F" width="640" height="360" bandwidth="1000000"/><Representation id="hd" codecs="avc1.4D402A" width="1920" height="1080" bandwidth="6000000"/><Representation id="avc"');
  const relay=buildRelayManifest({manifestUrl:'https://f1prodlive.akamaized.net/owned/manifest.mpd',manifestXML:ladder},'e'.repeat(48),'http://127.0.0.1:8317');
  assert.equal(relay.slots[0].allowed.size,1);assert.ok(relay.slots[0].allowed.has('hd'));assert.ok(!relay.mpd.includes('id="low"'));assert.ok(!relay.mpd.includes('id="avc"'));assert.ok(relay.mpd.includes('opaque-pssh-must-stay'));
});
test('large F1 replay sequence numbers normalize locally while source addresses and encrypted boxes remain exact',()=>{
  const start=311048386n;
  const xml=relayFixture.replaceAll('media-$RepresentationID$-$Time$.mp4','media-$RepresentationID$-$Number$.mp4').replaceAll('<SegmentTemplate timescale=', '<SegmentTemplate startNumber="'+start+'" timescale=');
  const relay=buildRelayManifest({manifestUrl:'https://f1prodlive.akamaized.net/owned/manifest.mpd',manifestXML:xml},'e'.repeat(48),'http://127.0.0.1:8317');
  assert.match(relay.mpd,/startNumber="1"/);assert.equal(relay.slots[1].numberShift,start-1n);
  const asset=resolveRelayAsset(relay,1,'avc',new URLSearchParams('n=1'));assert.equal(asset.url,'https://f1prodlive.akamaized.net/owned/media-avc-'+start+'.mp4');
  const box=(name,body)=>{const bytes=Buffer.alloc(body.length+8);bytes.writeUInt32BE(bytes.length);bytes.write(name,4,4,'ascii');body.copy(bytes,8);return bytes;};
  const sequence=Buffer.alloc(8);sequence.writeUInt32BE(Number(start+1n),4);
  const encrypted=crypto.randomBytes(80),payload=crypto.randomBytes(100);
  const input=Buffer.concat([box('moof',Buffer.concat([box('mfhd',sequence),box('traf',box('senc',encrypted))])),box('mdat',payload)]);
  const result=rebaseMedia(input,{kind:'media',offset:0n,sequenceShift:start});assert.equal(result.readUInt32BE(20),1);
  for(let i=0;i<input.length;i++)if(i<20||i>=24)assert.equal(result[i],input[i]);assert.equal(input.readUInt32BE(20),Number(start+1n));
});
test('DRM diagnostics require a usable CDM entry for each protected track and reject malformed init metadata', async()=>{
  const sandbox={window:{}};
  vm.runInNewContext((await fs.readFile(path.join(root,'web/tv-app.js'),'utf8')).split('// TV_MENU_START')[0],sandbox);
  const probe=sandbox.window.ApexProtectionProbe;
  function box(type,body){const size=Buffer.alloc(8);size.writeUInt32BE(8+body.length);size.write(type,4);return Buffer.concat([size,body]);}
  const videoId=crypto.randomBytes(16),audioId=crypto.randomBytes(16);
  const tenc=Buffer.alloc(24);tenc[0]=1;tenc[5]=0x19;tenc[6]=1;tenc[7]=16;videoId.copy(tenc,8);
  const init=box('moov',box('trak',box('mdia',box('minf',box('stbl',box('stsd',Buffer.concat([
    Buffer.alloc(8),box('encv',Buffer.concat([Buffer.alloc(78),box('sinf',box('schi',box('tenc',tenc)))]))
  ])))))));
  const before=Buffer.from(init),ids=probe.ids(init);
  assert.equal(ids.length,1);assert.deepEqual(Buffer.from(ids[0]),videoId);assert.deepEqual(init,before);
  assert.equal(probe.coverage([],[]),'unknown');
  assert.equal(probe.coverage(ids,[{id:audioId,status:'usable'}]),'false');
  assert.equal(probe.coverage(ids,[{id:videoId,status:'output-restricted'}]),'false');
  assert.equal(probe.coverage(ids,[{id:videoId,status:'usable'}]),'true');
  assert.equal(probe.coverage([videoId,audioId],[{id:videoId,status:'usable'}]),'false');
  assert.equal(probe.coverage([videoId,audioId],[{id:videoId,status:'usable'},{id:audioId,status:'usable'}]),'true');
  assert.equal(probe.ids(box('mdat',box('tenc',tenc))).length,0);
  const broken=Buffer.from(init);broken.writeUInt32BE(init.length+1);assert.throws(()=>probe.ids(broken),/size/);
  assert.throws(()=>probe.ids(Buffer.alloc(2097153)),/limit/);
});

test('Samsung WASM capability inspection distinguishes missing, legacy and versioned APIs without mutating platform metadata', async()=>{
  const sandbox={window:{}};
  vm.runInNewContext((await fs.readFile(path.join(root,'web/tv-app.js'),'utf8')).split('// TV_MENU_START')[0],sandbox);
  const inspect=sandbox.window.ApexWasmCapabilities;
  assert.match(inspect({}),/EMSS=absent/);
  const entry=Object.freeze({name:'ElementaryMediaStreamSource',version:'1.2',apiLevels:Object.freeze([1]),features:Object.freeze(['base-emss'])});
  assert.match(inspect({WebAssembly:{},tizentvwasm:{availableApis:Object.freeze([entry])}}),/EMSS=1.2; levels=1/);
  assert.match(inspect({tizentvwasm:{isApiSupported:(name,level)=>level===0}}),/level1=false; EMSS legacy=true/);
  assert.match(inspect({tizentvwasm:{isApiSupported:()=>{throw new TypeError('Unavailable');}}}),/capabilityError=TypeError/);
});
