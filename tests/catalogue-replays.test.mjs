import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import Discovery from '../web/discovery.js';
import UX from '../web/experience.js';
const now=Date.UTC(2026,10,2,10),day=86400000;
const meeting=(id,start,end,title='GP')=>({id:String(id),kind:'page',title,meetingStart:start,meetingEnd:end,series:'Formula 1'});
const race=(id,start,end,extra={})=>({id:String(id),kind:'video',title:'2026 Mexico City Grand Prix',subtitle:'Race',series:'Formula 1',start,end,live:false,...extra});
const raw=items=>({items:items.map(i=>({metadata:{contentId:i.id,title:i.title,shortDescription:i.subtitle,contentType:'VIDEO',contentSubtype:i.live?'LIVE':'VOD',locked:i.locked,emfAttributes:{Series:i.series,sessionStartDate:i.start,sessionEndDate:i.end,MeetingKey:i.meetingKey}}}))});
function harness({failRecent=false}={}){
 let clock=now;const mexico=meeting(12,now-3*day,now-day,'Mexico'),brazil=meeting(13,now+4*day,now+6*day,'Brazil'),calls=[];
 const mexicoItems=[race(42,now-day-7200000,now-day),race(43,now-day-7200000,now-day,{title:'Race Highlights'}),race(44,now-day-7200000,now-day,{title:'Race in 30'})];
 const client={page:async()=>[{id:'12343',title:'2026 Season',kind:'page'}],context:async()=>({login:'R',tail:'PRO/2'}),headers:()=>({}),live:async()=>[],json:async url=>{calls.push(url);if(url.includes('/12343/'))return{items:[mexico,brazil].map(i=>({metadata:{title:i.title,emfAttributes:{Series:i.series,Meeting_Start_Date:i.meetingStart,Meeting_End_Date:i.meetingEnd}},actions:[{key:'onClick',uri:'/PAGE/'+i.id+'/'}]}))};if(url.includes('/13/'))return raw([race(45,now+5*day,now+5*day+7200000)]);if(url.includes('/12/')){if(failRecent)throw Error('HTTP 503');return raw(mexicoItems);}throw Error('Unexpected route');}};
 return{api:Discovery.create(client,()=>clock),calls,advance:n=>clock+=n};
}
test('completed Mexico race stays available after weekend advances to Brazil, with bounded cached service requests',async()=>{
 const h=harness(),r=await h.api.weekend();assert.equal(r.meeting.title,'Brazil');assert.equal(r.latestRace.id,'42');assert.equal(r.latestRace.live,false);assert.equal(r.latestRace.playable,true);assert.ok(r.sessions.every(i=>i.state==='upcoming'));assert.equal(h.calls.length,3);await h.api.weekend();assert.equal(h.calls.length,3);h.advance(300001);await h.api.weekend();assert.equal(h.calls.length,6);
});
test('failure retrieving previous GP does not hide upcoming calendar or manufacture a replay',async()=>{
 const r=await harness({failRecent:true}).api.weekend();assert.equal(r.meeting.title,'Brazil');assert.equal(r.latestRace,null);assert.equal(r.sessions.length,1);
});
test('latest race selection rejects future, active, locked, live, short-form, other series and historical sessions',()=>{
 const m=meeting(12,now-3*day,now+day),good=race(42,now-day,now-1000);
 const items=[good,race(43,now-100,now+100),race(44,now+100,now+200),race(45,now-50,now-10,{locked:true}),race(46,now-50,now-10,{live:true}),race(47,now-50,now-10,{title:'Race in 30'}),race(48,now-50,now-10,{title:'Race Highlights'}),race(49,now-50,now-10,{title:'Post-Race Show'}),race(50,now-50,now-10,{series:'Formula 2'}),race(51,now-400*day,now-399*day),race(52,now-50,now-10,{title:'2026 Mexico City Grand Prix - Qualifying',subtitle:'Qualifying'})];
 assert.equal(Discovery.latestRace(items,now,[],m).id,'42');assert.equal(Discovery.latestRace([good],now,[good],m),null);assert.equal(Discovery.latestRace([],now,[],m),null);
});
test('Grand Prix titles and official Race metadata survive the race filter without including qualifying, highlights or GP folders',()=>{
 const items=[race(42,now-day,now-1),race(43,now-day,now-1,{title:'Full session'}),race(44,now-day,now-1,{title:'2026 Mexico City GP - Qualifying',subtitle:'Qualifying'}),race(45,now-day,now-1,{title:'Race Highlights'}),race(46,now-day,now-1,{title:'Race in 30'}),{id:'12',kind:'page',title:'2026 Mexico City Grand Prix'}];
 assert.deepEqual(UX.select(items,'','race','default').map(i=>i.id),['42','43']);assert.equal(UX.select(items,'mexico','race','default')[0].id,'42');
});
test('manual refresh invalidates only its own cached catalogue',()=>{
 const c=UX.cache(()=>100);c.put('/api/catalog?page=12',[{id:'old'}]);c.put('/api/catalog?page=13',[{id:'other'}]);c.remove('/api/catalog?page=12');assert.equal(c.get('/api/catalog?page=12'),null);assert.equal(c.get('/api/catalog?page=13').items[0].id,'other');
});
test('latest-race UI keeps focused cards and unchanged refresh nodes, and opens the exact replay',async()=>{
 const source=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8'),a=source.indexOf('  function renderLatestRace('),b=source.indexOf('  function loadWeekend(',a);
 let nodes=0;function element(tag,text='',cls=''){nodes++;return{tag,text,cls,children:[],appendChild(child){this.children.push(child);child.parent=this;},insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child);child.parent=this;},contains(v){return this===v||this.children.some(c=>c.contains(v));},remove(){this.parent.children=this.parent.children.filter(c=>c!==this);},querySelector(sel){return this.children.find(c=>c.cls.split(' ').includes(sel.slice(1)))||null;}};}
 const main=element('main'),discover=element('section','','discovery-section');main.appendChild(discover);const c={I18n:{language:()=> 'en'},document:{activeElement:null},node:element,setupText:(lt,en)=>en,itemCard(item){const card=element('button');card.item=item;return card;}};vm.createContext(c);vm.runInContext(source.slice(a,b),c);
 const data={latestRace:race(42,now-day,now-1)};c.renderLatestRace(main,data);const section=main.children[0],count=nodes;assert.equal(section.children[0].text,'Latest race');assert.equal(section.children[1].children[0].item.id,'42');for(let i=0;i<20;i++)c.renderLatestRace(main,JSON.parse(JSON.stringify(data)));assert.equal(nodes,count);c.document.activeElement=section.children[1].children[0];c.renderLatestRace(main,{latestRace:race(55,now-day,now-1)});assert.equal(main.children[0],section);c.document.activeElement=null;c.renderLatestRace(main,{latestRace:race(55,now-day,now-1)});assert.equal(main.children[0].children[1].children[0].item.id,'55');c.renderLatestRace(main,{latestRace:null});assert.equal(main.children.length,1);
});
