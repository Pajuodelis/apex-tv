import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function load(appendPacketAsync) {
  const window={tizentvwasm:{SideThreadElementaryMediaTrack:{appendPacketAsync}}};
  const context={window,Uint8Array,DataView,URL,Number,Error,setTimeout,clearTimeout,setInterval,clearInterval};
  vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../web/emss-player.js',import.meta.url),'utf8'),context);
  return window.ApexElementary;
}
const packet=(dts)=>({packet:{dts,pts:dts,duration:1},data:Uint8Array.of(1,2,3)});
test('Samsung packet backpressure retains the exact unaccepted packet for retry',async()=>{
  let full=true;const submitted=[];
  const api=await load((id,p,data)=>{if(full){const e=new Error('full');e.name='AppendBufferFullError';throw e;}submitted.push({id,p,data});});
  const player=new api.Player({currentTime:0},{},()=>{});player.fill=async()=>{};
  const first=packet(0),second=packet(1);const track={queue:[first,second],track:{isOpen:true,sessionId:7,trackId:3},metadata:{type:'audio'}};player.tracks=[track];
  player.pump();assert.equal(player.closed,false);assert.equal(track.queue[0],first);assert.equal(track.queue.length,2);
  full=false;player.pump();assert.equal(submitted.length,2);assert.equal(submitted[0].data,first.data);assert.equal(submitted[0].p.sessionId,7);assert.equal(track.queue.length,0);
});
test('Samsung initial submission exceeds the documented three-second startup buffer',async()=>{
  const submitted=[];const api=await load((id,p)=>submitted.push(p.dts));const player=new api.Player({currentTime:0},{},()=>{});player.fill=async()=>{};
  player.tracks=[{queue:Array.from({length:8},(_,i)=>packet(i)),track:{isOpen:true,sessionId:9,trackId:2},metadata:{type:'video'}}];
  player.pump();assert.deepEqual(submitted,[0,1,2,3,4,5]);assert.equal(player.tracks[0].queue[0].packet.dts,6);
});