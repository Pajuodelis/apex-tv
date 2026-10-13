import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import Editorial from '../web/editorial.js';import UX from '../web/experience.js';
const NOW=Date.UTC(2026,9,13,12),DAY=86400000;
function video(id,title,start=NOW-DAY,extra={}){return{metadata:{contentId:String(id),title,duration:600,emfAttributes:{sessionStartDate:start,Series:'Formula 1'},...extra}};}
function meeting(id,title,start,series='Formula 1'){return{metadata:{title,emfAttributes:{Series:series,Meeting_Start_Date:start,Meeting_End_Date:start+DAY,Circuit_Short_Name:title}},actions:[{key:'onClick',uri:'/PAGE/'+id+'/PRO/2'}]};}
function fixture(options={}){
 let active=0,peak=0;const calls=[],contexts=[];
 const raw={
  '2026':{items:[meeting('5001','Singapore',NOW-DAY*3),meeting('5002','Monaco',NOW-DAY*10),meeting('5003','Next GP',NOW+DAY),meeting('5004','Support series',NOW-DAY,'Formula 2')]},
  '5001':{items:[video('42','Race Highlights'),video('43','Race in 30'),video('44','Post-Race Show - Singapore'),video('45','Main race'),video('46','LIVE Race Highlights',NOW-DAY,{contentSubtype:'LIVE'}),video('47','Locked highlights',NOW-DAY,{locked:true}),video('48','Upcoming highlights',NOW+DAY)]},
  '5002':{items:[video('52','Qualifying Highlights',NOW-DAY*9),video('53','Race in 30 - Monaco',NOW-DAY*9)]},
  '410':{items:[meeting('1299','Tech Talk',0),video('64','TECH TALK: Clever upgrade',0,{subscriptionToken:'DO_NOT_COPY',pictureUrl:'https://evil.example/track?token=secret'})]},
  '413':{items:[meeting('1246','Chasing The Dream',0),video('74','Beyond All Limits',0)]},
  highlights:{items:[video('32','Race Highlights - Older GP',NOW-DAY*60),video('42','Race Highlights - Duplicate',NOW-DAY)]},
  race30:{items:[video('33','Race in 30 - Older GP',NOW-DAY*60)]}
 };
 const client={context:async(required)=>{contexts.push(required);if(options.authError)throw Object.assign(Error('F1 session rejected'),{status:options.authError});return{login:'R',tail:'PRO/2'};},headers:()=>({entitlementtoken:'fixture-secret'}),page:async(id)=>{calls.push('archive:'+id);return[{id:'2026',kind:'page',title:'2026 Season'}];},json:async(url,headers)=>{assert.equal(headers.entitlementtoken,'fixture-secret');const u=new URL(url),match=u.pathname.match(/\/PAGE\/(\d+)\//);const key=match[1]==='5234'?(u.searchParams.get('search')==='Race in 30'?'race30':'highlights'):match[1];calls.push(key);active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setTimeout(resolve,3));if(options.fail===key)throw Object.assign(Error('Service response failed'),{status:options.status||503});return raw[key]||{items:[]};}finally{active--;}}};
 return{client,calls,contexts,raw,peak:()=>peak};
}
test('editorial categories distinguish short races, highlights, pre/post shows and documentary titles',()=>{
 for(const [title,category]of [['Race in 30 - Singapore','race30'],['Qualifying Highlights','highlights'],['Sprint Highlights','highlights'],['Svarbiausi momentai','highlights'],['Tech Talk','shows'],['Pre-Sprint Show - Singapore','shows'],['Post-Qualifying Show','shows'],['Chasing The Dream','documentaries'],['INSIDE STORY: Final lap','documentaries'],['2026 Singapore GP - Qualifying','']])assert.equal(Editorial.classify({title}),category);
 assert.equal(UX.category({title:'Race in 30 - Singapore'}),'race30');assert.equal(Editorial.group('not-a-group'),null);
});
test('flattened shows retain full service content titles and keep only safe metadata',()=>{
 const raw={items:[{uiMetadata:{mainTitle:'Australian Grand Prix'},metadata:{contentId:'42',title:'Pre-Race Show - Australia',subscriptionToken:'DO_NOT_COPY',pictureUrl:'https://evil.example/track?token=secret',emfAttributes:{sessionStartDate:NOW-DAY}}}]};const items=Editorial.normalize(raw);assert.equal(items[0].title,'Pre-Race Show - Australia');assert.equal(items[0].image,'');assert.ok(!JSON.stringify(items).includes('DO_NOT_COPY'));assert.equal(Editorial.normalize({items:Array.from({length:600},(_,i)=>video(i,'Highlights'))}).length,240);
});
test('merging removes duplicates, LIVE, locked and future videos, preserving actual service dates and numeric IDs',()=>{
 const values=[{id:'42',title:'Race Highlights',kind:'video',start:NOW-DAY}, {id:'42',title:'Duplicate highlights',kind:'video'}, {id:'43',title:'LIVE Highlights',live:true}, {id:'44',title:'Locked Highlights',locked:true},{id:'45',title:'Upcoming Highlights',start:NOW+DAY},{id:'../46',title:'Highlights'}, {id:'47',title:'Race in 30'}, {id:'48',title:'Older Highlights',start:NOW-DAY*10}];assert.deepEqual(Editorial.merge([values],'highlights',NOW).map(i=>i.id),['42','48']);assert.ok(Editorial.merge([values],'race30',NOW).every(i=>!i.live));
});
test('recent GP selection excludes upcoming meetings and support series and uses service dates rather than catalogue order',()=>{
 const values=[{id:'1',title:'Older GP',kind:'page',meetingStart:NOW-DAY*40},{id:'2',title:'Next GP',kind:'page',meetingStart:NOW+DAY},{id:'3',title:'Current GP',kind:'detail',meetingStart:NOW-DAY},{id:'4',title:'Support',kind:'page',meetingStart:NOW-DAY,series:'Formula 2'},{id:'5',title:'Previous',kind:'page',meetingStart:NOW-DAY*10}];assert.deepEqual(Editorial.recentMeetings(values,NOW).map(i=>i.id),['3','5']);
});
test('highlights add recent GP videos missing from global search and label generic titles with the meeting',async()=>{
 const f=fixture(),catalogue=Editorial.create(f.client,()=>NOW),data=await catalogue.load('highlights');assert.equal(data.partial,false);assert.equal(data.items[0].id,'42');assert.equal(data.items[0].title,'Race Highlights · Singapore');assert.deepEqual(data.items.map(v=>v.id),['42','52','32']);assert.ok(!f.calls.includes('5003')&&!f.calls.includes('5004'));assert.ok(f.contexts.every(Boolean));assert.ok(!JSON.stringify(data).includes('fixture-secret'));
});
test('Race in 30 and show/documentary collections keep their actual type and useful nested folders',async()=>{
 const f=fixture(),library=Editorial.create(f.client,()=>NOW);const short=await library.load('race30');assert.deepEqual(short.items.map(i=>i.id),['43','53','33']);assert.ok(short.items.every(i=>Editorial.classify(i)==='race30'));const shows=await library.load('shows');assert.equal(shows.items[0].id,'1299');assert.equal(shows.items[0].kind,'page');assert.ok(shows.items.some(i=>i.id==='44'));const docs=await library.load('documentaries');assert.deepEqual(docs.items.map(i=>i.id),['1246','74']);assert.ok(f.calls.includes('410')&&f.calls.includes('413'));
});
test('parallel categories share recent GP requests and cap F1 catalogue concurrency at two',async()=>{
 const f=fixture(),library=Editorial.create(f.client,()=>NOW);await Promise.all(Editorial.groups.map(g=>library.load(g.id)));assert.ok(f.peak()<=2);for(const key of ['archive:493','2026','5001','5002'])assert.equal(f.calls.filter(k=>k===key).length,1);assert.equal(f.calls.filter(k=>k==='highlights').length,1);
});
test('catalogue cache returns copies, deduplicates requests, expires and permits explicit refresh',async()=>{
 let now=NOW;const f=fixture(),library=Editorial.create(f.client,()=>now);const [a,b]=await Promise.all([library.load('documentaries'),library.load('documentaries')]);assert.deepEqual(a,b);assert.equal(f.calls.length,1);a.items[0].title='Changed locally';const cached=await library.load('documentaries');assert.notEqual(cached.items[0].title,'Changed locally');assert.equal(f.calls.length,1);now+=Editorial.TTL+1;await library.load('documentaries');assert.equal(f.calls.length,2);await library.load('documentaries',{force:true});assert.equal(f.calls.length,3);
});
test('a failed recent GP is marked partial and is retried, rather than cached as a complete result',async()=>{
 const f=fixture({fail:'5002'}),library=Editorial.create(f.client,()=>NOW),a=await library.load('highlights');assert.equal(a.partial,true);assert.ok(a.items.some(i=>i.id==='42'));await library.load('highlights');assert.equal(f.calls.filter(k=>k==='5002').length,2);
});
test('search or collection network errors can fall back to recent metadata with an explicit partial result',async()=>{
 for(const group of ['highlights','race30','shows']){const f=fixture({fail:group==='shows'?'410':group}),library=Editorial.create(f.client,()=>NOW),data=await library.load(group);assert.equal(data.partial,true);assert.ok(data.items.length);}
});
test('F1 401 and 403 are preserved even if another catalogue source succeeded',async()=>{
 for(const status of [401,403]){const f=fixture({fail:'highlights',status});await assert.rejects(Editorial.create(f.client,()=>NOW).load('highlights'),e=>e.status===status);}
});
test('invalid groups and unsigned-in accounts do no catalogue requests',async()=>{
 const f=fixture({authError:401}),library=Editorial.create(f.client,()=>NOW);await assert.rejects(library.load('../../account'),e=>e.status===400);assert.equal(f.contexts.length,0);await assert.rejects(library.load('shows'),e=>e.status===401);assert.equal(f.calls.length,0);
});
test('sign-out invalidation prevents an in-flight response from becoming another account cache',async()=>{
 const f=fixture(),library=Editorial.create(f.client,()=>NOW),pending=library.load('documentaries');await new Promise(resolve=>setTimeout(resolve,1));library.clear();await assert.rejects(pending,e=>e.status===409);await library.load('documentaries');assert.equal(f.calls.filter(k=>k==='413').length,2);
});
const ui=await fs.readFile(new URL('../web/tv-app.js',import.meta.url),'utf8');function source(name,next){return ui.slice(ui.indexOf('  function '+name+'('),ui.indexOf('  function '+next+'('));}
test('nested editorial collections use the catalogue route and Back restores category, search, page and focus',()=>{
 const videos=[{id:'74',kind:'video',title:'Beyond All Limits'}],rootView={tab:'editorial',title:'Highlights & shows',editorialGroup:'documentaries',query:'Dream',offset:2,focusKey:'content-page-1246'},seen=[],routes=[],c={current:rootView,stack:[],playing:false,modal:null,searchTimer:0,liveTimer:0,pendingRequest:0,account:{signedIn:true},UX:{item:v=>v},localStore:{recent(){}},cancelRecovery(){},rememberView(){},clearTimeout(){},clearInterval(){},applyPreferences(){},layout:()=>({querySelector:()=>null}),catalogueCache:{get(route){routes.push(route);return{items:videos,at:NOW};}},renderItems(main,items){seen.push(['catalog',items]);},renderEditorial(){seen.push(['editorial',c.current.editorialGroup]);},renderVideoDetails(main,item){seen.push(['video',item.id]);},setFocus(){},updateConnection(){},motion:{enter(){}}};vm.createContext(c);vm.runInContext(source('openItem','itemCard')+source('catalogRoute','refreshLive')+source('render','renderTVAccount')+source('goBack','streamAudioChoices'),c);c.openItem({id:'1246',title:'Chasing The Dream',kind:'page'});assert.equal(routes[0],'/api/catalog?page=1246');c.openItem(videos[0]);assert.deepEqual(seen[1],['video','74']);c.goBack();assert.equal(seen[2][0],'catalog');c.goBack();assert.equal(c.current,rootView);assert.deepEqual(seen[3],['editorial','documentaries']);assert.equal(c.current.offset,2);assert.equal(c.current.query,'Dream');assert.equal(c.current.focusKey,'content-page-1246');
});
test('menu cache shares an in-flight request and ignores responses belonging to a cleared account',async()=>{
 let resolve,count=0;const c={Editorial,editorialCache:{},editorialPending:{},Date,Promise,encodeURIComponent,request:()=>{count++;return new Promise(r=>{resolve=r;});}};vm.createContext(c);vm.runInContext(source('getEditorial','editorialLoading'),c);const a=c.getEditorial('shows'),b=c.getEditorial('shows');assert.equal(a,b);assert.equal(count,1);c.editorialPending={};resolve({items:[],at:NOW});await a;assert.equal(c.editorialCache.shows,undefined);
});

test('standalone TV editorial route runs in the TV client and returns safe collection metadata without any PC relay',async()=>{
 const db={open(){const q={result:{transaction(){return{objectStore(){return{get(){const r={result:undefined};setTimeout(()=>r.onsuccess(),0);return r;}};}};}}};setTimeout(()=>q.onsuccess(),0);return q;}},calls=[],c={window:{APEX_CONTEXT:{revision:'test'}},indexedDB:db,fetch:async()=>{throw Error('Unexpected network');},crypto:(await import('node:crypto')).webcrypto,URL,Promise,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,atob,btoa};vm.createContext(c);
 for(const file of ['discovery.js','editorial.js','f1-browser.js'])vm.runInContext(await fs.readFile(new URL('../web/'+file,import.meta.url),'utf8'),c);const app=c.window.ApexStandalone;app.client.json=async(url)=>{if(url.endsWith('/config'))return{};calls.push(url);return{items:[video('74','Chasing The Dream',0,{subscriptionToken:'DO_NOT_COPY'})]};};await app.initialize();app.client.context=async(required)=>{assert.equal(required,true);return{login:'R',tail:'PRO/2'};};const result=await app.request('/api/editorial?group=documentaries');assert.equal(result.group,'documentaries');assert.equal(result.items[0].id,'74');assert.equal(calls[0],'https://f1tv.formula1.com/2.0/R/ENG/WEB_DASH/ALL/PAGE/413/PRO/2');assert.ok(!JSON.stringify(result).includes('DO_NOT_COPY'));await assert.rejects(app.request('/api/editorial?group=invalid'),e=>e.status===400);assert.equal(calls.length,1);
});
