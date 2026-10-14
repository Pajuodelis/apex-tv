import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...rsa.publicKey.export({format:'jwk'}),kid:'phone-test'};
function jwt(payload){const raw=[{alg:'RS256',kid:jwk.kid},payload].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return raw+'.'+crypto.sign('RSA-SHA256',Buffer.from(raw),rsa.privateKey).toString('base64url');}
async function fixture({grant={},polls=[],block='',defer}={}){
 let now=Date.now();class Clock extends Date{static now(){return now;}}
 const calls=[],saved=[],token=jwt({exp:now/1000+3600,SessionId:'synthetic-session'});
 const envelope=jwt({subscriptionToken:token});
 const context={window:{APEX_CONFIG:{}},Date:Clock,crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,AbortController,URL,Promise,setTimeout,clearTimeout,atob,btoa,
 fetch:async(url,options={})=>{
  calls.push({url,body:options.body,signal:options.signal});
  if(defer)await defer(url);
  if(url.endsWith('/device_authorization'))return Response.json({device_code:'private-device-code',user_code:'TEST-1234',verification_uri:'https://f1.com/pair',expires_in:600,interval:5,...grant});
  if(url.endsWith('/token')){const next=polls.shift();return next?new Response(JSON.stringify(next.data),{status:next.status,headers:{'content-type':next.type||'application/json'}}):Response.json({access_token:envelope,refresh_token:'unused-private-refresh'});}
  const stage=url.includes('jwks')?'signature':url.includes('ENTITLEMENT')?'entitlement':'location';
  if(block===stage)return new Response('synthetic-secret-body',{status:403,headers:{'content-type':'text/html'}});
  return Response.json(stage==='signature'?{keys:[jwk]}:stage==='entitlement'?{resultObj:{entitlementToken:'synthetic-entitlement'}}:{resultObj:{userLocation:[{detectedCountryIsoCode:'LT'}]}});
 }};
 vm.createContext(context);for(const file of ['discovery.js','editorial.js','f1-browser.js'])vm.runInContext(await fs.readFile(new URL('../web/'+file,import.meta.url),'utf8'),context);
 const api=context.window.ApexStandalone;api.client.vault={save:async value=>saved.push(value)};
 return {api,calls,saved,token,advance:ms=>now+=ms};
}
test('phone OAuth verifies the nested F1 session, subscription and region before saving; no OAuth secrets escape',async()=>{
 const f=await fixture();const info=await f.api.startPhoneLogin();
 assert.equal(info.code,'TEST-1234');assert.equal(info.url,'https://f1.com/pair?user_code=TEST-1234');assert(!JSON.stringify(info).includes('private-device'));
 f.advance(5000);const result=await f.api.pollPhoneLogin();assert.equal(result.state,'signedIn');assert.equal(result.account.country,'LT');assert.deepEqual(f.saved,[f.token]);
 const report=JSON.stringify(f.api.loginDiagnostics());for(const secret of [f.token,'private-device-code','unused-private-refresh','synthetic-session'])assert(!report.includes(secret));
 assert(f.calls.every(c=>c.url.startsWith('https://id.formula1.com/')||c.url.startsWith('https://api.formula1.com/')||c.url.startsWith('https://f1tv.formula1.com/')));
});
test('polls obey the server interval and slow_down adds five seconds; early polls do not send requests',async()=>{
 const f=await fixture({polls:[{status:400,data:{error:'authorization_pending'}},{status:400,data:{error:'slow_down'}}]});
 await f.api.startPhoneLogin();assert.equal((await f.api.pollPhoneLogin()).retryAfter,5000);assert.equal(f.calls.length,1);
 f.advance(5000);assert.equal((await f.api.pollPhoneLogin()).retryAfter,5000);
 f.advance(5000);assert.equal((await f.api.pollPhoneLogin()).retryAfter,10000);
 f.advance(9000);assert.equal((await f.api.pollPhoneLogin()).retryAfter,1000);assert.equal(f.calls.length,3);
 f.advance(1000);assert.equal((await f.api.pollPhoneLogin()).state,'signedIn');
});
test('HTTP 403 is terminal with exact stage and safe diagnostics; never switches clients or retries',async()=>{
 const f=await fixture({polls:[{status:403,type:'text/html',data:{error:'authorization_pending',private:'secret'}}]});
 await f.api.startPhoneLogin();f.advance(5000);await assert.rejects(f.api.pollPhoneLogin(),e=>e.loginStage==='device_token'&&e.upstreamStatus===403);
 await assert.rejects(f.api.pollPhoneLogin(),e=>e.cancelled);assert.equal(f.calls.length,2);assert.equal(f.saved.length,0);
 assert(!JSON.stringify(f.api.loginDiagnostics()).includes('secret'));
});
test('unapproved verification hosts, URLs, codes and expiry are rejected before polling',async()=>{
 for(const grant of [{verification_uri:'https://attacker.invalid/pair'},{verification_uri:'http://f1.com/pair'},{verification_uri:'https://f1.com/pair?redirect=elsewhere'},{user_code:'<script>'},{expires_in:0},{device_code:''}]){
  const f=await fixture({grant});await assert.rejects(f.api.startPhoneLogin());assert.equal(f.calls.length,1);await assert.rejects(f.api.pollPhoneLogin());assert.equal(f.saved.length,0);
 }
});
test('expired codes stop locally, and denied codes expose only a known error enum',async()=>{
 const expired=await fixture();await expired.api.startPhoneLogin();expired.advance(600001);await assert.rejects(expired.api.pollPhoneLogin());assert.equal(expired.calls.length,1);
 const denied=await fixture({polls:[{status:400,data:{error:'access_denied',error_description:'private response'}}]});await denied.api.startPhoneLogin();denied.advance(5000);await assert.rejects(denied.api.pollPhoneLogin(),e=>e.deviceError==='access_denied');assert.equal(denied.saved.length,0);assert(!JSON.stringify(denied.api.loginDiagnostics()).includes('private response'));
});
test('cancelling an in-flight token request prevents sign-in and storage',async()=>{
 let release;const waiting=new Promise(resolve=>release=resolve);
 const f=await fixture({defer:url=>url.endsWith('/token')?waiting:undefined});await f.api.startPhoneLogin();f.advance(5000);
 const poll=f.api.pollPhoneLogin();f.api.cancelPhoneLogin();release();await assert.rejects(poll,e=>e.cancelled);assert.equal(f.saved.length,0);assert.equal(f.api.client.status().signedIn,false);assert(f.calls[1].signal.aborted);
});
test('a valid OAuth response never overrides an F1 subscription rejection',async()=>{
 const f=await fixture({block:'entitlement'});await f.api.startPhoneLogin();f.advance(5000);await assert.rejects(f.api.pollPhoneLogin(),e=>e.loginStage==='entitlement');assert.equal(f.saved.length,0);assert.equal(f.api.client.status().signedIn,false);
});
test('a missing or altered nested subscription token is never saved',async()=>{
 const valid=jwt({exp:Date.now()/1000+3600}),forged=valid.slice(0,valid.lastIndexOf('.')+1)+'AAAA';
 for(const access_token of [jwt({}),jwt({subscriptionToken:'not-a-session'}),jwt({subscriptionToken:jwt({exp:Date.now()/1000-10})}),jwt({subscriptionToken:forged})]){
  const f=await fixture({polls:[{status:200,data:{access_token}}]});await f.api.startPhoneLogin();f.advance(5000);await assert.rejects(f.api.pollPhoneLogin());assert.equal(f.saved.length,0);
 }
});
test('storage failure never commits a signed-in account',async()=>{
 const f=await fixture();f.api.client.vault.save=async()=>{throw new Error('synthetic private storage error');};
 await f.api.startPhoneLogin();f.advance(5000);await assert.rejects(f.api.pollPhoneLogin(),e=>e.loginStage==='storage');assert.equal(f.api.client.status().signedIn,false);assert(!JSON.stringify(f.api.loginDiagnostics()).includes('private storage'));
});
test('UI cancellation clears its timer and direct F1 polling on Back, navigation and hiding',async()=>{
 const source=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8');
 const begin=source.indexOf('  var phoneLoginCleanup = null;'),end=source.indexOf('  function render()');
 const c={};vm.createContext(c);vm.runInContext(source.slice(begin,end),c);let cancelled=0;c.phoneLoginCleanup=()=>cancelled++;
 c.cancelPhoneScreen();c.cancelPhoneScreen();assert.equal(cancelled,1);assert.equal(c.phoneLoginCleanup,null);
 assert.match(source,/function render\(\)\s*\{\s*cancelPhoneScreen\(\)/);
 assert.match(source,/function goBack\(\)\s*\{\s*cancelPhoneScreen\(\)/);
 assert.match(source,/visibilitychange[^\n]*document.hidden\)\{cancelPhoneScreen\(\)/);
});
