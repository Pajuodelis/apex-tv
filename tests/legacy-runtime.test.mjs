import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../tv/legacy-polyfills.js',import.meta.url),'utf8');
function legacy(){const c=vm.createContext({setTimeout,clearTimeout});vm.runInContext(`delete String.prototype.replaceAll;delete String.prototype.matchAll;delete Object.fromEntries;delete Promise.prototype.finally;this.window=this;`,c);vm.runInContext(source,c);return c;}
test('legacy string helpers preserve replaceAll callbacks, substitutions, empty matches and regex guards',()=>{
 const c=legacy();assert.equal(vm.runInContext(`'aba'.replaceAll('a',function(match,offset){return offset;})`,c),'0b2');assert.equal(vm.runInContext(`'ab'.replaceAll('a','$&$&')`,c),'aab');assert.equal(vm.runInContext(`'a.b.'.replaceAll('.',':')`,c),'a:b:');assert.equal(vm.runInContext(`'ab'.replaceAll('','-')`,c),'-a-b-');assert.throws(()=>vm.runInContext(`'ab'.replaceAll(/a/,'x')`,c),/global/);
});
test('legacy matchAll advances over full Unicode characters without looping',()=>{
 const c=legacy();const indexes=vm.runInContext(`Array.from('😀'.matchAll(/(?:)/gu),function(m){return m.index;})`,c,{timeout:1000});assert.deepEqual(Array.from(indexes),[0,2]);
});
test('legacy fromEntries keeps __proto__ as data and finally accepts non-functions',async()=>{
 const c=legacy();assert.equal(vm.runInContext(`(function(){var o=Object.fromEntries([['__proto__',{injected:true}]]);return Object.getPrototypeOf(o)===Object.prototype&&Object.prototype.hasOwnProperty.call(o,'__proto__')&&!o.injected;})()`,c),true);assert.equal(await vm.runInContext(`Promise.resolve(42).finally(undefined)`,c),42);
});
test('guarded legacy runtime preserves native APIs when present',()=>{
 const c=vm.createContext({setTimeout,clearTimeout});vm.runInContext('this.window=this;this.before=[String.prototype.replaceAll,Object.fromEntries,Promise.prototype.finally];',c);vm.runInContext(source,c);assert.equal(vm.runInContext('before[0]===String.prototype.replaceAll&&before[1]===Object.fromEntries&&before[2]===Promise.prototype.finally',c),true);
});
test('relay eligibility includes capable older TVs without using main-window sockets',async()=>{
 const app=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8'),start=app.indexOf('  var legacyTizen ='),end=app.indexOf('  var browserPlayer',start);assert.ok(start>=0&&end>start);
 for(const [ua,bigint,expected] of [['Tizen 5.0',undefined,false],['Tizen 5.5',BigInt,true],['Tizen 6.0',BigInt,true],['Tizen 9.0',BigInt,true]]){const c=vm.createContext({navigator:{userAgent:ua},window:{ApexNativeRelay:{supported(){}}},BigInt:bigint});vm.runInContext(app.slice(start,end),c);assert.equal(c.localRelayEligible,expected,ua);}
});

test('installed shell passes its build timestamp to the updater rollback floor',async()=>{
 for(const name of ['boot.js','boot-standalone.js']){
  const nodes=new Map();function node(){return{hidden:false,focus(){}};}const c=vm.createContext({Promise,setTimeout(){},setInterval(){},localStorage:{getItem(){return null;}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement(){return node();},head:{appendChild(el){Promise.resolve().then(()=>el.onload());}},body:{classList:{contains(){return false;}}}},APEX_CONFIG:{server:'',onlineUpdates:false},APEX_BUNDLED:{revision:'bundled',version:'0.5.11',builtAt:200},ApexMenuCache:{localServer(){return '';},cache(){return Promise.resolve(null);}},ApexStandalone:{initialize(){return Promise.resolve();}},ApexTV:{start(){}}});c.window=c;
  vm.runInContext(await fs.readFile(new URL('../tv/'+name,import.meta.url),'utf8'),c);await new Promise(r=>setImmediate(r));assert.equal(c.APEX_CONTEXT.builtAt,200,name);assert.equal(nodes.get('boot').hidden,true,name);
 }
});


