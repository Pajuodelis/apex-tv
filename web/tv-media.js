/* TV-local encrypted DASH adapter. Only public ISO-BMFF timing and the guarded
   constant-IV AAC sample count are adjusted. Account/CDM messages stay direct. */
(function (global) {
'use strict';
var attr=function(text,name){var m=text.match(new RegExp('\\b'+name+'\\s*=\\s*(["\\x27])([^"\\x27]*)\\1'));return m?m[2]:'';};
var decode=function(value){return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');};
var escape=function(value){return value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');};
var replaceAttr=function(text,name,value){return text.replace(new RegExp('(\\b'+name+'\\s*=\\s*)(["\\x27])[^"\\x27]*\\2'),function(_m,p){return p+'"'+escape(value)+'"';});};
function integer(value){if(!/^\d{1,20}$/.test(String(value)))throw Error('Netinkama medijos laiko žyma.');return BigInt(value);}
function buildLegacy(stream,base) {
  var original=stream.manifestXML, zero=BigInt(0), local=new URL(base), source=new URL(stream.manifestUrl);
  if(typeof original!=='string'||original.length>2097152||/<!DOCTYPE|<!ENTITY|<BaseURL[\s>]/i.test(original))throw Error('Šio F1 aprašo TV perdavimas nepalaikomas.');
  if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||!/^\/[a-f0-9]{32}$/.test(local.pathname))throw Error('Netinkamas vietinis TV ryšys.');
  var tag=original.match(/<MPD\b[^>]*>/), live=tag&&attr(tag[0],'type')==='dynamic';
  if(!tag||(!live&&attr(tag[0],'type')!=='static')||(original.match(/<Period\b/g)||[]).length!==1)throw Error('Šis F1 DASH aprašas nesuderinamas.');
  var sets=[], m, setsPattern=/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g;
  while((m=setsPattern.exec(original))) {
    var text=m[0], head=text.match(/<AdaptationSet\b[^>]*>/)[0], reps=[],r,repPattern=/<Representation\b[^>]*(?:\/>|>[\s\S]*?<\/Representation>)/g;
    while((r=repPattern.exec(text)))reps.push({text:r[0],tag:r[0].match(/<Representation\b[^>]*>/)[0]});
    if(/schemeIdUri\s*=\s*["'][^"']*trickmode/i.test(text))continue;
    sets.push({text:text,tag:head,reps:reps,type:attr(head,'contentType'),lang:attr(head,'lang')});
  }
  function codec(set,rep){return attr(rep.tag,'codecs')||attr(set.tag,'codecs');}
  if(!global.ApexVideoQuality)throw Error('Vaizdo kokybės modulis neįkeltas.');
  var selection=global.ApexVideoQuality.select(sets,stream.videoQuality),video=selection&&selection.set;
  var audios=sets.filter(function(s){return s.reps.some(function(r){return /^mp4a\.40\.2$/.test(codec(s,r));});});
  if(stream.audioTrackId&&!global.ApexViewOptions)throw Error('Garso pasirinkimo modulis neįkeltas.');
  var audio=stream.audioTrackId&&global.ApexViewOptions?audios.filter(function(s){return global.ApexViewOptions.audioId(s.text)===stream.audioTrackId;})[0]:audios.filter(function(s){return /^(eng|en)$/i.test(s.lang);})[0]||audios[0];
  if(stream.audioTrackId&&!audio)throw Error('F1 nepateikė pasirinkto garso takelio.');
  if(!video||!audio)throw Error('F1 nepateikė TV tinkamų AVC ir AAC takelių.');
  var slots=[], summaries=[];
  function adapt(set,type) {
    var text=set.text, allowed=new Map();
    var preferred=type==='video'?selection.rep:null;
    set.reps.forEach(function(r){
      var keep=type==='video'?r===preferred:/^mp4a\.40\.2$/.test(codec(set,r));if(!keep){text=text.replace(r.text,'');return;}
      var id=attr(r.tag,'id'),bandwidth=attr(r.tag,'bandwidth');if(!/^[A-Za-z0-9_.-]{1,128}$/.test(id)||!/^\d{1,12}$/.test(bandwidth))throw Error('Neatpažintas F1 takelio numeris.');allowed.set(id,{id:id,bandwidth:bandwidth});
    });
    if(!allowed.size)throw Error('F1 nepateikė TV tinkamo vaizdo takelio.');
    text=text.replace(/<SegmentTemplate\b[^>]*(?:\/>|>[\s\S]*?<\/SegmentTemplate>)/g,function(template){
      var head=template.match(/<SegmentTemplate\b[^>]*>/)[0],scale=integer(attr(head,'timescale')||'1'),offset=live?zero:integer(attr(head,'presentationTimeOffset')||'0');
      var originalStart=integer(attr(head,'startNumber')||'1'),numberShift=!live&&originalStart>BigInt(1000000)&&/\$Number/.test(attr(head,'media'))?originalStart-BigInt(1):zero,result=template;
      ['initialization','media'].forEach(function(kind){var value=attr(head,kind);if(!value)throw Error('Nepilnas F1 segmentų aprašas.');var index=slots.length,query=[];if(value.indexOf('$Time')>=0)query.push('t=$Time$');if(value.indexOf('$Number')>=0)query.push('n=$Number$');
        var path=base+'/s'+index+'/$RepresentationID$.mp4'+(query.length?'?'+query.join('&'):'');
        slots.push({type:type,kind:kind,value:decode(value),base:source.href,host:source.hostname,allowed:allowed,offset:offset,timescale:scale,numberShift:numberShift,sequenceShift:numberShift?originalStart:zero});result=replaceAttr(result,kind,path);
      });
      if(numberShift)result=replaceAttr(result,'startNumber','1');
      if(offset){result=replaceAttr(result,'presentationTimeOffset','0');result=result.replace(/<S\b[^>]*>/g,function(segment){var t=attr(segment,'t');if(!t)return segment;var normalized=integer(t)-offset;if(normalized<zero)throw Error('Neatpažinta F1 segmento pradžia.');return replaceAttr(segment,'t',String(normalized));});}
      return result;
    });
    if(!/<SegmentTemplate\b/.test(text))throw Error('F1 segmentavimas nesuderinamas.');summaries.push({type:type,representations:allowed.size,language:set.lang});return text;
  }
  var selected=new Map([[video.text,adapt(video,'video')],[audio.text,adapt(audio,'audio')]]);
  var mpd=original.replace(setsPattern,function(text){return selected.get(text)||'';});
  return {mpd:mpd,slots:slots,summaries:summaries,video:selection.metadata,live:live};
}
function build(stream,base) {
  var xml=stream.manifestXML;
  // Static highlights can inherit timing at AdaptationSet level while each
  // Representation supplies media/initialization. Merge scopes before rewriting.
  var inherited=typeof xml==='string'&&((xml.match(/<SegmentTemplate\b[^>]*>/g)||[]).some(function(tag){return !attr(tag,'initialization')||!attr(tag,'media');})||/<SegmentTemplate\b/.test(xml.replace(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g,'')));
  if(typeof xml==='string'&&(inherited||/<MPD\b[^>]*\btype\s*=\s*["']dynamic["']|<BaseURL[\s>]/i.test(xml)||(xml.match(/<Period\b/g)||[]).length>1)){
    if(!global.ApexDashManifest)throw Error('TV gyvo DASH aprašo modulis neįkeltas.');
    return global.ApexDashManifest.build(stream,base);
  }
  return buildLegacy(stream,base);
}
function resolveAsset(relay,index,id,params) {
  var slot=relay.slots[index],rep=slot&&slot.allowed.get(id);if(!slot||!rep)throw Object.assign(Error('TV medijos failas nerastas.'),{status:404});
  params.forEach(function(value,key){if(['t','n'].indexOf(key)<0||params.getAll(key).length!==1)throw Error('Netinkama medijos užklausa.');});
  var values={RepresentationID:id,Bandwidth:rep.bandwidth};if(slot.value.indexOf('$Time')>=0)values.Time=String(integer(params.get('t'))+slot.offset);if(slot.value.indexOf('$Number')>=0)values.Number=String(integer(params.get('n'))+slot.numberShift);
  var template=slot.value.replace(/\$\$/g,'__APEX_LITERAL_DOLLAR__').replace(/\$(RepresentationID|Bandwidth|Time|Number)(?:%0(\d{1,2})d)?\$/g,function(_m,name,pad){var value=values[name];if(value===undefined||(pad&&(Number(pad)>20||name==='RepresentationID')))throw Error('Netinkamas F1 segmento parametras.');return pad?value.padStart(Number(pad),'0'):value;}).replace(/__APEX_LITERAL_DOLLAR__/g,'$');
  if(/\$(RepresentationID|Bandwidth|Time|Number)/.test(template))throw Error('Neatpažintas F1 segmento adresas.');var url=new URL(template,slot.base);if(url.protocol!=='https:'||url.hostname!==slot.host||url.username||url.password)throw Error('F1 segmentas pakeitė medijos serverį.');return {url:url.href,slot:slot,key:index+'/'+id+'/'+(params.get('t')||'')+'/'+(params.get('n')||'')};
}
function rebase(input,slot) {
  var zero=BigInt(0);if(slot.kind==='initialization'||(slot.offset===zero&&!slot.sequenceShift))return input;
  var bytes=new Uint8Array(input).slice(),view=new DataView(bytes.buffer);
  function read64(at){return BigInt(view.getUint32(at))*BigInt(4294967296)+BigInt(view.getUint32(at+4));}
  function write64(at,value){view.setUint32(at,Number(value/BigInt(4294967296)));view.setUint32(at+4,Number(value%BigInt(4294967296)));}
  function boxes(start,end,depth){for(var at=start;at<end;){if(end-at<8)throw Error('Nebaigtas F1 MP4 blokas.');var size=view.getUint32(at),header=8,type=String.fromCharCode.apply(null,bytes.subarray(at+4,at+8));if(size===1){if(end-at<16)throw Error('Nebaigtas MP4 dydis.');var extended=read64(at+8);if(extended>BigInt(end-at))throw Error('Netinkamas MP4 dydis.');size=Number(extended);header=16;}if(size===0)size=end-at;if(size<header||size>end-at)throw Error('Netinkamas F1 MP4 dydis.');
    if((type==='moof'||type==='traf')&&depth<2)boxes(at+header,at+size,depth+1);
    if(type==='mfhd'&&depth===1&&slot.sequenceShift){var sf=at+header+4;if(sf+4>at+size)throw Error('Netinkamas fragmento numeris.');var sequence=BigInt(view.getUint32(sf))-slot.sequenceShift;if(sequence<BigInt(1)||sequence>BigInt(4294967295))throw Error('F1 fragmento numeris nesutampa su aprašu.');view.setUint32(sf,Number(sequence));}
    if(type==='tfdt'&&depth===2){var version=bytes[at+header],field=at+header+4,length=version===1?8:4;if((version!==0&&version!==1)||field+length>at+size)throw Error('Netinkama F1 MP4 laiko žyma.');var value=version===1?read64(field):BigInt(view.getUint32(field));if(value<slot.offset)throw Error('F1 laiko žyma nesutampa su aprašu.');var normalized=value-slot.offset;if(version===1)write64(field,normalized);else view.setUint32(field,Number(normalized));}
    if(type==='sidx'){var sv=bytes[at+header],scaleField=at+header+8,tf=at+header+12,sz=sv===1?8:4;if((sv!==0&&sv!==1)||tf+sz>at+size)throw Error('Netinkamas F1 MP4 indeksas.');var scale=BigInt(view.getUint32(scaleField)),shift=slot.offset*scale/slot.timescale,earliest=sv===1?read64(tf):BigInt(view.getUint32(tf));if(earliest>=shift){if(sv===1)write64(tf,earliest-shift);else view.setUint32(tf,Number(earliest-shift));}}
    at+=size;
  }}boxes(0,bytes.length,0);return bytes.buffer;
}
async function readBody(response,max) {
  if(Number(response.headers.get('content-length')||0)>max)throw Error('F1 medijos fragmentas per didelis.');
  if(!response.body||!response.body.getReader){var body=await response.arrayBuffer();if(body.byteLength>max)throw Error('F1 medijos fragmentas per didelis.');return body;}
  var reader=response.body.getReader(),chunks=[],length=0;
  try {for(;;){var next=await reader.read();if(next.done)break;length+=next.value.length;if(length>max){await reader.cancel();throw Error('F1 medijos fragmentas per didelis.');}chunks.push(next.value);}}finally{reader.releaseLock();}
  var bytes=new Uint8Array(length),at=0;chunks.forEach(function(c){bytes.set(c,at);at+=c.length;});return bytes.buffer;
}
async function start(stream,client,diagnostic) {
  var relay,server,stopped=false,cache=new Map(),cached=0,inflight=new Map(),descriptors=new Map(),refreshed=Date.now(),refreshing=null,generation=0,history=new Map();
  var counts={mpd:0,refresh:0,generations:1,periods:0,init:0,media:0,audioFixed:0,transfer:null},transfers=[];
  function identity(r){return r.slots.map(function(s){return [s.period||'',s.type,s.kind,s.value,s.base,s.codec||'',s.protection||'',String(s.offset),String(s.numberShift),Array.from(s.allowed).map(function(v){return v[0]+':'+v[1].bandwidth;}).join(',')].join('|');}).join(';');}
  function prune(){history.forEach(function(value,key){if(key!==generation&&(Date.now()-value.at>300000||history.size>16)){history.delete(key);var prefix='g'+key+'/';descriptors.forEach(function(_v,k){if(k.indexOf(prefix)===0)descriptors.delete(k);});cache.forEach(function(v,k){if(k.indexOf(prefix)===0){cached-=v.byteLength;cache.delete(k);}});}});}
  async function refresh() {
    if(!relay.live||Date.now()-refreshed<1000)return;
    if(!refreshing)refreshing=client.mediaManifest(stream.manifestUrl).then(async function(found){
      var xml=await found.response.text();if(stopped)throw Error('TV vaizdo sesija baigta.');
      var updated=Object.assign({},stream,{manifestXML:xml,manifestUrl:found.url,relayGeneration:generation});
      var next=build(updated,server.url);
      if(identity(next)!==identity(relay)){generation++;next=build(Object.assign({},updated,{relayGeneration:generation}),server.url);counts.generations++;diagnostic('tv_live_period_changed',{engine:'periods='+(next.periods||[]).length+'; generation='+generation+'; licensed encrypted payload unchanged'});}
      relay=next;history.set(generation,{relay:relay,at:Date.now()});prune();refreshed=Date.now();counts.refresh++;counts.periods=(relay.periods||[]).length;
      if(counts.refresh===1||counts.refresh%30===0)diagnostic('tv_live_manifest_refreshed',{engine:'refresh='+counts.refresh+'; periods='+counts.periods+'; no PC media relay'});
    }).finally(function(){refreshing=null;});return refreshing;
  }
  server=await global.ApexNativeRelay.open(async function(path){
    if(stopped)throw Error('TV vaizdo sesija baigta.');
    var url=new URL(path,'http://127.0.0.1');
    if(url.pathname==='/manifest.mpd'){await refresh();counts.mpd++;return {bytes:new TextEncoder().encode(relay.mpd),contentType:'application/dash+xml'};}
    var match=url.pathname.match(/^(?:\/g(\d{1,8}))?\/s(\d{1,3})\/([A-Za-z0-9_.-]{1,128})\.mp4$/);if(!match)throw Object.assign(Error('TV medijos failas nerastas.'),{status:404});
    var version=match[1]===undefined?0:Number(match[1]),saved=history.get(version);if(!saved)throw Object.assign(Error('TV srauto aprašo versija pasibaigė.'),{status:410});
    var asset=resolveAsset(saved.relay,Number(match[2]),match[3],url.searchParams),key='g'+version+'/'+asset.key,stored=cache.get(key);
    if(stored){cache.delete(key);cache.set(key,stored);return {bytes:stored,contentType:'video/mp4'};}
    if(!inflight.has(key))inflight.set(key,(async function(){
      var transferAt=Date.now();var found=await client.mediaManifest(asset.url,'video/mp4, audio/mp4, application/octet-stream');
      if(new URL(found.url).hostname!==asset.slot.host)throw Error('F1 segmentas pakeitė medijos serverį.');
      var body=await readBody(found.response,32*1024*1024);
      if(asset.slot.type==='video'&&asset.slot.kind!=='initialization'&&body.byteLength>=32768){transfers.push({bytes:body.byteLength,ms:Math.max(1,Date.now()-transferAt)});transfers=transfers.slice(-8);var total=transfers.reduce(function(a,v){return{bytes:a.bytes+v.bytes,ms:a.ms+v.ms};},{bytes:0,ms:0});counts.transfer={bps:total.bytes*8000/total.ms,samples:transfers.length,at:Date.now()};}
      var bytes=rebase(body,asset.slot),descriptorKey='g'+version+'/'+(asset.slot.descriptorKey||'audio/'+match[3]);
      if(asset.slot.type==='audio'&&global.ApexCbcsAudio){
        if(asset.slot.kind==='initialization')descriptors.set(descriptorKey,global.ApexCbcsAudio.readDescriptor(bytes));
        else {var fixed=global.ApexCbcsAudio.repair(bytes,descriptors.get(descriptorKey));bytes=fixed.bytes;if(fixed.changed){counts.audioFixed+=fixed.changed;if(counts.audioFixed===1)diagnostic('tv_local_audio_compatibility',{engine:'AAC sample count corrected inside TV; encrypted payload unchanged'});}}
      }
      counts[asset.slot.kind==='initialization'?'init':'media']++;
      if(counts.media===2)diagnostic('tv_local_media_ready',{engine:'HTTPS F1 -> TV loopback -> AVPlay; PC media relay unused'});
      if(stopped)throw Error('TV vaizdo sesija baigta.');
      var retained=new Uint8Array(bytes);cache.set(key,retained);cached+=retained.byteLength;
      while(cached>48*1024*1024&&cache.size>2){var first=cache.keys().next().value;cached-=cache.get(first).byteLength;cache.delete(first);}return retained;
    })().finally(function(){inflight.delete(key);}));
    return {bytes:await inflight.get(key),contentType:'video/mp4'};
  },diagnostic);
  try {var initial=build(stream,server.url);relay=initial.live?build(Object.assign({},stream,{relayGeneration:0}),server.url):initial;history.set(0,{relay:relay,at:Date.now()});}catch(e){server.stop();throw e;}
  counts.periods=(relay.periods||[]).length;
  diagnostic('tv_local_relay_ready',{engine:'TV worker + AVPlay; '+(relay.live?'live':'VOD')+'; tracks='+relay.summaries.length+'; no PC media relay'});
  diagnostic('video_quality_selected',{engine:global.ApexVideoQuality.label(relay.video)+'; '+relay.video.codec});
  return {url:server.url+'/manifest.mpd',video:relay.video,live:relay.live,stats:counts,stop:function(){stopped=true;server.stop();cache.clear();descriptors.clear();history.clear();}};
}
global.ApexTVMedia={build:build,resolveAsset:resolveAsset,rebase:rebase,start:start};
}(typeof window!=='undefined'?window:globalThis));
