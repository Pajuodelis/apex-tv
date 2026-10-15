import test from 'node:test';
import assert from 'node:assert/strict';
import Discovery from '../web/discovery.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('hero schedule shows live first then future sessions without replay, expired live or duplicate entries',()=>{
  const now=Date.UTC(2026,9,15,12),future=n=>now+n*3600000;
  const live={id:'1',title:'Race',live:true,start:now-1000,end:future(1)};
  const data={live:[live],sessions:[live,{id:'2',title:'Practice 1',start:future(2)},{id:'3',title:'Qualifying',start:future(4)},{id:'4',title:'Replay',start:now-1},{id:'5',title:'Expired',live:true,end:now-1},{id:'6',title:'F1 Kids',start:future(1)},{id:'7',title:'F2 Race',series:'Formula 2',start:future(1)}]};
  assert.deepEqual(Discovery.upcoming(data,now).map(i=>i.id),['1','2','3']);
  assert.deepEqual(Discovery.upcoming(null,now),[]);
});

test('hero schedule bounds the list and sorts ISO dates by start time',()=>{
  const now=Date.UTC(2026,9,15,12),sessions=Array.from({length:9},(_,i)=>({id:String(i),title:'Session',start:new Date(now+(9-i)*3600000).toISOString()}));
  assert.deepEqual(Discovery.upcoming({sessions},now).map(i=>i.id),['8','7','6','5']);
});

test('unchanged schedule refreshes reuse nodes; new F1 metadata updates after focus leaves',async()=>{
 const source=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8'),start=source.indexOf('  function renderHeroSchedule('),end=source.indexOf('  function renderWeekendPanel(',start);let nodes=0;
 function element(tag,text='',cls=''){nodes++;return{tag,text,cls,children:[],appendChild(child){this.children.push(child);child.parent=this;},setAttribute(){},contains(value){return this===value||this.children.some(c=>c.contains(value));},remove(){this.parent.children=this.parent.children.filter(c=>c!==this);},querySelector(selector){return this.children.find(c=>'.'+c.cls===selector)||null;}};}
 const now=Date.UTC(2026,9,15,12),hero=element('section'),main={querySelector:()=>hero},c={Discovery,Date:{now:()=>now},I18n:{language:()=> 'en'},document:{activeElement:null},node:element,button:(text,run,cls)=>element('button',text,cls),focusKey:el=>el,setupText:(lt,en)=>en,compactTitle:v=>v,sessionTitle:v=>v};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 const data={meeting:{title:'GP'},sessions:[{id:'1',title:'Qualifying',start:now+3600000}]};c.renderHeroSchedule(main,data);const first=hero.children[0],count=nodes;for(let n=0;n<100;n++)c.renderHeroSchedule(main,JSON.parse(JSON.stringify(data)));assert.equal(nodes,count);assert.equal(hero.children[0],first);
 c.document.activeElement=first;data.sessions[0].title='New F1 title';c.renderHeroSchedule(main,data);assert.equal(hero.children[0],first);c.document.activeElement=null;c.renderHeroSchedule(main,data);assert.notEqual(hero.children[0],first);assert.ok(nodes>count);
});
