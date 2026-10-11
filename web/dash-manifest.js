/* Native XML DASH adaptation for TV-local playback. Protection and media payload stay opaque. */
(function(global){
'use strict';
function list(nodes){return Array.prototype.slice.call(nodes||[]);}
function name(node){return node.localName||String(node.nodeName||'').split(':').pop();}
function children(node,kind){return list(node.childNodes).filter(function(n){return n.nodeType===1&&(!kind||name(n)===kind);});}
function get(node,key){return node&&node.getAttribute(key)||'';}
function integer(value){if(!/^\d{1,20}$/.test(String(value)))throw Error('Netinkama medijos laiko žyma.');return BigInt(value);}
function approved(raw,parent){var u;try{u=new URL(raw,parent);}catch(_){throw Error('Netinkamas F1 medijos adresas.');}var host=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!(host==='formula1.com'||host.endsWith('.formula1.com')||host==='f1prodlive.akamaized.net'))throw Error('F1 grąžino neatpažintą medijos serverį.');u.hash='';return u.href;}
function build(stream,base){
 var original=stream.manifestXML,local=new URL(base),zero=BigInt(0),source=approved(stream.manifestUrl);
 if(typeof original!=='string'||original.length>2097152||/<!DOCTYPE|<!ENTITY/i.test(original))throw Error('Netinkamas F1 DASH XML aprašas.');
 if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||!/^\/[a-f0-9]{32}$/.test(local.pathname))throw Error('Netinkamas vietinis TV ryšys.');
 var Parser=global.DOMParser,Serializer=global.XMLSerializer;if(!Parser||!Serializer)throw Error('TV XML aprašo skaitytuvas neprieinamas.');
 var doc;try{doc=new Parser().parseFromString(original,'application/xml');}catch(_){throw Error('Netinkamas F1 DASH XML aprašas.');}
 var root=doc&&doc.documentElement,serializer=new Serializer(),xml=function(n){return serializer.serializeToString(n);};
 if(!root||name(root)!=='MPD'||doc.doctype||list(doc.getElementsByTagName('*')).some(function(n){return name(n)==='parsererror';}))throw Error('Netinkamas F1 DASH XML aprašas.');
 var live=get(root,'type')==='dynamic';if(!live&&get(root,'type')!=='static')throw Error('Neatpažintas F1 DASH srauto tipas.');
 var generation=stream.relayGeneration,route=base;if(generation!==undefined){if(!Number.isSafeInteger(generation)||generation<0)throw Error('Netinkama TV srauto versija.');route+='/g'+generation;}
 function element(kind){return doc.createElementNS(root.namespaceURI||null,kind);}
 function bases(scope,parent){var found=children(scope,'BaseURL');if(!found.length)return parent;var choice=null;found.forEach(function(n){var text=n.textContent.trim(),url;try{url=approved(text,parent.url);}catch(_){return;}if(!choice)choice={url:url,offset:get(n,'availabilityTimeOffset')||parent.offset,complete:get(n,'availabilityTimeComplete')||parent.complete};});if(!choice)throw Error('F1 grąžino neatpažintą medijos serverį.');return choice;}
 function templates(scopes){var merged=element('SegmentTemplate'),has=false,timeline=null;scopes.forEach(function(scope){if(children(scope,'SegmentList').length||children(scope,'SegmentBase').length)throw Error('F1 pateikė nepalaikomą segmentų aprašą.');var nodes=children(scope,'SegmentTemplate');if(nodes.length>1)throw Error('F1 pateikė dviprasmį segmentų aprašą.');if(!nodes.length)return;has=true;var t=nodes[0];list(t.attributes).forEach(function(a){merged.setAttributeNS(a.namespaceURI||null,a.name,a.value);});var time=children(t,'SegmentTimeline');if(time.length>1)throw Error('F1 pateikė dviprasmį laiko aprašą.');if(time.length)timeline=time[0];});if(!has||!get(merged,'initialization')||!get(merged,'media'))throw Error('F1 nepateikė SegmentTemplate aprašo.');if(timeline)merged.appendChild(timeline.cloneNode(true));return merged;}
 function remove(scope,kinds){children(scope).forEach(function(n){if(kinds.indexOf(name(n))>=0)scope.removeChild(n);});}
 var rootBase=bases(root,{url:source,offset:'',complete:''}),periodNodes=children(root,'Period');
 if(!periodNodes.length||periodNodes.length>32)throw Error('Neatpažintas F1 periodų aprašas.');
 var periods=periodNodes.map(function(period,index){if(list(period.attributes).some(function(a){return a.localName==='href';}))throw Error('F1 pateikė išorinį periodo aprašą.');var periodBase=bases(period,rootBase),sets=children(period,'AdaptationSet').map(function(set){var text=xml(set),tag=text.match(/^<[^>]*>/)[0],setBase=bases(set,periodBase);return{node:set,text:text,tag:tag,type:get(set,'contentType'),lang:get(set,'lang'),base:setBase,reps:children(set,'Representation').map(function(rep){var serialized=xml(rep);return{node:rep,text:serialized,tag:serialized.match(/^<[^>]*>/)[0],base:bases(rep,setBase)};})};});return{node:period,key:get(period,'id')||get(period,'start')||String(index),index:index,sets:sets};});
 if(!global.ApexVideoQuality||!global.ApexViewOptions)throw Error('TV takelių pasirinkimo modulis neįkeltas.');
 function codec(set,rep){return get(rep.node,'codecs')||get(set.node,'codecs');}
 var requested=stream.audioTrackId,requestedSet=null;periods.some(function(p){return p.sets.some(function(s){if(requested&&global.ApexViewOptions.audioId(s.text)===requested){requestedSet=s;return true;}return false;});});
 if(requested&&!requestedSet)throw Error('F1 nepateikė pasirinkto garso takelio.');
 var requestedLang=requestedSet&&requestedSet.lang,requestedLabel=requestedSet&&children(requestedSet.node,'Label').map(function(n){return n.textContent;}).join('|');
 var slots=[],summaries=[],selectedVideo=null,periodKeys=new Set();
 periods.forEach(function(period){
  if(periodKeys.has(period.key))throw Error('F1 pateikė pasikartojantį periodą.');periodKeys.add(period.key);
  if(!period.sets.length)return;
  var selection=global.ApexVideoQuality.select(period.sets,stream.videoQuality),video=selection&&selection.set;
  var audios=period.sets.filter(function(s){return s.reps.some(function(r){return /^mp4a\.40\.2$/.test(codec(s,r));});});
  var audio=requested?audios.filter(function(s){return global.ApexViewOptions.audioId(s.text)===requested;})[0]||audios.filter(function(s){return s.lang===requestedLang&&children(s.node,'Label').map(function(n){return n.textContent;}).join('|')===requestedLabel;})[0]||audios.filter(function(s){return s.lang===requestedLang;})[0]:audios.filter(function(s){return /^(eng|en)$/i.test(s.lang);})[0]||audios[0];
  if(!video||!audio)throw Error('F1 nepateikė TV tinkamų AVC ir AAC takelių periode.');
  selectedVideo=selection.metadata;
  period.sets.forEach(function(set){if(set!==video&&set!==audio){period.node.removeChild(set.node);return;}var type=set===video?'video':'audio',reps=type==='video'?[selection.rep]:set.reps.filter(function(r){return /^mp4a\.40\.2$/.test(codec(set,r));});
   set.reps.forEach(function(rep){if(reps.indexOf(rep)<0)set.node.removeChild(rep.node);});
   reps.forEach(function(rep){
    var id=get(rep.node,'id'),bandwidth=get(rep.node,'bandwidth')||get(set.node,'bandwidth');if(!/^[A-Za-z0-9_.-]{1,128}$/.test(id)||!/^\d{1,12}$/.test(bandwidth))throw Error('Neatpažintas F1 takelio numeris.');
    var template=templates([root,period.node,set.node,rep.node]),scale=integer(get(template,'timescale')||'1'),offset=live?zero:integer(get(template,'presentationTimeOffset')||'0');if(scale===zero)throw Error('Netinkama F1 laiko skalė.');
    var first=integer(get(template,'startNumber')||'1'),numberShift=!live&&first>BigInt(1000000)&&/\$Number/.test(get(template,'media'))?first-BigInt(1):zero;
    ['availabilityTimeOffset','availabilityTimeComplete'].forEach(function(key){var value=key==='availabilityTimeOffset'?rep.base.offset:rep.base.complete;if(value&&!get(template,key))template.setAttribute(key,value);});
    var protection=children(set.node,'ContentProtection').concat(children(rep.node,'ContentProtection')).map(xml).join('');
    ['initialization','media'].forEach(function(kind){var value=get(template,kind),index=slots.length,query=[];if(index>=256)throw Error('F1 pateikė per daug medijos takelių.');if(value.indexOf('$Time')>=0)query.push('t=$Time$');if(value.indexOf('$Number')>=0)query.push('n=$Number$');
     var allowed=new Map([[id,{id:id,bandwidth:bandwidth}]]),validated=approved(value.replace(/\$(?:RepresentationID|Bandwidth|Time|Number)(?:%0\d{1,2}d)?\$/g,'1'),rep.base.url);
     slots.push({type:type,kind:kind,value:value,base:rep.base.url,host:new URL(validated).hostname,allowed:allowed,offset:offset,timescale:scale,numberShift:numberShift,sequenceShift:numberShift?first:zero,period:period.key,codec:codec(set,rep),protection:protection,descriptorKey:period.key+'/'+id});
     template.setAttribute(kind,route+'/s'+index+'/$RepresentationID$.mp4'+(query.length?'?'+query.join('&'):''));
    });
    if(numberShift)template.setAttribute('startNumber','1');
    if(offset){template.setAttribute('presentationTimeOffset','0');list(template.getElementsByTagName('*')).filter(function(n){return name(n)==='S';}).forEach(function(n){var t=get(n,'t');if(!t)return;var adjusted=integer(t)-offset;if(adjusted<zero)throw Error('Neatpažinta F1 segmento pradžia.');n.setAttribute('t',String(adjusted));});}
    remove(rep.node,['BaseURL','SegmentTemplate','SegmentList','SegmentBase']);rep.node.appendChild(template);
   });
   remove(set.node,['BaseURL','SegmentTemplate','SegmentList','SegmentBase']);summaries.push({type:type,representations:reps.length,language:set.lang,period:period.key});
  });
  remove(period.node,['BaseURL','SegmentTemplate','SegmentList','SegmentBase']);
 });
 if(!selectedVideo)throw Error('F1 nepateikė TV tinkamų vaizdo takelių.');
 remove(root,['BaseURL','SegmentTemplate','SegmentList','SegmentBase','Location','PatchLocation','ContentSteering']);
 // AVPlay must keep reloading the authorised local MPD, never an upstream alternate.
 return{mpd:xml(root),slots:slots,summaries:summaries,video:selectedVideo,live:live,periods:periods.map(function(p){return p.key;}),generation:generation===undefined?0:generation};
}
global.ApexDashManifest={build:build,approved:approved};
}(typeof window!=='undefined'?window:globalThis));
