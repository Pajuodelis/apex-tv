import I18n from '../web/i18n.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import crypto from 'node:crypto';
import Health from '../web/playback-health.js';import Drivers from '../web/favorite-driver.js';import Discovery from '../web/discovery.js';
const ui=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8');
function source(name,next){return ui.slice(ui.indexOf('  function '+name+'('),ui.indexOf('  function '+next+'('));}
const channel=(id,name)=>({id:String(id),title:name+' · POV',type:'OB'});
test('DVR uses Samsung millisecond window, rejects malformed windows and clamps to the actual edge',()=>{
 const range=Health.liveWindow('900000|1200000',1000);assert.deepEqual(range,{start:900,end:1200,duration:300,delay:200,edge:1197});assert.equal(Health.seekLive(range,910,-30),900);assert.equal(Health.seekLive(range,1190,30),1197);
 for(const value of ['','0|0','20|10','NaN|100','-100|200','0|1|2','9007199254740992000|9007199254740993000'])assert.equal(Health.liveWindow(value,10),null);
});
test('fresh stream recovery is bounded and refreshes an expired account session at most once',()=>{
 let now=1000000;const policy=Health.controller(()=>now);assert.deepEqual(policy.retry('HTTP 401'),{attempt:1,delay:2000,refreshSession:true});assert.equal(policy.retry('HTTP 401'),null);assert.equal(policy.retry('PLAYER_ERROR_CONNECTION_FAILED').delay,5000);assert.equal(policy.retry('HTTP 502').delay,10000);assert.equal(policy.retry('HTTP 502'),null);policy.reset();assert.equal(policy.retry('network').attempt,1);
 for(const error of ['HTTP 403','HTTP 404','NOT_SUPPORTED','F1 atmetė licencijos užklausą.','neatpažintas serveris','HTTP 422'])assert.equal(Health.retryKind(error),'');
});
function healthHarness(){let now=1000000;const policy=Health.controller(()=>now),options={position:0,mode:'best',preference:'best',enabled:true,bestBandwidth:6144000};return{policy,options,time(n){now=n;},add(n){now+=n;},tick(extra){return policy.tick({...options,...extra});},now:()=>now};}
test('three sustained stalls lower best temporarily and high measured throughput permits recovery after three stable minutes',()=>{
 const h=healthHarness();for(let i=0;i<3;i++){h.policy.buffering(true);h.add(3000);h.policy.buffering(false);h.add(4000);}assert.equal(h.tick({position:1}),'720p');assert.equal(h.policy.snapshot().lowered,true);h.add(181000);assert.equal(h.tick({position:190,mode:'720p',transfer:{bps:12000000,samples:5,at:h.now()}}),'best');assert.equal(h.policy.snapshot().lowered,false);
});
test('single continuous stall is detected even without buffering callbacks; short fluctuations are ignored',()=>{
 const h=healthHarness();const actions=[];for(let i=0;i<16;i++){h.add(1000);const action=h.tick({position:1});if(action)actions.push(action);}assert.deepEqual(actions,['720p']);const small=healthHarness();for(let i=0;i<5;i++){small.policy.buffering(true);small.add(500);small.policy.buffering(false);small.add(500);}assert.equal(small.tick({position:5}),null);
});
test('quality recovery requires fresh, sufficient transfer measurements and respects manual 720p or disabled automatic mode',()=>{
 const h=healthHarness();h.policy.switched('720p',true);h.add(181000);for(const transfer of [null,{bps:12000000,samples:1,at:h.now()},{bps:7000000,samples:8,at:h.now()},{bps:12000000,samples:8,at:h.now()-31000}])assert.equal(h.tick({mode:'720p',position:200,transfer}),null);
 assert.equal(h.tick({mode:'720p',preference:'720p',position:200,transfer:{bps:12000000,samples:8,at:h.now()}}),null);assert.equal(h.tick({mode:'720p',enabled:false,position:200,transfer:{bps:12000000,samples:8,at:h.now()}}),null);
});
test('pause, seek, modal and offline reset stable observation instead of looking like a bandwidth failure',()=>{
 for(const flag of ['paused','busy','offline']){const h=healthHarness();h.policy.switched('720p',true);h.add(181000);h.tick({mode:'720p',position:10,[flag]:true});h.add(1000);assert.equal(h.tick({mode:'720p',position:11,transfer:{bps:20000000,samples:8,at:h.now()}}),null);}
});
test('failed quality upgrades stay at 720p and wait ten minutes before another attempt',()=>{
 const h=healthHarness();h.policy.switched('720p',true);h.add(181000);assert.equal(h.tick({mode:'720p',position:190,transfer:{bps:12000000,samples:8,at:h.now()}}),'best');h.policy.failed('720p','best');h.add(181000);assert.equal(h.tick({mode:'720p',position:390,transfer:{bps:12000000,samples:8,at:h.now()}}),null);h.add(420000);assert.equal(h.tick({mode:'720p',position:810,transfer:{bps:12000000,samples:8,at:h.now()}}),'best');
});
test('favorite driver is persisted by identity, never by a channel ID belonging to another content',()=>{
 const map=new Map(),disk={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};const store=Drivers.store(disk);store.observe([channel(22,'Charles Leclerc')]);store.set('Charles Leclerc');const newContent=[channel(22,'Max Verstappen'),channel(83,'Charles Leclerc')];assert.equal(Drivers.match(newContent,store.get()).id,'83');assert.equal(Drivers.match([channel(22,'Max Verstappen')],store.get()),null);assert.equal(Drivers.store(disk).get().name,'Charles Leclerc');assert.ok(!map.values().next().value.includes('83'));store.clear();assert.equal(store.get(),null);
});
test('driver parsing accepts actual onboard names, Unicode names and rejects normal commentary channels',()=>{
 assert.equal(Drivers.driver({id:'42',title:'OBC - Pierre Gasly',type:'OB'}).name,'Pierre Gasly');assert.equal(Drivers.name('Oscar Piastri'),'Oscar Piastri');assert.equal(Drivers.name('Obadiah Racer'),'Obadiah Racer');assert.equal(Drivers.key('Sérgio Pérez'),'sergio perez');assert.equal(Drivers.driver({id:'../42',title:'Leclerc',type:'OB'}),null);assert.equal(Drivers.driver({id:'42',title:'International',type:'CHANNEL'}),null);
});
const session=(id,title,start,end,extra={})=>({id:String(id),title,kind:'video',start,end,series:'Formula 1',live:false,...extra});
test('weekend program excludes historical same-GP sessions, support series and duplicate shows',()=>{
 const now=Date.UTC(2026,9,11,8),meeting={meetingStart:now-86400000,meetingEnd:now+86400000};const values=[session(1,'Qualifying',now-3600000,now-1800000),session(2,'Race',now+3600000,now+7200000),session(3,'2025 Qualifying',now-31536000000,now-31535999000),session(4,'Pre-Race Show',now,now+100000),session(5,'F1 Kids',now,now+100000),session(6,'Race',now+3600000,now+7200000,{series:'Formula 2'})];assert.deepEqual(Discovery.program(values,now,[],meeting).map(x=>[x.id,x.state,x.playable]),[['1','replay',true],['2','upcoming',false]]);
});
test('clock time alone never labels a session live or playable; only service LIVENOW makes LIVE available',()=>{
 const values=[session(1,'Race',1000,5000),session(2,'Qualifying',1000,0)];assert.ok(Discovery.program(values,2000,[]).every(i=>!i.live&&!i.playable));const live=Discovery.program(values,2000,[{...values[0],live:true}]);assert.equal(live[0].state,'live');assert.equal(live[0].playable,true);assert.equal(live[1].playable,false);
});
test('meeting choice uses actual service dates, prefers current then next, independent of catalogue order',()=>{
 const meetings=[{id:'2',kind:'page',meetingStart:2000,meetingEnd:3000,series:'Formula 1'},{id:'1',kind:'page',meetingStart:100,meetingEnd:500,series:'Formula 1'},{id:'3',kind:'page',meetingStart:2100,meetingEnd:3100,series:'Formula 2'}];assert.equal(Discovery.chooseMeeting(meetings,2200).id,'2');assert.equal(Discovery.chooseMeeting(meetings,1500).id,'2');assert.equal(Discovery.chooseMeeting(meetings,4000).id,'2');
});
test('normalization keeps public images and schedule dates, discards tokens and malicious image servers, and remains bounded',()=>{
 const raw={containers:[{metadata:{contentId:'42',title:'Qualifying',pictureUrl:'official/landscape',subscriptionToken:'private',emfAttributes:{Series:'Formula 1',sessionStartDate:1791720000000,sessionEndDate:1791727200000,Meeting_Start_Date:'2026-10-09',Meeting_End_Date:'2026-10-11'}}}]};const result=Discovery.normalize(raw)[0];assert.equal(result.start,1791720000000);assert.equal(result.image,'https://f1tv.formula1.com/image-resizer/image/official/landscape');assert.ok(!JSON.stringify(result).includes('private'));assert.equal(Discovery.picture('https://f1tv.formula1.com.evil.test/photo'), '');assert.equal(Discovery.picture('https://user:secret@f1tv.formula1.com/photo'),'');assert.equal(Discovery.picture('https://f1tv.formula1.com/photo?token=secret'),'');assert.equal(Discovery.normalize({items:Array.from({length:400},(_,i)=>({metadata:{contentId:String(i),title:'Race'}}))},{limit:240}).length,240);
});
test('global search uses the current official search page route, encoded user text and query validation before any network',async()=>{
 const calls=[],client={context:async()=>({login:'R',tail:'PRO/ALL'}),headers:()=>({}),json:async url=>{calls.push(url);return{items:[{metadata:{contentId:'42',title:'2025 Monaco Qualifying'}}]};}};const result=await Discovery.search(client,'  Monaco & 2025 ');assert.equal(result.items[0].id,'42');assert.equal(calls[0],'https://f1tv.formula1.com/2.0/R/ENG/WEB_DASH/ALL/PAGE/5234/PRO/ALL?search=Monaco%20%26%202025');await assert.rejects(Discovery.search(client,'ab'),error=>error.status===400);assert.equal(calls.length,1);
});
test('schedule always formats Europe/Vilnius and applies the seasonal daylight offset',()=>{
 assert.match(Discovery.localTime(Date.UTC(2026,6,1,12)),/15:00/);assert.match(Discovery.localTime(Date.UTC(2026,0,1,12)),/14:00/);assert.equal(Discovery.localTime(0),'Laikas nepateiktas');
});
async function updateHarness(){
 const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),map=new Map(),context={window:{localStorage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)}},crypto:crypto.webcrypto,TextDecoder,TextEncoder,ArrayBuffer,Uint8Array,URL,atob,btoa,Promise};vm.createContext(context);
 vm.runInContext(await fs.readFile(new URL('../tv/menu-cache.js',import.meta.url),'utf8'),context);vm.runInContext(await fs.readFile(new URL('../web/online-updates.js',import.meta.url),'utf8'),context);
 let saved=null,writes=0,localCalls=0;const cfg={shell:1,bundledVersion:'0.4.1',publicKey:keys.publicKey.export({format:'jwk'})},ctx={version:'0.5.0',revision:'1'.repeat(24),server:'http://192.168.50.10:8317'};
 function bundle(version='0.5.1',builtAt=2000,revision='2'.repeat(24)){const files={'tv-app.js':new TextEncoder().encode('/* menu */').buffer,'tv.css':new TextEncoder().encode('body{}').buffer},m={shell:1,version,builtAt,revision,files:Object.entries(files).map(([name,value])=>({name,path:'/release/'+revision+'/'+name,integrity:'sha256-'+crypto.createHash('sha256').update(Buffer.from(value)).digest('base64')}))};const payload=Buffer.from(JSON.stringify(m)).toString('base64');return{signed:{payload,signature:crypto.sign('RSA-SHA256',Buffer.from(payload,'base64'),keys.privateKey).toString('base64')},files};}
 let data=bundle(),broken=null;const gets=[];const get=async url=>{gets.push(url);if(broken)throw broken;return url.includes('manifest.json')?JSON.stringify(data.signed):data.files[url.split('/').pop()];};const cache=async value=>{if(value){writes++;saved=value;}return saved;};context.window.ApexMenuCache.download=async()=>{localCalls++;return{bundle:data,manifest:await context.window.ApexMenuCache.manifest(data.signed,cfg)};};
 return{context,cfg,ctx,bundle,get,cache,map,gets,writes:()=>writes,localCalls:()=>localCalls,setData:v=>{data=v;},break:v=>{broken=v;},create:options=>context.window.ApexOnlineUpdates.create(cfg,ctx,{get,cache,...options})};
}
test('internet menu verifies pinned RSA and both file hashes before persisting, without any PC request',async()=>{
 const h=await updateHarness(),updater=h.create();const result=await updater.check(true);assert.equal(result.pending,true);assert.equal(result.source,'internet');assert.equal(h.writes(),1);assert.equal(h.localCalls(),0);assert.ok(h.gets.every(url=>url.startsWith(h.context.window.ApexOnlineUpdates.source+'/')));assert.equal(JSON.parse(h.map.get('apex-update-floor')).version,'0.5.1');
});
test('forged cloud signatures and changed files are rejected without overwriting good cache or using the PC fallback',async()=>{
 for(const mode of ['signature','bytes','document']){const h=await updateHarness(),data=h.bundle();if(mode==='signature')data.signed.signature=Buffer.alloc(256).toString('base64');if(mode==='bytes')data.files['tv.css']=new TextEncoder().encode('malicious').buffer;if(mode==='document')h.break(Error('Netinkamas atnaujinimo dokumentas.'));h.setData(data);await assert.rejects(h.create().check(true));assert.equal(h.writes(),0);assert.equal(h.localCalls(),0);}
});
test('signed rollback below the cached version or build time is rejected, while a new higher version is accepted',async()=>{
 const h=await updateHarness();h.map.set('apex-update-floor',JSON.stringify({version:'0.5.1',builtAt:3000}));h.setData(h.bundle('0.5.1',2000));await assert.rejects(h.create().check(true),/Senesnis/);h.setData(h.bundle('0.4.9',4000));await assert.rejects(h.create().check(true),/Senesnis/);h.setData(h.bundle('0.5.2',4000));assert.equal((await h.create().check(true)).version,'0.5.2');assert.equal(h.writes(),1);
});
test('a busy player only checks the small manifest; manual update stages files and concurrent checks share a single request',async()=>{
 const h=await updateHarness(),updater=h.create({busy:()=>true});const result=await updater.check(false);assert.equal(result.available,true);assert.equal(h.gets.length,1);assert.equal(h.writes(),0);const one=updater.check(true),two=updater.check(true);assert.equal(one,two);assert.equal((await one).pending,true);assert.equal(h.writes(),1);
});
test('cloud connectivity failure falls back only to the configured private LAN with the same signature validation',async()=>{
 const h=await updateHarness();h.break(Object.assign(Error('unreachable'),{code:'NETWORK'}));assert.equal((await h.create().check(true)).source,'pc');assert.equal(h.localCalls(),1);const blocked=await updateHarness();blocked.ctx.server='https://untrusted.example/';blocked.break(Object.assign(Error('unreachable'),{code:'NETWORK'}));await assert.rejects(blocked.create().check(true));assert.equal(blocked.localCalls(),0);
});
test('native live seeking is serialized and stays within the advertised moving DVR window',()=>{
 const ids={'player-state':{}},c={playing:true,seekBusy:false,viewBusy:false,playbackKind:'live',activeEngine:'AVPlay',showOverlay(){},metrics:()=>({position:901,duration:0}),getLiveWindow:()=>Health.liveWindow('900000|1200000',901),Health,document:{getElementById:id=>ids[id]},nativeSeek(target,done){c.target=target;c.done=done;c.seekBusy=true;},updatePlayer(){}};c.I18n=I18n;vm.createContext(c);vm.runInContext(source('seek','startContent'),c);c.seek(false,30);assert.equal(c.target,900);c.seek(true,30);assert.equal(c.target,900);c.seekBusy=false;c.metrics=()=>({position:1190});c.seek(true,30);assert.equal(c.target,1197);c.seekBusy=false;c.getLiveWindow=()=>null;c.target=null;c.seek(true);assert.equal(c.target,null);
});
test('recovery keeps VOD pause, camera, audio and quality but asks F1 for a fresh stream ticket',async()=>{
 const queued=[],main={appendChild(){}},notes=[],calls=[],c={seekBusy:false,document:{hidden:false},navigator:{onLine:true},recoverySerial:0,recoveryPending:null,recoveryTimer:0,Date,Promise,window:{},root:{querySelector:()=>main},preferredAudioLanguage:'fra',preferredQuality:'best',cancelRecovery(){c.recoveryPending=null;c.recoverySerial++;},stopPlayback(ended,preserve){assert.equal(preserve,true);c.recoverySerial++;},node(tag,text){return{setAttribute(){},appendChild(v){notes.push(v);},firstChild:{textContent:text}};},button:()=>({focus(){}}),setFocus(){},setTimeout(fn){queued.push(fn);return queued.length;},request:async(route,method,data)=>{calls.push({route,data});return{ticket:'fresh-ticket',relayed:true};},prepareViewPlayback(item,stream,compatibilityStart,resumeAt,options){return{item,stream,compatibilityStart,resumeAt,...options};},viewTitle:()=>'Qualifying',begin(stream){c.stream=stream;},diagnostic(){},playbackHealth:Health.controller(),error(){assert.fail('Unexpected error');},startContent(){}};
 c.I18n=I18n;vm.createContext(c);vm.runInContext(source('runRestart','restartCurrentPlayback'),c);const snapshot={item:session(42,'Qualifying',1,2),resumeAt:345,paused:true,channelId:'83',audioTrackId:'set:fr',videoQuality:'720p',bestBandwidth:6144000,bestHeight:1080};assert.equal(c.runRestart(snapshot,'recover',{attempt:1,delay:1}),true);queued.shift()();await new Promise(setImmediate);assert.equal(calls[0].data.channelId,'83');assert.equal(calls[0].data.audioTrackId,'set:fr');assert.equal(c.activePlayback.resumeAt,345);assert.equal(c.activePlayback.pausedAtStart,true);assert.equal(c.stream.ticket,'fresh-ticket');
});

