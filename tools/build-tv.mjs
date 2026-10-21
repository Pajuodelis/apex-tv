import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Releases } from '../companion/releases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['config.xml','index.html','icon.png','boot.js','boot.css','menu-cache.js','connection.js','legacy-polyfills.js'];
const privacyPattern = /(?:-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;
const tables = Array.from({length:256}, (_, n) => { for(let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
const crc32 = bytes => { let n=0xffffffff; for(const b of bytes)n=tables[(n^b)&255]^(n>>>8); return (n^0xffffffff)>>>0; };
export function packZip(entries) {
  const local=[], central=[]; let offset=0;
  for (const [name, raw] of entries) {
    if (!/^[A-Za-z0-9_.\/-]+$/.test(name) || name.includes('..') || name.startsWith('/')) throw Error('Invalid package path');
    const bytes=Buffer.from(raw), filename=Buffer.from(name), compressed=deflateRawSync(bytes), crc=crc32(bytes);
    const h=Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4); h.writeUInt16LE(0x800,6); h.writeUInt16LE(8,8);
    h.writeUInt16LE(0x21,12); h.writeUInt32LE(crc,14); h.writeUInt32LE(compressed.length,18); h.writeUInt32LE(bytes.length,22); h.writeUInt16LE(filename.length,26);
    local.push(h,filename,compressed);
    const c=Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt16LE(0x800,8); c.writeUInt16LE(8,10);
    c.writeUInt16LE(0x21,14); c.writeUInt32LE(crc,16); c.writeUInt32LE(compressed.length,20); c.writeUInt32LE(bytes.length,24); c.writeUInt16LE(filename.length,28); c.writeUInt32LE(offset,42);
    central.push(c,filename); offset+=h.length+filename.length+compressed.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function unpackZip(buffer) {
  const files=new Map(); let at=0;
  while(at+30<=buffer.length && buffer.readUInt32LE(at)===0x04034b50) {
    const nameLength=buffer.readUInt16LE(at+26), extra=buffer.readUInt16LE(at+28), size=buffer.readUInt32LE(at+18), start=at+30+nameLength+extra;
    const name=buffer.subarray(at+30,at+30+nameLength).toString('utf8'), raw=inflateRawSync(buffer.subarray(start,start+size));
    if(raw.length!==buffer.readUInt32LE(at+22)||crc32(raw)!==buffer.readUInt32LE(at+14)||files.has(name))throw Error('Corrupt archive');
    files.set(name,raw);at=start+size;
  }
  if(buffer.readUInt32LE(at)!==0x02014b50||buffer.readUInt32LE(buffer.length-22)!==0x06054b50||files.size!==buffer.readUInt16LE(buffer.length-12))throw Error('Incomplete archive');
  return files;
}
export async function buildTV({outputDirectory=path.join(root,'dist')}={}) {
  const packageInfo=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const configContext={window:{}}; vm.runInNewContext(await fs.readFile(path.join(root,'tv/connection.js'),'utf8'),configContext);
  const boot=configContext.window.APEX_CONFIG;
  if(boot.server || boot.pairingKey || !boot.publicKey?.n || boot.publicKey.d || boot.shell!==1)throw Error('Public TV package must not contain personal pairing or private keys');
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const release=await new Releases(root,privateKey).publish();
  const metadata=JSON.parse(Buffer.from(release.manifest.payload,'base64').toString()); metadata.version=packageInfo.version;
  const previousContext={window:{}};vm.runInNewContext(await fs.readFile(path.join(root,'tv/bundled-version.js'),'utf8'),previousContext);
  const previous=previousContext.window.APEX_BUNDLED;
  // Preserve the upstream signed snapshot timestamp when rebuilding the same sources.
  if(previous.revision===metadata.revision && previous.version===metadata.version)metadata.builtAt=previous.builtAt;
  const entries=[];
  for(const name of required) entries.push([name,await fs.readFile(path.join(root,'tv',name))]);
  entries.push(['bundled-version.js',Buffer.from('window.APEX_BUNDLED = '+JSON.stringify(metadata)+';\n')]);
  for(const [name,bytes] of release.files)entries.push(['menu/'+name,bytes]);
  for(const name of ['dash-LICENSE.md','dash.all.min.js.LICENSE.txt','qrcode-LICENSE'])entries.push(['menu/'+name,await fs.readFile(path.join(root,'web/vendor',name))]);
  entries.push(['LICENSE',await fs.readFile(path.join(root,'LICENSE'))]);
  entries.push(['THIRD_PARTY_NOTICES.md',await fs.readFile(path.join(root,'THIRD_PARTY_NOTICES.md'))]);
  for(const [name,bytes]of entries){if(name!=='icon.png'&&privacyPattern.test(bytes.toString('utf8')))throw Error('Private material found in package: '+name);}
  const archive=packZip(entries),files=unpackZip(archive);
  if(files.has('author-signature.xml')||files.has('signature1.xml')||files.size!==entries.length)throw Error('Public installer input must be unsigned');
  await fs.mkdir(outputDirectory,{recursive:true});
  const filename='Apex-TV.wgt', sha256=crypto.createHash('sha256').update(archive).digest('hex');
  await fs.writeFile(path.join(outputDirectory,filename),archive);
  await fs.writeFile(path.join(outputDirectory,'SHA256SUMS'),sha256+'  '+filename+'\n');
  return {filename,sha256,bytes:archive.length,entries:files.size,revision:metadata.revision,unsigned:true};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildTV()));
