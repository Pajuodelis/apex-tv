import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {sealTVSession} from '../companion/tv-session.mjs';
import http from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createApp} from '../companion/server.mjs';
const require=createRequire(import.meta.url);
const official=require('../companion/official-login.cjs');
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...rsa.publicKey.export({format:'jwk'}),kid:'login-test'};
function jwt(){const parts=[{alg:'RS256',kid:jwk.kid},{exp:Date.now()/1000+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url'));const raw=parts.join('.');return raw+'.'+crypto.sign('RSA-SHA256',Buffer.from(raw),rsa.privateKey).toString('base64url');}
function stage(url){return url.includes('by-password')?'authentication':url.includes('jwks')?'signature':url.includes('ENTITLEMENT')?'entitlement':'location';}
async function fixture(blocked='',tamper=false){
 const calls=[],saved=[],token=jwt();
 const context={window:{APEX_CONFIG:{publicKey:{kty:'RSA',n:'unrelated-update-key',e:'AQAB'}}},crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,AbortController,URL,Promise,setTimeout,clearTimeout,atob,btoa,
  fetch:async(url)=>{const step=stage(url);calls.push(step);if(step===blocked)return new Response('<html>Request Rejected; synthetic private-data</html>',{status:403,headers:{'content-type':'text/html'}});const data=step==='authentication'?{data:{subscriptionToken:token}}:step==='signature'?{keys:[jwk]}:step==='entitlement'?{resultObj:{entitlementToken:'synthetic'}}:{resultObj:{userLocation:[{detectedCountryIsoCode:'LT'}]}};return new Response(JSON.stringify(data));}};
 class XHR{
  open(method,url){this.url=url;}setRequestHeader(){}send(body){
   const recipient=JSON.parse(body).publicKey;
   sealTVSession(token,recipient,rsa.privateKey).then(envelope=>{if(tamper)envelope.signature='AAAA';this.status=200;this.responseText=JSON.stringify(envelope);this.onload();});
  }
 }
 context.XMLHttpRequest=XHR;vm.createContext(context);
 for(const file of ['discovery.js','editorial.js','f1-browser.js'])vm.runInContext(await fs.readFile(new URL('../web/'+file,import.meta.url),'utf8'),context);
 const api=context.window.ApexStandalone;api.client.vault={save:async t=>saved.push(t)};
 const code={version:1,server:'http://10.100.0.1:8337',key:'a'.repeat(64),publicKey:rsa.publicKey.export({format:'jwk'}),expires:Date.now()+300000};
 return {api,calls,saved,token,code,context};
}
test('TV login identifies the exact failed stage and does not leak request or response secrets',async()=>{
 for(const failure of ['authentication','signature','entitlement','location']){
  const f=await fixture(failure);
  await assert.rejects(f.api.login('synthetic@example.invalid','synthetic-password'),e=>e.loginStage===failure&&e.upstreamStatus===403&&e.message.includes('HTTP 403 (HTML)'));
  const report=f.api.loginDiagnostics(),failed=report.steps.filter(s=>s.state==='failed');
  assert.equal(failed.length,1);assert.equal(failed[0].stage,failure);assert.equal(f.saved.length,0);
  const serialized=JSON.stringify(report);for(const secret of [f.token,'synthetic@example.invalid','synthetic-password','private-data'])assert(!serialized.includes(secret));
 }
});
test('official sign-in decrypts the recipient envelope and still verifies F1 signature, entitlement and region',async()=>{
 const f=await fixture();const publicUpdateKey=f.context.window.APEX_CONFIG.publicKey;
 const status=await f.api.loginOfficial(JSON.stringify(f.code));
 assert(status.signedIn);assert.equal(status.country,'LT');assert.equal(f.saved[0],f.token);
 assert.deepEqual(f.calls,['signature','entitlement','location']);
 assert.strictEqual(f.context.window.APEX_CONFIG.publicKey,publicUpdateKey);
});
test('official sign-in preserves entitlement rejection and never falls back to password or alternate regions',async()=>{
 const f=await fixture('entitlement');
 await assert.rejects(f.api.loginOfficial(JSON.stringify(f.code)),e=>e.loginStage==='entitlement');
 assert.deepEqual(f.calls,['signature','entitlement']);assert.equal(f.saved.length,0);
});
test('official pairing rejects altered signatures before any F1 access or storage',async()=>{
 const f=await fixture('',true);await assert.rejects(f.api.loginOfficial(JSON.stringify(f.code)));
 assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);
});
test('pairing accepts only bounded, recent, explicitly supplied local configuration with a public key',async()=>{
 for(const mutate of [c=>c.server='https://example.com',c=>c.server='http://127.0.0.1:8337',c=>c.server='http://10.100.0.1:8337/path',c=>c.expires=Date.now()-1,c=>c.expires=Date.now()+3600000,c=>c.publicKey.d='private',c=>c.key='bad',c=>c.token='not-allowed']){
  const f=await fixture();mutate(f.code);await assert.rejects(f.api.loginOfficial(JSON.stringify(f.code)));assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);
 }
});
test('official login accepts F1 cookies with either Secure flag and validates HTTPS navigation targets',()=>{
 const cookie={name:'login-session',domain:'.formula1.com',secure:true,value:encodeURIComponent(JSON.stringify({data:{subscriptionToken:jwt()}}))};
 assert(official.sessionFromCookie(cookie));
 assert(official.sessionFromCookie({...cookie,secure:false}));
 for(const change of [{domain:'formula1.com.attacker.invalid'},{name:'other'},{value:'not-json'}])assert.equal(official.sessionFromCookie({...cookie,...change}),'');
 const observation=official.cookieObservation({...cookie,secure:false});
 assert(observation.found && observation.tokenPresent && observation.acceptedShape);
 assert(!JSON.stringify(observation).includes(decodeURIComponent(cookie.value)));
 assert(official.officialLoginUrl({}).startsWith('https://account.formula1.com/'));
 assert.throws(()=>official.officialLoginUrl({authLinks:{login:'https://attacker.invalid/?redirect='}}));
 for(const url of ['http://account.formula1.com','https://user:pass@account.formula1.com','https://account.formula1.com:8443'])assert.equal(official.formulaHost(url),false);
});
test('official pairing code requires local CSRF approval, the configured TV and one successful redemption',async(t)=>{
 const config={pcAddress:'10.100.0.1',tvAddress:'127.0.0.2',port:8317};
 const client={token:jwt(),status:()=>({signedIn:true,country:'LT'})};
 const app=await createApp({root:fileURLToPath(new URL('../',import.meta.url)),client,
  setupData:{config,pairingKey:'existing-private-key',privateKey:rsa.privateKey,publicKey:rsa.publicKey.export({format:'jwk'})}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const request=(route,method='GET',headers={},body='',address='127.0.0.1')=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path:route,method,localAddress:address,headers:{Host:'127.0.0.1:8317',...headers}},res=>{
   const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString())}));
  });req.on('error',reject);req.end(body);
 });
 const state=(await request('/admin/state')).data;
 const admin={'X-Apex-CSRF':state.csrf,Origin:'http://127.0.0.1:8317'};
 assert.equal((await request('/admin/pairing-code','POST')).status,403);
 assert.equal((await request('/admin/pairing-code','POST',admin,'','127.0.0.2')).status,403);
 const result=await request('/admin/pairing-code','POST',admin);assert.equal(result.status,200);
 const code=result.data;assert.notEqual(code.key,'existing-private-key');assert(!JSON.stringify(code).includes(client.token));
 const key=await crypto.webcrypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const body=JSON.stringify({publicKey:await crypto.webcrypto.subtle.exportKey('jwk',key.publicKey)});
 assert.equal((await request('/api/official-tv-session','POST',{'X-Apex-Key':code.key},body)).status,403);
 assert.equal((await request('/api/official-tv-session','POST',{'X-Apex-Key':'wrong'},body,'127.0.0.2')).status,401);
 const redeemed=await request('/api/official-tv-session','POST',{'X-Apex-Key':code.key},body,'127.0.0.2');
 assert.equal(redeemed.status,200);assert(!JSON.stringify(redeemed.data).includes(client.token));
 assert.equal((await request('/api/official-tv-session','POST',{'X-Apex-Key':code.key},body,'127.0.0.2')).status,401);
 const next=(await request('/admin/pairing-code','POST',admin)).data;
 const originalNow=Date.now;try{Date.now=()=>originalNow()+6*60*1000;
  assert.equal((await request('/api/official-tv-session','POST',{'X-Apex-Key':next.key},body,'127.0.0.2')).status,401);
 }finally{Date.now=originalNow;}
});