test('native playback profiles are conservative only for legacy relays',async()=>{
 const app=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8'),a=app.indexOf('  var legacyTizen ='),b=app.indexOf('  var browserPlayer',a);
 for(const ua of ['Tizen 5.5','Tizen 6.0','Tizen 9.0']){const c=vm.createContext({navigator:{userAgent:ua},window:{ApexNativeRelay:{supported(){}}},BigInt});vm.runInContext(app.slice(a,b),c);const input={videoQuality:'best'},legacy=ua==='Tizen 5.5';assert.equal(c.relayInput(input).videoQuality,legacy?'720p':'best');assert.equal(input.videoQuality,'best');assert.equal(c.nativeAdaptiveInfo({localTV:true}),legacy?'STARTBITRATE=LOWEST|FIXED_MAX_RESOLUTION=1280X720':'STARTBITRATE=HIGHEST|FIXED_MAX_RESOLUTION=1920X1080');assert.equal(c.nativeUsesEme({localTV:true}),ua!=='Tizen 9.0');assert.equal(c.nativeUsesEme({localTV:true,platform:'public-test'}),false);}
});

async function routeFixture({available=true,probe=null,media=null}={}){
 const app=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8'),a=app.indexOf('  function begin('),b=app.indexOf('\n\n    if (playing) stopPlayback();',a);
 assert.ok(a>=0&&b>a);const calls={media:0,starts:0,direct:0,stopped:0,errors:0};
 const relay={url:'local-test',video:{height:720},stop(){calls.stopped++;}};
 const c={ctx:{standalone:true},playing:false,playbackKind:'',epoch:0,liveTimer:0,localRelay:null,activePlayback:null,localRelayEligible:true,legacyTizen:true,legacyEngine(){return'avplay';},relayInput(s){return Object.assign({},s,{videoQuality:'720p'});},root:{hidden:false},document:{body:{classList:{add(){}}},getElementById(){return{};}},I18n:{setText(){}},resetPlayerTimeline(){},clearInterval(){},artworkLoader:{reset(){}},motion:{cancel(){}},showOverlay(){},diagnostic(){},playbackError(){calls.errors++;},stopPlayback(){c.playing=false;c.epoch++;},Object};
 c.window={ApexNativeRelay:{supported(){return probe||Promise.resolve(available);}},ApexTVMedia:{start(){calls.media++;return media||Promise.resolve(relay);}},ApexStandalone:{client:{}}};c.nativePlayer={};
 vm.createContext(c);vm.runInContext(app.slice(a,b)+'\n if(stream.localTV)calls.starts++;else calls.direct++;\n}',Object.assign(c,{calls}));
 return{c,calls,relay,start(){c.begin({manifestXML:'fixture',videoQuality:'best'},'fixture','vod');}};
}

test('worker capability failure chooses the direct fallback once without a media relay',async()=>{
 const f=await routeFixture({available:false});f.start();await new Promise(r=>setImmediate(r));assert.equal(f.calls.media,0);assert.equal(f.calls.direct,1);assert.equal(f.calls.errors,0);
});
test('successful worker capability opens the media relay and continues to native playback',async()=>{
 const f=await routeFixture();f.start();await new Promise(r=>setImmediate(r));assert.equal(f.calls.media,1);assert.equal(f.calls.starts,1);assert.equal(f.calls.direct,0);
});
test('canceling during a worker probe cannot start media later',async()=>{
 let resolve;const f=await routeFixture({probe:new Promise(r=>{resolve=r;})});f.start();f.c.epoch++;resolve(true);await new Promise(r=>setImmediate(r));assert.equal(f.calls.media,0);assert.equal(f.calls.starts,0);
});
test('a media relay finishing after cancellation is stopped',async()=>{
 let resolve;const f=await routeFixture({media:new Promise(r=>{resolve=r;})});f.start();await new Promise(r=>setImmediate(r));f.c.epoch++;resolve(f.relay);await new Promise(r=>setImmediate(r));assert.equal(f.calls.stopped,1);assert.equal(f.calls.starts,0);
});

test('an explicit legacy browser choice does not enter the worker-relay path',async()=>{const f=await routeFixture();f.c.legacyEngine=function(){return 'browser';};f.start();await new Promise(r=>setImmediate(r));assert.equal(f.calls.media,0);assert.equal(f.calls.direct,1);});
