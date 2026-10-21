import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {packZip,unpackZip,buildTV} from '../tools/build-tv.mjs';
import {recoverInstalledIdentity} from '../companion/identity.mjs';

test('public WGT builds the full playable UI without personal configuration or device signatures',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'apex-public-package-'));
  try{
    const result=await buildTV({outputDirectory:directory}), archive=await fs.readFile(path.join(directory,result.filename)), files=unpackZip(archive);
    const bundled={window:{}};vm.runInNewContext(await fs.readFile(new URL('../tv/bundled-version.js',import.meta.url),'utf8'),bundled);
    assert.equal(result.unsigned,true);assert.equal(result.entries,16);assert.ok(files.has('legacy-polyfills.js'));assert.equal(result.revision,bundled.window.APEX_BUNDLED.revision);
    for(const name of ['config.xml','index.html','icon.png','menu/tv-app.js','menu/tv.css','LICENSE','menu/dash-LICENSE.md','menu/dash.all.min.js.LICENSE.txt','menu/qrcode-LICENSE'])assert.ok(files.has(name),name);
    assert.ok(files.get('menu/tv-app.js').includes(Buffer.from('ApexNativeRelay')));
    assert.ok(files.get('menu/tv-app.js').includes(Buffer.from('ApexTV')));
    assert.ok(files.get('menu/tv-app.js').includes(Buffer.from('ApexTimeline')));
    assert.ok(files.get('menu/tv-app.js').includes(Buffer.from('ApexEditorial')));
    assert.ok(files.get('menu/tv-app.js').includes(Buffer.from('ApexSetupChecks')));
    assert.match(files.get('menu/qrcode-LICENSE').toString(),/Copyright \(c\) 2009 Kazuhiko Arase/);
    assert.equal(files.has('author-signature.xml'),false);assert.equal(files.has('signature1.xml'),false);
    const config={window:{}};vm.runInNewContext(files.get('connection.js').toString(),config);
    assert.equal(config.window.APEX_CONFIG.server,'');assert.equal(config.window.APEX_CONFIG.pairingKey,'');assert.equal(config.window.APEX_CONFIG.publicKey.d,undefined);
    const second=await buildTV({outputDirectory:directory});assert.equal(second.sha256,result.sha256);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('ZIP writer rejects traversal and reader rejects altered package bytes',()=>{
  assert.throws(()=>packZip([['../credential',Buffer.from('a')]]));
  const bytes=packZip([['safe.txt',Buffer.from('a')]]);bytes[14]^=1;assert.throws(()=>unpackZip(bytes));
});
test('standalone public bootstrap does not require the publisher companion private identity',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'apex-public-identity-'));
  try{assert.equal(await recoverInstalledIdentity({root:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),stateDirectory:directory,legacyDirectory:directory}),false);}
  finally{await fs.rm(directory,{recursive:true,force:true});}
});
