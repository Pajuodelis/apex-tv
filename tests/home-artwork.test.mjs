import test from 'node:test';
import assert from 'node:assert/strict';
import Discovery from '../web/discovery.js';
const photo=n=>'https://f1tv.formula1.com/image-resizer/image/'+n+'/landscape_web';
function storage(){const values=new Map();let writes=0;return{getItem:k=>values.get(k),setItem(k,v){values.set(k,v);writes++;},get writes(){return writes;},values};}
test('latest service artwork replaces fallback choices and survives restart without storing account data',()=>{
 const db=storage(),cache=Discovery.artwork(db);assert.equal(cache.pick(0),'');
 cache.observe('weekend',[{image:photo('weekend'),token:'SECRET'}]);cache.observe('editorial',[{image:photo('new'),title:'New',password:'SECRET'},{image:photo('second')}]);
 assert.equal(cache.pick(0),photo('new'));assert.equal(cache.pick(1),photo('second'));assert.equal(cache.pick(2),photo('weekend'));
 const saved=[...db.values.values()][0];assert.ok(!saved.includes('SECRET'));assert.ok(!saved.includes('title'));
 assert.equal(Discovery.artwork(db).pick(0),photo('new'));
 cache.observe('editorial',[{image:photo('newer')}]);assert.equal(cache.pick(0),photo('newer'));assert.equal(cache.pick(1),photo('weekend'));
});
test('empty responses, repeated metadata and unavailable storage retain the last valid artwork',()=>{
 const db=storage(),cache=Discovery.artwork(db);cache.observe('editorial',[{image:photo('valid')}]);const writes=db.writes;
 assert.equal(cache.observe('editorial',[]),false);assert.equal(cache.observe('editorial',[{image:photo('valid')}]),false);assert.equal(db.writes,writes);assert.equal(cache.pick(0),photo('valid'));
 const denied=Discovery.artwork({getItem(){throw Error('denied');},setItem(){throw Error('quota');}});assert.equal(denied.observe('weekend',[{image:photo('memory')}]),true);assert.equal(denied.pick(0),photo('memory'));
});
test('cache accepts bounded official public image addresses and rejects malformed persisted data',()=>{
 const db=storage(),cache=Discovery.artwork(db);cache.observe('editorial',[{image:'https://evil.example/img'},{image:photo('valid')+'?token=secret'},{image:'https://user:secret@f1tv.formula1.com/x'},{image:photo('valid')},{image:photo('valid')}]);assert.equal(cache.pick(99),photo('valid'));
 cache.observe('editorial',Array.from({length:100},(_,i)=>({image:photo(i)})));const persisted=JSON.parse([...db.values.values()][0]);assert.equal(persisted.editorial.length,12);
 for(const value of ['bad JSON',JSON.stringify({version:2,editorial:[photo('bad')]}),'x'.repeat(60001)]){const c=Discovery.artwork({getItem:()=>value});assert.equal(c.pick(0),'');}
});