test('verified current cache supplies the rollback floor even for an old TV shell without builtAt in its context',async()=>{
 const h=await updateHarness();await h.cache(h.bundle('0.5.0',4000,'1'.repeat(24)));h.setData(h.bundle('0.5.0',3000,'2'.repeat(24)));await assert.rejects(h.create().check(true),/Senesnis/);assert.equal(JSON.parse(h.map.get('apex-update-floor')).builtAt,4000);
});
test('identical signed code is current despite an older CDN timestamp, and never lowers the persisted floor',async()=>{
 const h=await updateHarness();await h.cache(h.bundle('0.5.0',4000,'1'.repeat(24)));h.setData(h.bundle('0.5.0',3000,'1'.repeat(24)));assert.equal((await h.create().check(true)).current,true);assert.equal(JSON.parse(h.map.get('apex-update-floor')).builtAt,4000);
});
test('a new version with identical asset hashes still stages its new metadata and updates the runtime version',async()=>{
 const h=await updateHarness();h.setData(h.bundle('0.5.1',4000,'1'.repeat(24)));assert.equal((await h.create().check(true)).pending,true);assert.equal(h.writes(),1);assert.equal(JSON.parse(h.map.get('apex-update-floor')).version,'0.5.1');
});

test('initializing from a valid older current cache cannot lower a higher persisted version',async()=>{
 const h=await updateHarness();h.map.set('apex-update-floor',JSON.stringify({version:'0.5.2',builtAt:3000}));await h.cache(h.bundle('0.5.0',4000,'1'.repeat(24)));h.setData(h.bundle('0.5.1',5000,'2'.repeat(24)));await assert.rejects(h.create().check(true),/Senesnis/);assert.equal(JSON.parse(h.map.get('apex-update-floor')).version,'0.5.2');
});
test('the current official search page yields playable sessions across seasons and excludes its title header',async()=>{
 const data={resultObj:{containers:[{id:'5234_1016',title:'Search',retrieveItems:{resultObj:{containers:[]}}},{id:'5234_1018',retrieveItems:{handling:'usersearch',resultObj:{containers:[{metadata:{contentId:'42',contentType:'BUNDLE',title:'2026 Monaco GP'},actions:[{key:'onClick',uri:'/2.0/R/ENG/WEB_DASH/ALL/PAGE/12306/PRO/2'}]}]}}},{id:'5234_1019',retrieveItems:{handling:'usersearch',resultObj:{containers:[{metadata:{contentId:'1000010265',contentType:'VIDEO',title:'2026 Monaco GP - Qualifying',duration:5287}},{metadata:{contentId:'1000007192',contentType:'VIDEO',title:'2025 Monaco GP - Qualifying',duration:4600}}]}}}]}};
 const client={context:async()=>({login:'R',tail:'PRO/2'}),headers:()=>({}),json:async()=>data};const result=await Discovery.search(client,'Monaco');assert.deepEqual(result.items.map(i=>[i.id,i.kind]),[['12306','page'],['1000010265','video'],['1000007192','video']]);assert.ok(!result.items.some(i=>i.title==='Search'));
});
test('opening a GP from global search renders its sessions, and Back restores the query, results, page and focus',()=>{
 const videos=[session(42,'2026 Monaco GP - Qualifying',1,2)],searchView={tab:'search',title:'Paieška',searchTerm:'Monaco',searchResults:[{id:'12306',title:'Monaco 2026',kind:'page'}],offset:2,focusKey:'content-page-12306'},seen=[],routes=[],c={current:searchView,stack:[],playing:false,modal:null,searchTimer:0,liveTimer:0,pendingRequest:0,account:{signedIn:true},UX:{item:v=>v},localStore:{recent(){}},cancelRecovery(){},rememberView(){},clearTimeout(){},clearInterval(){},applyPreferences(){},layout:()=>({querySelector:()=>null}),catalogueCache:{get(route){routes.push(route);return{items:videos,at:1000};}},renderItems(main,items){seen.push(['catalog',items]);},renderGlobalSearch(){seen.push(['search',c.current.searchTerm]);},renderVideoDetails(main,item){seen.push(['video',item.id]);},setFocus(){},updateConnection(){}};
 c.motion={enter(){}};c.I18n=I18n;vm.createContext(c);vm.runInContext('var phoneLoginCleanup=null;'+source('cancelPhoneScreen','render')+source('openItem','itemCard')+source('catalogRoute','refreshLive')+source('render','renderTVAccount')+source('goBack','streamAudioChoices'),c);
 c.openItem(searchView.searchResults[0]);assert.equal(routes[0],'/api/catalog?page=12306');assert.equal(seen[0][0],'catalog');assert.equal(seen[0][1],videos);c.openItem(videos[0]);assert.deepEqual(seen[1],['video','42']);c.goBack();assert.equal(seen[2][0],'catalog');c.goBack();assert.equal(c.current,searchView);assert.deepEqual(seen[3],['search','Monaco']);assert.equal(c.current.offset,2);assert.equal(c.current.focusKey,'content-page-12306');
});test('browser weekend times use the selected locale without a Node global alias',async()=>{
 const window={ApexI18n:{locale:()=> 'en-GB',timeZone:()=> 'America/New_York'}};
 const c={window,Intl,Date,URL};vm.createContext(c);vm.runInContext(await fs.readFile(new URL('../web/discovery.js',import.meta.url),'utf8'),c);
 assert.equal(typeof c.global,'undefined');assert.match(window.ApexDiscovery.localTime(Date.UTC(2026,6,1,12)),/08:00/);
 window.ApexI18n={locale:()=> 'lt-LT',timeZone:()=> 'Europe/Vilnius'};assert.match(window.ApexDiscovery.localTime(Date.UTC(2026,6,1,12)),/15:00/);
});
