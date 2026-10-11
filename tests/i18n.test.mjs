import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DOMParser } from '@xmldom/xmldom';

const source=fs.readFileSync(new URL('../web/i18n.js',import.meta.url),'utf8');
function load({saved,boot='en',document,brokenStorage=false}={}){
  const values=new Map(saved===undefined?[]:[['apex-ui-language',saved]]);
  const window={APEX_CONFIG:{uiLanguage:boot},document,localStorage:{
    getItem:key=>{if(brokenStorage)throw Error('unavailable');return values.get(key)||null;},
    setItem:(key,value)=>{if(brokenStorage)throw Error('unavailable');values.set(key,value);}
  }};
  vm.runInNewContext(source,{window,WeakMap,Intl});
  return {api:window.ApexI18n,values};
}
test('every interface phrase translates literally, including punctuation and regex characters',()=>{
  const {api}=load();
  assert.ok(Object.keys(api.english).length>=400);
  for(const [original,english] of Object.entries(api.english))assert.equal(api.text(original),english,original);
  assert.equal(api.text('F1 užklausa atmesta (HTTP 403).'),'F1 request rejected (HTTP 403).');
  assert.equal(api.text('  Nustatymai  '),'  Settings  ');
  assert.equal(api.text('Singapore — Max Verstappen'),'Singapore — Max Verstappen');
  assert.equal(api.text('xNustatymaix'),'xNustatymaix');
});
test('language preference persists and overrides defaults, with safe storage failure',()=>{
  const first=load();assert.equal(first.api.language(),'en');assert.equal(first.api.locale(),'en-GB');
  first.api.setLanguage('lt');assert.equal(first.values.get('apex-ui-language'),'lt');
  assert.equal(first.api.text('Nustatymai'),'Nustatymai');
  assert.equal(load({saved:'lt'}).api.language(),'lt');
  assert.equal(load({saved:'en',boot:'lt'}).api.language(),'en');
  assert.equal(load({saved:'invalid'}).api.language(),'en');
  assert.equal(load({brokenStorage:true}).api.setLanguage('lt'),'lt');
  assert.throws(()=>first.api.setLanguage('fr'),/Unsupported/);
});
test('switching language preserves elements, source text, focus targets and entered credentials',()=>{
  const document=new DOMParser().parseFromString('<html><body><button id="target" aria-label="Nustatymai"><b>Kalba</b> · Nustatymai</button><input id="secret" value="Mano slaptažodis" placeholder="Slaptažodis"/><script>var title="Nustatymai";</script><style>.Nustatymai{color:red}</style><textarea>Nustatymai</textarea></body></html>','text/html');
  document.body=document.getElementsByTagName('body')[0];
  const button=document.getElementById('target'),bold=button.firstChild,input=document.getElementById('secret');
  const {api}=load({document});api.localize(document.body);
  assert.equal(button.textContent,'Language · Settings');assert.equal(button.getAttribute('aria-label'),'Settings');
  assert.equal(input.getAttribute('value'),'Mano slaptažodis');
  assert.equal(input.getAttribute('placeholder'),'Password');
  assert.equal(document.getElementsByTagName('script')[0].textContent,'var title="Nustatymai";');
  assert.equal(document.getElementsByTagName('textarea')[0].textContent,'Nustatymai');
  api.setLanguage('lt');assert.equal(button.textContent,'Kalba · Nustatymai');
  assert.equal(button.firstChild,bold);assert.equal(button.getAttribute('aria-label'),'Nustatymai');
  assert.equal(document.documentElement.getAttribute('lang'),'lt');
  api.setLanguage('en');assert.equal(button.textContent,'Language · Settings');
});
test('unchanged player labels require zero additional DOM writes',()=>{
  const {api}=load();let writes=0,value='';const label={childNodes:[],get textContent(){return value;},set textContent(next){writes++;value=next;}};
  api.setText(label,'Ruošiamas vaizdas…');const initialWrites=writes;
  for(let i=0;i<120;i++)api.setText(label,'Ruošiamas vaizdas…');
  assert.equal(writes,initialWrites);assert.equal(value,api.english['Ruošiamas vaizdas…']);
});
