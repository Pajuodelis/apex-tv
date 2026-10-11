import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
async function fixture(t) {
const blobs=new Map(),peers=new Map(),waiting=[],timers=new Set();let next=2,bound;
const api={SockFlags:{SOCK_NONBLOCK:2048},MsgFlags:{MSG_NOSIGNAL:16384},ErrorCodes:{EAGAIN:11,EWOULDBLOCK:11},PollFlags:{POLLIN:1,POLLOUT:4,POLLERR:8,POLLNVAL:32},NetAddress:function(family,bytes,port){Object.assign(this,{family,bytes,port});},PollFd:function(fd,events){Object.assign(this,{fd,events,revents:0});},SocketsManager:{
create(family,type,flags){assert.equal(family,'af_inet');assert.equal(type,'sock_stream');assert.equal(flags,2048);return 1;},bind(fd,address){bound=address;},listen(){},getSockName(){return {port:42851,bytes:bound.bytes};},getErrorCode(){return 11;},
poll(entries){for(const q of entries){if(q.fd===1)q.revents=waiting.length?1:0;else{const p=peers.get(q.fd);q.revents=p?(p.input.length?1:0)|4:32;}}},accept4(){return waiting.shift();},
recv(fd,bytes){const p=peers.get(fd),n=Math.min(bytes.length,13,p.input.length);bytes.set(p.input.subarray(0,n));p.input=p.input.subarray(n);return n;},
send(fd,bytes){const p=peers.get(fd),n=Math.min(31,bytes.length);p.output.push(Buffer.from(bytes.subarray(0,n)));return n;},close(fd){const p=peers.get(fd);if(p){peers.delete(fd);p.resolve(Buffer.concat(p.output));}}}};
class MockBlob{constructor(parts){this.source=parts.join('');}}
const FakeURL={createObjectURL(blob){const id='blob:'+blobs.size;blobs.set(id,blob.source);return id;},revokeObjectURL(id){blobs.delete(id);}};
class Worker{
constructor(url){this.context={self:{tizentvwasm:api},TextEncoder,TextDecoder,Uint8Array,Number,Array,Object,Date,String,postMessage:data=>queueMicrotask(()=>this.onmessage?.({data})),setTimeout:(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout:id=>{clearTimeout(id);timers.delete(id);}};vm.createContext(this.context);vm.runInContext(blobs.get(url),this.context);}
postMessage(data){this.context.onmessage({data});}terminate(){for(const id of timers)clearTimeout(id);timers.clear();}}
const context={window:{},Worker,URL:FakeURL,Blob:MockBlob,crypto:crypto.webcrypto,Uint8Array,Array,Object,Promise,Error,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../web/native-relay.js',import.meta.url),'utf8'),context);
const routes=[],server=await context.window.ApexNativeRelay.open(async path=>{routes.push(path);return {bytes:new TextEncoder().encode('sample body'),contentType:'text/plain'};},()=>{});
t.after(()=>{server.stop();for(const id of timers)clearTimeout(id);});assert.deepEqual(Array.from(bound.bytes),[127,0,0,1]);assert.equal(bound.port,0);
return {server,routes,request:raw=>new Promise(resolve=>{const fd=next++;peers.set(fd,{input:Buffer.from(raw),output:[],resolve});waiting.push(fd);})};
}
test('TV HTTP worker handles fragmented requests, partial sends, Range and HEAD',async t=>{
const f=await fixture(t),path=new URL(f.server.url).pathname;
const response=await f.request('GET '+path+'/sample HTTP/1.1\r\nRange: bytes=2-5\r\n\r\n');
assert.ok(response.toString().startsWith('HTTP/1.1 206 Partial Content\r\n'));assert.ok(response.toString().includes('Content-Range: bytes 2-5/11\r\n'));assert.equal(response.toString().split('\r\n\r\n')[1],'mple');assert.deepEqual(f.routes,['/sample']);
const head=await f.request('HEAD '+path+'/sample HTTP/1.1\r\n\r\n');assert.ok(head.toString().includes('Content-Length: 11\r\n'));assert.equal(head.toString().split('\r\n\r\n')[1],'');
});
test('TV HTTP worker rejects wrong session paths and unsupported multi-ranges',async t=>{
const f=await fixture(t),path=new URL(f.server.url).pathname;
const rejected=await f.request('GET /wrong-session/sample HTTP/1.1\r\n\r\n');assert.ok(rejected.toString().startsWith('HTTP/1.1 404 '));assert.equal(f.routes.length,0);
const range=await f.request('GET '+path+'/sample HTTP/1.1\r\nRange: bytes=0-1,4-5\r\n\r\n');assert.ok(range.toString().startsWith('HTTP/1.1 416 '));assert.ok(range.toString().includes('Content-Range: bytes */11\r\n'));
});
