import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../tv/legacy-polyfills.js',import.meta.url),'utf8');
function legacy(){const c=vm.createContext({setTimeout,clearTimeout});vm.runInContext(`delete String.prototype.replaceAll;delete String.prototype.matchAll;delete Object.fromEntries;delete Promise.prototype.finally;this.window=this;`,c);vm.runInContext(source,c);return c;}
test('legacy string helpers preserve replaceAll callbacks, substitutions, empty matches and regex guards',()=>{
 const c=legacy();assert.equal(vm.runInContext(`'aba'.replaceAll('a',function(match,offset){return offset;})`,c),'0b2');assert.equal(vm.runInContext(`'ab'.replaceAll('a','$&$&')`,c),'aab');assert.equal(vm.runInContext(`'a.b.'.replaceAll('.',':')`,c),'a:b:');assert.equal(vm.runInContext(`'ab'.replaceAll('','-')`,c),'-a-b-');assert.throws(()=>vm.runInContext(`'ab'.replaceAll(/a/,'x')`,c),/global/);
});
test('legacy matchAll advances over full Unicode characters without looping',()=>{
 const c=legacy();const indexes=vm.runInContext(`Array.from('😀'.matchAll(/(?:)/gu),function(m){return m.index;})`,c,{timeout:1000});assert.deepEqual(Array.from(indexes),[0,2]);
});
test('legacy fromEntries keeps __proto__ as data and finally accepts non-functions',async()=>{
 const c=legacy();assert.equal(vm.runInContext(`(function(){var o=Object.fromEntries([['__proto__',{injected:true}]]);return Object.getPrototypeOf(o)===Object.prototype&&Object.prototype.hasOwnProperty.call(o,'__proto__')&&!o.injected;})()`,c),true);assert.equal(await vm.runInContext(`Promise.resolve(42).finally(undefined)`,c),42);
});
test('guarded legacy runtime preserves native APIs when present',()=>{
 const c=vm.createContext({setTimeout,clearTimeout});vm.runInContext('this.window=this;this.before=[String.prototype.replaceAll,Object.fromEntries,Promise.prototype.finally];',c);vm.runInContext(source,c);assert.equal(vm.runInContext('before[0]===String.prototype.replaceAll&&before[1]===Object.fromEntries&&before[2]===Promise.prototype.finally',c),true);
});
test('relay eligibility preserves worker-only Tizen 6+ sockets and excludes legacy TVs',async()=>{
 const app=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8'),start=app.indexOf('  var legacyTizen ='),end=app.indexOf('  var browserPlayer',start);assert.ok(start>=0&&end>start);
 for(const [ua,bigint,expected] of [['Tizen 5.0',undefined,false],['Tizen 5.5',undefined,false],['Tizen 6.0',BigInt,true],['Tizen 9.0',BigInt,true]]){const c=vm.createContext({navigator:{userAgent:ua},window:{},BigInt:bigint});vm.runInContext(app.slice(start,end),c);assert.equal(c.localRelaySupported,expected,ua);}
});
