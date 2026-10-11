import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import UI from '../web/ui-performance.js';import UX from '../web/experience.js';
const source=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8');
import {player} from './support/player-fixture.mjs';
test('one shared native player snapshot per tick preserves health and highest selected quality',()=>{
 const p=player();p.c.updatePlayer();assert.deepEqual([p.counts.state,p.counts.time,p.counts.duration],[1,1,1]);assert.equal(p.counts.health,1);assert.equal(p.counts.fullStoreCopies,0);assert.equal(p.ids['player-quality'].textContent,'Kokybė: 1080p · 50 fps · 6.14 Mb/s');
});
test('hidden player controls do not repaint, while time, health and resume saving continue',()=>{
 const p=player(source,{hidden:true});p.c.lastSaved=0;for(let i=0;i<20;i++){p.advance();p.c.updatePlayer();}assert.equal(p.counts.writes,0);assert.equal(p.counts.health,20);assert.equal(p.counts.saves,1);assert.equal(p.c.lastMetrics.position,140);assert.equal(p.counts.state,20);
});
test('seeking or a hidden application never polls AVPlay; stopped playback does no DOM work',()=>{
 const p=player(source,{seekBusy:true,hidden:true});p.c.updatePlayer();assert.equal(p.counts.state,0);assert.equal(p.counts.writes,0);p.c.seekBusy=false;p.c.document.hidden=true;p.c.updatePlayer();assert.equal(p.counts.state,0);p.c.document.hidden=false;p.c.playing=false;p.c.updatePlayer();assert.equal(p.counts.writes,0);
});
test('paused controls are painted once; unchanged ticks cause zero DOM writes and retain focus availability',()=>{
 const p=player(source,{paused:true});p.c.updatePlayer();p.resetWrites();for(let i=0;i<10;i++)p.c.updatePlayer();assert.equal(p.counts.writes,0);assert.equal(p.ids['play-pause'].textContent,'Tęsti');assert.equal(p.ids['player-audio'].disabled,false);assert.equal(p.counts.state,11);
});
test('advancing playback changes only elapsed time, remaining time and compositor timeline progress',()=>{
 const p=player();p.c.updatePlayer();p.resetWrites();p.advance();p.c.updatePlayer();assert.equal(p.counts.writes,4);assert.equal(p.ids['player-elapsed'].textContent,'2:01');assert.match(p.ids['player-timeline'].firstChild.style.transform,/^scaleX\(0\.0/);assert.equal(p.ids['player-timeline'].firstChild.style.width,undefined);
});
function clock(){let now=1000,next=0;const tasks=new Map();return{tasks,performance:{now:()=>now},setTimeout(fn,delay){tasks.set(++next,{fn,delay});return next;},clearTimeout:id=>tasks.delete(id),run(delay){for(const[id,t]of [...tasks])if(t.delay===delay){tasks.delete(id);t.fn();}},advance(ms){now+=ms;}};}
function classes(){const values=new Set();return{values,classList:{add:v=>values.add(v),remove:v=>values.delete(v)}};}
test('small entrance cancels immediately on rapid navigation; reduced motion never schedules animation',()=>{
 const env=clock(),a=classes(),b=classes();env.matchMedia=()=>({matches:false});const motion=UI.motion(env);motion.enter(a);assert.equal(a.values.has('soft-enter'),true);motion.enter(b);assert.equal(a.values.size,0);assert.equal(b.values.size,0);assert.equal(env.tasks.size,0);env.advance(300);motion.enter(b);env.run(180);assert.equal(b.values.size,0);env.matchMedia=()=>({matches:true});motion.enter(a);assert.equal(env.tasks.size,0);assert.equal(a.values.size,0);const userReduced=UI.motion(env,()=>true);userReduced.enter(a);assert.equal(a.values.size,0);
});
function image(){return{style:{},src:'',remove(){this.removed=true;},removeAttribute(){this.src='';}};}
test('TV thumbnail loading waits for visibility, caps simultaneous decodes and stops stale navigation work',()=>{
 const env=clock(),document={contains:img=>!img.removed},observers=[];env.IntersectionObserver=class{constructor(cb){this.cb=cb;observers.push(this);}observe(){}unobserve(){}disconnect(){this.disconnected=true;}};const loader=UI.images(env,document),pics=Array.from({length:20},image),fallbacks=pics.map(image);pics.forEach((img,i)=>loader.add(img,'photo-'+i,fallbacks[i],false));assert.ok(pics.every(p=>!p.src));observers[0].cb(pics.map(target=>({target,isIntersecting:true})));assert.equal(pics.filter(p=>p.src).length,2);assert.equal(fallbacks[0].style.visibility,undefined);const oldDone=pics[0].onload;loader.defer();pics[0].onload();assert.equal(fallbacks[0].style.visibility,'hidden');assert.equal(pics.filter(p=>p.src).length,2);env.run(120);assert.equal(pics.filter(p=>p.src).length,3);loader.reset();oldDone();assert.equal(observers[0].disconnected,true);assert.equal(pics.slice(3).filter(p=>p.src).length,0);
});
test('poster fallback remains visible until image success, and non-Observer TVs load only after DOM attachment',()=>{
 const env=clock(),pic=image(),fallback=image();let attached=false;const loader=UI.images(env,{contains:()=>attached});loader.add(pic,'hero',fallback,true);assert.equal(pic.src,'');attached=true;env.run(0);assert.equal(pic.src,'hero');assert.equal(fallback.style.visibility,undefined);pic.onerror();assert.equal(pic.removed,true);assert.equal(fallback.style.visibility,undefined);
});
test('spatial focus reuses geometry until scroll, resize, disabled state or layout changes',()=>{
 const handlers={},env={addEventListener:(name,fn)=>handlers[name]=fn};let invalidate,reads=0;env.MutationObserver=class{constructor(fn){invalidate=fn;}observe(){}};const list=Array.from({length:24},(_,i)=>({disabled:false,offsetParent:{},getBoundingClientRect(){reads++;return{left:i%4*100,top:Math.floor(i/4)*100,width:90,height:90};}}));const root={querySelectorAll:()=>list,addEventListener:(n,f)=>handlers[n]=f},move=UI.spatial(root,env);assert.equal(move(list[0],39),list[1]);assert.equal(reads,24);assert.equal(move(list[1],40),list[5]);assert.equal(reads,24);handlers.scroll();move(list[5],40);assert.equal(reads,48);list[9].disabled=true;invalidate();assert.notEqual(move(list[5],40),list[9]);assert.equal(reads,71);handlers.resize();move(list[5],39);assert.equal(reads,94);
});
test('reduced-motion and auto-quality reads preserve preferences without copying viewing history',()=>{
 const disk=new Map(),store=UX.store({getItem:k=>disk.get(k),setItem:(k,v)=>disk.set(k,v)});store.preference('reduceMotion',true);store.preference('autoQuality',false);assert.equal(store.getPreference('reduceMotion'),true);assert.equal(store.getPreference('autoQuality'),false);assert.equal(UX.store({getItem:k=>disk.get(k)}).getPreference('reduceMotion'),true);assert.equal(store.getPreference('__proto__'),undefined);
});
test('English player controls retain one native snapshot and zero unchanged repaint writes',()=>{
 const p=player(source,{paused:true,language:'en'});p.c.updatePlayer();
 assert.equal(p.ids['play-pause'].textContent,'Resume');assert.equal(p.ids['player-quality'].textContent,'Quality: 1080p · 50 fps · 6.14 Mb/s');
 assert.equal(p.ids['player-remaining'].textContent,'Remaining 1:17:20');
 p.resetWrites();for(let i=0;i<10;i++)p.c.updatePlayer();assert.equal(p.counts.writes,0);
 assert.deepEqual([p.counts.state,p.counts.time,p.counts.duration],[11,11,11]);
});