import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import Timeline from '../web/timeline.js';import UI from '../web/ui-performance.js';import UX from '../web/experience.js';
const vod={start:0,end:4759,live:false};
test('timeline accepts bounded known durations and clamps both ends',()=>{
 const c=Timeline.controller();for(const r of [null,{start:0,end:0},{start:-1,end:10},{start:0,end:Infinity},{start:0,end:604801}])assert.equal(c.begin(r,3),false);
 assert.equal(c.begin(vod,1),true);assert.equal(c.move(-1,0),0);c.fraction(2);assert.equal(c.commit(vod),4759);assert.equal(c.active(),false);
});
test('holding accelerates; releasing or reversing starts a precise five-second step',()=>{
 const c=Timeline.controller();c.begin(vod,100);let previous=100;
 for(let at=0;at<=3500;at+=100){const next=c.move(1,at),step=next-previous;assert.equal(step,at>=3500?60:at>=1800?30:at>=600?10:5);previous=next;}
 assert.equal(c.move(-1,3600),previous-5);const last=c.snapshot().position;assert.equal(c.move(1,4000),last+5);
});
test('a selected time survives player ticks, commits once, and clamps to the latest live window',()=>{
 const c=Timeline.controller();c.begin({start:100,end:400,live:true},130);c.move(-1,0);c.sync(150);assert.equal(c.snapshot().position,125);
 assert.equal(c.commit({start:160,end:430,live:true}),160);assert.equal(c.commit(vod),null);
 c.begin(vod,100);c.sync(101);assert.equal(c.snapshot().position,101);assert.equal(c.commit(vod),null);
});
test('cancelled selection and a vanished DVR window never yield a seek target',()=>{
 const c=Timeline.controller();c.begin(vod,100);c.move(1,0);c.cancel();assert.equal(c.commit(vod),null);c.begin(vod,100);c.move(1,0);assert.equal(c.commit(null),null);
});
const source=(await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8')).replace(/\r/g,'');
function piece(name,next){const start=source.indexOf('  function '+name+'('),end=source.indexOf('  function '+next+'(',start+1);assert.ok(start>=0&&end>start);return source.slice(start,end);}
function fixture({paused=false}={}){
 const count={seek:0,metrics:0,paint:0,update:0,play:0,pause:0},frames=new Map();let at=1000,done;
 function element(){const attributes={},classes=new Set();return{hidden:false,textContent:'',firstChild:{style:{}},style:{},classList:{remove:k=>classes.delete(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},setAttribute(k,v){attributes[k]=v;},getAttribute:k=>attributes[k],querySelector:()=>({style:{}}),focus(){c.document.activeElement=this;},blur(){c.document.activeElement=null;}};}
 const line=element(),ids={'player-timeline':line,'player-elapsed':element(),'player-remaining':element(),'play-pause':element(),'player-state':element()};
 const c={window:{ApexTimeline:Timeline,cancelAnimationFrame:id=>frames.delete(id),requestAnimationFrame:fn=>{frames.set(1,fn);return 1;}},Date:{now:()=>at},UI:{...UI,style(...args){count.paint++;return UI.style(...args);}},UX,playing:true,seekBusy:false,viewBusy:false,activeEngine:'AVPlay',playbackKind:'vod',lastMetrics:{position:120,duration:4760,paused},document:{getElementById:id=>ids[id],activeElement:line},overlay:{hidden:false,contains:()=>true},setupText:(lt,en)=>en,metrics(){count.metrics++;return{position:120,duration:4760,paused};},updatePlayer(){count.update++;},savePlayback(){},nativePlayer:{seekTo(ms,ok){count.seek++;count.target=ms;done=ok;},play(){count.play++;},pause(){count.pause++;}},seekSerial:0,epoch:1,pendingStop:false,clearTimeout(){},hideTimer:0,overlayDismissed:false};
 c.requestAnimationFrame=c.window.requestAnimationFrame;vm.createContext(c);const helperStart=source.indexOf('  var scrubber=window.ApexTimeline.controller()'),helperEnd=source.indexOf('  function applyPreferences()',helperStart);vm.runInContext(source.slice(helperStart,helperEnd)+piece('nativeSeek','updatePlayer')+piece('hideOverlay','toggle'),c);
 return{c,count,ids,advance(ms=100){at+=ms;},flush(){for(const [id,fn]of frames){frames.delete(id);fn();}},done(){done();}};
}
test('many draft keys perform no native seeks or metrics polls, paint in one frame, then OK seeks exactly once',()=>{
 const p=fixture();p.c.startScrub();for(let i=0;i<40;i++){p.c.timelineKey(39);p.advance();}assert.equal(p.count.seek,0);assert.equal(p.count.metrics,0);assert.equal(p.count.paint,0);p.flush();assert.equal(p.count.paint,2);
 const selected=p.c.scrubber.snapshot().position;p.c.timelineKey(13);p.c.timelineKey(13);assert.equal(p.count.seek,1);assert.equal(p.count.target,Math.round(selected*1000));assert.equal(p.c.seekBusy,true);p.done();assert.equal(p.c.seekBusy,false);p.c.timelineKey(13);assert.equal(p.count.seek,1);
});
test('Back hides a changed timeline without seeking or changing playback pause state',()=>{
 const p=fixture({paused:true});p.c.startScrub();p.c.timelineKey(39);p.flush();p.c.hideOverlay();assert.equal(p.count.seek,0);assert.equal(p.c.scrubber.active(),false);assert.equal(p.c.overlay.hidden,true);assert.equal(p.count.play+p.count.pause,0);
});
test('confirmed timeline seek preserves pause and Down returns to primary actions',()=>{
 const p=fixture({paused:true});p.c.startScrub();p.c.timelineKey(37);p.c.timelineKey(13);p.done();assert.equal(p.count.play+p.count.pause,0);p.c.startScrub();p.c.timelineKey(39);p.c.timelineKey(40);assert.equal(p.c.scrubber.active(),false);assert.equal(p.c.document.activeElement,p.ids['play-pause']);assert.equal(p.count.seek,1);
});
