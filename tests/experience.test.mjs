import I18n from '../web/i18n.js';
import UI from '../web/ui-performance.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import UX from '../web/experience.js';
const video=(id,title='2026 Singapore Qualifying',duration=3600)=>({id:String(id),title,kind:'video',duration,live:false});
function storage(initial){let value=initial;return{getItem(){return value;},setItem(k,v){value=v;},raw(){return value;}};}
test('corrupt and oversized saved state recovers to a writable bounded state',()=>{
  for(const bad of ['{broken','x'.repeat(350001),JSON.stringify({version:99,progress:[video(1)]})]){const disk=storage(bad),state=UX.store(disk);assert.equal(state.state().progress.length,0);state.favorite(video(1));assert.equal(JSON.parse(disk.raw()).favorites.length,1);assert.equal(state.writable(),true);}
});
test('blocked TV storage continues in memory and reports persistence unavailable',()=>{
  const state=UX.store({getItem(){throw Error('blocked');},setItem(){throw Error('quota');}});state.favorite(video(1));state.record(video(1),45,3600);assert.equal(state.state().favorites.length,1);assert.equal(state.get(1).position,45);assert.equal(state.writable(),false);
});
test('only safe content metadata is saved; account secrets and signed URLs are discarded',()=>{
  const disk=storage(),state=UX.store(disk);state.favorite({...video(1),token:'private',password:'private',manifestUrl:'https://private'});state.record({...video(1),drm:'secret'},30,3600);assert.equal(/private|secret|https:|password|token|manifestUrl/.test(disk.raw()),false);state.favorite(video('../oops'));assert.equal(state.state().favorites.length,1);
});
test('favorite toggle persists once, stays bounded and rejects live sessions',()=>{
  const disk=storage(),state=UX.store(disk);for(let i=1;i<=65;i++)state.favorite(video(i));assert.equal(state.state().favorites.length,60);assert.equal(state.isFavorite(65),true);assert.equal(state.favorite(video(65)),false);assert.equal(state.isFavorite(65),false);assert.equal(state.favorite({...video(99),live:true}),false);assert.equal(UX.store(disk).state().favorites.length,59);
});
test('resume survives cold startup and recent progress moves to the front',()=>{
  const disk=storage(),state=UX.store(disk,()=>12345);state.record(video(1),88.9,3600);state.record(video(2),300,3600);state.record(video(1),92,3600);const fresh=UX.store(disk);assert.equal(UX.resume(fresh.get(1)),92);assert.equal(fresh.state().progress[0].id,'1');assert.equal(fresh.state().progress.length,2);
});
test('completed and near-end videos leave continue watching but keep watched marks',()=>{
  const state=UX.store(storage());state.record(video(1),3420,3600);assert.equal(state.get(1).completed,true);assert.equal(UX.resume(state.get(1)),0);state.record(video(2),10,0,true);assert.equal(state.get(2).completed,true);assert.equal(UX.resume(state.get(2)),0);assert.equal(UX.completed(60,10000),false);
});
test('live playback and invalid positions never pollute the VOD progress list',()=>{
  const state=UX.store(storage());state.record({...video(1),live:true},200,3600);state.record(video(2),NaN,3600);state.record(video(3),-5,3600);assert.equal(state.state().progress.length,0);
});
test('history and recent GP bounds preserve the newest entries without duplicates',()=>{
  const state=UX.store(storage());for(let i=1;i<=80;i++){state.record(video(i),40,3600);state.recent({id:String(i),title:'GP '+i,kind:'detail'});}state.recent({id:'80',title:'GP 80',kind:'detail'});assert.equal(state.state().progress.length,50);assert.equal(state.state().recent.length,12);assert.equal(state.state().recent[0].id,'80');
});
test('history reset preserves favorites and preferences; signout purges account lists',()=>{
  const state=UX.store(storage());state.favorite(video(1));state.record(video(1),80,3600);state.recent({id:'1',title:'GP',kind:'detail'});state.preference('largeText',true);state.clearHistory();assert.equal(state.state().favorites.length,1);assert.equal(state.state().recent.length,0);assert.equal(state.get(1),null);state.clearAccount();assert.equal(state.state().favorites.length,0);assert.equal(state.state().preferences.largeText,true);
});
test('accent-insensitive search matches every word without mutating the catalogue',()=>{
  const items=[video(1,'2026 Šiaulių Kvalifikacija'),video(2,'2026 Singapore Sprint')],copy=JSON.stringify(items);assert.deepEqual(UX.select(items,'siauliu kval','all','default').map(i=>i.id),['1']);assert.equal(UX.select(items,'2026 missing').length,0);assert.equal(JSON.stringify(items),copy);
});
test('session filters distinguish Kids, sprint qualifying and highlights from main races',()=>{
  const items=[video(1,'Sprint Qualifying'),video(2,'Race Highlights'),video(3,'Race F1 Kids'),video(4,'Qualifying'),video(5,'Practice 1'),video(6,'Race')];for(const [filter,id] of [['sprint','1'],['highlights','2'],['kids','3'],['qualifying','4'],['practice','5'],['race','6']])assert.deepEqual(UX.select(items,'',filter).map(i=>i.id),[id]);
});
test('catalogue sorting is stable and supports season, alphabet and duration',()=>{
  const items=[video(1,'2024 B',10),video(2,'2026 A',20),video(3,'2026 A',20)];assert.deepEqual(UX.select(items,'','all','year').map(i=>i.id),['2','3','1']);assert.deepEqual(UX.select(items,'','all','title').map(i=>i.id),['1','2','3']);assert.deepEqual(UX.select(items,'','all','duration').map(i=>i.id),['2','3','1']);
});
test('pagination clamps stale offsets after search and never renders over 24 items',()=>{
  const items=Array.from({length:100},(_,i)=>video(i));assert.equal(UX.page(items,0).items.length,24);assert.equal(UX.page(items,99).index,4);assert.equal(UX.page(items,4).items.length,4);assert.equal(UX.page([items[0]],4).index,0);assert.equal(UX.page([],8).count,1);assert.equal(UX.page(items,-1).index,0);
});
test('catalogue TTL expires fresh results but retains a bounded offline fallback',()=>{
  let now=100;const cache=UX.cache(()=>now);cache.put('gp',[video(1)]);assert.equal(cache.get('gp',120).items.length,1);now=221;assert.equal(cache.get('gp',120),null);assert.equal(cache.get('gp').items.length,1);for(let i=0;i<31;i++)cache.put('p'+i,[video(i)]);assert.equal(cache.get('gp'),null);assert.equal(cache.get('p0'),null);cache.clear();assert.equal(cache.get('p30'),null);
});
test('player formatting and seek targets handle long videos and media boundaries',()=>{
  assert.equal(UX.time(3661),'1:01:01');assert.equal(UX.time(-10),'0:00');assert.equal(UX.seekTarget(25,-60,3600),0);assert.equal(UX.seekTarget(3590,60,3600),3599);
});
test('playback errors give actionable account or network recovery without signed URLs',()=>{
  assert.match(UX.explain('HTTP 401'),/sesija/);assert.match(UX.explain('HTTP 403 licence rejected'),/prenumeratą/);assert.match(UX.explain('PLAYER_ERROR_CONNECTION_FAILED'),/internetą/);assert.equal(UX.explain('Unknown https://secret.formula1.com/?token=private').includes('private'),false);
});
const source=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8');
function functionSource(name,next){return source.slice(source.indexOf('  function '+name+'('),source.indexOf('  function '+next+'(',source.indexOf('  function '+name+'(')+1));}
function seekSandbox(){let done,fail,stateCalls=0,stops=0;const state={seekBusy:false,viewBusy:false,seekSerial:0,epoch:4,pendingStop:false,playing:true,activeEngine:'AVPlay',playbackKind:'vod',lastMetrics:{position:120,duration:3600},UX,document:{getElementById(){return{};}},showOverlay(){},savePlayback(){},updatePlayer(){},stopPlayback(){stops++;},nativePlayer:{getState(){stateCalls++;return'PLAYING';},getCurrentTime(){return 120000;},getDuration(){return 3600000;},seekTo(at,yes,no){state.target=at;done=yes;fail=no;}}};state.I18n=I18n;vm.createContext(state);vm.runInContext(functionSource('metrics','savePlayback')+functionSource('nativeSeek','updatePlayer')+functionSource('seek','startContent'),state);return{state,done:()=>done(),fail:()=>fail(Error('failed')),calls:()=>stateCalls,stops:()=>stops};}
test('Samsung seeks serialize until callback and suppress all other player reads',()=>{
  const s=seekSandbox();s.state.seek(true,60);assert.equal(s.state.target,180000);const calls=s.calls();s.state.seek(false);assert.equal(s.state.metrics(),null);assert.equal(s.calls(),calls);assert.equal(s.state.seekBusy,true);s.done();assert.equal(s.state.seekBusy,false);assert.equal(s.state.lastMetrics.position,180);
});
test('failed seek releases busy state and pending Back closes only after callback',()=>{
  const s=seekSandbox();s.state.seek(false,10);s.state.pendingStop=true;s.fail();assert.equal(s.state.seekBusy,false);assert.equal(s.stops(),1);
});
test('late seek callback cannot alter a later playback generation',()=>{
  const s=seekSandbox();s.state.seek(true);s.state.epoch++;s.done();assert.equal(s.state.lastMetrics.position,120);
});
test('live player cannot seek and does not invoke native media APIs',()=>{
  const s=seekSandbox();s.state.playbackKind='live';s.state.seek(true);assert.equal(s.calls(),0);assert.equal(s.state.target,undefined);
});
function resumeSandbox({position=0,duration=3600,resumeAt=120,paused=false,live=false}={}) {
  const ids={};for(const id of ['play-pause','player-elapsed','player-remaining','player-timeline','player-state'])ids[id]={textContent:'',hidden:false,firstChild:{style:{}},getAttribute(k){return this[k]??null;},setAttribute(k,v){this[k]=v;}};
  let callback,calls=0,saves=0;const buttons=[{disabled:false},{disabled:false}];
  const c={seekBusy:false,viewBusy:false,prepareTimer:0,clearTimeout,seekSerial:0,epoch:1,pendingStop:false,playing:true,activeEngine:'AVPlay',playbackKind:live?'live':'vod',activePlayback:{item:video(1),resumeAt,resumeApplied:false},lastMetrics:null,lastSaved:Date.now(),Date,UX,document:{hidden:false,getElementById:id=>ids[id]},overlay:{querySelectorAll(){return buttons;}},localStore:UX.store(storage()),showOverlay(){c.shown=true;},stopPlayback(){},nativePlayer:{getState(){return paused?'PAUSED':'PLAYING';},pause(){paused=true;},getCurrentTime(){return position*1000;},getDuration(){return duration*1000;},seekTo(at,done){calls++;c.target=at;callback=done;}}};
  c.UI=UI;c.I18n=I18n;vm.createContext(c);vm.runInContext(functionSource('updateViewControls','restorePause')+functionSource('restorePause','selectCamera')+functionSource('metrics','savePlayback')+functionSource('savePlayback','nativeSeek')+functionSource('nativeSeek','updatePlayer')+functionSource('updatePlayer','showOverlay'),c);return{c,ids,buttons,done(){callback();},calls(){return calls;}};
}
test('resume seeks once after preparation and saves the successfully reached position',()=>{
  const s=resumeSandbox();s.c.updatePlayer();assert.equal(s.c.target,120000);assert.equal(s.c.seekBusy,true);s.c.updatePlayer();assert.equal(s.calls(),1);s.done();assert.equal(s.c.localStore.get(1).position,120);s.c.updatePlayer();assert.equal(s.calls(),1);
});
test('stale resume beyond a shorter new duration starts safely at the beginning',()=>{
  const s=resumeSandbox({duration:90,resumeAt:120});s.c.updatePlayer();assert.equal(s.calls(),0);assert.equal(s.c.activePlayback.resumeApplied,true);assert.equal(s.ids['player-elapsed'].textContent,'0:00');
});
test('paused player keeps controls visible and shows the actual resume action',()=>{
  const s=resumeSandbox({position:50,resumeAt:0,paused:true});s.c.updatePlayer();assert.equal(s.ids['play-pause'].textContent,'Tęsti');assert.equal(s.ids['player-remaining'].textContent,'Liko 59:10');assert.equal(s.c.shown,true);
});
test('live timeline disables all seek buttons and does not create VOD progress',()=>{
  const s=resumeSandbox({live:true});s.c.updatePlayer();assert.equal(s.calls(),0);assert.equal(s.ids['player-timeline'].hidden,true);assert.equal(s.ids['player-elapsed'].textContent,'● TIESIOGIAI');assert.deepEqual(s.buttons.map(b=>b.disabled),[true,true]);assert.equal(s.c.localStore.state().progress.length,0);
});
test('offline banner reports device connectivity and disappears on reconnect',()=>{
  const banner={};const c={root:{querySelector(){return banner;}},navigator:{onLine:false}};c.UI=UI;c.I18n=I18n;vm.createContext(c);vm.runInContext(functionSource('updateConnection','error'),c);c.updateConnection();assert.equal(banner.hidden,false);assert.match(banner.textContent,/Interneto/);c.navigator.onLine=true;c.updateConnection();assert.equal(banner.hidden,true);
});
test('saved metadata is sanitized before cold-start rendering and public state is a copy',()=>{
  const disk=storage(JSON.stringify({version:1,progress:[{...video(1),position:999999,password:'secret'}],favorites:[{...video(2),token:'secret'}],preferences:{largeText:true}})),state=UX.store(disk);assert.equal(state.get(1).position,3600);const copy=state.state();copy.favorites[0].title='changed';assert.notEqual(state.state().favorites[0].title,'changed');state.preference('highContrast',true);assert.equal(/secret|token|password/.test(disk.raw()),false);
});
test('recent GP shortcut opens its catalogue from Home and retains a Back destination',()=>{
  const home={tab:'home',title:'Pradžia'},c={UX,current:home,stack:[],localStore:UX.store(storage()),rememberView(){},render(){c.rendered=true;}};c.UI=UI;c.I18n=I18n;vm.createContext(c);c.cancelRecovery=()=>{};vm.runInContext(functionSource('openItem','itemCard'),c);c.openItem({id:'777',title:'Singapore Grand Prix',kind:'detail'});assert.equal(c.current.tab,'archive');assert.equal(c.current.detail,'777');assert.equal(c.stack[0],home);assert.equal(c.localStore.state().recent[0].id,'777');assert.equal(c.rendered,true);
});
test('camera or language switch restores even an early VOD position and the paused state after seek',()=>{
  const s=resumeSandbox({resumeAt:7});s.c.activePlayback.restoreAfterSwitch=true;s.c.activePlayback.pausedAtStart=true;s.c.updatePlayer();assert.equal(s.c.target,7000);assert.equal(s.c.seekBusy,true);s.done();assert.equal(s.c.metrics().paused,true);assert.equal(s.c.seekBusy,false);assert.equal(s.c.activePlayback.pauseRestored,true);
});
test('live view change preserves pause without attempting to seek a moving live window',()=>{
  const s=resumeSandbox({live:true});s.c.activePlayback.pausedAtStart=true;s.c.updatePlayer();assert.equal(s.calls(),0);assert.equal(s.c.metrics().paused,true);assert.equal(s.ids['play-pause'].textContent,'Tęsti');
});
test('view change waiting for F1 cannot start a concurrent native seek',()=>{
  const s=seekSandbox();s.state.viewBusy=true;s.state.seek(true);assert.equal(s.calls(),0);assert.equal(s.state.target,undefined);
});
test('view controls wait for native preparation, suppress reads while seeking, and restore focus only when ready',()=>{
  let state='READY',reads=0,focus=0;const camera={focus(){focus++;}},audio={focus(){focus++;}},c={activePlayback:{audioTracks:[],returnFocus:'player-camera'},viewBusy:false,seekBusy:false,playing:true,activeEngine:'AVPlay',document:{getElementById:id=>id==='player-camera'?camera:audio},nativePlayer:{getState(){reads++;return state;},getCurrentTime(){return 7000;},getDuration(){return 3600000;}}};c.UI=UI;c.I18n=I18n;vm.createContext(c);vm.runInContext(functionSource('updateViewControls','restorePause')+functionSource('metrics','savePlayback'),c);c.driverStore={get:()=>null};c.updateViewControls();assert.equal(camera.disabled,true);assert.equal(focus,0);c.seekBusy=true;const previous=reads;c.updateViewControls();assert.equal(reads,previous);c.seekBusy=false;state='PLAYING';c.updateViewControls();assert.equal(camera.disabled,false);assert.equal(focus,1);assert.equal(c.activePlayback.returnFocus,'');c.updateViewControls();assert.equal(focus,1);
});
test('starting LIVE clears a previous VOD timeline before native preparation',()=>{
  const ids={};for(const id of ['player-elapsed','player-timeline','player-remaining','play-pause'])ids[id]={textContent:'old',firstChild:{style:{}},getAttribute(k){return this[k]??null;},setAttribute(k,v){this[k]=v;}};const buttons=[{},{}],c={activePlayback:{resumeAt:99},UX,document:{getElementById:id=>ids[id]},overlay:{querySelectorAll:()=>buttons}};c.UI=UI;c.I18n=I18n;vm.createContext(c);vm.runInContext(functionSource('resetPlayerTimeline','installPlayerControls'),c);c.resetPlayerTimeline('live');assert.equal(ids['player-elapsed'].textContent,'● TIESIOGIAI');assert.equal(ids['player-timeline'].hidden,true);assert.equal(ids['player-remaining'].textContent,'');assert.equal(ids['play-pause'].textContent,'Pauzė');assert.deepEqual(buttons.map(t=>t.disabled),[true,true]);
});