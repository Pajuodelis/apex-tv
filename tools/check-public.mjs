import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const denied=/^(?:node_modules|dist|\.git|resources|locales)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|config\.json|profiles\.xml|tv-key\.txt|f1-session[^/]*|[^/]+\.(?:p12|pfx|pem|key|pri|pwd|encrypted))$/i;
const skip=new Set(['.git','node_modules','dist']);
const contents=[
  /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{60,}/,
  /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}/,
  /C:\\Users\\[^\\\r\n]+\\(?:Documents|AppData|Desktop)/i,
];
let count=0;
async function walk(directory) {
  for(const item of await fs.readdir(directory,{withFileTypes:true})) {
    if(item.isDirectory()){if(!skip.has(item.name))await walk(path.join(directory,item.name));continue;}
    const file=path.join(directory,item.name),relative=path.relative(root,file).replaceAll('\\','/');
    if(denied.test(relative))throw Error('Private or runtime file in source: '+relative);
    if(/\.(?:png|jpg|gif|ico)$/.test(relative))continue;
    let body=await fs.readFile(file,'utf8');
    if(relative==='companion/drm-tests.mjs') {
      // These two exact public Axinom demo tokens match Shaka's maintained demo catalogue.
      const publicFixtures=new Set(['57de63420d0747d03e136c9d723863db275941857f93ee33a5f657ceb4393eb6','69a6a5907da7e0a95bb590131d41cf22810628b2ada20a1bb54a80a0f0b00e1f']);
      body=body.replace(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,value=>{
        const digest=crypto.createHash('sha256').update(value).digest('hex');
        if(!publicFixtures.has(digest))throw Error('Unrecognized token in demo fixture');
        return '[public Shaka/Axinom demo fixture]';
      });
    }
    if(contents.some(pattern=>pattern.test(body)))throw Error('Private material found: '+relative);
    count++;
  }
}
await walk(root);
const ctx={window:{}};vm.runInNewContext(await fs.readFile(path.join(root,'tv/connection.js'),'utf8'),ctx);
const config=ctx.window.APEX_CONFIG;
if(config.server||config.pairingKey||config.publicKey?.d||!config.publicKey?.n)throw Error('Invalid public bootstrap configuration');
console.log('Public source check passed ('+count+' text files; no personal TV pairing).');
