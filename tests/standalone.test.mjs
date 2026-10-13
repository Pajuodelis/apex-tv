import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {sealTVSession} from '../companion/tv-session.mjs';
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const subtle=crypto.webcrypto.subtle;
test('TV session envelope is signed, encrypted only for recipient and tamper evident',async()=>{
  const recipient=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const token='private-test-account-session';
  const envelope=await sealTVSession(token,await subtle.exportKey('jwk',recipient.publicKey),rsa.privateKey);
  const bytes=Buffer.from(envelope.payload,'base64');
  assert.equal(crypto.verify('RSA-SHA256',bytes,rsa.publicKey,Buffer.from(envelope.signature,'base64')),true);
  assert.equal(bytes.includes(token),false);
  const info=JSON.parse(bytes),sender=await subtle.importKey('jwk',info.publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=await subtle.deriveBits({name:'ECDH',public:sender},recipient.privateKey,256);
  const key=await subtle.importKey('raw',shared,{name:'AES-GCM'},false,['decrypt']);
  const plain=await subtle.decrypt({name:'AES-GCM',iv:Buffer.from(info.iv,'base64')},key,Buffer.from(info.ciphertext,'base64'));
  assert.equal(JSON.parse(Buffer.from(plain)).token,token);
  const changed=Buffer.from(info.ciphertext,'base64');changed[3]^=1;
  await assert.rejects(subtle.decrypt({name:'AES-GCM',iv:Buffer.from(info.iv,'base64')},key,changed));
});
test('TV provisioning rejects private, malformed and oversized recipient keys',async()=>{
  for(const key of [null,{kty:'RSA'},{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43),d:'secret'}])await assert.rejects(sealTVSession('token',key,rsa.privateKey));
});
test('TV browser client rejects forged account tokens before requesting entitlement',async()=>{
  const jwk={...rsa.publicKey.export({format:'jwk'}),kid:'test'},requests=[];
  const context={window:{},crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,AbortController,URL,Promise,setTimeout,clearTimeout,atob,btoa,
    fetch:async(url)=>{requests.push(url);return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});}};
  vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../web/discovery.js',import.meta.url),'utf8'),context);vm.runInContext(await fs.readFile(new URL('../web/editorial.js',import.meta.url),'utf8'),context);vm.runInContext(await fs.readFile(new URL('../web/f1-browser.js',import.meta.url),'utf8'),context);
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({exp:Date.now()/1000+3600})).toString('base64url');
  await assert.rejects(context.window.ApexStandalone.client.signIn(header+'.'+payload+'.'+Buffer.from('forged').toString('base64url')));
  assert.equal(context.window.ApexStandalone.client.status().signedIn,false);
  assert.deepEqual(requests,['https://api.formula1.com/static/jwks.json']);
});
test('constant-IV CBCS audio corrects only the empty sample count and retains opaque payload',async()=>{
  const context={window:{},Uint8Array,DataView};vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../web/cbcs-audio.js',import.meta.url),'utf8'),context);
  const api=context.window.ApexCbcsAudio;
  function box(type,payload){const b=Buffer.alloc(8+payload.length);b.writeUInt32BE(b.length);b.write(type,4,4,'ascii');payload.copy(b,8);return b;}
  const id=Buffer.alloc(16,0x31),iv=Buffer.alloc(16,0x42),descriptor={id,iv};
  const trun=Buffer.alloc(8);trun.writeUInt32BE(3,4);
  const sgpd=Buffer.alloc(53);sgpd[0]=1;sgpd.write('seig',4,4,'ascii');sgpd.writeUInt32BE(37,8);sgpd.writeUInt32BE(1,12);sgpd[18]=1;id.copy(sgpd,20);sgpd[36]=16;iv.copy(sgpd,37);
  const sbgp=Buffer.alloc(20);sbgp.write('seig',4,4,'ascii');sbgp.writeUInt32BE(1,8);sbgp.writeUInt32BE(3,12);sbgp.writeUInt32BE(65537,16);
  const senc=box('senc',Buffer.alloc(8)),opaque=box('mdat',Buffer.from('unchanged encrypted audio'));
  const media=Buffer.concat([box('moof',box('traf',Buffer.concat([box('trun',trun),box('sgpd',sgpd),box('sbgp',sbgp),senc]))),opaque]);
  const original=Buffer.from(media),fixed=api.repair(media,descriptor),output=Buffer.from(fixed.bytes);
  assert.equal(fixed.changed,1);assert.deepEqual(media,original);assert.deepEqual(output.subarray(-opaque.length),opaque);
  const countAt=output.indexOf(Buffer.from('senc'))+8;assert.equal(output.readUInt32BE(countAt),3);
  const expected=Buffer.from(original);expected.writeUInt32BE(3,countAt);assert.deepEqual(output,expected);
  assert.equal(api.repair(output,descriptor).changed,0);
  assert.equal(api.repair(original,{id:Buffer.alloc(16,0x77),iv}).changed,0);
  assert.equal(api.repair(original,null).changed,0);
  // MSE can use the identical protected track default when the fragment group
  // exactly duplicates it. Unknown groups and key/IV rotation remain untouched.
  const mse=api.repair(output,descriptor,true),mseBytes=Buffer.from(mse.bytes);
  assert.equal(mse.changed,1);
  const mseExpected=Buffer.from(output);
  for(const name of ['sgpd','sbgp'])mseExpected.write('free',mseExpected.indexOf(Buffer.from(name)),4,'ascii');
  assert.deepEqual(mseBytes,mseExpected);
  assert.deepEqual(mseBytes.subarray(-opaque.length),opaque);
  assert.equal(api.repair(output,{id,iv:Buffer.alloc(16,0x88)},true).changed,0);
  const rotated=Buffer.from(output);rotated[rotated.indexOf(Buffer.from('sgpd'))+22]^=1;
  assert.equal(api.repair(rotated,descriptor,true).changed,0);
  assert.equal(api.repair(mseBytes,descriptor,true).changed,0);
});
