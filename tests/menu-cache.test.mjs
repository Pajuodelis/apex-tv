import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const cfg={publicKey:rsa.publicKey.export({format:'jwk'}),shell:1,bundledVersion:'0.2.0'};
async function api(){const c={window:{},crypto:crypto.webcrypto,TextDecoder,Uint8Array,ArrayBuffer,URL,Number,Error,Promise,atob,btoa};vm.createContext(c);vm.runInContext(await fs.readFile(new URL('../tv/menu-cache.js',import.meta.url),'utf8'),c);return c.window.ApexMenuCache;}
function sign(m){const bytes=Buffer.from(JSON.stringify(m));return {payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,rsa.privateKey).toString('base64')};}
function fixture(){const files={'tv-app.js':new TextEncoder().encode('valid signed menu').buffer,'tv.css':new TextEncoder().encode('body{}').buffer};const revision='abcdef0123456789abcdef01',m={revision,version:'0.2.0',shell:1,files:Object.entries(files).map(([name,b])=>({name,path:'/release/'+revision+'/'+name,integrity:'sha256-'+crypto.createHash('sha256').update(Buffer.from(b)).digest('base64')}))};return {m,files,signed:sign(m)};}
test('cached TV menu rejects changed code, forged signatures, duplicate files and older versions',async()=>{
const a=await api(),b=fixture();assert.equal((await a.verify(b,cfg)).revision,b.m.revision);
const changed={...b,files:{...b.files,'tv-app.js':new TextEncoder().encode('tampered menu').buffer}};await assert.rejects(a.verify(changed,cfg),/pažeistas/);
const signature=Buffer.from(b.signed.signature,'base64');signature[3]^=1;await assert.rejects(a.verify({...b,signed:{...b.signed,signature:signature.toString('base64')}},cfg),/parašas/);
for(const m of [{...b.m,version:'0.1.2'},{...b.m,files:[b.m.files[0],b.m.files[0]]},{...b.m,files:[{...b.m.files[0],path:'https://other.test/script.js'},b.m.files[1]]}])await assert.rejects(a.verify({...b,signed:sign(m)},cfg));
});
test('TV bootstrap falls back to installed menu and starts when the PC and menu cache are unavailable',async()=>{
let starts=0,initializations=0;const paths=[],elements={};for(const id of ['boot-status','boot-fix','boot-retry','boot','app'])elements[id]={hidden:false,focus(){}};
const direct={initialize:async()=>{initializations++;},client:{status:()=>({signedIn:true})}};
const tv={start(){starts++;}};
const cache={localServer:()=> 'http://192.168.50.10:8317',cache:async()=>{throw Error('storage unavailable');},download:async()=>{throw Error('PC unavailable');}};
class OfflineXHR{open(){}setRequestHeader(){}send(){}}
const window={APEX_CONFIG:cfg,APEX_BUNDLED:{revision:'abcdef0123456789abcdef01',version:'0.2.0'},ApexTV:tv,ApexStandalone:direct};
const context={window,ApexMenuCache:cache,ApexStandalone:direct,ApexTV:tv,XMLHttpRequest:OfflineXHR,Promise,URL,Blob,Error,localStorage:{getItem(){return null;}},location:{reload(){throw Error('unexpected reload');}},setTimeout(){},setInterval(){},document:{getElementById:id=>elements[id],createElement:tag=>({tag}),body:{classList:{contains(){return false;}}},head:{appendChild(e){paths.push(e.src||e.href);queueMicrotask(()=>e.onload());}}}};
vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../tv/boot-standalone.js',import.meta.url),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(paths,['menu/tv.css','menu/tv-app.js']);assert.equal(starts,1);assert.equal(initializations,1);assert.equal(window.APEX_CONTEXT.standalone,true);assert.equal(window.APEX_CONTEXT.monitor,false);assert.equal(elements.boot.hidden,true);assert.equal(elements.app.hidden,false);
});