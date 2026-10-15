import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import UI from '../web/ui-performance.js';
const source=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8');
function piece(name,next){const start=source.indexOf('  function '+name+'('),end=source.indexOf('  function '+next+'(',start+1);assert(start>=0&&end>start);return source.slice(start,end);}
function frames(){const callbacks=new Map();let id=0;return{callbacks,requestAnimationFrame(fn){callbacks.set(++id,fn);return id;},cancelAnimationFrame(n){callbacks.delete(n);},flush(){const batch=[...callbacks];callbacks.clear();for(const [,fn]of batch)fn();}};}
test('held remote events coalesce to one focus change per frame and flush before activation',()=>{
 const env=frames(),seen=[],queue=UI.keys(env,key=>seen.push(key));for(let i=0;i<80;i++)queue.push(39);
 assert.equal(env.callbacks.size,1);assert.deepEqual(seen,[]);env.flush();assert.deepEqual(seen,[39]);
 queue.push(38);queue.push(40);queue.flush();assert.deepEqual(seen,[39,40]);env.flush();assert.deepEqual(seen,[39,40]);
 queue.push(37);queue.cancel();env.flush();assert.deepEqual(seen,[39,40]);
});
test('remote queue works without animation-frame support',()=>{const seen=[],queue=UI.keys({},key=>seen.push(key));queue.push(39);queue.flush();queue.cancel();assert.deepEqual(seen,[39]);});
test('shell scrolling reuses cached focus geometry; nested scroll and resizing rebuild it',()=>{
 const handlers={},shell={},nested={};let reads=0,scroll=0;const list=Array.from({length:12},(_,i)=>({disabled:false,offsetParent:{},getBoundingClientRect(){reads++;return{left:i%4*100,top:Math.floor(i/4)*100-scroll,width:90,height:90};}}));
 const root={querySelector:()=>shell,querySelectorAll:()=>list,addEventListener:(name,fn)=>handlers[name]=fn},env={addEventListener:(name,fn)=>handlers[name]=fn},move=UI.spatial(root,env);
 assert.equal(move(list[0],40),list[4]);assert.equal(reads,12);scroll=100;handlers.scroll({target:shell});assert.equal(move(list[4],40),list[8]);assert.equal(reads,12);
 handlers.scroll({target:nested});move(list[4],39);assert.equal(reads,24);handlers.resize();move(list[4],39);assert.equal(reads,36);
});
test('actual grid columns and scrollable rows are cached and refreshed after resize',()=>{
 let reads=0,resize,style={display:'grid',gridTemplateColumns:'200px 200px 200px 200px'},env={addEventListener:(name,fn)=>resize=fn,getComputedStyle(){reads++;return style;}},layout=UI.grids(env),parent={children:new Array(6)};
 assert.deepEqual(layout(parent),{count:6,row:false,columns:4});layout(parent);assert.equal(reads,1);
 style={display:'flex',flexDirection:'row',gridTemplateColumns:'none'};resize();assert.deepEqual(layout(parent),{count:6,row:true,columns:6});assert.equal(reads,2);
 parent.children.push({});assert.equal(layout(parent).columns,7);assert.equal(reads,3);
});
function menu(display){
 const document={activeElement:null},selected={focus(){document.activeElement=this;}},nav={contains:()=>false,querySelector:()=>selected},parent={children:[],classList:{contains:name=>name==='tiles'||name==='home-tiles'},closest:()=>null};
 const cards=Array.from({length:6},()=>({parentNode:parent,classList:{contains:name=>name==='tile'},getAttribute:()=>'',focus(){document.activeElement=this;}}));parent.children=cards;
 const c={Date,document,current:{},motion:{cancel(){}},artworkLoader:{defer(){}},root:{contains:()=>true,querySelector:name=>name==='.tv-nav'?nav:null},gridLayout:UI.grids({addEventListener(){},getComputedStyle:()=>({display,flexDirection:'row',gridTemplateColumns:'200px 200px 200px 200px'})}),focusSpatial:()=>null};vm.createContext(c);vm.runInContext(piece('moveMenuFocus','navigationNow'),c);return{c,cards,document};
}
test('home grids reach the second visible row and horizontal shelves continue past four cards',()=>{
 const grid=menu('grid');grid.document.activeElement=grid.cards[0];grid.c.moveMenuFocus(40);assert.equal(grid.document.activeElement,grid.cards[4]);grid.c.moveMenuFocus(39);assert.equal(grid.document.activeElement,grid.cards[5]);
 const row=menu('flex');row.document.activeElement=row.cards[3];row.c.moveMenuFocus(39);assert.equal(row.document.activeElement,row.cards[4]);
});
test('settings tabs move without changing category until OK or Down; Down enters the chosen pane',()=>{
 const document={activeElement:null},selected={focus(){document.activeElement=this;}},control={focus(){document.activeElement=this;}},nav={contains:()=>false,querySelector:()=>selected},parent={children:[],classList:{contains:name=>name==='settings-tabs'}};
 let category=0;const tabs=[0,1,2].map(index=>({parentNode:parent,getAttribute:()=>category===index?'true':'false',click(){category=index;},focus(){document.activeElement=this;}}));parent.children=tabs;
 const c={Date,document,current:{},motion:{cancel(){}},artworkLoader:{defer(){}},root:{contains:()=>true,querySelector:name=>name==='.tv-nav'?nav:control}};vm.createContext(c);vm.runInContext(piece('moveMenuFocus','navigationNow'),c);
 document.activeElement=tabs[0];c.moveMenuFocus(39);assert.equal(document.activeElement,tabs[1]);assert.equal(category,0);c.moveMenuFocus(40);assert.equal(category,1);assert.equal(document.activeElement,control);
 document.activeElement=tabs[0];c.moveMenuFocus(37);assert.equal(document.activeElement,selected);document.activeElement=tabs[2];c.moveMenuFocus(39);assert.equal(document.activeElement,tabs[2]);
});
function player(){
 const counts={show:0,toggle:0,seek:0,move:0,stop:0,play:0,pause:0},document={activeElement:null};let state='PLAYING';
 function button(){return{hidden:false,disabled:false,focus(){document.activeElement=this;},click(){counts.toggle++;}};}
 const pause=button(),camera=button(),hidden=button(),audio=button();hidden.hidden=true;
 const c={document,overlay:{hidden:true,contains:el=>[pause,camera,hidden,audio].includes(el),querySelectorAll:()=>[pause,camera,hidden,audio]},timelineKey:()=>false,showOverlay(){counts.show++;c.overlay.hidden=false;},focusScrub(){counts.move++;return true;},moveScrub(dir){counts.direction=dir;},toggle(){counts.toggle++;},seek(){counts.seek++;},stopPlayback(){counts.stop++;},seekBusy:false,activeEngine:'AVPlay',nativePlayer:{getState:()=>state,play(){state='PLAYING';counts.play++;},pause(){state='PAUSED';counts.pause++;}},clearTimeout(){},prepareTimer:0};document.getElementById=()=>pause;
 vm.createContext(c);vm.runInContext(piece('playerKey','applyPreferences'),c);return{c,counts,pause,camera,audio};
}
test('OK reveals controls before pausing; dedicated media Play/Pause stays immediate',()=>{
 const p=player();p.c.playerKey(13);assert.equal(p.counts.toggle,0);assert.equal(p.c.document.activeElement,p.pause);p.c.playerKey(13);assert.equal(p.counts.toggle,1);p.c.playerKey(10252);assert.equal(p.counts.toggle,2);
 p.c.playerKey(19);assert.equal(p.counts.pause,1);p.c.playerKey(415);assert.equal(p.counts.play,1);
});
test('hidden arrows enter a seek preview without native seeking; Down focuses Pause',()=>{
 const p=player();p.c.playerKey(39);assert.equal(p.counts.move,1);assert.equal(p.counts.direction,1);assert.equal(p.counts.seek,0);p.c.playerKey(40);assert.equal(p.c.document.activeElement,p.pause);
 p.c.playerKey(39);assert.equal(p.c.document.activeElement,p.camera);p.c.playerKey(39);assert.equal(p.c.document.activeElement,p.audio);
 p.c.playerKey(417);assert.equal(p.counts.seek,1);
});
test('idle controls hide even with button focus; paused video and unconfirmed drafts stay visible',()=>{
 let callback,hidden=0;const c={hideTimer:0,overlay:{hidden:false},overlayDismissed:false,motion:{enter(){}},playing:true,updatePlayer(){},clearTimeout(){},setTimeout(fn,ms){assert.equal(ms,6000);callback=fn;return 1;},hideOverlay(){hidden++;},modal:null,viewBusy:false,seekBusy:false,lastMetrics:{paused:false},scrubber:{snapshot:()=>null}};
 vm.createContext(c);vm.runInContext(piece('showOverlay','hideOverlay'),c);c.showOverlay();callback();assert.equal(hidden,1);
 c.lastMetrics.paused=true;c.showOverlay();callback();assert.equal(hidden,1);c.lastMetrics.paused=false;c.scrubber.snapshot=()=>({dirty:true});c.showOverlay();callback();assert.equal(hidden,1);
});
