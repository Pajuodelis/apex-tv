import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import Views from '../web/view-options.js';
import Drivers from '../web/favorite-driver.js';
import {player} from './support/player-fixture.mjs';
const source=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8');
const channels=[{id:'1033',title:'F1 LIVE',type:'additional',default:true},{id:'1025',title:'INTERNATIONAL',type:'additional'},{id:'1003',title:'TRACKER',type:'additional'},{id:'1004',title:'DATA',type:'additional'},{id:'1016',title:'NOR',type:'obc'}];
function piece(name,next){const at=source.indexOf('  function '+name+'('),end=source.indexOf('  function '+next+'(',at+1);assert.ok(at>=0&&end>at);return source.slice(at,end);}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function choicesContext({cached=true,failed=false}={}){
  let dialog,changed,requests=0;const c={I18n:{setText(element,value){element.textContent=value;}},Views,Drivers,epoch:4,current:{tab:'home'},playing:true,viewBusy:false,seekBusy:false,activePlayback:{item:{id:'42',title:'Race',live:true},channelId:'1025',channelTitle:'International',audioTrackId:'set:en',audioTracks:[{id:'set:en',label:'Anglų',language:'eng'},{id:'set:fr',label:'Prancūzų',language:'fra'}]},catalogueCache:{get:()=>cached?{items:channels}:null,put(){}},driverStore:{observe(){}},document:{getElementById:()=>({})},updateViewControls(){},showOverlay(){},chooseFavoriteDriver(){},request(route){requests++;assert.equal(route,'/api/channels?id=42');return failed?Promise.reject(Error('network')):Promise.resolve({channels});},dialog(...args){dialog=args;},changeView(options){changed=options;}};
  vm.createContext(c);vm.runInContext(piece('selectCamera','selectAudio')+piece('selectAudio','selectQuality'),c);return{c,get dialog(){return dialog;},get changed(){return changed;},get requests(){return requests;}};
}
test('commentary streams stay out of POV choices without inventing or changing provider IDs',()=>{
  assert.deepEqual(Views.commentaryChannels({channels}).map(c=>[c.id,c.title]),[['1033','F1 Live'],['1025','International']]);
  assert.deepEqual(Views.cameraChannels({channels}).map(c=>c.id),['1003','1004','1016']);
  assert.equal(Views.isCommentary({title:'F1 LIVE',type:'obc'}),false);
  assert.equal(Views.isCommentary({title:'F1 LIVE timing',type:'additional'}),false);
  assert.equal(Views.commentaryChannels({channels:[{id:'../1033',title:'F1 LIVE'}]}).length,0);
  assert.equal(channels[0].title,'F1 LIVE');
});
test('audio dialog includes F1 Live and International, switches the authorized stream and keeps language choices',async()=>{
  const p=choicesContext();p.c.selectAudio();await flush();assert.equal(p.requests,0);
  const labels=p.dialog[2].map(c=>c.label);assert.ok(labels.includes('F1 Live'));assert.ok(labels.includes('✓ Anglų · International'));assert.equal(labels.includes('✓ Anglų'),false);assert.ok(labels.includes('Prancūzų'));assert.equal(labels.includes('TRACKER'),false);
  p.dialog[2].find(c=>c.label==='F1 Live').run();assert.deepEqual(JSON.parse(JSON.stringify(p.changed)),{channelId:'1033',channelTitle:'F1 Live',audioLanguage:'eng',commentary:true});
});
test('camera dialog keeps actual driver POV, tracker and data, with commentary only behind return to main picture',async()=>{
  const p=choicesContext();p.c.selectCamera();await flush();const labels=p.dialog[2].map(c=>c.label);
  assert.equal(labels.some(label=>/F1 Live|International/i.test(label)),false);assert.ok(labels.includes('POV · NOR'));assert.ok(labels.includes('TRACKER'));assert.ok(labels.includes('DATA'));assert.ok(labels.includes('✓ Pagrindinė transliacija'));
});
test('an unavailable commentary catalog leaves known audio languages usable',async()=>{
  const p=choicesContext({cached:false,failed:true});p.c.selectAudio();await flush();assert.equal(p.c.viewBusy,false);assert.ok(p.dialog[2].some(c=>c.label==='Prancūzų'));assert.ok(p.dialog[2].some(c=>c.label==='Bandyti dar kartą'));
  p.dialog[2].find(c=>c.label==='Prancūzų').run();assert.equal(p.changed.audioTrackId,'set:fr');
});
test('Back closes a dialog, hides controls without stopping playback, then exits on another press',()=>{
  let stopped=0,closed=0,blurred=0,timerCleared=0;const focused={blur(){blurred++;}};
  const c={playing:true,modal:{},overlay:{hidden:false,contains:element=>element===focused},document:{activeElement:focused},hideTimer:7,overlayDismissed:false,cancelRecovery(){},closeModal(){closed++;c.modal=null;},stopPlayback(){stopped++;},clearTimeout(timer){assert.equal(timer,7);timerCleared++;}};
  vm.createContext(c);vm.runInContext('var phoneLoginCleanup=null;'+piece('cancelPhoneScreen','render')+piece('goBack','streamAudioChoices')+piece('hideOverlay','toggle'),c);
  c.goBack();assert.equal(closed,1);assert.equal(stopped,0);assert.equal(c.overlay.hidden,false);
  c.goBack();assert.equal(c.overlay.hidden,true);assert.equal(stopped,0);assert.equal(blurred,1);assert.equal(timerCleared,1);assert.equal(c.overlayDismissed,true);
  c.goBack();assert.equal(stopped,1);
});
test('controls dismissed with Back remain hidden while paused; time and health checks continue',()=>{
  const p=player(source,{hidden:true,paused:true});p.c.overlayDismissed=true;
  for(let i=0;i<5;i++)p.c.updatePlayer();assert.equal(p.c.overlay.hidden,true);assert.equal(p.counts.health,5);assert.equal(p.counts.writes,0);
});
const baseChoices=choicesContext;
test('F1 Live is the default even when International is marked as the provider default',()=>{
  const supplied=[{id:'77',title:'INTERNATIONAL',default:true},{id:'88',title:'F1 LIVE',default:false},{id:'99',title:'NOR',type:'obc'}];
  assert.equal(Views.defaultCommentary({channels:supplied}).id,'88');assert.equal(Views.defaultCommentary({channels:[supplied[0]]}),null);
  assert.equal(Views.defaultCommentary({channels:[{id:'../88',title:'F1 LIVE'},{id:'11',title:'F1 LIVE',type:'obc'}]}),null);
});
test('explicit manual International and POV selections are preserved without a new channel lookup',async()=>{
  const c={Views,catalogueCache:{get(){throw Error('Unnecessary lookup');}},request(){throw Error('Unnecessary request');}};vm.createContext(c);vm.runInContext(piece('resolveStartView','startContent'),c);
  for(const options of [{channelId:'1025',channelTitle:'International',audioLanguage:'eng'},{channelId:'1016',channelTitle:'POV · NOR'}])assert.equal(await c.resolveStartView({id:'42'},options),options);
});
test('F1 Live has one selected audio choice; English International remains a manual action',async()=>{
  const p=choicesContext();p.c.activePlayback.channelId='1033';p.c.activePlayback.channelTitle='F1 Live';p.c.selectAudio();await flush();const labels=p.dialog[2].map(c=>c.label);
  assert.ok(labels.includes('✓ F1 Live'));assert.ok(labels.includes('Anglų · International'));assert.equal(labels.filter(x=>x.startsWith('✓ ')).length,1);assert.ok(labels.includes('Prancūzų'),'other service languages stay selectable while F1 Live is active');assert.equal(labels.includes('Anglų'),false);
  p.dialog[2].find(c=>c.label==='Anglų · International').run();assert.deepEqual(JSON.parse(JSON.stringify(p.changed)),{channelId:'1025',channelTitle:'International',audioLanguage:'eng',commentary:true});
});
function startup(){
  let resolve,reject,starts=0;const catalogue=new Promise((yes,no)=>{resolve=yes;reject=no;}),requests=[],main={appendChild(){}},status={setAttribute(){},remove(){}},c={Views,UX:{item:raw=>raw,resume:()=>0},Quality:{mode:value=>value},preferredQuality:'best',preferredAudioLanguage:'spa',account:{signedIn:true},current:{tab:'home'},liveTimer:0,pendingRequest:0,playbackHealth:{reset(){}},root:{querySelector:selector=>selector==='main'?main:null},document:{hidden:false,contains:element=>element===main},catalogueCache:{get:()=>null,put(){}},localStore:{get:()=>null},cancelRecovery(){},rememberView(){},clearInterval(){},node:()=>status,request(route,method,body){requests.push({route,body});return route.startsWith('/api/channels')?catalogue:Promise.resolve({channelId:body.channelId,audioTrackId:'set:en'});},prepareViewPlayback(item,stream,compatibility,resume,options){return{item,stream,...options};},viewTitle:state=>state.item.title,begin(){starts++;},updateViewControls(){},tryRecovery(){throw Error('Unexpected playback failure');},error(){throw Error('Unexpected UI failure');}};
  vm.createContext(c);vm.runInContext(piece('resolveStartView','startContent')+piece('startContent','firstMenuContent'),c);return{c,requests,resolve,reject,get starts(){return starts;}};
}
test('starting a new main session requests service-supplied F1 Live and English within that feed',async()=>{
  const p=startup();p.c.startContent({id:'42',title:'Race',live:true});p.resolve({channels:[{id:'77',title:'INTERNATIONAL',default:true},{id:'88',title:'F1 LIVE'}]});await flush();
  const play=p.requests.find(r=>r.route==='/api/play');assert.equal(play.body.channelId,'88');assert.equal(play.body.audioLanguage,'eng');assert.equal(p.c.activePlayback.channelTitle,'F1 Live');assert.equal(p.starts,1);
});
test('navigating away or suspending the app during commentary lookup does not request playback',async()=>{
  for(const canceled of ['navigation','suspended']){const p=startup();p.c.startContent({id:'42',title:'Race',live:true});if(canceled==='navigation')p.c.pendingRequest++;else p.c.document.hidden=true;p.resolve({channels});await flush();assert.equal(p.requests.filter(r=>r.route==='/api/play').length,0);assert.equal(p.starts,0);}
});
test('a missing commentary catalogue preserves normal provider playback and does not invent a feed',async()=>{
  const p=startup();p.c.startContent({id:'42',title:'Replay',live:false});p.reject(Error('catalogue unavailable'));await flush();assert.equal(p.requests.find(r=>r.route==='/api/play').body.channelId,'');assert.equal(p.starts,1);
});
test('the F1 Live player label identifies commentary rather than showing a second English selection',()=>{
  const p=player(source);p.c.activePlayback.channelTitle='F1 Live';p.c.updateViewControls();assert.equal(p.ids['player-audio'].textContent,'Garsas: F1 Live');
});