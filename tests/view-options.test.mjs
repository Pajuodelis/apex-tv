import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import crypto from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import Views from '../web/view-options.js';
import {buildRelayManifest} from '../companion/media.mjs';
import {createApp} from '../companion/server.mjs';
import {root} from '../companion/paths.mjs';
const protection='<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cbcs"/><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>unchanged-public-protection-metadata</cenc:pssh></ContentProtection>';
const template='<SegmentTemplate timescale="48000" startNumber="1000000041" presentationTimeOffset="48000000" initialization="$RepresentationID$-init.mp4" media="$RepresentationID$-$Time$.m4s"><SegmentTimeline><S t="48000000" d="96000" r="3"/></SegmentTimeline></SegmentTemplate>';
function audio(id,lang,codec='mp4a.40.2',label=''){return '<AdaptationSet id="'+id+'" contentType="audio" lang="'+lang+'">'+protection+(label?'<Label>'+label+'</Label>':'')+template+'<Representation id="a-'+id+'" codecs="'+codec+'" bandwidth="128000"/></AdaptationSet>';}
const video='<AdaptationSet id="v" contentType="video">'+protection+template+'<Representation id="v720" codecs="avc1.640028" bandwidth="2500000" width="1280" height="720"/></AdaptationSet>';
const mpd='<MPD type="static" xmlns:cenc="urn:mpeg:cenc:2013" mediaPresentationDuration="PT100S"><Period>'+video+audio('en','eng')+audio('fr','fra')+audio('de','deu','ec-3')+'</Period></MPD>';
const stream={manifestXML:mpd,manifestUrl:'https://vod.formula1.com/fixture/manifest.mpd',drm:'widevine'};
async function tvMedia(){const context={window:{DOMParser,XMLSerializer,ApexViewOptions:Views,ApexVideoQuality:(await import('../web/video-quality.js')).default},URL,Map,Set,BigInt,Uint8Array,DataView,TextEncoder,TextDecoder};vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../web/dash-manifest.js',import.meta.url),'utf8'),context);vm.runInContext(await fs.readFile(new URL('../web/tv-media.js',import.meta.url),'utf8'),context);return context.window.ApexTVMedia;}

test('audio choices come from AAC metadata, without unavailable languages or unsupported codecs',()=>{
  assert.deepEqual(Views.audioTracks(mpd),[{id:'set:en',language:'eng',label:'Anglų'},{id:'set:fr',language:'fra',label:'Prancūzų'}]);
  assert.equal(Views.audioTracks(mpd).some(t=>t.language==='lit'||t.language==='deu'),false);
});
test('duplicate commentary labels remain distinguishable and service labels are decoded',()=>{
  const result=Views.audioTracks('<MPD>'+audio('one','eng')+audio('two','eng')+audio('three','eng','mp4a.40.2','International &amp; track sound')+'</MPD>');
  assert.equal(new Set(result.map(t=>t.label)).size,3);assert.ok(result[2].label.includes('International & track sound'));
});
test('default audio stays English; a saved language is used only when actually present',()=>{
  assert.equal(Views.selectAudio(mpd).id,'set:en');assert.equal(Views.selectAudio(mpd,'','fra').id,'set:fr');assert.equal(Views.selectAudio(mpd,'','lit').id,'set:en');
  assert.throws(()=>Views.selectAudio(mpd,'set:unknown'));assert.throws(()=>Views.selectAudio(mpd,{id:'set:fr'}));
});
test('unsafe or oversized XML cannot introduce choices; identifiers survive representation reordering',()=>{
  assert.deepEqual(Views.audioTracks('<!DOCTYPE MPD>'+mpd),[]);assert.deepEqual(Views.audioTracks('x'.repeat(2097153)),[]);
  const text=audio('a','fra').replace('id="a" contentType','contentType');assert.equal(Views.audioTracks(text)[0].id,'rep:a-a');
  assert.equal(Views.audioTracks('<MPD>'+audio('fr','fra')+audio('en','eng')+'</MPD>')[0].id,'set:fr');
});
test('TV relay selects the requested language and retains Widevine and CBCS metadata',async()=>{
  const api=await tvMedia(),relay=api.build({...stream,audioTrackId:'set:fr'},'http://127.0.0.1/'+'a'.repeat(32));
  assert.match(relay.mpd,/lang="fra"/);assert.doesNotMatch(relay.mpd,/lang="eng"|ec-3/);assert.match(relay.mpd,/value="cbcs"/);assert.match(relay.mpd,/unchanged-public-protection-metadata/);
  assert.equal(relay.summaries.filter(t=>t.type==='audio')[0].language,'fra');
  const slot=relay.slots.findIndex(s=>s.type==='audio'&&s.kind==='media');const asset=api.resolveAsset(relay,slot,'a-fr',new URLSearchParams('t=0'));
  assert.equal(asset.url,'https://vod.formula1.com/fixture/a-fr-48000000.m4s');
  assert.throws(()=>api.resolveAsset(relay,slot,'a-en',new URLSearchParams('t=0')));
});
test('TV relay rejects stale language identifiers instead of silently selecting another track',async()=>{
  const api=await tvMedia();assert.throws(()=>api.build({...stream,audioTrackId:'set:missing'},'http://127.0.0.1/'+'a'.repeat(32)));
});
test('TV relay default stays English and live track selection does not rebase live timestamps',async()=>{
  const api=await tvMedia(),base='http://127.0.0.1/'+'b'.repeat(32);
  assert.match(api.build(stream,base).mpd,/lang="eng"/);
  const relay=api.build({...stream,audioTrackId:'set:fr',manifestXML:mpd.replace('type="static"','type="dynamic"')},base);
  assert.equal(relay.live,true);assert.match(relay.mpd,/presentationTimeOffset="48000000"/);assert.match(relay.mpd,/startNumber="1000000041"/);assert.match(relay.mpd,/lang="fra"/);
});
test('companion relay and TV relay choose the same authorised audio adaptation',async()=>{
  const pc=buildRelayManifest({...stream,audioTrackId:'set:fr'},'a'.repeat(48),'http://127.0.0.1:8317');const tv=(await tvMedia()).build({...stream,audioTrackId:'set:fr'},'http://127.0.0.1/'+'a'.repeat(32));
  assert.deepEqual(pc.summaries.map(t=>[t.type,t.language]),Array.from(tv.summaries,t=>[t.type,t.language]));assert.doesNotMatch(pc.mpd,/lang="eng"/);assert.match(pc.mpd,/value="cbcs"/);assert.throws(()=>buildRelayManifest({...stream,audioTrackId:'set:missing'},'a'.repeat(48),'http://127.0.0.1:8317'));
});
test('camera choices discard malformed and duplicate service identifiers and remain bounded',()=>{
  const data={channels:[{id:'12',title:'Verstappen',type:'OB'},{id:'12',title:'Duplicate'},{id:'../13',title:'Invalid'},{id:'14',title:'\u0000Leclerc'}]};assert.deepEqual(Views.channels(data).map(t=>[t.id,t.title]),[['12','Verstappen'],['14','Leclerc']]);
  assert.equal(Views.channels({channels:Array.from({length:100},(_,i)=>({id:String(i+1)}))}).length,64);
});
async function standalone(){
  const indexedDB={open(){const q={result:{transaction(){return {objectStore(){return {get(){const value={result:undefined};setTimeout(()=>value.onsuccess(),0);return value;}};}};}}};setTimeout(()=>q.onsuccess(),0);return q;}};
  const context={window:{APEX_CONTEXT:{revision:'test'}},indexedDB,fetch:async()=>{throw Error("Unexpected network in test");},crypto:crypto.webcrypto,URL,Promise,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,atob,btoa};vm.createContext(context);
  vm.runInContext(await fs.readFile(new URL('../web/view-options.js',import.meta.url),'utf8'),context);vm.runInContext(await fs.readFile(new URL('../web/discovery.js',import.meta.url),'utf8'),context);vm.runInContext(await fs.readFile(new URL('../web/f1-browser.js',import.meta.url),'utf8'),context);
  const direct=context.window.ApexStandalone;direct.client.json=async()=>({});return direct;
}
test('standalone routes forward the selected camera and bind the unchanged licence challenge to its ticket',async()=>{
  const direct=await standalone(),calls=[];direct.client.channels=async id=>({contentId:id,channels:[{id:'12',title:'Driver'}]});
  assert.equal((await direct.request('/api/channels?id=42')).channels[0].id,'12');
  direct.client.playback=async(...args)=>{calls.push(args);return {...stream,licenseUrl:'https://drm.formula1.com/fixture',drmToken:'fixture-drm-token'};};
  const result=await direct.request('/api/play','POST',{id:'42',channelId:'12',audioLanguage:'fra'});
  assert.deepEqual(calls,[['42','WEB_DASH','legacy-default','12']]);assert.equal(result.channelId,'12');assert.equal(result.audioTrackId,'set:fr');assert.equal(result.drm,'widevine');
  const challenge=new Uint8Array([8,2,3,4]);direct.client.license=async(bound,body)=>{assert.equal(bound.drmToken,'fixture-drm-token');assert.equal(bound.audioTrackId,'set:fr');assert.deepEqual(Array.from(body),Array.from(challenge));return new Uint8Array([8,2,9,10]);};
  assert.deepEqual(Array.from(new Uint8Array(await direct.request('/api/license/'+result.ticket,'POST',challenge))),[8,2,9,10]);
});
test('standalone selected camera must be one the service supplied for this content',async()=>{
  const direct=await standalone(),client=direct.client;client.context=async()=>({login:'R',tail:'fixture'});client.headers=()=>({});client.json=async()=>({resultObj:{metadata:{contentId:'42',title:'Qualifying',additionalStreams:[{channelId:'12',title:'Driver',type:'OB'}]}}});
  assert.equal(await client.validateChannel('42','12'),'12');await assert.rejects(client.validateChannel('42','13'));await assert.rejects(client.validateChannel('42','../12'));
});
test('companion camera route requires pairing and play selects an available language without exporting account tokens',async(t)=>{
  const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),calls=[];const client={status:()=>({signedIn:true,country:'LT'}),channels:async id=>({contentId:id,channels:[{id:'12',title:'Driver'}]}),playback:async(...args)=>{calls.push(args);return {...stream,licenseUrl:'https://drm.formula1.com/fixture',entitlementToken:'private-account-fixture'};}};
  const app=await createApp({root,client,setupData:{config:{pcAddress:'192.168.50.10',tvAddress:'192.168.50.20',port:8317},pairingKey:'fixture-key',privateKey:keys.privateKey,publicKey:keys.publicKey.export({format:'jwk'})}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const send=(route,body,key='fixture-key')=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path:route,method:body?'POST':'GET',headers:{Host:'127.0.0.1:8317',...(key?{'X-Apex-Key':key}:{}),'Content-Type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text),text}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});
  assert.equal((await send('/api/channels?id=42',null,'')).status,401);assert.equal((await send('/api/channels?id=42')).data.channels[0].id,'12');
  const result=await send('/api/play',{id:'42',channelId:'12',audioTrackId:'set:fr',videoQuality:'720p',relay:true});assert.equal(result.status,200);assert.equal(result.data.videoQuality,'720p');assert.equal(result.data.selectedVideo.height,720);assert.equal(result.data.audioTrackId,'set:fr');assert.equal(result.data.channelId,'12');assert.equal(calls[0][3],'12');assert.ok(!result.text.includes('private-account-fixture'));
  const bad=await send('/api/play',{id:'42',channelId:'12',audioTrackId:'set:unknown',relay:true});assert.notEqual(bad.status,200);
});