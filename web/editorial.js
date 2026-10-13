/* F1 editorial catalogue. Public metadata only; playback and DRM are unchanged. */
(function(root,factory){var api=factory(typeof module==='object'&&module.exports?require('./discovery.js'):root.ApexDiscovery);if(typeof module==='object'&&module.exports)module.exports=api;else root.ApexEditorial=api;}(typeof window!=='undefined'?window:globalThis,function(D){
  'use strict';
  var ORIGIN='https://f1tv.formula1.com',TTL=600000,LIMIT=240;
  var GROUPS=[
    {id:'highlights',lt:'Apžvalgos',en:'Highlights',descriptionLt:'Lenktynių, kvalifikacijos, sprinto ir treniruočių svarbiausi momentai.',descriptionEn:'Race, qualifying, sprint and practice highlights.',query:'Highlights'},
    {id:'race30',lt:'Race in 30',en:'Race in 30',descriptionLt:'Lenktynės per maždaug 30 minučių.',descriptionEn:'The race in around 30 minutes.',query:'Race in 30'},
    {id:'shows',lt:'Laidos',en:'Shows',descriptionLt:'Tech Talk, analizė, pokalbiai ir laidos prieš sesijas bei po jų.',descriptionEn:'Tech Talk, analysis, interviews and pre/post-session shows.',page:'410'},
    {id:'documentaries',lt:'Dokumentika',en:'Documentaries',descriptionLt:'F1 istorijos, dokumentiniai filmai ir serialai.',descriptionEn:'F1 stories, documentary films and series.',page:'413'}
  ];
  function clean(v,n){return String(v||'').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,n||240);}
  function group(id){return GROUPS.filter(function(g){return g.id===id;})[0]||null;}
  function classify(raw){var name=clean(raw&&raw.title).toLowerCase();if(name.normalize)name=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(/\brace\s+in\s+30\b/.test(name))return 'race30';
    if(/\bhighlights?\b|svarbiausi|apzvalg/.test(name))return 'highlights';
    if(/(?:pre|post)[- ](?:race|sprint|qualifying)\s+show|tech\s*talk|jolyon palmer|cooldown|weekend (?:warm.?up|wrapped)|radio rewind|best of team radio|off the grid|lap of luxury/.test(name))return 'shows';
    if(/documentar|chasing the dream|beyond all limits|inside story|f1 icons|greatest comebacks/.test(name))return 'documentaries';return '';
  }
  function safe(raw){if(!raw||!/^\d{1,12}$/.test(String(raw.id))||!clean(raw.title))return null;var value={id:String(raw.id),title:clean(raw.title),kind:['page','detail','video'].indexOf(raw.kind)>=0?raw.kind:'video',duration:Math.max(0,Math.min(604800,Number(raw.duration)||0)),live:raw.live===true,locked:raw.locked===true,image:D.picture(raw.image),subtitle:clean(raw.subtitle,180),location:clean(raw.location,100),series:clean(raw.series,40)};['start','end','meetingStart','meetingEnd'].forEach(function(k){value[k]=D.date(raw[k]);});return value;}
  // Series rails sometimes shorten every episode title to the GP name. Keep the
  // service's full content title so flattened pre/post-session shows are distinct.
  function normalize(data){var values=D.normalize(data,{limit:LIMIT}),titles={},visited=0;
    function walk(n,depth){if(!n||typeof n!=='object'||depth>14||visited++>6000)return;if(Array.isArray(n)){n.slice(0,500).forEach(function(v){walk(v,depth+1);});return;}var m=n.metadata||{};if(/^\d{1,12}$/.test(String(m.contentId))&&clean(m.title))titles[String(m.contentId)]=clean(m.title);['containers','items','resultObj','retrieveItems','events'].forEach(function(k){walk(n[k],depth+1);});}
    walk(data,0);return values.map(function(v){var value=safe(v);if(value&&value.kind==='video'&&titles[value.id])value.title=titles[value.id];return value;}).filter(Boolean);
  }
  function merge(lists,kind,now){var seen={},out=[];now=now||Date.now();lists.forEach(function(list){(Array.isArray(list)?list:[]).slice(0,LIMIT).forEach(function(raw){var v=safe(raw);if(!v||v.live||v.locked||v.kind==='video'&&v.start>now)return;if(kind==='highlights'||kind==='race30'){if(v.kind!=='video'||classify(v)!==kind)return;}var key=v.kind+':'+v.id;if(seen[key])return;seen[key]=true;out.push(v);});});
    return out.map(function(v,i){return{value:v,index:i};}).sort(function(a,b){var av=a.value,bv=b.value;if(av.kind==='video'&&bv.kind!=='video')return 1;if(av.kind!=='video'&&bv.kind==='video')return -1;if(av.kind==='video'&&bv.kind==='video'){var byDate=(bv.start||0)-(av.start||0);if(byDate)return byDate;}return a.index-b.index;}).slice(0,LIMIT).map(function(e){return e.value;});
  }
  function recentMeetings(items,now){return items.map(safe).filter(function(v){return v&&v.kind!=='video'&&v.meetingStart&&v.meetingStart<=now&&(!v.series||/formula\s*1|^f1$/i.test(v.series));}).sort(function(a,b){return b.meetingStart-a.meetingStart;}).slice(0,2);}
  function create(client,clock){clock=clock||Date.now;var cached={},pending={},recentCache=null,recentPending=null,epoch=0,active=0,queue=[];
    function copy(v){return JSON.parse(JSON.stringify(v));}
    function pump(){while(active<2&&queue.length){var task=queue.shift();active++;(function(t){Promise.resolve().then(t.run).then(t.resolve,t.reject).then(function(){active--;pump();});})(task);}}
    function enqueue(run){return new Promise(function(resolve,reject){queue.push({run:run,resolve:resolve,reject:reject});pump();});}
    function changed(generation){if(generation!==epoch)throw Object.assign(Error('F1 katalogas pasikeitė. Bandyk dar kartą.'),{status:409});}
    function read(id,detail){return enqueue(async function(){var ctx=await client.context(true),route=detail?'/4.0/'+ctx.login+'/ENG/WEB_DASH/ALL/CONTENT/VIDEO/'+id+'/'+ctx.tail:'/2.0/'+ctx.login+'/ENG/WEB_DASH/ALL/PAGE/'+id+'/'+ctx.tail;return normalize(await client.json(ORIGIN+route,client.headers())).filter(function(v){return v.kind!=='page'||v.id!==String(id);});});}
    function search(q){return enqueue(async function(){var ctx=await client.context(true);return normalize(await client.json(ORIGIN+'/2.0/'+ctx.login+'/ENG/WEB_DASH/ALL/PAGE/5234/'+ctx.tail+'?search='+encodeURIComponent(q),client.headers()));});}
    async function recent(force){var now=clock(),generation=epoch;if(!force&&recentCache&&now-recentCache.at<TTL)return copy(recentCache);if(recentPending)return recentPending;
      var promise=(async function(){var seasons=await enqueue(function(){return client.page('493');});changed(generation);var season=seasons.filter(function(v){return v.kind==='page'&&/\b(?:19|20)\d{2}\b/.test(v.title);}).sort(function(a,b){return Number((b.title.match(/(?:19|20)\d{2}/)||['0'])[0])-Number((a.title.match(/(?:19|20)\d{2}/)||['0'])[0]);})[0];if(!season)throw Error('F1 nepateikė naujausio sezono.');var meetings=recentMeetings(await read(season.id),now);changed(generation);if(!meetings.length)throw Error('F1 nepateikė įvykusių GP datų.');
        var pages=await collect(meetings.map(function(meeting){return async function(){var values=await read(meeting.id,meeting.kind==='detail');return values.map(function(raw){var v=safe(raw),location=meeting.location||clean(meeting.subtitle)||clean(meeting.title);if(!v)return null;if(v.kind==='video'&&classify(v)){if(!v.location)v.location=location;if(/^(?:(?:race|qualifying|sprint(?: qualifying)?|practice\s*\d+)\s+highlights|race\s+in\s+30)$/i.test(v.title)&&location)v.title=clean(v.title+' · '+location);}return v;}).filter(Boolean);};}));changed(generation);var value={items:pages.values.reduce(function(all,v){return all.concat(v);},[]),partial:pages.partial,at:now};if(!value.partial)recentCache=value;return copy(value);
      }());recentPending=promise;try{return await promise;}finally{if(recentPending===promise)recentPending=null;}
    }
    async function collect(tasks){var results=await Promise.all(tasks.map(function(run){return Promise.resolve().then(run).then(function(value){return{value:Array.isArray(value)?{items:value,partial:false}:value};},function(error){return{error:error};});}));var failures=results.filter(function(r){return r.error;}),success=results.filter(function(r){return r.value;});var access=failures.filter(function(r){return r.error.status===401||r.error.status===403;})[0];if(access)throw access.error;if(!success.length)throw failures[0].error;return{values:success.map(function(r){return r.value.items;}),partial:failures.length>0||success.some(function(r){return r.value.partial;})};}
    async function load(id,options){var selected=group(id);if(!selected)throw Object.assign(Error('Nežinoma F1 katalogo skiltis.'),{status:400});await client.context(true);var now=clock(),generation=epoch,force=options&&options.force;if(!force&&cached[id]&&now-cached[id].at<TTL)return copy(cached[id]);if(pending[id])return pending[id];
      var promise=(async function(){var tasks=[];if(selected.page)tasks.push(function(){return read(selected.page);});else tasks.push(function(){return search(selected.query);});if(id!=='documentaries')tasks.unshift(async function(){var values=await recent(force);return{items:id==='shows'?values.items.filter(function(v){return classify(v)==='shows';}):values.items,partial:values.partial};});var result=await collect(tasks);changed(generation);var value={group:id,items:merge(result.values,id,now),at:now,partial:result.partial,selection:true};if(!value.partial)cached[id]=value;return copy(value);}());pending[id]=promise;try{return await promise;}finally{if(pending[id]===promise)pending[id]=null;}
    }
    return{load:load,clear:function(){epoch++;cached={};pending={};recentCache=null;recentPending=null;}};
  }
  return{groups:GROUPS,group:group,classify:classify,normalize:normalize,merge:merge,recentMeetings:recentMeetings,create:create,TTL:TTL,LIMIT:LIMIT};
}));
