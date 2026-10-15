import test from 'node:test';
import assert from 'node:assert/strict';
import Discovery from '../web/discovery.js';

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
